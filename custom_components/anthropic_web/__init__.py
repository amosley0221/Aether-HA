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

DOMAIN = "anthropic_web"

CONF_API_KEY = "api_key"
CONF_MODEL = "model"
CONF_SYSTEM_PROMPT = "system_prompt"
CONF_MAX_TOKENS = "max_tokens"
CONF_DEFAULT_MAX_USES = "default_max_uses"

DEFAULT_MODEL = "claude-sonnet-4-5"
DEFAULT_MAX_TOKENS = 2048
DEFAULT_MAX_USES = 3
DEFAULT_SYSTEM_PROMPT = (
    "You are a research assistant with access to the web_search tool. "
    "Use it to find current, accurate information when answering. "
    "Reply concisely and directly — no preamble, no caveats. "
    "If sources disagree, briefly note that."
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
    """Register the search service from configuration.yaml settings."""
    conf = config.get(DOMAIN)
    if conf is None:
        _LOGGER.error(
            "anthropic_web requires a config block in configuration.yaml "
            "with at least api_key set"
        )
        return False

    # Import here so HA installs the requirement before we hit it.
    import anthropic

    api_key: str = conf[CONF_API_KEY]
    model: str = conf[CONF_MODEL]
    system_prompt: str = conf[CONF_SYSTEM_PROMPT]
    max_tokens: int = conf[CONF_MAX_TOKENS]
    default_max_uses: int = conf[CONF_DEFAULT_MAX_USES]

    client = anthropic.AsyncAnthropic(api_key=api_key)

    async def handle_search(call: ServiceCall) -> ServiceResponse:
        """Run an Anthropic message with web_search enabled."""
        query: str = call.data["query"]
        max_uses: int = call.data.get("max_uses", default_max_uses)

        try:
            response = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
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
        # with its own text blocks. We only need the text it speaks back.
        text_parts: list[str] = []
        for block in response.content:
            text = getattr(block, "text", None)
            if text:
                text_parts.append(text)

        # Collect citation URLs if present so the upstream agent can mention
        # them. Anthropic puts these on text blocks as `citations`.
        citations: list[str] = []
        for block in response.content:
            for cite in getattr(block, "citations", None) or []:
                url = getattr(cite, "url", None)
                if url and url not in citations:
                    citations.append(url)

        result_text = "\n\n".join(text_parts).strip() or "No answer returned."
        if citations:
            result_text += "\n\nSources: " + ", ".join(citations[:5])

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
