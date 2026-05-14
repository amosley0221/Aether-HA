/* Home page — welcome, snapshot, scenes, status */

function HomePage({ rooms, np, setNp, playPrimary, setPlayPrimary, navigate, devices, setActiveScene, activeScene }) {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);

  const hour = now.getHours();
  const greeting =
    hour < 5  ? "Still up?"  :
    hour < 12 ? "Good morning" :
    hour < 18 ? "Good afternoon" :
                "Good evening";

  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const playingRooms = rooms.filter(r => r.playing);
  const lightsOn     = devices.lights.filter(l => l.on).length;
  const lightsTotal  = devices.lights.length;
  const locks        = devices.locks;
  const allLocked    = locks.every(l => l.locked);
  const cameras      = devices.cameras;

  const scenes = [
    { id: "morning",   name: "Morning",        meta: "Lights + Jazz",     grad: "linear-gradient(135deg, #f3c685, #b06a2c)", icon: "sun" },
    { id: "focus",     name: "Focus",          meta: "Office only",       grad: "linear-gradient(135deg, #9aa0d8, #4a4f9a)", icon: "sparkle" },
    { id: "movie",     name: "Movie Night",    meta: "Dim · TV scene",    grad: "linear-gradient(135deg, #b85a48, #5a1e18)", icon: "moon" },
    { id: "dinner",    name: "Dinner",         meta: "Dining + Kitchen",  grad: "linear-gradient(135deg, #c47a4a, #5a2e18)", icon: "leaf" },
    { id: "sleep",     name: "Sleep",          meta: "All off · Locked",  grad: "linear-gradient(135deg, #4a4f9a, #1e2156)", icon: "moon" },
  ];

  return (
    <div className="page home" data-screen-label="01 Home">
      {/* Hero */}
      <div className="hero">
        <div className="hero-grid">
          <div>
            <div className="hero-time">{date} · {time}</div>
            <div className="hero-greet">{greeting}, <b>Ben</b>.</div>
            <div className="hero-sub">
              {playingRooms.length > 0
                ? `Music is playing in ${playingRooms.length} ${playingRooms.length === 1 ? "room" : "rooms"}. The house is quiet otherwise — ${lightsOn} ${lightsOn === 1 ? "light is" : "lights are"} on and everything is ${allLocked ? "locked up" : "unlocked"}.`
                : `${lightsOn} ${lightsOn === 1 ? "light is" : "lights are"} on. The house is quiet — tap below to put on something.`}
            </div>
          </div>
          <div className="hero-stats">
            <div className="stat-cell">
              <span className="lbl">Indoor</span>
              <span className="val row">72<span className="unit">°F</span></span>
              <span className="meta">Auto · Cool to 70</span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Outside</span>
              <span className="val row">58<span className="unit">°F</span></span>
              <span className="meta">Light overcast</span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Energy today</span>
              <span className="val row">12.4<span className="unit">kWh</span></span>
              <span className="meta">−14% vs avg</span>
            </div>
            <div className="stat-cell">
              <span className="lbl">Security</span>
              <span className="val row" style={{ color: allLocked ? "#2f8f63" : "#b6432e" }}>{allLocked ? "Secure" : "Open"}</span>
              <span className="meta">{locks.filter(l => l.locked).length} of {locks.length} locked · {cameras.length} cameras live</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scenes */}
      <div className="h-section">
        <div className="h-section-head">
          <h2>Scenes</h2>
          <button className="h-link">Edit</button>
        </div>
        <div className="scenes">
          {scenes.map(s => (
            <button
              key={s.id}
              className={"scene" + (activeScene === s.id ? " active" : "")}
              onClick={() => setActiveScene(s.id)}
            >
              <div className="icon"><Icon name={s.icon} size={16} /></div>
              <div className="gradient" style={{ background: s.grad }} />
              <div>
                <div className="name">{s.name}</div>
                <div className="meta">{s.meta}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Now playing snapshot + House map */}
      <div className="home-row">
        <div className="now-mini" onClick={() => navigate("music")}>
          <div className="e">Now playing · {playingRooms.length} {playingRooms.length === 1 ? "room" : "rooms"}</div>
          <div>
            <div className="track">{np.track}</div>
            <div className="artist">{np.artist}</div>
          </div>
          <div className="play-row">
            <button className="play-btn" onClick={(e) => { e.stopPropagation(); setPlayPrimary(p => !p); }}>
              <Icon name={playPrimary ? "pause" : "play"} size={18} />
            </button>
            <div className="rooms-tag">{playingRooms.map(r => r.name).join(" · ") || "Idle"}</div>
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
            {rooms.slice(0, 6).map(r => <MiniRoomRow key={r.id} room={r} />)}
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
            <div className={"ic " + (allLocked ? "ok" : "alert")}><Icon name={allLocked ? "lock" : "unlock"} /></div>
            <div>
              <div className="t">Locks</div>
              <div className="v">{allLocked ? "All locked" : "1 unlocked"}</div>
            </div>
          </div>
          <div className="status-tile">
            <div className="ic"><Icon name="camera" /></div>
            <div>
              <div className="t">Cameras</div>
              <div className="v">{cameras.length} live · no motion</div>
            </div>
          </div>
          <div className="status-tile">
            <div className="ic warn"><Icon name="droplet" /></div>
            <div>
              <div className="t">Air quality</div>
              <div className="v">Good · 42 AQI</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage });
