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

  // ─── Filters ────────────────────────────────────────────────────────────
  // Counts and visibility reflect post-hidden lists. A section is only
  // rendered if not in hidden.sections AND it has at least one visible item.
  const filters = [
    { key: "All",      icon: "grid",    count: (hasCar ? 1 : 0) + visLights.length + vCameras.length + vClimates.length + visRooms.length },
    ...(hasCar ? [{ key: "Car", icon: "car", count: 1 }] : []),
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
      // drive multiple animations simultaneously. Walks a handful of
      // known property paths on the model-viewer instance; quietly falls
      // back to single-anim mode if it can't find one.
      let mixer = null;
      const seenObjs = new Set();
      const visit = (obj, depth) => {
        if (!obj || depth > 5 || seenObjs.has(obj) || typeof obj !== "object") return null;
        seenObjs.add(obj);
        if (Array.isArray(obj._actions) && typeof obj.update === "function" && obj._root) {
          return obj;
        }
        for (const key of Object.keys(obj)) {
          try {
            const child = obj[key];
            const found = visit(child, depth + 1);
            if (found) return found;
          } catch {}
        }
        for (const sym of Object.getOwnPropertySymbols(obj)) {
          try {
            const child = obj[sym];
            const found = visit(child, depth + 1);
            if (found) return found;
          } catch {}
        }
        return null;
      };
      try { mixer = visit(mv, 0); } catch {}

      const clips = mv?.model?.animations;
      if (mixer && Array.isArray(clips) && clips.length > 0) {
        console.log("[aether] multi-anim mode (internal mixer found)");
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
            action.play();   // queue it; weight=0 keeps it invisible
            acts[clip.name] = action;
          } catch (e) {
            console.warn("[aether] clipAction failed for", clip.name, e);
          }
        }
        setActions(acts);
      } else {
        console.log("[aether] single-anim mode (mixer not found)");
        setActions(null);
      }
    };

    mv.addEventListener("load", onLoad);
    return () => mv.removeEventListener("load", onLoad);
  }, [src]);

  // Apply current open/closed state
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

      // Use combined door anim for any-door-open, plus per-door if
      // the GLB happens to expose them (it doesn't in this case)
      setAction(animMap.combinedDoors,  anyDoor);
      setAction(animMap.frontDriver,    doors.frontDriver);
      setAction(animMap.frontPassenger, doors.frontPassenger);
      setAction(animMap.rearDriver,     doors.rearDriver);
      setAction(animMap.rearPassenger,  doors.rearPassenger);
      setAction(animMap.frunk,          frunk);
      setAction(animMap.trunk,          trunk);
      setAction(animMap.chargePort,     chargePort);

      // Single tick of the mixer to apply weights/time without animating
      try { actions[Object.keys(actions)[0]]?.getMixer?.().update(0); } catch {}
    } else {
      // ── Single-anim path: priority chooser
      const target =
        (chargePort && animMap.chargePort) ? animMap.chargePort :
        (trunk      && animMap.trunk)      ? animMap.trunk :
        (frunk      && animMap.frunk)      ? animMap.frunk :
        (anyDoor    && animMap.combinedDoors) ? animMap.combinedDoors :
        null;

      try {
        if (target) {
          mv.animationName = target;
          mv.pause();
          const duration = mv.duration || 1;
          mv.currentTime = duration / 2;   // midpoint of _open_close = fully open
        } else {
          // Nothing open — reset whichever animation is currently active
          const reset = animMap.combinedDoors || animMap.trunk || animMap.frunk;
          if (reset) {
            mv.animationName = reset;
            mv.pause();
            mv.currentTime = 0;
          }
        }
      } catch (e) {
        console.warn("[aether] animation update failed:", e);
      }
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
