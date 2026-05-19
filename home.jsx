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
  { id: "now-playing",   label: "Now playing",    wide: true  },
  { id: "house-rooms",   label: "The house",      wide: false },
  { id: "todo",          label: "To-Do",          wide: false },
  { id: "sports",        label: "Sports",         wide: false },
  { id: "news",          label: "News",           wide: false },
  { id: "pinned-music",  label: "Pinned music",   wide: true  },
  { id: "notes",         label: "Notes",          wide: true  },
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
      case "todo":
        return <TodoTile {...shared} />;
      case "sports":
        return <SportsTile {...shared} />;
      case "news":
        return <NewsTile {...shared} />;
      case "pinned-music":
        return <PinnedMusicTile {...shared} playingRooms={playingRooms} liveRooms={liveRooms} />;
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

// Inline style objects for note-editor controls so they render with
// Aether's warm theme even if home.css isn't loaded on the client.
const NOTE_TOOL = {
  border: "1px solid var(--hairline, rgba(15,28,46,.08))",
  background: "var(--paper, #ffffff)",
  color: "var(--ink, #14181f)",
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 12,
  cursor: "pointer",
  minWidth: 32,
  lineHeight: 1.2,
};
const NOTE_TOOL_ACTIVE = {
  ...NOTE_TOOL,
  background: "rgba(0,0,0,.08)",
  borderColor: "rgba(0,0,0,.18)",
};
const NOTE_BTN_SECONDARY = {
  border: "1px solid var(--hairline, rgba(15,28,46,.08))",
  background: "var(--paper, #ffffff)",
  color: "var(--ink, #14181f)",
  padding: "8px 16px",
  borderRadius: 999,
  fontSize: 12,
  cursor: "pointer",
};
const NOTE_BTN_PRIMARY = {
  border: 0,
  background: "var(--accent, #2A6FDB)",
  color: "white",
  padding: "8px 18px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

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
    <div
      className="modal-backdrop home-modal-fixed"
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        width: "auto", height: "auto",
        background: "rgba(15, 28, 46, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px",
        zIndex: 99999,
      }}
    >
      <div
        className="modal note-editor-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper, #ffffff)",
          color: "var(--ink, #14181f)",
          borderRadius: 22,
          width: "min(800px, 92vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,.05), 0 20px 60px rgba(20,18,14,.10)",
          border: "1px solid var(--hairline-2, rgba(15,28,46,.05))",
        }}
      >
        <div
          className="note-editor-head"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "18px 22px 14px",
            borderBottom: "1px solid var(--hairline-2, rgba(15,28,46,.05))",
          }}
        >
          <input
            className="note-editor-title"
            placeholder="Untitled"
            value={title}
            onChange={onTitleChange}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 22,
              fontWeight: 500,
              color: "var(--ink, #14181f)",
            }}
          />
          <div className="note-editor-head-actions" style={{ display: "flex", gap: 8 }}>
            <button
              className="note-editor-delete"
              onClick={onDelete}
              style={NOTE_BTN_SECONDARY}
            >Delete</button>
            <button
              className="note-editor-done"
              onClick={onClose}
              style={NOTE_BTN_PRIMARY}
            >Done</button>
          </div>
        </div>
        <div
          className="note-editor-toolbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            padding: "10px 22px",
            borderBottom: "1px solid var(--hairline-2, rgba(15,28,46,.05))",
          }}
        >
          <button
            className={"note-tool" + (mode === "text" ? " on" : "")}
            onClick={() => setMode("text")}
            style={mode === "text" ? NOTE_TOOL_ACTIVE : NOTE_TOOL}
          >
            <span style={{ fontWeight: 700 }}>Aa</span>
          </button>
          {mode === "text" && (
            <>
              <button className="note-tool" onClick={() => exec("bold")} style={NOTE_TOOL}><b>B</b></button>
              <button className="note-tool" onClick={() => exec("italic")} style={NOTE_TOOL}><i>I</i></button>
              <button className="note-tool" onClick={() => exec("underline")} style={NOTE_TOOL}><u>U</u></button>
              <button className="note-tool" onClick={() => exec("insertUnorderedList")} style={NOTE_TOOL}>• List</button>
              <button className="note-tool" onClick={() => exec("insertOrderedList")} style={NOTE_TOOL}>1. List</button>
              <button className="note-tool" onClick={() => exec("formatBlock", "H2")} style={NOTE_TOOL}>H</button>
              <button className="note-tool" onClick={() => exec("formatBlock", "BLOCKQUOTE")} style={NOTE_TOOL}>"</button>
            </>
          )}
          <button
            className={"note-tool note-draw-toggle" + (mode === "draw" ? " on" : "")}
            onClick={() => setMode("draw")}
            style={{ ...(mode === "draw" ? NOTE_TOOL_ACTIVE : NOTE_TOOL), marginLeft: "auto" }}
          >
            ✎ Draw
          </button>
        </div>
        <div
          className="note-editor-body"
          style={{
            flex: 1,
            minHeight: 360,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {mode === "text" ? (
            <div
              ref={bodyRef}
              className="note-editor-text"
              contentEditable
              suppressContentEditableWarning
              onInput={onBodyInput}
              data-placeholder="Begin your note…"
              style={{
                flex: 1,
                minHeight: 360,
                padding: "18px 24px",
                fontSize: 15,
                lineHeight: 1.6,
                outline: "none",
                overflowY: "auto",
                color: "var(--ink, #14181f)",
              }}
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
    document.body
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

// ─── Tile: Sports ────────────────────────────────────────────────────────
// Reads ESPN's public scoreboard API for each enabled league, filters for
// the user's favorite teams, and surfaces live → today → next-up. Tapping
// the tile opens a modal showing today's games across every enabled
// league (not just favorites). No API key needed.
const SPORTS_LEAGUES = {
  mlb: { sport: "baseball",   path: "mlb",                      name: "MLB" },
  nfl: { sport: "football",   path: "nfl",                      name: "NFL" },
  nba: { sport: "basketball", path: "nba",                      name: "NBA" },
  nhl: { sport: "hockey",     path: "nhl",                      name: "NHL" },
  mls: { sport: "soccer",     path: "usa.1",                    name: "MLS" },
  epl: { sport: "soccer",     path: "eng.1",                    name: "Premier League" },
  ucl: { sport: "soccer",     path: "uefa.champions",           name: "Champions League" },
  cfb: { sport: "football",   path: "college-football",         name: "College FB" },
  cbb: { sport: "basketball", path: "mens-college-basketball",  name: "College BB" },
  ufc: { sport: "mma",        path: "ufc",                      name: "UFC" },
};

function SportsTile({ hass }) {
  const cfg = window.AETHER_CONFIG?.sports || {};
  const leagues = cfg.leagues || ["mlb", "nfl", "nba", "epl", "ucl", "mls", "ufc"];
  const favorites = cfg.favorites || {};

  const tileLimit = cfg.tileLimit || 6;

  const [byLeague, setByLeague] = React.useState({});
  const [loaded, setLoaded] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [leagueFilter, setLeagueFilter] = React.useState("all");

  React.useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const out = {};
      await Promise.all(leagues.map(async (key) => {
        const def = SPORTS_LEAGUES[key];
        if (!def) return;
        const url = `https://site.api.espn.com/apis/site/v2/sports/${def.sport}/${def.path}/scoreboard`;
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const j = await r.json();
          out[key] = parseEspnScoreboard(j, key);
        } catch (err) {
          console.warn("[aether sports] fetch failed:", key, err);
        }
      }));
      if (!cancelled) {
        setByLeague(out);
        setLoaded(true);
      }
    };
    fetchAll();
    // Refresh every 90s so live scores keep moving without hammering.
    const tick = setInterval(fetchAll, 90_000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [leagues.join(",")]);

  // Build the "tile preview" list.
  //   - Only games within the next 7 days (drops ESPN's preseason
  //     placeholders that show up at 12:00 AM months out).
  //   - Favorites always bubble to the top.
  //   - In "All leagues" mode, the remaining slots are filled by
  //     round-robining one non-favorite game per league at a time, so
  //     a league with 10 concurrent games can't shut out a league with
  //     1 game (e.g. an MLB Friday night vs an NHL playoff game).
  //   - In single-league mode, just show favorites then everything
  //     else from that league.
  const previewGames = React.useMemo(() => {
    const now = Date.now();
    const weekOut = now + 7 * 86400 * 1000;
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

    const favGames = [];
    const otherByLeague = {};   // leagueKey -> sorted [games]

    for (const lk of leagues) {
      if (leagueFilter !== "all" && lk !== leagueFilter) continue;
      const games = byLeague[lk] || [];
      const favSet = favorites[lk];
      const bucket = [];
      for (const g of games) {
        const t = new Date(g.date).getTime();
        if (Number.isNaN(t)) continue;
        if (t > weekOut) continue;                                       // > 7 days out: skip
        if (t < startOfToday.getTime() && g.state !== "in") continue;    // past, not live: skip
        const isFav = favSet === true ||
          (Array.isArray(favSet) && favSet.some((abbr) =>
            g.home?.abbreviation === abbr || g.away?.abbreviation === abbr
          ));
        const item = { ...g, leagueKey: lk, isFavorite: isFav };
        if (isFav) favGames.push(item); else bucket.push(item);
      }
      otherByLeague[lk] = bucket;
    }

    const rank = (g) => g.state === "in" ? 0 : g.state === "pre" ? 1 : 2;
    const sortFn = (a, b) => rank(a) - rank(b) || new Date(a.date) - new Date(b.date);
    favGames.sort(sortFn);
    for (const lk of Object.keys(otherByLeague)) otherByLeague[lk].sort(sortFn);

    const result = [...favGames];

    if (leagueFilter !== "all") {
      result.push(...(otherByLeague[leagueFilter] || []));
      return result.slice(0, tileLimit);
    }

    // Round-robin: one game per league per pass.
    while (result.length < tileLimit) {
      let added = 0;
      for (const lk of leagues) {
        if (result.length >= tileLimit) break;
        const bucket = otherByLeague[lk];
        if (bucket && bucket.length > 0) {
          result.push(bucket.shift());
          added += 1;
        }
      }
      if (added === 0) break;
    }
    return result;
  }, [byLeague, leagues.join(","), JSON.stringify(favorites), leagueFilter, tileLimit]);

  // Helpers for the league filter UI inside the panel head.
  const stopClick = (e) => e.stopPropagation();

  return (
    <>
      <div className="home-panel sports-panel" onClick={() => setModalOpen(true)}>
        <div className="home-panel-head">
          <span className="home-panel-title">Sports</span>
          <select
            className="sports-league-filter"
            value={leagueFilter}
            onClick={stopClick}
            onChange={(e) => { e.stopPropagation(); setLeagueFilter(e.target.value); }}
          >
            <option value="all">All leagues</option>
            {leagues.map((lk) => (
              <option key={lk} value={lk}>
                {SPORTS_LEAGUES[lk]?.name || lk.toUpperCase()}
              </option>
            ))}
          </select>
          <span className="home-panel-meta" style={{ marginLeft: "auto" }}>
            Tap for all
          </span>
        </div>
        <div className="home-panel-body">
          {!loaded ? null : previewGames.length === 0 ? (
            <div className="home-panel-empty">
              {leagueFilter === "all"
                ? "No games in the next 7 days for your enabled leagues."
                : "Nothing scheduled in this league for the next 7 days."}
            </div>
          ) : previewGames.map((g, i) => (
            <SportsRow key={g.id || i} game={g} leagueName={SPORTS_LEAGUES[g.leagueKey]?.name} />
          ))}
        </div>
      </div>
      <SportsAllModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        leagues={leagues}
        byLeague={byLeague}
      />
    </>
  );
}

function SportsRow({ game, leagueName }) {
  return (
    <div className={"sports-row state-" + (game.state || "pre") + (game.isFavorite ? " is-fav" : "")}>
      <span className="sports-row-league">{leagueName}</span>
      <span className="sports-row-teams">
        <span className="sports-team">
          {game.away?.abbreviation || "—"}
          {game.state !== "pre" && <b className="sports-score">{game.away?.score ?? ""}</b>}
        </span>
        <span className="sports-at">@</span>
        <span className="sports-team">
          {game.home?.abbreviation || "—"}
          {game.state !== "pre" && <b className="sports-score">{game.home?.score ?? ""}</b>}
        </span>
      </span>
      <span className="sports-row-status">
        {game.state === "in"   ? (game.statusDetail || "Live")
        : game.state === "post" ? "Final"
        : formatGameTime(game.date)}
      </span>
    </div>
  );
}

function formatGameTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d >= today    && d < tomorrow) return time;
  if (d >= tomorrow && d < dayAfter) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function SportsAllModal({ open, onClose, leagues, byLeague }) {
  const scrollTop = useModalAnchor(open);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div
      className="modal-backdrop home-modal-fixed"
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        width: "auto", height: "auto",
        background: "rgba(15, 28, 46, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: "32px 20px",
        zIndex: 99999,
      }}
    >
      <div
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--paper, #ffffff)",
          color: "var(--ink, #14181f)",
          borderRadius: 22,
          width: "min(760px, 92vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,.05), 0 20px 60px rgba(20,18,14,.10)",
          border: "1px solid var(--hairline-2, rgba(15,28,46,.05))",
        }}
      >
        <div className="modal-head">
          <h3>Today's scores</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "72vh", overflowY: "auto" }}>
          {leagues.map((lk) => {
            const games = byLeague[lk] || [];
            if (games.length === 0) return null;
            return (
              <div key={lk} className="sports-modal-league">
                <div className="sports-modal-league-head">
                  {SPORTS_LEAGUES[lk]?.name || lk.toUpperCase()}
                </div>
                {games.map((g) => (
                  <SportsRow key={g.id} game={g} leagueName="" />
                ))}
              </div>
            );
          })}
          {Object.values(byLeague).every((g) => (g || []).length === 0) && (
            <div style={{ color: "var(--ink-3)", padding: "12px 0" }}>
              No games scheduled today across the enabled leagues.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function parseEspnScoreboard(json, leagueKey) {
  const events = json?.events || [];
  return events.map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
    const status = ev.status?.type || {};
    const teamShape = (c) => c ? {
      abbreviation: c.team?.abbreviation || c.team?.shortDisplayName || "",
      name:         c.team?.displayName  || c.team?.name || "",
      score:        c.score || "0",
      logo:         c.team?.logo || "",
    } : null;
    return {
      id: ev.id,
      leagueKey,
      date: ev.date,
      state: status.state,            // "pre" | "in" | "post"
      statusDetail: ev.status?.shortDetail || status.shortDetail || status.description,
      home: teamShape(home),
      away: teamShape(away),
    };
  });
}

