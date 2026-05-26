# Aether — Home Assistant install

Aether is a custom Home Assistant sidebar panel: three pages (Home, Music,
Dashboard) plus a built-in voice assistant ("Jarvis"), rendered by a single
custom element that HA hands the live `hass` object. Reads entity state and
calls services directly — no tokens, no iframes.

---

## What's included

### Home page
- **Hero**: live date/time, greeting, weather summary, indoor temp, room +
  light + speaker + camera counts.
- **Now Playing**: track / artist / album art for whichever room is active;
  tap to jump to Music.
- **The House**: 6-room preview rail (state + temp + playing-now indicator);
  tap any room to deep-link into Dashboard.
- **To-Do**: tasks with filters (all / active / done), persisted to your HA
  user data with localStorage fallback.
- **Sports**: ESPN scoreboard across enabled leagues (NBA, NFL, NHL, MLB,
  MLS, etc.) — live / today / upcoming, favorites bubble to the top.
- **News**: RSS headlines from configured feeds (rss2json), source filter,
  tap a headline to open it in the in-app browser.
- **Pinned Music**: 8-slot grid of albums / artists / playlists you've
  bookmarked from the Music page; tap to play on the active room.
- **Notes**: rich-text editor (bold / italic / lists / headings) + a
  drawing canvas with color and width picker; everything timestamped.

### Music page
- **Speakers rail**: every configured room. Drag-to-group via long-press
  (320 ms) — drop one speaker onto another to join them. Live status comes
  from the bare Sonos integration entity; control calls always target the
  Music Assistant wrapper.
- **Now Playing card**: art + metadata, transport (shuffle / prev / play /
  next / repeat), seekable progress bar, master volume, and per-room
  volume sliders when the room is the leader of a group.
