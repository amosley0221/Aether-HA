"""Anthropic Web Search service for Home Assistant.

Exposes a single service — `anthropic_web.search(query)` — that calls
Anthropic's API with the `web_search_20250305` tool enabled and returns
the model's synthesized answer (with up-to-date information).

Designed to be invoked from a script that's exposed to Assist, so the
primary conversation agent (e.g. Aether's Claude agent) can call this
script as a tool whenever it needs current information.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

DOMAIN = "anthropic_web"

CONF_API_KEY = "api_key"
CONF_MODEL = "model"
CONF_SYSTEM_PROMPT = "system_prompt"
CONF_MAX_TOKENS = "max_tokens"
CONF_DEFAULT_MAX_USES = "default_max_uses"

DEFAULT_MODEL = "claude-sonnet-4-5"
DEFAULT_MAX_TOKENS = 1024
DEFAULT_MAX_USES = 5
DEFAULT_SYSTEM_PROMPT = (
    "You are a knowledgeable friend who can quickly check the web for "
    "current information. Search as needed, then talk to the user like a "
    "person texting back - warm, casual, direct.\n\n"
    "STYLE:\n"
    "- 1 to 3 sentences. Conversational tone. Contractions are good.\n"
    "- Lead with the answer. No preamble, no recap of the question.\n"
    "- Sports: give the score and a quick highlight if there is one.\n"
    "- News: say what happened plainly.\n"
    "- Prices: state the current price.\n\n"
    "DO NOT:\n"
    "- Narrate your search ('I searched...', 'Let me check...', 'Based on "
    "the results...', 'I can see...').\n"
    "- List sources or URLs in the response.\n"
    "- Report partial or conflicting findings - resolve them silently and "
    "state the answer.\n"
    "- Trust ticket-sales sites (Ticketmaster, StubHub) for completed game "
    "results; they only show upcoming scheduled games.\n"
    "- Hedge unnecessarily or mention timezones/schedules unless that IS "
    "the answer.\n\n"
    "If you truly cannot find the answer after thorough searching, say so "
    "naturally in one sentence (e.g. 'Couldn't find that one - the game "
    "might still be in progress')."
)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_API_KEY): cv.string,
                vol.Optional(CONF_MODEL, default=DEFAULT_MODEL): cv.string,
                vol.Optional(CONF_SYSTEM_PROMPT, default=DEFAULT_SYSTEM_PROMPT): cv.string,
                vol.Optional(CONF_MAX_TOKENS, default=DEFAULT_MAX_TOKENS): vol.All(
                    int, vol.Range(min=64, max=8192)
                ),
                vol.Optional(CONF_DEFAULT_MAX_USES, default=DEFAULT_MAX_USES): vol.All(
                    int, vol.Range(min=1, max=10)
                ),
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)

SERVICE_SCHEMA = vol.Schema(
    {
        vol.Required("query"): cv.string,
        vol.Optional("max_uses"): vol.All(int, vol.Range(min=1, max=10)),
    }
)

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the search service from configuration.yaml settings.

    The anthropic package import is deferred until the service is first
    invoked. Importing at startup races the official Anthropic
    Conversation integration on `anthropic.resources`'s ModuleLock and
    deadlocks regardless of which thread/executor does the import. By
    waiting until someone calls the service, HA startup is finished and
    the official integration has already populated the module cache, so
    `import anthropic` is just a dict lookup.
    """
    conf = config.get(DOMAIN)
    if conf is None:
        _LOGGER.error(
            "anthropic_web requires a config block in configuration.yaml "
            "with at least api_key set"
        )
        return False

    api_key: str = conf[CONF_API_KEY]
    model: str = conf[CONF_MODEL]
    system_prompt: str = conf[CONF_SYSTEM_PROMPT]
    max_tokens: int = conf[CONF_MAX_TOKENS]
    default_max_uses: int = conf[CONF_DEFAULT_MAX_USES]

    # Lazy-init cache populated on first service call.
    state: dict[str, Any] = {"client": None, "anthropic": None}

    def _build_client() -> tuple[Any, Any]:
        """Run synchronously in an executor on first service call."""
        import anthropic  # noqa: PLC0415 — deliberately lazy
        return anthropic, anthropic.AsyncAnthropic(api_key=api_key)

    async def handle_search(call: ServiceCall) -> ServiceResponse:
        """Run an Anthropic message with web_search enabled."""
        if state["client"] is None:
            anthropic_mod, client = await hass.async_add_executor_job(_build_client)
            state["anthropic"] = anthropic_mod
            state["client"] = client

        anthropic = state["anthropic"]
        client = state["client"]

        query: str = call.data["query"]
        max_uses: int = call.data.get("max_uses", default_max_uses)

        # Inject the current local date/time so the model knows what "today",
        # "yesterday", "last night", etc. actually mean. Without this, Claude
        # often guesses a date from search-result headers (which can be off
        # by a day) or falls back to its training cutoff.
        now = dt_util.now()
        date_str = now.strftime("%A, %B %d, %Y at %I:%M %p %Z").strip()
        augmented_system = f"{system_prompt}\n\nCurrent local date and time: {date_str}"

        try:
            response = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=augmented_system,
                tools=[
                    {
                        "type": "web_search_20250305",
                        "name": "web_search",
                        "max_uses": max_uses,
                    }
                ],
                messages=[{"role": "user", "content": query}],
            )
        except anthropic.APIError as err:
            _LOGGER.error("Anthropic API error: %s", err)
            return {"result": f"Search failed: {err}"}
        except Exception as err:  # noqa: BLE001 — surface anything to the agent
            _LOGGER.exception("Unexpected error during web search")
            return {"result": f"Search failed: {err}"}

        # Anthropic returns a list of content blocks. With web_search the model
        # may emit server_tool_use / web_search_tool_result blocks interleaved
        # with text blocks. To suppress the chain-of-thought narration that
        # the model writes BETWEEN search calls, we only keep the LAST text
        # block in the response — that's the model's final synthesized
        # answer after all tool calls are done.
        text_blocks: list[str] = []
        for block in response.content:
            text = getattr(block, "text", None)
            if text:
                text_blocks.append(text)

        result_text = text_blocks[-1].strip() if text_blocks else "No answer returned."

        return {"result": result_text}

    hass.services.async_register(
        DOMAIN,
        "search",
        handle_search,
        schema=SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    _LOGGER.info("anthropic_web: search service registered (model=%s)", model)
    return True
