/* Dashboard — control everything in the house */

function DashboardPage({ rooms, setRooms, devices, setDevices, np, playPrimary, setPlayPrimary }) {
  const [filter, setFilter] = React.useState("All");
  const filters = [
    { key: "All",      icon: "grid",    count: devices.lights.length + devices.cameras.length + devices.locks.length + devices.climate.length + rooms.length },
    { key: "Lights",   icon: "bulb",    count: devices.lights.length },
    { key: "Cameras",  icon: "camera",  count: devices.cameras.length },
    { key: "Locks",    icon: "lock",    count: devices.locks.length },
    { key: "Climate",  icon: "thermo",  count: devices.climate.length },
    { key: "Speakers", icon: "speaker", count: rooms.length },
    { key: "Sensors",  icon: "motion",  count: devices.sensors.length },
  ];

  const toggleLight  = (id) => setDevices(d => ({ ...d, lights:  d.lights.map(l => l.id === id ? { ...l, on: !l.on } : l) }));
  const setLightBri  = (id, v) => setDevices(d => ({ ...d, lights: d.lights.map(l => l.id === id ? { ...l, brightness: v } : l) }));
  const toggleLock   = (id) => setDevices(d => ({ ...d, locks:   d.locks.map(l => l.id === id ? { ...l, locked: !l.locked } : l) }));
  const bumpThermo   = (id, delta) => setDevices(d => ({ ...d, climate: d.climate.map(c => c.id === id ? { ...c, target: Math.max(60, Math.min(80, c.target + delta)) } : c) }));

  const allOff = () => setDevices(d => ({ ...d, lights: d.lights.map(l => ({ ...l, on: false })) }));
  const allOn  = () => setDevices(d => ({ ...d, lights: d.lights.map(l => ({ ...l, on: true  })) }));
  const lockAll = () => setDevices(d => ({ ...d, locks: d.locks.map(l => ({ ...l, locked: true })) }));

  const show = (cat) => filter === "All" || filter === cat;

  return (
    <div className="page dash" data-screen-label="03 Dashboard">
      {/* Ribbon */}
      <div className="dash-ribbon">
        <button className="q" onClick={allOff}><span className="dot" style={{ background: "#b6b4ac" }} /> All lights off</button>
        <button className="q" onClick={allOn}><span className="dot" style={{ background: "#e8a850" }} /> All lights on</button>
        <button className="q" onClick={lockAll}><Icon name="lock" size={14} /> Lock everything</button>
        <button className="q" onClick={() => setPlayPrimary(p => !p)}>
          <Icon name={playPrimary ? "pause" : "play"} size={14} /> {playPrimary ? "Pause music" : "Resume music"}
        </button>
        <button className="q"><Icon name="moon" size={14} /> Goodnight</button>
        <button className="q on"><Icon name="sun" size={14} /> Home</button>
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
      {show("Lights") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Lights</h2><div className="meta">{devices.lights.filter(l => l.on).length} of {devices.lights.length} on</div></div>
          <div className="dash-grid">
            {devices.lights.map(l => (
              <div key={l.id} className={"tile light" + (l.on ? " on" : "")}>
                <div className="bulb-glow" style={{ background: `radial-gradient(circle, ${l.color}80, transparent 60%)` }} />
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div className="tile-icon warm" style={{ background: l.on ? `${l.color}30` : undefined, color: l.on ? l.color : undefined }}><Icon name="bulb" /></div>
                    <div>
                      <div className="tile-name">{l.name}</div>
                      <div className="tile-room">{l.room}</div>
                    </div>
                  </div>
                  <div className={"tile-toggle" + (l.on ? " on" : "")} onClick={() => toggleLight(l.id)} />
                </div>
                <div className="tslider">
                  <Icon name="sun" size={14} />
                  <input className="range thin" type="range" min="0" max="100"
                    value={l.brightness}
                    disabled={!l.on}
                    onChange={(e) => setLightBri(l.id, Number(e.target.value))}
                  />
                  <span className="pct">{l.brightness}%</span>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Speakers */}
      {show("Speakers") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Speakers</h2><div className="meta">{rooms.filter(r => r.playing).length} playing</div></div>
          <div className="dash-grid">
            {rooms.map(r => (
              <div key={r.id} className="tile speaker">
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <Avatar colors={r.color} size={38} />
                    <div>
                      <div className="tile-name">{r.name}</div>
                      <div className="tile-room">{r.playing ? "Playing" : "Idle"}</div>
                    </div>
                  </div>
                  <div className={"tile-toggle" + (r.playing ? " on" : "")}
                    onClick={() => setRooms(rs => rs.map(rr => rr.id === r.id ? { ...rr, playing: !rr.playing } : rr))}
                  />
                </div>
                {r.playing ? (
                  <div className="now-mini-row">
                    <div className="ma" />
                    <div className="meta">
                      <div className="ti">{r.track}</div>
                      <div className="ar">{r.artist}</div>
                    </div>
                    <button className="play-mini" onClick={() => setRooms(rs => rs.map(rr => rr.id === r.id ? { ...rr, playing: !rr.playing } : rr))}>
                      <Icon name="pause" size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No audio · tap to resume last queue</div>
                )}
                <div className="tslider">
                  <Icon name="volume" size={14} />
                  <input className="range thin" type="range" min="0" max="100"
                    value={r.volume}
                    onChange={(e) => setRooms(rs => rs.map(rr => rr.id === r.id ? { ...rr, volume: Number(e.target.value) } : rr))}
                  />
                  <span className="pct">{r.volume}</span>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Climate */}
      {show("Climate") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Climate</h2><div className="meta">Auto · cooling</div></div>
          <div className="dash-grid">
            {devices.climate.map(c => {
              const pct = (c.target - 60) / 20;
              const C = 2 * Math.PI * 56;
              return (
                <div key={c.id} className="tile thermo">
                  <div className="tile-head">
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <div className="tile-icon warm"><Icon name="thermo" /></div>
                      <div>
                        <div className="tile-name">{c.name}</div>
                        <div className="tile-room">{c.room} · {c.mode}</div>
                      </div>
                    </div>
                  </div>
                  <div className="dial">
                    <svg viewBox="0 0 120 120">
                      <circle className="track" cx="60" cy="60" r="56" />
                      <circle className="fill"  cx="60" cy="60" r="56"
                        strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
                    </svg>
                    <div className="center">
                      <div className="t">{c.target}°</div>
                      <div className="sub">{c.current}° now</div>
                    </div>
                  </div>
                  <div className="therm-row">
                    <button className="therm-btn" onClick={() => bumpThermo(c.id, -1)}>−</button>
                    <button className="therm-btn" onClick={() => bumpThermo(c.id, +1)}>+</button>
                  </div>
                </div>
              );
            })}
            <div className="tile">
              <div className="tile-head">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div className="tile-icon cool"><Icon name="fan" /></div>
                  <div>
                    <div className="tile-name">Whole house fan</div>
                    <div className="tile-room">Off</div>
                  </div>
                </div>
                <div className="tile-toggle" />
              </div>
              <div className="tile-foot">
                <div className="val">3<span className="unit">/5 speed</span></div>
                <div>Auto by AQI</div>
              </div>
            </div>
            <div className="tile">
              <div className="tile-head">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div className="tile-icon green"><Icon name="leaf" /></div>
                  <div>
                    <div className="tile-name">Air purifier</div>
                    <div className="tile-room">Bedroom · Quiet</div>
                  </div>
                </div>
                <div className="tile-toggle on" />
              </div>
              <div className="tile-foot">
                <div className="val">42<span className="unit"> AQI</span></div>
                <div>Filter 86%</div>
              </div>
            </div>
          </div>
        </React.Fragment>
      )}

      {/* Cameras */}
      {show("Cameras") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Cameras</h2><div className="meta">All live</div></div>
          <div className="dash-grid">
            {devices.cameras.map(c => (
              <div key={c.id} className="tile camera">
                <div className="feed" style={{ background: c.feed }} />
                <div className="scan" />
                <div className="cam-head">
                  <div className="cam-name">{c.name}</div>
                  <span className="live">LIVE</span>
                </div>
                <div className="cam-foot">
                  <div className="cam-meta">{c.location} · {c.resolution}</div>
                  <button style={{ color: "white", opacity: .8 }}><Icon name="expand" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Locks */}
      {show("Locks") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Locks & Doors</h2><div className="meta">{devices.locks.filter(l => l.locked).length} of {devices.locks.length} locked</div></div>
          <div className="dash-grid">
            {devices.locks.map(l => (
              <div key={l.id} className={"tile lock " + (l.locked ? "locked" : "unlocked")}>
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div className={"tile-icon " + (l.locked ? "green" : "red")}>
                      <Icon name={l.locked ? "lock" : "unlock"} />
                    </div>
                    <div>
                      <div className="tile-name">{l.name}</div>
                      <div className="tile-room">{l.room}</div>
                    </div>
                  </div>
                  <div className={"tile-toggle" + (l.locked ? " on" : "")} onClick={() => toggleLock(l.id)} />
                </div>
                <div className="lock-status">{l.locked ? "Locked" : "Unlocked"}</div>
                <div className="lock-meta">{l.locked ? `Locked ${l.since}` : `Opened ${l.since}`}</div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}

      {/* Sensors */}
      {show("Sensors") && (
        <React.Fragment>
          <div className="dash-section-head"><h2>Sensors</h2><div className="meta">All normal</div></div>
          <div className="dash-grid">
            {devices.sensors.map((s, i) => (
              <div key={i} className="tile" style={{ minHeight: "auto" }}>
                <div className="tile-head">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div className={"tile-icon " + (s.icColor || "")}><Icon name={s.icon} /></div>
                    <div>
                      <div className="tile-name">{s.name}</div>
                      <div className="tile-room">{s.room}</div>
                    </div>
                  </div>
                </div>
                <div className="tile-foot">
                  <div className="val">{s.value}<span className="unit">{s.unit ? " " + s.unit : ""}</span></div>
                  <div>{s.note}</div>
                </div>
              </div>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

Object.assign(window, { DashboardPage });
