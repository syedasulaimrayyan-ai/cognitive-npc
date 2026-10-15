import * as THREE from 'three';
import * as C from './constants.js';
import { SkyDome, buildEnvironment } from './environment.js';
import { AssetLoader } from './asset-loader.js';
import { Input } from './input.js';
import { CameraRig } from './camera-rig.js';
import { CollisionGrid } from './collision.js';
import { PlayerAvatar } from '../entities/player-avatar.js';
import { NPCAvatar } from '../entities/npc-avatar.js';
import { DialogueEngine } from '../ai/dialogue-engine.js';
import { VoiceIO } from '../ai/voice/voice-io.js';

/**
 * Imperative Three.js orchestrator. React never touches the 3D scene graph;
 * it only receives slabs of state (HUD payload, dialogue payload) pushed on
 * animation frames that actually changed something — cheap and smooth.
 */
export class GameClient {
  constructor(viewportEl, callbacks = {}) {
    this.viewportEl = viewportEl;
    this.cb = callbacks;
    this.disposed = false;
    this.dialogueOpen = false;
    this.dialogueEngine = null;
    this.npcControllers = new Map(); // id -> { avatar, def, engine }
    this._lastHud = '';
    this.voice = new VoiceIO();
  }

  async start() {
    try { await this._init(); this.cb.onReady?.(); }
    catch (err) {
      console.error(err);
      this.cb.onFatal?.({ message: String(err?.message || err) });
    }
  }

  async _init() {
    const el = this.viewportEl;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(C.SKY_COLOR, 60, 170);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 450);

    this.cb.onProgress?.('Loading characters & textures…');
    this.assets = new AssetLoader(this.cb.onProgress?.bind(this.cb));
    await this.assets.loadAll();

    this.cb.onProgress?.('Assembling the town…');
    this.skyDome = new SkyDome(this.scene);
    const colliders = buildEnvironment(this.scene, this.assets);

    this.cb.onProgress?.('Rigging characters…');
    this.collisions = new CollisionGrid(200, 2.2);
    colliders.forEach((b) => this.collisions.add(b));

    // --- Player -------------------------------------------------------------
    const pdef = C.CONTROLS;
    this.player = new PlayerAvatar(this.assets, {
      clips: C.CHARACTERS.player.clips,
    });
    this.player.root.position.set(C.PLAYER_SPAWN.x, 0, C.PLAYER_SPAWN.z);
    this.scene.add(this.player.root);

    // --- NPCs ----------------------------------------------------------------
    this.npcControllers = new Map();
    for (const def of C.NPCS) {
      const avatar = new NPCAvatar(this.assets, {
        modelKey: def.model,
        idleClip: def.idleClip,
        gestureClips: def.gestureClip ? [def.gestureClip] : [],
      });
      avatar.root.position.set(def.spawn.x, 0, def.spawn.z);
      avatar.root.rotation.y = Math.PI;
      this.scene.add(avatar.root);
      this.npcControllers.set(def.id, { avatar, def, engine: null });
    }

    this.input = new Input(this.renderer.domElement);
    this.rig = new CameraRig(this.camera);

