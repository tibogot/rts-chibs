/**
 * RTS unit GLB templates — compressed Draco + KTX2 models from models/rts/.
 * Normalizes pivot (grounded, centered), scale, and facing (+Z = front).
 */
import * as THREE from "three";
import {
  texture as textureNode,
  vec3,
  dot,
  max,
  min,
  smoothstep,
  mix,
} from "three/tsl";
import { initRtsGltfLoader, loadRtsGltfScene } from "./rts-gltf-loader.js";

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

/** @type {Map<string, THREE.Group>} */
const _templates = new Map();
let _loadPromise = null;

export const RTS_UNIT_GLB = {
  tank: {
    path: "models/rts/tankmilitary_compressed.glb",
    targetLength: 4.6,
    rotY: Math.PI,
    ringScale: 1.05,
    shot: { muzzleFwd: 2.35, muzzleUp: 1.45 },
  },
  rocketLauncher: {
    path: "models/rts/truckmilitary_compressed.glb",
    targetLength: 5.1,
    rotY: Math.PI,
    ringScale: 1.12,
    shot: { muzzleFwd: 2.75, muzzleUp: 1.65 },
  },
  artillery: {
    path: "models/rts/bigtank_compressed.glb",
    targetLength: 5.6,
    rotY: Math.PI,
    ringScale: 1.25,
    shot: { muzzleFwd: 2.6, muzzleUp: 1.8 },
  },
  harvester: {
    path: "models/rts/carmilitary_compressed.glb",
    targetLength: 4.2,
    rotY: Math.PI,
    ringScale: 1.05,
  },
  bulldozer: {
    path: "models/rts/jeep_compressed.glb",
    targetLength: 3.9,
    rotY: Math.PI,
    ringScale: 1.1,
  },
  helicopter: {
    path: "models/rts/heli5.glb",
    // targetLength = final in-game FUSELAGE length (rotors are excluded from
    // the measured box), so this number is true regardless of GLB scale.
    targetLength: 13,
    rotY: Math.PI,
    ringScale: 2.4,
    findRotors: true,
    shot: { muzzleFwd: 1.6, muzzleUp: 0.7 },
  },
};

export const RTS_UNIT_GLB_TYPES = Object.keys(RTS_UNIT_GLB);

function isRotorMeshName(name) {
  const n = (name || "").toLowerCase();
  if (!n) return false;
  if (/tail/.test(n) && /rotor|prop|blade/.test(n)) return true;
  return /rotor|propeller|blade|\bprop\b|object_14\.001(?:_\d+)?$/.test(n);
}

function isTailRotorMeshName(name) {
  const n = (name || "").toLowerCase();
  return /tail/.test(n) && /rotor|prop|blade/.test(n);
}

/** Mesh is a rotor if its name matches or any ancestor up to unit root is a rotor group. */
function meshRotorKind(mesh, root) {
  if (!mesh?.isMesh) return null;
  if (isTailRotorMeshName(mesh.name)) return "tail";
  if (isRotorMeshName(mesh.name)) return "main";
  let p = mesh.parent;
  while (p && p !== root) {
    const pn = (p.name || "").toLowerCase();
    if (isTailRotorMeshName(p.name)) return "tail";
    if (pn === "rotor" || pn === "mainrotor" || isRotorMeshName(p.name)) return "main";
    if (pn === "tailrotor") return "tail";
    p = p.parent;
  }
  return null;
}

function normalizeUnitRoot(scene, cfg) {
  const root = new THREE.Group();
  root.name = `RtsUnit_${cfg.type}`;
  const holder = new THREE.Group();
  holder.name = "PivotHolder";
  root.add(holder);
  holder.add(scene);

  root.updateMatrixWorld(true);
  if (cfg.findRotors) {
    // Rotor span dominates the AABB and shrinks the fuselage when scaled to targetLength.
    _box.makeEmpty();
    let hasBody = false;
    root.traverse((o) => {
      if (!o.isMesh || meshRotorKind(o, root)) return;
      _box.expandByObject(o);
      hasBody = true;
    });
    if (!hasBody) _box.setFromObject(root);
  } else {
    _box.setFromObject(root);
  }
  _box.getCenter(_center);
  _box.getSize(_size);
  holder.position.set(-_center.x, -_box.min.y, -_center.z);

  const horizLen = Math.max(_size.x, _size.z, 1e-4);
  const scale = (cfg.targetLength ?? 4.5) / horizLen;
  root.scale.setScalar(scale);
  if (cfg.rotY) root.rotation.y = cfg.rotY;

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // Tag rotor nodes by NAME so the tag survives clone(true) — userData refs
  // would keep pointing at the template's nodes. updateUnits spins
  // userData.mainRotor / tailRotor (wired up per-clone in createRtsUnitGlbMesh).
  if (cfg.findRotors) {
    const found = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const kind = meshRotorKind(o, root);
      if (kind === "tail") {
        o.name = "TailRotor";
        found.push(o.name);
      } else if (kind === "main") {
        o.name = "MainRotor";
        found.push(o.name);
      }
    });
    if (!found.length) {
      const names = [];
      root.traverse((o) => o.name && names.push(o.name));
      console.info(
        `[rts-units] no rotor node found in ${cfg.path} — rotors won't spin. Node names:`,
        names.join(", "),
      );
    }
  }

  root.userData.glbUnit = cfg.type;
  return root;
}

