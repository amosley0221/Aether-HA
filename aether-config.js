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
  user: { name: "Ben" },

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

  climate: ["climate.hallway", "climate.tone_climate"],

  weather: "weather.forecast_home",

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
};

window.AETHER_CONFIG = AETHER_CONFIG;
