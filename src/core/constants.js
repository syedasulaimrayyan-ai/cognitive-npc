export const SKY_COLOR = 0xa8c8e0;
export const GROUND_SIZE = 200;
export const WORLD_BOUNDS = 90;
export const INTERACT_RANGE = 3.4;
export const CRATE_RANGE = 2.8;
export const GRAVITY = 20;
/** Player starts at the south town entrance, facing north up the main street. */
export const PLAYER_SPAWN = { x: 0, z: 50 };
export const PLAYER_HEIGHT = 1.7;
export const TOWN_NAME = 'Millbrook';

/** Mission "THE MISSING SUPPLY" — stage machine states (monotonic). */
export const STAGE = {
  INTRO: 0,    // objective: ask the shopkeeper about the crate
  ASKED: 1,    // objective: question the witness in the square
  CLUE: 2,     // objective: find the crate behind the old storehouse
  CRATE: 3,    // objective: return the crate to the shopkeeper
  DONE: 4,     // mission complete
};

/** Fixed mission geography (all coords are world-space, ground plane). */
export const STOREHOUSE = { x: 18, z: 24, w: 9, d: 7, h: 4.2 };
export const CRATE_POS = { x: 23.9, z: 24.6 };
export const ENTRANCE_Z = 46; // welcome arch across the main street

/** Every shipped character asset + its VERIFIED clip names (read from each
 *  GLB's JSON chunk during development). If a required clip is missing the
 *  loader throws — no silent substitution. */
export const CHARACTERS = {
  player: {
    url: './assets/characters/Soldier.glb',
    scale: 1.0,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Run', pose: 'TPose' },
    credits: 'three.js example assets (MIT) — Soldier',
  },
  npcMale: {
    url: './assets/characters/Xbot.glb',
    scale: 1.0,
    clips: {
      idle: 'idle', walk: 'walk', run: 'run',
      gestures: ['agree', 'headShake'],
    },
    credits: 'three.js example assets (MIT) — Xbot',
  },
  npcFemale: {
    url: './assets/characters/Michelle.glb',
    scale: 1.0,
    clips: { idle: 'SambaDance', pose: 'TPose' },
    credits: 'three.js example assets (MIT) — Michelle',
  },
};

/** Distinct NPC identities used by the cognitive layer + dialogue engine. */
export const NPCS = [
  {
    id: 'maya',
    name: 'Maya Chen',
    role: 'Shopkeeper · runs the market stall',
    color: '#4f8a4f',
    model: 'npcMale', // Xbot
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: -10.1, z: 2 },   // behind her market stall, facing the street
    personality: 'Warm, chatty plant-lover; remembers favours; easily excited about greenery.',
    styleRule: 'Speaks in flowing sentences, often mentions her plants or the weather.',
    voicePitch: 1.15,
  },
  {
    id: 'victor',
    name: 'Victor Osei',
    role: 'Town handyman',
    color: '#8a6b3f',
    model: 'npcMale', // Xbot
    idleClip: 'idle',
    gestureClip: 'headShake',
    spawn: { x: 9, z: -18 },      // by his work wall, north end of the street
    // Victor keeps Xbot.glb with Maya (asset budget) but is visually
    // differentiated with a darker clothing tint applied to cloned materials.
    tint: 0x9a8f7a,
    personality: 'Gruff, practical, suspicious until trust is earned; keeps to himself.',
    styleRule: 'Short clipped sentences, no fillers, occasionally grumbles about tools.',
    voicePitch: 0.8,
  },
  {
    id: 'rosa',
    name: 'Rosa Delgado',
    role: 'Street dancer · watches the square',
    color: '#a34f6b',
    model: 'npcFemale', // Michelle
    idleClip: 'SambaDance',
    gestureClip: null,
    spawn: { x: 4, z: 8 },        // fountain square — the square's watcher
    personality: 'Bubbly street dancer, always in motion, loves an audience.',
    styleRule: 'Exclamation-heavy, rhythmical, uses musical metaphors.',
    voicePitch: 1.3,
  },
];

// ---- Controls ---------------------------------------------------------------
export const CONTROLS = {
  walkSpeed: 4.2,
  runSpeed: 8.0,
  jumpSpeed: 8.0, // WORLD units/sec initial upward velocity
};