// The pack's color comes from a palette TEXTURE, so lerping material.color
// just muddies it (blue × green texels). Instead: shader-level hue swap —
// green-dominant texels are replaced with the faction color at the texel's
// own luminance, so shading/weathering survive. Converted materials are
// cached per (source material, faction): two shader variants total, shared
// by every clone (never dispose these — shared, like the templates).
const _factionMatCache = new Map();

function greenToFactionNode(map, fc) {
  const t = textureNode(map);
  const greenDom = t.g.sub(max(t.r, t.b));
  const chroma = max(t.r, max(t.g, t.b)).sub(min(t.r, min(t.g, t.b)));
  const mask = smoothstep(0.0, 0.08, greenDom).mul(smoothstep(0.03, 0.1, chroma));
  const lum = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
  const facLum = Math.max(0.05, 0.2126 * fc.r + 0.7152 * fc.g + 0.0722 * fc.b);
  const recolor = vec3(fc.r, fc.g, fc.b).mul(lum.div(facLum)).clamp(0, 1);
  return mix(t.rgb, recolor, mask);
}

function isGreenishColor(c) {
  const hsl = c.getHSL({});
  return hsl.s > 0.12 && hsl.l > 0.08 && hsl.h > 0.16 && hsl.h < 0.45;
}

function factionMaterial(mat, faction, fc) {
  const key = `${mat.uuid}:${faction}`;
  let out = _factionMatCache.get(key);
  if (out) return out;

  if (mat.map) {
    out = new THREE.MeshStandardNodeMaterial();
    out.colorNode = greenToFactionNode(mat.map, fc);
    out.roughness = mat.roughness ?? 1;
    out.metalness = mat.metalness ?? 0;
    out.normalMap = mat.normalMap ?? null;
    out.side = mat.side;
    out.transparent = mat.transparent;
    out.name = `${mat.name}_${faction}`;
  } else if (isGreenishColor(mat.color)) {
    out = mat.clone();
    const fhsl = fc.getHSL({});
    const mhsl = mat.color.getHSL({});
    out.color.setHSL(fhsl.h, fhsl.s, mhsl.l); // faction hue, keep lightness
    out.name = `${mat.name}_${faction}`;
  } else {
    out = mat; // dark rotors, glass, tyres — leave untouched
  }
  _factionMatCache.set(key, out);
  return out;
}

function tintFactionMeshes(root, faction, palette) {
  if (!palette) return;
  const key = faction === "enemy" ? "enemy" : "player";
  const hull = palette[key]?.hull;
  if (hull == null) return;
  const fc = new THREE.Color(hull);
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => factionMaterial(m, key, fc));
    } else {
      o.material = factionMaterial(o.material, key, fc);
    }
  });
}

/**
 * Load and cache all RTS unit GLBs (idempotent).
 * @param {THREE.WebGPURenderer} renderer
 */
export function preloadRtsUnitModels(renderer) {
  if (_templates.size === RTS_UNIT_GLB_TYPES.length) {
    return Promise.resolve(_templates);
  }
  if (_loadPromise) return _loadPromise;

  initRtsGltfLoader(renderer);
  _loadPromise = (async () => {
    for (const type of RTS_UNIT_GLB_TYPES) {
      const cfg = { ...RTS_UNIT_GLB[type], type };
      const scene = await loadRtsGltfScene(cfg.path);
      _templates.set(type, normalizeUnitRoot(scene, cfg));
    }
    return _templates;
  })().catch((err) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

export function isRtsUnitGlbReady(type) {
  return _templates.has(type);
}

export function getRtsUnitGlbConfig(type) {
  return RTS_UNIT_GLB[type] ?? null;
}

/**
 * Clone a prepared unit mesh, or null if this type has no loaded GLB.
 */
export function createRtsUnitGlbMesh(faction, type, palette) {
  const template = _templates.get(type);
  if (!template) return null;
  const g = template.clone(true);
  tintFactionMeshes(g, faction, palette);
  if (RTS_UNIT_GLB[type]?.findRotors) {
    const mainRotors = [];
    const tailRotors = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === "MainRotor") mainRotors.push(o);
      else if (o.name === "TailRotor") tailRotors.push(o);
    });
    g.userData.mainRotor = mainRotors[0] ?? null;
    g.userData.tailRotor = tailRotors[0] ?? null;
    g.userData.mainRotors = mainRotors;
    g.userData.tailRotors = tailRotors;
  }
  return g;
}
