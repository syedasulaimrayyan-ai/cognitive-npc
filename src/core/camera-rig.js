import * as THREE from 'three';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;           // behind the player at spawn
    this.pitch = 0.35;
    this.distance = 5.2;
    this.target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lerpRate = 14;
  }

  onMouseLook(dx, dy) {
    this.yaw -= dx * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.35, 1.25);
  }

  /** Where the player is facing (world-space forward, ground-plane only). */
  forwardVec() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(targetPos, dt, clearOfGeoms = []) {
    this.target.lerp(
      this._desired.set(targetPos.x, targetPos.y + 1.55, targetPos.z),
      1 - Math.pow(0.0002, dt),
    );
    const d = this.distance * (0.7 + this.pitch * 0.4);
    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cp * d,
      Math.sin(this.pitch) * d + 0.3,
      Math.cos(this.yaw) * cp * d,
    );
    const desiredPos = this.target.clone().add(offset);
    // Pull the camera in if any geometry raycast hits between head/target.
    for (const g of clearOfGeoms) {
      const dir = desiredPos.clone().sub(this.target).normalize();
      const ray = new THREE.Ray(this.target, dir);
      const hit = ray.intersectBox(new THREE.Box3().setFromObject(g), new THREE.Vector3());
      if (hit) {
        const dist = hit.distanceTo(this.target);
        if (dist < d) {
          desiredPos.copy(this.target).addScaledVector(dir, Math.max(1.2, dist - 0.35));
        }
      }
    }
    this.camera.position.lerp(desiredPos, 1 - Math.pow(0.0008, dt));
    this.camera.lookAt(this.target);
  }
}
