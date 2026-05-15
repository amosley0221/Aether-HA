/* Aether — app shell + sub-page router.
   Pages read their own state from hass via useHass; no mock state lives
   here. */

function App() {
  const hass = useHass();
  const [page, setPage] = React.useState("home");
  const navigate = (p) => setPage(p);

  const meshAvail = hass ? Object.values(hass.states).filter(
    s => s.entity_id.startsWith("device_tracker.") && s.state === "home"
  ).length : null;

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
        {meshAvail != null && (
          <div className="brand-pill"><Icon name="wifi" size={13} /> Mesh · {meshAvail}</div>
        )}
        <div className="brand-avatar">
          {(window.AETHER_CONFIG?.user?.name || hass?.user?.name || "?").slice(0, 1).toUpperCase()}
        </div>
      </header>

      <main>
        {page === "home"      && <HomePage navigate={navigate} />}
        {page === "music"     && <MusicPage />}
        {page === "dashboard" && <DashboardPage />}
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
