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
│   └── textures/*.jpg          # PBR maps (Poly Haven CC0)
└── src/
    ├── main.jsx                # React entry → ui/App.jsx
    ├── core/
    │   ├── game-client.js      # orchestrator: scene, loop, mission wiring, HUD sync
    │   ├── environment.js      # town: terrain, roads, buildings, plaza, lights, sky
    │   ├── asset-loader.js     # GLB + texture loading (throws loudly on missing assets)
    │   ├── camera-rig.js       # third-person camera with wall occlusion
    │   ├── collision.js        # uniform-grid AABB world collision
    │   ├── input.js            # keyboard/mouse, pointer-lock + drag fallback
    │   └── constants.js        # world layout, NPC identities, mission geography, STAGE
    ├── entities/
    │   ├── player-avatar.js    # rigged player: mixer blending Idle/Walk/Run, gravity, jump
    │   └── npc-avatar.js       # rigged NPCs: idle loop, look-at, gesture clips, tinting
    ├── game/
    │   ├── mission.js          # "THE MISSING SUPPLY" state machine (persisted)
    │   └── mission-props.js    # crate, old storehouse, market stalls, arch, beacon
    ├── ai/
    │   ├── dialogue-engine.js  # conversation driver: prompt assembly, provider calls
    │   ├── cognitive/
    │   │   ├── memory.js       # persistent structured memory + retrieval + trust
    │   │   ├── persona.js      # persona index
    │   │   └── knowledge.js    # intents, knowledge boundaries, offline conversation
    │   └── voice/voice-io.js   # Web Speech STT + speechSynthesis TTS
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

- **STT**: Web Speech API (`mic` button) — needs Chrome/Edge; permission
  denial and recognition errors surface visibly in the panel.
- **TTS**: `speechSynthesis`, pitch varies per persona — real and working.
- **Hosted neural TTS/STT**: an unwired seam (`cnpc.tts` config key) — not
  integrated, and nothing fakes it.

## Assets & licences

| Asset | Source | Licence |
| --- | --- | --- |
| Soldier / Xbot / Michelle GLBs | three.js example assets | MIT |
| grass, asphalt, concrete, brick, plaster, **wood_planks** (diff/normal/rough) | Poly Haven (1K) | CC0 |

The loader **throws** if any required file or clip is missing — no silent
fallbacks, no cube stand-ins for characters.

## Known limits (honest list)

- Buildings are procedurally massed boxes with PBR facades, roofs and window
  bands — detailed enough to read as a town, not photoreal modular buildings.
- Player clips are Idle/Walk/Run only: jumping holds a frozen walk pose (no
  jump clip exists in Soldier.glb), and turns are slerped rather than played
  as turn animations.
- NPCs idle + look-at + one-shot gestures; no lip-sync or facial animation
  (not claimed anywhere in the UI).
- No LOD system — the map is ~200 m; shadows use one 2048² cascade, pixel
  ratio capped at 1.5 (≈110 draw calls, ~65k triangles — smooth on desktop
  GPUs).
- Web STT needs Chrome/Edge; hosted neural voices are an unwired seam.

## Resetting

```js
// in the browser console
Object.keys(localStorage).filter(k => k.startsWith('cnpc')).forEach(k => localStorage.removeItem(k));
location.reload();
```

This clears every NPC's memory, trust and the mission state — a clean first run.
