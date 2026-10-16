import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** Legacy texture set from the original prototype (kept for continuity). */
const LEGACY_TEXTURES = [
  { key: 'grass', file: 'grass.jpg' },
  { key: 'asphalt', file: 'asphalt.jpg' },
  { key: 'asphalt_normal', file: 'asphalt_normal.jpg' },
  { key: 'concrete', file: 'concrete.jpg' },
  { key: 'brick', file: 'brick.jpg' },
  { key: 'plaster', file: 'plaster.jpg' },
  // Crate + market woodwork (Poly Haven CC0, same source as the rest)
  { key: 'wood', file: 'wood_planks_diff_1k.jpg' },
  { key: 'wood_normal', file: 'wood_planks_nor_gl_1k.jpg' },
  { key: 'wood_rough', file: 'wood_planks_rough_1k.jpg' },
];

/**
 * Phase-2 PBR sets — Poly Haven (CC0), 1k jpg, complete material triples
 * (diffuse + OpenGL-convention normal + roughness) so every town surface gets
 * a full PBR treatment instead of diffuse-only walls.
 */
const PBR_SETS = [
  'red_brick',
  'painted_plaster_wall',
  'rough_plaster_brick',
  'clay_roof_tiles',
  'cobblestone_02',
  'concrete_pavement',
  'leafy_grass',
  'concrete',
];
const SET_TEXTURES = PBR_SETS.flatMap((s) => [
  { key: `${s}_diff`, file: `${s}_diff_1k.jpg` },
  { key: `${s}_nor`, file: `${s}_nor_gl_1k.jpg` },
  { key: `${s}_rough`, file: `${s}_rough_1k.jpg` },
]);
const TEXTURES = [...LEGACY_TEXTURES, ...SET_TEXTURES];

/** Rigged characters (loader REQUIRES animation clips — no silent fallbacks). */
const GLBS = Object.entries({
  player: './assets/characters/Soldier.glb',
  npcMale: './assets/characters/Xbot.glb',
  npcFemale: './assets/characters/Michelle.glb',
}).map(([key, url]) => ({ key, url }));

/**
 * Static CC0 prop models (Poly Haven, decimated offline with meshoptimizer
 * and repacked as self-contained GLBs under public/assets/models/).
 * treeLow/shrubLow are the decimated LOD variants.
 */
const PROP_MODELS = [
  { key: 'bench', url: './assets/models/painted_wooden_bench/painted_wooden_bench.glb' },
  { key: 'lamp', url: './assets/models/street_lamp_01/street_lamp_01.glb' },
  { key: 'tree', url: './assets/models/tree_small_02/tree_small_02.glb' },
  { key: 'treeLow', url: './assets/models/tree_small_02/tree_small_02_low.glb' },
  { key: 'shrub', url: './assets/models/shrub_01/shrub_01.glb' },
  { key: 'shrubLow', url: './assets/models/shrub_01/shrub_01_low.glb' },
  { key: 'barrel', url: './assets/models/wine_barrel_01/wine_barrel_01.glb' },
  { key: 'crate', url: './assets/models/wooden_crate_01/wooden_crate_01.glb' },
  { key: 'planter', url: './assets/models/planter_box_01/planter_box_01.glb' },
  { key: 'hydrant', url: './assets/models/fire_hydrant/fire_hydrant.glb' },
  { key: 'trashcan', url: './assets/models/metal_trash_can/metal_trash_can.glb' },
];

/** Sky HDRI used for image-based lighting + background (Poly Haven CC0). */
const HDRIS = [{ key: 'sky', file: 'kloofendal_48d_partly_cloudy_puresky_1k.hdr' }];

/** Loads real GLB characters + PBR textures. Throws loudly when an asset is
 *  missing or a required clip is absent — no silent fallbacks, no cube swaps. */
