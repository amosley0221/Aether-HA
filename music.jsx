/* Music page — wired to Music Assistant / media_player entities via hass.
   Reads live state from hass.states[room.mediaPlayer], renders rooms rail
   with real playing/track/artist/volume, drives transport + per-room
   controls via media_player.* services, and browses + searches MA library
   through a single Library component with stack-based navigation. */

const SEARCH_MEDIA_FEATURE = 4194304;
const supportsSearch = (st) =>
  ((st?.attributes?.supported_features || 0) & SEARCH_MEDIA_FEATURE) === SEARCH_MEDIA_FEATURE;

// Resolve the Music Assistant wrapper for a given configured media_player
// entity. If the configured ID already supports search_media we trust it.
// Otherwise we walk the _2 / _3 / _4 / ... siblings looking for the
// search-capable twin. Falls back to the configured ID even if no match
// (so service calls still go somewhere; they'll just error visibly).
function resolveMaPlayer(baseId, states) {
  if (!baseId || !states) return baseId;
  if (supportsSearch(states[baseId])) return baseId;
  const root = baseId.replace(/_\d+$/, "");
  // Try the root first, then numeric suffixes
  if (root !== baseId && supportsSearch(states[root])) return root;
  for (let i = 2; i <= 10; i++) {
    const cand = `${root}_${i}`;
    if (cand === baseId) continue;
    if (supportsSearch(states[cand])) return cand;
  }
  return baseId;
}

function MusicPage() {
  const hass = useHass();
  const cfg  = window.AETHER_CONFIG;

  // Keep hass behind a ref so library effects don't re-run on every state
  // tick (which caused the panel to flash / reset).
  const hassRef = React.useRef(hass);
  hassRef.current = hass;

  const [primaryId, setPrimaryId]                 = React.useState(null);
  const [userSelectedPrimary, setUserSelectedPrimary] = React.useState(false);
  const [drag, setDrag]       = React.useState(null);
  const [over, setOver]       = React.useState(null);
  const [tab, setTab]         = React.useState("Listen Now");
  const [search, setSearch]   = React.useState("");
  const [eqOpen, setEqOpen]   = React.useState(false);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [npFullscreen, setNpFullscreen] = React.useState(false);

  const railRef        = React.useRef(null);
  const pointerStart   = React.useRef(null);   // {id, x, y}
  const longPressTimer = React.useRef(null);

  // ─── Live room data ──────────────────────────────────────────────────────
  // mediaPlayer (MA wrapper) is the control entity. displayPlayer (Sonos
  // bare) mirrors externally-controlled playback. The rail reads from
  // whichever sibling is most active; services always target mediaPlayer.
  const liveRooms = React.useMemo(() => {
    const states = hass?.states || {};
    const mapped = cfg.rooms.map(room => {
      // Auto-resolve the MA wrapper if the configured entity isn't search-capable
      const resolvedCtrlId = resolveMaPlayer(room.mediaPlayer, states);
      const displayId      = room.displayPlayer
        || (resolvedCtrlId !== room.mediaPlayer ? room.mediaPlayer : resolvedCtrlId.replace(/_\d+$/, ""));
      const ctrl    = states[resolvedCtrlId];
      const display = displayId && displayId !== resolvedCtrlId ? states[displayId] : null;
      // The bare Sonos integration entity tracks the actual hardware state.
      // The MA wrapper is a layer that frequently desyncs (still reports
      // "playing" with stale track metadata after the queue auto-advances,
      // or when the user pauses from elsewhere). Treat the bare entity as
      // ground truth for state + display when it exists, and only fall
      // back to ctrl when there's no Sonos integration counterpart.
      const active      = display || ctrl;
      // Transport (play/pause/next/prev/seek/volume) targets the same
      // ground-truth bare entity. Library search + play_media still go
      // to the MA wrapper (entityId) since that's what supports search.
      const transportId = displayId || resolvedCtrlId;
      const a = active?.attributes || {};
      const groupMembers = a.group_members || ctrl?.attributes?.group_members || [];
      // Sonos source attributes (live on the bare integration entity). When
      // a soundbar is on TV / a player is on Line-in, HA's state often
      // shows "idle" even though audio is active — fall back to the source
      // attribute to surface what's really happening.
      const sourceList    = display?.attributes?.source_list || a.source_list || [];
      const currentSource = display?.attributes?.source || a.source || null;
      const onTvOrLineIn  = !!(currentSource && /\b(tv|line[\s-]?in|hdmi|airplay)\b/i.test(currentSource));
      return {
        ...room,
        entity:   active,
        ctrl,
        display,
        entityId:    resolvedCtrlId,   // MA wrapper — for search / play_media
        transportId,                   // bare Sonos — for transport control
        displayId,
        state:    active?.state || "unavailable",
        playing:  active?.state === "playing" || onTvOrLineIn,
        paused:   active?.state === "paused",
        track:    a.media_title || "",
        artist:   a.media_artist || "",
        album:    a.media_album_name || "",
        art:      a.entity_picture || null,
        volume:   Math.round(((a.volume_level ?? ctrl?.attributes?.volume_level) ?? 0) * 100),
        muted:    !!(a.is_volume_muted ?? ctrl?.attributes?.is_volume_muted),
        groupMembers,
        groupSize: groupMembers.length,
        sourceList,
        currentSource,
        onTvOrLineIn,
      };
    });
    // Sort rooms by playback state so the active ones surface first
    const score = (s) => s === "playing" ? 0 : s === "paused" ? 1 : s === "idle" ? 2 : 3;
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

  // ─── Service helpers ─────────────────────────────────────────────────────
  // Transport (play/pause/next/prev/seek/volume/shuffle/repeat) goes to the
  // bare Sonos entity (transportId) because MA wrappers desync from the
  // hardware on auto-advance. Search + play_media still hit the MA wrapper
  // (entityId) — only MA implements those.
  const svc = (service, data) => callService(hass, service, data);
  const togglePrimary = () => primary?.transportId && svc(
    playingPrimary ? "media_player.media_pause" : "media_player.media_play",
    { entity_id: primary.transportId }
  );
  const skipNext  = () => primary?.transportId && svc("media_player.media_next_track",     { entity_id: primary.transportId });
  const skipPrev  = () => primary?.transportId && svc("media_player.media_previous_track", { entity_id: primary.transportId });
  const toggleShuffle = () => primary?.transportId && svc("media_player.shuffle_set", {
    entity_id: primary.transportId,
    shuffle: !(primary?.entity?.attributes?.shuffle ?? primaryCtrl?.attributes?.shuffle),
  });
  const toggleRepeat = () => {
    if (!primary?.transportId) return;
    const cur = primary?.entity?.attributes?.repeat ?? primaryCtrl?.attributes?.repeat ?? "off";
    const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
    svc("media_player.repeat_set", { entity_id: primary.transportId, repeat: next });
  };
  const setVol = (v) => primary?.transportId && svc("media_player.volume_set", {
    entity_id: primary.transportId, volume_level: v / 100,
  });
  const seek = (s) => primary?.transportId && svc("media_player.media_seek", {
    entity_id: primary.transportId, seek_position: s,
  });
  const playMedia = (mediaContentId, mediaContentType) => primary?.entityId && svc("media_player.play_media", {
    entity_id: primary.entityId,
    media_content_id: mediaContentId,
    media_content_type: mediaContentType,
  });
  const togglePerRoom = (room) => {
    if (!room.transportId) return;
    svc(room.playing ? "media_player.media_pause" : "media_player.media_play", { entity_id: room.transportId });
  };

  // ─── Drag-to-group ──────────────────────────────────────────────────────
  // Uses raw touch + mouse events (NOT pointer events). iOS Safari fires
  // `pointercancel` aggressively the moment it suspects a scroll, killing
  // long-press detection. Touch events let us own the gesture from the
  // start and only block scrolling once drag has actually begun.
  //
  // Flow (touch):
  //   touchstart → start 320ms long-press timer.
  //   touchmove (passive: false):
  //     • drag not active yet: if finger moved >14px, cancel the timer
  //       (user is scrolling). Don't preventDefault — native scroll wins.
  //     • drag active: preventDefault to stop scroll, hit-test rooms under
  //       finger, update `over`.
  //   touchend: if drag+over → media_player.join. Quick tap → set primary.
  //   touchcancel: only abort if drag hasn't started; otherwise let the
  //     in-flight drag finish on touchend (iOS won't fire end after cancel,
  //     so we treat cancel-during-drag as a drop too).
  //
  // Flow (mouse): mirrors the same lifecycle via mousedown/mousemove/mouseup.

  const dragStateRef = React.useRef({ drag: null, over: null });
  React.useEffect(() => { dragStateRef.current = { drag, over }; }, [drag, over]);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const beginPress = (roomId, x, y) => {
    pointerStart.current = { id: roomId, x, y, time: Date.now() };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      setDrag(roomId);
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
    }, 320);
  };

  const updateOver = (clientX, clientY) => {
    if (!railRef.current) return;
    const candidates = railRef.current.querySelectorAll(".room");
    let foundId = null;
    for (const r of candidates) {
      const rect = r.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top  && clientY <= rect.bottom) {
        foundId = r.getAttribute("data-room-id");
        break;
      }
    }
    const cur = dragStateRef.current.drag;
    setOver(foundId && foundId !== cur ? foundId : null);
  };

  const finishDrag = async () => {
    cancelLongPress();
    stopEdgeScroll();
    const ps = pointerStart.current;
    pointerStart.current = null;
    const { drag: curDrag, over: curOver } = dragStateRef.current;
    if (curDrag && curOver) {
      const dragged = liveRooms.find(r => r.id === curDrag);
      const target  = liveRooms.find(r => r.id === curOver);
      // Prefer the bare Sonos / native integration entity for join: the
      // Sonos integration handles native multi-room grouping, while the
      // MA wrapper's join can be a no-op depending on MA version. Fall
      // back to entityId (MA wrapper) for non-Sonos rooms.
      const targetJoinId  = target?.displayId  || target?.entityId;
      const draggedJoinId = dragged?.displayId || dragged?.entityId;
      if (draggedJoinId && targetJoinId) {
        console.log("[aether] joining", draggedJoinId, "→", targetJoinId);
        try {
          await svc("media_player.join", {
            entity_id: targetJoinId,
            group_members: [draggedJoinId],
          });
        } catch (err) {
          console.warn("[aether] media_player.join failed:", err);
        }
      }
    } else if (ps && !curDrag) {
      const dt = Date.now() - ps.time;
      if (dt < 500) {
        setPrimaryId(ps.id);
        setUserSelectedPrimary(true);
      }
    }
    setDrag(null);
    setOver(null);
  };

  const onRoomTouchStart = (roomId) => (e) => {
    if (e.target.closest(".room-ctrl")) return;
    const t = e.touches[0];
    if (!t) return;
    beginPress(roomId, t.clientX, t.clientY);
  };

  const onRoomMouseDown = (roomId) => (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".room-ctrl")) return;
    beginPress(roomId, e.clientX, e.clientY);
  };

  // Edge auto-scroll while dragging. Native horizontal scroll on the rail
  // is disabled mid-drag (we preventDefault touchmove), so if the user
  // drags toward the rail's left/right edge we scroll programmatically
  // each frame to reveal off-screen rooms.
  const edgeScrollRAF = React.useRef(null);
  const edgeScrollVel = React.useRef(0);
  const lastPointer   = React.useRef(null);
  const stopEdgeScroll = () => {
    if (edgeScrollRAF.current) {
      cancelAnimationFrame(edgeScrollRAF.current);
      edgeScrollRAF.current = null;
    }
    edgeScrollVel.current = 0;
  };
  const updateEdgeScroll = (clientX) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const edge = 90;        // px from edge where auto-scroll engages
    const maxSpeed = 20;    // px per frame at the very edge
    let vel = 0;
    if (clientX < rect.left + edge) {
      vel = -maxSpeed * Math.min(1, (rect.left + edge - clientX) / edge);
    } else if (clientX > rect.right - edge) {
      vel =  maxSpeed * Math.min(1, (clientX - (rect.right - edge)) / edge);
    }
    edgeScrollVel.current = vel;
    if (vel !== 0 && !edgeScrollRAF.current) {
      const tick = () => {
        const v = edgeScrollVel.current;
        const r = railRef.current;
        if (!v || !r) { edgeScrollRAF.current = null; return; }
        const before = r.scrollLeft;
        r.scrollLeft = before + v;
        // If scroll didn't move (hit end), stop spinning.
        if (r.scrollLeft === before) { edgeScrollRAF.current = null; return; }
        // While auto-scrolling, re-hit-test under the current finger position
        // since rooms slide under it without further touchmove events.
        const last = lastPointer.current;
        if (last) updateOver(last.x, last.y);
        edgeScrollRAF.current = requestAnimationFrame(tick);
      };
      edgeScrollRAF.current = requestAnimationFrame(tick);
    } else if (vel === 0 && edgeScrollRAF.current) {
      cancelAnimationFrame(edgeScrollRAF.current);
      edgeScrollRAF.current = null;
    }
  };

  React.useEffect(() => {
    const onTouchMove = (e) => {
      const ps = pointerStart.current;
      if (!ps) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - ps.x;
      const dy = t.clientY - ps.y;
      if (!dragStateRef.current.drag) {
        if (Math.hypot(dx, dy) > 14) cancelLongPress();
        return;
      }
      e.preventDefault();
      lastPointer.current = { x: t.clientX, y: t.clientY };
      updateOver(t.clientX, t.clientY);
      updateEdgeScroll(t.clientX);
    };
    const onTouchEnd  = () => { finishDrag(); };
    const onTouchCancel = () => {
      // iOS sometimes fires touchcancel right when we preventDefault during
      // an active drag. If we're already dragging, treat it as a drop.
      if (dragStateRef.current.drag) {
        finishDrag();
      } else {
        cancelLongPress();
        pointerStart.current = null;
      }
    };
    const onMouseMove = (e) => {
      const ps = pointerStart.current;
      if (!ps) return;
      const dx = e.clientX - ps.x;
      const dy = e.clientY - ps.y;
      if (!dragStateRef.current.drag) {
        if (Math.hypot(dx, dy) > 14) cancelLongPress();
        return;
      }
      e.preventDefault();
      lastPointer.current = { x: e.clientX, y: e.clientY };
      updateOver(e.clientX, e.clientY);
      updateEdgeScroll(e.clientX);
    };
    const onMouseUp = () => { finishDrag(); };

    document.addEventListener("touchmove",  onTouchMove,  { passive: false });
    document.addEventListener("touchend",   onTouchEnd);
    document.addEventListener("touchcancel", onTouchCancel);
    document.addEventListener("mousemove",  onMouseMove);
    document.addEventListener("mouseup",    onMouseUp);
    return () => {
      document.removeEventListener("touchmove",  onTouchMove);
      document.removeEventListener("touchend",   onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      document.removeEventListener("mousemove",  onMouseMove);
      document.removeEventListener("mouseup",    onMouseUp);
      stopEdgeScroll();
    };
  }, [liveRooms]);

  const ungroupPrimary = () => primaryCtrl?.attributes?.group_members?.length > 1
    && svc("media_player.unjoin", { entity_id: primary.entityId });

  // ─── Like / favorite the current track via MA ───────────────────────────
  // MA's HA integration exposes different service names per version. Try a
  // chain of likely candidates so the heart "just works" wherever possible.
  const [liked, setLiked] = React.useState(false);
  React.useEffect(() => { setLiked(false); }, [primaryCtrl?.attributes?.media_content_id]);

  const toggleLike = async () => {
    const ent = primary?.entityId;
    const ct  = primaryCtrl?.attributes;
    const mediaId   = ct?.media_content_id;
    const mediaType = ct?.media_content_type;
    if (!ent || !mediaId) return;
    const want = !liked;
    setLiked(want);
    const attempts = want ? [
      { service: "music_assistant.add_track_to_library",   data: { track_uri: mediaId } },
      { service: "music_assistant.favorite",               data: { entity_id: ent, uri: mediaId, media_type: mediaType } },
      { ws: { type: "music_assistant/library/add_favorite", uri: mediaId, media_type: mediaType } },
    ] : [
      { service: "music_assistant.remove_track_from_library", data: { track_uri: mediaId } },
      { service: "music_assistant.unfavorite",                data: { entity_id: ent, uri: mediaId, media_type: mediaType } },
      { ws: { type: "music_assistant/library/remove_favorite", uri: mediaId, media_type: mediaType } },
    ];
    for (const a of attempts) {
      try {
        if (a.service) {
          const [d, s] = a.service.split(".");
          await hass.callService(d, s, a.data);
        } else {
          await hass.callWS(a.ws);
        }
        return; // success
      } catch (_) { /* try next */ }
    }
    setLiked(!want); // revert optimistic toggle if all attempts failed
    console.warn("[aether] No MA favorite service responded — install/update Music Assistant integration.");
  };

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
          <button className="btn-pill" title="EQ & audio features" onClick={() => setEqOpen(true)}>
            <Icon name="eq" /> EQ
          </button>
          <button className="btn-pill" style={{ padding: "7px 10px" }}><Icon name="more" size={16} /></button>
        </div>

        <div className={"rooms-rail scroll-x" + (drag ? " dragging-active" : "")} ref={railRef}>
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
                data-room-id={room.id}
                onTouchStart={onRoomTouchStart(room.id)}
                onMouseDown={onRoomMouseDown(room.id)}
                title={room.entity ? "Hold and drag onto another room to group" : `Player offline (${room.entityId})`}
              >
                <Avatar colors={room.color} />
                <div className="room-meta">
                  <span className="room-name">
                    {room.name}
                    {room.groupSize > 1 && (
                      <span className="room-grouped-badge">+{room.groupSize - 1}</span>
                    )}
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
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Main two-column body ────────────────────────────────────────── */}
      <div className="music-grid">
        {/* Now Playing */}
        <div className="np-card">
          <button
            className="np-expand-btn"
            onClick={() => setNpFullscreen(true)}
            title="Expand to full screen"
            aria-label="Expand Now Playing"
          >
            <Icon name="expand" size={16} />
          </button>
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
                  {primary?.track
                    || (primary?.onTvOrLineIn ? primary.currentSource
                        : primary?.playing ? "Playing"
                        : primary?.state === "unavailable" ? "Offline"
                        : "Nothing playing")}
                </div>
                <div className="np-artist">{primary?.artist}</div>
                <div className="np-album">{primary?.album}</div>
              </div>
              <div className="np-actions">
                <button
                  className={"action" + (liked ? " on" : "")}
                  onClick={toggleLike}
                  title={liked ? "Remove from library" : "Add to library"}
                >
                  <Icon name="heart" /> {liked ? "Liked" : "Like"}
                </button>
                <button
                  className={"action" + (primaryCtrl?.attributes?.group_members?.length > 1 ? " on" : "")}
                  onClick={ungroupPrimary}
                  title={primaryCtrl?.attributes?.group_members?.length > 1 ? "Ungroup" : "Drag a room onto this one to group"}
                >
                  <Icon name="group" /> {primaryCtrl?.attributes?.group_members?.length > 1 ? `Grouped · ${primaryCtrl.attributes.group_members.length}` : "Group"}
                </button>
                {primary?.displayId && (
                  <button
                    className={"action" + (primary?.onTvOrLineIn ? " on" : "")}
                    onClick={() => setSourceOpen(true)}
                    title={primary?.currentSource ? `Source · ${primary.currentSource}` : "Switch source (TV / Line-in / Queue)"}
                  >
                    <Icon name="more" /> {primary?.onTvOrLineIn ? primary.currentSource : "Source"}
                  </button>
                )}
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

          {/* When the primary is the leader of a group, expose a slider per
              member so each speaker can be balanced independently. */}
          {primaryCtrl?.attributes?.group_members?.length > 1 && (
            <div className="np-group-volumes">
              <div className="np-group-volumes-head">Per-room volume</div>
              {primaryCtrl.attributes.group_members.map(memberId => {
                const member = hass.states[memberId];
                if (!member) return null;
                const name = member.attributes.friendly_name || memberId.split(".")[1];
                const vol  = Math.round((member.attributes.volume_level ?? 0) * 100);
                return (
                  <div key={memberId} className="np-group-row">
                    <span className="np-group-name">{name}</span>
                    <input
                      className="range thin"
                      type="range" min="0" max="100"
                      value={vol}
                      onChange={(e) => callService(hass, "media_player.volume_set", {
                        entity_id: memberId,
                        volume_level: Number(e.target.value) / 100,
                      })}
                    />
                    <span className="np-group-pct">{vol}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Library */}
        <div className="lib-card">
          <div className="lib-top">
            <div className="lib-tabs">
              {["Listen Now","Library","Search"].map(t => (
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
              {cfg.serviceLabel || "Apple Music"}
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

      <EQDialog
        open={eqOpen}
        onClose={() => setEqOpen(false)}
        room={primary}
        hass={hass}
      />
      <SourceDialog
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        room={primary}
        hass={hass}
      />
      {npFullscreen && (
        <NowPlayingFullscreen
          room={primary}
          primaryCtrl={primaryCtrl}
          playing={playingPrimary}
          progress={progress}
          duration={duration}
          onClose={() => setNpFullscreen(false)}
          onToggle={togglePrimary}
          onNext={skipNext}
          onPrev={skipPrev}
          onShuffle={toggleShuffle}
          onRepeat={toggleRepeat}
          onSeek={seek}
          onVolume={setVol}
        />
      )}
    </div>
  );
}

// ─── Now Playing fullscreen overlay ───────────────────────────────────────
// Full-viewport "lock screen" style player. Always renders the currently
// selected primary room. Album art on the left, metadata + controls on the
// right. While open, the app's brandbar + chat FAB are hidden (via a class
// on the panel host) so the player owns the screen. Dismissed via the
// chev-down button (top-right) or the Escape key.
function NowPlayingFullscreen({
  room, primaryCtrl, playing, progress, duration,
  onClose, onToggle, onNext, onPrev, onShuffle, onRepeat, onSeek, onVolume,
}) {
  const scrollTop = useModalAnchor(true);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Hide app chrome (brandbar + chat FAB) while fullscreen is up. The
    // class has to live on an element inside the same DOM tree as our
    // stylesheet, otherwise CSS rules can't see it. aether-mount is the
    // div the React app is rendered into — guaranteed to be a sibling of
    // the brandbar/chat-fab in the same tree as music.css. Falls back to
    // the panel host or documentElement (latter won't actually work
    // across HA's shadow DOM, but is harmless).
    const host = window.__aetherMount
      || document.querySelector("aether-panel")
      || document.documentElement;
    host.classList.add("np-fs-active");
    return () => {
      window.removeEventListener("keydown", onKey);
      host.classList.remove("np-fs-active");
    };
  }, [onClose]);

  if (!room) return null;

  const art = room.art;
  const artStyle = art ? {
    backgroundImage: `url('${art}')`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  } : undefined;
  const trackText = room.track
    || (room.onTvOrLineIn ? room.currentSource
        : room.playing ? "Playing"
        : room.state === "unavailable" ? "Offline"
        : "Nothing playing");
  const c1 = (room.color && room.color[0]) || "#4a8dd8";
  const c2 = (room.color && room.color[1]) || "#1e3f7a";

  return (
    <div className="np-fullscreen" style={{ top: scrollTop }}>
      {art
        ? <div className="np-fs-backdrop" style={artStyle} />
        : <div className="np-fs-backdrop" style={{
            background: `radial-gradient(120% 100% at 30% 30%, ${c1} 0%, ${c2} 60%, #0a0e16 100%)`,
          }} />
      }
      <div className="np-fs-dim" />

      <button
        className="np-fs-close"
        onClick={onClose}
        title="Exit full screen (Esc)"
        aria-label="Exit full screen"
      >
        <Icon name="chevDown" size={26} />
      </button>

      <div className="np-fs-inner">
        <div className="np-fs-art" style={artStyle}>
          {!art && (
            <div className="np-fs-art-fallback">
              <Icon name="music" size={96} />
            </div>
          )}
        </div>

        <div className="np-fs-side">
          <div className="np-fs-room">
            <Avatar colors={room.color || ["#4a8dd8","#1e3f7a"]} size={18} />
            <span>{room.name}</span>
          </div>

          <div className="np-fs-meta">
            <div className="np-fs-track">{trackText}</div>
            {room.artist && <div className="np-fs-artist">{room.artist}</div>}
            {room.album  && <div className="np-fs-album">{room.album}</div>}
          </div>

          <div className="np-fs-progress">
            <div
              className="np-fs-bar"
              onClick={(e) => {
                if (!duration) return;
                const r = e.currentTarget.getBoundingClientRect();
                onSeek(Math.round(((e.clientX - r.left) / r.width) * duration));
              }}
            >
              <div className="np-fs-bar-fill" style={{ width: `${duration ? (progress/duration)*100 : 0}%` }} />
            </div>
            <div className="np-fs-times">
              <span>{fmt(progress)}</span>
              <span>{duration ? `−${fmt(duration - progress)}` : ""}</span>
            </div>
          </div>

          <div className="np-fs-transport">
            <button
              className={"t-icon" + (primaryCtrl?.attributes?.shuffle ? " on" : "")}
              title="Shuffle"
              onClick={onShuffle}
            >
              <Icon name="shuffle" size={22} />
            </button>
            <button className="t-icon" title="Previous" onClick={onPrev}>
              <Icon name="prev" size={28} />
            </button>
            <button
              className="t-play np-fs-play"
              onClick={onToggle}
              title={playing ? "Pause" : "Play"}
            >
              <Icon name={playing ? "pause" : "play"} size={32} />
            </button>
            <button className="t-icon" title="Next" onClick={onNext}>
              <Icon name="next" size={28} />
            </button>
            <button
              className={"t-icon" + (primaryCtrl?.attributes?.repeat && primaryCtrl.attributes.repeat !== "off" ? " on" : "")}
              title={`Repeat (${primaryCtrl?.attributes?.repeat || "off"})`}
              onClick={onRepeat}
            >
              <Icon name="repeat" size={22} />
            </button>
          </div>

          <div className="np-fs-volume">
            <Icon name="volume" size={18} />
            <input
              className="range np-fs-range"
              type="range" min="0" max="100"
              value={room.volume || 0}
              onChange={(e) => onVolume(Number(e.target.value))}
            />
            <span className="np-fs-vol-pct">{room.volume || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Per-tab default location inside the browse_media tree. Each value is a
// list of CHAINS; each chain is the sequence of folder titles to drill
// through. The first chain that fully resolves is used. Title matching is
// case-insensitive and substring-tolerant so minor wording differences
// across MA versions still match.
const LIB_TAB_TARGETS = {
  "Listen Now": [
    ["Apple Music", "Listen Now"],
    ["Apple Music", "For You"],
    ["Apple Music", "Recently Added"],
    ["Favorites"],
  ],
  "Library":    [
    ["Music Library"],
    ["Library"],
  ],
};

// Pins persistence — HA's per-user storage (syncs across browsers/devices),
// with a localStorage fallback. Stored as an array of { title, image,
// media_content_id, media_content_type } objects.
function usePins(hassRef) {
  const [pins, setPins]     = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);

  // Migrate legacy pin entries that were saved before can_expand / can_play
  // were tracked. Albums and artists were always expandable, so the safe
  // default is true on both — that lets tapping a pre-existing pin drill in
  // (previously enter() bailed because can_expand was undefined).
  const migratePin = (p) => ({
    can_expand: true,
    can_play:   true,
    thumbnail:  p.thumbnail || p.image,
    image:      p.image     || p.thumbnail,
    ...p,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let initial = null;
      try {
        const r = await hassRef.current.callWS({
          type: "frontend/get_user_data",
          key:  "aether_pins",
        });
        if (Array.isArray(r?.value)) initial = r.value;
      } catch {/* WS storage unavailable */}
      if (initial == null) {
        try {
          const stored = localStorage.getItem("aether_pins");
          if (stored) initial = JSON.parse(stored);
        } catch {}
      }
      if (!cancelled) {
        setPins(Array.isArray(initial) ? initial.map(migratePin) : []);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (next) => {
    setPins(next);
    try { localStorage.setItem("aether_pins", JSON.stringify(next)); } catch {}
    try {
      await hassRef.current?.callWS({
        type: "frontend/set_user_data",
        key:  "aether_pins",
        value: next,
      });
    } catch {}
  };

  const isPinned = (id) => pins.some(p => p.media_content_id === id);

  const addPin = (item) => {
    const id = item.media_content_id;
    if (!id || isPinned(id)) return;
    // Default unknown items (e.g. search results) to expandable so the click
    // handler drills into them instead of doing nothing.
    const canExpand = item.can_expand !== undefined ? item.can_expand : true;
    const canPlay   = item.can_play   !== undefined ? item.can_play   : true;
    save([...pins, {
      title: item.title || item.name,
      image: item.thumbnail || item.image,
      media_content_id:   id,
      media_content_type: item.media_content_type || item.media_type,
      thumbnail:          item.thumbnail || item.image,
      can_expand:         canExpand,
      can_play:           canPlay,
    }]);
  };

  const removePin = (id) => save(pins.filter(p => p.media_content_id !== id));

  return { pins, addPin, removePin, isPinned, loaded };
}

// ─── Unified Library: stack-based navigation across browse + search ──────
function Library({ entityId, hassRef, playMedia, tab, externalQuery }) {
  // Each entry is { kind: "browse" | "search", node?, items?, query?, title? }
  const [stack, setStack]     = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]         = React.useState(null);
  const [query, setQuery]     = React.useState(externalQuery || "");

  const { pins, addPin, removePin, isPinned, loaded: pinsLoaded } = usePins(hassRef);
  const togglePin = (item) => {
    const id = item.media_content_id;
    if (!id) return;
    if (isPinned(id)) removePin(id);
    else addPin(item);
  };

  // Sync external query (top speakers-card search bar)
  React.useEffect(() => {
    if (externalQuery !== undefined) setQuery(externalQuery);
  }, [externalQuery]);

  // Initial load on tab/entity change. Listen Now seeds a "pins" entry on
  // the stack so drilling into a pin pushes onto it (and back pops back
  // to the pin grid) — putting pins on the stack keeps the navigation
  // model the same as search and browse.
  React.useEffect(() => {
    if (!entityId || !hassRef.current) return;
    setErr(null);
    setStack([]);
    if (tab === "Listen Now") {
      // Stack initialization deferred to the pins-loaded effect below
      return;
    }
    if (tab === "Search") {
      if (query.trim()) runSearch(query.trim());
    } else {
      runBrowse();
    }
  }, [tab, entityId]);

  // When pins finish loading (or tab switches to Listen Now after they're
  // already loaded), seed the stack with the pin view if it's empty.
  React.useEffect(() => {
    if (tab !== "Listen Now" || !pinsLoaded) return;
    if (stack.length === 0) {
      setStack([{ kind: "pins", title: "Listen Now" }]);
    }
  }, [tab, pinsLoaded]);

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
      const root = await hassRef.current.callWS({
        type: "media_player/browse_media",
        entity_id: entityId,
      });
      let node = root;
      let title = root.title || "Browse";

      const chains = LIB_TAB_TARGETS[tab];
      if (Array.isArray(chains)) {
        for (const chain of chains) {
          let cur = root;
          let ok  = true;
          for (const wanted of chain) {
            const w = wanted.toLowerCase();
            const child = (cur.children || []).find((c) => {
              const t = (c.title || "").toLowerCase();
              return t === w || t.includes(w) || w.includes(t);
            });
            if (!child || !child.can_expand) { ok = false; break; }
            try {
              cur = await hassRef.current.callWS({
                type: "media_player/browse_media",
                entity_id: entityId,
                media_content_id: child.media_content_id,
                media_content_type: child.media_content_type,
              });
            } catch { ok = false; break; }
          }
          if (ok) { node = cur; title = cur.title || chain.at(-1); break; }
        }
      }
      setStack([{ kind: "browse", node, title }]);
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
    if (!item) return;
    // Drill in if the item looks like a folder/container. Some integrations
    // omit can_expand on search results, so we also treat known container
    // media_class / media_content_type values (artist/album/playlist/etc.)
    // as expandable. If drilling fails AND the item is also playable, we
    // fall back to playing it so a tap never silently does nothing.
    const cls = (item.media_class || item.media_content_type || "").toLowerCase();
    const looksLikeFolder =
      item.can_expand === true ||
      (item.can_expand !== false && /artist|album|playlist|directory|folder|library|station|podcast|audiobook/.test(cls));

    if (looksLikeFolder) {
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
        setLoading(false);
        return;
      } catch (e) {
        // Drill failed — fall through to play if possible
        if (!item.can_play) {
          setErr(e?.message || String(e));
          setLoading(false);
          return;
        }
        setLoading(false);
      }
    }

    if (item.can_play !== false && item.media_content_id) {
      playMedia(item.media_content_id, item.media_content_type);
    }
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

  // Plays a track from a tracklist with the rest of the list queued
  // after it, so clicking song 5 of an album plays songs 5→end of THAT
  // album rather than jumping to artist-radio. Prefers MA's batch play
  // (it accepts an array of URIs), falls back to standard play_media +
  // enqueue=add for the remainder.
  const playTrackInList = async (clickedIndex, allTracks) => {
    if (!entityId || !allTracks?.length) return;
    const slice = allTracks.slice(clickedIndex);
    const ids = slice.map((t) => t.media_content_id).filter(Boolean);
    if (!ids.length) return;
    // Try MA's batch service first
    try {
      await hassRef.current.callService("music_assistant", "play_media", {
        entity_id: entityId,
        media_id:  ids,
        enqueue:   "replace",
        radio_mode: false,
      });
      return;
    } catch (_) { /* fall back */ }
    // Standard: play the first track, then queue the rest
    try {
      await hassRef.current.callService("media_player", "play_media", {
        entity_id:          entityId,
        media_content_id:   ids[0],
        media_content_type: slice[0].media_content_type,
      });
      for (let i = 1; i < ids.length; i++) {
        await hassRef.current.callService("media_player", "play_media", {
          entity_id:          entityId,
          media_content_id:   ids[i],
          media_content_type: slice[i].media_content_type,
          enqueue:            "add",
        });
      }
    } catch (e) {
      console.warn("[aether] track-in-list playback failed:", e);
    }
  };

  if (err) {
    return (
      <div className="lib-body">
        <div className="lib-status">
          <div style={{ color: "#b6432e", fontSize: 14 }}>Error</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>{err}</div>
        </div>
      </div>
    );
  }
  if (loading && !top) {
    return <div className="lib-body"><div className="lib-status">Loading…</div></div>;
  }
  if (!top) {
    return (
      <div className="lib-body">
        <div className="lib-status" style={{ paddingTop: 40 }}>
          {tab === "Search" ? (
            <>
              <Icon name="search" size={28} />
              <div style={{ marginTop: 12, fontSize: 14 }}>
                Use the search bar above to find artists, albums, tracks, and stations.
              </div>
            </>
          ) : "Nothing to show."}
        </div>
      </div>
    );
  }

  return (
    <div className="lib-body">
      <div className="lib-section-head">
        <h3>{top.title}</h3>
        {stack.length > 1 && (
          <button className="see-all" onClick={back}>← Back</button>
        )}
      </div>

      {loading && (
        <div className="lib-status" style={{ padding: "16px 0" }}>Loading…</div>
      )}

      {top.kind === "search" ? (
        <SearchResults items={top.items} onEnter={enter} isPinned={isPinned} togglePin={togglePin} />
      ) : top.kind === "pins" ? (
        pins.length === 0 ? (
          <div className="lib-status" style={{ paddingTop: 40 }}>
            <Icon name="bookmark" size={28} />
            <div style={{ marginTop: 12, fontSize: 14, color: "var(--ink-2)" }}>
              No pinned albums yet
            </div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              In Library or Search, tap the bookmark icon on any album,
              playlist, or artist to pin it here.
            </div>
          </div>
        ) : (
          <ItemGrid items={pins} onEnter={enter} isPinned={isPinned} togglePin={togglePin} />
        )
      ) : isTrackList(top.node?.children || [])
          ? <TrackList items={top.node.children} parent={top.node} onEnter={enter} onPlayInList={playTrackInList} />
          : <ItemGrid items={top.node?.children || []} onEnter={enter} isPinned={isPinned} togglePin={togglePin} />
      }
    </div>
  );
}

// Groups raw search results by class and renders sections
function SearchResults({ items, onEnter, isPinned, togglePin }) {
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
            ? <TrackList items={sec.items} onEnter={onEnter} />
            : <ItemGrid items={sec.items} onEnter={onEnter} isPinned={isPinned} togglePin={togglePin} />
          }
        </div>
      ))}
    </>
  );
}

function ItemGrid({ items, onEnter, isPinned, togglePin }) {
  if (!items?.length) {
    return <div className="lib-status">Nothing here.</div>;
  }
  return (
    <div className="album-row">
      {items.map((item, i) => {
        const title  = item.title || item.name;
        const art    = item.thumbnail || item.image;
        const type   = item.media_class || item.media_content_type || "";
        const id     = item.media_content_id;
        const pinned = isPinned && id ? isPinned(id) : false;
        // <button> instead of <div> for reliable touch-click handling
        // (Fully Kiosk's WebView and some mobile browsers drop onClick on
        // non-button non-anchor elements).
        return (
          <button
            type="button"
            key={(id || title) + i}
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
              {togglePin && id && (
                <span
                  role="button"
                  tabIndex={0}
                  className={"album-pin" + (pinned ? " pinned" : "")}
                  onClick={(e) => { e.stopPropagation(); togglePin(item); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={pinned ? "Unpin from Listen Now" : "Pin to Listen Now"}
                  aria-label={pinned ? "Unpin" : "Pin"}
                >
                  <Icon name={pinned ? "bookmarkFilled" : "bookmark"} size={13} />
                </span>
              )}
            </div>
            <div className="album-title">{title}</div>
            <div className="album-meta">{type}</div>
          </button>
        );
      })}
    </div>
  );
}

function TrackList({ items, parent, onEnter, onPlayInList }) {
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
            // If we're viewing a list of tracks (an album/playlist), play
            // this track and queue the rest of the list. Otherwise fall
            // back to the standard enter() handler.
            onClick={() => {
              if (onPlayInList && it.media_content_id) {
                onPlayInList(i, items);
              } else {
                onEnter(it);
              }
            }}
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

// ─── EQ dialog: per-room Sonos audio feature switches ────────────────────
// The user's Sonos integration exposes a consistent set of switches per
// speaker (crossfade, loudness, night sound, etc.). We list whichever
// exist for the primary room and let the user toggle them.
// Source picker for Sonos rooms. Calls media_player.select_source on the
// bare Sonos entity (displayId), since the MA wrapper doesn't expose
// physical inputs like TV / Line-in / HDMI.
function SourceDialog({ open, onClose, room, hass }) {
  const scrollTop = useModalAnchor(open);
  if (!open || !room) return null;
  // Re-read source_list live from hass — the room object captures a
  // snapshot at the last MusicPage render which may be stale, and
  // source_list often arrives a beat after the entity itself.
  const target  = room.displayId || room.entityId;
  const live    = hass?.states?.[target];
  const sources = live?.attributes?.source_list || room.sourceList || [];
  const currentSrc = live?.attributes?.source || room.currentSource;
  const pick = async (src) => {
    console.log("[aether] select_source", target, "→", src);
    try {
      await callService(hass, "media_player.select_source",
        { entity_id: target, source: src });
    } catch (err) {
      console.warn("[aether] select_source failed:", err);
    }
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{room.name} · Source</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8 }}>
            Entity <code>{target}</code>
            {currentSrc ? <> · Current: <strong>{currentSrc}</strong></> : null}
          </div>
          {sources.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "12px 0" }}>
              The Sonos integration isn't exposing a <code>source_list</code> for
              this speaker. That happens when the speaker doesn't have any
              physical inputs (TV/Line-in) and isn't on a stream that registers
              as a switchable source. If this is an Arc/Beam/Amp and you expect
              "TV" or "Line-in" to appear here, check the integration in
              Settings → Devices & Services → Sonos.
            </div>
          ) : sources.map((src) => {
            const active = src === currentSrc;
            return (
              <button
                key={src}
                className={"eq-row" + (active ? " active" : "")}
                onClick={() => pick(src)}
                style={{
                  width: "100%", textAlign: "left",
                  background: active ? "var(--accent-soft, rgba(74,141,216,.12))" : "transparent",
                  border: active ? "1px solid var(--accent)" : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                <span className="eq-label">{src}</span>
                {active && <span style={{ color: "var(--accent)", fontSize: 12 }}>● Active</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EQDialog({ open, onClose, room, hass }) {
  const scrollTop = useModalAnchor(open);
  if (!open || !room) return null;
  const base = (room.displayId || room.entityId || "").replace(/^media_player\./, "");
  const root = base.replace(/_\d+$/, "");
  const candidates = [
    "crossfade", "loudness", "night_sound", "speech_enhancement",
    "surround_enabled", "surround_music_full_volume",
    "subwoofer_enabled", "tv_autoplay", "ungroup_on_autoplay",
  ];
  const switches = candidates
    .map((name) => ({ name, id: `switch.${root}_${name}` }))
    .map((s) => ({ ...s, state: hass?.states?.[s.id] }))
    .filter((s) => s.state);

  const labelize = (s) => {
    const fn = s.state?.attributes?.friendly_name;
    if (fn) return fn.replace(new RegExp(`^${room.name}\\s*`, "i"), "");
    return s.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{room.name} · EQ & Audio</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {switches.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "12px 0" }}>
              No audio-feature switches exposed for {room.name}. (Sonos integration
              normally creates entities like <code>switch.{root}_loudness</code>,
              <code>switch.{root}_night_sound</code>, etc. — check Settings → Devices
              → Sonos.)
            </div>
          ) : (
            switches.map((s) => {
              const on = s.state.state === "on";
              return (
                <div key={s.id} className="eq-row">
                  <span className="eq-label">{labelize(s)}</span>
                  <div
                    className={"tile-toggle" + (on ? " on" : "")}
                    onClick={() => callService(hass,
                      on ? "switch.turn_off" : "switch.turn_on",
                      { entity_id: s.id }
                    )}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MusicPage });
