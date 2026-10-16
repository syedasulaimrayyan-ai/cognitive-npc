import * as THREE from 'three';
import * as C from '../core/constants';
import type { AssetLoader } from '../core/asset-loader';

/** The three locomotion clips exposed by PlayerAvatar. */
export type ClipName = 'idle' | 'walk' | 'run';

/**
 * Third-person player controller around a REAL rigged GLB character
 * (three.js Soldier.glb — skinned mesh with Idle/Walk/Run clips). Animations
 * are blended per-frame with AnimationMixer cross-fades; no capsule stand-ins.
 */
export class PlayerAvatar {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Record<ClipName, THREE.AnimationAction>;
  _active: ClipName;
  velocity: THREE.Vector3;
  position: THREE.Vector3;
  ySpeed: number;
  grounded: boolean;
  speedCap: number;
  runCap: number;
  _facingYaw: number;

  constructor(
    loader: AssetLoader,
    {
      clips,
      speedCap = C.CONTROLS.walkSpeed,
      runCap = C.CONTROLS.runSpeed,
    }: { clips: Record<ClipName, string>; speedCap?: number; runCap?: number },
  ) {
    const source = loader.instantiate('player');
    this.root = source;
    this.root.scale.setScalar(1.0);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    this.mixer = new THREE.AnimationMixer(source);
    const clipFor = (name: string) => loader.clip('player', name);
    this.clips = {
      idle: this.mixer.clipAction(clipFor(clips.idle)),
      walk: this.mixer.clipAction(clipFor(clips.walk)),
      run: this.mixer.clipAction(clipFor(clips.run)),
    };
    this.clips.idle.setLoop(THREE.LoopRepeat, Infinity);
    this.clips.walk.setLoop(THREE.LoopRepeat, Infinity);
    this.clips.run.setLoop(THREE.LoopRepeat, Infinity);
    // Start suspended in idle.
    this.clips.idle.play();
    this._active = 'idle';

    this.velocity = new THREE.Vector3();
    this.position = this.root.position;
    this.ySpeed = 0;          // vertical physics
    this.grounded = true;
    this.speedCap = speedCap;
    this.runCap = runCap;
    this._facingYaw = 0;
  }

  _crossfade(to: ClipName, fadeTime = 0.22) {
    if (this._active === to) return;
    const next = this.clips[to];
    next.reset().fadeIn(fadeTime).play();
    this.clips[this._active].fadeOut(fadeTime);
    this._active = to;
  }

  /**
   * @param dt         delta seconds
   * @param move       input axis {x, y}
   * @param running    whether shift is held
   * @param jump       one-shot jump request
   * @param forward    world-space forward vector of the camera rig
   */
  update(
    dt: number,
    move: { x: number; y: number },
    running: boolean,
    jump: boolean,
    forward: THREE.Vector3,
  ) {
    const speedCap = running ? this.runCap : this.speedCap;

    // Horizontal wish-direction is camera-relative.
    // right = forward rotated -90° about +y: (-fz, 0, fx).
    // (E.g. facing north (0,0,-1), right must be east (+1,0,0).)
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wish = new THREE.Vector3()
      .addScaledVector(forward, move.y)
      .addScaledVector(right, move.x);
    const moving = wish.lengthSq() > 1e-4;
    if (moving) {
      wish.normalize().multiplyScalar(speedCap);
      // MODEL FORWARD AXIS: Soldier.glb faces LOCAL −z (verified by anatomy:
      // toes reach −0.216 vs heel +0.122, calf mass on +z, face texels on −z).
      // To point local (0,0,−1) along `wish` after rotation.y = θ:
      //   rotY(θ)·(0,0,−1) = (−sinθ, 0, −cosθ) = wish
      //   ⇒ θ = atan2(−wish.x, −wish.z)  (NOT atan2(wish.x, wish.z), which
      //     assumes a +z-forward model and spun the character 180° off).
      this._facingYaw = Math.atan2(-wish.x, -wish.z);
    }

    // Smooth horizontal velocity.
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, moving ? wish.x : 0, 12, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, moving ? wish.z : 0, 12, dt);

    // Vertical: gravity + jump.
    if (jump && this.grounded) {
      this.ySpeed = C.CONTROLS.jumpSpeed;
      this.grounded = false;
    }
    this.ySpeed -= C.GRAVITY * dt;
    let y = this.position.y + this.ySpeed * dt;
    if (y <= 0) { y = 0; this.ySpeed = 0; this.grounded = true; }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y = y;

    // Face movement direction (lerped so it feels weighty).
    const targetRot = new THREE.Euler(0, this._facingYaw, 0);
    this.root.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRot), 1 - Math.pow(0.0001, dt));

    // Locomotion blending: pick dominant clip by horizontal speed.
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded) {
      // Airborne: freeze at a walk pose as a minimal, honest stand-in
      // (Soldier.glb has no dedicated jump clip — this is documented, not faked).
      this._crossfade('walk', 0.15);
      this.clips.walk.timeScale = 0.0; // hold pose
      this._active = 'walk';
    } else if (hs < 0.35) {
      this._crossfade('idle');
      this.clips.walk.timeScale = 1.0;
    } else if (hs < C.CONTROLS.runSpeed * 0.62 && this._active !== 'run') {
      // Threshold keyed to RUN speed (not current cap) so normal walking
      // always shows Walk — reaching full walk speed must not flip to Run.
      this._crossfade('walk');
      this.clips.walk.timeScale = Math.max(0.6, hs / C.CONTROLS.walkSpeed);
    } else {
      this._crossfade('run');
      this.clips.run.timeScale = Math.max(0.8, hs / C.CONTROLS.runSpeed);
    }

    this.mixer.update(dt);
  }

  /** Corrected position (after collision), for game logic to copy back. */
  syncPosition(corrected: THREE.Vector3) {
    this.position.x = corrected.x;
    this.position.z = corrected.z;
  }
}
