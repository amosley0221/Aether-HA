# Aether — Home Assistant install

This installs Aether as a sidebar panel in Home Assistant. The panel runs
as a custom element; HA hands it the live `hass` object, so it reads
entity state and calls services directly — no tokens, no iframes.

## 1. Copy files to HA

From the SSH & Web Terminal add-on:

```bash
mkdir -p /config/www/aether
cd /config/www/aether
```

Then upload these files into `/config/www/aether/` (use the **Samba share**,
**Studio Code Server**, or `scp` from your machine):

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

Quick sanity check:

```bash
ls /config/www/aether
```

You should see all 11 files.

## 2. Register the panel in `configuration.yaml`

> ⚠️ **Don't overwrite existing sidebar panels.** Check whether your
> `configuration.yaml` already has a top-level `panel_custom:` block.
> `panel_custom:` is a **list** — appending one item leaves the others
> intact; replacing the whole block deletes them. Same applies if you
> have a `panel_iframe:` block (separate key — won't conflict).

Open `/config/configuration.yaml` (File Editor or Studio Code Server) and:

**If `panel_custom:` already exists** — add the Aether entry as another
list item under it:

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

**If `panel_custom:` does NOT exist yet** — add the whole block as a new
top-level key (don't nest it under anything else):

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

To quickly check what you have, run in the SSH terminal:

```bash
grep -nE '^(panel_custom|panel_iframe|lovelace):' /config/configuration.yaml
```

That prints any existing panel-related blocks with their line numbers so
you can scroll to the right spot.

Save → **Settings → System → Restart Home Assistant** (or **Developer Tools
→ YAML → Check Configuration**, then Restart).

The `url_path: aether` is what makes the sidebar entry. If you already use
the URL slug `aether` for something else, change this to e.g. `aether-ha`.

## 3. Verify

After restart, **Aether** should appear in your HA sidebar. Click it. The
three sub-tabs (Home / Music / Dashboard) all use the same custom panel.

If it doesn't load, open the browser DevTools console — Aether errors
prefix with `[aether-panel]`.

## 4. Edit the entity mapping

`/config/www/aether/aether-config.js` has the room → entity map. Edit it
to fix:

- Which `media_player.*` is the Music Assistant copy for each Sonos room
  (HA appends `_2`, `_3`, etc. when entity_ids collide). You currently
  have `media_player.living_room` through `media_player.living_room_4` —
  the file maps `_4` as MA, but verify in **Developer Tools → States** that
  `_4` is the one with the `media_assistant`/`mass_player_id` attribute.
- Which lights belong to which room.
- Which scenes pin to the Home page.

After editing, reload the panel (hard refresh: ⌘⇧R / Ctrl+F5). No HA
restart needed — only the JS file changed.

## 5. Updating

When pulling a new version of Aether:

```bash
# from your dev machine, with ssh add-on enabled:
scp -O *.jsx *.css *.js root@homeassistant.local:/config/www/aether/
```

Hard refresh the panel — the loader uses `cache: "no-cache"` so changes
show immediately.

## Known gaps (work-in-progress)

The current build registers the panel and renders the prototype UI. Live
hass wiring is being added in stages:

- [ ] Home page hero pulls weather + indoor temp from your entities
- [ ] Scenes call `scene.turn_on` (mapped in aether-config.js, not yet
      bound)
- [ ] Light tiles call `light.turn_on` / `turn_off` with brightness
- [ ] Climate tile bound to `climate.hallway`
- [ ] Camera tiles use HA's `camera_proxy_stream` URL
- [ ] Music page reads MA player state; transport calls `media_player.*`
      services; drag-to-group calls `media_player.join`/`unjoin`

Until that pass lands, the panel renders with the prototype's mock data
and controls. Confirm the panel loads first, then I'll wire the rest.
