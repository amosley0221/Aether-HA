/* Music page — wired to Music Assistant / media_player entities via hass.
   Reads live state from hass.states[room.mediaPlayer], renders rooms rail
   with real playing/track/artist/volume, drives transport + per-room
   controls via media_player.* services, and browses + searches MA library
   through a single Library component with stack-based navigation. */

function MusicPage() {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  // Keep hass behind a ref so library effects don't re-run on every state
  // tick (which caused the panel to flash / reset).
  const hassRef = React.useRef(hass);
  hassRef.current = hass;

  const [primaryId, setPrimaryId]                 = React.useState(null);
  const [userSelectedPrimary, setUserSelectedPrimary] = React.useState(false);
  const [drag, setDrag]     = React.useState(null);
  const [over, setOver]     = React.useState(null);
  const [tab, setTab]       = React.useState("Library");
  const [search, setSearch] = React.useState("");

  // ─── Live room data ──────────────────────────────────────────────────────
  // mediaPlayer (MA wrapper) is the control entity. displayPlayer (Sonos
  // bare) mirrors externally-controlled playback. The rail reads from
  // whichever sibling is most active; services always target mediaPlayer.
  const liveRooms = React.useMemo(() => {
    const score = (s) => s === "playing" ? 0 : s === "paused" ? 1 : s === "idle" ? 2 : 3;
    const mapped = cfg.rooms.map(room => {
      const ctrl    = hass?.states?.[room.mediaPlayer];
      const display = room.displayPlayer ? hass?.states?.[room.displayPlayer] : null;
      const active  = [ctrl, display].filter(Boolean).sort(
        (a, b) => score(a.state) - score(b.state)
      )[0] || ctrl || display;
      const a = active?.attributes || {};
      const groupMembers = a.group_members || ctrl?.attributes?.group_members || [];
      return {
        ...room,
        entity:   active,
        ctrl,
        entityId: room.mediaPlayer,
        state:    active?.state || "unavailable",
        playing:  active?.state === "playing",
        paused:   active?.state === "paused",
        track:    a.media_title || "",
        artist:   a.media_artist || "",
        album:    a.media_album_name || "",
        art:      a.entity_picture || null,
        volume:   Math.round(((ctrl?.attributes?.volume_level ?? a.volume_level) ?? 0) * 100),
        muted:    !!(ctrl?.attributes?.is_volume_muted ?? a.is_volume_muted),
        groupMembers,
        groupSize: groupMembers.length,
      };
    });
    return mapped.sort((a, b) => score(a.state) - score(b.state));
  }, [hass, cfg.rooms]);

  // Auto-primary: pick the first playing room. Once the user explicitly
  // selects a room, lock that choice — don't fight live state.
  React.useEffect(() => {
    if (userSelectedPrimary) return;
    const firstPlaying  = liveRooms.find(r => r.playing);
    const firstWithData = liveRooms.find(r => r.entity);
    const configured    = cfg.rooms.find(r => r.primary);
    const pick = firstPlaying || firstWithData || configured || cfg.rooms[0];
    if (pick && pick.id !== primaryId) setPrimaryId(pick.id);
  }, [liveRooms, userSelectedPrimary, cfg.rooms]);

  const primary        = liveRooms.find(r => r.id === primaryId) || liveRooms[0];
  const primaryEntity  = primary?.entity;
  const primaryCtrl    = primary?.ctrl;
  const playingPrimary = primary?.playing;

  // ─── Live progress ───────────────────────────────────────────────────────
  const duration = primaryEntity?.attributes?.media_duration || 0;
  const [progress, setProgress] = React.useState(0);
  React.useEffect(() => {
    if (!primaryEntity) { setProgress(0); return; }
    const a = primaryEntity.attributes;
    const updated = a.media_position_updated_at
      ? new Date(a.media_position_updated_at).getTime()
      : Date.now();
    const basePos = a.media_position || 0;
    const tick = () => {
      const elapsed = playingPrimary ? Math.max(0, (Date.now() - updated) / 1000) : 0;
      setProgress(Math.min(duration || 0, basePos + elapsed));
    };
    tick();
    if (!playingPrimary) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    primaryEntity?.attributes?.media_position,
    primaryEntity?.attributes?.media_position_updated_at,
    playingPrimary,
    duration,
  ]);

  // ─── Service helpers (always target the MA wrapper) ──────────────────────
  const svc = (service, data) => callService(hass, service, data);
  const togglePrimary = () => primary?.entityId && svc(
    playingPrimary ? "media_player.media_pause" : "media_player.media_play",
    { entity_id: primary.entityId }
  );
  const skipNext  = () => primary?.entityId && svc("media_player.media_next_track", { entity_id: primary.entityId });
  const skipPrev  = () => primary?.entityId && svc("media_player.media_previous_track", { entity_id: primary.entityId });
  const toggleShuffle = () => primary?.entityId && svc("media_player.shuffle_set", {
    entity_id: primary.entityId,
    shuffle: !primaryCtrl?.attributes?.shuffle,
  });
  const toggleRepeat = () => {
    if (!primary?.entityId) return;
    const cur = primaryCtrl?.attributes?.repeat || "off";
    const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
    svc("media_player.repeat_set", { entity_id: primary.entityId, repeat: next });
  };
  const setVol = (v) => primary?.entityId && svc("media_player.volume_set", {
    entity_id: primary.entityId, volume_level: v / 100,
  });
  const seek = (s) => primary?.entityId && svc("media_player.media_seek", {
    entity_id: primary.entityId, seek_position: s,
  });
  const playMedia = (mediaContentId, mediaContentType) => primary?.entityId && svc("media_player.play_media", {
    entity_id: primary.entityId,
    media_content_id: mediaContentId,
    media_content_type: mediaContentType,
  });
  const togglePerRoom = (room) => {
    if (!room.entityId) return;
    svc(room.playing ? "media_player.media_pause" : "media_player.media_play", { entity_id: room.entityId });
  };

  // ─── Drag-and-drop grouping ──────────────────────────────────────────────
  const onDragStart = (id) => (e) => {
    setDrag(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver  = (id) => (e) => { e.preventDefault(); setOver(id); };
  const onDragLeave = ()   => () => setOver(null);
  const onDrop      = (targetId) => async (e) => {
    e.preventDefault();
    if (!drag || drag === targetId) { setDrag(null); setOver(null); return; }
    const dragged = liveRooms.find(r => r.id === drag);
    const target  = liveRooms.find(r => r.id === targetId);
    if (!dragged?.entityId || !target?.entityId) { setDrag(null); setOver(null); return; }
    try {
      await svc("media_player.join", {
        entity_id: target.entityId,
        group_members: [dragged.entityId],
      });
    } catch (err) {
      console.warn("[aether] media_player.join failed:", err);
    }
    setDrag(null); setOver(null);
  };
  const onDragEnd = () => { setDrag(null); setOver(null); };
  const ungroupPrimary = () => primaryCtrl?.attributes?.group_members?.length > 1
    && svc("media_player.unjoin", { entity_id: primary.entityId });

  if (!hass) {
    return (
      <div className="page music" style={{ padding: 40 }}>
        <div style={{ color: "var(--ink-3)" }}>Connecting to Home Assistant…</div>
      </div>
    );
  }

  return (
    <div className="page music" data-screen-label="02 Music">
      {/* ─── Speakers card ──────────────────────────────────────────────── */}
      <div className="speakers-card">
        <div className="speakers-top">
          <button className="speakers-label" title="Linked service">
            <span className="swatch"></span> Speakers
          </button>
          <div className="search">
            <Icon name="search" size={14} />
            <input
              placeholder="Search your library"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim() && tab !== "Search") setTab("Search");
              }}
            />
          </div>
          <button className="btn-pill" title="Up next"><Icon name="up" /> Up Next</button>
          <button className="btn-pill" title="EQ"><Icon name="eq" /> EQ</button>
          <button className="btn-pill" style={{ padding: "7px 10px" }}><Icon name="more" size={16} /></button>
        </div>

        <div className="rooms-rail scroll-x">
          {liveRooms.map(room => {
            const isPrimary = room.id === primaryId;
            const className = [
              "room",
              !room.playing && "idle",
              drag === room.id && "dragging",
              over === room.id && drag && drag !== room.id && "drop-target",
              isPrimary && "active",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={room.id}
                className={className}
                draggable={!!room.entity}
                onDragStart={onDragStart(room.id)}
                onDragOver={onDragOver(room.id)}
                onDragLeave={onDragLeave()}
                onDrop={onDrop(room.id)}
                onDragEnd={onDragEnd}
                onClick={() => { setPrimaryId(room.id); setUserSelectedPrimary(true); }}
                title={room.entity ? "Drag onto another room to group" : `Player offline (${room.entityId})`}
              >
                <Avatar colors={room.color} />
                <div className="room-meta">
                  <span className="room-name">
                    {room.name}
                    {room.playing && <Bars />}
                  </span>
                  <span className="room-status">
                    {room.playing && room.track ? room.track
                      : room.state === "unavailable" ? "Offline"
                      : "Idle"}
                  </span>
                </div>
                <button
                  className="room-ctrl"
                  onClick={(e) => { e.stopPropagation(); togglePerRoom(room); }}
                  title={room.playing ? "Pause" : "Play"}
                >
                  <Icon name={room.playing ? "pause" : "play"} size={12} />
                </button>
                {room.groupSize > 1 && <span className="room-grouped-badge">+{room.groupSize - 1}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Main two-column body ────────────────────────────────────────── */}
      <div className="music-grid">
        {/* Now Playing */}
        <div className="np-card">
          <div className="np-top">
            <div
              className="np-art"
              style={primary?.art ? {
                backgroundImage: `url('${primary.art}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              } : undefined}
            >
              {!primary?.art && (
                <div className="np-art-meta">
                  <div className="t">{primary?.album || "—"}</div>
                  <div className="a">{(primary?.artist || "").toUpperCase()}</div>
                </div>
              )}
            </div>
            <div className="np-info">
              <div>
                <div className="eyebrow">Now Playing</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <Avatar colors={primary?.color || ["#4a8dd8","#1e3f7a"]} size={16} />
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{primary?.name}</span>
                </div>
                <div className="np-track">
                  {primary?.track || (primary?.playing ? "Playing" : primary?.state === "unavailable" ? "Offline" : "Nothing playing")}
                </div>
                <div className="np-artist">{primary?.artist}</div>
                <div className="np-album">{primary?.album}</div>
              </div>
              <div className="np-actions">
                <button className="action" title="Like (coming soon)"><Icon name="heart" /> Like</button>
                <button
                  className={"action" + (primaryCtrl?.attributes?.group_members?.length > 1 ? " on" : "")}
                  onClick={ungroupPrimary}
                  title={primaryCtrl?.attributes?.group_members?.length > 1 ? "Ungroup" : "Drag a room onto this one to group"}
                >
                  <Icon name="group" /> {primaryCtrl?.attributes?.group_members?.length > 1 ? `Grouped · ${primaryCtrl.attributes.group_members.length}` : "Group"}
                </button>
                <button className="action" style={{ padding: "7px 10px" }}><Icon name="more" /></button>
              </div>
            </div>
          </div>

          <div className="np-progress">
            <div
              className="np-bar"
              onClick={(e) => {
                if (!duration) return;
                const r = e.currentTarget.getBoundingClientRect();
                seek(Math.round(((e.clientX - r.left) / r.width) * duration));
              }}
            >
              <div className="np-bar-fill" style={{ width: `${duration ? (progress/duration)*100 : 0}%` }} />
            </div>
            <div className="np-times">
              <span>{fmt(progress)}</span>
              <span>{duration ? `−${fmt(duration - progress)}` : ""}</span>
            </div>
          </div>

          <div className="transport">
            <div />
            <button
              className={"t-icon" + (primaryCtrl?.attributes?.shuffle ? " on" : "")}
              title="Shuffle"
              onClick={toggleShuffle}
            >
              <Icon name="shuffle" size={18} />
            </button>
            <button className="t-icon" title="Previous" onClick={skipPrev}><Icon name="prev" size={20} /></button>
            <button
              className="t-play"
              onClick={togglePrimary}
              title={playingPrimary ? "Pause" : "Play"}
            >
              <Icon name={playingPrimary ? "pause" : "play"} size={22} />
            </button>
            <button className="t-icon" title="Next" onClick={skipNext}><Icon name="next" size={20} /></button>
            <button
              className={"t-icon" + (primaryCtrl?.attributes?.repeat && primaryCtrl.attributes.repeat !== "off" ? " on" : "")}
              title={`Repeat (${primaryCtrl?.attributes?.repeat || "off"})`}
              onClick={toggleRepeat}
            >
              <Icon name="repeat" size={18} />
            </button>
            <div />
          </div>

          <div className="np-volume">
            <Icon name="volume" />
            <input
              className="range"
              type="range"
              min="0" max="100"
              value={primary?.volume || 0}
              onChange={(e) => setVol(Number(e.target.value))}
            />
            <span className="vol-pct">{primary?.volume || 0}</span>
          </div>
        </div>

        {/* Library */}
        <div className="lib-card">
          <div className="lib-top">
            <div className="lib-tabs">
              {["Listen Now","Browse","Radio","Library","Search"].map(t => (
                <button
                  key={t}
                  className={"lib-tab" + (tab === t ? " active" : "")}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="lib-service">
              {primaryCtrl?.attributes?.app_name || "Music Assistant"}
            </div>
          </div>

          <Library
            key={tab + "-" + primary?.entityId}
            entityId={primary?.entityId}
            hassRef={hassRef}
            playMedia={playMedia}
            tab={tab}
            externalQuery={search}
          />
        </div>
      </div>
    </div>
  );
}

// Per-tab default location inside the browse_media tree.
const LIB_TAB_TARGETS = {
  "Listen Now": ["Favorites", "Music Assistant", "Recently Played"],
  "Browse":     null,
  "Radio":      ["Radio Browser", "Radio stations", "Radio"],
  "Library":    ["Music Library", "Library", "Music Assistant"],
};

// ─── Unified Library: stack-based navigation across browse + search ──────
function Library({ entityId, hassRef, playMedia, tab, externalQuery }) {
  // Each entry is { kind: "browse" | "search", node?, items?, query?, title? }
  const [stack, setStack]     = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]         = React.useState(null);
  const [query, setQuery]     = React.useState(externalQuery || "");

  // Sync external query (top speakers-card search bar)
  React.useEffect(() => {
    if (externalQuery !== undefined) setQuery(externalQuery);
  }, [externalQuery]);

  // Initial load on tab/entity change. Intentionally does NOT depend on hass
  // to avoid refetching on every state tick.
  React.useEffect(() => {
    if (!entityId || !hassRef.current) return;
    setErr(null);
    setStack([]);
    if (tab === "Search") {
      if (query.trim()) runSearch(query.trim());
    } else {
      runBrowse();
    }
  }, [tab, entityId]);

  // Debounced search re-run when query changes (Search tab only).
  React.useEffect(() => {
    if (tab !== "Search" || !entityId || !hassRef.current) return;
    const term = query.trim();
    if (!term) { setStack([]); return; }
    const id = setTimeout(() => runSearch(term), 300);
    return () => clearTimeout(id);
  }, [query, tab, entityId]);

  async function runBrowse() {
    setLoading(true);
    setErr(null);
    try {
      let node = await hassRef.current.callWS({
        type: "media_player/browse_media",
        entity_id: entityId,
      });
      const targets = LIB_TAB_TARGETS[tab];
      if (Array.isArray(targets)) {
        for (const want of targets) {
          const child = (node.children || []).find(
            (c) => c.title?.toLowerCase() === want.toLowerCase()
          );
          if (child && child.can_expand) {
            node = await hassRef.current.callWS({
              type: "media_player/browse_media",
              entity_id: entityId,
              media_content_id: child.media_content_id,
              media_content_type: child.media_content_type,
            });
            break;
          }
        }
      }
      setStack([{ kind: "browse", node, title: node.title || "Browse" }]);
    } catch (e) {
      setErr(e?.message || String(e));
    }
    setLoading(false);
  }

  async function runSearch(term) {
    setLoading(true);
    setErr(null);
    try {
      const r = await hassRef.current.callService(
        "media_player",
        "search_media",
        { search_query: term },
        { entity_id: entityId },
        true, true
      );
      const resp = r?.response;
      let items = [];
      if (resp?.[entityId]?.result)            items = resp[entityId].result;
      else if (resp?.result)                   items = resp.result;
      else if (Array.isArray(resp?.[entityId])) items = resp[entityId];
      else if (Array.isArray(resp))            items = resp;
      setStack([{ kind: "search", items, query: term, title: `Search: ${term}` }]);
    } catch (e) {
      setErr(e?.message || (typeof e === "string" ? e : JSON.stringify(e)));
    }
    setLoading(false);
  }

  async function enter(item) {
    // Leaf playable (track / radio) → play
    if (!item.can_expand) {
      if (item.can_play && item.media_content_id) {
        playMedia(item.media_content_id, item.media_content_type);
      }
      return;
    }
    // Expandable (artist / album / playlist / folder) → drill in
    setLoading(true);
    try {
      const node = await hassRef.current.callWS({
        type: "media_player/browse_media",
        entity_id: entityId,
        media_content_id: item.media_content_id,
        media_content_type: item.media_content_type,
      });
      setStack([...stack, { kind: "browse", node, title: node.title || item.title }]);
      setErr(null);
    } catch (e) {
      setErr(e?.message || String(e));
    }
    setLoading(false);
  }

  function back() {
    if (stack.length > 1) setStack(stack.slice(0, -1));
  }

  // Detect if children are a track list (all leaves playable, no folders)
  const isTrackList = (items) =>
    items.length > 0 && items.every(it =>
      (!it.can_expand && it.can_play) ||
      it.media_class === "track" ||
      it.media_class === "music"
    );

  const top = stack[stack.length - 1];

  // ─── Search input — always rendered on Search tab ─────────────────────
  const SearchBar = (
    <div className="lib-search-bar">
      <Icon name="search" size={14} />
      <input
        autoFocus
        placeholder="Search artists, albums, tracks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );

  if (err) {
    return (
      <div className="lib-body">
        {tab === "Search" && SearchBar}
        <div className="lib-status">
          <div style={{ color: "#b6432e", fontSize: 14 }}>Error</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>{err}</div>
        </div>
      </div>
    );
  }
  if (loading && !top) {
    return (
      <div className="lib-body">
        {tab === "Search" && SearchBar}
        <div className="lib-status">Loading…</div>
      </div>
    );
  }
  if (!top) {
    return (
      <div className="lib-body">
        {tab === "Search" && SearchBar}
        <div className="lib-status" style={{ paddingTop: 40 }}>
          {tab === "Search" ? (
            <>
              <Icon name="search" size={28} />
              <div style={{ marginTop: 12, fontSize: 14 }}>
                Search artists, albums, tracks, and stations.
              </div>
            </>
          ) : "Nothing to show."}
        </div>
      </div>
    );
  }

  return (
    <div className="lib-body">
      {tab === "Search" && SearchBar}

      <div className="lib-section-head">
        <h3>{top.title}</h3>
        {stack.length > 1 && (
          <button className="see-all" onClick={back}>← Back</button>
        )}
      </div>

      {loading && (
        <div className="lib-status" style={{ padding: "16px 0" }}>Loading…</div>
      )}

      {top.kind === "search"
        ? <SearchResults items={top.items} onEnter={enter} />
        : isTrackList(top.node?.children || [])
          ? <TrackList items={top.node.children} parent={top.node} onEnter={enter} />
          : <ItemGrid items={top.node?.children || []} onEnter={enter} />
      }
    </div>
  );
}

// Groups raw search results by class and renders sections
function SearchResults({ items, onEnter }) {
  const buckets = { artist: [], album: [], track: [], playlist: [], radio: [], other: [] };
  for (const it of items) {
    const cls = (it.media_class || it.media_content_type || "").toLowerCase();
    const key = ["artist","album","track","playlist","radio"].find(k => cls.includes(k)) || "other";
    buckets[key].push(it);
  }
  const sections = [
    { title: "Artists",   items: buckets.artist,   tracks: false },
    { title: "Albums",    items: buckets.album,    tracks: false },
    { title: "Tracks",    items: buckets.track,    tracks: true  },
    { title: "Playlists", items: buckets.playlist, tracks: false },
    { title: "Radio",     items: buckets.radio,    tracks: false },
    { title: "More",      items: buckets.other,    tracks: false },
  ].filter(s => s.items.length > 0);

  if (sections.length === 0) {
    return <div className="lib-status">No results.</div>;
  }
  return (
    <>
      {sections.map(sec => (
        <div className="lib-section" key={sec.title}>
          <div className="lib-section-head">
            <h3 style={{ fontSize: 14 }}>{sec.title}</h3>
          </div>
          {sec.tracks
            ? <TrackList items={sec.items.slice(0, 8)} onEnter={onEnter} />
            : <ItemGrid items={sec.items.slice(0, 10)} onEnter={onEnter} />
          }
        </div>
      ))}
    </>
  );
}

function ItemGrid({ items, onEnter }) {
  if (!items?.length) {
    return <div className="lib-status">Nothing here.</div>;
  }
  return (
    <div className="album-row">
      {items.slice(0, 30).map((item, i) => {
        const title = item.title || item.name;
        const art   = item.thumbnail || item.image;
        const type  = item.media_class || item.media_content_type || "";
        return (
          <div
            key={(item.media_content_id || title) + i}
            className="album"
            onClick={() => onEnter(item)}
            title={title}
          >
            <div
              className="album-art"
              style={art
                ? { backgroundImage: `url('${art}')`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: "linear-gradient(160deg, #6a6fc4 0%, #2a2e7a 100%)" }
              }
            >
              {!art && <div className="label">{title}</div>}
            </div>
            <div className="album-title">{title}</div>
            <div className="album-meta">{type}</div>
          </div>
        );
      })}
    </div>
  );
}

function TrackList({ items, parent, onEnter }) {
  if (!items?.length) return <div className="lib-status">No tracks.</div>;
  return (
    <div className="track-list">
      {items.map((it, i) => {
        const title = it.title || it.name;
        const art   = it.thumbnail || it.image || parent?.thumbnail;
        const meta  = it.media_class || it.media_content_type || "";
        return (
          <button
            key={(it.media_content_id || title) + i}
            className="track-row"
            onClick={() => onEnter(it)}
            title={title}
          >
            <div className="num">{i + 1}</div>
            <div
              className="thumb"
              style={art
                ? { backgroundImage: `url('${art}')`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: "linear-gradient(160deg, #6a6fc4, #2a2e7a)" }
              }
            />
            <div className="info">
              <div className="title">{title}</div>
              <div className="meta">{meta}</div>
            </div>
            <Icon name="play" size={14} />
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { MusicPage });
