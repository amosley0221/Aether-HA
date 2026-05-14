/* Music page — recreation of the Aether music dashboard */

function MusicPage({ rooms, setRooms, np, setNp, playPrimary, setPlayPrimary }) {
  const [drag, setDrag]       = React.useState(null);   // id of room being dragged
  const [over, setOver]       = React.useState(null);   // id of room being hovered for drop
  const [groups, setGroups]   = React.useState({});     // { groupId: [roomId, roomId, ...] }
  const [tab, setTab]         = React.useState("Library");
  const [progress, setProgress] = React.useState(30);   // 0..1 → use 0..duration
  const duration = 198; // 3:18

  // tick progress when playing
  React.useEffect(() => {
    if (!playPrimary) return;
    const id = setInterval(() => {
      setProgress(p => (p + 1) > duration ? 0 : p + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [playPrimary]);

  // Drag & drop handlers
  const onDragStart = (id) => (e) => {
    setDrag(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver  = (id) => (e) => { e.preventDefault(); setOver(id); };
  const onDragLeave = ()   => () => setOver(null);
  const onDrop      = (targetId) => (e) => {
    e.preventDefault();
    if (!drag || drag === targetId) { setDrag(null); setOver(null); return; }
    // Create or extend a group: both rooms now play the same as target room
    const target = rooms.find(r => r.id === targetId);
    if (!target) return;
    setRooms(rs => rs.map(r => r.id === drag ? {
      ...r,
      track: target.track,
      artist: target.artist,
      playing: target.playing,
    } : r));
    // group bookkeeping
    setGroups(g => {
      // find existing group containing target
      const existingKey = Object.keys(g).find(k => g[k].includes(targetId));
      if (existingKey) return { ...g, [existingKey]: [...new Set([...g[existingKey], drag])] };
      return { ...g, [targetId]: [targetId, drag] };
    });
    setDrag(null); setOver(null);
  };
  const onDragEnd = () => { setDrag(null); setOver(null); };

  // Group size lookup
  const groupSize = (id) => {
    const key = Object.keys(groups).find(k => groups[k].includes(id));
    return key ? groups[key].length : 0;
  };

  const togglePrimary = () => setPlayPrimary(p => !p);

  return (
    <div className="page music" data-screen-label="02 Music">
      {/* Speakers card */}
      <div className="speakers-card">
        <div className="speakers-top">
          <button className="speakers-label" title="Toggle theme">
            <span className="swatch"></span> Speakers
          </button>
          <div className="search">
            <Icon name="search" size={14} />
            <input placeholder="Search your library" />
          </div>
          <button className="btn-pill"><Icon name="up" /> Up Next</button>
          <button className="btn-pill"><Icon name="eq" /> EQ</button>
          <button className="btn-pill" style={{ padding: "7px 10px" }}><Icon name="more" size={16} /></button>
        </div>

        <div className="rooms-rail scroll-x">
          {rooms.map(room => {
            const gsize = groupSize(room.id);
            const className = [
              "room",
              !room.playing && "idle",
              drag === room.id && "dragging",
              over === room.id && drag && drag !== room.id && "drop-target",
              room.primary && "active",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={room.id}
                className={className}
                draggable
                onDragStart={onDragStart(room.id)}
                onDragOver={onDragOver(room.id)}
                onDragLeave={onDragLeave()}
                onDrop={onDrop(room.id)}
                onDragEnd={onDragEnd}
                onClick={() => setRooms(rs => rs.map(r => ({ ...r, primary: r.id === room.id })))}
                title="Drag onto another room to group"
              >
                <Avatar colors={room.color} />
                <div className="room-meta">
                  <span className="room-name">
                    {room.name}
                    {room.playing && <Bars />}
                  </span>
                  <span className="room-status">
                    {room.playing
                      ? `${room.track}${room.extras ? ` · +${room.extras}` : ""}`
                      : `Idle${room.extras ? ` · +${room.extras}` : ""}`
                    }
                  </span>
                </div>
                <button
                  className="room-ctrl"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRooms(rs => rs.map(r => r.id === room.id ? { ...r, playing: !r.playing } : r));
                  }}
                >
                  <Icon name={room.playing ? "pause" : "play"} size={12} />
                </button>
                {gsize > 1 && <span className="room-grouped-badge">+{gsize - 1}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main two-column body */}
      <div className="music-grid">
        {/* Now Playing */}
        <div className="np-card">
          <div className="np-top">
            <div className="np-art">
              <div className="np-art-meta">
                <div className="t">Pollen Count</div>
                <div className="a">JUNE HOLLOW</div>
              </div>
            </div>
            <div className="np-info">
              <div>
                <div className="eyebrow">Now Playing</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <Avatar colors={["#4a8dd8","#1e3f7a"]} size={16} />
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{np.room}</span>
                </div>
                <div className="np-track">{np.track}</div>
                <div className="np-artist">{np.artist}</div>
                <div className="np-album">{np.album}</div>
              </div>
              <div className="np-actions">
                <button className={"action" + (np.liked ? " on" : "")} onClick={() => setNp(n => ({ ...n, liked: !n.liked }))}>
                  <Icon name="heart" /> {np.liked ? "Liked" : "Like"}
                </button>
                <button className="action"><Icon name="group" /> Group</button>
                <button className="action" style={{ padding: "7px 10px" }}><Icon name="more" /></button>
              </div>
            </div>
          </div>

          <div className="np-progress">
            <div className="np-bar" onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setProgress(Math.round(((e.clientX - r.left) / r.width) * duration));
            }}>
              <div className="np-bar-fill" style={{ width: `${(progress/duration)*100}%` }} />
            </div>
            <div className="np-times">
              <span>{fmt(progress)}</span>
              <span>−{fmt(duration - progress)}</span>
            </div>
          </div>

          <div className="transport">
            <div /> {/* spacer */}
            <button className="t-icon" title="Shuffle"><Icon name="shuffle" size={18} /></button>
            <button className="t-icon" title="Previous" onClick={() => setProgress(0)}><Icon name="prev" size={20} /></button>
            <button className="t-play" onClick={togglePrimary} title={playPrimary ? "Pause" : "Play"}>
              <Icon name={playPrimary ? "pause" : "play"} size={22} />
            </button>
            <button className="t-icon" title="Next" onClick={() => setProgress(duration)}><Icon name="next" size={20} /></button>
            <button className="t-icon" title="Repeat"><Icon name="repeat" size={18} /></button>
            <div />
          </div>

          <div className="np-volume">
            <Icon name="volume" />
            <input
              className="range"
              type="range"
              min="0" max="100"
              value={np.volume}
              onChange={(e) => setNp(n => ({ ...n, volume: Number(e.target.value) }))}
            />
            <span className="vol-pct">{np.volume}</span>
          </div>
        </div>

        {/* Library */}
        <div className="lib-card">
          <div className="lib-top">
            <div className="lib-tabs">
              {["Listen Now","Browse","Radio","Library","Search"].map(t => (
                <button key={t} className={"lib-tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="lib-service">Apple Music</div>
          </div>

          {tab === "Listen Now" || tab === "Library" ? (
            <React.Fragment>
              <LibSection title="Recently Played" items={ALBUMS.recent} setNp={setNp} />
              <LibSection title="Made for You"    items={ALBUMS.made}   setNp={setNp} />
              <LibSection title="Top Albums"      items={ALBUMS.top}    setNp={setNp} />
            </React.Fragment>
          ) : tab === "Browse" ? (
            <React.Fragment>
              <LibSection title="New Releases" items={ALBUMS.recent} setNp={setNp} />
              <LibSection title="Curated for You" items={ALBUMS.made} setNp={setNp} />
            </React.Fragment>
          ) : tab === "Radio" ? (
            <LibSection title="Stations" items={ALBUMS.top} setNp={setNp} />
          ) : (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--ink-3)" }}>
              <Icon name="search" size={28} />
              <div style={{ marginTop: 12, fontSize: 14 }}>Search across your library, Apple Music, and stations.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LibSection({ title, items, setNp }) {
  return (
    <div className="lib-section">
      <div className="lib-section-head">
        <h3>{title}</h3>
        <button className="see-all">See All</button>
      </div>
      <div className="album-row">
        {items.map((al, i) => (
          <div
            key={al.title + i}
            className="album"
            onClick={() => setNp(n => ({ ...n, track: al.title, artist: al.meta.split(" · ")[0], album: al.title }))}
          >
            <div className="album-art" style={{ background: al.grad }}>
              <div className="label">{al.title}</div>
            </div>
            <div className="album-title">{al.title}</div>
            <div className="album-meta">{al.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MusicPage });
