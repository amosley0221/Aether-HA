/* Aether — entity mapping for THIS Home Assistant install.
   Edit freely. Rooms drive the Music page + speaker tiles on Dashboard.
   Lights / cameras / climate are pulled directly from the lists below.

   Tip: HA appends _2 / _3 / _4 when an entity_id collides. For Sonos +
   Music Assistant you typically end up with two players per speaker — one
   exposed by the Sonos integration and one by Music Assistant. Set
   mediaPlayer to whichever you want to control (MA gives queue control,
   provider switching, Apple Music search). If MA's entity is the "_2",
   use that. */

const AETHER_CONFIG = {
  // Leave name empty to use the logged-in HA user's first name. Set a string
  // to override (e.g. { name: "Antonio" }).
  user: { name: "" },

  // Label shown in the music page library top-right corner.
  serviceLabel: "Apple Music",

  // (Listen Now pins live in HA's per-user storage now — see the bookmark
  // button on each album tile in the music page.)

  // Voice features for the AI chat. Web Speech API is used for STT/TTS,
  // so this works on most modern browsers + Android WebView. Fully Kiosk
  // PLUS needs microphone permission granted via Settings → Web Browsing.
  voice: {
    enabled:         true,             // master toggle for any voice
    speakResponses:  true,             // read AI replies aloud
    language:        "en-US",          // STT + TTS locale
    rate:            1.0,              // TTS playback speed (0.5–2.0)
    pitch:           1.0,              // TTS pitch (0–2)
    // Wake word: when set, the tablet listens continuously and opens the
    // chat + starts voice input the moment it hears this phrase. Leave
    // null to require a button tap. Phrases work better than single
    // words — Web Speech tends to mis-fire on short triggers.
    wakeWord:        null,             // e.g. "hey aether" or "hey jarvis"
    // Preferred TTS voice name fragment (e.g. "Google", "Samantha",
    // "Daniel"). If null, the system default is used.
    preferredVoice:  null,

    // HA-side TTS fallback. Android WebView's Web Speech Synthesis is
    // unreliable; if it fails (no voices, autoplay-blocked, no engine),
    // Aether will fall back to calling HA's tts.speak service which
    // routes the audio through your chosen media_player (e.g. the
    // Pixel Tablet's own Cast endpoint or a Sonos speaker). Requires
    // any TTS integration installed in HA (Google Translate is the
    // default builtin one; Piper, OpenAI, ElevenLabs etc. also work).
    ttsMediaPlayer:  "media_player.pixel_tablet",  // play TTS here
    ttsService:      "tts.google_translate_en_com", // entity_id of the TTS service
    // Skip browser Web Speech and always route through HA. Useful on
    // tablets in kiosk mode where you want responses on the device's
    // speakers (via the Cast media_player) rather than the browser's
    // (often robotic) built-in voices. Trade-off: ~500ms latency for
    // HA to generate audio and stream it back.
    forceHATTS:      false,
  },

  // mediaPlayer  = control entity (Music Assistant wrapper, supports
  //                search_media and routes Apple Music/Spotify/etc).
  // displayPlayer = read-only state mirror (Sonos integration entity).
  //                Used for the rail's playing/track/art when something
  //                is playing outside Aether (via Sonos app, etc).
  rooms: [
    {
      id: "living",
      name: "Living Room",
      color: ["#c47a64", "#7a3b2c"],
      mediaPlayer:   "media_player.living_room_2",
      displayPlayer: "media_player.living_room",
      lights: [
        "light.living_room_ceiling_light_1",
        "light.living_room_ceiling_light_2",
        "light.living_room_floor_lamp",
        "light.living_room_cabinet",
        "light.living_room_cabinet_2",
        "light.floor_lamp",
      ],
      motion: "binary_sensor.living_room_motion",
      camera: "camera.living_room_live_view",
    },
    {
      id: "office",
      name: "Office",
      color: ["#9aa0d8", "#4a4f9a"],
      mediaPlayer:   "media_player.office_2",
      displayPlayer: "media_player.office",
      lights: ["light.office", "light.office_2", "light.office_tv_stand"],
      motion: "binary_sensor.office_motion",
      camera: "camera.office_live_view",
    },
    {
      id: "bedroom",
      name: "Bedroom",
      color: ["#c47a64", "#7a3b2c"],
      mediaPlayer:   "media_player.bedroom_2",
      displayPlayer: "media_player.bedroom",
      lights: [
        "light.bedroom_ceiling_1",
        "light.bedroom_ceiling_2",
        "light.bedroom_ceiling_3",
        "light.bedroom_ceiling_fan",
        "light.bedroom_floor_lamp",
        "light.bedroom_tv_lightstrip",
        "light.bedroom_tv_stand",
      ],
    },
    {
      id: "dining",
      name: "Dining Room",
      color: ["#4a8dd8", "#1e3f7a"],
      mediaPlayer:   "media_player.dining_room_2",
      displayPlayer: "media_player.dining_room",
      lights: [],
    },
    {
      id: "bath",
      name: "Bathroom",
      color: ["#a44a3a", "#5c2418"],
      mediaPlayer:   "media_player.bathroom_2",
      displayPlayer: "media_player.bathroom",
      lights: [],
    },
    {
      id: "garage",
      name: "Garage",
      color: ["#b6b4ac", "#7a786f"],
      mediaPlayer:   "media_player.garage_2",
      displayPlayer: "media_player.garage",
      lights: ["light.garage", "light.garage_2"],
      camera: "camera.garage_live_view",
    },
    {
      id: "move2",
      name: "Move 2",
      color: ["#7aa890", "#3a5c4a"],
      mediaPlayer:   "media_player.move_2_2",
      displayPlayer: "media_player.move_2",
    },
    {
      id: "turntable",
      name: "Turntable",
      color: ["#d8b06a", "#7a5a2a"],
      mediaPlayer:   "media_player.turntable_2",
      displayPlayer: "media_player.turntable",
    },
    {
      id: "kitchen",
      name: "Kitchen",
      color: ["#a89a3a", "#3a3414"],
      mediaPlayer: "media_player.kitchen_display",
      camera: "camera.kitchen",
    },
    {
      id: "pixel",
      name: "Pixel Tablet",
      color: ["#5a7a96", "#2a4a60"],
      // Google Cast player on the Pixel Tablet (Hub Mode). No MA wrapper
      // yet; if you add the tablet to Music Assistant's player list later,
      // a media_player.pixel_tablet_2 will appear and auto-resolve takes
      // over to route Apple Music search/play through MA.
      mediaPlayer: "media_player.pixel_tablet",
    },
  ],

  cameras: [
    "camera.front_live_view",
    "camera.charlotte_front_door_live_view",
    "camera.back_door_live_view",
    "camera.garage_live_view",
    "camera.kitchen",
    "camera.living_room_live_view",
    "camera.office_live_view",
  ],

  climate: ["climate.hallway"],

  weather: "weather.forecast_home",

  // Car / Tesla integration. Three visualization options, in priority:
  //   model3d  → <model-viewer> renders a real interactive 3D GLB/GLTF
  //              (rotatable, accurate). Drop a Tesla Model 3 .glb into
  //              /config/www/aether/ and set the path here. Good free
  //              sources: Sketchfab (search 'Tesla Model 3' filtered to
  //              Downloadable + Free), CGTrader, Free3D. Export as
  //              .glb / .gltf 2.0.
  //   image    → a static image (PNG/JPG/SVG/WebP). Same /local/aether/
  //              path convention. Quick + no library overhead.
  //   neither  → built-in side-profile SVG illustration.
  car: {
    name: "Tone",
    year: "2020",
    model: "Model 3",
    color: "White",
    wheels: '19" Silver Sport',
    model3d: null,                        // e.g. "/local/aether/tesla.glb"
    image:   null,                        // e.g. "/local/aether/tesla.png"
    entities: {
      lock:                  "lock.tone_lock",
      chargeCableLock:       "lock.tone_charge_cable_lock",
      climate:               "climate.tone_climate",
      chargePort:            "cover.tone_charge_port_door",
      frunk:                 "cover.tone_frunk",
      trunk:                 "cover.tone_trunk",
      ventWindows:           "cover.tone_vent_windows",
      charge:                "switch.tone_charge",
      defrost:               "switch.tone_defrost_mode",
      sentry:                "switch.tone_sentry_mode",
      steeringWheelHeater:   "switch.tone_steering_wheel_heater",
      valet:                 "switch.tone_valet_mode",
      battery:               "sensor.tone_battery_level",
      range:                 "sensor.tone_battery_range",
      inside:                "sensor.tone_inside_temperature",
      outside:               "sensor.tone_outside_temperature",
      chargingState:         "sensor.tone_charging",
      shiftState:            "sensor.tone_shift_state",
      speed:                 "sensor.tone_speed",
      odometer:              "sensor.tone_odometer",
      timeToFullCharge:      "sensor.tone_time_to_full_charge",
      destination:           "sensor.tone_destination",
      distanceToArrival:     "sensor.tone_distance_to_arrival",
      chargeCableConnected:  "binary_sensor.tone_charge_cable",
      preconditioning:       "binary_sensor.tone_preconditioning_enabled",
      userPresent:           "binary_sensor.tone_user_present",
      doors: {
        frontDriver:    "binary_sensor.tone_front_driver_door",
        frontPassenger: "binary_sensor.tone_front_passenger_door",
        rearDriver:     "binary_sensor.tone_rear_driver_door",
        rearPassenger:  "binary_sensor.tone_rear_passenger_door",
      },
      tires: {
        frontLeft:  "sensor.tone_tire_pressure_front_left",
        frontRight: "sensor.tone_tire_pressure_front_right",
        rearLeft:   "sensor.tone_tire_pressure_rear_left",
        rearRight:  "sensor.tone_tire_pressure_rear_right",
      },
      // Tessie exposes a software-update entity (usually
      // `update.<carname>_update`). The Tesla card shows an Install
      // button + progress bar when this entity reports state=on or
      // in_progress > 0. If you don't have Tessie, leave it blank.
      update: "update.tone_update",
    },
  },

  // Apple TV remote on the dashboard. Set `remote` to your HA Apple TV
  // remote entity (created automatically by the Apple TV integration when
  // you pair it). `mediaPlayer` is the matching media_player entity used
  // for now-playing info, power, and the app launcher. `volumePlayer` is
  // the speaker whose volume the slider should drive — typically the
  // Sonos soundbar the Apple TV is plugged into (Playbase / Arc / Beam),
  // since the Apple TV's own volume calls go through HDMI-CEC.
  //
  // `apps`: each entry needs EITHER:
  //   bundleId — iOS bundle identifier (preferred; works with the
  //              modern pyatv-based Apple TV integration which doesn't
  //              populate source_list). Find an app's bundle ID by
  //              opening it on the Apple TV, then check
  //              media_player.<your_atv> → attributes.app_id in HA
  //              Developer Tools → States.
  //   source   — the exact string from attributes.source_list (older
  //              integrations only). Used as a fallback.
  // Leave the whole `appleTV` block out (or set remote/mediaPlayer to
  // null) to hide the section.
  appleTV: {
    remote:       "remote.living_room",                 // Apple TV remote entity
    mediaPlayer:  "media_player.living_room_4",         // Apple TV media_player
    volumePlayer: "media_player.living_room",           // Sonos Playbase
    apps: [
      { name: "Netflix",    bundleId: "com.netflix.Netflix" },
      { name: "YouTube TV", bundleId: "com.google.ios.youtubeunplugged" },
      { name: "YouTube",    bundleId: "com.google.ios.youtube" },
      { name: "Twitch",     bundleId: "tv.twitch" },
      { name: "Plex",       bundleId: "com.plexapp.plex" },
    ],
  },

  // LG webOS TVs (one entry per TV/monitor). The HA webOSTV
  // integration creates a media_player entity per device; newer
  // versions also create a `remote.*` entity. Leave `remote: null`
  // and the section falls back to the `webostv.button` service via
  // the media_player.
  //
  // Pick the media_player entity that exposes the FULL `source_list`
  // (apps + inputs) - on installs with Music Assistant, the bare
  // `media_player.<tv>` entity is MA's wrapper and won't have the
  // app list. Use the `_2` (or `_3`) sibling for the actual device.
  //
  // Apps use `select_source` against the names that appear in the
  // TV's `source_list` attribute - same strings the LG remote shows
  // when you press the Input button.
  //
  // Volume goes through webostv.button VOLUMEUP/VOLUMEDOWN so the
  // soundbar (via HDMI ARC/CEC) responds, same as the physical remote.
  //
  // `inputs`: hardcoded list of input tiles (no auto-detection).
  //
  // `wakeOnLanMac`: optional. When set, Aether sends a WoL magic
  // packet on power-on. Requires `wake_on_lan:` in
  // configuration.yaml and the TV's "Mobile TV On" setting enabled.
  lgTVs: [
    {
      name:         "LG TV · Office",                          // section heading
      remote:       null,
      mediaPlayer:  "media_player.lg_webos_tv_nano85una_2",
      wakeOnLanMac: "58:FD:B1:11:A3:D9",
      apps: [
        { name: "Netflix",    source: "Netflix" },
        { name: "YouTube TV", source: "YouTube TV" },
        { name: "YouTube",    source: "YouTube" },
        { name: "Twitch",     source: "Twitch" },
        { name: "Plex",       source: "Plex" },
      ],
      inputs: [
        { name: "PC",     source: "PC" },       // device-labeled HDMI 1 (auto-relabel when device on)
        { name: "HDMI 2", source: "HDMI 2" },
        { name: "HDMI 3", source: "HDMI 3" },
        { name: "PS5",    source: "PS5" },      // device-labeled HDMI 4
      ],
    },
    {
      name:         "LG Swing Monitor · Office",
      remote:       null,
      mediaPlayer:  "media_player.lg_webos_u889sa_2",
      wakeOnLanMac: "1C:F4:3F:12:D1:62",
      apps: [
        { name: "Netflix",    source: "Netflix" },
        { name: "YouTube TV", source: "YouTube TV" },
        { name: "YouTube",    source: "YouTube" },
        { name: "Twitch",     source: "Twitch" },
        { name: "Plex",       source: "Plex" },
      ],
      // Inputs use webOS app IDs (appId) instead of source strings so
      // they work even when the connected device is off or labeled
      // differently in source_list. If a switch doesn't take, the app
      // ID is wrong - check `app_id` in Developer Tools while that
      // input is active on the monitor, and update accordingly.
      inputs: [
        { name: "USB-C",  appId: "com.webos.app.usbc" },
        { name: "HDMI 1", appId: "com.webos.app.hdmi1" },
        { name: "HDMI 2", appId: "com.webos.app.hdmi2" },
      ],
    },
  ],

  // Entities to skip in the brandbar's status pill (low batteries,
  // unavailable entities, pending updates). Each entry is either an
  // exact entity_id or a regex string. Useful for things like Ring's
  // second-battery-slot sensor (only one battery is ever installed
  // but both slots report independently), seasonal switches that are
  // intentionally unplugged, or noisy diagnostic sensors.
  statusPillIgnore: [
    "sensor.front_battery_2",           // unused Ring camera slot
    // "switch.holiday_lights",         // example: seasonal device
    // "^sensor\\.guest_.*",            // example: guest-room entities
  ],

  // Lights that aren't pinned to a room above. Shown under "All lights" on
  // the dashboard so nothing is hidden.
  globalLights: [
    "light.front_light",
    "light.back_door_light",
    "light.hallway",
    "light.hallway_2",
    "light.wall_lamp",
    "light.cristy_room",
    "light.hue_color_lamp_1",
    "light.hue_color_lamp_2",
    "light.hue_ambiance_lamp_1",
    "light.hue_color_candle_1",
    "light.hue_white_lamp_1",
    "light.hue_white_lamp_2",
    "light.hue_lightstrip_2",
    "light.hue_lightstrip_3",
    "light.shapes_717f",
    "light.ceiling_light_1",
    "light.ceiling_light_2",
  ],

  // Scenes pinned to the home page. HA has plenty of Hue-generated ones;
  // these are the curated set.
  scenes: [
    { id: "morning",  service: "scene.turn_on", target: "scene.hallway_bright",          name: "Morning",     meta: "Hallway · Bright",      grad: "linear-gradient(135deg, #f3c685, #b06a2c)", icon: "sun" },
    { id: "focus",    service: "scene.turn_on", target: "scene.office_concentrate",      name: "Focus",       meta: "Office · Concentrate",  grad: "linear-gradient(135deg, #9aa0d8, #4a4f9a)", icon: "sparkle" },
    { id: "movie",    service: "scene.turn_on", target: "scene.bedroom_tv_stand_dimmed", name: "Movie Night", meta: "TV Stand · Dimmed",     grad: "linear-gradient(135deg, #b85a48, #5a1e18)", icon: "moon" },
    { id: "relax",    service: "scene.turn_on", target: "scene.wall_lamp_relax",         name: "Relax",       meta: "Wall Lamp · Relax",     grad: "linear-gradient(135deg, #c47a4a, #5a2e18)", icon: "leaf" },
    { id: "sleep",    service: "scene.turn_on", target: "scene.bedroom_floor_lamp_nightlight", name: "Sleep", meta: "Bedroom · Nightlight",  grad: "linear-gradient(135deg, #4a4f9a, #1e2156)", icon: "moon" },
  ],

  // Music Assistant grouping service. When you drag a room onto another,
  // we call this with target = host player, source = dragged player.
  groupService: "media_player.join",   // → mass grouping uses HA's media_player.join
  ungroupService: "media_player.unjoin",

  // ─── Sports tile (home page) ──────────────────────────────────────
  // Pulls today's scoreboards from ESPN's public API. `leagues` is the
  // order shown in the "All scores" modal; `favorites` filters what
  // appears on the home tile itself. Favorite values are ESPN team
  // abbreviations — peek at espn.com to find the exact strings
  // (Phillies = PHI, Eagles = PHI, Chelsea = CHE, etc.). Set a league
  // to `true` to bubble up *every* event in that league (handy for UFC,
  // boxing-style one-off events where there's no team to follow).
  sports: {
    enabled: true,
    leagues: ["mlb", "nfl", "nba", "epl", "ucl", "mls", "ufc", "cfb", "cbb", "nhl"],
    favorites: {
      mlb:  ["PHI"],                                  // Phillies
      nfl:  ["PHI"],                                  // Eagles
      nba:  ["PHI"],                                  // 76ers
      nhl:  [],
      mls:  ["CLT"],                                  // Charlotte FC
      epl:  ["CHE"],                                  // Chelsea
      ucl:  ["CHE"],
      cfb:  ["MIA", "ECU", "FLA", "FSU", "USF", "UCF", "FAU", "FIU"],
      cbb:  ["DUKE"],
      ufc:  true,                                     // any UFC event today
    },
  },

  // ─── News tile (home page) ────────────────────────────────────────
  // Fetched through api.rss2json.com (free, no API key) so the browser
  // can parse RSS without CORS pain. `count` is the total headlines
  // shown on the tile, blended across all feeds and sorted by recency.
  news: {
    enabled: true,
    feeds: [
      { name: "BBC",     url: "http://feeds.bbci.co.uk/news/rss.xml" },
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews" },
      { name: "Verge",   url: "https://www.theverge.com/rss/index.xml" },
      { name: "ESPN",    url: "https://www.espn.com/espn/rss/news" },
    ],
    count: 6,
  },
};

window.AETHER_CONFIG = AETHER_CONFIG;
