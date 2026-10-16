import * as THREE from 'three';
import type { AABB } from '../core/collision';

export interface Door {
  worldPos: THREE.Vector3;
  open: boolean;
  targetInterior: string;
  requiresPermission: boolean;
}

export interface House {
  id: string;
  name: string;
  position: { x: number, z: number };
  size: { w: number, d: number, h: number };
  door: Door;
  interiorGroup: THREE.Group;
  exteriorColliders: AABB[];
  interiorColliders: AABB[];
  residentId: string;
  doorOpen: boolean;
}

export class HouseSystem {
  houses: Map<string, House> = new Map();
  scene: THREE.Scene;
  playerInside: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  static buildHouse(def: any, scene: THREE.Scene): House {
    const interior = new THREE.Group();
    // Interior floor
    const floorMat = new THREE.MeshStandardMaterial({ color: def.id === 'house1' ? 0x8b7355 : def.id === 'house2' ? 0x6b8b6b : 0x8b7b6b });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
    floor.rotation.x = -Math.PI / 2;
    interior.add(floor);
    // Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
    const wall1 = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.2), wallMat);
    wall1.position.set(0, 1.5, -4);
    interior.add(wall1);
    // Lighting
    const light = new THREE.PointLight(0xfff4e6, 0.6, 10);
    light.position.set(0, 2.5, 0);
    interior.add(light);
    // Furniture - varied per house
    if (def.id === 'house1') {
      const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 1.2), new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
      table.position.set(2, 0.4, 2);
      interior.add(table);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 1.5), new THREE.MeshStandardMaterial({ color: 0x4682b4 }));
      bed.position.set(-2.5, 0.2, -2);
      interior.add(bed);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 1.5), new THREE.MeshStandardMaterial({ color: 0x654321 }));
      shelf.position.set(3.8, 1, -1);
      interior.add(shelf);
    } else if (def.id === 'house2') {
      const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1), new THREE.MeshStandardMaterial({ color: 0x6f4e37 }));
      table.position.set(-2, 0.35, 2);
      interior.add(table);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.4), new THREE.MeshStandardMaterial({ color: 0x556b2f }));
      bed.position.set(2.5, 0.175, -2);
      interior.add(bed);
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshStandardMaterial({ color: 0x8b7355 }));
      chair.position.set(-1, 0.5, 2.8);
      interior.add(chair);
    } else {
      const table = new THREE.Mesh(new THREE.BoxGeometry(2, 0.75, 1.3), new THREE.MeshStandardMaterial({ color: 0x5c4033 }));
      table.position.set(0, 0.375, 2);
      interior.add(table);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.32, 1.3), new THREE.MeshStandardMaterial({ color: 0x708090 }));
      bed.position.set(0, 0.16, -2.5);
      interior.add(bed);
      const books = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x8b0000 }));
      books.position.set(3, 0.25, 2.5);
      interior.add(books);
    }
    interior.position.set(def.position.x, 0, def.position.z);
    scene.add(interior);
    interior.visible = false;
    return {
      id: def.id,
      name: def.name || def.id,
      position: def.position,
      size: { w: 8, d: 8, h: 3 },
      door: { worldPos: new THREE.Vector3(def.doorPos.x, 0, def.doorPos.z), open: false, targetInterior: def.id, requiresPermission: true },
      interiorGroup: interior,
      exteriorColliders: [{ min: [def.position.x - 4, 0, def.position.z - 4], max: [def.position.x + 4, 3, def.position.z + 4] }],
      interiorColliders: [{ min: [def.position.x - 4, 0, def.position.z - 4], max: [def.position.x + 4, 2, def.position.z + 4] }],
      residentId: def.residentId,
      doorOpen: false,
    };
  }

  addHouse(house: House) {
    this.houses.set(house.id, house);
    if (!this.scene.children.includes(house.interiorGroup)) {
      this.scene.add(house.interiorGroup);
    }
    house.interiorGroup.visible = false;
  }

  getNearbyDoor(pos: THREE.Vector3): { houseId: string, door: Door, distance: number } | null {
    for (const [id, house] of this.houses) {
      const d = pos.distanceTo(house.door.worldPos);
      if (d < 3) {
        return { houseId: id, door: house.door, distance: d };
      }
    }
    return null;
  }

  canEnter(houseId: string, _context?: any): { allowed: boolean; reason?: string } {
    const house = this.houses.get(houseId);
    if (!house) return { allowed: false, reason: 'House not found' };
    // Simple permission logic - can be enhanced with trust/memory
    // For leela, kabir, sana - be welcoming but consider context
    const rnd = Math.random();
    if (rnd < 0.7) {
      return { allowed: true };
    } else if (rnd < 0.85) {
      return { allowed: false, reason: 'I am busy right now, please return later.' };
    } else {
      return { allowed: false, reason: 'I need to know why you are here first.' };
    }
  }

  enterHouse(houseId: string) {
    const house = this.houses.get(houseId);
    if (!house) return;
    house.doorOpen = true;
    house.interiorGroup.visible = true;
    this.playerInside = houseId;
  }

  exitHouse() {
    if (!this.playerInside) return;
    const house = this.houses.get(this.playerInside);
    if (house) {
      house.interiorGroup.visible = false;
      house.doorOpen = false;
    }
    this.playerInside = null;
  }

  isInside(): string | null {
    return this.playerInside;
  }
}
