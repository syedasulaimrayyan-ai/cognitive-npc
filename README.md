# Cognitive NPC — 3D Third-Person Prototype

A small browser-playable 3D town built with **Three.js** (ES modules + Vite).
You walk a third-person character through a procedurally generated town and can
walk up to a townsperson NPC and start a text conversation.

```
cognitive-npc/
├── index.html                  # entry page (HUD + dialogue panel markup)
├── vite.config.js
├── package.json
└── src/
    ├── main.js                 # bootstraps the Game loop
    ├── core/game.js            # renderer, camera, wiring, main loop
    ├── world/town.js           # procedural town: roads, buildings, trees, lighting
    ├── player/player.js        # humanoid mesh, WASD movement, orbital camera
    ├── npc/npc.js              # interactable NPC with idle animation
    ├── npc/memory.js           # structured, persistent NPC memory (events + trust)
    ├── ai/llm.js               # modular conversational-provider interface
    ├── ai/voice.js             # hook-points for mic / STT / TTS (NOT implemented)
    └── ui/{dialogue,hud,ui.css}
```

## Run it

```bash
cd cognitive-npc
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`).

- Click anywhere → game captures the mouse (pointer lock).
- **WASD** move · **Shift** run · **mouse** look
- Walk up to the NPC standing in the plaza → **E** opens the dialogue panel.
- **Esc** closes the panel / releases the mouse.

`npm run build && npm run preview` produces an optimized production bundle.

Performance notes: everything is procedural (no asset downloads), Lambert materials,
one shadow-casting light with a bounded shadow frustum, pixel ratio capped at 1.5,
and geometry is modest (~300 meshes). It runs comfortably on integrated GPUs.

## What is real vs. what is deliberately unfinished

| Feature | Status |
| --- | --- |
| 3D town, player controller, third-person camera | **done** |
| NPC with idle animation + interaction prompt | **done** |
| Dialogue UI with typed replies | **done** |
| **Persistent structured memory** | **real** — `MemoryStore` saves events + trust per NPC to `localStorage`, survives reloads |
| **AI model conversation** | **interface only** — a working `OpenAICompatibleProvider` exists but needs you to point it at a server; without config the UI shows clearly labeled placeholder replies |
| **Microphone / STT** | **scaffold only** — `VoiceIO` detects browser support but the mic button stays disabled and throwing |
| **Text-to-speech** | **scaffold only** — `VoiceIO.speak()` is a no-op that logs |

Nothing pretends to be finished: placeholder chat replies are badged, the status
strip shows the provider state, and voice calls log "not implemented yet".

## Connecting a real conversational model

Any HTTP endpoint that speaks the OpenAI `/chat/completions` shape works
(OpenAI, OpenRouter, LM Studio `http://localhost:1234/v1/chat/completions`,
Ollama's `/v1` route, llama.cpp server…). In the page's console:

```js
localStorage.setItem('cnpc.llm', JSON.stringify({
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model:    'model-id-your-server-expects',
  key:      '' // or a bearer token for hosted APIs
}));
// then reload the page
```

What you get once connected:
- A **system prompt built from real NPC memory** (`memory.buildPromptContext`)
  describing the accumulated events and the current trust level.
- Recent conversation history included automatically.
- Trust drift: polite replies nudge `trust` up, hostile replies down; every
  exchange is logged back into persistent memory.

> Remote hosted endpoints will often be blocked by browser CORS — a local model
> server (LM Studio / Ollama) or a tiny proxy is the simplest path for now.

## Where the AI hooks get plugged in next

| Step | Where |
| --- | --- |
| 1. Live dialogue model | swap the provider in `src/ai/llm.js` (`createProvider`) |
| 2. Mic capture | implement `VoiceIO.listen()` — `getUserMedia` + `MediaRecorder` |
| 3. Speech-to-text | Web Speech API or an external STT endpoint inside `VoiceIO` |
| 4. Text-to-speech | `VoiceIO.speak()` via `speechSynthesis` or a TTS API |
| 5. Richer memories | extend `MemoryStore` schema (goals, relationships, grievances) |

Memory is already persisted and structured, so once a real model is connected
it reads the same JSON the placeholder path writes.
