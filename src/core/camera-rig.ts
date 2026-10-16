import * as THREE from 'three';

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw: number;
  pitch: number;
  distance: number;
  target: THREE.Vector3;
  _desired: THREE.Vector3;
  _lerpRate: number;
  _ray?: THREE.Ray;
  _hit?: THREE.Vector3;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.yaw = Math.PI;           // behind the player at spawn
    this.pitch = 0.35;
    this.distance = 5.2;
    this.target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lerpRate = 14;
  }

  onMouseLook(dx: number, dy: number) {
    this.yaw -= dx * 0.0024;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.35, 1.25);
  }

  /** Where the player is facing (world-space forward, ground-plane only). */
  forwardVec() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /**
   * @param clearOfBoxes THREE.Box3[] static blockers (buildings, trees, lamps,
   *   fountain). The camera pulls in when one sits between the head and the
   *   desired orbit position, so it never ends up inside a wall.
   */
  update(targetPos: THREE.Vector3, dt: number, clearOfBoxes: THREE.Box3[] = []) {
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
    // Pull the camera in if any blocker intersects head → camera ray.
    if (clearOfBoxes.length) {
      const dir = desiredPos.clone().sub(this.target);
      const len = dir.length();
      if (len > 1e-4) {
        dir.multiplyScalar(1 / len);
        const ray = this._ray ?? (this._ray = new THREE.Ray());
        ray.origin.copy(this.target);
        ray.direction.copy(dir);
        const hit = this._hit ?? (this._hit = new THREE.Vector3());
        for (const box of clearOfBoxes) {
          if (!ray.intersectBox(box, hit)) continue;
          const dist = hit.distanceTo(this.target);
          if (dist < len && dist < d) {
            desiredPos.copy(this.target).addScaledVector(dir, Math.max(1.2, dist - 0.35));
            break;
          }
        }
      }
    }
    this.camera.position.lerp(desiredPos, 1 - Math.pow(0.0008, dt));
    this.camera.lookAt(this.target);
  }
}
