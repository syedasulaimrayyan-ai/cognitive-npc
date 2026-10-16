import * as THREE from 'three';
import * as C from './constants';
import { buildEnvironment } from './environment';
import { buildMissionProps, type Beacon } from '../game/mission-props';
import { Mission } from '../game/mission';
import { AssetLoader } from './asset-loader';
import { Input } from './input';
import { CameraRig } from './camera-rig';
import { CollisionGrid } from './collision';
import { PlayerAvatar } from '../entities/player-avatar';
import { NPCAvatar } from '../entities/npc-avatar';
import { DialogueEngine, type DialoguePayload } from '../ai/dialogue-engine';
import { VoiceIO } from '../ai/voice/voice-io';
import { MemoryStore } from '../ai/cognitive/memory';
import { NpcBehavior } from '../ai/cognitive/npc-behavior';
import { NpcMovement } from '../entities/npc-movement';
import { PlayerInventory } from '../game/inventory';
import { HouseSystem } from '../game/houses';
import { HOUSE_DEFS } from './constants';

/** One NPC's live record: avatar + canonical def + private conversation + behavior. */
type NpcDef = (typeof C.NPCS)[number];
interface NpcController {
  avatar: NPCAvatar;
  def: NpcDef;
  engine: DialogueEngine | null;
  memory?: MemoryStore;
  behavior?: NpcBehavior;
  movement?: NpcMovement;
  _approaching?: boolean;
  _lastAutoTalk?: number;
}

/** React-facing slabs pushed from the render loop (see src/ui). */
export interface GameCallbacks {
  onProgress?: (message: string) => void;
  onReady?: () => void;
  onFatal?: (info: { message: string }) => void;
  onHud?: (state: HudState) => void;
  onDialogue?: (data: DialoguePayload | null) => void;
}

export interface HudState {
  pointerLocked: boolean;
  lookHint: string | null;
  interaction: string | null;
  mission: ReturnType<Mission['snapshot']>;
  holdingCrate: boolean;
  notice: { id: number; text: string } | null;
}

/** The crate prop as tracked against mission state. */
interface CrateRef {
  group: THREE.Group;
  world: THREE.Vector3;
  home: { parent: THREE.Object3D; pos: THREE.Vector3; rot: number };
}

/**
 * Imperative Three.js orchestrator. React never touches the 3D scene graph; React never touches the 3D scene graph;
 * it only receives slabs of state (HUD payload, dialogue payload) pushed on
 * animation frames that actually changed something — cheap and smooth.
 *
 * Owns the Mission state machine: E-interactions feed it (talk / pick up
 * crate / return crate), dialogue events flow through it (via the dialogue
 * engine's onWorldEvent hook) and its snapshot drives the HUD tracker.
 */
export class GameClient {
  viewportEl: HTMLElement;
  cb: GameCallbacks;
  disposed: boolean;
  dialogueOpen: boolean;
  dialogueEngine: DialogueEngine | null;
  npcControllers: Map<string, NpcController>;
  _lastHud: string;
  _notice: { id: number; text: string } | null;
  _noticeSeq: number;
  voice: VoiceIO;
  inventory: PlayerInventory;
  // Assigned in _init() before the render loop ever runs.
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  assets!: AssetLoader;
  sun!: THREE.DirectionalLight;
  sunOffset!: THREE.Vector3;
  crate: CrateRef | null = null;
  beacon!: Beacon;
  collisions!: CollisionGrid;
  cameraBlockers!: THREE.Box3[];
  mission!: Mission;
  player!: PlayerAvatar;
  input!: Input;
  rig!: CameraRig;
  clock!: THREE.Clock;
  _raf!: number;
  _onResize!: () => void;
  _onPointerLock!: () => void;
  _onLockError!: () => void;
  _pointerLocked = false;
  _fallbackLook = false;
  /** Timeout that fires a mid-speech gesture so long TTS replies keep the
   *  NPC animated; cleared whenever speech stops. */
  _talkingGesture: ReturnType<typeof setTimeout> | null = null;
  tradingOpen: boolean = false;
  houseSystem!: HouseSystem;
  npcInHouse: Map<string, string> = new Map(); // npcId -> houseId
  npcConversations: Map<string, { partner: string; start: number }> = new Map(); // conversationId or pair key

  constructor(viewportEl: HTMLElement, callbacks: GameCallbacks = {}) {
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
    this.inventory = new PlayerInventory();
    // Voice state changes (speech starts/stops, mute flips) re-push the
    // dialogue payload so React shows the live phase without polling.
    this.voice.onStateChange = () => this._onVoiceStateChange();
  }

  async start() {
    try { await this._init(); this.cb.onReady?.(); }
    catch (err: any) {
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
    this.scene.fog = new THREE.Fog(0xc2d0dc, 55, 165);
    this.houseSystem = new HouseSystem(this.scene);
    HOUSE_DEFS.forEach(def => {
      const house = HouseSystem.buildHouse(def, this.scene);
      this.houseSystem.addHouse(house);
      house.exteriorColliders.forEach(c => this.collisions.add(c));
    });
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 450);

    this.cb.onProgress?.('Loading characters & textures…');
    this.assets = new AssetLoader(this.cb.onProgress?.bind(this.cb));
    await this.assets.loadAll();

    this.cb.onProgress?.('Assembling the town…');
    // Photographic sky + image-based lighting from the CC0 HDRI. The sun rig
    // is extracted from the same HDRI so directional shadows agree with the
    // sky (see hdriSunDirection). The old gradient dome is kept in
    // environment.ts as a documented fallback but is no longer used.
    const hdr = this.assets.hdri('sky');
    this.scene.background = hdr;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    const { colliders, lighting } = buildEnvironment(this.scene, this.assets);
    this.sun = lighting.sun;
    this.sunOffset = lighting.sunOffset;

    // Mission set dressing: storehouse, market stalls, entrance arch, crate.
    this.cb.onProgress?.('Setting the scene…');
    const props = buildMissionProps(this.scene, this.assets);
    colliders.push(...props.colliders);
    this.crate = {
      group: props.crateGroup,
      world: new THREE.Vector3(C.CRATE_POS.x + 0.55, 0.4, C.CRATE_POS.z - 0.15),
      home: { parent: props.crateGroup.parent!, pos: props.crateGroup.position.clone(), rot: props.crateGroup.rotation.y },
    };
    this.beacon = props.beacon;

    this.cb.onProgress?.('Rigging characters…');
    this.collisions = new CollisionGrid(200, 2.2);
    colliders.forEach((b) => this.collisions.add(b));
    // Same static boxes, precomputed as Box3 for camera occlusion each frame.
    this.cameraBlockers = colliders.map((b) =>
      new THREE.Box3(
        new THREE.Vector3(b.min[0], b.min[1], b.min[2]),
        new THREE.Vector3(b.max[0], b.max[1], b.max[2]),
      ),
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
      const memory = new MemoryStore(def.id, (def as any).memorySeed || {});
      const behavior = new NpcBehavior(memory, def);
      const movement = new NpcMovement(avatar, def.spawn);
      this.npcControllers.set(def.id, { avatar, def, engine: null, memory, behavior, movement });
    }
    // Add background pedestrians (20-30 more for crowded feel)
    const bgModels = ['npcMale', 'npcFemale'];
    const bgTints = [0x8a8a7a, 0x9a8a6f, 0x7a8a9a, 0x8a7a8a, null];
    for (let i = 0; i < 25; i++) {
      const model = bgModels[i % bgModels.length];
      const tint = bgTints[i % bgTints.length];
      const def: any = {
        id: `bg_${i}`,
        name: `Pedestrian ${i}`,
        role: 'Townsperson',
        spawn: {
          x: (Math.random() - 0.5) * 80,
          z: (Math.random() - 0.5) * 80,
        },
      };
      const avatar = new NPCAvatar(this.assets, {
        modelKey: model,
        idleClip: model === 'npcFemale' ? 'SambaDance' : 'idle',
        tint,
      });
      avatar.root.position.set(def.spawn.x, 0, def.spawn.z);
      avatar.root.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(avatar.root);
      this.collisions.add({
        min: [def.spawn.x - 0.3, 0, def.spawn.z - 0.3],
        max: [def.spawn.x + 0.3, 2, def.spawn.z + 0.3],
      });
      const memory = new MemoryStore(def.id, {});
      const behavior = new NpcBehavior(memory, def);
      const movement = new NpcMovement(avatar, def.spawn);
      // Lighter behavior for background - lower decision frequency
      (movement as any).state.maxSpeed = 2.0;
      this.npcControllers.set(def.id, { avatar, def, engine: null, memory, behavior, movement });
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

  _npcPos(id: string) {
    const c = this.npcControllers.get(id);
    return c ? c.avatar.root.position : null;
  }

  get _holdingCrate() { return this.mission.stage === C.STAGE.CRATE; }
  get _crateVisible() { return !!this.crate && this.crate.group.visible; }

  _crateNear() {
    if (!this.crate || !this._crateVisible) return false;
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

  _notify(text: string) {
    this._notice = { id: ++this._noticeSeq, text };
    this._lastHud = '';
  }

  /** Dialogue event → mission machine. Called from DialogueEngine hooks. */
  _onMissionDialogueEvent(payload: { npcId: string; intents: Iterable<string> }) {
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
    let best: { avatar: NPCAvatar; def: NpcDef } | null = null;
    let bestD = Infinity;
    for (const { avatar, def } of this.npcControllers.values()) {
      const d = avatar.root.position.distanceTo(this.player.root.position);
      if (d < bestD) { bestD = d; best = { avatar, def }; }
    }
    return bestD <= C.INTERACT_RANGE ? best : null;
  }

  /** The single E action for the current context (priority-ordered). */
  _interactAction(near: { avatar: NPCAvatar; def: NpcDef } | null) {
    const crateNear = this._crateNear();
    const doorNear = this.houseSystem.getNearbyDoor(this.player.root.position);
    if (doorNear) {
      if (this.houseSystem.playerInside) {
        return { kind: 'exit_house', label: 'exit house' };
      }
      return { kind: 'knock_door', label: 'knock on door' };
    }
    if (near && this._holdingCrate && near.def.id === 'maya') {
      return { kind: 'deliver', label: `return the crate to ${near.def.name}` };
    }
    // Deliver supplies if player has them and talking to a resident
    if (near && this.inventory.hasItem('supplies') && (near.def.id === 'leela' || near.def.id === 'maya' || near.def.id === 'kabir' || near.def.id === 'sana')) {
      return { kind: 'deliver_supplies', label: `deliver supplies to ${near.def.name}` };
    }
    if (crateNear) return { kind: 'pickup', label: 'pick up the missing crate' };
    // Show trade option for shopkeepers
    const shopkeepers = ['maya', 'arjun', 'amira', 'tariq', 'dev'];
    if (near && shopkeepers.includes(near.def.id)) {
      return { kind: 'trade', label: `trade with ${near.def.name}` };
    }
    if (near) return { kind: 'talk', label: `talk to ${near.def.name}` };
    return null;
  }

  /** Called by React when the player confirms the "Talk to X" prompt. */
  beginConversation(def: NpcDef) {
    if (this.dialogueOpen) return;
    this.dialogueOpen = true;
    document.exitPointerLock();
    const entry = this.npcControllers.get(def.id);
    if (!entry) return;
    let engine = entry.engine;
    if (!engine) {
      const created = new DialogueEngine(def, {
        onUpdate: () => this.dialogueEngine === created && this._pushDialogueFrom(created),
        openState: () => this.dialogueOpen,
        onGesture: () => entry.avatar.gesture(),
        onReply: (text) => this.voice.speak(text, { pitch: created.persona.voicePitch }),
        sttSupported: this.voice.capability.stt,
        // Mission wiring: the engine reads live state and reports what was said.
        getMissionCtx: () => ({ stage: this.mission.stage, decisions: this.mission.decisions }),
        onWorldEvent: (kind, payload) => kind === 'dialogue' && this._onMissionDialogueEvent(payload),
      });
      entry.engine = created;
      engine = created;
    }
    this.dialogueEngine = engine;
    this.voice.stopSpeaking();
    engine.greeting();
    // Face the player toward the NPC.
    const npc = entry.avatar.root;
    this.player.root.rotation.y = Math.atan2(npc.position.x - this.player.root.position.x, npc.position.z - this.player.root.position.z);
    this._pushDialogueFrom(engine);
  }

  endConversation() {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.voice.stopSpeaking();
    this._clearTalkingGesture();
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
  sendDialogueText(text: string) {
    if (text === '/close') { this.endConversation(); return; }
    this.dialogueEngine?.submit(text);
  }

  /** Mic → transcript (NOT auto-sent). The panel shows it and lets the
   *  player Send / Retry / Cancel, so nothing is submitted by accident and
   *  duplicates are impossible while a reply is pending. */
  async requestVoiceInput(): Promise<string> {
    if (!this.dialogueEngine) throw new Error('No active conversation.');
    if (this.dialogueEngine.pending) throw new Error('Still waiting for a reply — one request at a time.');
    return this.voice.listenOnce();
  }

  /** Panel cancel control: abort an in-flight listen. */
  cancelVoiceInput() { this.voice.cancelListening(); }

  /** Panel stop control: silence the NPC mid-sentence. */
  stopSpeech() { this.voice.stopSpeaking(); this._clearTalkingGesture(); }

  /** Panel replay control: re-speak the last NPC line (+ a gesture). */
  replaySpeech() {
    if (!this.dialogueOpen) return false;
    const eng = this.dialogueEngine as (DialogueEngine & { persona?: { voicePitch?: number } }) | null;
    const ok = this.voice.replay({ pitch: eng?.persona?.voicePitch ?? 1 });
    if (ok) this._gestureActiveNpc();
    return ok;
  }

  /** Panel mute toggle (persisted). Returns the new muted state. */
  toggleVoiceMute(): boolean { return this.voice.toggleMute(); }

  openTrade(npcId: string) {
    this.tradingOpen = true;
    if (typeof (window as any).__openTrade === 'function') {
      (window as any).__openTrade(npcId);
    }
  }

  onSuppliesBought() {
    this.mission.suppliesBought();
    this._notify('Supplies obtained! Return to deliver them.');
    this._updateBeacon();
    this._lastHud = '';
  }

  closeTrade() {
    this.tradingOpen = false;
  }

  /** VoiceIO state flipped → re-push UI; while speaking, keep the NPC
   *  gesturing (idle + one-shot gestures are its honest "talking" animation;
   *  no lip-sync exists and none is claimed). */
  _onVoiceStateChange() {
    if (this.voice.speaking) {
      this._clearTalkingGesture();
      this._talkingGesture = setTimeout(() => {
        if (this.voice.speaking && this.dialogueOpen) this._gestureActiveNpc();
      }, 2500);
    } else {
      this._clearTalkingGesture();
    }
    if (this.dialogueOpen) this._pushDialogue();
  }

  _clearTalkingGesture() {
    if (this._talkingGesture) { clearTimeout(this._talkingGesture); this._talkingGesture = null; }
  }

  _gestureActiveNpc() {
    if (!this.dialogueEngine) return;
    const entry = [...this.npcControllers.values()].find((e) => e.engine === this.dialogueEngine);
    entry?.avatar.gesture();
  }

  _pushDialogueFrom(engine: DialogueEngine) {
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
      voice: {
        phase: this.voice.phase,
        muted: this.voice.muted,
        canReplay: !!this.voice.lastSpoken && this.voice.capability.tts,
      },
    });
  }

  _tick() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._tick());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const playing = this.input.active && !this.dialogueOpen && !this.tradingOpen;

    // --- input & movement ----------------------------------------------------
    if (playing) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.rig.onMouseLook(dx, dy);
    }
    const near = this.interactNearestNpc();
    const action = this._interactAction(near);
    if (this.input.consumeInteract() && action && !this.dialogueOpen) {
      if (action.kind === 'talk' && near) this.beginConversation(near.def);
      else if (action.kind === 'knock_door') {
        const doorNear = this.houseSystem.getNearbyDoor(this.player.root.position);
        if (doorNear) {
          const house = this.houseSystem.houses.get(doorNear.houseId);
          if (house) {
            this._notify('You knock...');
            const result = this.houseSystem.canEnter(house.id);
            setTimeout(() => {
              if (result.allowed) {
                this._notify(`${house.residentId} welcomes you in!`);
                this.houseSystem.enterHouse(house.id);
                this.player.root.position.set(house.position.x, 0, house.position.z);
                // Move resident inside
                const ctrl = this.npcControllers.get(house.residentId);
                if (ctrl) {
                  ctrl.avatar.root.position.set(house.position.x + 1, 0, house.position.z + 1);
                  this.npcInHouse.set(house.residentId, house.id);
                }
              } else {
                this._notify(result.reason || 'Entry refused.');
              }
            }, 800);
          }
        }
      }
      else if (action.kind === 'exit_house') {
        const inside = this.houseSystem.playerInside;
        this.houseSystem.exitHouse();
        this._notify('You exit the house.');
        // Restore resident outside if they were inside
        if (inside) {
          const house = this.houseSystem.houses.get(inside);
          if (house) {
            const ctrl = this.npcControllers.get(house.residentId);
            if (ctrl) {
              // Return to their original spawn or near door
              ctrl.avatar.root.position.set(house.door.worldPos.x, 0, house.door.worldPos.z - 3);
              this.npcInHouse.delete(house.residentId);
            }
          }
        }
      }
      else if (action.kind === 'trade' && near) {
        this.openTrade(near.def.id);
      }
      else if (action.kind === 'pickup') this._pickupCrate();
      else if (action.kind === 'deliver_supplies' && near) {
        // Deliver supplies
        this.mission.suppliesDelivered();
        this._notify('Supplies delivered! Mission complete.');
        this._lastHud = '';
        this.beginConversation(near.def);
      }
      else if (action.kind === 'deliver' && near) {
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
    const allNpcs = Array.from(this.npcControllers.values()).map(c => c.avatar);
    for (const controller of this.npcControllers.values()) {
      const { avatar, behavior, movement } = controller;
      avatar.update(dt);
      const d = avatar.root.position.distanceTo(this.player.root.position);        // Update behavior if available
        if (behavior && movement) {
          const context = {
            distanceToPlayer: d,
            playerNearby: d < 20,
            inRestrictedArea: d < 25 && avatar.root.position.x > 10 && avatar.root.position.z > 10,
            nearOtherNpcs: false,
            timeOfDay: 12,
            hasWitnessedPlayerAction: false,
          };
          behavior.updateState(context);
          // Make decisions periodically
          if (Math.random() < 0.02) { // ~2% chance per frame = ~every 0.5s at 60fps
            const decision = behavior.makeDecision(context);
            if (decision.shouldInitiate && decision.targetAction === 'approach') {
              movement.setTarget(this.player.root.position.clone(), 'approach');
              controller._approaching = true;
            } else if (decision.targetAction === 'avoid') {
              movement.setTarget(null, 'avoid');
              controller._approaching = false;
            } else if (decision.decision === 'GREET' || decision.decision === 'COOPERATE') {
              movement.setTarget(this.player.root.position.clone(), 'approach');
              controller._approaching = true;
            } else {
              movement.setPatrol();
              controller._approaching = false;
            }
          }
          // Auto-initiate dialogue when close and approaching
          if (controller._approaching && d < 3.5 && !this.dialogueOpen) {
            // Check cooldown
            const now = Date.now();
            if (!controller._lastAutoTalk || now - controller._lastAutoTalk > 8000) {
              controller._lastAutoTalk = now;
              this.beginConversation(controller.def);
            }
          }        // Update movement
        movement.update(dt, this.player.root.position, allNpcs, this.collisions);
      } else if (d < 9) {
        avatar.lookAt(this.player.root.position.x, this.player.root.position.z, dt);
      }
    }
    // Handle NPC-NPC conversations
    const controllers = Array.from(this.npcControllers.values());
    for (let i = 0; i < controllers.length; i++) {
      const c1 = controllers[i];
      if (!c1.behavior || c1.behavior.state.inConversation) continue;
      if (c1.behavior.state.socialNeed < 60) continue;
      const now = Date.now();
      if (now - c1.behavior.state.lastConversation < 30000) continue; // 30s cooldown
      for (let j = i + 1; j < controllers.length; j++) {
        const c2 = controllers[j];
        if (!c2.behavior || c2.behavior.state.inConversation) continue;
        if (c2.behavior.state.socialNeed < 60) continue;
        if (now - c2.behavior.state.lastConversation < 30000) continue;
        const d = c1.avatar.root.position.distanceTo(c2.avatar.root.position);
        if (d < 5) {
          // Start conversation
          c1.behavior.state.inConversation = true;
          c1.behavior.state.conversationPartner = c2.def.id;
          c1.behavior.state.lastConversation = now;
          c2.behavior.state.inConversation = true;
          c2.behavior.state.conversationPartner = c1.def.id;
          c2.behavior.state.lastConversation = now;
          // End conversation after 10-20 seconds
          setTimeout(() => {
            if (c1.behavior) {
              c1.behavior.state.inConversation = false;
              c1.behavior.state.conversationPartner = null;
            }
            if (c2.behavior) {
              c2.behavior.state.inConversation = false;
              c2.behavior.state.conversationPartner = null;
            }
          }, 10000 + Math.random() * 10000);
          break;
        }
      }
    }
    // Face conversation partners
    for (const c of controllers) {
      if (c.behavior?.state.inConversation && c.behavior.state.conversationPartner) {
        const partner = this.npcControllers.get(c.behavior.state.conversationPartner);
        if (partner) {
          c.avatar.lookAt(partner.avatar.root.position.x, partner.avatar.root.position.z, 0.1);
        }
      }
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

    // Sun rig follows the player so the tight shadow frustum always covers
    // the action (crisper shadows for the same cost).
    this.sun.position.copy(this.player.root.position).add(this.sunOffset);
    this.sun.target.position.copy(this.player.root.position);
    this.sun.target.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    this._clearTalkingGesture();
    this.voice.stopSpeaking();
    this.voice.onStateChange = null;
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    document.removeEventListener('pointerlockerror', this._onLockError);
    // Remove the canvas too — React Fast Refresh remounts the component and
    // a stale canvas would otherwise stack over the new one (dev artifact).
    this.renderer?.domElement?.remove();
    this.renderer?.dispose();
  }
}
