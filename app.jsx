/* Aether — app shell + sub-page router.
   Pages read their own state from hass via useHass; no mock state lives
   here. */

function App() {
  const hass = useHass();
  const [page, setPage] = React.useState("home");
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatAutoListen, setChatAutoListen] = React.useState(false);
  const navigate = (p) => setPage(p);

  // Wake-word listener (if configured). Runs continuously when enabled,
  // opens the chat + activates the mic when the configured phrase is
  // heard. Mounted at the App level so it works even when the chat is
  // closed.
  const wakeWord = window.AETHER_CONFIG?.voice?.wakeWord;
  const voiceEnabled = window.AETHER_CONFIG?.voice?.enabled !== false;
  React.useEffect(() => {
    if (!voiceEnabled || !wakeWord || chatOpen) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = window.AETHER_CONFIG?.voice?.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    let stopped = false;
    const wake = wakeWord.toLowerCase().trim();

    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0]?.transcript?.toLowerCase() || "";
        if (transcript.includes(wake)) {
          stopped = true;
          try { recognition.stop(); } catch {}
          setChatAutoListen(true);
          setChatOpen(true);
          return;
        }
      }
    };
    recognition.onerror = () => { /* silently ignore — restart loop covers it */ };
    recognition.onend = () => {
      // Auto-restart while we're still supposed to be listening
      if (!stopped) {
        try { recognition.start(); } catch {}
      }
    };
    try { recognition.start(); } catch {}
    return () => {
      stopped = true;
      try { recognition.stop(); } catch {}
    };
  }, [voiceEnabled, wakeWord, chatOpen]);

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
            onClose={() => { setChatOpen(false); setChatAutoListen(false); }}
            hass={hass}
            autoListen={chatAutoListen}
            onAutoListenConsumed={() => setChatAutoListen(false)}
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
function ChatDialog({ open, onClose, hass, autoListen, onAutoListenConsumed }) {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput]       = React.useState("");
  const [sending, setSending]   = React.useState(false);
  const [conversationId, setConversationId] = React.useState(null);
  const [agents, setAgents]     = React.useState([]);
  const [agentId, setAgentId]   = React.useState(null);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim]   = React.useState("");
  const scrollRef     = React.useRef(null);
  const recognitionRef = React.useRef(null);
  const scrollTop = useModalAnchor(open);

  const voiceCfg     = window.AETHER_CONFIG?.voice || {};
  const voiceEnabled = voiceCfg.enabled !== false;
  const speakReplies = voiceEnabled && voiceCfg.speakResponses !== false;
  const sttSupported = typeof window !== "undefined" &&
                       !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Load available conversation agents (Home Assistant + any LLM ones the
  // user has configured) so we can let them pick. Auto-prefers an LLM
  // agent (Anthropic / OpenAI / Gemini) over the default HA intent agent,
  // because that's almost always the smarter answer. User's explicit
  // selection is persisted to frontend/get_user_data and remembered.
  React.useEffect(() => {
    if (!open || !hass) return;
    (async () => {
      let list = [];
      try {
        const r = await hass.callWS({ type: "conversation/agent/list" });
        list = r?.agents || [];
      } catch {}
      setAgents(list);
      if (!list.length) return;

      // Restore previously chosen agent if it still exists
      let restored = null;
      try {
        const r = await hass.callWS({
          type: "frontend/get_user_data",
          key:  "aether_chat_agent",
        });
        if (r?.value && list.find(a => a.id === r.value)) restored = r.value;
      } catch {}

      const llmPriority = [
        (a) => /anthropic|claude/i.test(a.name || ""),
        (a) => /openai|gpt/i.test(a.name || ""),
        (a) => /google.*generative|gemini/i.test(a.name || ""),
        (a) => a.id !== "homeassistant" && a.id !== "conversation.home_assistant",
      ];
      const pick = restored
        || llmPriority.map(p => list.find(p)).find(Boolean)?.id
        || list[0].id;
      if (!agentId) setAgentId(pick);
    })();
  }, [open, hass]);

  const onAgentChange = async (newId) => {
    setAgentId(newId);
    setConversationId(null); // new agent → fresh conversation
    try {
      await hass.callWS({
        type: "frontend/set_user_data",
        key:  "aether_chat_agent",
        value: newId,
      });
    } catch {}
  };

  // Auto-scroll to bottom as messages come in
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async (override) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setInterim("");
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
      // Speak the assistant's reply aloud
      if (speakReplies && !errType) speak(speech);
    } catch (err) {
      const msg = "Error: " + (err?.message || String(err));
      setMessages((m) => [...m, { role: "assistant", text: msg, error: true }]);
    }
    setSending(false);
  };

  // ─── Text-to-speech: try browser SpeechSynthesis, fall back to HA TTS ─
  const speak = React.useCallback(async (text) => {
    if (!speakReplies || !text) return;
    console.log("[aether] speak:", text.slice(0, 80));

    const tryBrowserTTS = () => new Promise((resolve) => {
      if (typeof window.speechSynthesis === "undefined") {
        console.warn("[aether] speechSynthesis not available");
        return resolve(false);
      }

      const doSpeak = () => {
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang  = voiceCfg.language || "en-US";
          u.rate  = voiceCfg.rate  ?? 1.0;
          u.pitch = voiceCfg.pitch ?? 1.0;
          const voices = window.speechSynthesis.getVoices();
          const pref = voiceCfg.preferredVoice;
          const match = pref && voices.find((v) =>
            v.name.toLowerCase().includes(pref.toLowerCase()));
          if (match) u.voice = match;
          else {
            const enVoice = voices.find((v) => v.lang?.startsWith(u.lang.slice(0, 2))
              && (v.name.includes("Google") || v.name.includes("Samantha")
                  || v.name.includes("Daniel") || v.default));
            if (enVoice) u.voice = enVoice;
          }
          let started = false;
          u.onstart = () => { started = true; console.log("[aether] browser TTS started, voice:", u.voice?.name || "default"); resolve(true); };
          u.onend   = () => console.log("[aether] browser TTS finished");
          u.onerror = (e) => { console.warn("[aether] browser TTS error:", e.error); if (!started) resolve(false); };
          window.speechSynthesis.speak(u);
          // If onstart doesn't fire within 1.2s, assume the browser silently failed
          setTimeout(() => { if (!started) resolve(false); }, 1200);
        } catch (e) {
          console.warn("[aether] browser TTS exception:", e);
          resolve(false);
        }
      };

      // Voices may load asynchronously on first call — wait for them
      if (window.speechSynthesis.getVoices().length === 0) {
        console.log("[aether] voice list empty, waiting for voiceschanged…");
        window.speechSynthesis.addEventListener("voiceschanged", doSpeak, { once: true });
        setTimeout(doSpeak, 300); // belt-and-suspenders if event never fires
      } else {
        doSpeak();
      }
    });

    const tryHATTS = async () => {
      const mp  = voiceCfg.ttsMediaPlayer;
      const svc = voiceCfg.ttsService;
      if (!mp || !hass) {
        console.log("[aether] HA TTS not configured (need voice.ttsMediaPlayer + voice.ttsService)");
        return false;
      }
      try {
        if (svc) {
          // Modern tts.speak: TTS service entity goes in TARGET, not data.
          // Signature: callService(domain, service, serviceData, target)
          await hass.callService(
            "tts",
            "speak",
            { media_player_entity_id: mp, message: text, cache: true },
            { entity_id: svc }
          );
        } else {
          // Legacy fallback: tts.google_translate_say — target is the player
          await hass.callService("tts", "google_translate_say", {
            entity_id: mp,
            message: text,
          });
        }
        console.log("[aether] HA TTS sent via", svc || "tts.google_translate_say", "→", mp);
        return true;
      } catch (e) {
        console.warn("[aether] HA TTS failed:", e?.message || e);
        return false;
      }
    };

    const browserOK = voiceCfg.forceHATTS ? false : await tryBrowserTTS();
    if (!browserOK) {
      if (!voiceCfg.forceHATTS) {
        console.log("[aether] browser TTS failed/unavailable — trying HA TTS fallback");
      } else {
        console.log("[aether] forceHATTS — routing TTS through HA");
      }
      await tryHATTS();
    }
  }, [speakReplies, voiceCfg, hass]);

  // ─── Speech-to-text: tap-to-talk button. Captures speech, fills the
  // input as interim text, and auto-sends when done. ───────────────────
  const stopListening = React.useCallback(() => {
    const r = recognitionRef.current;
    if (r) {
      try { r.stop(); } catch {}
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const startListening = React.useCallback(() => {
    if (!sttSupported || listening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = voiceCfg.language || "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    let finalText = "";

    recognition.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0]?.transcript || "";
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText);
      if (finalText) setInput(finalText);
    };
    recognition.onerror = (e) => {
      console.warn("[aether] STT error:", e.error);
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      const cleaned = finalText.trim();
      setInterim("");
      if (cleaned) send(cleaned);
    };
    try {
      recognition.start();
      setListening(true);
      recognitionRef.current = recognition;
    } catch (e) {
      console.warn("[aether] STT start failed:", e);
    }
  }, [sttSupported, listening, voiceCfg.language, send]);

  // Auto-start mic when chat was opened by the wake word
  React.useEffect(() => {
    if (open && autoListen && sttSupported) {
      onAutoListenConsumed?.();
      // Tiny delay so the dialog has mounted before mic acquires focus
      const t = setTimeout(() => startListening(), 250);
      return () => clearTimeout(t);
    }
  }, [open, autoListen, sttSupported, startListening, onAutoListenConsumed]);

  const clearChat = () => {
    setMessages([]);
    setConversationId(null);
    try { window.speechSynthesis?.cancel(); } catch {}
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
                onChange={(e) => onAgentChange(e.target.value)}
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
            value={listening ? (interim || input) : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder={listening ? "Listening…" : "Ask anything…"}
            autoFocus
            disabled={listening}
          />
          {voiceEnabled && sttSupported && (
            <button
              className={"chat-mic" + (listening ? " on" : "")}
              onClick={() => listening ? stopListening() : startListening()}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              title={listening ? "Stop" : "Hold to talk"}
            >
              {listening
                ? <span className="chat-mic-pulse" />
                : <Icon name="mic" size={16} />}
            </button>
          )}
          <button
            className="chat-send"
            onClick={() => send()}
            disabled={sending || !input.trim() || listening}
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
