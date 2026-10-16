import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as C from './constants';
import type { AssetLoader } from './asset-loader';
import type { AABB } from './collision';

// ---------------------------------------------------------------------------
// Merged-geometry town builder
// ---------------------------------------------------------------------------
// Every static surface (walls, windows, curbs, dashes…) is accumulated per
// material and merged into ONE mesh per material at flush(), so the whole town
// costs ~a dozen draw calls instead of hundreds. Box primitives are sized in
// LOCAL space before the placement matrix is applied, and texture repeats are
// baked into per-geometry UVs — so one shared PBR material serves the town.

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s1 = new THREE.Vector3(1, 1, 1);

interface AddOpts {
  pos?: [number, number, number];
  rotY?: number;
  rotX?: number;
  uv?: [number, number];
  size?: [number, number, number];
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

class TownGeo {
  buckets = new Map<string, THREE.BufferGeometry[]>();

  /** `base` is cloned, sized in local space (BOX only), then placed. */
  add(key: string, base: THREE.BufferGeometry, opts: AddOpts = {}) {
    const {
      pos = [0, 0, 0] as [number, number, number],
      rotY = 0, rotX = 0,
      uv = [1, 1] as [number, number],
      size,
    } = opts;
    const g = base.clone();
    if (size) g.scale(size[0], size[1], size[2]);
    _e.set(rotX, rotY, 0, 'YXZ'); // yaw first, then tilt (awnings/roofs)
    _m4.compose(_v.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e), _s1);
    g.applyMatrix4(_m4);
    if (uv[0] !== 1 || uv[1] !== 1) {
      const a = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]);
      a.needsUpdate = true;
    }
    let arr = this.buckets.get(key);
    if (!arr) { arr = []; this.buckets.set(key, arr); }
    arr.push(g);
  }

  flush(
    scene: THREE.Scene,
    mats: Record<string, { material: THREE.Material; cast?: boolean; recv?: boolean }>,
  ) {
    for (const [key, geos] of this.buckets) {
      const entry = mats[key];
      if (!entry) throw new Error(`TownGeo bucket "${key}" has no material`);
      const merged = mergeGeometries(geos, false);
      if (!merged) throw new Error(`mergeGeometries failed for bucket "${key}"`);
      const mesh = new THREE.Mesh(merged, entry.material);
      mesh.castShadow = entry.cast ?? true;
      mesh.receiveShadow = entry.recv ?? true;
      mesh.name = `town_${key}`;
      scene.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.buckets.clear();
  }
}

/** PBR material from a loaded diff/nor/rough triple (or a legacy diffuse). */
function pbr(
  loader: AssetLoader,
  slug: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
  legacy?: { map: string; normal?: string },
) {
  const mat: THREE.MeshStandardMaterialParameters = {
    map: loader.texture(legacy?.map ?? `${slug}_diff`),
    roughness: 1,
    metalness: 0.02,
    ...extra,
  };
  if (legacy) {
    if (legacy.normal) mat.normalMap = loader.texture(legacy.normal);
  } else {
    mat.normalMap = loader.texture(`${slug}_nor`);
    mat.roughnessMap = loader.texture(`${slug}_rough`);
  }
  return new THREE.MeshStandardMaterial(mat);
}

/** Clone + fit a prop GLB to a target height with its base at y=0. */
function fitHeight(obj: THREE.Object3D, target: number): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const scale = target / Math.max(size.y, 1e-4);
  obj.scale.setScalar(scale);
  obj.position.y = -box.min.y * scale;
  return obj;
}

// ---------------------------------------------------------------------------
// Lighting + sky
// ---------------------------------------------------------------------------

