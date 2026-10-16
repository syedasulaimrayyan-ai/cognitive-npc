import * as THREE from 'three';
import * as C from './constants';

/**
 * Uniform-grid of static AABBs. The player is treated as a horizontal circle
 * (radius ~0.4) at ground level; walls/props push them out with a simple
 * slide response. Flat 2D, no vertical resolution needed (no climbable props).
 */
/** Plain-array AABB (x/y/z triples), the shape every static collider uses. */
export interface AABB {
  min: number[];
  max: number[];
}

export class CollisionGrid {
  size: number;
  cell: number;
  grid: Map<string, AABB[]>;
  boxes: AABB[];

  constructor(size = 200, cell = 2.2) {
    this.size = size;
    this.cell = cell;
    this.grid = new Map(); // "cx,cz" -> AABB[]
    this.boxes = [];
  }

  add(box: AABB) {
    this.boxes.push(box);
    const [x0, , z0] = box.min;
    const [x1, , z1] = box.max;
    for (let cx = Math.floor((x0 + this.size) / this.cell); cx <= Math.floor((x1 + this.size) / this.cell); cx++) {
      for (let cz = Math.floor((z0 + this.size) / this.cell); cz <= Math.floor((z1 + this.size) / this.cell); cz++) {
        const k = cx + ',' + cz;
        let cellBoxes = this.grid.get(k);
        if (!cellBoxes) { cellBoxes = []; this.grid.set(k, cellBoxes); }
        cellBoxes.push(box);
      }
    }
  }

  /**
   * Resolve a circle-vs-world overlap for position (x, z). Mutates nothing,
   * returns the corrected position vector.
   */
  resolve(pos: THREE.Vector3, radius = 0.42) {
    let x = pos.x, z = pos.z;
    const cx = Math.floor((x + this.size) / this.cell);
    const cz = Math.floor((z + this.size) / this.cell);
    // Push out of every nearby box (2 iterations handles corners).
    for (let iter = 0; iter < 2; iter++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const cell = this.grid.get((cx + ox) + ',' + (cz + oz));
          if (!cell) continue;
          for (const b of cell) {
            const nx = Math.max(b.min[0], Math.min(x, b.max[0]));
            const nz = Math.max(b.min[2], Math.min(z, b.max[2]));
            const dx = x - nx, dz = z - nz;
            const d2 = dx * dx + dz * dz;
            if (d2 < radius * radius) {
              if (d2 > 1e-6) {
                const d = Math.sqrt(d2);
                x = nx + (dx / d) * radius;
                z = nz + (dz / d) * radius;
              } else {
                // Dead centre: nudge towards nearest face.
                const toMin = x - (b.min[0] - radius);
                const toMax = (b.max[0] + radius) - x;
                const toMinZ = z - (b.min[2] - radius);
                const toMaxZ = (b.max[2] + radius) - z;
                const m = Math.min(toMin, toMax, toMinZ, toMaxZ);
                if (m === toMin) x = b.min[0] - radius;
                else if (m === toMax) x = b.max[0] + radius;
                else if (m === toMinZ) z = b.min[2] - radius;
                else z = b.max[2] + radius;
              }
            }
          }
        }
      }
    }
    pos.x = THREE.MathUtils.clamp(x, -C.WORLD_BOUNDS, C.WORLD_BOUNDS);
    pos.z = THREE.MathUtils.clamp(z, -C.WORLD_BOUNDS, C.WORLD_BOUNDS);
    return pos;
  }
}
