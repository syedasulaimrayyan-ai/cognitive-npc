import * as THREE from 'three';

/** Simple articulated humanoid built from primitives (no external assets). */
export function buildHumanoid(bodyColor = 0x3f5f8a, skinColor = 0xd9a37a) {
  const g = new THREE.Group();
  const mats = {
    body: new THREE.MeshLambertMaterial({ color: bodyColor }),
    skin: new THREE.MeshLambertMaterial({ color: skinColor }),
    dark: new THREE.MeshLambertMaterial({ color: 0x2a2a2e }),
  };

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), mats.body);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), mats.skin);
  head.position.y = 1.72;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.08, 12), mats.dark);
  hat.position.y = 1.87;

  const armGeo = new THREE.CapsuleGeometry(0.08, 0.42, 4, 6);
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.42, 4, 6);

  const armL = new THREE.Group(), armR = new THREE.Group();
  const legL = new THREE.Group(), legR = new THREE.Group();
  armL.position.set(-0.34, 1.5, 0); armR.position.set(0.34, 1.5, 0);
  legL.position.set(-0.13, 0.78, 0); legR.position.set(0.13, 0.78, 0);

  const armLMesh = new THREE.Mesh(armGeo, mats.body);
  const armRMesh = new THREE.Mesh(armGeo, mats.body);
  const legLMesh = new THREE.Mesh(legGeo, mats.dark);
  const legRMesh = new THREE.Mesh(legGeo, mats.dark);
  armLMesh.position.y = armRMesh.position.y = -0.28;
  legLMesh.position.y = legRMesh.position.y = -0.28;
  armL.add(armLMesh); armR.add(armRMesh); legL.add(legLMesh); legR.add(legRMesh);

  for (const part of [torso, head]) part.castShadow = true;
  g.add(torso, head, hat, armL, armR, legL, legR);
  g.userData = { armL, armR, legL, legR, head };
  return g;
}

/** First-principles input: keys pressed + mouse deltas. */
class PlayerInput {
  constructor() {
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  reset() { this.keys.clear(); }
  moveVector() {
    const v = new THREE.Vector2();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.x += 1;
    return v;
  }
  running() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
}

export class CameraControls {
  constructor() {
    this.yaw = 0;              // spawn facing the town center / NPC plaza
    this.pitch = 0.32;
    this.distance = 5.5;
    this.height = 1.9;
  }
  onMouseMove(dx, dy) {
    this.yaw -= dx * 0.0026;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0022, -0.15, 1.15);
  }
  forwardDirection() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
  }
  updateCamera(camera, target, dt) {
    // Orbit position behind the head anchor.
    const dist = this.distance * (0.8 + this.pitch * 0.35);
    const x = Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    const z = Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    const y = Math.sin(this.pitch) * dist;
    camera.position.lerp(new THREE.Vector3(target.x + x, target.y + y, target.z + z), 1 - Math.pow(0.0015, dt));
    camera.lookAt(target.x, target.y - 0.15, target.z);
  }
}

export class Player {
  constructor(scene, spawn) {
    this.group = buildHumanoid(0x3f5f8a, 0xe0b48c);
    this.group.position.copy(spawn);
    scene.add(this.group);

    this.input = new PlayerInput();
    this.cameraControls = new CameraControls();
    this.velocity = new THREE.Vector3();
    this.walkPhase = 0;
    this.speedCap = 4.2;

    this._headAnchor = new THREE.Vector3();
    // Kick the player toward the town square.
    this.group.rotation.y = Math.PI;
  }

  headAnchor() {
    this._headAnchor.copy(this.group.position);
    this._headAnchor.y += 1.5;
    return this._headAnchor;
  }

  update(dt, hasControl) {
    const limbs = this.group.userData;
    let moving = false;

    if (hasControl) {
      const dir = this.input.moveVector();
      if (dir.lengthSq() > 0) {
        dir.normalize();
        const fwd = this.cameraControls.forwardDirection();
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        const wish = new THREE.Vector3()
          .addScaledVector(fwd, dir.y)
          .addScaledVector(right, dir.x);
        wish.normalize();
        const speed = (this.input.running() ? 7 : this.speedCap);
        this.velocity.lerp(wish.multiplyScalar(speed), 1 - Math.pow(0.001, dt));
        moving = true;
        // Face the movement direction.
        const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
        this.group.rotation.y = targetYaw;
      }
    }
    this.velocity.multiplyScalar(Math.pow(0.0005, dt)); // friction
    this.group.position.addScaledVector(this.velocity, dt);

    // Soft world bounds.
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -95, 95);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -95, 95);

    // Walk-cycle limb swing.
    if (moving) {
      const runFactor = this.input.running() ? 1.6 : 1;
      this.walkPhase += dt * 6.5 * runFactor;
    } else {
      this.walkPhase = THREE.MathUtils.lerp(this.walkPhase, Math.round(this.walkPhase / Math.PI) * Math.PI, 1 - Math.pow(0.002, dt));
    }
    const amp = moving ? (this.input.running() ? 0.95 : 0.6) : 0.04;
    const s = Math.sin(this.walkPhase);
    limbs.armL.rotation.x = s * amp;
    limbs.armR.rotation.x = -s * amp;
    limbs.legL.rotation.x = -s * amp;
    limbs.legR.rotation.x = s * amp;
    limbs.head.rotation.z = Math.cos(this.walkPhase * 2) * amp * 0.06;
  }
}
