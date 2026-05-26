# Aether-HA — Claude session notes

Aether is a Home Assistant custom panel. A single `<aether-panel>` custom
element (registered by `aether-panel.js`) mounts a React app with three
pages (Home, Music, Dashboard), a built-in voice assistant ("Jarvis"),
and an in-app browser. It reads live state from the `hass` object HA
hands the panel, and calls services directly — no tokens, no iframes.

User-facing install / configuration docs live in `HA_SETUP.md`. This
file is for me — architecture, conventions, gotchas.

---

## Repo layout

```
aether-panel.js   — custom element entry; loads CSS + JSX, runs Babel, mounts React
aether-config.js  — USER'S FILE. Room map, voice settings, car, sports, news, etc.
app.jsx           — App shell: brandbar, page router, status pill, chat dialog, wake word, browser modal
shared.jsx        — Icon set, useHass / useEntity / callService, useModalAnchor, fmt, Avatar
home.jsx          — Home page: hero, now-playing, rooms rail, to-do, sports, news, pinned music, notes
music.jsx         — Music page: rooms rail (drag-to-group), Now Playing card, fullscreen player, Library tabs, EQ/Source dialogs
dashboard.jsx     — Dashboard page: lights, speakers, climate, cameras, car, Apple TV, LG TVs; edit mode
styles.css        — Global theme tokens, brandbar, status pill, chat dialog, modal infra
home.css / music.css / dashboard.css — page-specific styles
HA_SETUP.md       — user-facing install / config doc
```

No build step. The panel loads `.jsx` files at runtime and transforms
them in-browser via Babel standalone. Edits land the moment the user
hard-refreshes the panel.

---

## Critical conventions — read these before changing anything

### 1. `aether-config.js` is the user's file. Do not push changes to it.

The user maintains their own `aether-config.js` in `/config/www/aether/`
with their wake word, preferred voice, Tesla GLB path, room → entity
map, sports favorites, news feeds, status-pill ignore list, etc.

Every time we've pushed `aether-config.js` to the repo with "defaults",
the user's curl-pull has clobbered their customizations. Three times in
one session we've had to restore `wakeWord`, `preferredVoice`,
`language`, and `model3d`.

**Rule:** when a task needs new config fields, give the user a
**copy-paste patch** for their local file instead of editing
`aether-config.js` in the repo. JSX and CSS files are safe to push —
only the config is sacred.

### 2. HA collapses `position: fixed` to absolute in the panel.

Anything in HA's panel system runs inside a shadow DOM with ancestor
transforms / containment. `position: fixed; inset: 0` does **not**
cover the viewport — it gets contained by some HA wrapper.

Use the existing `useModalAnchor` hook from `shared.jsx` for any new
fullscreen overlay or modal. It walks up from `<aether-panel>` looking
for the real scroll container, captures its `scrollTop` on mount, and
returns that value — caller writes it into an inline `top` style on a
`position: absolute; height: 100vh` element. Pattern:

```jsx
const scrollTop = useModalAnchor(true);
return <div className="my-overlay" style={{ top: scrollTop }}>…</div>;
// CSS: position: absolute; left: 0; width: 100%; height: 100vh; z-index: 1000;
```

See `SourceDialog`, `EQDialog`, `ChatDialog`, `NowPlayingFullscreen` —
all use this pattern.

### 3. `document.querySelector("aether-panel")` returns null.

HA mounts `<aether-panel>` inside its own shadow DOM, which
`document.querySelector` does not pierce. If you need an in-tree host
to attach a class to (e.g. to hide brandbar/chat-fab via CSS), use
**`window.__aetherMount`** — that's the `<div id="aether-mount">` the
React app actually renders into, guaranteed to be in the same DOM tree
as our CSS files.

### 4. Music Assistant entity resolution

Sonos rooms have two entities: the bare integration entity (mirrors
external playback, exposes `source_list` for TV / Line-in) and the
Music Assistant wrapper (supports `search_media` and `play_media`
properly). HA assigns suffixes like `_2` / `_3` / `_4` when entity IDs
collide.

`music.jsx#resolveMaPlayer` auto-walks the suffix space looking for the
sibling with the `SEARCH_MEDIA_FEATURE` bit set (4194304). All control
service calls target the resolved MA wrapper; live status (especially
TV / Line-in detection via `source` attribute) reads from the bare
display player. Don't break this pattern — both halves matter.

### 5. Workflow: every change → curl-pull, no scp from dev box

The user installs by curl-pulling individual files from the branch into
`/config/www/aether/`. Their workflow per change is:

```bash
curl -fsSL "https://raw.githubusercontent.com/amosley0221/Aether-HA/<branch>/<file>?_=$(date +%s)" \
  -o /config/www/aether/<file>
```

The cache-bust query param is mandatory — HA's static serving caches
indefinitely.

Always remind the user which files changed and what to curl. Don't
expect them to scp.

### 6. Branch discipline

All session work lives on `claude/implement-aether-design-foFQv`. Push
there, not main. The user has not asked for PRs — don't open one
without explicit instruction.

---

## Architecture quirks worth knowing

