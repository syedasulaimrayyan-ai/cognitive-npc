import * as THREE from 'three';
import type { AssetLoader } from '../core/asset-loader';

/**
 * NPC built from a REAL rigged GLB. Plays its idle clip on loop forever and,
 * where the asset provides one (Xbot: agree / headShake), can play one-shot
 * gesture animations during conversations. No static mannequin stand-ins.
 */
export class NPCAvatar {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  gestures: THREE.AnimationAction[];
  _t: number;

  constructor(
    loader: AssetLoader,
    {
      modelKey,
      idleClip,
      gestureClips = [],
      scale = 1,
      tint = null,
    }: {
      modelKey: string;
      idleClip: string;
      gestureClips?: string[];
      scale?: number;
      tint?: string | number | null;
    },
  ) {
    const source = loader.instantiate(modelKey);
    this.root = source;
    this.root.scale.setScalar(scale);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // Optional per-NPC tint (Victor vs Maya share Xbot.glb): clone materials
    // first so the shared source GLB and other instances stay untouched, and
    // tint only the darker garments — skin tones stay natural.
    if (tint != null) {
      const tintColor = new THREE.Color(tint);
      const hsl = { h: 0, s: 0, l: 0 };
      const tintable = (m: THREE.Material) => {
        const color = (m as THREE.MeshStandardMaterial).color;
        if (!color) return false;
        color.getHSL(hsl, THREE.SRGBColorSpace);
        return hsl.l < 0.62; // bright materials are skin/eyes — leave them be
      };
      const apply = (m: THREE.Material) => {
        const c = m.clone();
        if (tintable(c)) (c as THREE.MeshStandardMaterial).color.lerp(tintColor, 0.6);
        return c;
      };
      this.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material) {
          o.material = Array.isArray(o.material) ? o.material.map(apply) : apply(o.material);
        }
      });
    }

    this.mixer = new THREE.AnimationMixer(source);
    this.idle = this.mixer.clipAction(loader.clip(modelKey, idleClip));
    this.idle.setLoop(THREE.LoopRepeat, Infinity);
    this.idle.play();

    this.gestures = gestureClips
      .map((name) => {
        try {
          const a = this.mixer.clipAction(loader.clip(modelKey, name));
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          return a;
        } catch { return null; } // optional clip — skip if absent
      })
      .filter((a): a is THREE.AnimationAction => a !== null);

    // Gentle idle head sway (subtle secondary motion on the real skeleton via
    // mixer-controlled additive tweak, kept tiny and optional).
    this._t = Math.random() * 10;
  }

  /** Fire a random gesture; returns true if one actually started. */
  gesture() {
    if (!this.gestures.length) return false;
    const g = this.gestures[Math.floor(Math.random() * this.gestures.length)];
    g.reset().play();
    return true;
  }

  update(dt: number) {
    this.mixer.update(dt);
    this._t += dt;
  }

  lookAt(x2: number, z2: number, dt: number) {
    const yaw = Math.atan2(x2 - this.root.position.x, z2 - this.root.position.z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    this.root.quaternion.slerp(q, 1 - Math.pow(0.004, dt));
  }
}
