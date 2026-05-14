/* Aether — main app shell + router */

const DEVICES_INITIAL = {
  lights: [
    { id: "l1", name: "Living Lamps",     room: "Living Room", on: true,  brightness: 64, color: "#e8a850" },
    { id: "l2", name: "Kitchen Pendants", room: "Kitchen",     on: true,  brightness: 88, color: "#f5d28a" },
    { id: "l3", name: "Dining Spots",     room: "Dining Room", on: true,  brightness: 42, color: "#e8a850" },
    { id: "l4", name: "Bedroom Sconces",  room: "Bedroom",     on: false, brightness: 30, color: "#d68a6a" },
    { id: "l5", name: "Office Desk",      room: "Office",      on: true,  brightness: 78, color: "#ffffff" },
    { id: "l6", name: "Hallway",          room: "Hallway",     on: false, brightness: 50, color: "#f0c884" },
    { id: "l7", name: "Patio String",     room: "Patio",       on: true,  brightness: 55, color: "#f5b878" },
    { id: "l8", name: "Garage Overhead",  room: "Garage",      on: false, brightness: 100, color: "#ffffff" },
  ],
  cameras: [
    { id: "c1", name: "Front Door",   location: "Porch",       resolution: "2K",  feed: "linear-gradient(160deg, #2a3a4a 0%, #0e1620 60%, #1a242e 100%), radial-gradient(40% 30% at 30% 60%, rgba(232,168,80,.18), transparent)" },
    { id: "c2", name: "Driveway",     location: "Side",        resolution: "4K",  feed: "linear-gradient(180deg, #3a4a5a 0%, #1a2632 70%)" },
    { id: "c3", name: "Backyard",     location: "Patio",       resolution: "2K",  feed: "linear-gradient(180deg, #2d3a2a 0%, #15201a 70%)" },
    { id: "c4", name: "Garage",       location: "Interior",    resolution: "1080p", feed: "linear-gradient(180deg, #3a3530 0%, #1a1612 70%)" },
  ],
  locks: [
    { id: "k1", name: "Front Door",   room: "Entry",       locked: true,  since: "2h ago" },
    { id: "k2", name: "Back Door",    room: "Patio",       locked: true,  since: "5h ago" },
    { id: "k3", name: "Garage Side",  room: "Garage",      locked: false, since: "12 min ago" },
    { id: "k4", name: "Office Door",  room: "Home Office", locked: true,  since: "Yesterday" },
  ],
  climate: [
    { id: "t1", name: "Main Floor", room: "Whole house", mode: "Cool", target: 70, current: 72 },
    { id: "t2", name: "Upstairs",   room: "Bedrooms",     mode: "Auto", target: 68, current: 71 },
  ],
  sensors: [
    { name: "Front porch motion", room: "Outside",     icon: "motion", value: "Quiet", note: "Last: 9:42 AM", icColor: "" },
    { name: "Hallway motion",      room: "2nd floor",   icon: "motion", value: "Quiet", note: "Last: 11:18 PM", icColor: "" },
    { name: "Basement leak",       room: "Utility",     icon: "droplet", value: "Dry",  note: "OK",            icColor: "green" },
    { name: "Smoke / CO",          room: "Whole house", icon: "cloud",   value: "Clear", note: "All units OK", icColor: "green" },
    { name: "Front door contact",  room: "Entry",       icon: "door",    value: "Closed", note: "Sealed",      icColor: "" },
    { name: "Window — Bedroom",    room: "Bedroom",     icon: "door",    value: "Closed", note: "Sealed",      icColor: "" },
    { name: "Mesh Wi-Fi",           room: "Network",     icon: "wifi",    value: "Good", note: "12 devices",   icColor: "" },
    { name: "Indoor humidity",     room: "Living Room", icon: "droplet", value: "47", unit: "%", note: "Comfortable", icColor: "" },
  ],
};

