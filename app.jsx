/* Aether — app shell + sub-page router.
   Pages read their own state from hass via useHass; no mock state lives
   here. */

function App() {
  const hass = useHass();
  const [page, setPage] = React.useState("home");
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatAutoListen, setChatAutoListen] = React.useState(false);
  const [editHome, setEditHome] = React.useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = React.useState(false);
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

    const updates = states.filter((s) => {
      if (!s.entity_id.startsWith("update.")) return false;
      if (isIgnored(s.entity_id)) return false;
      if (s.state === "on") return true;
      // Some installs flip the entity to "off" briefly while the
      // attributes still report progress (HA 2024.11+ split
      // `update_percentage` out from `in_progress`).
      const ip  = s.attributes?.in_progress;
      const pct = s.attributes?.update_percentage;
      return ip === true || typeof ip === "number" || typeof pct === "number";
    }).map((s) => {
      const ip  = s.attributes?.in_progress;
      const pct = s.attributes?.update_percentage;
      const percentage = typeof pct === "number" ? pct
                       : typeof ip === "number"  ? ip
                       : null;
      const installing = ip === true || percentage != null;
      return {
        entity_id: s.entity_id,
        name: s.attributes?.friendly_name || s.entity_id,
        installed: s.attributes?.installed_version,
        latest: s.attributes?.latest_version,
        installing,
        percentage,
        releaseUrl: s.attributes?.release_url,
      };
    });

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
        <div className="brand-avatar-wrap">
          <button
            className="brand-avatar"
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label="Account menu"
          >
            {(window.AETHER_CONFIG?.user?.name || hass?.user?.name || "?").slice(0, 1).toUpperCase()}
          </button>
          {avatarMenuOpen && (
            <>
              <div
                className="avatar-menu-backdrop"
                onClick={() => setAvatarMenuOpen(false)}
              />
              <div className="avatar-menu">
                <button
                  className="avatar-menu-item"
                  onClick={() => {
                    setAvatarMenuOpen(false);
                    setPage("home");
                    setEditHome(true);
                  }}
                >
                  <Icon name="grid" size={14} /> Edit home
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main>
        {page === "home"      && <HomePage navigate={navigate} editMode={editHome} onExitEdit={() => setEditHome(false)} />}
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
        hass={hass}
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

  // Auto-close on inactivity. Anything that should count as "active"
  // (typing, speaking, listening, agent thinking, scrolling, etc.)
  // calls bumpIdleTimer() to reset the countdown.
  const idleSeconds = window.AETHER_CONFIG?.chat?.idleTimeoutSeconds ?? 90;
  const idleTimerRef = React.useRef(null);
  const bumpIdleTimer = React.useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!open || idleSeconds <= 0) return;
    idleTimerRef.current = setTimeout(() => {
      console.log("[aether chat] idle for", idleSeconds, "s — auto-closing");
      onClose();
    }, idleSeconds * 1000);
  }, [open, onClose, idleSeconds]);

  // Clear the timer when the dialog closes, otherwise it could fire onClose
  // after the user has already moved on (and possibly re-opened) the chat.
  React.useEffect(() => {
    if (!open && idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [open]);

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
      // Speak the assistant's reply aloud, then optionally re-open the
      // mic for a natural conversational follow-up. Using a callback
      // instead of an isSpeaking-based useEffect avoids a render race
      // for very short responses (where isSpeaking can flip
      // true→false in the same React batch and the effect misses it).
      if (speakReplies && !errType) {
        speak(speech, {
          onDone: () => {
            if (voiceCfg.autoFollowup !== false && open && !listeningRef.current) {
              setTimeout(() => {
                if (!listeningRef.current) {
                  try { startListeningRef.current?.(); } catch {}
                }
              }, 250);
            }
          },
        });
      }
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

  // Bump the inactivity countdown whenever the user is doing something:
  // opening the chat, typing, sending a message, the agent speaking,
  // or the mic actively listening. Pointer events on the modal also
  // bump (see onPointerDown below). Without this, a long-running TTS
  // reply could finish 89s into the timer and close 1s later.
  React.useEffect(() => {
    bumpIdleTimer();
  }, [open, messages.length, input, sending, isSpeaking, listening, bumpIdleTimer]);

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

  const speak = React.useCallback(async (text, { onDone } = {}) => {
    if (!speakReplies || !text) {
      onDone?.();
      return;
    }
    const speakable = cleanForSpeech(text);
    if (!speakable) {
      onDone?.();
      return;
    }
    console.log("[aether] speak:", speakable.slice(0, 80));
    setIsSpeaking(true);
    let completed = false;
    const onComplete = () => {
      if (completed) return;
      completed = true;
      setIsSpeaking(false);
      console.log("[aether] speech complete");
      onDone?.();
    };

    // Poll window.speechSynthesis.speaking instead of relying on the
    // onend event. On Android WebView, onend fires prematurely between
    // chunked speech segments (long text gets split internally) which
    // would yank the stop button away mid-sentence. `speaking` is
    // truthy as long as ANY utterance is in flight, so polling is
    // reliable across all browsers. Require it to stay falsy for
    // ~600ms before declaring done so brief inter-chunk gaps don't
    // trigger a false complete.
    const watchBrowserSpeechEnd = () => {
      let idleSince = null;
      const iv = setInterval(() => {
        if (completed) { clearInterval(iv); return; }
        const idle = !window.speechSynthesis?.speaking && !window.speechSynthesis?.pending;
        if (!idle) {
          idleSince = null;
          return;
        }
        if (idleSince === null) {
          idleSince = Date.now();
          return;
        }
        if (Date.now() - idleSince > 600) {
          clearInterval(iv);
          onComplete();
        }
      }, 200);
      setTimeout(() => clearInterval(iv), 5 * 60 * 1000);
    };

    // For HA TTS, poll the media_player entity state. tts.speak resolves
    // once the audio is queued, not when it finishes — so we watch the
    // player: it enters "playing" while speaking the message, then
    // transitions to "idle"/"off" when done. Same debounce idea as
    // browser TTS to ride out brief "buffering" blips Cast endpoints
    // emit between Piper-generated audio chunks.
    const watchHAPlayerEnd = async (mp) => {
      const start = Date.now();
      // Wait up to 10s for the player to enter "playing"
      let entered = false;
      while (Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 150));
        const st = hassRef.current?.states?.[mp]?.state;
        if (st === "playing") { entered = true; break; }
        if (completed) return;
      }
      if (!entered) { onComplete(); return; }
      // Wait until the player has been NOT-playing for 1.2s straight
      // (allow brief buffering dips during Cast playback).
      let nonPlayingSince = null;
      const watchStart = Date.now();
      while (Date.now() - watchStart < 120000) {
        await new Promise((r) => setTimeout(r, 200));
        if (completed) return;
        const st = hassRef.current?.states?.[mp]?.state;
        if (st === "playing") {
          nonPlayingSince = null;
          continue;
        }
        if (nonPlayingSince === null) {
          nonPlayingSince = Date.now();
        } else if (Date.now() - nonPlayingSince > 1200) {
          break;
        }
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
      <div
        className="modal chat-modal"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={bumpIdleTimer}
        onKeyDown={bumpIdleTimer}
      >
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

// ─── Status pill helpers ─────────────────────────────────────────────────
// Group unavailable entities by a "device key" derived from the entity_id,
// stripping known per-device config-switch suffixes so e.g. eight Sonos
// switches for one speaker collapse into a single row that expands on tap.
// This is the diagnostic that turns "60 unavailable entities" into "8
// affected devices, one of them is Move 2 with 8 of its own entities down" —
// which is the actual signal the user is trying to spot.
const STATUS_DEVICE_SUFFIXES = /(_crossfade|_loudness|_night_sound|_speech_enhancement|_surround_enabled|_surround_music_full_volume|_subwoofer_enabled|_tv_autoplay|_ungroup_on_autoplay|_motion_detection|_live_view|_audio_input_format|_charge_cable_lock|_charge_port_door|_steering_wheel_heater|_defrost_mode|_sentry_mode|_valet_mode|_vent_windows|_climate|_battery)$/;

function statusDeviceKey(entity_id) {
  const local = (entity_id.split(".")[1] || "");
  return local.replace(STATUS_DEVICE_SUFFIXES, "");
}
function statusHumanizeKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map an HA logger name (homeassistant.components.<integration>.foo) to a
// human label. Fallback uses the logger slug capitalized.
const STATUS_INTEGRATION_LABEL = {
  sonos: "Sonos", ring: "Ring", webostv: "LG webOS",
  media_player: "Media player", switch: "Switch", camera: "Camera",
  nanoleaf: "Nanoleaf", apple_tv: "Apple TV", tessie: "Tesla (Tessie)",
  hassio: "Supervisor", go2rtc: "go2rtc", google_nest_sdm: "Google Nest",
  pychromecast: "Chromecast", homekit_controller: "HomeKit",
  alarmo: "Alarmo", calendar: "Calendar", remote_calendar: "Remote Calendar",
  haffmpeg: "Camera (ffmpeg)", music_assistant: "Music Assistant",
};
function statusIntegrationFromLogger(logger) {
  const m = logger.match(/^homeassistant\.components\.([a-z0-9_]+)/);
  if (!m) return null;
  return STATUS_INTEGRATION_LABEL[m[1]] || (m[1].charAt(0).toUpperCase() + m[1].slice(1));
}

// Parse HA's /api/error_log text dump (last ~500 lines) and group entries
// by integration. For each group we count occurrences, capture the most
// recent message, and tally entity_id references so we can surface "this
// integration's errors mostly involve <entity>".
const STATUS_LOG_LINE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) (ERROR|WARNING|CRITICAL) \(.*?\) \[(.*?)\] (.+)$/;
const STATUS_ENTITY_REF = /\b[a-z][a-z_]+\.[a-z0-9_]+\b/g;
function statusParseLog(text) {
  const allLines = (text || "").split("\n");
  // Only consider the last 600 raw lines so a long-lived install doesn't
  // bog the parser. Errors at the bottom are the most recent and most
  // diagnostically useful.
  const lines = allLines.slice(-600);
  const groups = new Map();
  for (const line of lines) {
    const m = line.match(STATUS_LOG_LINE);
    if (!m) continue;
    const [, , level, logger, message] = m;
    const integration = statusIntegrationFromLogger(logger) || "Other";
    let g = groups.get(integration);
    if (!g) {
      g = { integration, count: 0, lastMessage: "", levels: new Set(), entityCounts: new Map() };
      groups.set(integration, g);
    }
    g.count++;
    g.lastMessage = message;
    g.levels.add(level);
    const refs = message.match(STATUS_ENTITY_REF);
    if (refs) for (const ref of refs) g.entityCounts.set(ref, (g.entityCounts.get(ref) || 0) + 1);
  }
  for (const g of groups.values()) {
    const top = [...g.entityCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) g.topEntity = { id: top[0], count: top[1] };
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

// ─── Status dialog: lists active issues from the brandbar status pill ────
function StatusDialog({ open, onClose, issues, hass }) {
  // Track which updates the user has just clicked, so the button shows
  // a "Starting…" state during the gap between clicking Install and
  // the integration reporting progress. Tesla in particular sits in a
  // ~2 minute grace period (cancellable in the Tesla app) before the
  // update actually starts streaming, so we keep this flag for ~5
  // minutes — once the entity reports real progress, the flag is
  // cleared automatically by the effect below.
  const [pending, setPending] = React.useState({});

  // ─── Log diagnostics & device grouping ─────────────────────────────
  // Fetch HA's /api/error_log when the dialog opens, parse it, and surface
  // a "Recent errors" view grouped by integration. This is the diagnostic
  // signal that was invisible during last night's Move 2 cascade — having
  // it in the pill turns "60 unavailable entities" into "Sonos is the
  // integration logging the most failures and Move 2 is the device named
  // most often in those failures."
  const [logErrors, setLogErrors] = React.useState([]);
  const [logLoaded, setLogLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!open || !hass) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await hass.callApi("GET", "error_log");
        if (!cancelled) setLogErrors(statusParseLog(text || ""));
      } catch (err) {
        console.warn("[aether status] error_log fetch failed:", err);
      }
      if (!cancelled) setLogLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [open, hass]);

  // Group unavailable entities by device so 8 Sonos switches collapse to
  // one "Move 2" row. Devices with >1 affected entity are expandable;
  // singletons render inline like before.
  const unavailableByDevice = React.useMemo(() => {
    const groups = new Map();
    for (const i of issues.unavailable) {
      const key = statusDeviceKey(i.entity_id);
      let g = groups.get(key);
      if (!g) {
        g = { key, name: statusHumanizeKey(key), entities: [] };
        groups.set(key, g);
      }
      g.entities.push(i);
    }
    return [...groups.values()].sort((a, b) => b.entities.length - a.entities.length);
  }, [issues.unavailable]);
  const [expandedDevice, setExpandedDevice] = React.useState(null);

  const installUpdate = async (entity_id) => {
    if (!hass?.callService) return;
    setPending((p) => ({ ...p, [entity_id]: Date.now() }));
    try {
      await hass.callService("update", "install", {}, { entity_id });
    } catch (err) {
      console.error("[aether status] update install failed:", err);
      alert("Update install failed: " + (err?.message || err));
      setPending((p) => {
        const next = { ...p };
        delete next[entity_id];
        return next;
      });
    }
  };

  // Auto-clear "pending" once we see the entity actually report
  // progress, and as a fallback expire it after 5 minutes so a
  // failed/cancelled install doesn't leave the button stuck.
  React.useEffect(() => {
    if (!Object.keys(pending).length) return;
    const installingNow = new Set(issues.updates.filter((u) => u.installing).map((u) => u.entity_id));
    const now = Date.now();
    setPending((p) => {
      const next = { ...p };
      let changed = false;
      for (const [id, startedAt] of Object.entries(p)) {
        if (installingNow.has(id) || now - startedAt > 5 * 60 * 1000) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [issues.updates, pending]);

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
                {unavailableByDevice.length < issues.unavailable.length && (
                  <span className="status-group-sub">
                    across {unavailableByDevice.length} {unavailableByDevice.length === 1 ? "device" : "devices"}
                  </span>
                )}
              </div>
              {unavailableByDevice.map((g) => {
                if (g.entities.length === 1) {
                  // Single-entity device: render inline like before.
                  const i = g.entities[0];
                  return (
                    <div key={i.entity_id} className="status-row">
                      <span className="status-name">{i.name}</span>
                      <code className="status-entity">{i.entity_id}</code>
                    </div>
                  );
                }
                const isOpen = expandedDevice === g.key;
                return (
                  <div key={g.key} className="status-device-group">
                    <button
                      className="status-device-head"
                      onClick={() => setExpandedDevice(isOpen ? null : g.key)}
                    >
                      <span className="status-device-name">{g.name}</span>
                      <span className="status-device-count">
                        {g.entities.length} {g.entities.length === 1 ? "entity" : "entities"}
                      </span>
                      <span className="status-device-chevron">{isOpen ? "▾" : "▸"}</span>
                    </button>
                    {isOpen && (
                      <div className="status-device-entities">
                        {g.entities.map((i) => (
                          <div key={i.entity_id} className="status-row status-row-sub">
                            <span className="status-name">{i.name}</span>
                            <code className="status-entity">{i.entity_id}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {logLoaded && logErrors.length > 0 && (
            <div className="status-group">
              <div className="status-group-head">
                <strong>Recent errors</strong>
                <span className="status-count">
                  {logErrors.reduce((s, g) => s + g.count, 0)}
                </span>
                <span className="status-group-sub">from HA log</span>
              </div>
              {logErrors.slice(0, 6).map((g) => (
                <div key={g.integration} className="status-error-row">
                  <div className="status-error-head">
                    <span className="status-error-integration">{g.integration}</span>
                    <span className="status-error-count">{g.count}×</span>
                  </div>
                  {g.topEntity && (
                    <div className="status-error-entity">
                      Mostly involves <code>{g.topEntity.id}</code>
                      <span className="status-error-entity-count"> · {g.topEntity.count}×</span>
                    </div>
                  )}
                  <div className="status-error-message">{g.lastMessage}</div>
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
              {issues.updates.map((i) => {
                const isPending = !!pending[i.entity_id];
                const installing = i.installing || isPending;
                const pct = i.percentage != null
                  ? Math.max(0, Math.min(100, Math.round(i.percentage)))
                  : null;
                // Tesla sits in a 2-minute cancellable countdown before
                // the install actually starts streaming. During that
                // window the entity hasn't reported a percentage yet,
                // so distinguish "Starting…" from "Installing X%".
                const label = !installing       ? "Install"
                            : pct != null      ? `Installing ${pct}%`
                            : i.installing     ? "Installing…"
                            :                    "Starting…";
                return (
                  <div key={i.entity_id} className="status-row status-row-update">
                    <div className="status-row-update-head">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="status-name">{i.name}</div>
                        <div className="status-version">
                          {i.installed || "?"} → {i.latest || "?"}
                        </div>
                      </div>
                      <button
                        className="status-install-btn"
                        onClick={() => installUpdate(i.entity_id)}
                        disabled={installing}
                      >
                        {label}
                      </button>
                    </div>
                    {installing && (
                      <div className="status-progress">
                        <div
                          className={"status-progress-fill" + (pct == null ? " indeterminate" : "")}
                          style={pct != null ? { width: `${pct}%` } : undefined}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
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
