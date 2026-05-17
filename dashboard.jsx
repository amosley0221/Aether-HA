/* Dashboard — wired to Home Assistant via hass.
   - Lights: live state + brightness; toggle/set call light.* services
   - Speakers: live MA wrappers; toggle calls media_player.media_play/pause
   - Climate: live; ± buttons call climate.set_temperature
   - Cameras: stream via HA's media_player_proxy URL when available
   - Quick actions in the ribbon mass-call services across config groups */

function DashboardPage() {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;
  const hassRef = React.useRef(hass);
  hassRef.current = hass;

  const [filter, setFilter] = React.useState("All");
  const [openCamera, setOpenCamera] = React.useState(null);
  const [editMode, setEditMode] = React.useState(false);
  const [hiddenOpen, setHiddenOpen] = React.useState(false);

  // ─── Hidden devices + sections, persisted to HA user data ────────────
  const [hidden, setHidden]       = React.useState({ devices: [], sections: [] });
  const [hiddenLoaded, setHLoaded] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let initial = null;
      try {
        const r = await hassRef.current?.callWS({
          type: "frontend/get_user_data",
          key:  "aether_hidden",
        });
        if (r?.value && typeof r.value === "object") initial = r.value;
      } catch {}
      if (initial == null) {
        try {
          const stored = localStorage.getItem("aether_hidden");
          if (stored) initial = JSON.parse(stored);
        } catch {}
      }
      if (!cancelled) {
        setHidden({
          devices:  Array.isArray(initial?.devices)  ? initial.devices  : [],
          sections: Array.isArray(initial?.sections) ? initial.sections : [],
        });
        setHLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveHidden = async (next) => {
    setHidden(next);
    try { localStorage.setItem("aether_hidden", JSON.stringify(next)); } catch {}
    try {
      await hassRef.current?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_hidden",
        value: next,
      });
    } catch {}
  };
  const hideDevice  = (id)   => saveHidden({ ...hidden, devices:  [...new Set([...hidden.devices,  id])]   });
  const showDevice  = (id)   => saveHidden({ ...hidden, devices:  hidden.devices.filter(x => x !== id)     });
  const hideSection = (name) => saveHidden({ ...hidden, sections: [...new Set([...hidden.sections, name])] });
  const showSection = (name) => saveHidden({ ...hidden, sections: hidden.sections.filter(x => x !== name)  });
  const isHidden    = (id)   => hidden.devices.includes(id);
  const isHiddenSec = (name) => hidden.sections.includes(name);

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

  // Visible (post-hidden-filter) lists used for rendering. Counts for the
  // filter pills also reflect what's actually visible.
  const visLights  = lightEntries.filter(l => !isHidden(l.id));
  const visRooms   = rooms.filter(r => !isHidden(r.mediaPlayer) && !isHidden(r.id));

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

  // Camera thumbnails use HA's pre-signed entity_picture URL (already
  // contains a valid token in the query string). A short tick refreshes
  // the snapshot every 10s by appending an ?hc= cache-buster. We do
  // NOT call auth/sign_path or /api/camera_proxy/ — those return 500
  // on some camera integrations. Live view uses WebRTC over the HA
  // WebSocket instead (see CameraStream).
  const [tileTick, setTileTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTileTick((t) => t + 1), 10 * 1000);
    return () => clearInterval(id);
  }, []);

  const cameras = (cfg.cameras || []).map(id => {
    const s = hass?.states?.[id];
    const a = s?.attributes || {};
    const pic = a.entity_picture;
    return {
      id, entity: s,
      name: a.friendly_name || id.split(".")[1].replace(/_/g, " "),
      picture: pic,
      thumb:   pic ? `${pic}${pic.includes("?") ? "&" : "?"}hc=${tileTick}` : null,
      online:  s?.state !== "unavailable",
    };
  }).filter(c => c.entity);

  // Post-filter visible arrays for rendering
  const vCameras  = cameras.filter(c => !isHidden(c.id));
  const vClimates = climates.filter(c => !isHidden(c.id));

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

  // ─── Car (Tesla) ───────────────────────────────────────────────────────
  const carCfg = cfg.car;
  const hasCar = carCfg && hass?.states?.[carCfg.entities?.lock];
  const tvCfg = cfg.appleTV;
  const hasTV = tvCfg && tvCfg.remote && hass?.states?.[tvCfg.remote];
  // LG TVs: support both legacy single-TV (cfg.lgTV) and new array
  // (cfg.lgTVs) configs. Each TV needs a mediaPlayer that exists in
  // hass.states; the optional `remote` entity is preferred for d-pad
  // keys but without it the section falls back to webostv.button.
  const lgList = (Array.isArray(cfg.lgTVs) && cfg.lgTVs.length)
    ? cfg.lgTVs
    : (cfg.lgTV ? [cfg.lgTV] : []);
  const visibleLgTvs = lgList.filter(
    (t) => t && t.mediaPlayer && hass?.states?.[t.mediaPlayer]
  );
  const hasLG = visibleLgTvs.length > 0;

  // ─── Filters ────────────────────────────────────────────────────────────
  // Counts and visibility reflect post-hidden lists. A section is only
  // rendered if not in hidden.sections AND it has at least one visible item.
  const filters = [
    { key: "All",      icon: "grid",    count: (hasCar ? 1 : 0) + (hasTV ? 1 : 0) + visibleLgTvs.length + visLights.length + vCameras.length + vClimates.length + visRooms.length },
    ...(hasCar ? [{ key: "Car", icon: "car", count: 1 }] : []),
    ...((hasTV || hasLG) ? [{ key: "TV", icon: "tv", count: (hasTV ? 1 : 0) + visibleLgTvs.length }] : []),
    { key: "Lights",   icon: "bulb",    count: visLights.length },
    { key: "Cameras",  icon: "camera",  count: vCameras.length },
    { key: "Climate",  icon: "thermo",  count: vClimates.length },
    { key: "Speakers", icon: "speaker", count: visRooms.length },
  ];
  const show = (cat) => (filter === "All" || filter === cat) && !isHiddenSec(cat);

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
        <button
          className={"q" + (editMode ? " on" : "")}
          onClick={() => setEditMode(!editMode)}
          style={{ marginLeft: "auto" }}
        >
          <Icon name={editMode ? "lock" : "settings"} size={14} /> {editMode ? "Done" : "Edit"}
        </button>
        {hiddenLoaded && (hidden.devices.length > 0 || hidden.sections.length > 0) && (
          <button className="q" onClick={() => setHiddenOpen(true)}>
            Hidden · {hidden.devices.length + hidden.sections.length}
          </button>
        )}
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

      {/* Car (Tesla) */}
      {show("Car") && hasCar && (
        <CarSection
          car={carCfg}
          hass={hass}
          editMode={editMode}
          onHideSection={() => hideSection("Car")}
        />
      )}

      {/* Apple TV */}
      {show("TV") && hasTV && (
        <AppleTVSection
          tv={tvCfg}
          hass={hass}
          editMode={editMode}
          onHideSection={() => hideSection("TV")}
        />
      )}

      {/* LG webOS TVs (one section per configured TV/monitor) */}
      {show("TV") && visibleLgTvs.map((lg, i) => (
        <LGTVSection
          key={lg.mediaPlayer || i}
          tv={lg}
          hass={hass}
          editMode={editMode}
          onHideSection={() => hideSection("TV")}
        />
      ))}

      {/* Lights */}
      {show("Lights") && visLights.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Lights</h2>
            <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span>{visLights.filter(l => l.on).length} of {visLights.length} on</span>
              {editMode && (
                <button className="section-hide-btn" onClick={() => hideSection("Lights")}>Hide section</button>
              )}
            </div>
          </div>
          <div className="dash-grid">
            {visLights.map(l => (
              <div key={l.id} className={"tile light" + (l.on ? " on" : "")}>
                {editMode && (
                  <button className="tile-hide" onClick={(e) => { e.stopPropagation(); hideDevice(l.id); }} aria-label="Hide">×</button>
                )}
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
      {show("Speakers") && visRooms.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Speakers</h2>
            <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span>{visRooms.filter(r => r.playing).length} playing</span>
              {editMode && (
                <button className="section-hide-btn" onClick={() => hideSection("Speakers")}>Hide section</button>
              )}
            </div>
          </div>
          <div className="dash-grid">
            {visRooms.map(r => (
              <div key={r.id} className="tile speaker">
                {editMode && (
                  <button className="tile-hide" onClick={(e) => { e.stopPropagation(); hideDevice(r.mediaPlayer); }} aria-label="Hide">×</button>
                )}
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
      {show("Climate") && vClimates.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Climate</h2>
            <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span>{vClimates.map(c => `${c.mode} · ${c.current ?? "—"}°`).join(" · ")}</span>
              {editMode && (
                <button className="section-hide-btn" onClick={() => hideSection("Climate")}>Hide section</button>
              )}
            </div>
          </div>
          <div className="dash-grid">
            {vClimates.map(c => {
              const pct = c.target != null
                ? (c.target - c.min) / (c.max - c.min)
                : 0;
              const C = 2 * Math.PI * 56;
              return (
                <div key={c.id} className="tile thermo">
                  {editMode && (
                    <button className="tile-hide" onClick={(e) => { e.stopPropagation(); hideDevice(c.id); }} aria-label="Hide">×</button>
                  )}
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
      {show("Cameras") && vCameras.length > 0 && (
        <React.Fragment>
          <div className="dash-section-head">
            <h2>Cameras</h2>
            <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span>All live</span>
              {editMode && (
                <button className="section-hide-btn" onClick={() => hideSection("Cameras")}>Hide section</button>
              )}
            </div>
          </div>
          <div className="dash-grid">
            {vCameras.map(c => (
              <div
                key={c.id}
                className="tile camera"
                onClick={() => !editMode && setOpenCamera(c)}
                role="button"
                title={`Open ${c.name}`}
              >
                {editMode && (
                  <button className="tile-hide" onClick={(e) => { e.stopPropagation(); hideDevice(c.id); }} aria-label="Hide">×</button>
                )}
                <div
                  className="feed"
                  style={{
                    backgroundImage: c.thumb ? `url('${c.thumb}')` : "none",
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

      <HiddenManagerDialog
        open={hiddenOpen}
        onClose={() => setHiddenOpen(false)}
        hidden={hidden}
        hass={hass}
        showDevice={showDevice}
        showSection={showSection}
      />
    </div>
  );
}

// Lists every device/section currently hidden so the user can bring
// them back. Friendly names come from hass.states attributes.
function HiddenManagerDialog({ open, onClose, hidden, hass, showDevice, showSection }) {
  const scrollTop = useModalAnchor(open);
  if (!open) return null;
  const sections = hidden.sections || [];
  const devices  = (hidden.devices || []).map((id) => ({
    id,
    name: hass?.states?.[id]?.attributes?.friendly_name
       || id.split(".")[1]?.replace(/_/g, " ")
       || id,
  }));

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Hidden items</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {sections.length === 0 && devices.length === 0 ? (
            <div className="lib-status">Nothing hidden.</div>
          ) : (
            <>
              {sections.length > 0 && (
                <>
                  <div style={{
                    fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em",
                    color: "var(--ink-3)", fontWeight: 600, marginBottom: 8,
                  }}>Sections</div>
                  {sections.map((s) => (
                    <div key={s} className="eq-row">
                      <span className="eq-label">{s}</span>
                      <button className="modal-btn" onClick={() => showSection(s)}>Show</button>
                    </div>
                  ))}
                </>
              )}
              {devices.length > 0 && (
                <>
                  <div style={{
                    fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em",
                    color: "var(--ink-3)", fontWeight: 600, marginTop: 16, marginBottom: 8,
                  }}>Devices</div>
                  {devices.map((d) => (
                    <div key={d.id} className="eq-row">
                      <span className="eq-label">{d.name}</span>
                      <button className="modal-btn" onClick={() => showDevice(d.id)}>Show</button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Full-size camera live view. Plays actual video via WebRTC (Ring, Nest,
// go2rtc, Reolink and most modern integrations) with HLS fallback for
// stream-only cameras. All transport negotiation happens over the HA
// WebSocket (hass.connection) — no REST hits to camera_proxy, no
// auth/sign_path, because both are 500-erroring on this install while
// the WS-based approach works (verified against the other dashboard).
function CameraDialog({ open, camera, hass, onClose }) {
  const scrollTop = useModalAnchor(open);
  if (!open || !camera) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {camera.name}
            <span style={{ fontSize: 11, color: "#e1314a", marginLeft: 8, letterSpacing: ".14em" }}>● LIVE</span>
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ padding: 0, background: "#0a0a0a" }}>
          <CameraStream entityId={camera.id} hass={hass} poster={camera.picture} />
        </div>
      </div>
    </div>
  );
}

// Live camera <video> player. Transport ladder, in order of preference:
//   1. camera/webrtc/offer (subscribe stream — modern WebRTC, ICE)
//   2. camera/web_rtc_offer (legacy single-shot WebRTC)
//   3. camera/stream { format: 'hls' } (HLS, native on Safari, hls.js elsewhere)
// First transport whose video element receives a frame within 6s wins.
// Snapshot from entity_picture is shown as a poster behind <video> while
// it negotiates so the modal never looks blank.
function CameraStream({ entityId, hass, poster }) {
  const videoRef = React.useRef(null);
  const [status, setStatus] = React.useState("loading"); // loading | playing | error
  const [err, setErr]       = React.useState(null);

  React.useEffect(() => {
    if (!entityId || !hass?.connection) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let teardown = null;
    setStatus("loading");
    setErr(null);

    (async () => {
      for (const method of [tryWebRTCSubscribe, tryWebRTCLegacy, tryHLS]) {
        if (cancelled) return;
        try {
          const dispose = await method({ entityId, hass, video });
          if (cancelled) { try { dispose?.(); } catch {} return; }
          try {
            await waitForFirstFrame(video, 6000);
            teardown = dispose;
            if (!cancelled) setStatus("playing");
            return;
          } catch (_) {
            try { dispose?.(); } catch {}
          }
        } catch (e) {
          console.warn(`[aether] camera transport ${method.name} failed:`, e?.message || e);
        }
      }
      if (!cancelled) {
        setStatus("error");
        setErr("All stream transports failed — camera may not support WebRTC or HLS.");
      }
    })();

    return () => {
      cancelled = true;
      try { teardown?.(); } catch {}
      try {
        const v = videoRef.current;
        if (v) {
          v.srcObject = null;
          v.removeAttribute("src");
          v.load();
        }
      } catch {}
    };
  }, [entityId, hass]);

  const showPoster = status !== "playing" && poster;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "55vh",
        maxHeight: "70vh",
        minHeight: 320,
        background: "#0a0a0a",
        backgroundImage: showPoster ? `url('${poster}')` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "transparent",
          display: "block",
        }}
      />
      {status === "loading" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "grid", placeItems: "center",
          color: "rgba(255,255,255,.85)",
          fontSize: 13,
          background: "rgba(0,0,0,.35)",
          pointerEvents: "none",
        }}>
          Connecting…
        </div>
      )}
      {status === "error" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "grid", placeItems: "center",
          color: "rgba(255,255,255,.85)",
          fontSize: 12,
          background: "rgba(0,0,0,.55)",
          padding: 24, textAlign: "center",
        }}>
          <div>
            <div style={{ color: "#ff9080", fontWeight: 600, marginBottom: 6 }}>Stream unavailable</div>
            <div style={{ opacity: .8 }}>{err}</div>
          </div>
        </div>
      )}
    </div>
  );
}

async function tryWebRTCSubscribe({ entityId, hass, video }) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  try {
    const cfg = await hass.connection.sendMessagePromise({
      type: "camera/webrtc/get_client_config", entity_id: entityId,
    });
    if (cfg?.configuration) pc.setConfiguration(cfg.configuration);
  } catch {}

  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => {
    if (e.streams?.[0]) video.srcObject = e.streams[0];
  };

  let sessionId = null;
  pc.onicecandidate = async (e) => {
    if (!e.candidate || !sessionId) return;
    try {
      await hass.connection.sendMessagePromise({
        type: "camera/webrtc/candidate",
        entity_id: entityId,
        session_id: sessionId,
        candidate: e.candidate.toJSON(),
      });
    } catch {}
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const unsubscribe = await hass.connection.subscribeMessage(
    async (msg) => {
      try {
        if (msg.type === "session") sessionId = msg.session_id;
        else if (msg.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.answer }));
        } else if (msg.type === "candidate" && msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else if (msg.type === "error") {
          console.warn("[aether] webrtc subscribe error:", msg);
        }
      } catch (e) {
        console.warn("[aether] webrtc msg handler:", e);
      }
    },
    { type: "camera/webrtc/offer", entity_id: entityId, offer: offer.sdp }
  );

  return () => { try { unsubscribe(); } catch {} try { pc.close(); } catch {} };
}

async function tryWebRTCLegacy({ entityId, hass, video }) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => {
    if (e.streams?.[0]) video.srcObject = e.streams[0];
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const resp = await hass.connection.sendMessagePromise({
    type: "camera/web_rtc_offer",
    entity_id: entityId,
    offer: offer.sdp,
  });
  if (!resp?.answer) throw new Error("no answer from web_rtc_offer");
  await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: resp.answer }));
  return () => { try { pc.close(); } catch {} };
}

async function tryHLS({ entityId, hass, video }) {
  const resp = await hass.connection.sendMessagePromise({
    type: "camera/stream",
    entity_id: entityId,
    format: "hls",
  });
  if (!resp?.url) throw new Error("no stream URL");
  const url = resp.url;

  // Safari / iOS plays HLS natively
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return () => { try { video.removeAttribute("src"); video.load(); } catch {} };
  }

  // Everywhere else: load hls.js on demand (cached after first time)
  if (!window.Hls) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js";
      s.onload = res;
      s.onerror = () => rej(new Error("hls.js failed to load"));
      document.head.appendChild(s);
    });
  }
  const hls = new window.Hls();
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => { try { hls.destroy(); } catch {} };
}

function waitForFirstFrame(video, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener("loadeddata", onFrame);
      video.removeEventListener("playing", onFrame);
      clearTimeout(t);
    };
    const onFrame = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    video.addEventListener("loadeddata", onFrame);
    video.addEventListener("playing", onFrame);
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("first frame timeout"));
    }, timeout);
  });
}

