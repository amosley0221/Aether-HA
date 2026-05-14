/* Shared data + small components for Aether */

// ─── Room data (drives Music + Dashboard + Home) ──────────────────────────────
const ROOMS_INITIAL = [
  { id: "living",  name: "Living Room",  color: ["#c47a64", "#7a3b2c"], track: "Slow Light Through Trees", artist: "The Marrow & The Tide",     playing: true,  volume: 38 },
  { id: "office",  name: "Office",       color: ["#9aa0d8", "#4a4f9a"], track: "Kitchen at Midnight",       artist: "Hollow & Quiet",            playing: true,  volume: 28 },
  { id: "bedroom", name: "Bedroom",      color: ["#c47a64", "#7a3b2c"], track: "Slow Light Through Trees", artist: "The Marrow & The Tide",     playing: true,  volume: 22 },
  { id: "dining",  name: "Dining Room",  color: ["#4a8dd8", "#1e3f7a"], track: "Marigold Static",           artist: "June Hollow",               playing: true,  volume: 42, primary: true },
  { id: "bath",    name: "Bathroom",     color: ["#a44a3a", "#5c2418"], track: "Telegraph Hill",            artist: "Calder Vance",              playing: true,  volume: 18, extras: 2 },
  { id: "garage",  name: "Garage",       color: ["#b6b4ac", "#7a786f"], track: "Idle",                      artist: "",                          playing: false, volume: 0,  extras: 2 },
  { id: "move2",   name: "Move 2",       color: ["#b6b4ac", "#7a786f"], track: "Idle",                      artist: "",                          playing: false, volume: 0,  extras: 2 },
  { id: "patio",   name: "Patio",        color: ["#7aa890", "#3a5c4a"], track: "Idle",                      artist: "",                          playing: false, volume: 0 },
  { id: "kids",    name: "Kids Room",    color: ["#d8b06a", "#7a5a2a"], track: "Idle",                      artist: "",                          playing: false, volume: 0 },
];

// Album-art palettes (used in library + UI)
const ALBUMS = {
  recent: [
    { title: "Hours Between Rooms", meta: "Marrow & The Tide · Album",      grad: "linear-gradient(160deg, #5a7596 0%, #2c3e5a 100%)" },
    { title: "Slow Mornings",       meta: "Aether Music · Playlist",         grad: "linear-gradient(160deg, #4a8dd8 0%, #1e3f7a 100%)" },
    { title: "Pelagic",             meta: "Calder Vance · Album",            grad: "linear-gradient(160deg, #c47a4a 0%, #5a2e18 100%)" },
    { title: "Deep Focus",          meta: "Aether Music · Playlist",         grad: "linear-gradient(160deg, #9a6ec4 0%, #3a1e5a 100%)" },
    { title: "Late Drives",         meta: "Aether Music · Playlist",         grad: "linear-gradient(160deg, #a89a3a 0%, #3a3414 100%)" },
  ],
  made: [
    { title: "Sunday Reset",   meta: "42 songs", grad: "linear-gradient(160deg, #4aa87a 0%, #1e4a34 100%)" },
    { title: "Slow Mornings",  meta: "28 songs", grad: "linear-gradient(160deg, #4a8dd8 0%, #1e3f7a 100%)" },
    { title: "Deep Focus",     meta: "64 songs", grad: "linear-gradient(160deg, #9a6ec4 0%, #3a1e5a 100%)" },
    { title: "Late Drives",    meta: "31 songs", grad: "linear-gradient(160deg, #a89a3a 0%, #3a3414 100%)" },
    { title: "Kitchen Jazz",   meta: "53 songs", grad: "linear-gradient(160deg, #c47a4a 0%, #5a2e18 100%)" },
  ],
  top: [
    { title: "June Hollow",      meta: "12 plays", grad: "linear-gradient(160deg, #b85a48 0%, #5a1e18 100%)" },
    { title: "Marrow & Tide",    meta: "9 plays",  grad: "linear-gradient(160deg, #6a6fc4 0%, #2a2e7a 100%)" },
    { title: "Calder Vance",     meta: "8 plays",  grad: "linear-gradient(160deg, #c47a4a 0%, #5a2e18 100%)" },
    { title: "Hollow & Quiet",   meta: "6 plays",  grad: "linear-gradient(160deg, #b8587a 0%, #5a1e34 100%)" },
    { title: "Aether Sessions",  meta: "5 plays",  grad: "linear-gradient(160deg, #3a8a8a 0%, #143a3a 100%)" },
  ],
};

