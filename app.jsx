/* Aether — app shell + sub-page router.
   Pages read their own state from hass via useHass; no mock state lives
   here. */

function App() {
  const hass = useHass();
  const [page, setPage] = React.useState("home");
  const [chatOpen, setChatOpen] = React.useState(false);
  const navigate = (p) => setPage(p);

  const meshAvail = hass ? Object.values(hass.states).filter(
    s => s.entity_id.startsWith("device_tracker.") && s.state === "home"
  ).length : null;

  return (
    <div className="app-shell">
      <header className="brandbar">
        <div className="brand-mark">Æ</div>
        <div className="brand-name">
          <b>Aether</b>
          <span className="brand-sep"> · </span>
          <span className="brand-page">{page.charAt(0).toUpperCase() + page.slice(1)}</span>
        </div>
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

      {hass && (
        <>
          <button
            className="chat-fab"
            onClick={() => setChatOpen(true)}
            aria-label="Open Aether AI"
            title="Aether AI"
          >
            <Icon name="sparkle" size={22} />
          </button>
          <ChatDialog
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            hass={hass}
          />
        </>
      )}
    </div>
  );
}

// ─── Aether AI chat ──────────────────────────────────────────────────────
// Talks to HA's built-in conversation integration via the conversation/process
// WebSocket command. With only the default agent installed, this handles
// HA-specific intents ("turn on the lights", "what's the temperature in the
// office?"). If the user configures an LLM agent (OpenAI, Anthropic, Gemini)
// via the Conversation integration, those plus open-ended chat are handled
// automatically — same WS endpoint, the user just picks the agent.
function ChatDialog({ open, onClose, hass }) {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput]       = React.useState("");
  const [sending, setSending]   = React.useState(false);
  const [conversationId, setConversationId] = React.useState(null);
  const [agents, setAgents]     = React.useState([]);
  const [agentId, setAgentId]   = React.useState(null);
  const scrollRef = React.useRef(null);
  const scrollTop = useModalAnchor(open);

  // Load available conversation agents (Home Assistant + any LLM ones the
  // user has configured) so we can let them pick.
  React.useEffect(() => {
    if (!open || !hass) return;
    hass.callWS({ type: "conversation/agent/list" })
      .then((r) => {
        const list = r?.agents || [];
        setAgents(list);
        if (!agentId && list.length > 0) setAgentId(list[0].id);
      })
      .catch(() => { /* default agent is implicit */ });
  }, [open, hass]);

  // Auto-scroll to bottom as messages come in
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setSending(true);
    try {
      const r = await hass.callWS({
        type: "conversation/process",
        text,
        conversation_id: conversationId,
        agent_id: agentId || undefined,
      });
      const speech = r?.response?.speech?.plain?.speech
        || r?.response?.card?.default?.content
        || "(no response)";
      const errType = r?.response?.response_type === "error"
        ? (r?.response?.data?.code || "error") : null;
      setMessages((m) => [...m, { role: "assistant", text: speech, error: !!errType }]);
      if (r?.conversation_id) setConversationId(r.conversation_id);
    } catch (err) {
      setMessages((m) => [...m, {
        role: "assistant",
        text: "Error: " + (err?.message || String(err)),
        error: true,
      }]);
    }
    setSending(false);
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId(null);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop chat-backdrop" onClick={onClose} style={{ top: scrollTop }}>
      <div className="modal chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            Aether AI
            {agents.length > 1 && (
              <select
                className="chat-agent"
                value={agentId || ""}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </h3>
          <div style={{ display: "flex", gap: 8 }}>
            {messages.length > 0 && (
              <button className="modal-close" onClick={clearChat} title="Clear">↺</button>
            )}
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-title">How can I help?</div>
              <div className="chat-empty-sub">
                Ask about your home, or give me a command. Try:
              </div>
              <div className="chat-suggestions">
                {[
                  "Turn off all the lights",
                  "What's the temperature in the office?",
                  "Play jazz in the kitchen",
                  "Is the front door locked?",
                ].map((s) => (
                  <button
                    key={s}
                    className="chat-suggestion"
                    onClick={() => { setInput(s); setTimeout(send, 0); }}
                  >{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={"chat-msg chat-msg-" + m.role + (m.error ? " err" : "")}>
                <div className="chat-bubble">{m.text}</div>
              </div>
            ))
          )}
          {sending && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-bubble chat-typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
        </div>

        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Ask anything…"
            autoFocus
          />
          <button
            className="chat-send"
            onClick={send}
            disabled={sending || !input.trim()}
            aria-label="Send"
          >
            <Icon name="next" size={16} />
          </button>
        </div>
      </div>
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
