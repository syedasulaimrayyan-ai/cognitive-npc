# COGNITIVE NPC — THE MISSING SUPPLY

A browser-playable **third-person 3D town** built with **React + Three.js (Vite)**.
You play a traveller arriving in the town of **Millbrook**, where a shopkeeper's
supply crate has vanished. Ask questions, read people, and piece together what
happened — every conversation is shaped by **persistent per-NPC memory, trust
and strict knowledge boundaries**.

```
MISSION: FIND THE MISSING SUPPLY
1. Talk to Maya Chen (market stall) about the missing crate.
2. Question Rosa Delgado, who was dancing by the fountain all morning.
3. Find the crate behind the old storehouse (east side of the street).
4. Bring it back to Maya — the ending depends on how you treated everyone.
```

## Run it

```bash
cd cognitive-npc
npm install
npm run dev
```

Open the printed URL (e.g. `http://localhost:5175`).

- Click to capture the mouse (pointer lock; if the browser refuses it —
  sandboxed frames, policies — the game falls back to **drag-to-look**).
- **WASD** move · **Shift** run · **Space** jump · **mouse** look
- **E** interact / talk / pick up / deliver · **Esc** pause
- Type to NPCs in the dialogue panel (or use the mic button for browser STT).

`npm run build && npm run preview` produces an optimized production bundle.

## Project structure (live code)

```
cognitive-npc/
├── index.html                  # entry page
├── scripts/mock-llm.mjs        # LOCAL test double for the AI endpoint (dev only)
├── public/assets/
│   ├── characters/*.glb        # rigged characters with real animation clips
│   ├── models/<name>/<name>.glb# CC0 prop models (decimated, self-contained GLB)
│   ├── hdris/*.hdr             # sky HDRI (image-based lighting + background)
│   └── textures/*.jpg          # PBR maps (Poly Haven CC0)
└── src/
    ├── main.tsx                # React entry → ui/App.tsx
    ├── core/
    │   ├── game-client.ts      # orchestrator: scene, loop, mission wiring, HUD sync
    │   ├── environment.ts      # town: terrain, roads, buildings, plaza, lights, sky
    │   ├── asset-loader.ts     # GLB + texture + HDRI loading (throws loudly on missing assets)
    │   ├── camera-rig.ts       # third-person camera with wall occlusion
    │   ├── collision.ts        # uniform-grid AABB world collision
    │   ├── input.ts            # keyboard/mouse, pointer-lock + drag fallback
    │   └── constants.ts        # world layout, NPC identities, mission geography, STAGE
    ├── entities/
    │   ├── player-avatar.ts    # rigged player: mixer blending Idle/Walk/Run, gravity, jump
    │   └── npc-avatar.ts       # rigged NPCs: idle loop, look-at, gesture clips, tinting
    ├── game/
    │   ├── mission.ts          # "THE MISSING SUPPLY" state machine (persisted)
    │   └── mission-props.ts    # crate, old storehouse, market stalls, arch, beacon
    ├── ai/
    │   ├── dialogue-engine.ts  # conversation driver: prompt assembly, provider calls
    │   ├── cognitive/
    │   │   ├── memory.ts       # persistent structured memory + retrieval + trust
    │   │   ├── persona.ts      # persona index
    │   │   └── knowledge.ts    # intents, knowledge boundaries, offline conversation
    │   └── voice/voice-io.ts   # Web Speech STT + speechSynthesis TTS
    └── ui/                     # React: App, HUD (tracker/completion), DialoguePanel…
```

> Older pre-React files (`src/main.js`, `src/world/`, `src/player/`, `src/npc/`,
> `src/ui/dialogue.js`) are **not** in the build graph — kept on disk only as
> project history; the entry page loads `src/main.jsx`.

## The cognitive layer (the point of the project)

Each NPC has:

- **Persona** — name, role, personality, speaking style, voice pitch.
- **Persistent memory** — `MemoryStore` writes events (with salience + keywords),
  trust (−100…+100), relationships and the conversation log to `localStorage`
  (`cnpc2.memory.<npcId>`). Survives reloads. Retrieval (recency × salience ×
  keyword match) feeds the LLM system prompt on every turn.
- **Trust** — kindness raises it, insults and accusations cost it. The same
  sentence lands differently at trust −24 than at +12.