// ─── Icons (inline SVG, monoline) ────────────────────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const stroke = "currentColor";
  const sw = 1.6;
  const p = { fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  const svgs = {
    home:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M3 10.5 12 3l9 7.5"/><path {...p} d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>,
    music:   <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M9 18V6l12-2v12"/><circle cx="6" cy="18" r="3" {...p}/><circle cx="18" cy="16" r="3" {...p}/></svg>,
    grid:    <svg viewBox="0 0 24 24" width={size} height={size}><rect x="3" y="3" width="7" height="7" rx="1.5" {...p}/><rect x="14" y="3" width="7" height="7" rx="1.5" {...p}/><rect x="3" y="14" width="7" height="7" rx="1.5" {...p}/><rect x="14" y="14" width="7" height="7" rx="1.5" {...p}/></svg>,
    play:    <svg viewBox="0 0 24 24" width={size} height={size}><path d="M7 5v14l11-7z" fill="currentColor"/></svg>,
    pause:   <svg viewBox="0 0 24 24" width={size} height={size}><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>,
    prev:    <svg viewBox="0 0 24 24" width={size} height={size}><path d="M18 5L8 12l10 7z" fill="currentColor"/><rect x="5" y="5" width="2" height="14" fill="currentColor" rx=".8"/></svg>,
    next:    <svg viewBox="0 0 24 24" width={size} height={size}><path d="M6 5l10 7-10 7z" fill="currentColor"/><rect x="17" y="5" width="2" height="14" fill="currentColor" rx=".8"/></svg>,
    shuffle: <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M3 7h3l9 10h6"/><path {...p} d="M3 17h3l9-10h6"/><path {...p} d="M17 4l3 3-3 3"/><path {...p} d="M17 14l3 3-3 3"/></svg>,
    repeat:  <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M3 11V8a3 3 0 0 1 3-3h12l-2-2"/><path {...p} d="M16 5l2-2"/><path {...p} d="M21 13v3a3 3 0 0 1-3 3H6l2 2"/><path {...p} d="M8 21l-2-2"/></svg>,
    heart:   <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M12 20s-7-4.5-9.5-9C.7 7.5 3 4 6 4c2 0 3.5 1 6 4 2.5-3 4-4 6-4 3 0 5.3 3.5 3.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>,
    group:   <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="8" cy="9" r="3" {...p}/><circle cx="16" cy="9" r="3" {...p}/><path {...p} d="M3 19c0-2.5 2-4.5 5-4.5s5 2 5 4.5"/><path {...p} d="M11 19c0-2.5 2-4.5 5-4.5s5 2 5 4.5"/></svg>,
    more:    <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>,
    search:  <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="11" cy="11" r="6" {...p}/><path {...p} d="m20 20-4-4"/></svg>,
    up:      <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M4 7h16"/><path {...p} d="M4 12h10"/><path {...p} d="M4 17h6"/></svg>,
    eq:      <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M5 4v16"/><path {...p} d="M12 4v16"/><path {...p} d="M19 4v16"/><circle cx="5" cy="9" r="2" fill="#fff" {...p}/><circle cx="12" cy="15" r="2" fill="#fff" {...p}/><circle cx="19" cy="8" r="2" fill="#fff" {...p}/></svg>,
    volume:  <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M5 9v6h3l5 4V5L8 9H5z"/><path {...p} d="M16 9a4 4 0 0 1 0 6"/></svg>,
    bulb:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M9 18h6"/><path {...p} d="M10 21h4"/><path {...p} d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5h6c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>,
    camera:  <svg viewBox="0 0 24 24" width={size} height={size}><rect x="3" y="6" width="14" height="12" rx="2" {...p}/><path {...p} d="m17 10 4-2v8l-4-2z"/></svg>,
    lock:    <svg viewBox="0 0 24 24" width={size} height={size}><rect x="4" y="10" width="16" height="11" rx="2" {...p}/><path {...p} d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>,
    unlock:  <svg viewBox="0 0 24 24" width={size} height={size}><rect x="4" y="10" width="16" height="11" rx="2" {...p}/><path {...p} d="M8 10V7a4 4 0 0 1 7-2.5"/></svg>,
    thermo:  <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M12 14V4a2 2 0 1 1 4 0v10a4 4 0 1 1-4 0z"/></svg>,
    speaker: <svg viewBox="0 0 24 24" width={size} height={size}><rect x="6" y="3" width="12" height="18" rx="2" {...p}/><circle cx="12" cy="14" r="3" {...p}/><circle cx="12" cy="7" r="1" fill="currentColor"/></svg>,
    fan:     <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="12" cy="12" r="2" {...p}/><path {...p} d="M12 4a4 4 0 0 1 0 8M12 20a4 4 0 0 1 0-8M4 12a4 4 0 0 1 8 0M20 12a4 4 0 0 1-8 0"/></svg>,
    leaf:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M20 4c-9 0-16 6-16 14 0 1 .5 2 2 2 8 0 14-7 14-16z"/><path {...p} d="M4 20c5-5 9-9 16-16"/></svg>,
    moon:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></svg>,
    sun:     <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="12" cy="12" r="4" {...p}/><path {...p} d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
    sparkle: <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"/></svg>,
    door:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M6 3v18h12V3z"/><circle cx="14" cy="12" r="1" fill="currentColor"/></svg>,
    motion:  <svg viewBox="0 0 24 24" width={size} height={size}><circle cx="12" cy="12" r="2" fill="currentColor"/><path {...p} d="M8 8a5.5 5.5 0 0 0 0 8M5 5a9.5 9.5 0 0 0 0 14M16 8a5.5 5.5 0 0 1 0 8M19 5a9.5 9.5 0 0 1 0 14"/></svg>,
    cloud:   <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M7 18a4 4 0 1 1 1-7.9A6 6 0 0 1 20 12a4 4 0 0 1-1 7.9H7z"/></svg>,
    droplet: <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M12 3s7 7.5 7 12a7 7 0 1 1-14 0c0-4.5 7-12 7-12z"/></svg>,
    expand:  <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>,
    settings:<svg viewBox="0 0 24 24" width={size} height={size}><circle cx="12" cy="12" r="3" {...p}/><path {...p} d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4.8a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.4a7 7 0 0 0-2.1 1.2l-2.4-.8-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.8a7 7 0 0 0 2.1 1.2L10 21h4l.4-2.4a7 7 0 0 0 2.1-1.2l2.4.8 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>,
    wifi:    <svg viewBox="0 0 24 24" width={size} height={size}><path {...p} d="M5 12a10 10 0 0 1 14 0"/><path {...p} d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>,
  };
  return svgs[name] || null;
};

// ─── Small UI bits ───────────────────────────────────────────────────────────
const Bars = () => (
  <span className="bars"><i/><i/><i/></span>
);

const SoundBars = Bars;

// Convert "[g1, g2]" pair to a circular gradient avatar
const Avatar = ({ colors, size = 30 }) => (
  <span
    className="room-avatar"
    style={{
      width: size, height: size,
      background: `radial-gradient(120% 120% at 30% 30%, ${colors[0]} 0%, ${colors[1]} 100%)`,
    }}
  />
);

// Format seconds → m:ss / -m:ss
const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s/60); const r = String(s%60).padStart(2,"0");
  return `${m}:${r}`;
};

// Mini room card used in HomePage
const MiniRoomRow = ({ room }) => (
  <div className="house-row">
    <Avatar colors={room.color} size={18} />
    <div className="name">{room.name}</div>
    <div className="meta">
      {room.playing ? <span><Bars/> {Math.round(room.volume)}%</span> : <span style={{ color: "var(--ink-4)" }}>Idle</span>}
    </div>
  </div>
);

Object.assign(window, { ROOMS_INITIAL, ALBUMS, Icon, Bars, SoundBars, Avatar, MiniRoomRow, fmt });