export class AssetLoader {
  onProgress?: (message: string) => void;
  gltfLoader: GLTFLoader;
  hdriLoader: RGBELoader;
  textureLoader: THREE.TextureLoader;
  gltfs: Map<string, GLTF>;
  textures: Map<string, THREE.Texture>;
  hdris: Map<string, THREE.Texture>;
  _total: number;
  _done: number;

  constructor(onProgress?: (message: string) => void) {
    this.onProgress = onProgress;
    this.gltfLoader = new GLTFLoader();
    this.hdriLoader = new RGBELoader();
    // Float32 pixels: needed by hdriSunDirection() to scan for the sun disc.
    this.hdriLoader.type = THREE.FloatType;
    this.textureLoader = new THREE.TextureLoader();
    this.gltfs = new Map();
    this.textures = new Map();
    this.hdris = new Map();
    this._total = GLBS.length + PROP_MODELS.length + TEXTURES.length + HDRIS.length;
    this._done = 0;
  }

  async loadAll() {
    const jobs = [
      ...GLBS.map(({ key, url }) => this._loadGltf(key, url, true)),
      ...PROP_MODELS.map(({ key, url }) => this._loadGltf(key, url, false)),
      ...TEXTURES.map(({ key, file }) => this._loadTexture(key, `./assets/textures/${file}`)),
      ...HDRIS.map(({ key, file }) => this._loadHdri(key, `./assets/hdris/${file}`)),
    ];
    await Promise.all(jobs);
  }

  _bump(what: string) {
    this._done++;
    this.onProgress?.(`Loaded ${this._done}/${this._total} — ${what}`);
  }

  _loadGltf(key: string, url: string, requireClips: boolean) {
    return new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          if (requireClips && !gltf.animations.length) {
            reject(new Error(`${url} has NO animation clips (asset unusable)`));
            return;
          }
          this.gltfs.set(key, gltf);
          this._bump(key);
          resolve(gltf);
        },
        undefined,
        (err) => reject(new Error(`Failed to load ${url}: ${err}`)),
      );
    });
  }

  _loadTexture(key: string, url: string) {
    // THREE.TextureLoader treats a rejected promise as an error path we surface.
    return this.textureLoader
      .loadAsync(url)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        this.textures.set(key, tex);
        this._bump(key);
        return tex;
      })
      .catch((err) => {
        throw new Error(`Failed to load texture ${url}: ${err?.message || err}`);
      });
  }

  _loadHdri(key: string, url: string) {
    return this.hdriLoader
      .loadAsync(url)
      .then((tex) => {
        // Equirect so it can drive scene.background + PMREM environment.
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.hdris.set(key, tex);
        this._bump(key);
        return tex;
      })
      .catch((err) => {
        throw new Error(`Failed to load HDRI ${url}: ${err?.message || err}`);
      });
  }

  /** @returns {THREE.Object3D} a fresh scene-graph clone of a loaded glTF.
   *  SkeletonUtils.clone keeps skinned meshes bound to their (duplicated)
   *  skeleton — a naive scene.clone() breaks skin bindings and renders nothing.
   *  Works for static prop GLBs too. */
  instantiate(key: string) {
    const gltf = this.gltfs.get(key);
    if (!gltf) throw new Error(`GLB "${key}" was never loaded`);
    return SkeletonUtils.clone(gltf.scene);
  }

  texture(key: string) {
    const t = this.textures.get(key);
    if (!t) throw new Error(`Texture "${key}" missing`);
    return t;
  }

  hdri(key: string) {
    const t = this.hdris.get(key);
    if (!t) throw new Error(`HDRI "${key}" missing`);
    return t;
  }

  clip(key: string, name: string) {
    const gltf = this.gltfs.get(key);
    const c = gltf?.animations.find((a) => a.name === name);
    if (!c) throw new Error(`${key}.glb has no clip "${name}" (has: ${gltf?.animations.map((x) => x.name).join(', ')})`);
    return c;
  }
}
