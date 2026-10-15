import * as THREE from 'three';

/**
 * NPC built from a REAL rigged GLB. Plays its idle clip on loop forever and,
 * where the asset provides one (Xbot: agree / headShake), can play one-shot
 * gesture animations during conversations. No static mannequin stand-ins.
 */
export class NPCAvatar {
  constructor(loader, { modelKey, idleClip, gestureClips = [], scale = 1, tint = null }) {
    const source = loader.instantiate(modelKey);
    this.root = source;
    this.root.scale.setScalar(scale);
    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // Optional per-NPC tint (Victor vs Maya share Xbot.glb): clone materials
    // first so the shared source GLB and other instances stay untouched, and
    // tint only the darker garments — skin tones stay natural.
    if (tint != null) {
      const tintColor = new THREE.Color(tint);
      const hsl = {};
      const tintable = (m) => {
        if (!m.color) return false;
        m.color.getHSL(hsl, THREE.SRGBColorSpace);
        return hsl.l < 0.62; // bright materials are skin/eyes — leave them be
      };
      const apply = (m) => {
        const c = m.clone();
        if (tintable(c)) c.color.lerp(tintColor, 0.6);
        return c;
      };
      this.root.traverse((o) => {
        if (o.isMesh && o.material) {
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
      .filter(Boolean);

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

  update(dt) {
    this.mixer.update(dt);
    this._t += dt;
  }

  lookAt(x2, z2, dt) {
    const yaw = Math.atan2(x2 - this.root.position.x, z2 - this.root.position.z);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    this.root.quaternion.slerp(q, 1 - Math.pow(0.004, dt));
  }
}
