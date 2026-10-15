import * as THREE from 'three';
import { buildHumanoid } from '../player/player.js';
import { MemoryStore } from './memory.js';

export class NPC {
  constructor(scene, spawn, name = 'Maya') {
    this.name = name;
    this.root = buildHumanoid(0x9a4b3f, 0xd9a37a);
    this.root.position.copy(spawn);
    this.root.rotation.y = Math.PI; // face the player's spawn area
    scene.add(this.root);

    this.limbs = this.root.userData;
    this.memory = new MemoryStore(name.toLowerCase());
    this.idlePhase = Math.random() * Math.PI * 2;
    this._wasGreeted = this.memory.state.events.some((e) => e.type === 'meeting');
  }

  get trust() { return this.memory.trust; }

  get displayName() {
    return this.name;
  }

  /** Turn head/torso toward the player when they are close. */
  lookAtWhileIdle(targetPos, dt) {
    this.idlePhase += dt;
    if (targetPos) {
      const dx = targetPos.x - this.root.position.x;
      const dz = targetPos.z - this.root.position.z;
      const targetYaw = Math.atan2(dx, dz);
      this.root.rotation.y = THREE.MathUtils.lerp(
        this.root.rotation.y,
        targetYaw,
        1 - Math.pow(0.002, dt),
      );
    }
    // Gentle idle sway.
    const sway = Math.sin(this.idlePhase * 1.3) * 0.05;
    this.limbs.armL.rotation.x = sway;
    this.limbs.armR.rotation.x = -sway;
    this.limbs.head.rotation.z = Math.sin(this.idlePhase * 0.7) * 0.04;
  }

  /** Called when a conversation starts or per exchange; records memory. */
  onConversationStart() {
    if (!this._wasGreeted) {
      this._wasGreeted = true;
      this.memory.addEvent('meeting', `Player met ${this.name} for the first time.`, 2);
    } else {
      this.memory.addEvent('conversation', `Player spoke with ${this.name} again.`, 1);
    }
  }
}
