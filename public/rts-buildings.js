/**
 * RTS building / prop GLBs — tents, towers, hedgehogs from models/rts/.
 */
import * as THREE from "three";
import { initRtsGltfLoader, loadRtsGltfScene } from "./rts-gltf-loader.js";

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

export const RTS_BUILDING_GLB = {
  hedgehog: {
    path: "models/rts/hedgehog_001_compressed.glb",
    targetLength: 2.0,
  },
  tent: {
    path: "models/rts/tent_001_compressed.glb",
    targetLength: 15,
    rotY: Math.PI,
  },
  tower: {
    path: "models/rts/tower_001_compressed.glb",
    targetLength: 5.5,
    rotY: 0,
  },
  container: {
    path: "models/rts/container_001_compressed.glb",
    targetLength: 6.2,
  },
  radiostation: {
    path: "models/rts/radiostation_001_compressed.glb",
    targetLength: 19,
  },
};

export const RTS_BUILDING_GLB_TYPES = Object.keys(RTS_BUILDING_GLB);

/** @type {Map<string, THREE.Group>} */
const _templates = new Map();
let _loadPromise = null;

function normalizeBuildingRoot(scene, cfg) {
  const root = new THREE.Group();
  root.name = `RtsBuilding_${cfg.type}`;
  const holder = new THREE.Group();
  holder.name = "PivotHolder";
  root.add(holder);
  holder.add(scene);

  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getSize(_size);
  const horizLen = Math.max(_size.x, _size.z, 1e-4);
  const scale = (cfg.targetLength ?? 4) / horizLen;
  holder.scale.setScalar(scale);
  if (cfg.rotY) root.rotation.y = cfg.rotY;

  // Ground after final scale so the visual base sits on y=0 in root space.
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getCenter(_center);
  holder.position.set(-_center.x, -_box.min.y, -_center.z);
  if (cfg.groundSink) holder.position.y -= cfg.groundSink;

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  root.userData.glbBuilding = cfg.type;
  return root;
}

/** Share geometry/materials with the template — avoids Texture serialize warnings on clone(true). */
function cloneBuildingTemplate(source) {
  const clone = source.clone(false);
  clone.userData = { ...source.userData };
  for (const child of source.children) {
    clone.add(cloneBuildingTemplate(child));
  }
  if (clone.isMesh) {
    clone.geometry = source.geometry;
    clone.material = source.material;
  }
  return clone;
}

/**
 * @param {THREE.WebGPURenderer} renderer
 */
export function preloadRtsBuildingModels(renderer) {
  if (_templates.size === RTS_BUILDING_GLB_TYPES.length) {
    return Promise.resolve(_templates);
  }
  if (_loadPromise) return _loadPromise;

  initRtsGltfLoader(renderer);
  _loadPromise = (async () => {
    for (const type of RTS_BUILDING_GLB_TYPES) {
      const cfg = { ...RTS_BUILDING_GLB[type], type };
      const scene = await loadRtsGltfScene(cfg.path);
      _templates.set(type, normalizeBuildingRoot(scene, cfg));
    }
    return _templates;
  })().catch((err) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

export function isRtsBuildingGlbReady(type) {
  return _templates.has(type);
}

export function isRtsBuildingGlbRoot(obj) {
  return !!obj?.userData?.glbBuilding;
}

export function isUnderRtsBuildingGlb(obj) {
  let p = obj;
  while (p) {
    if (p.userData?.glbBuilding) return true;
    p = p.parent;
  }
  return false;
}

/** Dispose procedural meshes only — never shared GLB template geometry/materials. */
export function disposeProceduralMeshTree(root) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh || isUnderRtsBuildingGlb(o)) return;
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (mat && !mat.userData?.placementGhost) mat.dispose?.();
    }
  });
}

/** Clone a prepared building/prop mesh, or null if not loaded. */
export function createRtsBuildingGlbMesh(type) {
  const template = _templates.get(type);
  if (!template) return null;
  return cloneBuildingTemplate(template);
}

/**
 * Lower/raise a placed building so its world AABB bottom meets the highest
 * terrain under its footprint (fixes GLB tents floating on slopes).
 */
export function snapRtsBuildingGroupToTerrain(group, getHeight, x, z) {
  if (!group || typeof getHeight !== "function") return group?.position?.y ?? 0;
  group.updateMatrixWorld(true);
  _box.setFromObject(group);
  const samples = [
    [x, z],
    [_box.min.x, _box.min.z],
    [_box.max.x, _box.min.z],
    [_box.min.x, _box.max.z],
    [_box.max.x, _box.max.z],
    [(_box.min.x + _box.max.x) * 0.5, _box.min.z],
    [(_box.min.x + _box.max.x) * 0.5, _box.max.z],
    [_box.min.x, (_box.min.z + _box.max.z) * 0.5],
    [_box.max.x, (_box.min.z + _box.max.z) * 0.5],
  ];
  let groundY = getHeight(x, z);
  for (const [sx, sz] of samples) {
    groundY = Math.max(groundY, getHeight(sx, sz));
  }
  const delta = groundY - _box.min.y;
  if (Math.abs(delta) > 1e-4) group.position.y += delta;
  return group.position.y;
}

/**
 * Snap prop bottom to terrain at the anchor (x,z). Use on flattened pads —
 * max-footprint snap lifts objects above depressions/path crossings.
 */
export function snapRtsBuildingGroupToTerrainCenter(group, getHeight, x, z) {
  if (!group || typeof getHeight !== "function") return group?.position?.y ?? 0;
  group.position.x = x;
  group.position.z = z;
  const groundY = getHeight(x, z);
  group.position.y = groundY;
  group.updateMatrixWorld(true);
  _box.setFromObject(group);
  const delta = groundY - _box.min.y;
  if (Math.abs(delta) > 1e-4) group.position.y += delta;
  return group.position.y;
}