- **Fullscreen player**: tap the expand icon at the top-right of the Now
  Playing card. Dark immersive overlay with the album art on the left and
  metadata + controls on the right; backdrop is a blurred copy of the art
  (or the room's color gradient when no art is available). The Aether
  brandbar and the Aether-AI chat FAB are hidden while it's up so the
  player owns the whole screen. Exit via the chevron-down button (top
  right) or the Escape key.
- **Library card** with three tabs:
  - **Listen Now** — your pinned albums / artists / playlists.
  - **Library** — browse the Music Assistant tree (Listen Now → Apple
    Music → For You / Recently Added auto-resolved).
  - **Search** — grouped results (artist / album / track / playlist /
    radio). Tap a track to play, an album to queue, etc.
- **EQ / Audio dialog**: Sonos audio switches (loudness, night sound,
  speech enhancement, crossfade, sub, surround, etc.) — surfaced per
  speaker.
- **Source dialog**: switch a speaker to TV, Line-in, HDMI, etc. when the
  Sonos integration exposes a `source_list`.

### Dashboard page
- **Lights**: per-fixture on/off + brightness slider. Friendly name, room
  tag, color-tinted glow.
- **Speakers**: play/pause toggle, now-playing row, volume slider, status.
- **Climate**: target-temp dial with current-temp readout, mode buttons
  (heat / cool / fan / dry), ± nudge buttons.
- **Cameras**: live thumbnail (auto-refresh ~10 s), tap → fullscreen
  WebRTC/HLS stream (hls.js fallback on non-Safari).
- **Car (Tesla)**: interactive 3D GLB via Google's `<model-viewer>` with
  door / frunk / trunk / charge-port animations. Battery + range, inside /
  outside / target temps, odometer. Lock, climate, defrost, sentry,
  charge-port, frunk, trunk buttons. Tessie update entity auto-detected
  with live install progress. Falls back to a static image or built-in
  SVG side profile if no GLB is configured.
- **Apple TV**: trackpad (swipes → d-pad), app grid (brand colors),
  volume slider that targets your configured Sonos soundbar.
- **LG webOS TV(s)**: app + input grid, volume, power. Wake-on-LAN magic
  packet on power-on for TVs that need it.
- **Quick actions** (top ribbon): All off, All on, Pause / resume all
  speakers, Goodnight scene, Edit, Hidden manager.
- **Filters** (pill row): All / Car / TV / Lights / Cameras / Climate /
  Speakers with live device counts.
- **Edit mode**: hide individual devices or whole sections. Persisted
  per HA user.

### App shell
- **Status pill**: continuously scans for low batteries (≤20 %),
  unavailable entities (filtered to user-facing domains), and pending
  updates. Device-grouped (e.g. 8 Sonos switches per speaker fold into
  one row). Also surfaces top integrations from the HA error log so you
  notice things like an expired Google/Nest token before everything
  goes dark.
- **Aether AI ("Jarvis")**: chat dialog backed by HA's Conversation
  integration. Auto-detects an LLM agent (Anthropic / OpenAI / Gemini)
  if you've installed one; falls back to the default `homeassistant`
  intent agent otherwise. Speech-to-text via Web Speech, TTS via
  browser SpeechSynthesis with HA TTS as a fallback. Auto-follow-up
  mic re-opens after each reply. Idle-timeout auto-closes the dialog
  (default 90 s).
- **Wake word**: continuous Web Speech listener. When it hears your
  configured phrase ("hey jarvis"), the chat opens and the mic
  activates instantly.
- **In-app browser**: HA events of kind `youtube` / `twitch` / `search`
  / `url` open in a modal so the dashboard never has to leave Aether.

---

## 1. Copy files to HA

From the SSH & Web Terminal add-on (or Samba / Studio Code Server):

```bash
mkdir -p /config/www/aether
cd /config/www/aether
```

Upload these files into `/config/www/aether/`:

```
aether-panel.js
aether-config.js
app.jsx
shared.jsx
home.jsx
music.jsx
dashboard.jsx
styles.css
home.css
music.css
dashboard.css
```

Optional extras (drop next to the rest if you use them):

```
tesla.glb       # interactive 3D Tesla model; see "Car / Tesla" below
```

Sanity check:

```bash
ls /config/www/aether
```

---

## 2. Register the panel in `configuration.yaml`

> ⚠️ Don't overwrite existing sidebar panels. Check whether your
> `configuration.yaml` already has a top-level `panel_custom:` block.
> `panel_custom:` is a list — appending one entry leaves the others
> intact; replacing the block deletes them.

**If `panel_custom:` already exists** — add the Aether entry as another
list item:

```yaml
panel_custom:
  # ... your existing entries stay here ...
  - name: aether-panel
    url_path: aether
    sidebar_title: Aether
    sidebar_icon: mdi:home-variant
    module_url: /local/aether/aether-panel.js
    js_url: /local/aether/aether-panel.js
    require_admin: false
    config: {}
```

**If `panel_custom:` doesn't exist yet** — add the whole block as a new
top-level key:

```yaml
panel_custom:
  - name: aether-panel
    url_path: aether
    sidebar_title: Aether
    sidebar_icon: mdi:home-variant
    module_url: /local/aether/aether-panel.js
    js_url: /local/aether/aether-panel.js
    require_admin: false
    config: {}
```

Quick check for what you already have:

```bash
grep -nE '^(panel_custom|panel_iframe|lovelace):' /config/configuration.yaml
```

Save → **Settings → System → Restart Home Assistant**.

The `url_path: aether` is what makes the sidebar entry. If you already
use that slug, change it (e.g. `aether-ha`).

---

## 3. Verify

After restart, **Aether** should appear in your HA sidebar. Open it —
the three pages (Home / Music / Dashboard) all live inside this single
panel.

If it doesn't load, open browser DevTools → Console. Aether errors
prefix with `[aether-panel]`.

---

## 4. Configure — `aether-config.js`

**This is your file.** Treat `/config/www/aether/aether-config.js` as
your personal customization layer. Future Aether updates ship the JSX /
CSS files; you maintain the config locally. (If you ever pull
`aether-config.js` from the repo wholesale, take a backup first — the
repo copy has defaults that will overwrite your wake word, voice
preference, model3d path, etc.)

A good once-and-done backup:

```bash
cp /config/www/aether/aether-config.js /config/www/aether/aether-config.local.backup.js
```

### Top-level blocks

| Block | What it controls |
|---|---|
| `user` | Friendly name override. Empty → use the HA user's first name. |
| `serviceLabel` | Music-service name shown in the Library card header (e.g. "Apple Music"). |
| `voice` | Wake word, STT/TTS language, preferred voice, rate/pitch, HA-TTS fallback (see below). |
| `rooms` | Array of speaker zones; each has a Music Assistant `mediaPlayer`, a bare `displayPlayer`, color, lights, optional camera, motion sensor. |
| `cameras` | Camera entity IDs for the Dashboard cameras section. |
| `climate` | Thermostat entity IDs for the Dashboard climate section. |
| `weather` | Weather entity for the Home hero. |
| `car` | Tesla config (see below). |
| `appleTV` | Apple TV remote + media player + soundbar binding + app list. |
| `lgTVs` | Array of LG webOS TVs — each with media player, optional remote, apps, inputs, WoL MAC. |
| `globalLights` | Lights not attached to any specific room. |
| `scenes` | Pinned Home-page scenes — id, label, icon, gradient, optional service. |
| `groupService` / `ungroupService` | Defaults to `media_player.join` / `media_player.unjoin`. |
| `sports` | `{ leagues: [...], favorites: { NBA: [...], NFL: [...] }, previewCount: N }`. |
| `news` | `{ feeds: [{ name, url }], previewCount: N }`. |
| `chat` | `{ idleTimeoutSeconds: 90 }` and similar chat-dialog knobs. |
| `statusPillIgnore` | Regex + exact-id blocklist for the status pill (entities you don't want flagged). |

### Rooms

Each room has `mediaPlayer` (the Music Assistant wrapper that supports
`search_media`) and a `displayPlayer` (the bare Sonos integration entity).
Aether auto-resolves the `_2` / `_3` MA twin when entity IDs collide. To
find which suffix is the MA wrapper, **Developer Tools → States** and
look for `mass_player_id` or `media_assistant` in the attributes.

```js
rooms: [
  {
    id: "living",
    name: "Living Room",
    color: ["#c47a64", "#7a3b2c"],
    mediaPlayer:   "media_player.living_room_4",   // MA wrapper
    displayPlayer: "media_player.living_room",     // bare Sonos
    lights: ["light.living_room_lamp", "light.sofa_lamp"],
    motion: "binary_sensor.living_room_motion",
    camera: "camera.living_room",
  },
  // …
],
```

### Voice / Jarvis

```js
voice: {
  enabled:         true,
  speakResponses:  true,
  language:        "en-GB",                          // STT + TTS locale
  rate:            1.0,
  pitch:           1.0,
  wakeWord:        "hey jarvis",                     // null disables wake-word
  preferredVoice:  "Google UK English Male",         // fragment match
  ttsMediaPlayer:  "media_player.pixel_tablet",      // HA-TTS output device
  ttsService:      "tts.google_translate_en_com",    // HA TTS service entity
  forceHATTS:      false,                            // true = always route via HA
},
```

Phrases work better as wake words than single words — Web Speech
mis-fires often on short triggers. Three syllables ("hey jarvis wake")
almost never false-trigger but still feel natural.

For a more butler-like voice, install Piper or ElevenLabs as a TTS
integration in HA, point `ttsService` at it, and set `forceHATTS: true`.
Trade-off: ~500 ms latency per reply.

### Car / Tesla

Three rendering modes in priority order:

```js
car: {
  model3d: "/local/aether/tesla.glb",   // interactive 3D — preferred
  image:   "/local/aether/tesla.png",   // static PNG/SVG fallback
  // (no field) → built-in SVG side profile
  name:   "Model 3",
  year:   2024,
  color:  "Pearl White",
  wheels: "19\" Sport",
  entities: {
    lock:        "lock.tesla_doors",
    climate:     "climate.tesla",
    defrost:     "switch.tesla_defrost",
    sentry:      "switch.tesla_sentry",
    chargePort:  "cover.tesla_charge_port",
    frunk:       "cover.tesla_frunk",
    trunk:       "cover.tesla_trunk",
    update:      "update.tesla_software",   // optional; auto-detected if omitted
    // … see comments in aether-config.js for the full list
  },
},
```

Drop a `.glb` into `/config/www/aether/` and point `model3d` at it. Free
sources: Sketchfab (filter Downloadable + Free), CGTrader, Free3D.
Animations named `door_open`, `frunk_open`, `trunk_open`, `charge_port_open`
will sync to the matching HA entities.

### Sports

```js
sports: {
  leagues: ["NBA", "NFL", "NHL", "MLB", "MLS"],
  favorites: {
    NBA: ["Lakers", "Celtics"],
    NFL: ["Eagles"],
  },
  previewCount: 4,
},
```

Round-robins across leagues so the home tile always has variety.
Favorites jump to the top.

### News

```js
news: {
  feeds: [
    { name: "BBC",       url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
    // …
  ],
  previewCount: 6,
},
```

Headlines come via `rss2json` (no HA-side scraping required). Tap any
headline to open the article in the in-app browser modal.

### Status pill

Hide entities you don't want flagged:

```js
statusPillIgnore: {
  // Exact entity IDs
  entityIds: [
    "sensor.guest_phone_battery",
  ],
  // Regex patterns (string form — Aether builds RegExps from these)
  patterns: [
    "^sensor\\.guest_.*",
    "^update\\..*beta.*",
  ],
},
```

---

## 5. Updating Aether

When you pull a new version of Aether from the repo:

```bash
# from your dev machine, with the SSH add-on enabled:
scp -O *.jsx *.css *.js root@homeassistant.local:/config/www/aether/
```

Or, file-by-file via curl from HA itself (cache-busted):

```bash
curl -fsSL "https://raw.githubusercontent.com/<you>/Aether-HA/<branch>/music.jsx?_=$(date +%s)" \
  -o /config/www/aether/music.jsx
```

**Don't overwrite `aether-config.js`** unless you intend to — that's your
file. The JSX and CSS files are safe to replace wholesale.

After uploading, hard-refresh the panel (⌘⇧R / Ctrl+F5). No HA restart
needed — only static files changed. The loader uses `cache: "no-cache"`
so changes show on next paint.

---

## Troubleshooting

**Panel doesn't appear in sidebar.**
- Check `configuration.yaml`: `panel_custom:` block present and indented
  as a top-level key.
- Restart HA (file changes to `configuration.yaml` require a restart).
- Hard-refresh the HA frontend.

**Panel loads but is empty / errors in console.**
- Errors prefix with `[aether-panel]`. Most common: a JSX file failed to
  fetch — check `/config/www/aether/` actually contains all 11 files.
- Babel transform errors usually point at a single file; check the
  filename in the message.

**Music section says "Offline" for a speaker that's playing.**
- Aether reads from the Music Assistant wrapper entity. If `_4` is the
  MA twin for `media_player.living_room`, `aether-config.js` must point
  `mediaPlayer` at `_4`, not the bare name. Confirm in Developer Tools →
  States.

**Wake word triggers when nobody said anything.**
- Web Speech mis-hears single-word triggers. Use a phrase ("hey jarvis
  wake") — three syllables almost never false-trigger.

**Jarvis sounds American on a Pixel Tablet.**
- The British voice data isn't installed. **Tablet Settings → System →
  Languages → Text-to-speech output → Google → Install voice data →
  English (UK)** and pick the Male / Female variant. Then make sure
  `voice.preferredVoice` matches the installed name fragment exactly.

**Status pill shows entities I don't care about.**
- Add them (or a regex covering them) to `statusPillIgnore`. Reload the
  panel; pill recalculates immediately.

**Tesla model is invisible / shows the SVG fallback.**
- The GLB didn't load. Open browser DevTools → Network and look for the
  `tesla.glb` request; it should be 200 with content-type
  `model/gltf-binary` or similar. If 404, the file isn't where
  `model3d` says it is.

**Several Google/Nest entities go unavailable at once.**
- Google OAuth tokens expire periodically. **HA → Settings → System →
  Repairs** has the re-auth prompt. The status pill catches this — it's
  not an Aether bug, it's Google.