// ─── Tile: News ──────────────────────────────────────────────────────────
// Pulls a configurable list of RSS feeds through api.rss2json.com (free,
// keyless, CORS-friendly) and shows the freshest headlines across all
// feeds. Tapping a headline fires the existing `aether_browser_open` event
// so the article opens in the in-app browser modal.
function NewsTile({ hass }) {
  const cfg = window.AETHER_CONFIG?.news || {};
  // Note: Reuters killed their public RSS feeds in 2020 — defaults below
  // are sources that still publish working RSS as of this writing.
  const feeds = cfg.feeds || [
    { name: "BBC",   url: "http://feeds.bbci.co.uk/news/rss.xml" },
    { name: "NPR",   url: "https://feeds.npr.org/1001/rss.xml" },
    { name: "Verge", url: "https://www.theverge.com/rss/index.xml" },
    { name: "HN",    url: "https://hnrss.org/frontpage" },
    { name: "ESPN",  url: "https://www.espn.com/espn/rss/news" },
  ];
  const count = cfg.count || 8;

  const [items, setItems] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [sourceFilter, setSourceFilter] = React.useState("all");

  React.useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const all = [];
      await Promise.all(feeds.map(async (f) => {
        try {
          const r = await fetch(
            `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f.url)}`
          );
          if (!r.ok) return;
          const j = await r.json();
          for (const it of (j.items || []).slice(0, 8)) {
            all.push({
              source: f.name,
              title: it.title || "",
              link:  it.link  || "",
              date:  it.pubDate || "",
              image: it.thumbnail || it.enclosure?.link || "",
            });
          }
        } catch (err) {
          console.warn("[aether news] fetch failed:", f.url, err);
        }
      }));
      all.sort((a, b) => new Date(b.date) - new Date(a.date));
      if (!cancelled) {
        setItems(all);
        setLoaded(true);
      }
    };
    fetchAll();
    const tick = setInterval(fetchAll, 10 * 60_000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [JSON.stringify(feeds)]);

  const openArticle = (url) => {
    if (!hass || !url) return;
    try {
      hass.callApi("POST", "events/aether_browser_open", {
        kind: "url", value: url, title: "Article",
      });
    } catch (err) {
      try { window.open(url, "_blank", "noopener"); } catch {}
    }
  };

  // Build the source list from the items we actually received so the
  // dropdown never lists a feed that failed to fetch.
  const sources = React.useMemo(
    () => Array.from(new Set(items.map((i) => i.source))),
    [items]
  );
  const filtered = sourceFilter === "all"
    ? items
    : items.filter((i) => i.source === sourceFilter);
  const visible = filtered.slice(0, count);

  return (
    <div className="home-panel news-panel">
      <div className="home-panel-head">
        <span className="home-panel-title">News</span>
        <select
          className="news-source-filter"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="home-panel-meta" style={{ marginLeft: "auto" }}>
          {visible.length}
        </span>
      </div>
      <div className="home-panel-body">
        {!loaded ? null : visible.length === 0 ? (
          <div className="home-panel-empty">
            {sourceFilter === "all"
              ? "No headlines right now."
              : `Nothing from ${sourceFilter} right now.`}
          </div>
        ) : visible.map((it, i) => (
          <button
            key={i}
            className="news-row"
            onClick={() => openArticle(it.link)}
          >
            <span className="news-row-meta">
              <span className="news-source">{it.source}</span>
              <span className="news-time">
                {it.date ? relativeTime(new Date(it.date).getTime()) : ""}
              </span>
            </span>
            <span className="news-title">{decodeHtmlEntities(it.title)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function decodeHtmlEntities(s) {
  if (!s) return "";
  const tmp = document.createElement("textarea");
  tmp.innerHTML = s;
  return tmp.value;
}

// ─── Tile: Pinned music ──────────────────────────────────────────────────
// Mirrors the music page's Listen Now pins (stored at user_data key
// "aether_pins"). Tap a pin → play on the first playing room, or the first
// configured room if nothing is currently playing.
function PinnedMusicTile({ hass, navigate, playingRooms, liveRooms }) {
  const [pins, setPins] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!hass) return;
    let cancelled = false;
    (async () => {
      let value = null;
      try {
        const r = await hass.callWS({ type: "frontend/get_user_data", key: "aether_pins" });
        if (Array.isArray(r?.value)) value = r.value;
      } catch {}
      if (!value) {
        try {
          const local = localStorage.getItem("aether_pins");
          if (local) value = JSON.parse(local);
        } catch {}
      }
      if (!cancelled) {
        setPins(value || []);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [hass]);

  const targetRoom = playingRooms[0] || liveRooms[0];

  const play = (pin) => {
    if (!hass || !pin?.media_content_id || !targetRoom?.mediaPlayer) {
      navigate("music");
      return;
    }
    if (pin.can_expand && !pin.can_play) {
      // Drill-in items (artists, etc.) — punt to the music page so the
      // user can browse inside.
      navigate("music");
      return;
    }
    callService(hass, "media_player.play_media", {
      entity_id:          targetRoom.mediaPlayer,
      media_content_id:   pin.media_content_id,
      media_content_type: pin.media_content_type || "album",
    });
  };

  return (
    <div className="home-panel pinned-music-panel">
      <div className="home-panel-head">
        <span className="home-panel-title">Pinned music</span>
        <span className="home-panel-meta">{pins.length}</span>
        <button
          className="pinned-music-open"
          onClick={() => navigate("music")}
        >Open library</button>
      </div>
      <div className="home-panel-body">
        {!loaded ? null : pins.length === 0 ? (
          <div className="home-panel-empty">
            No pins yet. Tap the bookmark on any album, playlist, or artist
            in the music library to pin it here.
          </div>
        ) : (
          <div className="pinned-music-grid">
            {pins.slice(0, 8).map((p) => (
              <button
                key={p.media_content_id}
                className="pinned-music-card"
                onClick={() => play(p)}
                title={p.title}
              >
                {p.image
                  ? <img src={p.image} alt="" loading="lazy" />
                  : <div className="pinned-music-art-placeholder" />}
                <span className="pinned-music-card-title">{p.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { HomePage });
