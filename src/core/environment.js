import * as THREE from 'three';
import * as C from './constants.js';

/** Gradient sky dome (cheap, atmospheric). */
export class SkyDome {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3f6db0) },
        mid: { value: new THREE.Color(C.SKY_COLOR) },
        bot: { value: new THREE.Color(0xd9c8a8) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){
          float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(mid, top, min(h*1.6, 1.0)) : mix(mid, bot, min(-h*3.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);
  }
}

/** Lighting: sun with tuned shadow frustum + hemisphere fill. */
function addLighting(scene) {
  const sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
  sun.position.set(50, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -55;
  sun.shadow.camera.right = sun.shadow.camera.top = 55;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9ab8dd, 0x6b7a55, 1.1));
}

/** PBR material factory using loaded Poly Haven textures. */
function pbrTex(loader, key, repeat) {
  return function () {
    const t = loader.texture(key).clone();
    t.needsUpdate = true;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  };
}

/** Builds the whole town into `scene`. Records static AABBs in `.colliders`. */
export function buildEnvironment(scene, loader) {
  const colliders = [];

  addLighting(scene);

  // ---- Terrain (textured) ---------------------------------------------------
  const grassTex = loader.texture('grass');
  grassTex.repeat.set(60, 60);
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(C.GROUND_SIZE * 2.2, C.GROUND_SIZE * 2.2),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0 }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---- Roads + sidewalks ----------------------------------------------------
  const asphalt = loader.texture('asphalt');
  asphalt.repeat.set(2, 50);
  const asphaltNormal = loader.texture('asphalt_normal');
  asphaltNormal.repeat.set(2, 50);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    normalMap: asphaltNormal,
    roughness: 0.85,
    metalness: 0.0,
  });
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(8, 190), roadMat);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.set(0, 0.02, 0);
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(190, 8), roadMat);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.set(0, 0.02, 0);
  roadNS.receiveShadow = roadEW.receiveShadow = true;
  scene.add(roadNS, roadEW);

  const concreteTex = loader.texture('concrete');
  concreteTex.repeat.set(1, 40);
  const walkMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  for (const off of [-5.6, 5.6]) {
    for (const [w, d, horiz] of [[1.8, 190, false], [190, 1.8, true]]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(w, d), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(horiz ? 0 : off, 0.03, horiz ? off : 0);
      walk.receiveShadow = true;
      scene.add(walk);
    }
  }

  // ---- Buildings (textured brick / plaster facades) -------------------------
  const brickTex = loader.texture('brick');
  const plasterTex = loader.texture('plaster');
  const palette = [brickTex, plasterTex];
  const trimmed = [brickTex, plasterTex];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  function addBuilding(x, z, w, d, floors) {
    const h = floors * 3.1;
    const tex = palette[Math.floor(rand() * palette.length)].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 3)));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    colliders.push({ min: [x - w / 2 - 0.25, 0, z - d / 2 - 0.25], max: [x + w / 2 + 0.25, h, z + d / 2 + 0.25] });

    // Roof + window band to break up the box silhouette.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x4d453c, roughness: 1 }),
    );
    roof.position.set(x, h + 0.17, z);
    scene.add(roof);

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x3d5563, roughness: 0.25, metalness: 0.4,
    });
    const wj = h + 0.001;
    for (let fy = 0; fy < floors; fy++) {
      const y = fy * 3.1 + 1.55;
      for (const [ox, oz, ww, dd] of [[0, d / 2 + 0.05, w * 0.6, 0.1], [0, -d / 2 - 0.05, w * 0.6, 0.1]]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(ww, 1.2, dd), windowMat);
        win.position.set(x + ox, y, z + oz);
        scene.add(win);
      }
    }
  }

  // Deterministic layout so restarts look identical.
  for (const side of [-1, 1]) {
    for (let t = -80; t <= 80; t += 15) {
      if (Math.abs(t) < 10) continue;
      if (rand() < 0.22) continue;
      addBuilding(side * (11 + rand() * 3), t, 7 + rand() * 5, 6 + rand() * 5, 1 + Math.floor(rand() * 3));
      if (rand() < 0.5) addBuilding(t + 3, side * (11 + rand() * 3), 6 + rand() * 5, 7 + rand() * 5, 1 + Math.floor(rand() * 3));
    }
  }

  // ---- Props: trees, lamps, benches, fountain -------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.0, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const crownGeo = new THREE.SphereGeometry(1.35, 8, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x49703a, roughness: 1 });
  function addTree(x, z) {
    const s = 0.75 + rand() * 0.6;
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.0;
    trunk.castShadow = true;
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.y = 2.5;
    crown.scale.set(s, s * 1.15, s);
    crown.castShadow = true;
    g.add(trunk, crown);
    g.position.set(x, 0, z);
    scene.add(g);
    colliders.push({ min: [x - 0.3, 0, z - 0.3], max: [x + 0.3, 2, z + 0.3] });
  }
  for (let t = -70; t <= 70; t += 13) {
    if (Math.abs(t) < 11) continue;
    addTree(7.2, t + rand() * 2 - 1);
    addTree(-7.2, t + 5 + rand() * 2 - 1);
    addTree(t + 3, 7.2);
    addTree(t - 3, -7.2);
  }

  const postGeo = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6);
  const headGeo = new THREE.SphereGeometry(0.26, 10, 8);
  function addLamp(x, z) {
    const post = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.7, metalness: 0.4 }));
    post.position.set(x, 2.1, z);
    post.castShadow = true;
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffe5a0, emissive: 0xffc451, emissiveIntensity: 0.9 }));
    head.position.set(x, 4.3, z);
    scene.add(post, head);
    colliders.push({ min: [x - 0.18, 0, z - 0.18], max: [x + 0.18, 4.2, z + 0.18] });
  }
  for (let t = -64; t <= 64; t += 16) {
    addLamp(6.2, t);
    addLamp(t + 5, 6.2);
    addLamp(-6.2, t + 8);
    addLamp(t - 5, -6.2);
  }

  // Plaza fountain.
  const fountainBase = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.6, 0.8, 20),
    new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }),
  );
  fountainBase.position.set(0, 0.4, 10);
  fountainBase.castShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.1, 0.3, 20),
    new THREE.MeshStandardMaterial({ color: 0x4f8ab0, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 }),
  );
  water.position.set(0, 0.85, 10);
  scene.add(fountainBase, water);
  colliders.push({ min: [-2.6, 0, 7.4], max: [2.6, 1.2, 12.6] });

  buildEnvironment.colliders = colliders;
  return colliders;
}