// ─── Car (Tesla) section ─────────────────────────────────────────────────
function CarSection({ car, hass, editMode, onHideSection }) {
  const e = car.entities;
  const s = (id) => hass?.states?.[id];
  const state = (id) => s(id)?.state;
  const attr  = (id, k) => s(id)?.attributes?.[k];
  const num   = (id) => {
    const v = parseFloat(state(id));
    return Number.isFinite(v) ? v : null;
  };

  const battery        = num(e.battery);
  const range          = num(e.range);
  const inside         = num(e.inside);
  const outside        = num(e.outside);
  const speed          = num(e.speed) ?? 0;
  const odometer       = num(e.odometer);
  const timeToFull     = num(e.timeToFullCharge);
  const charging       = /^(charging|starting)$/i.test(state(e.chargingState) || "");
  const isLocked       = state(e.lock) === "locked";
  const climateState   = s(e.climate);
  const climateOn      = climateState && climateState.state !== "off" && climateState.state !== "unavailable";
  const climateTarget  = climateState?.attributes?.temperature;
  const sentryOn       = state(e.sentry) === "on";
  const defrostOn      = state(e.defrost) === "on";
  const cableConnected = state(e.chargeCableConnected) === "on";
  const shift          = state(e.shiftState);
  const isDriving      = speed > 0 || (shift && shift !== "P" && shift !== "unknown");

  // Door / cover state — frunk and trunk are HA covers, doors are binary
  // sensors that read "on" when open. Charge port is also a cover.
  const doors = e.doors || {};
  const doorOpen = {
    frontDriver:    state(doors.frontDriver)    === "on",
    frontPassenger: state(doors.frontPassenger) === "on",
    rearDriver:     state(doors.rearDriver)     === "on",
    rearPassenger:  state(doors.rearPassenger)  === "on",
  };
  const frunkOpen       = state(e.frunk)      === "open";
  const trunkOpen       = state(e.trunk)      === "open";
  const chargePortOpen  = state(e.chargePort) === "open";
  const ventWindowsOpen = state(e.ventWindows) === "open";

  const openParts = [];
  if (doorOpen.frontDriver)    openParts.push("Driver door");
  if (doorOpen.frontPassenger) openParts.push("Passenger door");
  if (doorOpen.rearDriver)     openParts.push("Rear-left door");
  if (doorOpen.rearPassenger)  openParts.push("Rear-right door");
  if (frunkOpen)               openParts.push("Frunk");
  if (trunkOpen)               openParts.push("Trunk");
  if (ventWindowsOpen)         openParts.push("Windows vented");
  const anyOpen = openParts.length > 0;

  const svc = (service, data) => callService(hass, service, data);
  const toggle = (entityId, on) => svc(on ? "switch.turn_off" : "switch.turn_on", { entity_id: entityId });
  const toggleLock = () => svc(isLocked ? "lock.unlock" : "lock.lock", { entity_id: e.lock });
  const toggleClimate = () => svc(climateOn ? "climate.turn_off" : "climate.turn_on", { entity_id: e.climate });
  const toggleChargePort = () => svc("cover.toggle", { entity_id: e.chargePort });
  const openFrunk = () => svc("cover.open_cover", { entity_id: e.frunk });
  const openTrunk = () => svc("cover.open_cover", { entity_id: e.trunk });

  const batteryColor = charging ? "var(--accent)"
                     : battery == null    ? "var(--ink-4)"
                     : battery < 20       ? "#e1314a"
                     : battery < 50       ? "#c97a52"
                     : "#2f8f63";

  return (
    <>
      <div className="dash-section-head">
        <h2>Car</h2>
        <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>
            {car.name}
            {isDriving ? ` · Driving ${Math.round(speed)} mph` :
              cableConnected && charging ? ` · Charging${timeToFull ? ` · ${timeToFull.toFixed(1)}h to full` : ""}` :
              cableConnected ? " · Plugged in" :
              isLocked ? " · Parked" : " · Parked · Unlocked"}
          </span>
          {editMode && (
            <button className="section-hide-btn" onClick={onHideSection}>Hide section</button>
          )}
        </div>
      </div>

      <div className="car-card">
        <div className="car-card-image">
          {car.model3d ? (
            <CarModel3D
              src={car.model3d}
              alt={`${car.year} ${car.model}`}
              doors={doorOpen}
              frunk={frunkOpen}
              trunk={trunkOpen}
              chargePort={chargePortOpen}
            />
          ) : car.image ? (
            <img src={car.image} alt={`${car.year} ${car.model}`} />
          ) : (
            <TeslaModel3SVG />
          )}
        </div>

        <div className="car-card-body">
          <div className="car-name-row">
            <div>
              <div className="car-name">{car.name}</div>
              <div className="car-sub">{car.year} {car.model} · {car.color}{car.wheels ? ` · ${car.wheels}` : ""}</div>
            </div>
            <div className="car-status-badges">
              {!isLocked       && <span className="car-badge warn">Unlocked</span>}
              {sentryOn        && <span className="car-badge accent">Sentry</span>}
              {charging        && <span className="car-badge ok">⚡ Charging</span>}
              {!charging && cableConnected && <span className="car-badge">Plugged in</span>}
              {openParts.map((p) => (
                <span key={p} className="car-badge alert">{p}</span>
              ))}
            </div>
          </div>

          <div className="car-battery">
            <div className="car-battery-track">
              <div className="car-battery-fill" style={{
                width: `${battery ?? 0}%`,
                background: batteryColor,
              }} />
            </div>
            <div className="car-battery-text">
              <span className="car-battery-pct">{battery != null ? `${Math.round(battery)}%` : "—"}</span>
              {range != null && <span className="car-battery-range">{Math.round(range)} mi</span>}
            </div>
          </div>

          <div className="car-stats-row">
            {inside != null && (
              <div className="car-stat">
                <span className="car-stat-lbl">Inside</span>
                <span className="car-stat-val">{Math.round(inside)}°</span>
              </div>
            )}
            {outside != null && (
              <div className="car-stat">
                <span className="car-stat-lbl">Outside</span>
                <span className="car-stat-val">{Math.round(outside)}°</span>
              </div>
            )}
            {climateTarget != null && (
              <div className="car-stat">
                <span className="car-stat-lbl">Target</span>
                <span className="car-stat-val">{Math.round(climateTarget)}°</span>
              </div>
            )}
            {odometer != null && (
              <div className="car-stat">
                <span className="car-stat-lbl">Odometer</span>
                <span className="car-stat-val">{Math.round(odometer).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="car-actions">
            <button className={"car-btn" + (isLocked ? " on" : "")} onClick={toggleLock}>
              <Icon name={isLocked ? "lock" : "unlock"} size={14} />
              {isLocked ? "Locked" : "Lock"}
            </button>
            <button className={"car-btn" + (climateOn ? " on" : "")} onClick={toggleClimate}>
              <Icon name="thermo" size={14} /> Climate
            </button>
            <button className={"car-btn" + (defrostOn ? " on" : "")} onClick={() => toggle(e.defrost, defrostOn)}>
              <Icon name="sparkle" size={14} /> Defrost
            </button>
            <button className={"car-btn" + (sentryOn ? " on" : "")} onClick={() => toggle(e.sentry, sentryOn)}>
              <Icon name="camera" size={14} /> Sentry
            </button>
            <button className="car-btn" onClick={toggleChargePort}>
              <Icon name="bolt" size={14} /> Charge port
            </button>
            <button className="car-btn" onClick={openFrunk}>
              <Icon name="grid" size={14} /> Frunk
            </button>
            <button className="car-btn" onClick={openTrunk}>
              <Icon name="grid" size={14} /> Trunk
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Apple TV remote ──────────────────────────────────────────────────────
// Controls an Apple TV via HA's Apple TV integration. Trackpad swipes
// translate into discrete d-pad commands (one step per ~40px of motion);
// tapping the pad fires `select`. App shortcuts launch via
// media_player.play_media with the iOS bundle ID, which is the
// pyatv-supported path even when source_list is empty. Volume slider
// drives the configured speaker (usually the Sonos soundbar the ATV
// outputs to via HDMI ARC).

// Brand-color tile glyphs for popular Apple TV apps. Keyed primarily by
// bundle ID; named keys (lowercase) act as a fallback so the lookup
// still works for entries that only specify `source` or for custom
// `iconKey` overrides.
const TV_APP_ICONS = {
  "com.netflix.netflix": {
    bg: "#000000",
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 2v20l3-.4v-9.2L14.5 22 18 21.5V2l-3 .4v9.2L9.4 2 6 2z" fill="#E50914"/></svg>
    ),
  },
  "com.google.ios.youtube": {
    bg: "#ffffff",
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22"><rect x="2" y="6" width="20" height="12" rx="4" fill="#FF0000"/><path d="M10 9.5v5l4.5-2.5z" fill="white"/></svg>
    ),
    border: "1px solid #e5e7eb",
  },
  "com.google.ios.youtubeunplugged": {
    bg: "#ffffff",
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22"><rect x="2" y="6" width="20" height="12" rx="4" fill="#FF0000"/><path d="M9 9.5v5l4-2.5z" fill="white"/><text x="14.5" y="14.5" font-size="5.5" font-weight="700" fill="white" font-family="-apple-system,Helvetica,Arial">TV</text></svg>
    ),
    border: "1px solid #e5e7eb",
  },
  "tv.twitch": {
    bg: "#9146FF",
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 4v14h4v3l3-3h4l5-5V4H4zm14 8l-3 3h-3l-3 3v-3H6V6h12v6zm-7-5v5m4-5v5" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/></svg>
    ),
  },
  "com.plexapp.plex": {
    bg: "#1F2326",
    glyph: (
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l7 9-7 9h5l7-9-7-9z" fill="#EBAF00"/></svg>
    ),
  },
  "com.apple.tvairplayreceiver": {
    bg: "#0a84ff",
    glyph: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 15h12l-6-7z" fill="white"/></svg>,
  },
  // Named fallbacks (lowercase) — match if config doesn't provide bundleId
  netflix:   { ref: "com.netflix.netflix" },
  youtube:   { ref: "com.google.ios.youtube" },
  "youtube tv": { ref: "com.google.ios.youtubeunplugged" },
  twitch:    { ref: "tv.twitch" },
  plex:      { ref: "com.plexapp.plex" },
};

function resolveAppIcon(app) {
  const tryKeys = [
    app.iconKey,
    (app.bundleId || "").toLowerCase(),
    (app.name || "").toLowerCase(),
  ].filter(Boolean);
  for (const k of tryKeys) {
    const hit = TV_APP_ICONS[k];
    if (!hit) continue;
    if (hit.ref) return TV_APP_ICONS[hit.ref] || null;
    return hit;
  }
  return null;
}

// Trackpad: maps swipe gestures to discrete remote d-pad commands.
// Each ~40px of motion in a dominant axis fires one step; resetting
// the origin after each step lets a single long swipe send multiple
// presses (mirrors the Siri Remote app on iPhone). A short tap with
// no movement fires `select`.
function TVTrackpad({ onCmd, onSelect }) {
  const start  = React.useRef(null);
  const origin = React.useRef(null);
  const lastDir = React.useRef(null);
  const STEP = 40;
  const TAP_MAX_DIST = 12;
  const TAP_MAX_MS   = 350;

  const begin = (x, y) => {
    start.current  = { x, y, t: Date.now() };
    origin.current = { x, y };
    lastDir.current = null;
  };
  const move = (x, y) => {
    if (!origin.current) return;
    const dx = x - origin.current.x;
    const dy = y - origin.current.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > STEP && ax >= ay) {
      const dir = dx > 0 ? "right" : "left";
      onCmd(dir);
      lastDir.current = dir;
      origin.current = { x, y };
    } else if (ay > STEP && ay > ax) {
      const dir = dy > 0 ? "down" : "up";
      onCmd(dir);
      lastDir.current = dir;
      origin.current = { x, y };
    }
  };
  const end = (x, y) => {
    if (!start.current) return;
    const dt   = Date.now() - start.current.t;
    const dist = Math.hypot(x - start.current.x, y - start.current.y);
    if (!lastDir.current && dist < TAP_MAX_DIST && dt < TAP_MAX_MS) {
      onSelect();
    }
    start.current = null;
    origin.current = null;
    lastDir.current = null;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    begin(e.clientX, e.clientY);
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    e.preventDefault();
    move(e.clientX, e.clientY);
  };
  const onPointerUp = (e) => {
    end(e.clientX, e.clientY);
  };

  return (
    <div
      className="atv-touchpad"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { start.current = null; origin.current = null; lastDir.current = null; }}
    >
      <div className="atv-tp-ring">
        <span className="atv-tp-arrow atv-tp-up">▲</span>
        <span className="atv-tp-arrow atv-tp-down">▼</span>
        <span className="atv-tp-arrow atv-tp-left">◀</span>
        <span className="atv-tp-arrow atv-tp-right">▶</span>
        <span className="atv-tp-center">Tap to select</span>
      </div>
    </div>
  );
}

