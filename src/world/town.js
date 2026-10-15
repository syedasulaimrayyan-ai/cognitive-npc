import * as THREE from 'three';

/**
 * Procedural small town. Everything is generated once at startup from simple
 * geometry + tiny canvas textures, so there are no asset downloads and very
 * few draw calls. Static meshes are merged where possible.
 */

const CANVAS_CACHE = new Map();

/** Tiny procedural facade texture (windows grid). */
function facadeTexture(baseColor, windowColor) {
  const key = baseColor.toString(16) + windowColor.toString(16);
  if (CANVAS_CACHE.has(key)) return CANVAS_CACHE.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#' + windowColor.toString(16).padStart(6, '0');
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = Math.random() > 0.55;
      g.fillStyle = lit ? '#ffe9a8' : '#' + windowColor.toString(16).padStart(6, '0');
      g.fillRect(14 + x * 30, 14 + y * 30, 18, 22);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.strokeRect(0.5, 0.5, 127, 127);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; // crisp low-cost look
  CANVAS_CACHE.set(key, tex);
  return tex;
}

const BUILDING_PALETTE = [
  0x8a6f52, 0x9a8468, 0x7d8a94, 0xa08f7a, 0x6f7f6c, 0x93765c,
];

function addBuilding(scene, x, z, w, d, floors) {
  const h = floors * 3;
  const color = BUILDING_PALETTE[Math.floor(Math.random() * BUILDING_PALETTE.length)];
  const mat = new THREE.MeshLambertMaterial({ map: facadeTexture(color, 0x2b3d4e) });

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);

  // Flat roof lip (cheap detail instead of a separate roof mesh).
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.4, 0.4, d + 0.4),
    new THREE.MeshLambertMaterial({ color: 0x5c5044 }),
  );
  lip.position.set(x, h + 0.2, z);
  scene.add(lip);

  // Door on the side facing the road (approximate: -x side).
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2, 1),
    new THREE.MeshLambertMaterial({ color: 0x4a3826 }),
  );
  door.position.set(x - w / 2 - 0.06, 1, z);
  scene.add(door);
}

function addTree(scene, x, z) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2e }),
  );
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  const crown = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.15, 0),
    new THREE.MeshLambertMaterial({ color: 0x4a7a3a, flatShading: true }),
  );
  crown.position.y = 2.1;
  crown.castShadow = true;
  group.add(trunk, crown);
  group.position.set(x, 0, z);
  scene.add(group);
}

function addLamp(scene, x, z) {
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x333a40 }),
  );
  post.position.set(x, 1.7, z);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  );
  head.position.set(x, 3.5, z);
  scene.add(post, head);
}

export function buildTown(scene) {
  // --- Lighting -----------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xfff3dd, 1.5);
  sun.position.set(40, 55, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -50;
  sun.shadow.camera.right = sun.shadow.camera.top = 50;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd9f2, 0x59703f, 0.85));

  // --- Ground -------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshLambertMaterial({ color: 0x6e8b4e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Roads (cross layout) ----------------------------------------------
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3d4046 });
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(6, 200), roadMat);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.set(0, 0.02, 0);
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(200, 6), roadMat);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.set(0, 0.02, 0);
  roadNS.receiveShadow = roadEW.receiveShadow = true;
  scene.add(roadNS, roadEW);

  // Sidewalk strips flanking the roads.
  const walkMat = new THREE.MeshLambertMaterial({ color: 0x9a938a });
  for (const off of [-4.4, 4.4]) {
    for (const horiz of [false, true]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 200 : 1.6, horiz ? 1.6 : 200), walkMat);
      walk.rotation.x = -Math.PI / 2;
      if (horiz) walk.position.set(0, 0.03, off);
      else walk.position.set(off, 0.03, 0);
      walk.receiveShadow = true;
      scene.add(walk);
    }
  }

  // --- Buildings along the roads -----------------------------------------
  const plots = [];
  for (const side of [-1, 1]) {
    for (let t = -80; t <= 80; t += 14) {
      if (Math.abs(t) < 8) continue; // keep the intersection open
      if (Math.abs(t) > 60 && Math.random() < 0.4) continue;
      plots.push({ t, side, horiz: false });
      plots.push({ t, side, horiz: true });
    }
  }
  let count = 0;
  for (const p of plots) {
    if (Math.random() < 0.25) continue; // leave empty lots
    if (p.horiz && Math.random() < 0.5) continue;
    count++;
    const w = p.horiz ? THREE.MathUtils.randFloat(5, 9) : THREE.MathUtils.randFloat(7, 11);
    const d = p.horiz ? THREE.MathUtils.randFloat(7, 11) : THREE.MathUtils.randFloat(5, 9);
    const setBack = 9 + Math.max(w, d) / 2;
    const x = p.horiz ? p.t * 1.0 : p.side * setBack;
    const z = p.horiz ? p.side * setBack : p.t * 1.0;
    addBuilding(scene, x, z, w, d, 1 + Math.floor(Math.random() * 3));
  }

  // --- Props: trees + lamps along sidewalks -------------------------------
  for (let t = -70; t <= 70; t += 12) {
    if (Math.abs(t) < 10) continue;
    addTree(scene, 5.6, t);
    addTree(scene, t, 5.6);
    addTree(scene, -5.6, t + 6);
    addLamp(scene, 4.8, t + 3);
    addLamp(scene, t + 3, 4.8);
  }

  // --- Town square marker near the NPC spawn -----------------------------
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(6, 24),
    new THREE.MeshLambertMaterial({ color: 0xb8ab97 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.04, 8);
  plaza.receiveShadow = true;
  scene.add(plaza);

  return scene;
}