- **Knowledge boundaries** — `knowledge.js` states, per NPC and per mission
  stage, what they KNOW and what they explicitly DO NOT KNOW. The witness saw
  *where* the crate went, not *why*; nobody knows what's inside a crate they
  never opened; Maya wasn't in the square, so she never claims to have seen
  anything. These facts are injected into the model prompt **and** drive the
  offline replies — a real model can't just "know everything".
- **Decision memory** — the mission records your choices (accusing Victor,
  telling Rosa why you're worried, finding the crate unaided…) and both NPC
  dialogue and the ending epilogue branch on them.

Mission state persists too (`cnpc2.mission`), so reloading mid-quest resumes
where you left off.

### Verifiable behaviours in the shipped game

- Ask Maya about the crate → she tells her story and points you to Rosa.
- Ask Rosa what she saw → the clue's warmth depends on trust and whether you
  told her Maya is worried; rude? you get the curt version (location still
  given — the mission can't soft-lock).
- Accuse Victor **once** → flat denial + trust −6. Accuse him **twice** → he
  loses his temper and confesses *moving* the crate (and that he didn't steal
  it). Ask politely with earned trust, or after the crate is recovered, and he
  comes clean earlier.
- Find the crate before anyone told you → recorded; Rosa is personally
  offended ("you found it WITHOUT me?").
- Four distinct endings (clean return, air cleared, cloud of suspicion, rough
  return) chosen from accumulated decisions.

## AI conversation

### Cloud backend: Gemini via Supabase Edge Functions (preferred)

When configured, dialogue runs through the `npc-dialogue` Edge Function:
**player JWT → RLS-scoped memory read → Gemini (server-held key) → memories +
trust written back**. The browser only ever holds the project URL and the
publishable anon key (`.env.example`); the Gemini key lives in Supabase
secrets and the app never uses a service-role key at all.

Setup (one-time, requires your own Supabase + Google AI Studio accounts):

1. Create a project at [supabase.com](https://supabase.com), enable
   **Anonymous sign-ins** (Authentication → Providers → Anonymous).
2. Apply the migration:
   `supabase db push` (SQL is in `supabase/migrations/`).
3. Deploy the function:
   `supabase functions deploy npc-dialogue`.
4. Set the Gemini key (from [aistudio.google.com](https://aistudio.google.com/apikey)):
   `supabase secrets set GEMINI_API_KEY=…`.
5. Copy `.env.example` → `.env` with your project URL + anon key, then
   `npm run dev`.

Provider priority: **Supabase cloud → `cnpc.llm` OpenAI-compatible endpoint →
labelled mission-aware demo replies.** Failures (quota 429, auth, network,
timeout, missing key) surface as a visible system line, and the turn falls
back to demo replies badged `placeholder` — scripted text is never presented
as genuine AI.

Local test double for the backend (dev only, scripted replies clearly marked
`mock-scripted`): `node scripts/mock-supabase.mjs`, then in the console:

```js
localStorage.setItem('cnpc.cloud', JSON.stringify({ url: 'http://localhost:8789', anonKey: 'mock-anon' }));
location.reload();
```

### INITIAL SIMULATED MEMORIES (Fictional Initial State)

These are seeded fictional memories to give NPCs initial personality and history. They are labeled as simulated/fictional and do not represent real events. Subsequent gameplay adds real memories.

**Important NPCs (10):** Arjun (cautious shopkeeper, broken promise), Maya Chen (friendly market vendor, past help), Ravi (distrustful guard, suspicious activity), Kabir (curious traveller, rumors), Leela (wise elder, values courtesy), Dev (merchant, broken trade agreement), Sana (messenger, appreciates help), Imran (musician, friendly history), Victor Osei (gruff handyman), Rosa Delgado (dancer/witness). See constants.ts for full seeds.

Memories are per (player, npc): each anonymous browser session gets its own
Supabase user id, every table is RLS-locked to `auth.uid()`, and each NPC's
rows are keyed separately — Maya's memories never appear in Victor's prompt.

### Local / BYO endpoint

Any endpoint speaking the OpenAI `/chat/completions` shape works (LM Studio,
Ollama `/v1`, llama.cpp, OpenRouter…). In the browser console:

```js
localStorage.setItem('cnpc.llm', JSON.stringify({
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model:    'model-id-your-server-expects',
  key:      ''   // bearer token for hosted APIs; blank for local servers
}));
location.reload();
```

What the model receives each turn: persona + speaking style, trust + attitude,
retrieved memories, recent dialogue history, and the NPC's **stage-aware
knowledge facts** (know / does-not-know).

**If no model is configured** (or the endpoint fails mid-conversation), the
game stays fully playable: replies come from `knowledge.js` — in-character,
mission-aware, trust- and decision-driven — and every line is badged
`placeholder` in the UI with the provider state in the status strip. Failures
show a visible error first, then the offline fallback. No API keys ever ship
in browser code.

For a local test double of the endpoint: `node scripts/mock-llm.mjs`.

### Voice

- **STT**: Web Speech API (`mic` button) — needs Chrome/Edge. Press 🎤 →
  pulsing *Listening…* state → the recognized text appears in a confirm bar
  with **Send / Retry / Cancel** (nothing is auto-submitted). Pressing 🎤
  again cancels. Denied permission, no speech, missing mic, network failures
  and unsupported browsers each surface their own clear message. Limitation:
  Chrome's recognition uses Google's network service — offline/sandboxed
  environments get an honest network error instead of a fake transcript.
- **TTS**: `speechSynthesis` first — NPC replies play automatically with a
  persona-shaped pitch; **Mute / Replay / Stop** controls in the panel
  (mute persists). Speech can never overlap: every new reply hard-cancels the
  previous utterance.
- **States**: listening → transcript confirm → *thinking…* → *speaking*;
  duplicates blocked (mic disabled while a reply is pending, double-click
  guarded, one transcript send).
- **Animation**: NPCs play their real idle clip throughout and a one-shot
  gesture on each reply, on replay, and periodically while speaking.
  **No lip-sync or facial animation** — none exists and none is claimed.
- **Hosted neural TTS/STT**: an unwired seam (`cnpc.tts` config key) — not
  integrated, and nothing fakes it. No voice API keys ship in the frontend.

## Assets & licences

| Asset | Source | Licence |
| --- | --- | --- |
| Soldier / Xbot / Michelle GLBs | three.js example assets | MIT |
| grass, asphalt, concrete, brick, plaster, **wood_planks** (diff/normal/rough) | Poly Haven (1K) | CC0 |
| red_brick, rough_plaster_brick, painted_plaster_wall, concrete_pavement, cobblestone_02, clay_roof_tiles, leafy_grass, concrete (diff/nor/rough 1K) | Poly Haven | CC0 |
| kloofendal_48d_partly_cloudy_puresky_1k.hdr (sky / IBL) | Poly Haven | CC0 |
| tree_small_02, shrub_01 (+ `_low` LOD variants) | Poly Haven models, decimated with meshoptimizer | CC0 |
| street_lamp_01, painted_wooden_bench, planter_box_01, wooden_crate_01, wine_barrel_01, fire_hydrant, metal_trash_can | Poly Haven models, decimated with meshoptimizer | CC0 |

The loader **throws** if any required file or clip is missing — no silent
fallbacks, no cube stand-ins for characters.

## Known limits (honest list)

- Buildings are procedurally massed boxes with PBR facades, roofs, windows,
  doors and awnings — detailed enough to read as a town, not photoreal modular
  buildings.
- Player clips are Idle/Walk/Run only: jumping holds a frozen walk pose (no
  jump clip exists in Soldier.glb), and turns are slerped rather than played
  as turn animations.
- NPCs idle + look-at + one-shot gestures; no lip-sync or facial animation
  (not claimed anywhere in the UI).
- Trees and shrubs use two-level `THREE.LOD` (full scan-quality mesh near,
  decimated variant beyond ~25 m); props are single meshes. Sky + ambient come
  from a CC0 HDRI through `PMREMGenerator`; the sun is a directional light
  aligned to the HDRI's sun disc, one 2048² shadow map, pixel ratio capped at
  1.5. Typical town view ≈95 draw calls / ~240k triangles, 45–55 FPS on a
  mid-range GPU (measured in Chrome).
- Web STT needs Chrome/Edge; hosted neural voices are an unwired seam.

## Resetting

```js
// in the browser console
Object.keys(localStorage).filter(k => k.startsWith('cnpc')).forEach(k => localStorage.removeItem(k));
location.reload();
```

This clears every NPC's memory, trust and the mission state — a clean first run.