function AppleTVSection({ tv, hass, editMode, onHideSection }) {
  const remoteId = tv.remote;
  const mpId     = tv.mediaPlayer;
  const volId    = tv.volumePlayer || mpId;
  const mp       = hass?.states?.[mpId];
  const vol      = hass?.states?.[volId];
  const remote   = hass?.states?.[remoteId];

  const apps = tv.apps || [];
  const installed = mp?.attributes?.source_list || [];
  const currentSource  = mp?.attributes?.source;
  const currentAppId   = mp?.attributes?.app_id;
  const currentAppName = mp?.attributes?.app_name;

  const playing = mp?.state === "playing";
  const off     = remote?.state === "off" || mp?.state === "off" || mp?.state === "standby" || mp?.state === "unavailable";

  const send = async (cmd) => {
    if (!remoteId) return;
    try {
      await callService(hass, "remote.send_command",
        { entity_id: remoteId, command: cmd });
    } catch (e) { console.warn("[aether tv] send_command failed:", e); }
  };
  const launchApp = async (app) => {
    if (!mpId) return;
    try {
      if (app.bundleId) {
        await callService(hass, "media_player.play_media", {
          entity_id: mpId,
          media_content_type: "app",
          media_content_id: app.bundleId,
        });
      } else if (app.source) {
        await callService(hass, "media_player.select_source",
          { entity_id: mpId, source: app.source });
      }
    } catch (e) { console.warn("[aether tv] launch failed:", e); }
  };
  const togglePower = async () => {
    if (!mpId) return;
    try {
      await callService(hass, off ? "media_player.turn_on" : "media_player.turn_off",
        { entity_id: mpId });
    } catch (e) { console.warn("[aether tv] power failed:", e); }
  };
  const setVolume = (v) => {
    if (!volId) return;
    callService(hass, "media_player.volume_set",
      { entity_id: volId, volume_level: v / 100 });
  };
  const toggleMute = () => {
    if (!volId) return;
    callService(hass, "media_player.volume_mute",
      { entity_id: volId, is_volume_muted: !vol?.attributes?.is_volume_muted });
  };

  const volumeLevel = Math.round(((vol?.attributes?.volume_level) ?? 0) * 100);
  const volumeMuted = !!vol?.attributes?.is_volume_muted;
  // The Apple TV integration's app_id / app_name attributes can lag well
  // behind reality (often stuck on whatever app was open last), so we
  // don't surface them — better blank than wrong. media_title is more
  // reliable when something is actively playing.
  const title    = mp?.attributes?.media_title || (off ? "Off" : "Apple TV");
  const subtitle = [mp?.attributes?.media_artist, mp?.attributes?.media_album_name]
                     .filter(Boolean).join(" · ");

  return (
    <>
      <div className="dash-section-head">
        <h2>Apple TV</h2>
        <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{off ? "Off" : (playing ? "Playing" : "On")}</span>
          {editMode && (
            <button className="section-hide-btn" onClick={onHideSection}>Hide section</button>
          )}
        </div>
      </div>

      <div className="atv-tile">
        <div className="atv-tile-head">
          <div className="atv-brand">
            <span className="atv-brand-glyph">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.4 12.5c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2-.1 1.6-.8 3-.8s1.8.8 3 .8c1.2 0 2-1.1 2.8-2.3.9-1.3 1.2-2.6 1.2-2.6-.1 0-2.4-.9-2.4-3.7zM14.2 5.5c.6-.8 1.1-2 .9-3.1-1 .1-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.3-.6 3-1.4z" fill="currentColor"/></svg>
            </span>
            <div className="atv-brand-text">
              <div className="atv-title">{title}</div>
              {subtitle && <div className="atv-subtitle">{subtitle}</div>}
            </div>
          </div>
          <button
            className={"atv-power" + (off ? " off" : "")}
            onClick={togglePower}
            title={off ? "Turn on" : "Turn off"}
          >
            <Icon name="power" size={16} />
          </button>
        </div>

        <div className="atv-volume">
          <button className="atv-mute" onClick={toggleMute} title={volumeMuted ? "Unmute" : "Mute"}>
            <Icon name="volume" size={14} />
          </button>
          <input
            type="range" min="0" max="100" value={volumeLevel}
            onChange={(e) => setVolume(Number(e.target.value))}
            disabled={!volId}
          />
          <span className="atv-vol-pct">{volumeMuted ? "Muted" : `${volumeLevel}%`}</span>
        </div>

        <div className="atv-apps-grid">
          {apps.map(app => {
            const exists = !app.source || installed.length === 0 || installed.includes(app.source);
            const icon = resolveAppIcon(app);
            return (
              <button
                key={app.name}
                className="atv-app-tile"
                onClick={() => launchApp(app)}
                disabled={!exists}
                title={exists ? `Launch ${app.name}` : `${app.source} not found in Apple TV's source list`}
              >
                <span
                  className="atv-app-icon"
                  style={icon ? { background: icon.bg, border: icon.border || "0" }
                              : { background: "#1f2326" }}
                >
                  {icon?.glyph || <span className="atv-app-initial">{(app.name || "?").slice(0,1)}</span>}
                </span>
                <span className="atv-app-name">{app.name}</span>
              </button>
            );
          })}
        </div>

        <TVTrackpad onCmd={send} onSelect={() => send("select")} />

        <div className="atv-controls">
          <button className="atv-ctrl" onClick={() => send("menu")} title="Back / Menu">
            <Icon name="back" size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("home")} title="Home (TV button)">
            <Icon name="tv" size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("play_pause")} title="Play / Pause">
            <Icon name={playing ? "pause" : "play"} size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("siri")} title="Siri">
            <Icon name="mic" size={18}/>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── LG webOS TV remote ────────────────────────────────────────────────────
