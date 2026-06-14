/**
 * Shared GLTF + Draco + KTX2 loader for RTS Lab.
 * One KTX2Loader instance — multiple loaders break WebGPU texture lifetime.
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

const TRANSCODER_PATH =
  "https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/";
const DRACO_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

const _draco = new DRACOLoader();
_draco.setDecoderPath(DRACO_PATH);

const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

let _ktx2 = null;
let _ktx2Ready = false;

/**
 * Wire KTX2 transcoder to the renderer once (idempotent).
 * @param {THREE.WebGPURenderer} renderer
 * @returns {GLTFLoader}
 */
export function initRtsGltfLoader(renderer) {
  if (_ktx2Ready) return _gltf;
  _ktx2 = new KTX2Loader();
  _ktx2.setTranscoderPath(TRANSCODER_PATH);
  _ktx2.detectSupport(renderer);
  _gltf.setKTX2Loader(_ktx2);
  _ktx2Ready = true;
  return _gltf;
}

export function getRtsGltfLoader() {
  return _gltf;
}

export function isRtsGltfLoaderReady() {
  return _ktx2Ready;
}

/** Load a GLB/GLTF and return its scene root. */
export function loadRtsGltfScene(path) {
  if (!_ktx2Ready) {
    return Promise.reject(
      new Error("initRtsGltfLoader(renderer) must run before loading KTX2 GLBs"),
    );
  }
  return new Promise((resolve, reject) => {
    _gltf.load(path, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}
