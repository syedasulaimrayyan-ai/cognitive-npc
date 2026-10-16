import * as THREE from 'three';
import { WAYPOINTS } from '../core/constants';
import type { CollisionGrid } from '../core/collision';
import type { NPCAvatar } from './npc-avatar';

export interface NpcMovementState {
  currentWaypoint: number;
  target: THREE.Vector3 | null;
  velocity: THREE.Vector3;
  speed: number;
  maxSpeed: number;
  state: 'patrol' | 'approach' | 'avoid' | 'wait' | 'idle';
}

export class NpcMovement {
  avatar: NPCAvatar;
  state: NpcMovementState;
  waypoints: { x: number, z: number }[];
  radius: number = 0.5;

  constructor(avatar: NPCAvatar, startPos: { x: number, z: number }) {
    this.avatar = avatar;
    this.waypoints = [...WAYPOINTS];
    // Shuffle slightly for variation
    this.waypoints.sort(() => Math.random() - 0.5);
    this.state = {
      currentWaypoint: this.findNearestWaypoint(startPos),
      target: null,
      velocity: new THREE.Vector3(),
      speed: 0,
      maxSpeed: 2.5,
      state: 'patrol',
    };
  }

  findNearestWaypoint(pos: { x: number, z: number }): number {
    let minDist = Infinity;
    let idx = 0;
    this.waypoints.forEach((wp, i) => {
      const d = Math.hypot(wp.x - pos.x, wp.z - pos.z);
      if (d < minDist) {
        minDist = d;
        idx = i;
      }
    });
    return idx;
  }

  getCurrentTarget(): THREE.Vector3 {
    const wp = this.waypoints[this.state.currentWaypoint];
    return new THREE.Vector3(wp.x, 0, wp.z);
  }

  update(dt: number, playerPos: THREE.Vector3, otherNpcs: NPCAvatar[], collisions: CollisionGrid) {
    const pos = this.avatar.root.position;
    
    // Steering behavior
    const desired = new THREE.Vector3();
    const steer = new THREE.Vector3();
    
    if (this.state.state === 'patrol') {
      const target = this.getCurrentTarget();
      const dist = pos.distanceTo(target);
      if (dist < 2) {
        // Move to next waypoint
        this.state.currentWaypoint = (this.state.currentWaypoint + 1) % this.waypoints.length;
      }
      desired.subVectors(target, pos).normalize().multiplyScalar(this.state.maxSpeed);
    } else if (this.state.state === 'approach' && this.state.target) {
      const dist = pos.distanceTo(this.state.target);
      if (dist > 1.5) {
        desired.subVectors(this.state.target, pos).normalize().multiplyScalar(this.state.maxSpeed);
      } else {
        desired.set(0, 0, 0);
      }
    } else if (this.state.state === 'avoid') {
      const away = new THREE.Vector3().subVectors(pos, playerPos).normalize();
      desired.copy(away).multiplyScalar(this.state.maxSpeed * 1.2);
    } else {
      desired.set(0, 0, 0);
    }
    
    // Separation - avoid other NPCs
    const separation = new THREE.Vector3();
    let neighbors = 0;
    for (const npc of otherNpcs) {
      if (npc === this.avatar) continue;
      const d = pos.distanceTo(npc.root.position);
      if (d > 0 && d < 2.0) {
        const diff = new THREE.Vector3().subVectors(pos, npc.root.position).normalize();
        separation.add(diff.divideScalar(d));
        neighbors++;
      }
    }
    if (neighbors > 0) {
      separation.divideScalar(neighbors).normalize().multiplyScalar(this.state.maxSpeed * 1.5);
      desired.add(separation);
    }
    
    steer.subVectors(desired, this.state.velocity);
    steer.clampLength(0, this.state.maxSpeed * 0.3);
    this.state.velocity.add(steer.multiplyScalar(dt * 5));
    this.state.velocity.clampLength(0, this.state.maxSpeed);
    
    if (this.state.velocity.length() > 0.01) {
      pos.add(this.state.velocity.clone().multiplyScalar(dt));
      this.avatar.lookAt(pos.x + this.state.velocity.x, pos.z + this.state.velocity.z, dt);
      collisions.resolve(pos, this.radius);
    }
  }

  setTarget(target: THREE.Vector3 | null, state: NpcMovementState['state']) {
    this.state.target = target;
    this.state.state = state;
  }

  setPatrol() {
    this.state.target = null;
    this.state.state = 'patrol';
  }
}