// Same shape as the Apple TV section, but:
//   • App and input switching go through media_player.select_source
//     against the strings in the TV's source_list (LG mixes both apps
//     and inputs in one list).
//   • Volume is set on the TV's own media_player entity - the TV drives
//     the connected soundbar via HDMI ARC or optical, independent of any
//     Sonos in the same room.
//   • D-pad / trackpad map to the LG keycodes (UP / DOWN / LEFT / RIGHT
//     / ENTER / BACK / EXIT / HOME) used by the webOSTV integration's
//     remote.send_command service.

// Default input matcher: strings in source_list that look like physical
// inputs rather than apps. Used when cfg.inputs is empty.
const LG_INPUT_PATTERN = /^(hdmi|live\s*tv|component|composite|optical|ext|antenna|cable|av|usb|screen\s*share|miracast)/i;

function LGTVSection({ tv, hass, editMode, onHideSection }) {
  const remoteId = tv.remote;
  const mpId     = tv.mediaPlayer;
  const mp       = hass?.states?.[mpId];
  const remote   = remoteId ? hass?.states?.[remoteId] : null;

  const sourceList    = mp?.attributes?.source_list || [];
  const currentSource = mp?.attributes?.source;
  const playing       = mp?.state === "playing";
  const off           = mp?.state === "off" || mp?.state === "standby" || mp?.state === "unavailable" ||
                        (remote && remote.state === "off");

  // Inputs: hardcoded list from config if present, else auto-detected
  // from source_list by name pattern.
  const inputs = (tv.inputs && tv.inputs.length)
    ? tv.inputs
    : sourceList
        .filter((s) => LG_INPUT_PATTERN.test(s))
        .map((s) => ({ name: s, source: s }));

  const apps = tv.apps || [];

  // LG d-pad mapping. The TVTrackpad component emits lowercase
  // directional + "select" strings; LG wants uppercase keycodes.
  // Two service paths depending on what the integration exposes:
  //   1) remote.send_command on a remote.* entity (newer integration)
  //   2) webostv.button on the media_player entity (older integration —
  //      no separate remote entity is created)
  const LG_KEY = {
    up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT",
    select: "ENTER",
    back: "BACK", home: "HOME", menu: "MENU", info: "INFO",
    play_pause: playing ? "PAUSE" : "PLAY",
  };
  const send = async (cmd) => {
    const key = LG_KEY[cmd] || cmd.toUpperCase();
    try {
      if (remoteId) {
        await callService(hass, "remote.send_command",
          { entity_id: remoteId, command: key });
      } else if (mpId) {
        await callService(hass, "webostv.button",
          { entity_id: mpId, button: key });
      }
    } catch (e) { console.warn("[aether lg-tv] button failed:", e); }
  };

  const selectSource = async (source) => {
    if (!mpId) return;
    try {
      await callService(hass, "media_player.select_source",
        { entity_id: mpId, source });
    } catch (e) { console.warn("[aether lg-tv] select_source failed:", e); }
  };
  // Switch to a physical input by its webOS app ID instead of by source
  // name. media_player.select_source validates against source_list,
  // which on LG Smart Monitors only contains inputs labeled with
  // currently-connected device names (e.g. "PC", "Xbox") - not the
  // generic "HDMI 1" / "USB-C" strings. Launching by app ID
  // (com.webos.app.hdmi1, etc.) bypasses that validation entirely.
  const launchInputApp = async (appId) => {
    if (!mpId) return;
    try {
      await callService(hass, "webostv.command", {
        entity_id: mpId,
        command: "system.launcher/launch",
        payload: { id: appId },
      });
    } catch (e) { console.warn("[aether lg-tv] launch input failed:", e); }
  };

  const togglePower = async () => {
    if (!mpId) return;
    try {
      if (off) {
        // Powering ON: prefer WoL when available. When the TV is "off"
        // its WebOS service is asleep and won't accept a turn_on command
        // anyway - some webOSTV integration versions also strip the
        // TURN_ON bit from supported_features so the call errors as
        // "Entity does not support action media_player.turn_on".
        // Magic packet is enough; skip the redundant turn_on in that
        // case. Only fall back to media_player.turn_on if no MAC was
        // configured.
        if (tv.wakeOnLanMac) {
          await callService(hass, "wake_on_lan.send_magic_packet",
            { mac: tv.wakeOnLanMac });
        } else {
          await callService(hass, "media_player.turn_on",
            { entity_id: mpId });
        }
      } else {
        await callService(hass, "media_player.turn_off",
          { entity_id: mpId });
      }
    } catch (e) { console.warn("[aether lg-tv] power failed:", e); }
  };
  // LG TVs in external_arc / external_optical mode route audio to a
  // soundbar via HDMI-CEC, so media_player.volume_set on the TV
  // entity changes only the (silent) internal volume - the soundbar
  // ignores it. Use webostv.button VOLUMEUP/VOLUMEDOWN instead;
  // those are sent as CEC keys that the soundbar responds to, same
  // as pressing the physical remote.
  const volumeUp   = () => mpId && callService(hass, "webostv.button",
    { entity_id: mpId, button: "VOLUMEUP" });
  const volumeDown = () => mpId && callService(hass, "webostv.button",
    { entity_id: mpId, button: "VOLUMEDOWN" });
  const toggleMute = () => {
    if (!mpId) return;
    callService(hass, "media_player.volume_mute",
      { entity_id: mpId, is_volume_muted: !mp?.attributes?.is_volume_muted });
  };

  const volumeLevel = Math.round(((mp?.attributes?.volume_level) ?? 0) * 100);
  const volumeMuted = !!mp?.attributes?.is_volume_muted;
  const title       = mp?.attributes?.media_title || (off ? "Off" : "LG TV");
  const subtitle    = currentSource && currentSource !== title ? currentSource : "";

  return (
    <>
      <div className="dash-section-head">
        <h2>{tv.name || "LG TV"}</h2>
        <div className="meta" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{off ? "Off" : (playing ? "Playing" : currentSource || "On")}</span>
          {editMode && (
            <button className="section-hide-btn" onClick={onHideSection}>Hide section</button>
          )}
        </div>
      </div>

      <div className="atv-tile">
        <div className="atv-tile-head">
          <div className="atv-brand">
            <span className="atv-brand-glyph" style={{ background: "#a50034" /* LG red */ }}>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <text x="3" y="17" fontSize="13" fontWeight="700" fill="white" fontFamily="-apple-system, Helvetica, Arial">LG</text>
              </svg>
            </span>
            <div className="atv-brand-text">
              <div className="atv-title">{title}</div>
              {subtitle && <div className="atv-subtitle">{subtitle}</div>}
            </div>
          </div>
          <button
            className={"atv-power" + (off ? " off" : "")}
            onClick={togglePower}
            title={off ? "Turn on" : "Turn off"}
          >
            <Icon name="power" size={16} />
          </button>
        </div>

        <div className="atv-volume">
          <button className="atv-mute" onClick={toggleMute} title={volumeMuted ? "Unmute" : "Mute"}>
            <Icon name="volume" size={14} />
          </button>
          <button className="atv-vol-btn" onClick={volumeDown} title="Volume down">−</button>
          <span className="atv-vol-pct" style={{ flex: 1, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
            {volumeMuted ? "Muted" : `Vol ${volumeLevel}%`}
          </span>
          <button className="atv-vol-btn" onClick={volumeUp} title="Volume up">+</button>
        </div>

        {inputs.length > 0 && (
          <>
            <div className="atv-row-label">Inputs</div>
            <div className="atv-inputs-grid">
              {inputs.map((inp, i) => {
                // Inputs are always clickable - the TV can switch to an HDMI
                // port even if nothing's powered on. Don't grey out based on
                // source_list presence; LG hides off-devices from that list.
                // Two click paths:
                //   inp.appId    → webostv.command launches by webOS app ID
                //                  (bypasses select_source's source_list
                //                  validation; works for LG Smart Monitors
                //                  whose source_list only carries device-
                //                  labeled names like "PC" or "Xbox").
                //   inp.source   → media_player.select_source with the
                //                  string. Subject to source_list
                //                  validation - only works when the string
                //                  is reported by the TV.
                const active = inp.appId
                  ? mp?.attributes?.app_id === inp.appId
                  : currentSource === inp.source;
                const handleClick = () => inp.appId
                  ? launchInputApp(inp.appId)
                  : selectSource(inp.source);
                return (
                  <button
                    key={inp.appId || inp.source || i}
                    className={"atv-input-tile" + (active ? " active" : "")}
                    onClick={handleClick}
                    title={`Switch to ${inp.name}`}
                  >
                    <Icon name="tv" size={18} />
                    <span className="atv-app-name">{inp.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {apps.length > 0 && (
          <>
            <div className="atv-row-label">Apps</div>
            <div className="atv-apps-grid">
              {apps.map((app) => {
                const exists = sourceList.length === 0 || sourceList.includes(app.source);
                const active = currentSource === app.source;
                const icon = resolveAppIcon(app);
                return (
                  <button
                    key={app.name}
                    className={"atv-app-tile" + (active ? " active" : "")}
                    onClick={() => selectSource(app.source)}
                    disabled={!exists}
                    title={exists ? `Launch ${app.name}` : `${app.source} not in source list`}
                  >
                    <span
                      className="atv-app-icon"
                      style={icon ? { background: icon.bg, border: icon.border || "0" }
                                  : { background: "#1f2326" }}
                    >
                      {icon?.glyph || <span className="atv-app-initial">{(app.name || "?").slice(0,1)}</span>}
                    </span>
                    <span className="atv-app-name">{app.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <TVTrackpad onCmd={send} onSelect={() => send("select")} />

        <div className="atv-controls">
          <button className="atv-ctrl" onClick={() => send("back")} title="Back">
            <Icon name="back" size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("home")} title="Home">
            <Icon name="home" size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("play_pause")} title="Play / Pause">
            <Icon name={playing ? "pause" : "play"} size={18}/>
          </button>
          <button className="atv-ctrl" onClick={() => send("menu")} title="Settings / Menu">
            <Icon name="settings" size={18}/>
          </button>
        </div>
      </div>
    </>
  );
}

// Wraps Google's <model-viewer> and drives the GLB's animations from
// the live entity states. Two playback modes:
//
//   • Multi-action (preferred): we walk the model-viewer element to find
//     its internal THREE.AnimationMixer, then create an AnimationAction
//     per clip and toggle each independently. Trunk + frunk + a door can
//     all be open at the same time on the 3D model.
//
//   • Single-anim (fallback): if the mixer isn't reachable, we use the
//     standard model-viewer API which only supports one active clip at
//     a time. Priority order: charge port > trunk > frunk > combined
//     doors. Other open parts still show in the badges row.
//
// _open_close style animations in the user's GLB cycle closed → open →
// closed across their duration, so we pause at the midpoint to hold
// the "fully open" pose.
function CarModel3D({ src, alt, doors, frunk, trunk, chargePort }) {
  const mvRef       = React.useRef(null);
  const [animMap, setAnimMap]   = React.useState({});
  const [actions, setActions]   = React.useState(null);

  React.useEffect(() => {
    const mv = mvRef.current;
    if (!mv) return;

    const onLoad = () => {
      const animations = mv.availableAnimations || [];
      console.log("[aether] GLB loaded:", src);
      console.log("[aether] availableAnimations:", animations);

      const match = (...patterns) =>
        animations.find((a) => patterns.some((p) => p.test(a)));

      const map = {
        combinedDoors: match(/^doors?[_ ]|^all.*doors|every.*door/i),
        frontDriver:    match(/(?:fl|front.*left|driver)[_ ].*door|door.*(?:fl|front.*left|driver)/i),
        frontPassenger: match(/(?:fr|front.*right|passenger)[_ ].*door|door.*(?:fr|front.*right|passenger)/i),
        rearDriver:     match(/(?:rl|rear.*left|back.*left)[_ ].*door|door.*(?:rl|rear.*left|back.*left)/i),
        rearPassenger:  match(/(?:rr|rear.*right|back.*right)[_ ].*door|door.*(?:rr|rear.*right|back.*right)/i),
        frunk:          match(/frunk|hood|bonnet|front[_ ]?trunk|front[_ ]?lid/i),
        trunk:          match(/^trunk|^rear[_ ]?lid|^boot|tailgate|liftgate/i),
        chargePort:     match(/charge.?port|charging.?port|charger.?door/i),
      };
      console.log("[aether] animMap:", map);
      setAnimMap(map);

      // Best-effort probe for the internal THREE.AnimationMixer so we can
      // drive multiple animations simultaneously. model-viewer stores the
      // mixer under a Symbol-keyed property (the symbol's description is
      // usually 'mixer') OR on the internal ModelScene. We try several
      // access paths and fall back to a deep walk.
      let mixer = null;
      let scene = null;

      // Strategy 1: direct mv symbol whose description contains "mixer"
      for (const sym of Object.getOwnPropertySymbols(mv)) {
        const desc = sym.description || sym.toString();
        if (/mixer/i.test(desc)) {
          try {
            const m = mv[sym];
            if (m && Array.isArray(m._actions) && typeof m.update === "function") {
              mixer = m;
              console.log("[aether] mixer via direct symbol:", desc);
              break;
            }
          } catch {}
        }
      }

      // Strategy 2: scene symbol → scene.mixer or scene[symbol]
      if (!mixer) {
        for (const sym of Object.getOwnPropertySymbols(mv)) {
          try {
            const obj = mv[sym];
            if (!obj || typeof obj !== "object") continue;
            if (obj.mixer && Array.isArray(obj.mixer._actions)) {
              mixer = obj.mixer;
              scene = obj;
              console.log("[aether] mixer via scene[", sym.description || "?", "].mixer");
              break;
            }
            for (const subSym of Object.getOwnPropertySymbols(obj)) {
              const subDesc = subSym.description || subSym.toString();
              if (!/mixer/i.test(subDesc)) continue;
              try {
                const m = obj[subSym];
                if (m && Array.isArray(m._actions)) {
                  mixer = m;
                  scene = obj;
                  console.log("[aether] mixer via nested symbol:", subDesc);
                  break;
                }
              } catch {}
            }
            if (mixer) break;
          } catch {}
        }
      }

      // Strategy 3: deep walk (last resort, both enumerable and non-enumerable)
      if (!mixer) {
        const seenDeep = new WeakSet();
        const walk = (obj, depth) => {
          if (mixer || !obj || typeof obj !== "object" ||
              seenDeep.has(obj) || depth > 8) return;
          seenDeep.add(obj);
          if (Array.isArray(obj._actions) && typeof obj.update === "function" && obj._root) {
            mixer = obj;
            console.log("[aether] mixer via deep walk, depth", depth);
            return;
          }
          let keys = [];
          try { keys.push(...Object.getOwnPropertyNames(obj)); } catch {}
          try { keys.push(...Object.getOwnPropertySymbols(obj)); } catch {}
          for (const k of keys) {
            if (mixer) return;
            try { walk(obj[k], depth + 1); } catch {}
          }
        };
        try { walk(mv, 0); } catch {}
      }

      // ── Locate the AnimationClip[] array. Tried in order:
      //   1. mv.model.animations (public API, sometimes empty in v4)
      //   2. scene.animations / scene.model.animations
      //   3. mixer._root.animations / walked tree under the mixer root
      //   4. last resort: walk mv looking for any .animations array
      let clips = null;
      const probeForClips = () => {
        try {
          if (Array.isArray(mv?.model?.animations) && mv.model.animations.length) return mv.model.animations;
        } catch {}
        try {
          if (Array.isArray(scene?.animations) && scene.animations.length) return scene.animations;
        } catch {}
        try {
          if (Array.isArray(scene?.model?.animations) && scene.model.animations.length) return scene.model.animations;
        } catch {}
        try {
          if (Array.isArray(mixer?._root?.animations) && mixer._root.animations.length) return mixer._root.animations;
        } catch {}
        // Deep search for any .animations array of valid clips
        const seenC = new WeakSet();
        const findInTree = (obj, depth) => {
          if (!obj || typeof obj !== "object" || seenC.has(obj) || depth > 8) return null;
          seenC.add(obj);
          if (Array.isArray(obj.animations) && obj.animations.length > 0 &&
              obj.animations[0] && typeof obj.animations[0].duration === "number") {
            return obj.animations;
          }
          let keys = [];
          try { keys.push(...Object.getOwnPropertyNames(obj)); } catch {}
          try { keys.push(...Object.getOwnPropertySymbols(obj)); } catch {}
          for (const k of keys) {
            try {
              const c = findInTree(obj[k], depth + 1);
              if (c) return c;
            } catch {}
          }
          return null;
        };
        return findInTree(mv, 0);
      };
      clips = probeForClips();
      console.log("[aether] clips found:", clips?.length || 0, clips?.map?.((c) => c.name) || []);

      if (mixer && Array.isArray(clips) && clips.length > 0) {
        console.log("[aether] multi-anim mode — building action map");
        const acts = {};
        for (const clip of clips) {
          try {
            const action = mixer.clipAction(clip);
            action.setLoop?.(2200, Infinity); // LoopOnce = 2200
            action.clampWhenFinished = true;
            action.enabled = false;
            action.weight  = 0;
            action.paused  = true;
            action.time    = 0;
            action.play();
            acts[clip.name] = action;
          } catch (e) {
            console.warn("[aether] clipAction failed for", clip.name, e);
          }
        }
        setActions(acts);
      } else {
        console.log("[aether] single-anim mode (mixer:", !!mixer, ", clips:", clips?.length || 0, ")");
        setActions(null);
      }
    };

    mv.addEventListener("load", onLoad);
    return () => mv.removeEventListener("load", onLoad);
  }, [src]);

  // Apply current open/closed state. We track which animation is currently
  // selected so a state change re-plays it from the appropriate start.
  const lastTargetRef = React.useRef(null);
  React.useEffect(() => {
    if (!Object.keys(animMap).length) return;
    const mv = mvRef.current;
    if (!mv) return;

    const anyDoor =
      doors.frontDriver || doors.frontPassenger ||
      doors.rearDriver  || doors.rearPassenger;

    if (actions) {
      // ── Multi-anim path: each action independently held at midpoint
      const setAction = (animName, isOpen) => {
        if (!animName) return;
        const action = actions[animName];
        if (!action) return;
        const duration = action.getClip().duration || 0;
        action.enabled = true;
        action.weight  = isOpen ? 1 : 0;
        action.paused  = true;
        action.time    = isOpen ? duration / 2 : 0;
      };

      // If the GLB exposes per-door animations, use them for accuracy.
      // The combined 'all_doors' clip is only a fallback for models that
      // don't ship individual door clips. Using both at once would make
      // every door open when only one is actually open.
      const hasPerDoor = !!(animMap.frontDriver || animMap.frontPassenger
                         || animMap.rearDriver  || animMap.rearPassenger);

      if (hasPerDoor) {
        setAction(animMap.combinedDoors,  false);   // disable combined
        setAction(animMap.frontDriver,    doors.frontDriver);
        setAction(animMap.frontPassenger, doors.frontPassenger);
        setAction(animMap.rearDriver,     doors.rearDriver);
        setAction(animMap.rearPassenger,  doors.rearPassenger);
      } else {
        setAction(animMap.combinedDoors,  anyDoor);
      }

      setAction(animMap.frunk,      frunk);
      setAction(animMap.trunk,      trunk);
      setAction(animMap.chargePort, chargePort);
      try { actions[Object.keys(actions)[0]]?.getMixer?.().update(0); } catch {}
      return;
    }

    // ── Single-anim path: priority chooser
    // We can only hold one part visually open at a time. Prefer trunk first
    // because it's the most visually obvious + most common to leave open.
    const target =
      (trunk      && animMap.trunk)         ? animMap.trunk :
      (frunk      && animMap.frunk)         ? animMap.frunk :
      (anyDoor    && animMap.combinedDoors) ? animMap.combinedDoors :
      (chargePort && animMap.chargePort)    ? animMap.chargePort :
      null;

    // Cancel any in-flight monitor from a previous transition
    if (lastTargetRef.current?.cancelled) {
      lastTargetRef.current.cancelled.value = true;
    }

    if (!target) {
      // Nothing open — pause and reset
      try {
        mv.pause();
        mv.currentTime = 0;
      } catch {}
      return;
    }

    // Strategy that actually works on model-viewer:
    //   1. Setting mv.duration immediately after mv.animationName = ...
    //      returns 0 because the new clip hasn't been bound yet. So we
    //      can't pre-compute "how long until midpoint" with setTimeout.
    //   2. Instead, set the animation, start it playing in a loop, and
    //      poll currentTime every requestAnimationFrame. As soon as
    //      currentTime crosses duration/2, pause and clamp there.
    //   3. Use setAttribute (not just the property) — Lit reflects but
    //      attribute-set is more reliable for re-binding the action.
    try {
      console.log("[aether] holding", target, "at midpoint");
      mv.setAttribute("animation-name", target);
      mv.animationName = target;
      mv.currentTime = 0;
      mv.play({ repetitions: Infinity });

      const cancelled = { value: false };
      lastTargetRef.current = { name: target, cancelled };

      const startedAt = performance.now();
      const monitor = () => {
        if (cancelled.value) return;
        try {
          const dur = mv.duration;
          // Wait until duration is known AND we've passed the midpoint
          if (dur > 0 && mv.currentTime >= dur / 2) {
            mv.pause();
            mv.currentTime = dur / 2;
            console.log("[aether] paused at midpoint", dur / 2, "of", dur);
            return;
          }
          // Hard timeout: if duration never resolves or we never hit
          // midpoint after 10s, give up to avoid burning CPU forever.
          if (performance.now() - startedAt > 10000) {
            console.warn("[aether] monitor timeout for", target, "duration:", dur);
            return;
          }
        } catch (e) {
          console.warn("[aether] monitor error:", e);
          return;
        }
        requestAnimationFrame(monitor);
      };
      requestAnimationFrame(monitor);
    } catch (e) {
      console.warn("[aether] animation start failed:", e);
    }
  }, [
    animMap, actions,
    doors.frontDriver, doors.frontPassenger,
    doors.rearDriver,  doors.rearPassenger,
    frunk, trunk, chargePort,
  ]);

  return React.createElement("model-viewer", {
    ref: mvRef,
    src,
    alt,
    "auto-rotate": "",
    "auto-rotate-delay": "1500",
    "rotation-per-second": "18deg",
    "camera-controls": "",
    "touch-action": "pan-y",
    "interaction-prompt": "none",
    "shadow-intensity": "1",
    "exposure": "1.0",
    "environment-image": "neutral",
    style: { width: "100%", height: "100%", minHeight: 240, "--poster-color": "transparent" },
  });
}

// Top-down schematic of the car body with door / frunk / trunk / charge-port
// states. Highlights any open part in alert-red. Compact (≈100×170) so it
// can live inline beside the badges row.
function CarStatusDiagram({ doors, frunk, trunk, chargePort }) {
  const fill = (open) => open ? "#e1314a" : "#f0f0f0";
  const stroke = (open) => open ? "#9a1d2a" : "#bbb";
  const sw = (open) => open ? 1.5 : 0.8;
  const glass = "rgba(80, 100, 120, .28)";
  const txt = (open) => open ? "#fff" : "#888";

  return (
    <svg viewBox="0 0 120 200" width="92" height="155" xmlns="http://www.w3.org/2000/svg" aria-label="Car door status">
      {/* Body */}
      <rect x="14" y="10" width="92" height="180" rx="24" fill="#fafafa" stroke="#999" strokeWidth="1.2"/>
      {/* Roof glass */}
      <rect x="28" y="55" width="64" height="90" fill={glass} stroke="#aaa" strokeWidth="0.5"/>
      {/* Windshield */}
      <path d="M 24 46 Q 60 38 96 46 L 90 55 L 30 55 Z" fill={glass} stroke="#aaa" strokeWidth="0.5"/>
      {/* Rear window */}
      <path d="M 30 145 L 90 145 L 96 156 Q 60 162 24 156 Z" fill={glass} stroke="#aaa" strokeWidth="0.5"/>

      {/* Frunk */}
      <rect x="28" y="14" width="64" height="20" rx="5"
            fill={fill(frunk)} stroke={stroke(frunk)} strokeWidth={sw(frunk)}/>
      <text x="60" y="28" textAnchor="middle" fontSize="8" fontWeight="700" fill={txt(frunk)}>FRUNK</text>

      {/* Trunk */}
      <rect x="28" y="166" width="64" height="20" rx="5"
            fill={fill(trunk)} stroke={stroke(trunk)} strokeWidth={sw(trunk)}/>
      <text x="60" y="180" textAnchor="middle" fontSize="8" fontWeight="700" fill={txt(trunk)}>TRUNK</text>

      {/* Doors */}
      <rect x="14" y="62"  width="14" height="40" rx="3"
            fill={fill(doors.frontDriver)} stroke={stroke(doors.frontDriver)} strokeWidth={sw(doors.frontDriver)}/>
      <rect x="92" y="62"  width="14" height="40" rx="3"
            fill={fill(doors.frontPassenger)} stroke={stroke(doors.frontPassenger)} strokeWidth={sw(doors.frontPassenger)}/>
      <rect x="14" y="106" width="14" height="38" rx="3"
            fill={fill(doors.rearDriver)} stroke={stroke(doors.rearDriver)} strokeWidth={sw(doors.rearDriver)}/>
      <rect x="92" y="106" width="14" height="38" rx="3"
            fill={fill(doors.rearPassenger)} stroke={stroke(doors.rearPassenger)} strokeWidth={sw(doors.rearPassenger)}/>

      {/* Charge port (small dot on rear left) */}
      {chargePort && (
        <>
          <circle cx="20" cy="148" r="4" fill="#e1314a" stroke="white" strokeWidth="1"/>
          <text x="20" y="151" textAnchor="middle" fontSize="6" fontWeight="700" fill="white">⚡</text>
        </>
      )}
    </svg>
  );
}

// Stylized Tesla Model 3 — side profile with sport wheels. Replaced when
// AETHER_CONFIG.car.image points to a real photo (e.g. /local/aether/tesla.png).
function TeslaModel3SVG() {
  return (
    <svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="ae-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#ffffff"/>
          <stop offset="45%" stopColor="#ececec"/>
          <stop offset="100%" stopColor="#a8a8a8"/>
        </linearGradient>
        <linearGradient id="ae-window" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#5a6a7a" stopOpacity="0.35"/>
          <stop offset="60%" stopColor="#2a3a4a" stopOpacity="0.78"/>
          <stop offset="100%" stopColor="#142235" stopOpacity="0.92"/>
        </linearGradient>
        <radialGradient id="ae-rim" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#e8e8e8"/>
          <stop offset="65%" stopColor="#a0a0a0"/>
          <stop offset="100%" stopColor="#5a5a5a"/>
        </radialGradient>
        <radialGradient id="ae-tire" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#404040"/>
          <stop offset="80%" stopColor="#1a1a1a"/>
          <stop offset="100%" stopColor="#000000"/>
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="300" cy="198" rx="225" ry="7" fill="rgba(0,0,0,0.28)" />

      {/* Body - Model 3 silhouette */}
      <path d="
        M 78 168 L 102 168
        A 35 35 0 0 1 178 168
        L 232 168
        L 240 158 L 242 100
        Q 256 72 320 65
        L 380 65
        Q 442 70 478 95
        L 510 130 L 522 158 L 510 168
        A 35 35 0 0 1 434 168
        L 408 168 L 78 168 Z
      " fill="url(#ae-body)" stroke="#888" strokeWidth="1.4" />

      {/* Continuous glass roof */}
      <path d="
        M 254 92 Q 268 72 320 67
        L 380 67 Q 438 72 470 95
        L 458 100 Q 426 78 380 75
        L 320 75 Q 278 78 264 100 Z
      " fill="url(#ae-window)" />

      {/* Highlight reflection on glass */}
      <path d="
        M 256 88 Q 270 72 320 68
        L 380 68 Q 416 72 446 86
        L 442 90 Q 416 76 380 74
        L 320 74 Q 282 76 262 92 Z
      " fill="#fff" opacity="0.32" />

      {/* Door / pillar lines */}
      <line x1="298" y1="78" x2="298" y2="168" stroke="#bbb" strokeWidth="0.8" opacity="0.6"/>
      <line x1="366" y1="73" x2="366" y2="168" stroke="#bbb" strokeWidth="0.8" opacity="0.6"/>

      {/* Flush door handles */}
      <rect x="320" y="138" width="22" height="3.5" rx="1.5" fill="#666" />
      <rect x="395" y="138" width="22" height="3.5" rx="1.5" fill="#666" />

      {/* Front wheel + 5-spoke 19" Silver Sport rim */}
      <circle cx="140" cy="172" r="34" fill="url(#ae-tire)" />
      <circle cx="140" cy="172" r="24" fill="url(#ae-rim)" stroke="#3a3a3a" strokeWidth="1" />
      <g transform="translate(140 172)" stroke="#666" strokeWidth="3.2" strokeLinecap="round">
        <circle r="6.5" fill="#bbb" />
        <line x1="0"     y1="-22"   x2="0"     y2="22" />
        <line x1="20.9"  y1="-6.8"  x2="-20.9" y2="6.8" />
        <line x1="20.9"  y1="6.8"   x2="-20.9" y2="-6.8" />
        <line x1="12.9"  y1="-17.8" x2="-12.9" y2="17.8" />
        <line x1="12.9"  y1="17.8"  x2="-12.9" y2="-17.8" />
      </g>

      {/* Rear wheel */}
      <circle cx="396" cy="172" r="34" fill="url(#ae-tire)" />
      <circle cx="396" cy="172" r="24" fill="url(#ae-rim)" stroke="#3a3a3a" strokeWidth="1" />
      <g transform="translate(396 172)" stroke="#666" strokeWidth="3.2" strokeLinecap="round">
        <circle r="6.5" fill="#bbb" />
        <line x1="0"     y1="-22"   x2="0"     y2="22" />
        <line x1="20.9"  y1="-6.8"  x2="-20.9" y2="6.8" />
        <line x1="20.9"  y1="6.8"   x2="-20.9" y2="-6.8" />
        <line x1="12.9"  y1="-17.8" x2="-12.9" y2="17.8" />
        <line x1="12.9"  y1="17.8"  x2="-12.9" y2="-17.8" />
      </g>

      {/* Headlight */}
      <ellipse cx="92" cy="148" rx="13" ry="6" fill="#fff" opacity="0.95" stroke="#aaa" strokeWidth="0.5" />
      {/* Taillight */}
      <ellipse cx="514" cy="148" rx="10" ry="5" fill="#d4444a" opacity="0.85" />
    </svg>
  );
}

Object.assign(window, { DashboardPage });
