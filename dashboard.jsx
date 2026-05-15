/* Dashboard — wired to Home Assistant via hass.
   - Lights: live state + brightness; toggle/set call light.* services
   - Speakers: live MA wrappers; toggle calls media_player.media_play/pause
   - Climate: live; ± buttons call climate.set_temperature
   - Cameras: stream via HA's media_player_proxy URL when available
   - Quick actions in the ribbon mass-call services across config groups */

function DashboardPage() {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  const [filter, setFilter] = React.useState("All");
  const [openCamera, setOpenCamera] = React.useState(null);

  // ─── Live device lists from config + hass state ─────────────────────────
  const lightEntries = React.useMemo(() => {
    const ids = new Set();
    const roomFor = {};
    for (const r of cfg.rooms) {
      for (const lid of (r.lights || [])) { ids.add(lid); roomFor[lid] = r.name; }
    }
    for (const lid of (cfg.globalLights || [])) { ids.add(lid); roomFor[lid] = roomFor[lid] || ""; }
    return [...ids].map(id => {
      const s = hass?.states?.[id];
      const a = s?.attributes || {};
      const rgb = a.rgb_color;
      return {
        id,
        name: a.friendly_name || id.split(".")[1].replace(/_/g, " "),
        room: roomFor[id] || "",
        on: s?.state === "on",
        brightness: Math.round(((a.brightness ?? 0) / 255) * 100),
        color: rgb ? `rgb(${rgb.join(",")})` : "#e8a850",
        entity: s,
      };
    });
  }, [hass, cfg]);

  const lightsOn = lightEntries.filter(l => l.on).length;

  const rooms = React.useMemo(() => {
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
        ctrl,
        playing: active?.state === "playing",
        track:   a.media_title || "",
        artist:  a.media_artist || "",
        art:     a.entity_picture || null,
        volume:  Math.round(((ctrl?.attributes?.volume_level ?? a.volume_level) ?? 0) * 100),
        state:   active?.state || "unavailable",
      };
    });
  }, [hass, cfg.rooms]);

  const playingCount = rooms.filter(r => r.playing).length;

  const climates = (cfg.climate || []).map(id => {
    const s = hass?.states?.[id];
    const a = s?.attributes || {};
    return {
      id, entity: s,
      name: a.friendly_name || id,
      room: id === "climate.hallway" ? "Whole house" : "",
      mode: s?.state || "off",
      current: a.current_temperature,
      target:  a.temperature,
      min: a.min_temp || 50,
      max: a.max_temp || 90,
      unit: a.temperature_unit || "F",
    };
  }).filter(c => c.entity);

  // Camera thumbnails use HA's auth/sign_path WS call to get a fresh
  // signed URL for /api/camera_proxy/<entity_id>. Plain camera_proxy URLs
  // (or even entity_picture's signed token) can fail inside the panel
  // depending on integration version, so signing per-load is the
  // most reliable approach. Re-sign every minute for tiles.
  const [signedUrls, setSignedUrls] = React.useState({});
  React.useEffect(() => {
    if (!hass) return;
    let cancelled = false;
    const refresh = async () => {
      const next = {};
      for (const id of (cfg.cameras || [])) {
        try {
          const r = await hass.callWS({
            type: "auth/sign_path",
            path: `/api/camera_proxy/${id}`,
            expires: 120,
          });
          if (r?.path) next[id] = r.path;
        } catch (_) { /* fall back to entity_picture or unsigned */ }
      }
      if (!cancelled) setSignedUrls(next);
    };
    refresh();
    const tickerId = setInterval(refresh, 60 * 1000);
    return () => { cancelled = true; clearInterval(tickerId); };
  }, [hass, JSON.stringify(cfg.cameras || [])]);

  const cameras = (cfg.cameras || []).map(id => {
    const s = hass?.states?.[id];
    const a = s?.attributes || {};
    const signed = signedUrls[id];
    const fallback = a.entity_picture || `/api/camera_proxy/${id}`;
    return {
      id, entity: s,
      name: a.friendly_name || id.split(".")[1].replace(/_/g, " "),
      thumb:    signed || fallback,
      // Raw API path for the modal to sign with its own faster ticker
      proxyPath: `/api/camera_proxy/${id}`,
    };
  }).filter(c => c.entity);

  // ─── Service helpers ────────────────────────────────────────────────────
  const svc = (service, data) => callService(hass, service, data);

  const toggleLight = (id) => {
    const s = hass?.states?.[id];
    svc(s?.state === "on" ? "light.turn_off" : "light.turn_on", { entity_id: id });
  };
  const setLightBrightness = (id, pct) => svc("light.turn_on", {
    entity_id: id,
    brightness_pct: pct,
  });
  const bumpThermo = (id, delta) => {
    const c = climates.find(cc => cc.id === id);
    if (!c) return;
    const next = Math.max(c.min, Math.min(c.max, (c.target || c.current || 70) + delta));
    svc("climate.set_temperature", { entity_id: id, temperature: next });
  };
  const togglePerRoom = (room) => {
    if (!room?.entity) return;
    svc(room.playing ? "media_player.media_pause" : "media_player.media_play", { entity_id: room.mediaPlayer });
  };
  const setRoomVolume = (room, v) => svc("media_player.volume_set", {
    entity_id: room.mediaPlayer, volume_level: v / 100,
  });

  // Quick actions
  const allOff = () => svc("light.turn_off", { entity_id: lightEntries.map(l => l.id) });
  const allOn  = () => svc("light.turn_on",  { entity_id: lightEntries.map(l => l.id) });
  const pauseAll = () => svc("media_player.media_pause", {
    entity_id: rooms.filter(r => r.playing).map(r => r.mediaPlayer),
  });
  const resumeAll = () => svc("media_player.media_play", {
    entity_id: rooms.filter(r => r.entity && !r.playing).map(r => r.mediaPlayer),
  });
  const goodnight = () => {
    if (lightEntries.length) svc("light.turn_off", { entity_id: lightEntries.map(l => l.id) });
    if (rooms.some(r => r.playing)) {
      svc("media_player.media_pause", { entity_id: rooms.filter(r => r.playing).map(r => r.mediaPlayer) });
    }
  };

  // ─── Filters ────────────────────────────────────────────────────────────
  const filters = [
    { key: "All",      icon: "grid",    count: lightEntries.length + cameras.length + climates.length + rooms.length },
    { key: "Lights",   icon: "bulb",    count: lightEntries.length },
    { key: "Cameras",  icon: "camera",  count: cameras.length },
    { key: "Climate",  icon: "thermo",  count: climates.length },
    { key: "Speakers", icon: "speaker", count: rooms.length },
  ];
  const show = (cat) => filter === "All" || filter === cat;

  if (!hass) {
    return <div className="page dash" style={{ padding: 40 }}>Connecting to Home Assistant…</div>;
  }

  return (
    <div className="page dash" data-screen-label="03 Dashboard">
      {/* Ribbon */}
      <div className="dash-ribbon">
        <button className="q" onClick={allOff}>
          <span className="dot" style={{ background: "#b6b4ac" }} /> All lights off
        </button>
        <button className="q" onClick={allOn}>
          <span className="dot" style={{ background: "#e8a850" }} /> All lights on
        </button>
        <button className="q" onClick={playingCount > 0 ? pauseAll : resumeAll}>
          <Icon name={playingCount > 0 ? "pause" : "play"} size={14} />
          {playingCount > 0 ? "Pause all music" : "Resume music"}
        </button>
        <button className="q" onClick={goodnight}>
          <Icon name="moon" size={14} /> Goodnight
        </button>
      </div>

      {/* Filters */}
      <div className="dash-filters">
        {filters.map(f => (
          <button
            key={f.key}
            className={"dash-filter" + (filter === f.key ? " active" : "")}
            onClick={() => setFilter(f.key)}
          >
            <Icon name={f.icon} size={13} /> {f.key}
            <span className="count">{f.count}</span>
          </button>
        ))}
      </div>

      {/* Lights */}
      {show("Lights") && lightEntries.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Lights</h2>
            <div className="meta">{lightsOn} of {lightEntries.length} on</div>
          </div>
          <div className="dash-grid">
            {lightEntries.map(l => (
              <div key={l.id} className={"tile light" + (l.on ? " on" : "")}>
                <div className="bulb-glow" style={{ background: `radial-gradient(circle, ${l.color}80, transparent 60%)` }} />
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div
                      className="tile-icon warm"
                      style={l.on ? { background: `${l.color}30`, color: l.color } : undefined}
                    >
                      <Icon name="bulb" />
                    </div>
                    <div>
                      <div className="tile-name">{l.name}</div>
                      <div className="tile-room">{l.room || "—"}</div>
                    </div>
                  </div>
                  <div className={"tile-toggle" + (l.on ? " on" : "")} onClick={() => toggleLight(l.id)} />
                </div>
                <div className="tslider">
                  <Icon name="sun" size={14} />
                  <input
                    className="range thin"
                    type="range" min="0" max="100"
                    value={l.brightness}
                    disabled={!l.on}
                    onChange={(e) => setLightBrightness(l.id, Number(e.target.value))}
                  />
                  <span className="pct">{l.brightness}%</span>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Speakers */}
      {show("Speakers") && rooms.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Speakers</h2>
            <div className="meta">{playingCount} playing</div>
          </div>
          <div className="dash-grid">
            {rooms.map(r => (
              <div key={r.id} className="tile speaker">
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <Avatar colors={r.color} size={38} />
                    <div>
                      <div className="tile-name">{r.name}</div>
                      <div className="tile-room">
                        {r.playing ? "Playing"
                          : r.state === "paused" ? "Paused"
                          : r.state === "unavailable" ? "Offline"
                          : "Idle"}
                      </div>
                    </div>
                  </div>
                  <div
                    className={"tile-toggle" + (r.playing ? " on" : "")}
                    onClick={() => togglePerRoom(r)}
                  />
                </div>
                {r.playing && r.track ? (
                  <div className="now-mini-row">
                    <div
                      className="ma"
                      style={r.art ? { backgroundImage: `url('${r.art}')`, backgroundSize: "cover" } : undefined}
                    />
                    <div className="meta">
                      <div className="ti">{r.track}</div>
                      <div className="ar">{r.artist}</div>
                    </div>
                    <button className="play-mini" onClick={() => togglePerRoom(r)}>
                      <Icon name="pause" size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {r.state === "unavailable" ? "Player offline" : "No audio · tap to resume last queue"}
                  </div>
                )}
                <div className="tslider">
                  <Icon name="volume" size={14} />
                  <input
                    className="range thin"
                    type="range" min="0" max="100"
                    value={r.volume}
                    disabled={!r.entity}
                    onChange={(e) => setRoomVolume(r, Number(e.target.value))}
                  />
                  <span className="pct">{r.volume}</span>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Climate */}
      {show("Climate") && climates.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Climate</h2>
            <div className="meta">
              {climates.map(c => `${c.mode} · ${c.current ?? "—"}°`).join(" · ")}
            </div>
          </div>
          <div className="dash-grid">
            {climates.map(c => {
              const pct = c.target != null
                ? (c.target - c.min) / (c.max - c.min)
                : 0;
              const C = 2 * Math.PI * 56;
              return (
                <div key={c.id} className="tile thermo">
                  <div className="tile-head">
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <div className="tile-icon warm"><Icon name="thermo" /></div>
                      <div>
                        <div className="tile-name">{c.name}</div>
                        <div className="tile-room">
                          {c.room || ""}{c.room ? " · " : ""}{c.mode}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="dial">
                    <svg viewBox="0 0 120 120">
                      <circle className="track" cx="60" cy="60" r="56" />
                      <circle
                        className="fill"
                        cx="60" cy="60" r="56"
                        strokeDasharray={C}
                        strokeDashoffset={C * (1 - pct)}
                      />
                    </svg>
                    <div className="center">
                      <div className="t">{c.target ?? "—"}°</div>
                      <div className="sub">{c.current ?? "—"}° now</div>
                    </div>
                  </div>
                  <div className="therm-row">
                    <button className="therm-btn" onClick={() => bumpThermo(c.id, -1)}>−</button>
                    <button className="therm-btn" onClick={() => bumpThermo(c.id, +1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      {/* Cameras */}
      {show("Cameras") && cameras.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Cameras</h2>
            <div className="meta">All live</div>
          </div>
          <div className="dash-grid">
            {cameras.map(c => (
              <div
                key={c.id}
                className="tile camera"
                onClick={() => setOpenCamera(c)}
                role="button"
                title={`Open ${c.name}`}
              >
                <div
                  className="feed"
                  style={{
                    backgroundImage: `url('${c.thumb}')`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundColor: "#1a1a1a",
                  }}
                />
                <div className="scan" />
                <div className="cam-head">
                  <div className="cam-name">{c.name}</div>
                  <span className="live">LIVE</span>
                </div>
                <div className="cam-foot">
                  <div className="cam-meta">{c.id.split(".")[1]}</div>
                  <button
                    style={{ color: "white", opacity: .8 }}
                    onClick={(e) => { e.stopPropagation(); setOpenCamera(c); }}
                    aria-label="Expand"
                  >
                    <Icon name="expand" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}
      <CameraDialog
        open={!!openCamera}
        camera={openCamera}
        hass={hass}
        onClose={() => setOpenCamera(null)}
      />
    </div>
  );
}

// Full-size camera live view. Re-signs the camera_proxy path every 2 seconds
// so each requested image carries a valid auth signature. Falls back to the
// entity_picture URL if auth/sign_path is unavailable.
function CameraDialog({ open, camera, hass, onClose }) {
  const [src, setSrc] = React.useState("");

  React.useEffect(() => {
    if (!open || !camera || !hass) return;
    let cancelled = false;
    const sign = async () => {
      try {
        const r = await hass.callWS({
          type: "auth/sign_path",
          path: camera.proxyPath || `/api/camera_proxy/${camera.id}`,
          expires: 30,
        });
        if (!cancelled && r?.path) {
          // Append a bust param so the <img> actually re-fetches when the
          // signed path itself happens to be unchanged within the window.
          setSrc(r.path + (r.path.includes("?") ? "&" : "?") + "_t=" + Date.now());
        }
      } catch {
        if (!cancelled) {
          const base = camera.thumb || `/api/camera_proxy/${camera.id}`;
          setSrc(base + (base.includes("?") ? "&" : "?") + "_t=" + Date.now());
        }
      }
    };
    sign();
    const id = setInterval(sign, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [open, camera, hass]);

  if (!open || !camera) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {camera.name}
            <span style={{ fontSize: 11, color: "#e1314a", marginLeft: 8, letterSpacing: ".14em" }}>● LIVE</span>
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ padding: 0, background: "#0a0a0a" }}>
          {src ? (
            <img
              src={src}
              alt={camera.name}
              style={{
                display: "block",
                width: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
                background: "#0a0a0a",
              }}
            />
          ) : (
            <div style={{
              minHeight: 360, display: "grid", placeItems: "center",
              color: "#777", background: "#0a0a0a",
            }}>
              Loading stream…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardPage });
