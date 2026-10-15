import * as THREE from 'three';
import * as C from '../core/constants';

/**
 * Mission-specific set dressing for "THE MISSING SUPPLY":
 *  - the crate itself (the quest objective, wood-plank PBR)
 *  - the old storehouse it hides behind (east side of the main street)
 *  - market stalls (Maya's stall + neighbours) so "the market" is real
 *  - a welcome arch at the south entrance where the player spawns
 *  - a soft objective beacon (cylinder + up-arrow) pointing at the current goal
 *
 * All textures are the same CC0 Poly Haven set already loaded by AssetLoader
 * (wood_planks was added for the crate). Returns colliders for the grid and
 * exposes `setBeacon(target)` / `updateBeacon(dt)` for the objective marker.
 */

// --- shared materials (built once per environment build) --------------------
function makeMats(loader) {
  const wood = loader.texture('wood').clone();
  wood.needsUpdate = true;
  wood.repeat.set(2, 2);
  const woodNormal = loader.texture('wood_normal').clone();
  woodNormal.needsUpdate = true;
  woodNormal.repeat.set(2, 2);
  const woodRough = loader.texture('wood_rough').clone();
  woodRough.needsUpdate = true;
  woodRough.repeat.set(2, 2);

  const plaster = loader.texture('plaster').clone();
  plaster.needsUpdate = true;
  plaster.repeat.set(3, 1.5);

  const concrete = loader.texture('concrete').clone();
  concrete.needsUpdate = true;
  concrete.repeat.set(2, 2);

  return {
    wood: new THREE.MeshStandardMaterial({
      map: wood, normalMap: woodNormal, roughnessMap: woodRough, roughness: 0.9, metalness: 0,
    }),
    woodDark: new THREE.MeshStandardMaterial({
      map: wood, normalMap: woodNormal, color: 0x9a7a55, roughness: 0.95, metalness: 0,
    }),
    plaster: new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 1 }),
    roofMat: new THREE.MeshStandardMaterial({ color: 0x4d453c, roughness: 1 }),
    doorBlue: new THREE.MeshStandardMaterial({ color: 0x2f5f86, roughness: 0.6, metalness: 0.1 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0xc4553d, roughness: 0.85, side: THREE.DoubleSide }),
    canvasAlt: new THREE.MeshStandardMaterial({ color: 0x3f7a6a, roughness: 0.85, side: THREE.DoubleSide }),
    crate: new THREE.MeshStandardMaterial({
      map: wood, normalMap: woodNormal, roughnessMap: woodRough, color: 0xd8b98a, roughness: 0.85,
    }),
  };
}

/** A shipping crate body with two slats — call sites assign the material. */
function buildCrate(w = 0.95) {
  const body = new THREE.BoxGeometry(w, w * 0.82, w * 0.9);
  const slat = new THREE.BoxGeometry(w * 1.02, w * 0.09, w * 0.92);
  const geos = [body, slat, slat.clone()];
  return geos;
}

/**
 * Build all mission props into `scene`.
 * @returns {{ colliders: object[], beacon: Beacon }}
 */
export function buildMissionProps(scene, loader) {
  const mats = makeMats(loader);
  const colliders = [];

  // ---- The old storehouse ---------------------------------------------------
  const S = C.STOREHOUSE;
  const store = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(S.w, S.h, S.d), mats.plaster);
  body.position.y = S.h / 2;
  body.castShadow = body.receiveShadow = true;
  store.add(body);
  // pitched roof (two slabs)
  const roofA = new THREE.Mesh(new THREE.BoxGeometry(S.w + 0.7, 0.24, S.d * 0.62), mats.roofMat);
  roofA.position.set(0, S.h + 0.62, -S.d * 0.22);
  roofA.rotation.x = 0.42;
  const roofB = roofA.clone();
  roofB.position.z = S.d * 0.22;
  roofB.rotation.x = -0.42;
  store.add(roofA, roofB);
  // the famous blue door (faces the street, west side)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 1.5), mats.doorBlue);
  door.position.set(-S.w / 2 - 0.05, 1.15, 0);
  store.add(door);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.5, 1.8), mats.frame);
  frame.position.set(-S.w / 2 - 0.02, 1.25, 0);
  store.add(frame);
  store.position.set(S.x, 0, S.z);
  scene.add(store);
  colliders.push({
    min: [S.x - S.w / 2 - 0.25, 0, S.z - S.d / 2 - 0.25],
    max: [S.x + S.w / 2 + 0.25, S.h + 1, S.z + S.d / 2 + 0.25],
  });

  // ---- Market stalls (west side, the "market") ------------------------------
  const stalls = [
    { x: -8.5, z: 2, alt: false, crates: true },   // Maya's stall
    { x: -8.5, z: 6.5, alt: true, crates: true },
    { x: -8.5, z: -2.5, alt: true, crates: false },
    { x: -12.5, z: 2, alt: false, crates: false },
  ];
  for (const s of stalls) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.6), mats.woodDark);
    top.position.y = 0.92;
    top.castShadow = top.receiveShadow = true;
    g.add(top);
    for (const [px, pz] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.92, 0.12), mats.frame);
      leg.position.set(px, 0.46, pz);
      g.add(leg);
    }
    // striped canopy: a slightly-angled slab, two-tone
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 2.1), s.alt ? mats.canvasAlt : mats.canvas);
    canopy.position.y = 2.35;
    canopy.rotation.x = 0.12;
    canopy.castShadow = true;
    g.add(canopy);
    for (const [px, pz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), mats.frame);
      pole.position.set(px, 1.2, pz);
      g.add(pole);
    }
    if (s.crates) {
      // a couple of static supply crates under the counter (NOT the missing one)
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.65, 0.7), mats.wood);
      c1.position.set(-0.9, 0.33, 0.35);
      c1.castShadow = c1.receiveShadow = true;
      const c2 = c1.clone();
      c2.position.set(-0.85, 0.98, 0.3);
      c2.rotation.y = 0.25;
      c2.scale.setScalar(0.8);
      g.add(c1, c2);
    }
    g.position.set(s.x, 0, s.z);
    scene.add(g);
    colliders.push({
      min: [s.x - 1.5, 0, s.z - 1.1], max: [s.x + 1.5, 2.5, s.z + 1.1],
    });
  }

  // ---- The MISSING crate (behind the storehouse, east) ----------------------
  const P = C.CRATE_POS;
  const stack = new THREE.Group();
  const static1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 0.8), mats.wood);
  static1.position.set(-0.55, 0.375, 0.1);
  static1.rotation.y = 0.2;
  static1.castShadow = static1.receiveShadow = true;
  const static2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.65, 0.75), mats.woodDark);
  static2.position.set(-0.6, 1.05, 0.05);
  static2.rotation.y = -0.15;
  static2.castShadow = static2.receiveShadow = true;
  stack.add(static1, static2);

  const geos = buildCrate(1.0);
  const theCrate = new THREE.Group();
  const parts = geos.map((geo) => {
    const p = new THREE.Mesh(geo, mats.crate);
    p.castShadow = p.receiveShadow = true;
    return p;
  });
  parts[1].position.y = -0.34;
  parts[2].position.y = 0.34;
  parts.forEach((p) => theCrate.add(p));
  theCrate.position.set(0.55, 0.41, -0.15);
  theCrate.rotation.y = 0.35;
  theCrate.name = 'theCrate';
  stack.add(theCrate);

  // A rope coil hint: Victor was here.
  const rope = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.07, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 }),
  );
  rope.rotation.x = Math.PI / 2;
  rope.position.set(1.4, 0.08, 0.6);
  stack.add(rope);

  stack.position.set(P.x, 0, P.z);
  scene.add(stack);
  colliders.push({
    min: [P.x - 1.6, 0, P.z - 1.0], max: [P.x + 1.6, 1.6, P.z + 1.0],
  });

  // ---- Welcome arch at the south entrance -----------------------------------
  const arch = new THREE.Group();
  for (const sx of [-3.2, 3.2]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.2, 0.9), mats.concrete);
    pillar.position.set(sx, 2.6, 0);
    pillar.castShadow = true;
    arch.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.8, 1.0), mats.frame);
  beam.position.y = 5.4;
  beam.castShadow = true;
  arch.add(beam);
  // sign board
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 1.1, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.7 }),
  );
  sign.position.set(0, 6.35, 0);
  arch.add(sign);
  arch.position.set(0, 0, C.ENTRANCE_Z);
  scene.add(arch);
  colliders.push(
    { min: [-3.65, 0, C.ENTRANCE_Z - 0.45], max: [-2.75, 6.8, C.ENTRANCE_Z + 0.45] },
    { min: [2.75, 0, C.ENTRANCE_Z - 0.45], max: [3.65, 6.8, C.ENTRANCE_Z + 0.45] },
  );

  // ---- Objective beacon ------------------------------------------------------
  const beacon = new Beacon(scene);

  return { colliders, beacon, crateGroup: theCrate, storehouseCenter: new THREE.Vector3(S.x, 0, S.z) };
}

/**
 * Soft objective marker: a translucent vertical cylinder ("light shaft") with
 * a bobbing arrow, toggled + repositioned by GameClient. Cheap: two meshes,
 * additive blending, no per-frame allocation.
 */
export class Beacon {
  constructor(scene) {
    this.scene = scene;
    const shaftGeo = new THREE.CylinderGeometry(0.55, 0.75, 6, 14, 1, true);
    this.shaftMat = new THREE.MeshBasicMaterial({
      color: 0xffcf6a, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.shaft = new THREE.Mesh(shaftGeo, this.shaftMat);
    this.shaft.position.y = 3;

    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.45); arrowShape.lineTo(0.42, -0.1); arrowShape.lineTo(0.16, -0.1);
    arrowShape.lineTo(0.16, -0.45); arrowShape.lineTo(-0.16, -0.45); arrowShape.lineTo(-0.16, -0.1);
    arrowShape.lineTo(-0.42, -0.1); arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    this.arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({
      color: 0xffe49a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, fog: false,
    }));
    this.arrow.position.y = 4.6;
    this.arrow.scale.setScalar(1.2);

    this.group = new THREE.Group();
    this.group.add(this.shaft, this.arrow);
    this.group.visible = false;
    scene.add(this.group);
    this._t = 0;
    this._camPos = new THREE.Vector3();
  }

  /** Point the beacon at a world position, or hide it with set(null). */
  set(pos) {
    if (!pos) { this.group.visible = false; return; }
    this.group.position.set(pos.x, 0, pos.z);
    this.group.visible = true;
  }

  update(dt, camera) {
    if (!this.group.visible) return;
    this._t += dt;
    this.arrow.position.y = 4.6 + Math.sin(this._t * 2.4) * 0.25;
    this.shaftMat.opacity = 0.13 + Math.sin(this._t * 1.7) * 0.04;
    if (camera) {
      // Keep the flat arrow facing the camera (billboard around Y only).
      this._camPos.copy(camera.position);
      this.arrow.rotation.y = Math.atan2(
        this._camPos.x - this.group.position.x,
        this._camPos.z - this.group.position.z,
      );
    }
  }
}
