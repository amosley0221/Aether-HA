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
    let restartTimer = null;
    const wake = wakeWord.toLowerCase().trim();

    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0]?.transcript?.toLowerCase() || "";
        if (transcript.includes(wake)) {
          console.log("[Aether voice] wake word matched:", transcript);
          stopped = true;
          // abort() releases the mic immediately. stop() lingers and can
          // block the chat dialog's mic recognizer from acquiring it.
          try { recognition.abort(); } catch {}
          // Give Android WebView a beat to release the mic device before
          // the chat dialog tries to grab it.
          setTimeout(() => {
            setChatAutoListen(true);
            setChatOpen(true);
          }, 150);
          return;
        }
      }
    };
    recognition.onerror = (e) => {
      console.log("[Aether voice] wake recognition error:", e.error);
    };
    recognition.onend = () => {
      // Web Speech ends sessions every ~60s on Android WebView. Restart
      // unless we intentionally stopped. Small backoff so we don't busy-loop
      // if start() keeps failing.
      if (stopped) return;
      restartTimer = setTimeout(() => {
        try { recognition.start(); } catch (err) {
          console.log("[Aether voice] wake restart failed:", err);
        }
      }, 250);
    };
    try { recognition.start(); } catch (err) {
      console.log("[Aether voice] wake start failed:", err);
    }
    return () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      try { recognition.abort(); } catch {}
    };
  }, [voiceEnabled, wakeWord, chatOpen]);

  // ─── Brandbar status pills ───────────────────────────────────────────
  // Left pill scans for active issues:
  //   - battery_level / battery_percent sensors below 20%
  //   - any entity in `unavailable` state (excluding diagnostic-only ones)
  //   - update entities with state "on" (HA Core, integrations, HACS)
  // Right pill auto-detects a Deco mesh integration. Falls back to a
  // generic internet binary_sensor if Deco isn't found.
  const [statusOpen, setStatusOpen] = React.useState(false);

  // Built-in browser modal — opens YouTube/Twitch embeds, DuckDuckGo
  // searches, or arbitrary URLs when the AI agent (or any script)
  // fires an `aether_browser_open` event.
  //
  // Event payload: { kind, value, title? }
  //   kind: "youtube" | "twitch" | "search" | "url"
  //   value: the video ID/URL, channel name, search query, or raw URL
  const [browserState, setBrowserState] = React.useState(null);
  React.useEffect(() => {
    if (!hass?.connection?.subscribeEvents) return;
    let unsub = null;
    let cancelled = false;
    hass.connection.subscribeEvents((event) => {
      if (cancelled) return;
      const d = event?.data || {};
      const built = buildBrowserUrl(d.kind, d.value);
      if (!built) {
        console.warn("[aether browser] bad payload, ignoring:", d);
        return;
      }
      setBrowserState({ url: built, title: d.title || defaultBrowserTitle(d.kind, d.value) });
    }, "aether_browser_open").then((u) => {
      if (cancelled) u();
      else unsub = u;
    }).catch((e) => console.warn("[aether browser] subscribe failed:", e));
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [hass]);

  const issues = React.useMemo(() => {
    if (!hass) return { batteries: [], unavailable: [], updates: [] };
    const states = Object.values(hass.states);

    // User-configurable ignore list from aether-config.js. Entries can be
    // exact entity IDs ("sensor.front_battery_2") or regex strings
    // ("^sensor\\.guest_.*"). Skipped from all three issue categories.
    const ignoreList = window.AETHER_CONFIG?.statusPillIgnore || [];
    const ignoreRegexes = ignoreList.map((p) => {
      try { return new RegExp(p); } catch { return null; }
    }).filter(Boolean);
    const isIgnored = (entity_id) =>
      ignoreList.includes(entity_id) ||
      ignoreRegexes.some((r) => r.test(entity_id));

    const batteries = states.filter((s) => {
      if (s.attributes?.device_class !== "battery") return false;
      if (isIgnored(s.entity_id)) return false;
      const n = Number(s.state);
      return Number.isFinite(n) && n > 0 && n <= 20;
    }).map((s) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name || s.entity_id,
      level: Math.round(Number(s.state)),
    }));

    // Mobile App / iCloud / device-tracker companion sensors are
    // routinely "unavailable" when phones/tablets sleep or lock — they
    // come back the moment the device wakes. Skip the canonical suffixes
    // so the status pill only flags things that are actually broken.
    const MOBILE_APP_NOISE = /(_sim_\d+|_bssid|_ssid|_connection_type|_audio_output|_geocoded_location|_storage|_last_update_trigger|_battery_state|_app_version|_ssid_\d+|_activity|_steps|_pedometer|_distance|_floors|_cellular|_phone_calling|_average_active_pace)$/;

    // Domains we DON'T scan for "unavailable":
    //   light       — routinely "unavailable" when powered off at the
    //                 wall switch; indistinguishable from a real outage
    //                 in HA, and false-positive rate is too high.
    //   media_player — TVs/speakers go unavailable when off; expected.
    //   sensor      — too many transient/on-demand sensors (Tesla,
    //                 calendar lookups, etc.) report "unavailable" by
    //                 design when not actively producing data.
    //   binary_sensor — same noise problem at scale.
    //
    // We DO scan: switch, climate, lock, cover, fan, camera, vacuum,
    // remote — these going unavailable almost always means a real
    // integration outage worth flagging.
    const UNAVAIL_DOMAINS = new Set([
      "switch", "climate", "lock", "cover", "fan", "camera",
      "vacuum", "remote",
    ]);

    const unavailable = states.filter((s) => {
      if (s.state !== "unavailable") return false;
      if (isIgnored(s.entity_id)) return false;
      const cat = s.attributes?.entity_category;
      if (cat === "diagnostic" || cat === "config") return false;
      if (MOBILE_APP_NOISE.test(s.entity_id)) return false;
      const domain = s.entity_id.split(".")[0];
      return UNAVAIL_DOMAINS.has(domain);
    }).map((s) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name || s.entity_id,
    }));

    const updates = states.filter((s) =>
      s.entity_id.startsWith("update.") &&
      s.state === "on" &&
      !isIgnored(s.entity_id)
    ).map((s) => ({
      entity_id: s.entity_id,
      name: s.attributes?.friendly_name || s.entity_id,
      installed: s.attributes?.installed_version,
      latest: s.attributes?.latest_version,
    }));

    return { batteries, unavailable, updates };
  }, [hass]);

  const totalIssues = issues.batteries.length + issues.unavailable.length + issues.updates.length;
  const statusLabel = totalIssues === 0
    ? "All systems normal"
    : totalIssues === 1 ? "1 issue" : `${totalIssues} issues`;
  const statusTone = totalIssues === 0 ? "ok"
                   : issues.unavailable.length > 0 ? "alert"
                   : "warn";

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
        <button
          className={"brand-pill brand-pill-clickable brand-pill-" + statusTone}
          onClick={() => totalIssues > 0 && setStatusOpen(true)}
          title={totalIssues > 0 ? "Tap to see details" : "Nothing needs attention"}
        >
          <span className="dot" /> {statusLabel}
        </button>
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
      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        issues={issues}
      />
      <BrowserModal
        state={browserState}
        onClose={() => setBrowserState(null)}
      />
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
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  // Reference to the latest hass object — needed inside async watchers
  // that poll media_player state. Closure-captured hass goes stale on
  // every re-render; the ref always points at the current value.
  const hassRef = React.useRef(hass);
  React.useEffect(() => { hassRef.current = hass; }, [hass]);

  // Strip emojis, markdown asterisks, and other characters TTS engines
  // mispronounce. The agent often emits 👋, 🎉, **bold**, etc. for
  // emphasis - these read aloud as "waving hand sign", "party popper",
  // or literal stars, which breaks immersion.
  const cleanForSpeech = (text) => text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/\*+/g, "")          // **bold** -> bold
    .replace(/_{2,}/g, "")         // __underline__
    .replace(/`+/g, "")            // `code`
    .replace(/\s{2,}/g, " ")       // collapse extra whitespace from stripped chars
    .trim();

  const cancelSpeech = React.useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch {}
    // Only call media_stop on the HA TTS player if it's actually playing.
    // Cast players (e.g. the Pixel Tablet) throw a 500 if you call stop
    // while they're idle, which surfaces as a noisy red toast even when
    // we .catch() the promise (HA renders the error from the WS layer
    // before the promise reaches us).
    const mp = voiceCfg?.ttsMediaPlayer;
    const playing = mp && hassRef.current?.states?.[mp]?.state === "playing";
    if (playing && hassRef.current?.callService) {
      hassRef.current.callService("media_player", "media_stop", { entity_id: mp })
        .catch(() => { /* swallowed; some integrations still error */ });
    }
    setIsSpeaking(false);
  }, [voiceCfg]);

  const speak = React.useCallback(async (text) => {
    if (!speakReplies || !text) return;
    const speakable = cleanForSpeech(text);
    if (!speakable) return;
    console.log("[aether] speak:", speakable.slice(0, 80));
    setIsSpeaking(true);
    let completed = false;
    const onComplete = () => {
      if (completed) return;
      completed = true;
      setIsSpeaking(false);
    };

    // Poll window.speechSynthesis.speaking instead of relying on the
    // onend event. On Android WebView, onend fires prematurely between
    // chunked speech segments (long text gets split internally) which
    // would yank the stop button away mid-sentence. `speaking` is
    // truthy as long as ANY utterance is in flight, so polling is
    // reliable across all browsers.
    const watchBrowserSpeechEnd = () => {
      const iv = setInterval(() => {
        if (completed) { clearInterval(iv); return; }
        if (!window.speechSynthesis?.speaking && !window.speechSynthesis?.pending) {
          clearInterval(iv);
          onComplete();
        }
      }, 300);
      // Safety: hard cap at 5 minutes
      setTimeout(() => clearInterval(iv), 5 * 60 * 1000);
    };

    // For HA TTS, poll the media_player entity state. tts.speak resolves
    // once the audio is queued, not when it finishes — so we watch the
    // player: it enters "playing" while speaking the message, then
    // transitions to "idle"/"off" when done. Far more accurate than
    // estimating from character count, especially for engines like
    // Piper that synthesize at different speeds than Google Translate.
    const watchHAPlayerEnd = async (mp) => {
      const start = Date.now();
      // Wait up to 5s for the player to enter "playing"
      let entered = false;
      while (Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 200));
        const st = hassRef.current?.states?.[mp]?.state;
        if (st === "playing") { entered = true; break; }
      }
      if (!entered) { onComplete(); return; }
      // Wait until it leaves "playing", capped at 2 minutes
      const playEnded = Date.now();
      while (Date.now() - playEnded < 120000) {
        await new Promise((r) => setTimeout(r, 300));
        const st = hassRef.current?.states?.[mp]?.state;
        if (st !== "playing") break;
        if (completed) return; // user cancelled
      }
      onComplete();
    };

    const tryBrowserTTS = () => new Promise((resolve) => {
      if (typeof window.speechSynthesis === "undefined") {
        console.warn("[aether] speechSynthesis not available");
        return resolve(false);
      }

      const doSpeak = () => {
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(speakable);
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
          u.onstart = () => {
            started = true;
            console.log("[aether] browser TTS started, voice:", u.voice?.name || "default");
            watchBrowserSpeechEnd();
            resolve(true);
          };
          u.onerror = (e) => {
            console.warn("[aether] browser TTS error:", e.error);
            onComplete();
            if (!started) resolve(false);
          };
          window.speechSynthesis.speak(u);
          // If onstart doesn't fire within 1.2s, assume the browser silently failed
          setTimeout(() => { if (!started) resolve(false); }, 1200);
        } catch (e) {
          console.warn("[aether] browser TTS exception:", e);
          onComplete();
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
        onComplete();
        return false;
      }
      try {
        if (svc) {
          await hass.callService(
            "tts",
            "speak",
            { media_player_entity_id: mp, message: speakable, cache: true },
            { entity_id: svc }
          );
        } else {
          await hass.callService("tts", "google_translate_say", {
            entity_id: mp,
            message: speakable,
          });
        }
        console.log("[aether] HA TTS sent via", svc || "tts.google_translate_say", "→", mp);
        // Poll the media_player state to know when speech actually ends,
        // not when tts.speak resolves (which only confirms the audio
        // was queued).
        watchHAPlayerEnd(mp);
        return true;
      } catch (e) {
        console.warn("[aether] HA TTS failed:", e?.message || e);
        onComplete();
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

  // Auto-start mic when chat was opened by the wake word.
  //
  // History of bugs this guards against:
  //   1) Effect cleanup canceling the retry timers. Solved by storing
  //      timers in a ref that survives re-renders.
  //   2) Stale closure on startListening — the captured callback had an
  //      out-of-date `listening` value, causing retries to silently no-op
  //      or double-start. Solved by routing through startListeningRef.
  //   3) Re-arming on every state change. Solved by a "fired once" ref
  //      that resets only when the dialog closes.
  // After TTS finishes speaking, optionally auto-start the mic for a few
  // seconds so the user can reply naturally without re-tapping. Disable
  // by setting voice.autoFollowup: false in aether-config.js. Cancels
  // cleanly if the user opens/closes the chat in the meantime.
  const autoFollowup = voiceCfg.autoFollowup !== false;
  const wasSpeakingRef = React.useRef(false);
  React.useEffect(() => {
    if (!open || !autoFollowup) {
      wasSpeakingRef.current = isSpeaking;
      return;
    }
    if (wasSpeakingRef.current && !isSpeaking) {
      // Speech just ended — open the mic
      const t = setTimeout(() => {
        if (!listeningRef.current) {
          try { startListeningRef.current?.(); } catch {}
        }
      }, 200);
      wasSpeakingRef.current = false;
      return () => clearTimeout(t);
    }
    wasSpeakingRef.current = isSpeaking;
  }, [isSpeaking, open, autoFollowup]);

  const autoListenFiredRef   = React.useRef(false);
  const autoListenTimersRef  = React.useRef([]);
  const startListeningRef    = React.useRef(startListening);
  const listeningRef         = React.useRef(listening);
  React.useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  React.useEffect(() => { listeningRef.current = listening; }, [listening]);

  const cancelAutoListenTimers = () => {
    autoListenTimersRef.current.forEach((t) => clearTimeout(t));
    autoListenTimersRef.current = [];
  };
  React.useEffect(() => {
    if (!open) {
      autoListenFiredRef.current = false;
      cancelAutoListenTimers();
      // Closing the chat should stop any in-flight speech immediately.
      cancelSpeech();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || !autoListen || !sttSupported) return;
    if (autoListenFiredRef.current) return;
    autoListenFiredRef.current = true;
    console.log("[Aether voice] autoListen scheduling 3 attempts");

    const tryStart = (label) => {
      if (listeningRef.current) {
        console.log("[Aether voice] autoListen", label, "skipped (already listening)");
        return;
      }
      console.log("[Aether voice] autoListen attempt:", label);
      try { startListeningRef.current?.(); } catch (err) {
        console.log("[Aether voice] startListening threw:", err);
      }
    };
    autoListenTimersRef.current = [
      setTimeout(() => tryStart("primary @400ms"), 400),
      setTimeout(() => tryStart("retry @1500ms"), 1500),
      setTimeout(() => tryStart("retry @3000ms"), 3000),
    ];
    onAutoListenConsumed?.();
  }, [open, autoListen, sttSupported, onAutoListenConsumed]);

  const clearChat = () => {
    setMessages([]);
    setConversationId(null);
    cancelSpeech();
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
            {isSpeaking && (
              <button
                className="modal-close chat-stop-speak"
                onClick={cancelSpeech}
                title="Stop speaking"
                aria-label="Stop speaking"
              >■</button>
            )}
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

// ─── Status dialog: lists active issues from the brandbar status pill ────
function StatusDialog({ open, onClose, issues }) {
  if (!open) return null;
  const total = issues.batteries.length + issues.unavailable.length + issues.updates.length;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ top: window.scrollY }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>System status · {total} {total === 1 ? "issue" : "issues"}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {issues.unavailable.length > 0 && (
            <div className="status-group">
              <div className="status-group-head">
                <strong>Unavailable</strong>
                <span className="status-count">{issues.unavailable.length}</span>
              </div>
              {issues.unavailable.map((i) => (
                <div key={i.entity_id} className="status-row">
                  <span className="status-name">{i.name}</span>
                  <code className="status-entity">{i.entity_id}</code>
                </div>
              ))}
            </div>
          )}
          {issues.batteries.length > 0 && (
            <div className="status-group">
              <div className="status-group-head">
                <strong>Low batteries</strong>
                <span className="status-count">{issues.batteries.length}</span>
              </div>
              {issues.batteries
                .sort((a, b) => a.level - b.level)
                .map((i) => (
                <div key={i.entity_id} className="status-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="status-name">{i.name}</div>
                    <code className="status-entity" style={{ marginTop: 2, display: "inline-block" }}>
                      {i.entity_id}
                    </code>
                  </div>
                  <span className={"status-battery" + (i.level <= 10 ? " critical" : "")}>
                    {i.level}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {issues.updates.length > 0 && (
            <div className="status-group">
              <div className="status-group-head">
                <strong>Updates available</strong>
                <span className="status-count">{issues.updates.length}</span>
              </div>
              {issues.updates.map((i) => (
                <div key={i.entity_id} className="status-row">
                  <span className="status-name">{i.name}</span>
                  <span className="status-version">
                    {i.installed || "?"} → {i.latest || "?"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {total === 0 && (
            <div style={{ color: "var(--ink-3)", padding: "12px 0" }}>
              Everything looks good. No active issues.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Built-in browser modal ──────────────────────────────────────────────
// Embeds YouTube/Twitch players, DuckDuckGo searches, or arbitrary URLs
// when an `aether_browser_open` event fires. Most streaming services
// (Netflix, Disney+, Hulu, Prime, etc.) explicitly block iframe embedding
// via X-Frame-Options - those have to launch on a TV instead. YouTube,
// Twitch, and DuckDuckGo all allow embedding. Twitch's embed URL requires
// a `parent=<hostname>` parameter that matches where the iframe is loaded,
// which we fill in from window.location.hostname at runtime.
function buildBrowserUrl(kind, value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (kind === "youtube") {
    // Accept either a raw video ID or a youtube URL/share link
    let id = v;
    if (/^https?:\/\//.test(v)) {
      try {
        const u = new URL(v);
        id = u.searchParams.get("v")
          || (u.hostname === "youtu.be" ? u.pathname.replace(/^\/+/, "") : "")
          || u.pathname.split("/").pop();
      } catch { id = v; }
    }
    if (!id) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
  }
  if (kind === "twitch") {
    const ch = v.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "").split(/[/?#]/)[0];
    if (!ch) return null;
    return `https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${window.location.hostname}&autoplay=true`;
  }
  if (kind === "search") {
    // DuckDuckGo's main site (duckduckgo.com) now sets X-Frame-Options:
    // SAMEORIGIN which blocks iframe embedding. Their HTML-only lite
    // endpoint (html.duckduckgo.com/html) doesn't set that header so
    // it still works as an embedded search results page.
    return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(v)}`;
  }
  // kind === "url" (or anything else) — pass through
  if (!/^https?:\/\//.test(v)) return `https://${v}`;
  return v;
}

function defaultBrowserTitle(kind, value) {
  if (kind === "youtube") return "YouTube";
  if (kind === "twitch")  return `Twitch · ${value}`;
  if (kind === "search")  return `Search · ${value}`;
  try { return new URL(value).hostname; } catch { return "Browser"; }
}

function BrowserModal({ state, onClose }) {
  if (!state || !state.url) return null;
  return (
    <div className="modal-backdrop browser-modal-backdrop" onClick={onClose}>
      <div className="browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="browser-modal-head">
          <h3>{state.title}</h3>
          <div className="browser-modal-actions">
            <a
              className="browser-modal-open"
              href={state.url}
              target="_blank"
              rel="noreferrer"
              title="Open in a new browser tab"
            >
              Open externally ↗
            </a>
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <iframe
          src={state.url}
          className="browser-modal-frame"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
          title={state.title}
        />
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
