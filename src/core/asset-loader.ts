import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const TEXTURES = [
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

const GLBS = Object.entries({
  player: './assets/characters/Soldier.glb',
  npcMale: './assets/characters/Xbot.glb',
  npcFemale: './assets/characters/Michelle.glb',
}).map(([key, url]) => ({ key, url }));

/** Loads real GLB characters + PBR textures. Throws loudly when an asset is
 *  missing or a required clip is absent — no silent fallbacks, no cube swaps. */
export class AssetLoader {
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.gltfs = new Map();
    this.textures = new Map();
    this._total = GLBS.length + TEXTURES.length;
    this._done = 0;
  }

  async loadAll() {
    const jobs = [
      ...GLBS.map(({ key, url }) => this._loadGltf(key, url)),
      ...TEXTURES.map(({ key, file }) => this._loadTexture(key, `./assets/textures/${file}`)),
    ];
    await Promise.all(jobs);
  }

  _bump(what) {
    this._done++;
    this.onProgress?.(`Loaded ${this._done}/${this._total} — ${what}`);
  }

  _loadGltf(key, url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const names = gltf.animations.map((c) => c.name);
          if (!gltf.animations.length) {
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

  _loadTexture(key, url) {
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

  /** @returns {THREE.Object3D} a fresh scene-graph clone of the character glTF.
   *  SkeletonUtils.clone keeps skinned meshes bound to their (duplicated)
   *  skeleton — a naive scene.clone() breaks skin bindings and renders nothing. */
  instantiate(key) {
    const gltf = this.gltfs.get(key);
    if (!gltf) throw new Error(`GLB "${key}" was never loaded`);
    return SkeletonUtils.clone(gltf.scene);
  }

  texture(key) {
    const t = this.textures.get(key);
    if (!t) throw new Error(`Texture "${key}" missing`);
    return t;
  }

  clip(key, name) {
    const gltf = this.gltfs.get(key);
    const c = gltf?.animations.find((a) => a.name === name);
    if (!c) throw new Error(`${key}.glb has no clip "${name}" (has: ${gltf?.animations.map((x) => x.name).join(', ')})`);
    return c;
  }
}
