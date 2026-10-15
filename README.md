# COGNITIVE NPC

A browser-only 3D third-person town built with **React + Three.js (WebGL)** and
Vite. You walk a real rigged, animated character through a small textured town
and strike up conversations with NPCs who have distinct personalities,
persistent structured memories, and trust levels that change based on how you
treat them.

```bash
cd cognitive-npc
npm install
npm run dev        # open the printed URL (e.g. http://localhost:5173)
npm run build      # optimized static site in dist/ — deployable anywhere
```

## Controls

- **Click** the game to capture the mouse (pointer lock). If the browser
  refuses pointer lock (sandboxed iframe, kiosk policy), the game automatically
  switches to **drag-to-look** mode and shows a hint — it never soft-locks you.
- **WASD** move · **Shift** run · **Space** jump · **Mouse** look
- Walk up to an NPC → **E** opens the dialogue panel · **Esc** releases the mouse
- Dialogue panel: type and send, or use the **🎤** button for voice input.

## Architecture

```
cognitive-npc/
├── index.html
├── vite.config.js                  # @vitejs/plugin-react
├── public/assets/
│   ├── characters/                 # Soldier.glb, Xbot.glb, Michelle.glb (MIT)
│   └── textures/                   # Poly Haven CC0 1K JPG PBR maps
└── src/
    ├── main.jsx                    # React entry
    ├── ui/App.jsx                  # shell: mounts GameClient, renders React UI
    ├── ui/HUD.jsx                  # crosshair, interaction prompt, pause overlay
    ├── ui/DialoguePanel.jsx        # chat log, trust/memory readout, mic button
    ├── ui/LoadingOverlay.jsx       # real asset-loading progress
    ├── core/game-client.js         # imperative Three.js orchestrator (main loop)
    ├── core/constants.js           # NPCs, verified GLB clip names, controls
    ├── core/asset-loader.js        # GLTFLoader + textures; fails loudly if missing
    ├── core/environment.js         # town: roads, buildings, trees, lamps, plaza
    ├── core/collision.js           # uniform-grid AABB collision (player + NPCs)
    ├── core/camera-rig.js          # third-person orbit camera w/ wall occlusion
    ├── core/input.js               # keyboard/mouse, pointer-lock + fallback
    ├── entities/player-avatar.js   # Soldier: Idle/Walk/Run blend via AnimationMixer
    ├── entities/npc-avatar.js      # Xbot/Michelle: idle loops + gesture clips
    ├── ai/dialogue-engine.js       # drives one conversation per NPC
    ├── ai/cognitive/memory.js      # MemoryStore: events + trust, localStorage-persisted
    ├── ai/cognitive/persona.js     # personas derived from constants.NPCS
    └── ai/voice/voice-io.js        # mic permission flow, Web STT/TTS + API-TTS seam
```

React never touches the scene graph: `GameClient` pushes small state slabs
(HUD payload, dialogue payload) up through callbacks; input flows down through
method calls.

## Real assets and licenses

| Asset | Source | License |
| --- | --- | --- |
| `Soldier.glb` (player; Idle/Walk/Run clips) | [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) | MIT |
| `Xbot.glb` (Maya & Victor; idle + agree/headShake clips) | three.js examples | MIT |
| `Michelle.glb` (Rosa; SambaDance clip) | three.js examples | MIT |
| grass / asphalt / asphalt_normal / concrete / brick / plaster (1K JPG) | [Poly Haven](https://polyhaven.com) | CC0 |

All characters are genuinely rigged skinned meshes driven by
`THREE.AnimationMixer` with cross-fades — no capsule stand-ins, no fake
animations. The asset loader **throws** (visible in the loading screen) if a
file or a required clip goes missing rather than substituting anything.

## What is real vs. deliberately unfinished

| Feature | Status |
| --- | --- |
| Third-person camera, WASD run jump, collision | **real** — verified in-browser, incl. camera wall-occlusion pull-in |
| GLB characters + animation blending | **real** — Idle/Walk/Run cross-fades, blend by speed |
| Town with PBR textures, fog, sky, shadows | **real** — procedural layout, ~100 textured buildings + props |
| NPC interaction, distinct personas | **real** — Maya (botanist), Victor (handyman), Rosa (dancer) |
| Structured memory + trust | **real** — `MemoryStore` persists per-NPC events, trust, conversation log to `localStorage` (`cnpc2.memory.<id>`); memories are retrieved (recency × salience × keywords) into the LLM system prompt **before every reply** |
| Memory-driven reactions | **real** — greeting vs. reunion, kind words raise trust, insults lower it, replies change tone by trust band; verified across reloads |
| AI model conversation | **interface + working provider** — placeholder replies are **clearly badged in the UI** until you configure an OpenAI-compatible endpoint (see below) |
| Microphone / speech-to-text | **real browser Web Speech API** with an explicit `getUserMedia` permission step; permission denials and recognition failures surface as visible error messages in the panel (verified: denied mic → readable error; sandboxed iframe → visible "network" STT error instead of silence) |
| Text-to-speech | **real browser `speechSynthesis`** with per-persona pitch (verified queuing). A hosted neural-TTS provider is **not integrated** — the seam exists in `voice-io.js`, and nothing fake is ever played |
| Jump animation | **honest stand-in** — Soldier.glb has no jump clip, so the model holds a frozen walk pose while airborne (documented, not faked) |
| Turn animations | **not in assets** — turning is smooth quaternion facing; the GLBs contain no turn clips |
| Level-of-detail system | **not implemented** — the map is small (~200 m) with few draw calls, so no LOD was needed yet |

## Connecting a real conversational model

Any endpoint speaking the OpenAI `/chat/completions` shape works (OpenAI,
OpenRouter, LM Studio, Ollama, llama.cpp server). In the browser console:

```js
localStorage.setItem('cnpc.llm', JSON.stringify({
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model:    'model-id-your-server-expects',
  key:      '' // bearer token for hosted APIs (or leave '' for local servers)
}));
// reload the page
```

**No API keys are hardcoded anywhere in this repo.** A key stored in
`localStorage` only ever leaves the browser as an `Authorization` header to the
endpoint *you* configured; for production, put the key behind a tiny server
proxy instead and point `endpoint` at the proxy.

> Remote hosted endpoints are often blocked by browser CORS — a local model
> server or a small proxy is the simplest path.

## Honest limitations

- Buildings are textured boxes with window bands — stylized, not modeled
  architecture; there is no interior geometry.
- Web Speech STT needs Chrome/Edge and Google's speech service; other browsers
  show a visible "not supported" error on the mic button.
- Rosa's idle is Michelle.glb's SambaDance clip (her dancer persona matches it;
  the file contains no other clip).
- Victor and Maya share Xbot.glb; Victor is differentiated by a darker garment
  tint applied to cloned materials (skin tones left natural).
- The dev preview inside a sandboxed iframe cannot pointer-lock; the game
  detects that and falls back to drag-to-look with an on-screen hint.