/** Gradient sky dome kept as a documented fallback (HDRI sky is used now). */
export class SkyDome {
  mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
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

/**
 * Find the HDRI's sun direction (equirect FloatType DataTexture) so the
 * directional light + shadows match the photographic sky. Returns a unit
 * vector with a guaranteed minimum elevation for gameplay legibility.
 */
export function hdriSunDirection(tex: THREE.DataTexture): THREE.Vector3 | null {
  const img = tex.image as unknown as { data: Float32Array; width: number; height: number } | undefined;
  if (!img?.data) return null;
  const { data: d, width: w, height: h } = img;
  const n = w * h;
  let best = 0;
  for (let i = 0; i < n; i++) {
    const l = d[4 * i] + d[4 * i + 1] + d[4 * i + 2];
    if (l > best) best = l;
  }
  if (best <= 0) return null;
  // Centroid of the brightest region (the sun disc).
  const th = best * 0.5;
  let sx = 0, sy = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const l = d[4 * i] + d[4 * i + 1] + d[4 * i + 2];
    if (l >= th) {
      const x = i % w;
      const y = (i / w) | 0;
      sx += x * l; sy += y * l; sw += l;
    }
  }
  if (sw <= 0) return null;
  sx /= sw; sy /= sw;
  const u = (sx + 0.5) / w;
  let v = (sy + 0.5) / h;
  const dirFrom = (vv: number) => {
    const lon = (u - 0.5) * Math.PI * 2;
    const lat = (vv - 0.5) * Math.PI;
    return new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lon),
    ).normalize();
  };
  let dir = dirFrom(v);
  if (dir.y < 0) { v = 1 - v; dir = dirFrom(v); } // the sun must be above the horizon
  // Enforce a minimum elevation so shadows stay readable for gameplay.
  const MIN_ELEV = Math.sin(THREE.MathUtils.degToRad(24));
  if (dir.y < MIN_ELEV) {
    const horiz = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
    const lat = Math.asin(MIN_ELEV);
    dir = new THREE.Vector3(
      (dir.x / horiz) * Math.cos(lat),
      Math.sin(lat),
      (dir.z / horiz) * Math.cos(lat),
    ).normalize();
  }
  return dir;
}

export interface TownLighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Offset from the focus point to the light — the sun rig follows the player. */
  sunOffset: THREE.Vector3;
}

function addLighting(scene: THREE.Scene, sunDir: THREE.Vector3 | null): TownLighting {
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  const sunOffset = (sunDir ?? new THREE.Vector3(0.5, 0.78, 0.28).normalize()).clone().multiplyScalar(110);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 260;
  // Tight frustum (was ±55): crisper shadows for the same GPU cost. The rig
  // recenters on the player every frame in GameClient._tick.
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x9ab8dd, 0x6b7a55, 0.5);
  scene.add(hemi);
  return { sun, hemi, sunOffset };
}

// ---------------------------------------------------------------------------
// The town
// ---------------------------------------------------------------------------

/** Window assembly: frame ring + inset glass + sill. rotY orients the face. */
function addWindow(t: TownGeo, x: number, y: number, z: number, rotY: number) {
  const nx = Math.sin(rotY), nz = Math.cos(rotY);
  t.add('frame', BOX, { pos: [x + nx * 0.05, y + 0.85, z + nz * 0.05], rotY, size: [1.45, 1.75, 0.1] });
  t.add('glass', BOX, { pos: [x + nx * 0.028, y + 0.85, z + nz * 0.028], rotY, size: [1.2, 1.5, 0.06] });
  t.add('trim', BOX, { pos: [x + nx * 0.12, y + 0.02, z + nz * 0.12], rotY, size: [1.62, 0.1, 0.24] });
}

