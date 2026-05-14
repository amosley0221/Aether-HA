/* Music page — wired to Music Assistant / media_player entities via hass.
   Reads live state from hass.states[room.mediaPlayer], renders rooms rail
   with real playing/track/artist/volume, drives transport + per-room
   controls via media_player.* services, browses MA library through the
   media_player/browse_media WebSocket call. */

function MusicPage() {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  const [primaryId, setPrimaryId] = React.useState(null); // resolved from hass below
  const [userSelectedPrimary, setUserSelectedPrimary] = React.useState(false);
  const [drag, setDrag]       = React.useState(null);
  const [over, setOver]       = React.useState(null);
  const [tab, setTab]         = React.useState("Library");
  const [search, setSearch]   = React.useState("");

  // ─── Live room data derived from hass.states ─────────────────────────────
  const liveRooms = React.useMemo(() => {
    const mapped = cfg.rooms.map(room => {
      const p = hass?.states?.[room.mediaPlayer];
      const groupMembers = p?.attributes?.group_members || [];
      return {
        ...room,
        entity: p,
        entityId: room.mediaPlayer,
        state: p?.state || "unavailable",
        playing: p?.state === "playing",
        paused:  p?.state === "paused",
        track:   p?.attributes?.media_title || "",
        artist:  p?.attributes?.media_artist || "",
        album:   p?.attributes?.media_album_name || "",
        art:     p?.attributes?.entity_picture || null,
        volume:  Math.round((p?.attributes?.volume_level ?? 0) * 100),
        muted:   !!p?.attributes?.is_volume_muted,
        groupMembers,
        groupSize: groupMembers.length,
      };
    });
    // Stable sort: playing first, then paused, then everything else.
    const score = (r) => r.playing ? 0 : r.paused ? 1 : 2;
    return mapped.sort((a, b) => score(a) - score(b));
  }, [hass, cfg.rooms]);

  // Auto-pick primary: if the user hasn't selected a room manually, prefer the
  // first room that is actively playing, fall back to first with a real entity,
  // fall back to the configured primary, then first room overall.
  React.useEffect(() => {
    if (userSelectedPrimary && primaryId) return;
    const firstPlaying  = liveRooms.find(r => r.playing);
    const firstWithData = liveRooms.find(r => r.entity);
    const configured    = cfg.rooms.find(r => r.primary);
    const pick = firstPlaying || firstWithData || configured || cfg.rooms[0];
    if (pick && pick.id !== primaryId) setPrimaryId(pick.id);
  }, [liveRooms, userSelectedPrimary, primaryId, cfg.rooms]);

  const primary        = liveRooms.find(r => r.id === primaryId) || liveRooms[0];
  const primaryEntity  = primary?.entity;
  const playingPrimary = primary?.playing;

  // ─── Live progress (ticks every second from media_position) ──────────────
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

  // ─── Service helpers ─────────────────────────────────────────────────────
  const svc = (service, data) => callService(hass, service, data);
  const togglePrimary = () => primaryEntity && svc(
    playingPrimary ? "media_player.media_pause" : "media_player.media_play",
    { entity_id: primary.entityId }
  );
  const skipNext  = () => primaryEntity && svc("media_player.media_next_track", { entity_id: primary.entityId });
  const skipPrev  = () => primaryEntity && svc("media_player.media_previous_track", { entity_id: primary.entityId });
  const toggleShuffle = () => primaryEntity && svc("media_player.shuffle_set", {
    entity_id: primary.entityId,
    shuffle: !primaryEntity?.attributes?.shuffle,
  });
  const toggleRepeat = () => {
    if (!primaryEntity) return;
    const cur = primaryEntity?.attributes?.repeat || "off";
    const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
    svc("media_player.repeat_set", { entity_id: primary.entityId, repeat: next });
  };
  const setVol = (v) => primaryEntity && svc("media_player.volume_set", {
    entity_id: primary.entityId,
    volume_level: v / 100,
  });
  const seek = (s) => primaryEntity && svc("media_player.media_seek", {
    entity_id: primary.entityId,
    seek_position: s,
  });
  const playMedia = (mediaContentId, mediaContentType) => primaryEntity && svc("media_player.play_media", {
    entity_id: primary.entityId,
    media_content_id: mediaContentId,
    media_content_type: mediaContentType,
  });
  const togglePerRoom = (room) => {
    if (!room.entity) return;
    svc(room.playing ? "media_player.media_pause" : "media_player.media_play", { entity_id: room.entityId });
  };

  // ─── Drag-and-drop room grouping (calls media_player.join) ───────────────
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
    if (!dragged?.entityId || !target?.entityId) {
      setDrag(null); setOver(null);
      return;
    }
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
  const ungroupPrimary = () => primaryEntity?.attributes?.group_members?.length > 1
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
                    {room.playing && room.track
                      ? room.track
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
                  className={"action" + (primaryEntity?.attributes?.group_members?.length > 1 ? " on" : "")}
                  onClick={ungroupPrimary}
                  title={primaryEntity?.attributes?.group_members?.length > 1 ? "Ungroup" : "Drag a room onto this one to group"}
                >
                  <Icon name="group" /> {primaryEntity?.attributes?.group_members?.length > 1 ? `Grouped · ${primaryEntity.attributes.group_members.length}` : "Group"}
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
              className={"t-icon" + (primaryEntity?.attributes?.shuffle ? " on" : "")}
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
              className={"t-icon" + (primaryEntity?.attributes?.repeat && primaryEntity.attributes.repeat !== "off" ? " on" : "")}
              title={`Repeat (${primaryEntity?.attributes?.repeat || "off"})`}
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
              {primaryEntity?.attributes?.app_name || "Music Assistant"}
            </div>
          </div>

          {tab === "Search" ? (
            <LibSearch
              key={"search-" + primary?.entityId}
              entityId={primary?.entityId}
              hass={hass}
              playMedia={playMedia}
              initialQuery={search}
            />
          ) : (
            <LibBrowse
              key={tab + "-" + primary?.entityId}
              entityId={primary?.entityId}
              hass={hass}
              playMedia={playMedia}
              autoDrill={LIB_TAB_TARGETS[tab]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Per-tab default location inside the browse_media tree. Aether drills into
// the matching root child (case-insensitive title) before showing items so
// each tab lands somewhere useful instead of the generic provider list.
const LIB_TAB_TARGETS = {
  "Listen Now": ["Favorites", "Music Assistant", "Recently Played"],
  "Browse":     null, // root
  "Radio":      ["Radio Browser", "Radio stations", "Radio"],
  "Library":    ["Music Library", "Library", "Music Assistant"],
};

// Browses media via the media_player/browse_media WebSocket call. When
// autoDrill is provided it drills one level into the first matching child
// title (or chain of titles) and treats that as the effective root.
function LibBrowse({ entityId, hass, playMedia, autoDrill }) {
  const [path, setPath]       = React.useState([]);
  const [root, setRoot]       = React.useState(null);
  const [err, setErr]         = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!entityId || !hass) return;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        let node = await hass.callWS({
          type: "media_player/browse_media",
          entity_id: entityId,
        });
        if (autoDrill && Array.isArray(autoDrill)) {
          for (const wantedTitle of autoDrill) {
            const child = (node.children || []).find(
              (c) => c.title?.toLowerCase() === wantedTitle.toLowerCase()
            );
            if (child && child.can_expand) {
              node = await hass.callWS({
                type: "media_player/browse_media",
                entity_id: entityId,
                media_content_id: child.media_content_id,
                media_content_type: child.media_content_type,
              });
              break;
            }
          }
        }
        setRoot(node);
        setPath([]);
      } catch (e) {
        setErr(e?.message || String(e));
      }
      setLoading(false);
    })();
  }, [entityId, hass, JSON.stringify(autoDrill)]);

  const current = path.length ? path[path.length - 1] : root;

  const enter = async (child) => {
    if (child.can_play && !child.can_expand) {
      playMedia(child.media_content_id, child.media_content_type);
      return;
    }
    if (!child.can_expand) return;
    setLoading(true);
    try {
      const expanded = await hass.callWS({
        type: "media_player/browse_media",
        entity_id: entityId,
        media_content_id: child.media_content_id,
        media_content_type: child.media_content_type,
      });
      setPath([...path, expanded]);
      setErr(null);
    } catch (e) {
      setErr(e?.message || String(e));
    }
    setLoading(false);
  };
  const back = () => path.length > 0 && setPath(path.slice(0, -1));

  if (loading && !current) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
        Loading library…
      </div>
    );
  }
  if (err) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
        <div style={{ fontSize: 14, color: "#b6432e" }}>Couldn't load library</div>
        <div style={{ fontSize: 12, marginTop: 8 }}>{err}</div>
      </div>
    );
  }

  const items = current?.children || [];

  return (
    <div className="lib-section">
      <div className="lib-section-head">
        <h3>{path.length > 0 ? current?.title : "Your Library"}</h3>
        {path.length > 0 && (
          <button className="see-all" onClick={back}>← Back</button>
        )}
      </div>
      {items.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
          Nothing here.
        </div>
      ) : (
        <div className="album-row">
          {items.slice(0, 50).map((item, i) => {
            const hasArt = !!item.thumbnail;
            return (
              <div
                key={(item.media_content_id || "") + i}
                className="album"
                onClick={() => enter(item)}
                title={item.title}
              >
                <div
                  className="album-art"
                  style={hasArt
                    ? { backgroundImage: `url('${item.thumbnail}')`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { background: "linear-gradient(160deg, #6a6fc4 0%, #2a2e7a 100%)" }
                  }
                >
                  {!hasArt && <div className="label">{item.title}</div>}
                </div>
                <div className="album-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.title}
                </div>
                <div className="album-meta">
                  {item.media_class || item.media_content_type || ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Searches Music Assistant via the music_assistant/search WebSocket call.
// Falls back to a generic media_player.search_media service if the MA WS
// command isn't registered. Plays a tapped result on the primary player.
function LibSearch({ entityId, hass, playMedia, initialQuery }) {
  const [q, setQ]       = React.useState(initialQuery || "");
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]   = React.useState(null);

  // Sync if the speakers-card search above pushes a new query in
  React.useEffect(() => { if (initialQuery !== undefined) setQ(initialQuery); }, [initialQuery]);

  // Debounced search
  React.useEffect(() => {
    const term = q.trim();
    if (!term || !hass) { setData(null); setErr(null); return; }
    setLoading(true);
    setErr(null);
    const id = setTimeout(async () => {
      try {
        const result = await hass.callWS({
          type: "music_assistant/search",
          search_query: term,
          limit: 20,
        });
        setData(result);
      } catch (e) {
        setErr(e?.message || String(e));
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(id);
  }, [q, hass]);

  const sections = data ? [
    { title: "Artists",   items: data.artists   || [], type: "artist"   },
    { title: "Albums",    items: data.albums    || [], type: "album"    },
    { title: "Tracks",    items: data.tracks    || [], type: "track"    },
    { title: "Playlists", items: data.playlists || [], type: "playlist" },
    { title: "Radio",     items: data.radio     || [], type: "radio"    },
  ].filter(s => s.items.length > 0) : [];

  return (
    <div>
      <div
        className="search"
        style={{
          margin: "16px 0 4px",
          background: "var(--paper-2)",
          border: "1px solid var(--hairline)",
          padding: "9px 14px",
        }}
      >
        <Icon name="search" size={14} />
        <input
          autoFocus
          placeholder="Search artists, albums, tracks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {err ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
          <div style={{ fontSize: 14, color: "#b6432e" }}>Search failed</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>{err}</div>
          <div style={{ fontSize: 11, marginTop: 8, opacity: .7 }}>
            (Music Assistant search needs the music_assistant integration's WebSocket API)
          </div>
        </div>
      ) : loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
          Searching…
        </div>
      ) : !data && q.trim() ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
          Type to search
        </div>
      ) : !data ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--ink-3)" }}>
          <Icon name="search" size={28} />
          <div style={{ marginTop: 12, fontSize: 14 }}>
            Search artists, albums, tracks, and stations across your library.
          </div>
        </div>
      ) : sections.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>
          No results for “{q}”.
        </div>
      ) : sections.map(sec => (
        <div className="lib-section" key={sec.title}>
          <div className="lib-section-head">
            <h3>{sec.title}</h3>
          </div>
          <div className="album-row">
            {sec.items.slice(0, 10).map((item, i) => {
              const art = item.image || item.thumbnail || item.metadata?.images?.[0]?.path;
              const id  = item.uri || item.media_content_id || item.item_id;
              const type = item.media_type || item.media_content_type || sec.type;
              return (
                <div
                  key={(id || item.name) + i}
                  className="album"
                  onClick={() => playMedia(id, type)}
                  title={item.name || item.title}
                >
                  <div
                    className="album-art"
                    style={art
                      ? { backgroundImage: `url('${art}')`, backgroundSize: "cover", backgroundPosition: "center" }
                      : { background: "linear-gradient(160deg, #6a6fc4 0%, #2a2e7a 100%)" }
                    }
                  >
                    {!art && <div className="label">{item.name || item.title}</div>}
                  </div>
                  <div className="album-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name || item.title}
                  </div>
                  <div className="album-meta">
                    {item.artists?.map(a => a.name).join(", ") || item.artist || ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { MusicPage });