    // --- events --------------------------------------------------------------
    this._onResize = () => {
      const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    this._onResize();
    window.addEventListener('resize', this._onResize);

    this.renderer.domElement.addEventListener('click', () => {
      if (!this.dialogueOpen) this.renderer.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', this._onPointerLock = () => {
      this._pointerLocked = document.pointerLockElement === this.renderer.domElement;
    });

    this.clock = new THREE.Clock();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  interactNearestNpc() {
    let best = null, bestD = Infinity;
    for (const { avatar, def } of this.npcControllers.values()) {
      const d = avatar.root.position.distanceTo(this.player.root.position);
      if (d < bestD) { bestD = d; best = { avatar, def }; }
    }
    return bestD <= C.INTERACT_RANGE ? best : null;
  }

  /** Called by React when the player confirms the "Talk to X" prompt. */
  beginConversation(def) {
    if (this.dialogueOpen) return;
    this.dialogueOpen = true;
    document.exitPointerLock();
    let engine = this.npcControllers.get(def.id).engine;
    if (!engine) {
      engine = new DialogueEngine(def, {
        onUpdate: () => this.dialogueEngine === engine && this._pushDialogueFrom(engine),
        openState: () => this.dialogueOpen,
        onGesture: () => this.npcControllers.get(def.id)?.avatar.gesture(),
        onReply: (text) => this.voice.speak(text, { pitch: engine.persona.voicePitch }),
        sttSupported: this.voice.capability.stt,
      });
      this.npcControllers.get(def.id).engine = engine;
    }
    this.dialogueEngine = engine;
    this.voice.stopSpeaking();
    engine.greeting();
    // Face the player toward the NPC.
    const npc = this.npcControllers.get(def.id).avatar.root;
    this.player.root.rotation.y = Math.atan2(npc.position.x - this.player.root.position.x, npc.position.z - this.player.root.position.z);
    this._pushDialogueFrom(engine);
  }

  endConversation() {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.dialogueEngine?.closeSession();
    this.dialogueEngine = null;
    this._pushDialogue();
    this.renderer.domElement.requestPointerLock();
  }

  /** React → engine text relay (also handles '/close'). */
  sendDialogueText(text) {
    if (text === '/close') { this.endConversation(); return; }
    this.dialogueEngine?.submit(text);
  }

  /** Mic → text → submit. Throws with a readable message on failure. */
  async requestVoiceInput() {
    if (!this.dialogueEngine) throw new Error('No active conversation.');
    const text = await this.voice.listenOnce();
    if (text) this.sendDialogueText(text);
    return text;
  }

  _pushDialogueFrom(engine) {
    this.cb.onDialogue?.({
      npc: {
        name: engine.persona.name, role: engine.persona.role, color: engine.persona.color,
        trust: engine.memory.trust, memEventCount: engine.memory.state.events.length,
      },
      messages: engine.messages,
      pending: engine.pending,
      status: engine.provider.label,
      warn: engine.provider.isPlaceholder,
      sttSupported: this.voice.capability.stt,
    });
  }

  _tick() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._tick());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const locked = this._pointerLocked ?? false;

    // --- input & movement ----------------------------------------------------
    if (locked && !this.dialogueOpen) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.rig.onMouseLook(dx, dy);
    }
    const near = this.interactNearestNpc();
    if (this.input.consumeInteract() && near && !this.dialogueOpen) this.beginConversation(near.def);

    const move = locked && !this.dialogueOpen ? this.input.moveAxis() : { x: 0, y: 0 };
    const jump = this.input.consumeJump();
    this.player.update(dt, move, locked && this.input.running(), jump, this.rig.forwardVec());
    this.collisions.resolve(this.player.root.position);
    this.player.syncPosition(this.player.root.position);

    // --- NPCs -----------------------------------------------------------------
    for (const { avatar, def } of this.npcControllers.values()) {
      avatar.update(dt);
      const d = avatar.root.position.distanceTo(this.player.root.position);
      if (d < 9) avatar.lookAt(this.player.root.position.x, this.player.root.position.z, dt);
    }

    this.rig.update(this.player.root.position, dt, []);

    // --- HUD sync (cheap, string-diffed) -------------------------------------
    const hint = near ? `Press E to talk to ${near.def.name}` : null;
    const hudKey = `${hint}|${this._pointerLocked}|${this.dialogueOpen}`;
    if (hudKey !== this._lastHud) {
      this._lastHud = hudKey;
      this.cb.onHud?.({ pointerLocked: this._pointerLocked, interaction: hint && !this.dialogueOpen ? near.def.name : null });
      if (this.dialogueOpen) this._pushDialogue();
    }

    this.skyDome.mesh.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    this.renderer?.dispose();
  }
}