function App() {
  const [page, setPage]            = React.useState("home");
  const [rooms, setRooms]          = React.useState(ROOMS_INITIAL);
  const [devices, setDevices]      = React.useState(DEVICES_INITIAL);
  const [activeScene, setActiveScene] = React.useState(null);
  const [playPrimary, setPlayPrimary] = React.useState(true);
  const [np, setNp] = React.useState({
    track:  "Marigold Static",
    artist: "June Hollow",
    album:  "Pollen Count",
    room:   "Dining Room",
    volume: 42,
    liked:  false,
  });

  // Apply scene -> mutate devices/rooms
  React.useEffect(() => {
    if (!activeScene) return;
    if (activeScene === "morning") {
      setDevices(d => ({ ...d, lights: d.lights.map(l => ["l1","l2","l5","l3"].includes(l.id) ? { ...l, on: true, brightness: 70 } : l) }));
      setPlayPrimary(true);
    }
    if (activeScene === "focus") {
      setDevices(d => ({ ...d, lights: d.lights.map(l => ({ ...l, on: l.id === "l5" })) }));
    }
    if (activeScene === "movie") {
      setDevices(d => ({ ...d, lights: d.lights.map(l => l.room === "Living Room" ? { ...l, on: true, brightness: 18 } : { ...l, on: false }) }));
    }
    if (activeScene === "dinner") {
      setDevices(d => ({ ...d, lights: d.lights.map(l => ["l2","l3"].includes(l.id) ? { ...l, on: true, brightness: 55 } : { ...l, on: false }) }));
    }
    if (activeScene === "sleep") {
      setDevices(d => ({
        ...d,
        lights: d.lights.map(l => ({ ...l, on: false })),
        locks:  d.locks.map(l => ({ ...l, locked: true })),
      }));
      setPlayPrimary(false);
      setRooms(rs => rs.map(r => ({ ...r, playing: false })));
    }
  }, [activeScene]);

  const navigate = (p) => setPage(p);

  return (
    <div className="app-shell">
      <header className="brandbar">
        <div className="brand-mark">Æ</div>
        <div className="brand-name"><b>Aether</b><span>·</span>Home</div>
        <nav className="nav-tabs">
          <button className={"nav-tab" + (page === "home"      ? " active" : "")} onClick={() => navigate("home")}>     <Icon name="home"/>  Home</button>
          <button className={"nav-tab" + (page === "music"     ? " active" : "")} onClick={() => navigate("music")}>    <Icon name="music"/> Music</button>
          <button className={"nav-tab" + (page === "dashboard" ? " active" : "")} onClick={() => navigate("dashboard")}><Icon name="grid"/>  Dashboard</button>
        </nav>
        <div className="brand-spacer" />
        <div className="brand-pill"><span className="dot" /> All systems normal</div>
        <div className="brand-pill"><Icon name="wifi" size={13} /> Mesh · 12</div>
        <div className="brand-avatar">B</div>
      </header>

      <main>
        {page === "home" && (
          <HomePage
            rooms={rooms}
            np={np} setNp={setNp}
            playPrimary={playPrimary} setPlayPrimary={setPlayPrimary}
            navigate={navigate}
            devices={devices}
            activeScene={activeScene} setActiveScene={setActiveScene}
          />
        )}
        {page === "music" && (
          <MusicPage
            rooms={rooms} setRooms={setRooms}
            np={np} setNp={setNp}
            playPrimary={playPrimary} setPlayPrimary={setPlayPrimary}
          />
        )}
        {page === "dashboard" && (
          <DashboardPage
            rooms={rooms} setRooms={setRooms}
            devices={devices} setDevices={setDevices}
            np={np}
            playPrimary={playPrimary} setPlayPrimary={setPlayPrimary}
          />
        )}
      </main>
    </div>
  );
}

const __aetherMount = window.__aetherMount || document.getElementById("root");
if (__aetherMount) {
  if (!window.__aetherReactRoot) {
    window.__aetherReactRoot = ReactDOM.createRoot(__aetherMount);
  }
  window.__aetherReactRoot.render(
    <HassProvider>
      <App />
    </HassProvider>
  );
}
