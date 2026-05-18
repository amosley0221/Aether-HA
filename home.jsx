/* Home page — Aether's landing screen.
   Layout:
     - Fixed hero (greeting + weather + stats). Never editable.
     - Tile grid below. Each tile is movable / hidable in edit mode,
       which is triggered from the avatar menu in the brandbar.
     - Layout is persisted to HA frontend user data (synced across
       devices) with a localStorage fallback.

   Tiles in v1: now-playing, house-rooms, calendar, upcoming-3-days,
   todo, notes. To-do and notes are kept in user data; calendar reads
   any calendar.* entity HA exposes. */

const HOME_TILE_DEFS = [
  { id: "now-playing", label: "Now playing",    wide: true  },
  { id: "house-rooms", label: "The house",      wide: false },
  { id: "calendar",    label: "Calendar",       wide: false },
  { id: "upcoming",    label: "Next 3 days",    wide: false },
  { id: "todo",        label: "To-Do",          wide: false },
  { id: "notes",       label: "Notes",          wide: true  },
];

function HomePage({ navigate, editMode, onExitEdit }) {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // ─── Tile layout ────────────────────────────────────────────────────
  // Shape: [{ id, visible }] in render order. Hidden tiles stay in the
  // array so the user can restore them from the edit panel.
  const defaultLayout = React.useMemo(
    () => HOME_TILE_DEFS.map((t) => ({ id: t.id, visible: true })),
    []
  );
  const [layout, setLayout] = React.useState(defaultLayout);
  const [layoutLoaded, setLayoutLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!hass) return;
    (async () => {
      let loaded = null;
      try {
        const r = await hass.callWS({ type: "frontend/get_user_data", key: "aether_home_layout" });
        if (Array.isArray(r?.value)) loaded = r.value;
      } catch {}
      if (!loaded) {
        try {
          const local = localStorage.getItem("aether_home_layout");
          if (local) loaded = JSON.parse(local);
        } catch {}
      }
      if (loaded) {
        // Merge with defaults so new tile types appear when added in
        // future versions, and stale ones drop off cleanly.
        const known = new Set(HOME_TILE_DEFS.map((t) => t.id));
        const seen = new Set();
        const merged = [];
        for (const item of loaded) {
          if (known.has(item.id) && !seen.has(item.id)) {
            merged.push({ id: item.id, visible: item.visible !== false });
            seen.add(item.id);
          }
        }
        for (const t of HOME_TILE_DEFS) {
          if (!seen.has(t.id)) merged.push({ id: t.id, visible: true });
        }
        setLayout(merged);
      }
      setLayoutLoaded(true);
    })();
  }, [hass]);

  const saveLayout = async (next) => {
    setLayout(next);
    try { localStorage.setItem("aether_home_layout", JSON.stringify(next)); } catch {}
    try {
      await hass?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_home_layout",
        value: next,
      });
    } catch {}
  };

  const moveTile = (id, dir) => {
    const idx = layout.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout];
    [next[idx], next[target]] = [next[target], next[idx]];
    saveLayout(next);
  };
  const toggleTile = (id) => {
    saveLayout(layout.map((t) => t.id === id ? { ...t, visible: !t.visible } : t));
  };

  // ─── Greeting ───────────────────────────────────────────────────────
  const hour = now.getHours();
  const greeting =
    hour < 5  ? "Still up"        :
    hour < 12 ? "Good morning"    :
    hour < 18 ? "Good afternoon"  :
                "Good evening";
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const userName =
    cfg.user?.name ||
    (hass?.user?.name || "").split(" ")[0];

  // ─── Shared derivations ─────────────────────────────────────────────
  const liveRooms = React.useMemo(() => {
    const score = (s) => s === "playing" ? 0 : s === "paused" ? 1 : s === "idle" ? 2 : 3;
    return (cfg.rooms || []).map(room => {
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
  const playingRooms = liveRooms.filter(r => r.playing);

  const allLightIds = React.useMemo(() => {
    const ids = new Set();
    for (const r of cfg.rooms || []) (r.lights || []).forEach(l => ids.add(l));
    for (const l of (cfg.globalLights || [])) ids.add(l);
    return [...ids];
  }, [cfg]);
  const lightStates = allLightIds.map(id => hass?.states?.[id]).filter(Boolean);
  const lightsOn    = lightStates.filter(s => s.state === "on").length;

  const climate     = hass?.states?.[cfg.climate?.[0] || "climate.hallway"];
  const indoorTemp  = climate?.attributes?.current_temperature;
  const targetTemp  = climate?.attributes?.temperature;
  const hvacMode    = climate?.state || "—";
  const climateUnit = climate?.attributes?.temperature_unit || "F";

  const weather       = hass?.states?.[cfg.weather || "weather.forecast_home"];
  const outdoorTemp   = weather?.attributes?.temperature;
  const weatherUnit   = weather?.attributes?.temperature_unit || "°F";
  const condition     = (weather?.state || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const cameraStates = (cfg.cameras || []).map(id => hass?.states?.[id]).filter(Boolean);

  // ─── Tile registry ──────────────────────────────────────────────────
  const renderTile = (id) => {
    const shared = { hass, navigate, editMode };
    switch (id) {
      case "now-playing":
        return <NowPlayingTile {...shared} playingRooms={playingRooms} />;
      case "house-rooms":
        return <HouseRoomsTile {...shared} rooms={liveRooms} />;
      case "calendar":
        return <CalendarTile {...shared} />;
      case "upcoming":
        return <UpcomingTile {...shared} />;
      case "todo":
        return <TodoTile {...shared} />;
      case "notes":
        return <NotesTile {...shared} />;
      default:
        return null;
    }
  };

  if (!hass) {
    return <div className="page home" style={{ padding: 40 }}>Connecting to Home Assistant…</div>;
  }

  const visibleLayout = layout.filter((t) => t.visible);
  const hiddenLayout  = layout.filter((t) => !t.visible);

  return (
    <div className={"page home" + (editMode ? " editing" : "")} data-screen-label="01 Home">
      {editMode && (
        <div className="home-edit-bar">
          <span className="home-edit-bar-title">Editing home — reorder, hide, or show tiles</span>
          <button className="home-edit-bar-done" onClick={onExitEdit}>Done</button>
        </div>
      )}

      {/* Hero (fixed, not editable) */}
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
                {playingRooms.length}<span className="unit">/ {(cfg.rooms || []).length} playing</span>
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

      {/* Tile grid */}
      {layoutLoaded && (
        <div className="home-tiles">
          {visibleLayout.map((entry, idx) => {
            const def = HOME_TILE_DEFS.find((d) => d.id === entry.id);
            if (!def) return null;
            return (
              <div
                key={entry.id}
                className={"home-tile" + (def.wide ? " wide" : "")}
              >
                {editMode && (
                  <div className="home-tile-edit-overlay">
                    <span className="home-tile-edit-label">{def.label}</span>
                    <div className="home-tile-edit-actions">
                      <button
                        className="home-tile-edit-btn"
                        onClick={() => moveTile(entry.id, -1)}
                        disabled={idx === 0}
                        title="Move earlier"
                      >↑</button>
                      <button
                        className="home-tile-edit-btn"
                        onClick={() => moveTile(entry.id, 1)}
                        disabled={idx === visibleLayout.length - 1}
                        title="Move later"
                      >↓</button>
                      <button
                        className="home-tile-edit-btn hide"
                        onClick={() => toggleTile(entry.id)}
                        title="Hide"
                      >×</button>
                    </div>
                  </div>
                )}
                {renderTile(entry.id)}
              </div>
            );
          })}
        </div>
      )}

      {editMode && hiddenLayout.length > 0 && (
        <div className="home-hidden-tiles">
          <div className="home-hidden-tiles-head">Hidden tiles</div>
          <div className="home-hidden-tiles-list">
            {hiddenLayout.map((entry) => {
              const def = HOME_TILE_DEFS.find((d) => d.id === entry.id);
              if (!def) return null;
              return (
                <button
                  key={entry.id}
                  className="home-hidden-tile-pill"
                  onClick={() => toggleTile(entry.id)}
                >
                  + {def.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tile: Now playing ───────────────────────────────────────────────────
function NowPlayingTile({ hass, navigate, playingRooms }) {
  const primary = playingRooms[0];
  return (
    <div
      className="now-mini"
      onClick={() => navigate("music")}
      style={primary?.art ? {
        backgroundImage: `linear-gradient(160deg, rgba(30,63,122,.55) 0%, rgba(20,40,80,.85) 100%), url('${primary.art}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } : undefined}
    >
      <div className="e">Now playing · {playingRooms.length} {playingRooms.length === 1 ? "room" : "rooms"}</div>
      <div>
        <div className="track">{primary?.track || "Nothing playing"}</div>
        <div className="artist">{primary?.artist || ""}</div>
      </div>
      <div className="play-row">
        <button
          className="play-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (!primary?.entity) return;
            callService(hass,
              primary.playing ? "media_player.media_pause" : "media_player.media_play",
              { entity_id: primary.mediaPlayer }
            );
          }}
          title={primary?.playing ? "Pause" : "Play"}
        >
          <Icon name={primary?.playing ? "pause" : "play"} size={18} />
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
  );
}

// ─── Tile: House rooms ───────────────────────────────────────────────────
function HouseRoomsTile({ navigate, rooms }) {
  return (
    <div className="house-card">
      <div className="h-section-head" style={{ padding: 0 }}>
        <h2 style={{ fontSize: 16 }}>The house</h2>
        <button className="h-link" onClick={() => navigate("dashboard")}>Manage</button>
      </div>
      <div className="house-rooms">
        {rooms.slice(0, 6).map(r => <MiniRoomRow key={r.id} room={r} />)}
      </div>
    </div>
  );
}

// ─── Tile: Calendar (today) ──────────────────────────────────────────────
function CalendarTile({ hass }) {
  const [events, setEvents] = React.useState([]);
  const [calendarEntities, setCalendarEntities] = React.useState([]);
  const [dayOpen, setDayOpen] = React.useState(false);

  React.useEffect(() => {
    if (!hass) return;
    const ids = Object.keys(hass.states).filter((k) => k.startsWith("calendar."));
    setCalendarEntities(ids);
  }, [hass]);

  React.useEffect(() => {
    if (!hass || calendarEntities.length === 0) return;
    let cancelled = false;
    (async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      const startISO = start.toISOString();
      const endISO   = end.toISOString();
      const all = [];
      await Promise.all(calendarEntities.map(async (eid) => {
        try {
          const list = await hass.callApi(
            "GET",
            `calendars/${eid}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
          );
          for (const ev of list || []) {
            all.push({
              entity: eid,
              summary: ev.summary || "Untitled",
              start: ev.start?.dateTime || ev.start?.date || ev.start,
              end:   ev.end?.dateTime   || ev.end?.date   || ev.end,
              allDay: !!ev.start?.date,
              location: ev.location || "",
            });
          }
        } catch (err) {
          console.warn("[aether calendar] fetch failed for", eid, err);
        }
      }));
      all.sort((a, b) => new Date(a.start) - new Date(b.start));
      if (!cancelled) setEvents(all);
    })();
    return () => { cancelled = true; };
  }, [hass, calendarEntities.join(",")]);

  const today = new Date();
  const dayLabel = today.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const visible = events.slice(0, 3);

  return (
    <>
      <div className="home-panel calendar-panel" onClick={() => setDayOpen(true)}>
        <div className="home-panel-head">
          <span className="home-panel-title">Calendar</span>
          <span className="home-panel-meta">{dayLabel}</span>
        </div>
        <div className="home-panel-body">
          {visible.length === 0 ? (
            <div className="home-panel-empty">Nothing on the calendar today.</div>
          ) : (
            visible.map((ev, i) => (
              <div key={i} className="cal-event">
                <span className="cal-event-time">
                  {ev.allDay ? "All day" : formatEventTime(ev.start)}
                </span>
                <span className="cal-event-title">{ev.summary}</span>
              </div>
            ))
          )}
          {events.length > 3 && (
            <div className="cal-more">+ {events.length - 3} more · tap for day view</div>
          )}
        </div>
      </div>
      <CalendarDayModal
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        events={events}
        dayLabel={today.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      />
    </>
  );
}

function CalendarDayModal({ open, onClose, events, dayLabel }) {
  const scrollTop = useModalAnchor(open);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{dayLabel}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {events.length === 0 ? (
            <div style={{ color: "var(--ink-3)", padding: "12px 0" }}>
              Nothing on the calendar for today.
            </div>
          ) : events.map((ev, i) => (
            <div key={i} className="cal-day-row">
              <div className="cal-day-time">
                {ev.allDay
                  ? "All day"
                  : `${formatEventTime(ev.start)}${ev.end ? ` – ${formatEventTime(ev.end)}` : ""}`}
              </div>
              <div className="cal-day-info">
                <div className="cal-day-summary">{ev.summary}</div>
                {ev.location && <div className="cal-day-loc">{ev.location}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.querySelector("aether-panel") || document.body
  );
}

function formatEventTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// ─── Tile: Upcoming events (next 3 days) ────────────────────────────────
function UpcomingTile({ hass }) {
  const [byDay, setByDay] = React.useState([]);

  React.useEffect(() => {
    if (!hass) return;
    const calendarEntities = Object.keys(hass.states).filter((k) => k.startsWith("calendar."));
    if (calendarEntities.length === 0) return;
    let cancelled = false;
    (async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() + 1); // tomorrow
      const end = new Date(start);
      end.setDate(end.getDate() + 3); // through end of day after day after tomorrow
      end.setHours(23, 59, 59, 999);
      const startISO = start.toISOString();
      const endISO   = end.toISOString();
      const all = [];
      await Promise.all(calendarEntities.map(async (eid) => {
        try {
          const list = await hass.callApi(
            "GET",
            `calendars/${eid}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
          );
          for (const ev of list || []) {
            all.push({
              summary: ev.summary || "Untitled",
              start: ev.start?.dateTime || ev.start?.date || ev.start,
              allDay: !!ev.start?.date,
            });
          }
        } catch {}
      }));
      all.sort((a, b) => new Date(a.start) - new Date(b.start));

      // Group by day
      const groups = new Map();
      for (const ev of all) {
        const d = new Date(ev.start);
        const key = d.toDateString();
        if (!groups.has(key)) groups.set(key, { date: d, events: [] });
        groups.get(key).events.push(ev);
      }
      if (!cancelled) setByDay([...groups.values()].slice(0, 3));
    })();
    return () => { cancelled = true; };
  }, [hass]);

  return (
    <div className="home-panel upcoming-panel">
      <div className="home-panel-head">
        <span className="home-panel-title">Next 3 days</span>
      </div>
      <div className="home-panel-body">
        {byDay.length === 0 ? (
          <div className="home-panel-empty">Nothing scheduled.</div>
        ) : byDay.map((day, di) => (
          <div key={di} className="upcoming-day">
            <div className="upcoming-day-head">
              {day.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            </div>
            {day.events.slice(0, 3).map((ev, ei) => (
              <div key={ei} className="cal-event">
                <span className="cal-event-time">
                  {ev.allDay ? "All day" : formatEventTime(ev.start)}
                </span>
                <span className="cal-event-title">{ev.summary}</span>
              </div>
            ))}
            {day.events.length > 3 && (
              <div className="cal-more">+ {day.events.length - 3} more</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tile: To-Do ─────────────────────────────────────────────────────────
// Persists tasks in HA frontend user data. Each task: { id, text, done }.
function TodoTile({ hass }) {
  const [tasks, setTasks] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [filter, setFilter] = React.useState("all"); // all | active | done

  React.useEffect(() => {
    if (!hass) return;
    (async () => {
      let value = null;
      try {
        const r = await hass.callWS({ type: "frontend/get_user_data", key: "aether_todos" });
        if (Array.isArray(r?.value)) value = r.value;
      } catch {}
      if (!value) {
        try {
          const local = localStorage.getItem("aether_todos");
          if (local) value = JSON.parse(local);
        } catch {}
      }
      setTasks(value || []);
      setLoaded(true);
    })();
  }, [hass]);

  const save = async (next) => {
    setTasks(next);
    try { localStorage.setItem("aether_todos", JSON.stringify(next)); } catch {}
    try {
      await hass?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_todos",
        value: next,
      });
    } catch {}
  };

  const add = () => {
    const t = input.trim();
    if (!t) return;
    save([...tasks, { id: crypto.randomUUID(), text: t, done: false }]);
    setInput("");
  };
  const toggle = (id) => save(tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id) => save(tasks.filter((t) => t.id !== id));
  const clearDone = () => save(tasks.filter((t) => !t.done));

  const filtered = tasks.filter((t) =>
    filter === "active" ? !t.done :
    filter === "done"   ?  t.done : true
  );

  return (
    <div className="home-panel todo-panel">
      <div className="home-panel-head">
        <span className="home-panel-title">To-Do</span>
        <div className="todo-filters">
          {["all", "active", "done"].map((f) => (
            <button
              key={f}
              className={"todo-filter" + (filter === f ? " on" : "")}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "active" ? "Active" : "Done"}
            </button>
          ))}
          <button
            className="todo-clear"
            disabled={!tasks.some((t) => t.done)}
            onClick={clearDone}
          >
            Clear done
          </button>
        </div>
      </div>
      <div className="home-panel-body">
        <div className="todo-add">
          <input
            type="text"
            placeholder="Add a task… (press Enter)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <button onClick={add} disabled={!input.trim()}>Add</button>
        </div>
        <div className="todo-list">
          {!loaded ? null
            : filtered.length === 0 ? (
            <div className="home-panel-empty">
              {filter === "done" ? "No completed tasks." :
               filter === "active" ? "Nothing active." :
               "Nothing here yet."}
            </div>
          ) : filtered.map((t) => (
            <div key={t.id} className={"todo-row" + (t.done ? " done" : "")}>
              <button
                className={"todo-check" + (t.done ? " on" : "")}
                onClick={() => toggle(t.id)}
                aria-label={t.done ? "Mark active" : "Mark done"}
              >
                {t.done ? "✓" : ""}
              </button>
              <span className="todo-text">{t.text}</span>
              <button
                className="todo-remove"
                onClick={() => remove(t.id)}
                aria-label="Remove"
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tile: Notes ─────────────────────────────────────────────────────────
function NotesTile({ hass }) {
  const [notes, setNotes] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);

  React.useEffect(() => {
    if (!hass) return;
    (async () => {
      let value = null;
      try {
        const r = await hass.callWS({ type: "frontend/get_user_data", key: "aether_notes" });
        if (Array.isArray(r?.value)) value = r.value;
      } catch {}
      if (!value) {
        try {
          const local = localStorage.getItem("aether_notes");
          if (local) value = JSON.parse(local);
        } catch {}
      }
      setNotes(value || []);
      setLoaded(true);
    })();
  }, [hass]);

  const save = async (next) => {
    setNotes(next);
    try { localStorage.setItem("aether_notes", JSON.stringify(next)); } catch {}
    try {
      await hass?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_notes",
        value: next,
      });
    } catch {}
  };

  const newNote = () => {
    const id = crypto.randomUUID();
    const note = {
      id,
      title: "",
      body: "",
      drawing: null,
      updatedAt: Date.now(),
    };
    save([...notes, note]);
    setEditingId(id);
  };
  const updateNote = (id, patch) => {
    save(notes.map((n) => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
  };
  const removeNote = (id) => {
    save(notes.filter((n) => n.id !== id));
    setEditingId(null);
  };

  const editing = notes.find((n) => n.id === editingId);

  return (
    <div className="home-panel notes-panel">
      <div className="home-panel-head">
        <span className="home-panel-title">Notes</span>
        <span className="home-panel-meta">{notes.length}</span>
        <button className="notes-new-btn" onClick={newNote}>+ New note</button>
      </div>
      <div className="home-panel-body">
        {!loaded ? null : (
          <div className="notes-grid">
            <button className="note-card note-card-new" onClick={newNote}>
              <span>+ New note</span>
            </button>
            {notes.slice().reverse().map((n) => (
              <button
                key={n.id}
                className="note-card"
                onClick={() => setEditingId(n.id)}
              >
                <div className="note-card-title">{n.title || "Untitled"}</div>
                <div className="note-card-snippet">
                  {stripHtmlSnippet(n.body) || (n.drawing ? "[drawing]" : "")}
                </div>
                <div className="note-card-time">{relativeTime(n.updatedAt)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <NoteEditor
        note={editing}
        onChange={(patch) => editingId && updateNote(editingId, patch)}
        onDelete={() => editingId && removeNote(editingId)}
        onClose={() => setEditingId(null)}
      />
    </div>
  );
}

function stripHtmlSnippet(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").trim().slice(0, 120);
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60)       return "now";
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400*7)  return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Note editor modal ──────────────────────────────────────────────────
function NoteEditor({ note, onChange, onDelete, onClose }) {
  const open = !!note;
  const scrollTop = useModalAnchor(open);
  const [mode, setMode] = React.useState("text"); // text | draw
  const [title, setTitle] = React.useState("");
  const bodyRef = React.useRef(null);
  const wroteInitialBody = React.useRef(false);

  // Reset state when a different note opens
  React.useEffect(() => {
    if (!open) return;
    setTitle(note.title || "");
    setMode(note.drawing ? "draw" : "text");
    wroteInitialBody.current = false;
  }, [note?.id, open]);

  // Push the HTML body into the contentEditable div exactly once per
  // open. Re-applying innerHTML on every render would clobber the
  // user's typing position.
  React.useEffect(() => {
    if (!open) return;
    if (wroteInitialBody.current) return;
    if (!bodyRef.current) return;
    bodyRef.current.innerHTML = note.body || "";
    wroteInitialBody.current = true;
  }, [open, note?.id]);

  if (!open) return null;

  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    if (bodyRef.current) onChange({ body: bodyRef.current.innerHTML });
  };

  const onTitleChange = (e) => {
    setTitle(e.target.value);
    onChange({ title: e.target.value });
  };
  const onBodyInput = () => {
    if (!bodyRef.current) return;
    onChange({ body: bodyRef.current.innerHTML });
  };

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal note-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="note-editor-head">
          <input
            className="note-editor-title"
            placeholder="Untitled"
            value={title}
            onChange={onTitleChange}
          />
          <div className="note-editor-head-actions">
            <button className="note-editor-delete" onClick={onDelete}>Delete</button>
            <button className="note-editor-done" onClick={onClose}>Done</button>
          </div>
        </div>
        <div className="note-editor-toolbar">
          <button className={"note-tool" + (mode === "text" ? " on" : "")} onClick={() => setMode("text")}>
            <span style={{ fontWeight: 700 }}>Aa</span>
          </button>
          {mode === "text" && (
            <>
              <button className="note-tool" onClick={() => exec("bold")}><b>B</b></button>
              <button className="note-tool" onClick={() => exec("italic")}><i>I</i></button>
              <button className="note-tool" onClick={() => exec("underline")}><u>U</u></button>
              <button className="note-tool" onClick={() => exec("insertUnorderedList")}>• List</button>
              <button className="note-tool" onClick={() => exec("insertOrderedList")}>1. List</button>
              <button className="note-tool" onClick={() => exec("formatBlock", "H2")}>H</button>
              <button className="note-tool" onClick={() => exec("formatBlock", "BLOCKQUOTE")}>"</button>
            </>
          )}
          <button
            className={"note-tool note-draw-toggle" + (mode === "draw" ? " on" : "")}
            onClick={() => setMode("draw")}
            style={{ marginLeft: "auto" }}
          >
            ✎ Draw
          </button>
        </div>
        <div className="note-editor-body">
          {mode === "text" ? (
            <div
              ref={bodyRef}
              className="note-editor-text"
              contentEditable
              suppressContentEditableWarning
              onInput={onBodyInput}
              data-placeholder="Begin your note…"
            />
          ) : (
            <NoteCanvas
              initial={note.drawing}
              onChange={(drawing) => onChange({ drawing })}
            />
          )}
        </div>
      </div>
    </div>,
    document.querySelector("aether-panel") || document.body
  );
}

// ─── Note drawing canvas ────────────────────────────────────────────────
// Stores strokes as SVG path data (lightweight, scalable). Each stroke
// has { d, color, width }. The whole drawing is one SVG saved to
// note.drawing.
function NoteCanvas({ initial, onChange }) {
  const [strokes, setStrokes] = React.useState(() => initial?.strokes || []);
  const [color, setColor] = React.useState(initial?.lastColor || "#1a1a1a");
  const [width, setWidth] = React.useState(initial?.lastWidth || 2);
  const drawingRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 600, h: 400 });

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ w: Math.max(200, cr.width), h: Math.max(200, cr.height) });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const pushDrawing = (next) => {
    setStrokes(next);
    onChange({ strokes: next, lastColor: color, lastWidth: width });
  };

  const posOf = (ev) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const onPointerDown = (ev) => {
    if (ev.target.closest(".note-canvas-tools")) return;
    ev.preventDefault();
    wrapRef.current?.setPointerCapture(ev.pointerId);
    const p = posOf(ev);
    drawingRef.current = { d: `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`, color, width, points: 1 };
    // Add the stroke immediately so we render it as the user moves
    pushDrawing([...strokes, drawingRef.current]);
  };
  const onPointerMove = (ev) => {
    if (!drawingRef.current) return;
    const p = posOf(ev);
    drawingRef.current.d += ` L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    drawingRef.current.points += 1;
    setStrokes((s) => {
      const copy = s.slice();
      copy[copy.length - 1] = { ...drawingRef.current };
      return copy;
    });
  };
  const onPointerUp = (ev) => {
    if (!drawingRef.current) return;
    try { wrapRef.current?.releasePointerCapture(ev.pointerId); } catch {}
    if (drawingRef.current.points < 2) {
      // Tap = small dot. Add a tiny L so it renders as a point.
      const p = posOf(ev);
      drawingRef.current.d += ` L${(p.x + .1).toFixed(1)} ${(p.y + .1).toFixed(1)}`;
    }
    pushDrawing([...strokes.slice(0, -1), { ...drawingRef.current }]);
    drawingRef.current = null;
  };

  const undo = () => pushDrawing(strokes.slice(0, -1));
  const clear = () => pushDrawing([]);

  return (
    <div className="note-canvas">
      <div className="note-canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
        {["#1a1a1a", "#d63a3a", "#1f7ad8", "#2f8f63", "#c97a17"].map((c) => (
          <button
            key={c}
            className={"canvas-color" + (color === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="canvas-tool-sep" />
        {[1, 2, 4, 8].map((w) => (
          <button
            key={w}
            className={"canvas-width" + (width === w ? " on" : "")}
            onClick={() => setWidth(w)}
          >
            <span style={{
              display: "inline-block",
              width: 14, height: w + 1, borderRadius: 999,
              background: "var(--ink)",
            }} />
          </button>
        ))}
        <span className="canvas-tool-sep" />
        <button className="canvas-action" onClick={undo} disabled={strokes.length === 0}>Undo</button>
        <button className="canvas-action" onClick={clear} disabled={strokes.length === 0}>Clear</button>
      </div>
      <div
        ref={wrapRef}
        className="note-canvas-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
          {strokes.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage });
