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
    id: 'arjun',
    name: 'Arjun',
    role: 'Shopkeeper · general store',
    color: '#4f8a4f',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: -12, z: 4 },
    tint: 0x7a9a6f,
    personality: 'Cautious shopkeeper who values promises. Initially wary if past promises were broken.',
    styleRule: 'Measured speech, asks direct questions about past commitments.',
    voicePitch: 1.1,
    memorySeed: {
      trust: -10,
      events: [
        { t: Date.now() - 1000*60*60*24, type: 'promise', summary: 'Player previously promised to help find missing supply crate', salience: 4, keywords: ['promise', 'crate', 'supply'] },
        { t: Date.now() - 1000*60*60*20, type: 'disappointment', summary: 'Player never returned after the promise', salience: 4, keywords: ['returned', 'broke', 'promise'] }
      ]
    }
  },
  {
    id: 'maya',
    name: 'Maya Chen',
    role: 'Market vendor · runs the plant stall',
    color: '#4f8a4f',
    model: 'npcMale', // Xbot
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: -10.1, z: 2 },   // behind her market stall, facing the street
    personality: 'Warm, chatty plant-lover; remembers favours; easily excited about greenery.',
    styleRule: 'Speaks in flowing sentences, often mentions her plants or the weather.',
    voicePitch: 1.15,
    memorySeed: {
      trust: 25,
      events: [
        { t: Date.now() - 1000*60*60*48, type: 'favor', summary: 'Player once helped collect scattered goods', salience: 3, keywords: ['helped', 'goods', 'favor'] }
      ]
    }
  },
  {
    id: 'ravi',
    name: 'Ravi',
    role: 'Guard · patrols restricted area',
    color: '#6b8a8a',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'headShake',
    spawn: { x: 15, z: 20 },
    tint: 0x889a9a,
    personality: 'Dutiful guard, protective of restricted area. Suspicious by nature but fair.',
    styleRule: 'Formal, direct, references duty and safety.',
    voicePitch: 0.9,
    memorySeed: {
      trust: -15,
      events: [
        { t: Date.now() - 1000*60*60*36, type: 'suspicion', summary: 'Player behaved suspiciously near restricted building', salience: 4, keywords: ['suspicious', 'restricted', 'building'] }
      ]
    }
  },
  {
    id: 'kabir',
    name: 'Kabir',
    role: 'Traveller · passing through',
    color: '#7a6b8a',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: 5, z: -25 },
    tint: 0x9a8a9a,
    personality: 'Curious traveller, gathers rumors, cautious until trust builds.',
    styleRule: 'Casual, inquisitive, shares stories.',
    voicePitch: 1.05,
    memorySeed: {
      trust: 0,
      events: [
        { t: Date.now() - 1000*60*60*30, type: 'rumor', summary: 'Heard rumor about missing supply crate', salience: 3, keywords: ['rumor', 'crate', 'missing'] }
      ]
    }
  },
  {
    id: 'leela',
    name: 'Leela',
    role: 'Elder · town elder',
    color: '#b89a6b',
    model: 'npcFemale',
    idleClip: 'SambaDance',
    gestureClip: null,
    spawn: { x: -5, z: -10 },
    personality: 'Wise elder, values courtesy and respect. Remembers polite behavior.',
    styleRule: 'Gentle, patient, offers advice.',
    voicePitch: 1.1,
    memorySeed: {
      trust: 10,
      events: [
        { t: Date.now() - 1000*60*60*60, type: 'politeness', summary: 'Player was polite during earlier fictional encounter', salience: 2, keywords: ['polite', 'respectful'] }
      ]
    }
  },
  {
    id: 'dev',
    name: 'Dev',
    role: 'Merchant · trader',
    color: '#8a6b4f',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'headShake',
    spawn: { x: -15, z: -5 },
    tint: 0x9a8f7a,
    personality: 'Business-minded merchant, holds grudges over broken agreements but can be reasoned with.',
    styleRule: 'Pragmatic, references business/trades.',
    voicePitch: 0.95,
    memorySeed: {
      trust: -20,
      events: [
        { t: Date.now() - 1000*60*60*40, type: 'broken_agreement', summary: 'Believes player broke previous trade agreement', salience: 4, keywords: ['trade', 'agreement', 'broke'] }
      ]
    }
  },
  {
    id: 'sana',
    name: 'Sana',
    role: 'Messenger · runs errands',
    color: '#7b8a6b',
    model: 'npcFemale',
    idleClip: 'SambaDance',
    gestureClip: null,
    spawn: { x: 10, z: 5 },
    personality: 'Energetic messenger, appreciates help with deliveries.',
    styleRule: 'Friendly, chatty, shares news.',
    voicePitch: 1.25,
    memorySeed: {
      trust: 15,
      events: [
        { t: Date.now() - 1000*60*60*44, type: 'help', summary: 'Player helped deliver a message', salience: 3, keywords: ['helped', 'delivered', 'message'] }
      ]
    }
  },
  {
    id: 'imran',
    name: 'Imran',
    role: 'Street musician · performer',
    color: '#8a7b6b',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: 2, z: 12 },
    tint: 0xa09a8f,
    personality: 'Friendly musician, enjoys company and conversation.',
    styleRule: 'Playful, uses musical metaphors.',
    voicePitch: 1.2,
    memorySeed: {
      trust: 20,
      events: [
        { t: Date.now() - 1000*60*60*32, type: 'friendship', summary: 'Previous friendly conversations with player', salience: 2, keywords: ['friendly', 'music', 'conversation'] }
      ]
    }
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
  {
    id: 'tariq',
    name: 'Tariq Al-Hassan',
    role: 'Blacksmith · forges tools',
    color: '#7a7a8a',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'headShake',
    spawn: { x: 20, z: -10 },
    tint: 0x8f8f9a,
    personality: 'Hardworking craftsman, proud of his work, patient teacher.',
    styleRule: 'Direct, practical, uses smithing metaphors.',
    voicePitch: 0.9,
    memorySeed: { trust: 5, events: [] }
  },
  {
    id: 'amira',
    name: 'Amira Noor',
    role: 'Food vendor · market stall',
    color: '#8a7a4f',
    model: 'npcFemale',
    idleClip: 'SambaDance',
    gestureClip: null,
    spawn: { x: -15, z: 8 },
    personality: 'Warm-hearted cook, loves sharing food and stories.',
    styleRule: 'Friendly, motherly, mentions recipes.',
    voicePitch: 1.15,
    memorySeed: { trust: 15, events: [] }
  },
  {
    id: 'thoren',
    name: 'Thoren Stonebeard',
    role: 'Elder guard · patrols',
    color: '#6b7a8a',
    model: 'npcMale',
    idleClip: 'idle',
    gestureClip: 'agree',
    spawn: { x: 16, z: 16 },
    tint: 0x7f8f9f,
    personality: 'Experienced, fair, protective of village.',
    styleRule: 'Measured, wise, references duty.',
    voicePitch: 0.85,
    memorySeed: { trust: 10, events: [] }
  },
];

// ---- Zones ---------------------------------------------------------------
export const ZONES = {
  MARKET_STREET: { minX: -20, maxX: -8, minZ: -5, maxZ: 10, name: 'Market Street' },
  CENTRAL_GATHERING: { minX: -5, maxX: 8, minZ: -5, maxZ: 15, name: 'Central Gathering' },
  RESIDENTIAL_LANES: { minX: -15, maxX: 15, minZ: -30, maxZ: -5, name: 'Residential Lanes' },
  TRADING_DISTRICT: { minX: -18, maxX: -5, minZ: -15, maxZ: 8, name: 'Trading District' },
  GUARD_AREA: { minX: 10, maxX: 25, minZ: 10, maxZ: 30, name: 'Guard Controlled Area' },
  RESTING_SOCIAL: { minX: -8, maxX: 6, minZ: 10, maxZ: 18, name: 'Resting/Social Area' },
};

// ---- Waypoints for organized movement -----------------------------------
export const WAYPOINTS = [
  { x: 0, z: 0 },      // center
  { x: -12, z: 2 },    // market
  { x: -10, z: 6 },
  { x: -12, z: -2 },
  { x: 5, z: 12 },     // gathering
  { x: 3, z: 8 },
  { x: -2, z: 10 },
  { x: 0, z: -12 },    // residential
  { x: -8, z: -18 },
  { x: 8, z: -15 },
  { x: 12, z: 22 },    // guard area
  { x: 18, z: 18 },
  { x: 14, z: 14 },
  { x: -6, z: 14 },    // resting
  { x: 4, z: 16 },
];

// ---- Houses --------------------------------------------------------------
export const HOUSE_DEFS = [
  { id: 'house1', position: { x: -25, z: -12 }, residentId: 'leela', doorPos: { x: -25, z: -9.5 } },
  { id: 'house2', position: { x: 25, z: -12 }, residentId: 'kabir', doorPos: { x: 25, z: -9.5 } },
  { id: 'house3', position: { x: -25, z: 15 }, residentId: 'sana', doorPos: { x: -25, z: 17.5 } },
];

// ---- Behavior states -----------------------------------------------------
export const BEHAVIOR_STATE = {
  IDLE: 'idle',
  WALKING: 'walking',
  TURNING: 'turning',
  TALKING: 'talking',
  GESTURING: 'gesturing',
  LEAVING: 'leaving',
  APPROACHING: 'approaching',
  AVOIDING: 'avoiding',
  CONFRONTING: 'confronting',
  RESTING: 'resting',
  WORKING: 'working',
};

export const DECISION = {
  APPROACH: 'APPROACH',
  GREET: 'GREET',
  WAIT: 'WAIT',
  IGNORE: 'IGNORE',
  AVOID: 'AVOID',
  CONFRONT: 'CONFRONT',
  SHOUT: 'SHOUT',
  COOPERATE: 'COOPERATE',
  REFUSE: 'REFUSE',
  RECONSIDER: 'RECONSIDER',
};

// ---- Controls ---------------------------------------------------------------
export const CONTROLS = {
  walkSpeed: 4.2,
  runSpeed: 8.0,
  jumpSpeed: 8.0, // WORLD units/sec initial upward velocity
};