### Light DOM custom element

`<aether-panel>` does NOT use `attachShadow`. CSS files are loaded as
`<link rel="stylesheet">` children of the element (light DOM), so they
style descendants normally. But — because aether-panel itself is
mounted inside HA's shadow tree — `<html>`-level classes are
inaccessible to our stylesheets, and our stylesheets can't reach
elements outside the panel. See "rule 3" above.

### Wake word listener

`app.jsx` spins up a continuous Web Speech recognition loop when
`voice.wakeWord` is set. On a match it sets `chatAutoListen=true` and
opens the chat dialog, which then starts its own STT. The wake-word
recognizer must be stopped before the chat's recognizer starts — they
fight for the mic otherwise. See the `chatOpen ? stop()` branch.

### Tesla GLB rendering

`<model-viewer>` is Google's web component (loaded once per panel
mount). The component is created via `React.createElement` (NOT JSX —
Babel-standalone doesn't always handle custom elements with attributes
inside JSX cleanly).

Multi-clip animation (open door + open frunk simultaneously) isn't
supported by the standard model-viewer API — only one clip plays at a
time. The workaround walks `<model-viewer>`'s shadow DOM to find the
internal `<animation-mixer>` and triggers additional clips directly.
Fragile across versions; if it breaks, check the shadow-DOM walk in
`dashboard.jsx#CarModel3D`.

### Conversation agent auto-detection

The chat dialog (`app.jsx#ChatDialog`) auto-detects an installed LLM
agent (Anthropic / OpenAI / Gemini) and uses it preferentially over
the default `homeassistant` intent agent. Selection is persisted to HA
user data via the frontend storage API. If both an Anthropic and a
Gemini agent exist, Anthropic wins (see the priority list in the
detection code).

### Status pill

Scans every render for:
- low batteries (≤20 %)
- unavailable entities (filtered to user-facing domains:
  switch/climate/lock/cover/fan/camera/vacuum/remote)
- pending updates (in_progress OR percentage attr)

Device-key grouping: 8 Sonos switches per speaker collapse into one
row by `device_id`. Diagnostic / mobile-app / RSSI / linkquality
entities are excluded from "unavailable" specifically (otherwise the
pill is noise).

Also parses HA's `/api/error_log` and surfaces the top integrations
with recent errors — this is how we caught the Google/Nest OAuth
expiry. See `app.jsx#issues` memo.

---

## Common task patterns

### Adding a new icon

`shared.jsx#Icon` is a switch over `svgs` keyed by name. Inline SVG,
monoline, 1.6 stroke width. Add the new path to the `svgs` object;
referenced elsewhere as `<Icon name="…" size={16} />`.

### Adding a new dialog / overlay

1. Function component, accepts `{ open, onClose, … }`.
2. `const scrollTop = useModalAnchor(open);`
3. Early return `null` if `!open`.
4. Render `<div className="modal-backdrop" style={{ top: scrollTop }} onClick={onClose}>` with the inner modal `onClick={(e) => e.stopPropagation()}`.
5. Use the existing `.modal` / `.modal-head` / `.modal-body` /
   `.modal-close` classes from `music.css` (~line 500).

### Adding a new section to Home

Sections render inside `home.jsx#HomePage` return JSX, gated by the
edit-mode visibility map. The tile grid uses `react-grid-layout`-ish
config persisted to HA user data.

### Wiring a new service call

`shared.jsx#callService` wraps `hass.callService(domain, service,
data)`. Use it directly — don't reach into `hass.connection`. All
control flows in this codebase go through `callService` for
consistency and easy logging.

### Reading entity state

`useEntity(entityId)` returns the full state object (with attributes)
or null. `useHass()` returns the live hass object for direct
`hass.states[entityId]` access when you need bulk reads.

---

## Pixel Tablet quirks the user hits

- **British voice**: must install English (UK) voice data via tablet
  settings (System → Languages → TTS output → Google → Install voice
  data). Voice name fragment match: "Google UK English Male" or
  "Google UK English Female".
- **Web Speech in WebView**: works, but mic permission must be granted
  via Fully Kiosk's *Settings → Web Browsing*. Easy to miss.
- **Cast endpoint**: the tablet exposes itself as
  `media_player.pixel_tablet` for HA TTS routing.

---

## Recent feature additions (for context)

- **Fullscreen Now Playing**: expand icon at top-right of NP card.
  Dark immersive overlay, album art left, controls right, hides
  brandbar + chat-fab. Implementation: `music.jsx#NowPlayingFullscreen`
  + `.np-fs-*` classes in `music.css`. Uses `useModalAnchor` and the
  `aether-mount` host-class trick.
- **Status pill grouping**: device-keyed Unavailable + Recent errors
  pulled from HA log.
- **Tesla GLB + multi-clip animation**.
- **Sports + News tiles** on Home.
- **Notes editor** with rich text + drawing canvas.
- **Wake word + voice TTS** with HA fallback.

If the user references "the fullscreen player" or "the expand button",
that's `NowPlayingFullscreen`. If they mention the "1 issue" pill,
that's `app.jsx#issues` + `StatusDialog`.