/** Builds the whole town into `scene`; returns colliders + the sun rig. */
export function buildEnvironment(scene: THREE.Scene, loader: AssetLoader) {
  const colliders: AABB[] = [];
  const town = new TownGeo();

  // ---- Sun: aligned with the HDRI sky so shadows match the photographic sky
  const lighting = addLighting(scene, hdriSunDirection(loader.hdri('sky') as THREE.DataTexture));

  // ---- Materials ----------------------------------------------------------
  const mats: Record<string, { material: THREE.Material; cast?: boolean; recv?: boolean }> = {
    fac0: { material: pbr(loader, 'red_brick') },
    fac1: { material: pbr(loader, 'painted_plaster_wall') },
    fac2: { material: pbr(loader, 'rough_plaster_brick') },
    fac_chimney: { material: pbr(loader, 'red_brick') },
    trim: { material: pbr(loader, 'concrete', { roughness: 0.9 }) },
    curb: { material: pbr(loader, 'concrete_pavement', { roughness: 0.95 }) },
    sidewalk: { material: pbr(loader, 'concrete_pavement', { roughness: 0.95 }) },
    plaza: { material: pbr(loader, 'cobblestone_02', { roughness: 0.92 }) },
    roof_tile: { material: pbr(loader, 'clay_roof_tiles', { roughness: 0.95 }) },
    roof_flat: { material: pbr(loader, 'concrete', { color: 0x77736a, roughness: 1 }) },
    glass: { material: new THREE.MeshStandardMaterial({ color: 0x22313c, roughness: 0.12, metalness: 0.85, envMapIntensity: 1.25 }), cast: false },
    frame: { material: new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.55 }) },
    door: { material: pbr(loader, 'wood', {}, { map: 'wood', normal: 'wood_normal' }) },
    paint: { material: new THREE.MeshStandardMaterial({ color: 0xd6cfb4, roughness: 0.75 }) },
    awning_a: { material: new THREE.MeshStandardMaterial({ color: 0xc4553d, roughness: 0.85 }) },
    awning_b: { material: new THREE.MeshStandardMaterial({ color: 0x3f7a6a, roughness: 0.85 }) },
    hedge: { material: pbr(loader, 'leafy_grass', { color: 0x7f9c5f, roughness: 1 }) },
    ground: { material: pbr(loader, 'leafy_grass', { roughness: 1 }), cast: false },
    road: {
      material: new THREE.MeshStandardMaterial({
        map: loader.texture('asphalt'), normalMap: loader.texture('asphalt_normal'),
        roughness: 0.9, metalness: 0,
      }),
      cast: false,
    },
  };

  // ---- Terrain (textured PBR grass) ---------------------------------------
  for (const suffix of ['diff', 'nor', 'rough'] as const) {
    const t = loader.texture(`leafy_grass_${suffix}`);
    t.repeat.set(70, 70);
    (mats.ground.material as THREE.MeshStandardMaterial)[suffix === 'diff' ? 'map' : suffix === 'nor' ? 'normalMap' : 'roughnessMap'] = t;
  }
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(C.GROUND_SIZE * 2.2, C.GROUND_SIZE * 2.2),
    mats.ground.material,
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---- Roads ---------------------------------------------------------------
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(8, 190), mats.road.material);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.set(0, 0.02, 0);
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(190, 8), mats.road.material);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.set(0, 0.021, 0);
  roadNS.receiveShadow = roadEW.receiveShadow = true;
  scene.add(roadNS, roadEW);

  // ---- Sidewalks, curbs, lane markings, crosswalks, plaza -----------------
  const SIDE_Y = 0.042;
  for (const off of [-5.6, 5.6]) {
    for (const [w, d, horiz] of [[1.8, 190, false], [190, 1.8, true]] as Array<[number, number, boolean]>) {
      town.add('sidewalk', new THREE.PlaneGeometry(w, d), {
        pos: [horiz ? 0 : off, SIDE_Y, horiz ? off : 0],
        rotX: -Math.PI / 2,
        uv: [w / 2.4, d / 2.4],
      });
    }
  }
  // Curbs between road and sidewalk, split at the intersections.
  for (const sx of [-4.35, 4.35]) {
    for (const [z0, z1] of [[-95, -4.9], [4.9, 95]] as Array<[number, number]>) {
      town.add('curb', BOX, { pos: [sx, 0.033, (z0 + z1) / 2], size: [0.7, 0.062, z1 - z0], uv: [0.8, (z1 - z0) / 2.4] });
    }
  }
  for (const sz of [-4.35, 4.35]) {
    for (const [x0, x1] of [[-95, -4.9], [4.9, 95]] as Array<[number, number]>) {
      town.add('curb', BOX, { pos: [(x0 + x1) / 2, 0.033, sz], size: [x1 - x0, 0.062, 0.7], uv: [(x1 - x0) / 2.4, 0.8] });
    }
  }
  // Center dashes (NS + EW), clear of the crosswalks.
  for (let z = -84; z <= 84; z += 5.6) {
    if (Math.abs(z - C.ENTRANCE_Z) < 4 || Math.abs(z - 4) < 4) continue;
    town.add('paint', BOX, { pos: [0, 0.033, z], size: [0.13, 0.014, 2.4] });
  }
  for (let x = -84; x <= 84; x += 5.6) {
    if (Math.abs(x) < 5) continue;
    town.add('paint', BOX, { pos: [x, 0.034, 0], size: [2.4, 0.014, 0.13] });
  }
  // Crosswalks at the plaza and the entrance.
  for (const cz of [4.4, C.ENTRANCE_Z - 2]) {
    for (let x = -3.3; x <= 3.3; x += 1.1) {
      town.add('paint', BOX, { pos: [x, 0.033, cz], size: [0.6, 0.014, 4.6] });
    }
  }
  // Fountain plaza: cobblestone ring.
  town.add('plaza', new THREE.CircleGeometry(8.6, 48), {
    pos: [0, 0.036, 10], rotX: -Math.PI / 2, uv: [7, 7],
  });

  // Plaza fountain (PBR concrete + water).
  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.8, 20), mats.trim.material);
  fountainBase.position.set(0, 0.4, 10);
  fountainBase.castShadow = fountainBase.receiveShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.1, 0.3, 20),
    new THREE.MeshStandardMaterial({ color: 0x4f8ab0, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.8 }),
  );
  water.position.set(0, 0.85, 10);
  scene.add(fountainBase, water);
  colliders.push({ min: [-2.6, 0, 7.4], max: [2.6, 1.2, 12.6] });

  // ---- Buildings (detailed, merged) ----------------------------------------
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const KEEPCLEAR: Array<[number, number]> = [
    [0, 10],        // plaza fountain
    [-10.1, 2],     // Maya behind her stall
    [4, 8],         // Rosa by the fountain
    [9, -18],       // Victor's work wall
    [-8.5, 2], [-8.5, 6.5], [-8.5, -2.5], [-12.5, 2], // market stalls
    [18, 24],       // old storehouse
    [23.9, 24.6],   // the crate stack behind it
  ];

  function addBuilding(
    x: number, z: number, w: number, d: number, floors: number,
    axis: 'x' | 'z', dir: 1 | -1,
  ) {
    const halfW = w / 2 + 0.6, halfD = d / 2 + 0.6;
    const overlaps = (cx: number, cz: number) =>
      Math.abs(x - cx) < halfW + 6 && Math.abs(z - cz) < halfD + 5;
    if (KEEPCLEAR.some(([cx, cz]) => overlaps(cx, cz))) return;
    // Never let a building eat the sidewalk/street corridor.
    if (axis === 'x' && Math.abs(x) - halfW < 6.8) return;
    if (axis === 'z' && Math.abs(z) - halfD < 6.8) return;

    const h = floors * 3.1;
    const facKey = `fac${Math.floor(rand() * 3)}`;
    const pitched = rand() < 0.45;
    const hasChimney = rand() < 0.4;

    // Plinth + body + floor bands + cornice.
    town.add('trim', BOX, { pos: [x, 0.25, z], size: [w + 0.36, 0.5, d + 0.36], uv: [(w + 0.4) / 2, (d + 0.4) / 2] });
    town.add(facKey, BOX, { pos: [x, h / 2, z], size: [w, h, d], uv: [w / 2.8, h / 2.8] });
    for (let f = 1; f < floors; f++) {
      town.add('trim', BOX, { pos: [x, f * 3.1 - 0.05, z], size: [w + 0.24, 0.12, d + 0.24], uv: [(w + 0.3) / 2, (d + 0.3) / 2] });
    }
    town.add('trim', BOX, { pos: [x, h + 0.13, z], size: [w + 0.5, 0.26, d + 0.5], uv: [(w + 0.6) / 2, (d + 0.6) / 2] });

    // Roof: pitched clay tiles or flat parapet.
    if (pitched) {
      const slope = 0.42;
      const slabLen = d * 0.62;
      for (const sz of [-1, 1]) {
        town.add('roof_tile', BOX, {
          pos: [x, h + 0.62, z + sz * d * 0.22], rotX: sz * -slope,
          size: [w + 0.7, 0.2, slabLen], uv: [w / 2.2, slabLen / 2.2],
        });
      }
      // Gable fill under the roof slabs.
      town.add(facKey, BOX, { pos: [x, h + 0.35, z], size: [w - 0.4, 0.7, d - 0.4], uv: [w / 2.8, 0.8] });
    } else {
      town.add('roof_flat', BOX, { pos: [x, h + 0.32, z], size: [w + 0.2, 0.12, d + 0.2], uv: [w / 3, d / 3] });
      town.add('trim', BOX, { pos: [x, h + 0.62, z - d / 2], size: [w + 0.3, 0.55, 0.22], uv: [w / 2, 0.6] });
      town.add('trim', BOX, { pos: [x, h + 0.62, z + d / 2], size: [w + 0.3, 0.55, 0.22], uv: [w / 2, 0.6] });
      town.add('trim', BOX, { pos: [x - w / 2, h + 0.62, z], size: [0.22, 0.55, d + 0.3], uv: [d / 2, 0.6] });
      town.add('trim', BOX, { pos: [x + w / 2, h + 0.62, z], size: [0.22, 0.55, d + 0.3], uv: [d / 2, 0.6] });
    }
    if (hasChimney) {
      const cx = x + (rand() - 0.5) * (w - 1.4);
      const cz = z + (rand() - 0.5) * (d - 1.4);
      town.add('fac_chimney', BOX, { pos: [cx, h + 1.05, cz], size: [0.55, 1.0, 0.55], uv: [1, 1.4] });
      town.add('trim', BOX, { pos: [cx, h + 1.6, cz], size: [0.75, 0.1, 0.75], uv: [0.8, 0.8] });
    }

    // Upper-floor windows on all four faces.
    for (let f = 1; f < floors; f++) {
      const wy = f * 3.1 + 0.55;
      const nx = Math.max(1, Math.round(w / 2.7));
      const nz = Math.max(1, Math.round(d / 2.7));
      for (let i = 0; i < nx; i++) {
        const wx = x - w / 2 + ((i + 0.5) * w) / nx;
        for (const sz of [-1, 1]) addWindow(town, wx, wy, z + sz * (d / 2), sz === 1 ? 0 : Math.PI);
      }
      for (let i = 0; i < nz; i++) {
        const wz = z - d / 2 + ((i + 0.5) * d) / nz;
        for (const sx of [-1, 1]) addWindow(town, x + sx * (w / 2), wy, wz, sx === 1 ? Math.PI / 2 : -Math.PI / 2);
      }
    }

    // Ground floor: door + storefront + awning on the street face.
    const faceRotY = axis === 'x' ? (dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (dir === 1 ? 0 : Math.PI);
    const nx0 = Math.sin(faceRotY), nz0 = Math.cos(faceRotY);
    const span = axis === 'x' ? d : w;
    const anchor: [number, number] = axis === 'x' ? [x + dir * (w / 2), z] : [x, z + dir * (d / 2)];
    const along = (offset: number): [number, number] =>
      axis === 'x' ? [anchor[0], anchor[1] + offset] : [anchor[0] + offset, anchor[1]];
    // Door (with frame + step).
    {
      const [dx, dz] = along(-span * 0.28);
      town.add('frame', BOX, { pos: [dx + nx0 * 0.04, 1.15, dz + nz0 * 0.04], rotY: faceRotY, size: [1.35, 2.35, 0.14] });
      town.add('door', BOX, { pos: [dx + nx0 * 0.09, 1.08, dz + nz0 * 0.09], rotY: faceRotY, size: [1.12, 2.16, 0.08], uv: [1.0, 1.8] });
      town.add('trim', BOX, { pos: [dx + nx0 * 0.32, 0.06, dz + nz0 * 0.32], rotY: faceRotY, size: [1.6, 0.12, 0.7] });
    }
    // Storefront window + awning.
    const awnKey = rand() < 0.5 ? 'awning_a' : 'awning_b';
    {
      const [sxw, szw] = along(span * 0.18);
      town.add('frame', BOX, { pos: [sxw + nx0 * 0.03, 1.5, szw + nz0 * 0.03], rotY: faceRotY, size: [3.1, 1.9, 0.12] });
      town.add('glass', BOX, { pos: [sxw + nx0 * 0.08, 1.5, szw + nz0 * 0.08], rotY: faceRotY, size: [2.85, 1.65, 0.08] });
      town.add(awnKey, BOX, {
        pos: [sxw + nx0 * 0.55, 2.72, szw + nz0 * 0.55],
        rotY: faceRotY, rotX: dir === 1 && axis === 'z' ? 0.3 : dir === -1 && axis === 'z' ? 0.3 : (axis === 'x' ? (dir === 1 ? 0.3 : 0.3) : 0.3),
        size: [3.4, 0.06, 1.15],
      });
    }
    // Remaining ground-floor windows on the other faces.
    {
      const nxG = Math.max(1, Math.round(w / 2.7));
      const nzG = Math.max(1, Math.round(d / 2.7));
      for (let i = 0; i < nxG; i++) {
        const wx = x - w / 2 + ((i + 0.5) * w) / nxG;
        for (const sz of [-1, 1]) {
          if (axis === 'z' && sz === dir) continue;
          addWindow(town, wx, 0.85, z + sz * (d / 2), sz === 1 ? 0 : Math.PI);
        }
      }
      for (let i = 0; i < nzG; i++) {
        const wz = z - d / 2 + ((i + 0.5) * d) / nzG;
        for (const sx of [-1, 1]) {
          if (axis === 'x' && sx === dir) continue;
          addWindow(town, x + sx * (w / 2), 0.85, wz, sx === 1 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
    }

    // Hedge strip along the street face + gameplay collider.
    const hedgeLen = Math.min(axis === 'x' ? d : w, 4);
    if (axis === 'x') {
      town.add('hedge', BOX, { pos: [x + dir * (halfW - 0.15), 0.45, z], size: [0.7, 0.9, hedgeLen], uv: [1, hedgeLen / 1.6] });
    } else {
      town.add('hedge', BOX, { pos: [x, 0.45, z + dir * (halfD - 0.15)], rotY: Math.PI / 2, size: [0.7, 0.9, hedgeLen], uv: [1, hedgeLen / 1.6] });
    }

    colliders.push({
      min: [x - w / 2 - 0.25, 0, z - d / 2 - 0.25],
      max: [x + w / 2 + 0.25, h, z + d / 2 + 0.25],
    });
  }

  // Deterministic layout so restarts look identical (gameplay anchors are
  // fixed constants, so decorative variety never affects the mission).
  for (const side of [-1, 1] as Array<1 | -1>) {
    for (let t = -80; t <= 80; t += 15) {
      if (Math.abs(t) < 10) continue;
      if (rand() < 0.22) continue;
      addBuilding(side * (11 + rand() * 3), t, 7 + rand() * 5, 6 + rand() * 5, 1 + Math.floor(rand() * 3), 'x', -side as 1 | -1);
      if (rand() < 0.5) addBuilding(t + 3, side * (11 + rand() * 3), 6 + rand() * 5, 7 + rand() * 5, 1 + Math.floor(rand() * 3), 'z', -side as 1 | -1);
    }
  }

  // ---- Vegetation (GLB models with LOD) ------------------------------------
  function shadowed(obj: THREE.Object3D, receive = true) {
    obj.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = receive; } });
    return obj;
  }

  function addTree(x: number, z: number) {
    const h = 4.6 + rand() * 1.6;
    const lod = new THREE.LOD();
    lod.addLevel(shadowed(fitHeight(loader.instantiate('tree'), h)), 0);
    lod.addLevel(shadowed(fitHeight(loader.instantiate('treeLow'), h)), 42);
    lod.position.set(x, 0, z);
    scene.add(lod);
    colliders.push({ min: [x - 0.35, 0, z - 0.35], max: [x + 0.35, 2, z + 0.35] });
  }
  const treeSpots: Array<[number, number]> = [
    [-7.2, 62], [7.2, 55], [-7.2, 34], [7.2, 27], [-7.2, -13], [7.2, -20],
    [-7.2, -41], [7.2, -48], [-7.2, -62], [7.2, 68],
    [8.6, 12.5], [-6.9, 15.8], // plaza landmarks
  ];
  for (const [x, z] of treeSpots) addTree(x, z);

  function addShrub(x: number, z: number, s = 0.9) {
    const lod = new THREE.LOD();
    lod.addLevel(shadowed(fitHeight(loader.instantiate('shrub'), s)), 0);
    lod.addLevel(shadowed(fitHeight(loader.instantiate('shrubLow'), s)), 26);
    lod.position.set(x, 0, z);
    scene.add(lod);
  }
  const shrubSpots: Array<[number, number, number]> = [
    [3.1, 13.2, 1.1], [-3.4, 12.6, 0.9], [2.6, 6.9, 1.0], [-2.9, 7.2, 0.8],
    [15.2, 21.2, 1.2], [13.1, 26.8, 0.9],
    [-10.9, 9.8, 0.9], [-6.3, -3.4, 1.0],
  ];
  for (const [x, z, s] of shrubSpots) addShrub(x, z, s);

  // ---- Street furniture (GLB props with colliders) -------------------------
  function placeProp(key: string, x: number, z: number, h: number, rotY = 0, collider: [number, number] | null = null) {
    const obj = shadowed(fitHeight(loader.instantiate(key), h));
    obj.rotation.y = rotY;
    obj.position.set(x, obj.position.y, z);
    scene.add(obj);
    if (collider) {
      const r = collider[0] / 2;
      colliders.push({ min: [x - r, 0, z - collider[1] / 2], max: [x + r, collider[0], z + collider[1] / 2] });
    }
    return obj;
  }

  // Lamps along both streets.
  for (const t of [-64, -48, -32, -16, 16, 32, 48, 64]) {
    placeProp('lamp', 6.2, t, 4.3, Math.PI, [0.36, 1.4]);
    placeProp('lamp', -6.2, t + 8, 4.3, 0, [0.36, 1.4]);
  }
  // Benches around the fountain plaza (facing the fountain).
  placeProp('bench', 4.6, 12.4, 0.95, Math.atan2(0 - 4.6, 0 - 12.4), [1.9, 0.9]);
  placeProp('bench', -4.6, 12.4, 0.95, Math.atan2(4.6, -12.4), [1.9, 0.9]);
  placeProp('bench', 4.4, 7.4, 0.95, Math.atan2(-4.4, 2.6), [1.9, 0.9]);
  placeProp('bench', -4.4, 7.4, 0.95, Math.atan2(4.4, 2.6), [1.9, 0.9]);
  // Planters lining the entrance walk.
  for (const z of [38, 42.5, 49.5, 54]) {
    placeProp('planter', 5.25, z, 0.62, 0, [0.95, 0.95]);
    placeProp('planter', -5.25, z, 0.62, 0, [0.95, 0.95]);
  }
  placeProp('hydrant', 4.75, 36, 0.85, 0, [0.45, 0.45]);
  placeProp('trashcan', -4.75, 39, 0.95, 0, [0.55, 0.55]);
  // Market back-alley dressing (barrels + crates near the stalls/storehouse).
  placeProp('barrel', -14.4, 3.8, 0.95, 0.4, [0.75, 0.75]);
  placeProp('barrel', -14.3, 2.6, 0.95, -0.2, [0.75, 0.75]);
  placeProp('crate', -14.5, 5.0, 0.85, 0.3, [0.95, 0.95]);
  placeProp('crate', 14.6, 21.6, 0.9, -0.35, [1.0, 1.0]);
  placeProp('crate', 15.6, 22.6, 0.75, 0.5, [1.0, 1.0]);
  placeProp('trashcan', 12.9, 22.9, 0.95, 0, [0.55, 0.55]);

  // ---- Flush merged town geometry ------------------------------------------
  town.flush(scene, mats);

  return { colliders, lighting };
}
