export const SKY_COLOR = 0xa8c8e0;
export const GROUND_SIZE = 200;
export const WORLD_BOUNDS = 90;
export const INTERACT_RANGE = 3.4;
export const GRAVITY = 20;
export const PLAYER_SPAWN = { x: 4, z: 16 };
export const PLAYER_HEIGHT = 1.7;

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
    role: 'Botanist · runs the plant stall',
    color: '#4f8a4f',
    model: 'npcMale', // Xbot
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: -5, z: 2 },
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
    spawn: { x: 12, z: 7 },
    personality: 'Gruff, practical, suspicious until trust is earned; keeps to himself.',
    styleRule: 'Short clipped sentences, no fillers, occasionally grumbles about tools.',
    voicePitch: 0.8,
  },
  {
    id: 'rosa',
    name: 'Rosa Delgado',
    role: 'Dancing at the plaza',
    color: '#a34f6b',
    model: 'npcFemale', // Michelle
    idleClip: 'SambaDance',
    gestureClip: null,
    spawn: { x: 0, z: 10 },
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
