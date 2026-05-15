/* Home page — wired to Home Assistant via hass.
   - Greeting pulls from hass.user.name (override with AETHER_CONFIG.user.name)
   - Indoor temp + mode from configured climate entity
   - Outdoor temp + condition from weather entity
   - Lights / cameras / speakers tiles count live entity state
   - Scenes call scene.turn_on with the target from aether-config.js
   - House rooms list reads live MA wrappers + Sonos fallback */

function HomePage({ navigate }) {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  const [now, setNow] = React.useState(new Date());
  const [editorOpen, setEditorOpen] = React.useState(false);

  // User-pinned scenes from frontend user data, falls back to cfg.scenes
  const [userScenes, setUserScenes] = React.useState(null);
  React.useEffect(() => {
    if (!hass) return;
    (async () => {
      try {
        const r = await hass.callWS({
          type: "frontend/get_user_data",
          key:  "aether_home_scenes",
        });
        if (Array.isArray(r?.value)) setUserScenes(r.value);
      } catch {
        try {
          const stored = localStorage.getItem("aether_home_scenes");
          if (stored) setUserScenes(JSON.parse(stored));
        } catch {}
      }
    })();
  }, [hass]);

  const saveUserScenes = async (next) => {
    setUserScenes(next);
    try { localStorage.setItem("aether_home_scenes", JSON.stringify(next)); } catch {}
    try {
      await hass?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_home_scenes",
        value: next,
      });
    } catch {}
  };

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const hour = now.getHours();
  const greeting =
    hour < 5  ? "Still up"        :
    hour < 12 ? "Good morning"    :
    hour < 18 ? "Good afternoon"  :
                "Good evening";

  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  // Name: explicit override → first name from hass user → blank
  const userName =
    cfg.user?.name ||
    (hass?.user?.name || "").split(" ")[0];

  // ─── Live room derivations (mirrors music page logic) ─────────────────
  const liveRooms = React.useMemo(() => {
    const score = (s) => s === "playing" ? 0 : s === "paused" ? 1 : s === "idle" ? 2 : 3;
    return cfg.rooms.map(room => {
      const ctrl    = hass?.states?.[room.mediaPlayer];
      const display = room.displayPlayer ? hass?.states?.[room.displayPlayer] : null;
      const active  = [ctrl, display].filter(Boolean).sort(
        (a, b) => score(a.state) - score(b.state)
      )[0] || ctrl || display;
      const a = active?.attributes || {};
      return {
        ...room,
        entity: active,
        playing: active?.state === "playing",
        track:   a.media_title || "",
        artist:  a.media_artist || "",
        art:     a.entity_picture || null,
        volume:  Math.round(((ctrl?.attributes?.volume_level ?? a.volume_level) ?? 0) * 100),
      };
    });
  }, [hass, cfg.rooms]);

  const playingRooms   = liveRooms.filter(r => r.playing);
  const primaryPlaying = playingRooms[0];

  // Lights — combine per-room + globalLights into a unique set
  const allLightIds = React.useMemo(() => {
    const ids = new Set();
    for (const r of cfg.rooms) (r.lights || []).forEach(l => ids.add(l));
    for (const l of (cfg.globalLights || [])) ids.add(l);
    return [...ids];
  }, [cfg]);
  const lightStates = allLightIds.map(id => hass?.states?.[id]).filter(Boolean);
  const lightsOn    = lightStates.filter(s => s.state === "on").length;
  const lightsTotal = lightStates.length || allLightIds.length;

  // Cameras
  const cameraStates = (cfg.cameras || []).map(id => hass?.states?.[id]).filter(Boolean);

  // Climate + weather
  const climate     = hass?.states?.[cfg.climate?.[0] || "climate.hallway"];
  const indoorTemp  = climate?.attributes?.current_temperature;
  const targetTemp  = climate?.attributes?.temperature;
  const hvacMode    = climate?.state || "—";
  const climateUnit = climate?.attributes?.temperature_unit || "F";

  const weather       = hass?.states?.[cfg.weather || "weather.forecast_home"];
  const outdoorTemp   = weather?.attributes?.temperature;
  const weatherUnit   = weather?.attributes?.temperature_unit || "°F";
  const condition     = (weather?.state || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const scenes = (userScenes && userScenes.length > 0)
    ? userScenes
    : (cfg.scenes || []);
  const fireScene = async (s) => {
    if (!hass || !s.target) return;
    try {
      await callService(hass, s.service || "scene.turn_on", { entity_id: s.target });
    } catch (err) {
      console.warn("[aether] scene fire failed:", err);
    }
  };

  if (!hass) {
    return <div className="page home" style={{ padding: 40 }}>Connecting to Home Assistant…</div>;
  }

  return (
    <div className="page home" data-screen-label="01 Home">
      {/* Hero */}
      <div className="hero">
        <div className="hero-grid">
          <div>
            <div className="hero-time">{date} · {time}</div>
            <div className="hero-greet">
              {greeting}{userName ? <>, <b>{userName}</b></> : null}.
            </div>
            <div className="hero-sub">
              {playingRooms.length > 0
                ? `Music is playing in ${playingRooms.length} ${playingRooms.length === 1 ? "room" : "rooms"}. ${lightsOn} ${lightsOn === 1 ? "light is" : "lights are"} on.`
                : lightsOn > 0
                  ? `${lightsOn} ${lightsOn === 1 ? "light is" : "lights are"} on. The house is quiet — tap below to put on something.`
                  : "The house is quiet."}
            </div>
          </div>
          <div className="hero-stats">
            <div className="stat-cell">
              <span className="lbl">Indoor</span>
              <span className="val row">
                {indoorTemp ?? "—"}<span className="unit">°{climateUnit}</span>
              </span>
              <span className="meta">
                {climate
                  ? `${hvacMode.replace(/^./, c => c.toUpperCase())}${targetTemp ? ` · target ${targetTemp}°` : ""}`
                  : "No thermostat"}
              </span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Outside</span>
              <span className="val row">
                {outdoorTemp ?? "—"}<span className="unit">{weatherUnit}</span>
              </span>
              <span className="meta">{condition || "—"}</span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Speakers</span>
              <span className="val row">
                {playingRooms.length}<span className="unit">/ {cfg.rooms.length} playing</span>
              </span>
              <span className="meta">
                {playingRooms.length > 0
                  ? playingRooms.map(r => r.name).slice(0, 3).join(" · ") + (playingRooms.length > 3 ? " · …" : "")
                  : "All idle"}
              </span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Cameras</span>
              <span className="val row">
                {cameraStates.length}<span className="unit">live</span>
              </span>
              <span className="meta">No motion detected</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scenes */}
      <div className="h-section">
        <div className="h-section-head">
          <h2>Scenes</h2>
          <button className="h-link" onClick={() => setEditorOpen(true)}>Edit</button>
        </div>
        {scenes.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            No scenes pinned. Tap <b>Edit</b> to choose some.
          </div>
        ) : (
          <div className="scenes">
            {scenes.map(s => (
              <button key={s.id || s.target} className="scene" onClick={() => fireScene(s)}>
                <div className="icon"><Icon name={s.icon || "sparkle"} size={16} /></div>
                <div className="gradient" style={{ background: s.grad || "linear-gradient(135deg, #6aa1d8, #14283f)" }} />
                <div>
                  <div className="name">{s.name}</div>
                  <div className="meta">{s.meta}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Now playing snapshot + House map */}
      <div className="home-row">
        <div
          className="now-mini"
          onClick={() => navigate("music")}
          style={primaryPlaying?.art ? {
            backgroundImage: `linear-gradient(160deg, rgba(30,63,122,.55) 0%, rgba(20,40,80,.85) 100%), url('${primaryPlaying.art}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          } : undefined}
        >
          <div className="e">Now playing · {playingRooms.length} {playingRooms.length === 1 ? "room" : "rooms"}</div>
          <div>
            <div className="track">{primaryPlaying?.track || "Nothing playing"}</div>
            <div className="artist">{primaryPlaying?.artist || ""}</div>
          </div>
          <div className="play-row">
            <button
              className="play-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (!primaryPlaying?.entity) return;
                callService(hass,
                  primaryPlaying.playing ? "media_player.media_pause" : "media_player.media_play",
                  { entity_id: primaryPlaying.mediaPlayer }
                );
              }}
              title={primaryPlaying?.playing ? "Pause" : "Play"}
            >
              <Icon name={primaryPlaying?.playing ? "pause" : "play"} size={18} />
            </button>
            <div className="rooms-tag">
              {playingRooms.length ? playingRooms.map(r => r.name).join(" · ") : "Idle"}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: .85 }}>Open music</span>
              <Icon name="expand" size={14} />
            </div>
          </div>
        </div>

        <div className="house-card">
          <div className="h-section-head" style={{ padding: 0 }}>
            <h2 style={{ fontSize: 16 }}>The house</h2>
            <button className="h-link" onClick={() => navigate("dashboard")}>Manage</button>
          </div>
          <div className="house-rooms">
            {liveRooms.slice(0, 6).map(r => <MiniRoomRow key={r.id} room={r} />)}
          </div>
        </div>
      </div>

      {/* Status tiles */}
      <div className="h-section">
        <div className="h-section-head">
          <h2>Status</h2>
          <button className="h-link" onClick={() => navigate("dashboard")}>Open dashboard</button>
        </div>
        <div className="status-grid">
          <div className="status-tile">
            <div className="ic"><Icon name="bulb" /></div>
            <div>
              <div className="t">Lights</div>
              <div className="v">{lightsOn} of {lightsTotal} on</div>
            </div>
          </div>
          <div className="status-tile">
            <div className="ic"><Icon name="speaker" /></div>
            <div>
              <div className="t">Speakers</div>
              <div className="v">
                {playingRooms.length === 0
                  ? "All idle"
                  : `${playingRooms.length} of ${cfg.rooms.length} playing`}
              </div>
            </div>
          </div>
          <div className="status-tile">
            <div className="ic"><Icon name="camera" /></div>
            <div>
              <div className="t">Cameras</div>
              <div className="v">{cameraStates.length} live</div>
            </div>
          </div>
          <div className="status-tile">
            <div className="ic"><Icon name="thermo" /></div>
            <div>
              <div className="t">Climate</div>
              <div className="v">
                {indoorTemp ? `${indoorTemp}°` : "—"}
                {targetTemp ? <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 400 }}> · to {targetTemp}°</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      <SceneEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        hass={hass}
        current={scenes}
        onSave={saveUserScenes}
      />
    </div>
  );
}

// Lets the user pick up to 10 scenes from any scene.* entity to show on
// the Home page. Persisted to HA's user data (synced across devices).
function SceneEditor({ open, onClose, hass, current, onSave }) {
  const [selected, setSelected] = React.useState([]);
  const scrollTop = useModalAnchor(open);
  React.useEffect(() => {
    if (!open) return;
    setSelected((current || []).map((s) => s.target).filter(Boolean));
  }, [open, current]);

  if (!open || !hass) return null;

  // All scene.* entities from hass, sorted by friendly name
  const all = Object.values(hass.states)
    .filter((s) => s.entity_id.startsWith("scene."))
    .map((s) => ({
      id: s.entity_id,
      name: s.attributes.friendly_name || s.entity_id.replace("scene.", "").replace(/_/g, " "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group scenes by their room/object_id prefix for easier scanning
  const groups = {};
  for (const sc of all) {
    const parts = sc.id.replace("scene.", "").split("_");
    const prefix = parts.length > 2 ? parts.slice(0, parts.length - 1).join("_") : (parts[0] || "Other");
    const key = prefix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    (groups[key] = groups[key] || []).push(sc);
  }

  const toggle = (id) => {
    if (selected.includes(id)) setSelected(selected.filter((x) => x !== id));
    else if (selected.length < 10) setSelected([...selected, id]);
  };

  const save = () => {
    // Preserve any user-tuned name/meta/icon/grad on already-pinned scenes;
    // for newly added ones, derive a name from the entity friendly_name.
    const next = selected.map((id) => {
      const prev = (current || []).find((s) => s.target === id);
      if (prev) return prev;
      const name = all.find((s) => s.id === id)?.name || id;
      return {
        id, target: id,
        service: "scene.turn_on",
        name: name.split(" ").slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
        meta: name,
        icon: "sparkle",
        grad: "linear-gradient(135deg, #6aa1d8, #14283f)",
      };
    });
    onSave(next);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Edit home scenes <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 400, marginLeft: 8 }}>{selected.length} / 10</span></h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {Object.keys(groups).sort().map((g) => (
            <div key={g} style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em",
                color: "var(--ink-3)", fontWeight: 600, marginBottom: 8,
              }}>{g}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {groups[g].map((sc) => {
                  const on = selected.includes(sc.id);
                  return (
                    <label
                      key={sc.id}
                      className={"scene-pick" + (on ? " on" : "")}
                      onClick={(e) => { e.preventDefault(); toggle(sc.id); }}
                    >
                      <span className={"scene-pick-check" + (on ? " on" : "")}>
                        {on ? "✓" : ""}
                      </span>
                      <span className="scene-pick-name">{sc.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="modal-btn" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage });
