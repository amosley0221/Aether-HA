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
  const [queueOpen, setQueueOpen] = React.useState(false);

  const railRef        = React.useRef(null);
  const pointerStart   = React.useRef(null);   // {id, x, y}
  const longPressTimer = React.useRef(null);

  // ─── Live room data ──────────────────────────────────────────────────────
  // mediaPlayer (MA wrapper) is the control entity. displayPlayer (Sonos
  // bare) mirrors externally-controlled playback. The rail reads from
  // whichever sibling is most active; services always target mediaPlayer.
  const liveRooms = React.useMemo(() => {
    const score = (s) => s === "playing" ? 0 : s === "paused" ? 1 : s === "idle" ? 2 : 3;
    const states = hass?.states || {};
    const mapped = cfg.rooms.map(room => {
      // Auto-resolve the MA wrapper if the configured entity isn't search-capable
      const resolvedCtrlId = resolveMaPlayer(room.mediaPlayer, states);
      const displayId      = room.displayPlayer
        || (resolvedCtrlId !== room.mediaPlayer ? room.mediaPlayer : resolvedCtrlId.replace(/_\d+$/, ""));
      const ctrl    = states[resolvedCtrlId];
      const display = displayId && displayId !== resolvedCtrlId ? states[displayId] : null;
      const active  = [ctrl, display].filter(Boolean).sort(
        (a, b) => score(a.state) - score(b.state)
      )[0] || ctrl || display;
      const a = active?.attributes || {};
      const groupMembers = a.group_members || ctrl?.attributes?.group_members || [];
      return {
        ...room,
        entity:   active,
        ctrl,
        entityId: resolvedCtrlId,
        displayId,
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

  // ─── Drag-to-group via Pointer Events (works on mouse + touch) ──────────
  // Strategy that coexists with native horizontal scroll on the rail:
  //   - On pointerdown, start a 400ms long-press timer.
  //   - If the user moves more than ~10px before the timer fires, abort
  //     the timer (they're scrolling or were jittery). Native scroll
  //     continues unimpeded because touch-action stays at default.
  //   - If the timer fires (held still long enough), enter drag mode.
  //     From then on we preventDefault on pointermove so the browser
  //     stops scrolling, and we hit-test rooms under the pointer.
  //   - On pointerup with drag+over, fire media_player.join. With no
  //     drag and no significant movement, treat as a tap and select
  //     primary.
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onRoomPointerDown = (roomId) => (e) => {
    if (e.target.closest(".room-ctrl")) return;
    pointerStart.current = { id: roomId, x: e.clientX, y: e.clientY, time: Date.now() };
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      setDrag(roomId);
    }, 400);
  };

  React.useEffect(() => {
    const onMove = (e) => {
      const ps = pointerStart.current;
      if (!ps) return;
      const dx = e.clientX - ps.x;
      const dy = e.clientY - ps.y;
      if (!drag) {
        // Cancel the long-press if the user moved enough — they're scrolling
        if (Math.hypot(dx, dy) > 10) cancelLongPress();
        return;
      }
      // Drag is active — block native scroll and hit-test
      e.preventDefault();
      if (!railRef.current) return;
      const candidates = railRef.current.querySelectorAll(".room");
      let foundId = null;
      for (const r of candidates) {
        const rect = r.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom) {
          foundId = r.getAttribute("data-room-id");
          break;
        }
      }
      setOver(foundId && foundId !== drag ? foundId : null);
    };

    const onUp = async () => {
      cancelLongPress();
      const ps = pointerStart.current;
      pointerStart.current = null;
      if (drag && over) {
        const dragged = liveRooms.find(r => r.id === drag);
        const target  = liveRooms.find(r => r.id === over);
        if (dragged?.entityId && target?.entityId) {
          try {
            await svc("media_player.join", {
              entity_id: target.entityId,
              group_members: [dragged.entityId],
            });
          } catch (err) {
            console.warn("[aether] media_player.join failed:", err);
          }
        }
      } else if (ps && !drag) {
        // Quick tap (no long-press, no significant movement) → select primary
        const dt = Date.now() - ps.time;
        if (dt < 500) {
          setPrimaryId(ps.id);
          setUserSelectedPrimary(true);
        }
      }
      setDrag(null);
      setOver(null);
    };

    const onCancel = () => {
      cancelLongPress();
      pointerStart.current = null;
      setDrag(null);
      setOver(null);
    };

    document.addEventListener("pointermove",  onMove, { passive: false });
    document.addEventListener("pointerup",    onUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      document.removeEventListener("pointermove",  onMove);
      document.removeEventListener("pointerup",    onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [drag, over, liveRooms]);

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
          <button className="btn-pill" title="Up next" onClick={() => setQueueOpen(true)}>
            <Icon name="up" /> Up Next
          </button>
          <button className="btn-pill" title="EQ & audio features" onClick={() => setEqOpen(true)}>
            <Icon name="eq" /> EQ
          </button>
          <button className="btn-pill" style={{ padding: "7px 10px" }}><Icon name="more" size={16} /></button>
        </div>

        <div className="rooms-rail scroll-x" ref={railRef}>
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
                onPointerDown={onRoomPointerDown(room.id)}
                title={room.entity ? "Drag onto another room to group" : `Player offline (${room.entityId})`}
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
      <QueueDialog
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        entityId={primary?.entityId}
        hassRef={hassRef}
        hass={hass}
      />
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
  "Browse":     null,
  "Radio":      [
    ["Apple Music", "Radio Stations"],
    ["Apple Music", "Stations"],
    ["Apple Music", "Radio"],
    ["Radio Browser"],
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

  // Initial load on tab/entity change. Intentionally does NOT depend on hass
  // to avoid refetching on every state tick.
  React.useEffect(() => {
    if (!entityId || !hassRef.current) return;
    setErr(null);
    setStack([]);
    if (tab === "Listen Now") {
      // Rendered from pins directly (live), not from the stack — leave empty.
      return;
    }
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

  // Listen Now → render pinned albums directly (not via the browse stack)
  if (tab === "Listen Now") {
    if (!pinsLoaded) {
      return <div className="lib-body"><div className="lib-status">Loading…</div></div>;
    }
    return (
      <div className="lib-body">
        <div className="lib-section-head">
          <h3>Listen Now</h3>
          {pins.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {pins.length} pinned · tap bookmark to remove
            </span>
          )}
        </div>
        {pins.length === 0 ? (
          <div className="lib-status" style={{ paddingTop: 40 }}>
            <Icon name="bookmark" size={28} />
            <div style={{ marginTop: 12, fontSize: 14, color: "var(--ink-2)" }}>
              No pinned albums yet
            </div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              In Library, Browse, or Search, tap the bookmark icon on any
              album, playlist, or artist to pin it here.
            </div>
          </div>
        ) : (
          <ItemGrid items={pins} onEnter={enter} isPinned={isPinned} togglePin={togglePin} />
        )}
      </div>
    );
  }

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

      {top.kind === "search"
        ? <SearchResults items={top.items} onEnter={enter} isPinned={isPinned} togglePin={togglePin} />
        : isTrackList(top.node?.children || [])
          ? <TrackList items={top.node.children} parent={top.node} onEnter={enter} />
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
        return (
          <div
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
                <button
                  className={"album-pin" + (pinned ? " pinned" : "")}
                  onClick={(e) => { e.stopPropagation(); togglePin(item); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={pinned ? "Unpin from Listen Now" : "Pin to Listen Now"}
                  aria-label={pinned ? "Unpin" : "Pin"}
                >
                  <Icon name={pinned ? "bookmarkFilled" : "bookmark"} size={13} />
                </button>
              )}
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

// ─── EQ dialog: per-room Sonos audio feature switches ────────────────────
// The user's Sonos integration exposes a consistent set of switches per
// speaker (crossfade, loudness, night sound, etc.). We list whichever
// exist for the primary room and let the user toggle them.
function EQDialog({ open, onClose, room, hass }) {
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
    <div className="modal-backdrop" onClick={onClose}>
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

// ─── Up Next dialog: shows the MA queue for the primary player ───────────
function QueueDialog({ open, onClose, entityId, hassRef, hass }) {
  const [items, setItems]     = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]         = React.useState(null);

  React.useEffect(() => {
    if (!open || !entityId || !hassRef.current) return;
    setLoading(true);
    setErr(null);
    (async () => {
      // Try MA's documented WS commands, then fall back to media_player's
      // generic browse of the queue.
      const tries = [
        { type: "music_assistant/players/queue_items", queue_id: entityId, limit: 30 },
        { type: "music_assistant/queues/items",         queue_id: entityId, limit: 30 },
        { type: "music_assistant/queue/items",          queue_id: entityId, limit: 30 },
      ];
      let got = null;
      let lastErr = null;
      for (const msg of tries) {
        try {
          got = await hassRef.current.callWS(msg);
          break;
        } catch (e) { lastErr = e; }
      }
      if (got) {
        setItems(Array.isArray(got) ? got : (got.items || got.queue_items || []));
      } else {
        setErr(lastErr?.message || "Queue unavailable");
      }
      setLoading(false);
    })();
  }, [open, entityId, hassRef]);

  if (!open) return null;

  const jumpTo = async (index, item) => {
    const tries = [
      { service: "media_player.play_media", data: {
        entity_id: entityId,
        media_content_id: item.uri || item.media_content_id,
        media_content_type: item.media_type || item.media_content_type,
      } },
      { ws: { type: "music_assistant/players/queue_index", queue_id: entityId, index } },
    ];
    for (const t of tries) {
      try {
        if (t.service) {
          const [d, s] = t.service.split(".");
          await hass.callService(d, s, t.data);
        } else {
          await hass.callWS(t.ws);
        }
        return;
      } catch (_) {/* try next */}
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Up Next</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="lib-status">Loading queue…</div>
          ) : err ? (
            <div className="lib-status" style={{ color: "var(--ink-3)" }}>
              <div>Couldn't load queue.</div>
              <div style={{ fontSize: 11, marginTop: 8 }}>{err}</div>
            </div>
          ) : items.length === 0 ? (
            <div className="lib-status">No tracks queued.</div>
          ) : (
            <div className="track-list">
              {items.map((track, i) => {
                const title = track.name || track.title || track.media_title || "Unknown";
                const meta  = track.artists?.map((a) => a.name).join(", ")
                           || track.artist || track.album?.name || "";
                const art   = track.image || track.thumbnail || track.metadata?.images?.[0]?.path;
                return (
                  <button
                    key={(track.uri || track.media_content_id || title) + i}
                    className="track-row"
                    onClick={() => jumpTo(i, track)}
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
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MusicPage });
