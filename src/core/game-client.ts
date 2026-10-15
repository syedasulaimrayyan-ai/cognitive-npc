import * as THREE from 'three';
import * as C from './constants';
import { SkyDome, buildEnvironment } from './environment';
import { buildMissionProps } from '../game/mission-props';
import { Mission } from '../game/mission';
import { AssetLoader } from './asset-loader';
import { Input } from './input';
import { CameraRig } from './camera-rig';
import { CollisionGrid } from './collision';
import { PlayerAvatar } from '../entities/player-avatar';
import { NPCAvatar } from '../entities/npc-avatar';
import { DialogueEngine } from '../ai/dialogue-engine';
import { VoiceIO } from '../ai/voice/voice-io';

/**
 * Imperative Three.js orchestrator. React never touches the 3D scene graph;
 * it only receives slabs of state (HUD payload, dialogue payload) pushed on
 * animation frames that actually changed something — cheap and smooth.
 *
 * Owns the Mission state machine: E-interactions feed it (talk / pick up
 * crate / return crate), dialogue events flow through it (via the dialogue
 * engine's onWorldEvent hook) and its snapshot drives the HUD tracker.
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
    this._notice = null;             // { id, text } transient objective toast
    this._noticeSeq = 0;
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
    // Clear any canvas a previous (hot-reloaded) client may have left behind.
    el.querySelectorAll('canvas').forEach((c) => c.remove());
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

    // Mission set dressing: storehouse, market stalls, entrance arch, crate.
    this.cb.onProgress?.('Setting the scene…');
    const props = buildMissionProps(this.scene, this.assets);
    colliders.push(...props.colliders);
    this.crate = {
      group: props.crateGroup,
      world: new THREE.Vector3(C.CRATE_POS.x + 0.55, 0.4, C.CRATE_POS.z - 0.15),
      home: { parent: props.crateGroup.parent, pos: props.crateGroup.position.clone(), rot: props.crateGroup.rotation.y },
    };
    this.beacon = props.beacon;

    this.cb.onProgress?.('Rigging characters…');
    this.collisions = new CollisionGrid(200, 2.2);
    colliders.forEach((b) => this.collisions.add(b));
    // Same static boxes, precomputed as Box3 for camera occlusion each frame.
    this.cameraBlockers = colliders.map(
      (b) => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)),
    );

    // --- Mission state machine ------------------------------------------------
    this.mission = new Mission();
    this._syncCrateVisual();

    // --- Player -------------------------------------------------------------
    this.player = new PlayerAvatar(this.assets, {
      clips: C.CHARACTERS.player.clips,
    });
    this.player.root.position.set(C.PLAYER_SPAWN.x, 0, C.PLAYER_SPAWN.z);
    // Soldier.glb's forward is local −z, which IS north at identity rotation
    // (yaw 0 ≡ facing −z ≡ camera forward at spawn) — so no initial rotation
    // and no 180° swing on the first frames; _facingYaw starts at 0 too.
    this.player.root.rotation.y = 0;
    this.scene.add(this.player.root);

    // --- NPCs ----------------------------------------------------------------
    this.npcControllers = new Map();
    for (const def of C.NPCS) {
      const avatar = new NPCAvatar(this.assets, {
        modelKey: def.model,
        idleClip: def.idleClip,
        gestureClips: def.gestureClip ? [def.gestureClip] : [],
        tint: def.tint ?? null,
      });
      avatar.root.position.set(def.spawn.x, 0, def.spawn.z);
      avatar.root.rotation.y = Math.PI;
      this.scene.add(avatar.root);
      // NPCs are solid: add their footprint so the player can't walk through.
      this.collisions.add({
        min: [def.spawn.x - 0.4, 0, def.spawn.z - 0.4],
        max: [def.spawn.x + 0.4, 2, def.spawn.z + 0.4],
      });
      this.npcControllers.set(def.id, { avatar, def, engine: null });
    }

    this.input = new Input(this.renderer.domElement);
    // Spawn is at the south entrance: camera starts behind (south of) the
    // player looking north up the street — yaw 0 puts the rig's offset on +z.
    this.rig = new CameraRig(this.camera);
    this.rig.yaw = 0;
    this.rig.pitch = 0.35;
    this._updateBeacon();

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
      if (!this.dialogueOpen) this._requestLockOrFallback();
    });
    document.addEventListener('pointerlockchange', this._onPointerLock = () => {
      this._pointerLocked = document.pointerLockElement === this.renderer.domElement;
      this._lastHud = '';
    });
    document.addEventListener('pointerlockerror', this._onLockError = () => this._enableFallbackLook());

    this.clock = new THREE.Clock();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  /** Try pointer lock; if the browser refuses (sandboxed iframe, policy,
   *  headless env) switch to drag-to-look fallback so the game stays
   *  playable instead of silently trapping the player behind the overlay. */
  _requestLockOrFallback() {
    if (this.disposed) return;
    try {
      const p = this.renderer?.domElement?.requestPointerLock?.();
      if (p?.catch) p.catch(() => this._enableFallbackLook());
    } catch { this._enableFallbackLook(); }
  }

  _enableFallbackLook() {
    if (this._fallbackLook || this.disposed) return;
    this._fallbackLook = true;
    if (this.input) this.input.fallbackLook = true;
    this._lastHud = '';
  }

  /** React → Paused overlay click (runs inside the click's user gesture). */
  resumePointerLock() {
    if (this.disposed || this.dialogueOpen) return;
    this._requestLockOrFallback();
  }

  // ---- mission helpers -------------------------------------------------------

  _npcPos(id) {
    const c = this.npcControllers.get(id);
    return c ? c.avatar.root.position : null;
  }

  get _holdingCrate() { return this.mission.stage === C.STAGE.CRATE; }
  get _crateVisible() { return this.crate && this.crate.group.visible; }

  _crateNear() {
    if (!this._crateVisible) return false;
    return this.player.root.position.distanceTo(this.crate.world) <= C.CRATE_RANGE;
  }

  /** Reconcile the crate prop with mission state (idempotent, safe at init):
   *  - carried (stage CRATE): hidden — it's on the player's back
   *  - delivered (DONE): standing beside Maya's stall
   *  - otherwise: on its stack behind the storehouse */
  _syncCrateVisual() {
    if (!this.crate) return;
    const g = this.crate.group;
    if (this.mission.stage >= C.STAGE.DONE) {
      this.scene.attach(g);
      // Back on Maya's counter, where a returned crate belongs.
      g.position.set(-8.8, 1.4, 1.8);
      g.rotation.set(0, 0.5, 0);
      g.visible = true;
    } else if (this.mission.stage >= C.STAGE.CRATE) {
      g.visible = false;
    } else {
      this.crate.home.parent.add(g);
      g.position.copy(this.crate.home.pos);
      g.rotation.set(0, this.crate.home.rot, 0);
      g.visible = true;
    }
  }

  _updateBeacon() {
    const s = this.mission.stage;
    const pos =
      s === C.STAGE.INTRO || s === C.STAGE.CRATE ? this._npcPos('maya')
      : s === C.STAGE.ASKED ? this._npcPos('rosa')
      : s === C.STAGE.CLUE ? this.crate?.world
      : null;
    this.beacon?.set(pos);
  }

  _notify(text) {
    this._notice = { id: ++this._noticeSeq, text };
    this._lastHud = '';
  }

  /** Dialogue event → mission machine. Called from DialogueEngine hooks. */
  _onMissionDialogueEvent(payload) {
    const { npcId, intents } = payload;
    const res = this.mission.reactToDialogue(npcId, new Set(intents));
    if (res.notify) this._notify(res.notify);
    if (res.changed) this._updateBeacon();
    this._lastHud = '';
  }

  _pickupCrate() {
    if (this._holdingCrate) return;
    // Found it before Rosa ever spoke? Record the snub — she'll remember.
    if (!this.mission.decisions.clueGiven) this.mission.decide('foundWithoutClue', true);
    this.mission.collectCrate();
    this._syncCrateVisual(); // hides it — the player is carrying it now
    this._notify('Crate recovered — bring it back to Maya at the market stall.');
    this._updateBeacon();
    this._lastHud = '';
  }

  _completeMission() {
    const epilogue = this.mission.complete();
    if (!epilogue) return;
    this._syncCrateVisual(); // crate now stands beside Maya's stall
    this._notify('The missing supply is back where it belongs.');
    this._updateBeacon();
    this._lastHud = '';
  }

  /** Debug handle: full mission reset (also restores the crate prop). */
  missionReset() {
    this.mission.reset();
    this._syncCrateVisual();
    this._updateBeacon();
    this._lastHud = '';
  }

  // ---- interaction / dialogue ------------------------------------------------

  interactNearestNpc() {
    let best = null, bestD = Infinity;
    for (const { avatar, def } of this.npcControllers.values()) {
      const d = avatar.root.position.distanceTo(this.player.root.position);
      if (d < bestD) { bestD = d; best = { avatar, def }; }
    }
    return bestD <= C.INTERACT_RANGE ? best : null;
  }

  /** The single E action for the current context (priority-ordered). */
  _interactAction(near) {
    const crateNear = this._crateNear();
    if (near && this._holdingCrate && near.def.id === 'maya') {
      return { kind: 'deliver', label: `return the crate to ${near.def.name}` };
    }
    if (crateNear) return { kind: 'pickup', label: 'pick up the missing crate' };
    if (near) return { kind: 'talk', label: `talk to ${near.def.name}` };
    return null;
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
        // Mission wiring: the engine reads live state and reports what was said.
        getMissionCtx: () => ({ stage: this.mission.stage, decisions: this.mission.decisions }),
        onWorldEvent: (kind, payload) => kind === 'dialogue' && this._onMissionDialogueEvent(payload),
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
    this._pushDialogue(); // engine is null → pushes `null`, closing the React panel
    this._requestLockOrFallback();
  }

  /** Push current dialogue state to React (or clear it when no engine). */
  _pushDialogue() {
    if (this.dialogueEngine) this._pushDialogueFrom(this.dialogueEngine);
    else this.cb.onDialogue?.(null);
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
    const playing = this.input.active && !this.dialogueOpen;

    // --- input & movement ----------------------------------------------------
    if (playing) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.rig.onMouseLook(dx, dy);
    }
    const near = this.interactNearestNpc();
    const action = this._interactAction(near);
    if (this.input.consumeInteract() && action && !this.dialogueOpen) {
      if (action.kind === 'talk') this.beginConversation(near.def);
      else if (action.kind === 'pickup') this._pickupCrate();
      else if (action.kind === 'deliver') {
        // Open the conversation FIRST so Maya's "you found it!" greeting
        // fires while the stage still says CRATE, then complete the mission
        // (her follow-up replies use the DONE knowledge; the completion
        // screen sits behind the dialogue panel until the player closes it).
        this.beginConversation(near.def);
        this._completeMission();
      }
    }

    const move = playing ? this.input.moveAxis() : { x: 0, y: 0 };
    const jump = this.input.consumeJump();
    this.player.update(dt, move, playing && this.input.running(), jump, this.rig.forwardVec());
    this.collisions.resolve(this.player.root.position);
    this.player.syncPosition(this.player.root.position);

    // --- NPCs -----------------------------------------------------------------
    for (const { avatar, def } of this.npcControllers.values()) {
      avatar.update(dt);
      const d = avatar.root.position.distanceTo(this.player.root.position);
      if (d < 9) avatar.lookAt(this.player.root.position.x, this.player.root.position.z, dt);
    }

    this.rig.update(this.player.root.position, dt, this.cameraBlockers);
    this.beacon?.update(dt, this.camera);

    // --- HUD sync (cheap, string-diffed) -------------------------------------
    const hint = action && !this.dialogueOpen ? action.label : null;
    const active = this.input.active;
    const m = this.mission.snapshot();
    const hudKey = `${hint}|${active}|${this._pointerLocked}|${this.dialogueOpen}|${m.stage}|${this._notice?.id ?? ''}|${this._holdingCrate}`;
    if (hudKey !== this._lastHud) {
      this._lastHud = hudKey;
      this.cb.onHud?.({
        pointerLocked: active,
        lookHint: active && !this._pointerLocked ? 'Pointer lock unavailable — drag the mouse to look' : null,
        interaction: hint,
        mission: m,
        holdingCrate: this._holdingCrate,
        notice: this._notice,
      });
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
    document.removeEventListener('pointerlockerror', this._onLockError);
    // Remove the canvas too — React Fast Refresh remounts the component and
    // a stale canvas would otherwise stack over the new one (dev artifact).
    this.renderer?.domElement?.remove();
    this.renderer?.dispose();
  }
}
