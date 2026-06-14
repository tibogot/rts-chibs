/**
 * RTS Lab terrain — CoH-style procedural hills, choke ridges, worn dirt paths.
 * PBR: Grass005 (flats) / Rock028 (cliffs) / Ground037 (paths + patches).
 * Exposes `createRtsTerrain()` → { mesh, getHeight, uniforms, dispose }.
 */
import * as THREE from "three/webgpu";
import {
  float,
  int,
  vec2,
  vec3,
  uniform,
  positionWorld,
  normalWorld,
  texture,
  normalMap,
  color,
  abs,
  max,
  min,
  add,
  mul,
  sub,
  pow,
  dot,
  sin,
  fract,
  floor,
  mix,
  smoothstep,
  clamp,
  normalize,
  step,
} from "three/tsl";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

/** Default RTS map extent (6× the original 240-unit lab). */
export const RTS_MAP_SIZE = 1440;

const PBR_PATH = "./textures/pbr_materials/";

/** Keys that affect the baked heightfield (mesh rebuild required). */
export const SHAPE_KEYS = [
  "fbmScale",
  "octaves",
  "persistence",
  "lacunarity",
  "heightScale",
  "flatness",
  "macroBlend",
  "macroFreq",
  "macroOctaves",
  "peakBias",
  "ridgeBoost",
  "ridgeFreq",
  "ridgeOctaves",
  "floorY",
  "mountainReliefMul",
  "mountainRidgeAmp",
  "mountainRidgeFreq",
  "rampMaxGrade",
  "slopeClampPasses",
  "ridgeClampMul",
  "playBowlStrength",
  "playBowlRadius",
  "chokeRidgeAmp",
  "chokeRidgeWidth",
  "chokeRidgeWarp",
  "edgeMassifAmp",
  "edgeMassifStart",
  "pathsEnabled",
  "pathWidth",
  "pathDepth",
];

/** Keys synced to GPU uniforms (live, no rebuild). */
export const SURF_KEYS = [
  "grassScale",
  "cliffScale",
  "albedoMul",
  "cliffLow",
  "cliffHigh",
  "cliffPow",
  "cliffMinY",
  "grassJitter",
  "dispStrength",
  "dispCliffMul",
  "dispUvScale",
  "normalGrass",
  "normalCliff",
  "envIntensity",
  "metalness",
  "grassRoughMin",
  // CoH-style ground (dirt patches + anti-tiling + muted palette)
  "dirtScale",
  "dirtAmount",
  "dirtPatchFreq",
  "dirtSlope",
  "normalDirt",
  "macroVar",
  "macroVarFreq",
  "satMul",
  "pathDirtBoost",
];

export const RTS_TERRAIN_DEFAULTS = {
  // ── Heightfield (CoH bowl + choke ridges + selective clamp) ──
  fbmScale: 0.0032,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 1.9,
  heightScale: 52,
  flatness: 1.85,
  macroBlend: 0.28,
  macroFreq: 0.48,
  macroOctaves: 4,
  peakBias: 0.06,
  ridgeBoost: 0.018,
  ridgeFreq: 1.05,
  ridgeOctaves: 2,
  floorY: -8,
  mountainReliefMul: 0.11,
  mountainRidgeAmp: 0.38,
  mountainRidgeFreq: 0.22,
  rampMaxGrade: 0.52,
  slopeClampPasses: 5,
  ridgeClampMul: 2.35,
  playBowlStrength: 0.38,
  playBowlRadius: 0.36,
  chokeRidgeAmp: 30,
  chokeRidgeWidth: 88,
  chokeRidgeWarp: 0.0017,
  edgeMassifAmp: 16,
  edgeMassifStart: 0.6,
  pathsEnabled: true,
  pathWidth: 7.5,
  pathDepth: 0.24,
  // ── Surface / shading (live uniforms) ──
  grassScale: 0.02, // Grass005 UV scale (flats)
  cliffScale: 0.014,
  albedoMul: 0.98,
  cliffLow: 0.03,
  cliffHigh: 0.14,
  cliffPow: 0.6,
  cliffMinY: 0,
  grassJitter: 0.05,
  dispStrength: 0.85,
  dispCliffMul: 1.1,
  dispUvScale: 38,
  normalGrass: 0.72,
  normalCliff: 1.15,
  envIntensity: 0.12,
  metalness: 0,
  grassRoughMin: 0.82,
  // ── CoH-style ground look (live uniforms) ──
  dirtScale: 0.018,
  dirtAmount: 0.28,
  dirtPatchFreq: 0.009,
  dirtSlope: 0.55,
  normalDirt: 1.05,
  macroVar: 0.42,
  macroVarFreq: 0.0032,
  satMul: 0.88,
  pathDirtBoost: 0.94,
  // Per-layer texture overrides — empty string = built-in default path.
  pbrLayers: {
    aerial: { color: "", normal: "", roughness: "", ao: "" },
    cliff: { color: "", normal: "", roughness: "", ao: "" },
    dirt: { color: "", normal: "", roughness: "", ao: "" },
  },
};

export const RTS_TERRAIN_PBR_LAYER_KEYS = ["aerial", "cliff", "dirt"];

export const RTS_TERRAIN_PBR_LAYER_META = {
  aerial: {
    title: "Flats",
    hint: "Grass005 on open ground",
    scaleKey: "grassScale",
    scaleLabel: "UV scale",
    normalKey: "normalGrass",
    normalLabel: "Normal",
    scaleMin: 0.002,
    scaleMax: 0.06,
    scaleStep: 0.001,
  },
  cliff: {
    title: "Cliffs",
    hint: "Steep slopes (triplanar)",
    scaleKey: "cliffScale",
    scaleLabel: "UV scale",
    normalKey: "normalCliff",
    normalLabel: "Normal",
    scaleMin: 0.004,
    scaleMax: 0.04,
    scaleStep: 0.001,
  },
  dirt: {
    title: "Dirt & paths",
    hint: "Patches, tracks, mild slopes",
    scaleKey: "dirtScale",
    scaleLabel: "UV scale",
    normalKey: "normalDirt",
    normalLabel: "Normal",
    scaleMin: 0.005,
    scaleMax: 0.08,
    scaleStep: 0.001,
  },
};

export const RTS_TERRAIN_PBR_DEFAULT_PATHS = {
  aerial: {
    color: `${PBR_PATH}Grass005/Grass005_1K-JPG_Color.jpg`,
    normal: `${PBR_PATH}Grass005/Grass005_1K-JPG_NormalGL.jpg`,
    roughness: `${PBR_PATH}Grass005/Grass005_1K-JPG_Roughness.jpg`,
    ao: `${PBR_PATH}Grass005/Grass005_1K-JPG_AmbientOcclusion.jpg`,
  },
  cliff: {
    color: `${PBR_PATH}Rock028/Rock028_2K-JPG_Color.jpg`,
    normal: `${PBR_PATH}Rock028/Rock028_2K-JPG_NormalGL.jpg`,
    roughness: `${PBR_PATH}Rock028/Rock028_2K-JPG_Roughness.jpg`,
    ao: `${PBR_PATH}Rock028/Rock028_2K-JPG_AmbientOcclusion.jpg`,
  },
  dirt: {
    color: `${PBR_PATH}Ground037/Ground037_1K-JPG_Color.jpg`,
    normal: `${PBR_PATH}Ground037/Ground037_1K-JPG_NormalGL.jpg`,
    roughness: `${PBR_PATH}Ground037/Ground037_1K-JPG_Roughness.jpg`,
    ao: `${PBR_PATH}Ground037/Ground037_1K-JPG_AmbientOcclusion.jpg`,
  },
};

/** Distant soft hills — low amplitude, wide falloff (not cliff-spined lumps). */
const RTS_PEAKS = [
  { cx: -300, cz: 260, r: 820000, a: 11 },
  { cx: 340, cz: -280, r: 880000, a: 13 },
];

/** Cosine bowl — subtracts depth at center, zero at radius edge. */
function stampCraterIntoHeights(
  heights,
  seg,
  vertsX,
  half,
  size,
  cx,
  cz,
  radius,
  depth,
) {
  const r = Math.max(1.5, radius);
  const r2 = r * r;
  for (let zi = 0; zi <= seg; zi++) {
    const z = -half + (zi / seg) * size;
    for (let xi = 0; xi <= seg; xi++) {
      const x = -half + (xi / seg) * size;
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const bowl = Math.cos((d / r) * Math.PI * 0.5);
      const i = zi * vertsX + xi;
      heights[i] -= depth * bowl * bowl;
    }
  }
}

function applyTerrainCraters(heights, seg, vertsX, half, size, craters = []) {
  for (const c of craters) {
    stampCraterIntoHeights(
      heights,
      seg,
      vertsX,
      half,
      size,
      c.x,
      c.z,
      c.radius ?? 5,
      c.depth ?? 1.4,
    );
  }
}

function pickShape(params) {
  const out = {};
  for (const k of SHAPE_KEYS) out[k] = params[k] ?? RTS_TERRAIN_DEFAULTS[k];
  return out;
}

function pickSurf(params) {
  const out = {};
  for (const k of SURF_KEYS) out[k] = params[k] ?? RTS_TERRAIN_DEFAULTS[k];
  return out;
}

function createSeededRandom(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fbm(perlin, x, y, z, octaves, persistence, lacunarity) {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += perlin.noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-6, maxValue);
}

/** Ridged multifractal — natural mountain chains instead of gaussian blobs. */
function ridgedFbm(perlin, x, y, z, octaves, persistence, lacunarity) {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    let n = perlin.noise(x * frequency, y * frequency, z * frequency);
    n = 1 - Math.abs(n);
    n *= n;
    total += n * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-6, maxValue);
}

const ARRAY_RES = 1024;
const TERRAIN_PBR_GEN = 8;
/** Shared PBR material — loaded once, geometry rebuilt separately. */
let _terrainPbr = null;
let _terrainPbrGen = 0;
let _terrainPbrCacheKey = "";

function buildLayerArray(maps, srgb, fillWhite = false) {
  const count = maps.length;
  const stride = ARRAY_RES * ARRAY_RES * 4;
  const data = new Uint8Array(stride * count);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ARRAY_RES;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  for (let i = 0; i < count; i++) {
    const img = maps[i]?.image;
    if (!img) {
      if (fillWhite) data.fill(255, i * stride, (i + 1) * stride);
      continue;
    }
    ctx.clearRect(0, 0, ARRAY_RES, ARRAY_RES);
    ctx.drawImage(img, 0, 0, ARRAY_RES, ARRAY_RES);
    data.set(ctx.getImageData(0, 0, ARRAY_RES, ARRAY_RES).data, i * stride);
  }
  const tex = new THREE.DataArrayTexture(data, ARRAY_RES, ARRAY_RES, count);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function resolveTerrainTexUrl(baseUrl, rel) {
  if (!rel || !String(rel).trim()) return null;
  const s = String(rel).trim();
  if (/^(blob:|https?:|data:)/i.test(s)) return s;
  return new URL(s, baseUrl).href;
}

function loadTerrainTex(loader, baseUrl, rel, srgb) {
  const url = resolveTerrainTexUrl(baseUrl, rel);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb
          ? THREE.SRGBColorSpace
          : THREE.LinearSRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

function pickLayerPath(defaults, custom, key) {
  const v = custom?.[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  const d = defaults?.[key];
  return typeof d === "string" && d.trim() ? d.trim() : null;
}

async function loadLayerMaps(loader, baseUrl, defaults, custom = {}) {
  const loadSlot = async (key, srgb) => {
    const path = pickLayerPath(defaults, custom, key);
    if (!path) return null;
    return loadTerrainTex(loader, baseUrl, path, srgb);
  };
  return {
    color: await loadSlot("color", true),
    normal: await loadSlot("normal", false),
    roughness: await loadSlot("roughness", false),
    ao: await loadSlot("ao", false),
  };
}

function disposeTerrainPbrPack() {
  if (!_terrainPbr) return;
  for (const t of _terrainPbr.allTextures || []) {
    try {
      t.dispose();
    } catch {}
  }
  try {
    _terrainPbr.material?.dispose();
  } catch {}
  _terrainPbr = null;
  _terrainPbrGen = 0;
  _terrainPbrCacheKey = "";
}

/** Swap terrain PBR texture arrays (e.g. after loading external maps in the inspector). */
export async function reloadRtsTerrainPbrTextures(terrainData, params = {}) {
  disposeTerrainPbrPack();
  const pbr = await ensureTerrainPbr(params);
  if (terrainData) {
    if (terrainData.mesh) terrainData.mesh.material = pbr.material;
    terrainData.uniforms = pbr.uniforms;
  }
  syncRtsTerrainUniforms(pbr.uniforms, params);
  return pbr;
}

async function ensureTerrainPbr(params = {}) {
  const pbrKey = JSON.stringify(params.pbrLayers ?? {});
  if (
    _terrainPbr &&
    _terrainPbrGen === TERRAIN_PBR_GEN &&
    _terrainPbrCacheKey === pbrKey
  ) {
    return _terrainPbr;
  }
  disposeTerrainPbrPack();

  const baseUrl = import.meta.url;
  const loader = new THREE.TextureLoader();
  const layersCustom = params.pbrLayers ?? {};

  const uniforms = {};
  const allTextures = [];
  let material;
  let pathMaskTex = null;

  try {
    const aerial = await loadLayerMaps(
      loader,
      baseUrl,
      RTS_TERRAIN_PBR_DEFAULT_PATHS.aerial,
      layersCustom.aerial,
    );
    const cliff = await loadLayerMaps(
      loader,
      baseUrl,
      RTS_TERRAIN_PBR_DEFAULT_PATHS.cliff,
      layersCustom.cliff,
    );
    const dirt = await loadLayerMaps(
      loader,
      baseUrl,
      RTS_TERRAIN_PBR_DEFAULT_PATHS.dirt,
      layersCustom.dirt,
    );

    const layers = [aerial, cliff, dirt];
    for (const m of layers) allTextures.push(...Object.values(m));

    const colorArray = buildLayerArray(
      layers.map((l) => l.color),
      true,
    );
    const normalArray = buildLayerArray(
      layers.map((l) => l.normal),
      false,
    );
    const roughArray = buildLayerArray(
      layers.map((l) => l.roughness),
      false,
    );
    const aoArray = buildLayerArray(
      layers.map((l) => l.ao),
      false,
      true,
    );
    allTextures.push(colorArray, normalArray, roughArray, aoArray);

    const L_AERIAL = int(0);
    const L_CLIFF = int(1);
    const L_DIRT = int(2);
    const surf = pickSurf(RTS_TERRAIN_DEFAULTS);

    const uGrassScale = uniform(surf.grassScale);
    const uCliffScale = uniform(surf.cliffScale);
    const uAlbedoMul = uniform(surf.albedoMul);
    const uCliffLow = uniform(surf.cliffLow);
    const uCliffHigh = uniform(surf.cliffHigh);
    const uCliffPow = uniform(surf.cliffPow);
    const uCliffMinY = uniform(surf.cliffMinY);
    const uGrassJitter = uniform(surf.grassJitter);
    const uDispStrength = uniform(surf.dispStrength);
    const uDispCliffMul = uniform(surf.dispCliffMul);
    const uDispUvScale = uniform(surf.dispUvScale);
    const uNormalGrass = uniform(surf.normalGrass);
    const uNormalCliff = uniform(surf.normalCliff);
    const uEnvIntensity = uniform(surf.envIntensity);
    const uMetalness = uniform(surf.metalness);
    const uGrassRoughMin = uniform(surf.grassRoughMin ?? 0.78);
    const uDirtScale = uniform(surf.dirtScale);
    const uDirtAmount = uniform(surf.dirtAmount);
    const uDirtPatchFreq = uniform(surf.dirtPatchFreq);
    const uDirtSlope = uniform(surf.dirtSlope);
    const uNormalDirt = uniform(surf.normalDirt);
    const uMacroVar = uniform(surf.macroVar);
    const uMacroVarFreq = uniform(surf.macroVarFreq);
    const uSatMul = uniform(surf.satMul);
    const uPathDirtBoost = uniform(surf.pathDirtBoost);
    const uMapHalf = uniform(RTS_MAP_SIZE * 0.5);
    const uMapSize = uniform(RTS_MAP_SIZE);
    const pathMaskData = new Uint8Array(4);
    pathMaskTex = new THREE.DataTexture(
      pathMaskData,
      1,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    pathMaskTex.wrapS = pathMaskTex.wrapT = THREE.ClampToEdgeWrapping;
    pathMaskTex.minFilter = THREE.LinearFilter;
    pathMaskTex.magFilter = THREE.LinearFilter;
    pathMaskTex.needsUpdate = true;
    const pathMaskNode = texture(pathMaskTex);

    Object.assign(uniforms, {
      grassScale: uGrassScale,
      cliffScale: uCliffScale,
      albedoMul: uAlbedoMul,
      cliffLow: uCliffLow,
      cliffHigh: uCliffHigh,
      cliffPow: uCliffPow,
      cliffMinY: uCliffMinY,
      grassJitter: uGrassJitter,
      dispStrength: uDispStrength,
      dispCliffMul: uDispCliffMul,
      dispUvScale: uDispUvScale,
      normalGrass: uNormalGrass,
      normalCliff: uNormalCliff,
      envIntensity: uEnvIntensity,
      metalness: uMetalness,
      grassRoughMin: uGrassRoughMin,
      dirtScale: uDirtScale,
      dirtAmount: uDirtAmount,
      dirtPatchFreq: uDirtPatchFreq,
      dirtSlope: uDirtSlope,
      normalDirt: uNormalDirt,
      macroVar: uMacroVar,
      macroVarFreq: uMacroVarFreq,
      satMul: uSatMul,
      pathDirtBoost: uPathDirtBoost,
      mapHalf: uMapHalf,
      mapSize: uMapSize,
      pathMask: pathMaskNode,
    });

    // Cheap 2D value noise — drives dirt patches + macro variation.
    const hash2 = (p) =>
      fract(mul(sin(dot(p, vec2(127.1, 311.7))), 43758.5453));
    const vnoise = (p) => {
      const i = floor(p);
      const f = fract(p);
      const u = mul(mul(f, f), sub(vec2(3, 3), mul(f, 2)));
      const a = hash2(i);
      const b = hash2(add(i, vec2(1, 0)));
      const c = hash2(add(i, vec2(0, 1)));
      const d = hash2(add(i, vec2(1, 1)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    };

    // aerial / cliff / dirt weights. Dirt = organic noise patches on the
    // flats (CoH muddy-field look) + procedural worn tracks + creep onto
    // mild slopes below the cliff band. Cliff owns steep faces.
    const layerWeights = () => {
      const slope = sub(float(1), abs(normalWorld.y));
      const jitter = hash2(positionWorld.xz);
      const slopeCliff = pow(smoothstep(uCliffLow, uCliffHigh, slope), uCliffPow);
      const heightCliff = max(
        smoothstep(uCliffMinY, add(uCliffMinY, float(14)), positionWorld.y),
        step(uCliffMinY, float(0.5)),
      );
      const wCliff = slopeCliff.mul(heightCliff);
      const pNoise = add(
        mul(vnoise(mul(positionWorld.xz, uDirtPatchFreq)), float(0.65)),
        mul(
          vnoise(
            add(mul(positionWorld.xz, mul(uDirtPatchFreq, float(3.7))), vec2(13.7, 41.3)),
          ),
          float(0.35),
        ),
      );
      const thr = sub(float(1), uDirtAmount);
      const patches = smoothstep(sub(thr, float(0.16)), add(thr, float(0.16)), pNoise);
      const slopeDirt = smoothstep(mul(uCliffLow, float(0.4)), uCliffLow, slope);
      const pathUV = positionWorld.xz.add(uMapHalf).div(uMapSize);
      const pathW = texture(pathMaskNode, pathUV).r;
      let dirtMask = clamp(
        add(patches, mul(slopeDirt, uDirtSlope)),
        float(0),
        float(1),
      );
      dirtMask = clamp(add(dirtMask, mul(pathW, uPathDirtBoost)), float(0), float(1));
      const wDirt = mul(sub(float(1), wCliff), dirtMask);
      const wGrass = mul(
        sub(sub(float(1), wCliff), wDirt),
        add(sub(float(1), uGrassJitter), mul(jitter, uGrassJitter)),
      );
      const wSum = add(add(wGrass, wCliff), wDirt);
      return vec3(wGrass, wCliff, wDirt).div(max(wSum, float(0.001)));
    };

    const layerRGB = (arr, layer, sc) =>
      texture(arr, mul(positionWorld.xz, sc)).depth(layer).rgb;
    const layerR = (arr, layer, sc) =>
      texture(arr, mul(positionWorld.xz, sc)).depth(layer).r;

    // Triplanar cliff — reads on steep faces instead of stretched XZ.
    const triplanarW = () => {
      const n = abs(normalWorld);
      const w = pow(
        n.div(max(add(add(n.x, n.y), n.z), float(0.001))),
        vec3(4, 4, 4),
      );
      const wSum = max(add(add(w.x, w.y), w.z), float(0.001));
      return w.div(wSum);
    };
    const triplanarRGB = (arr, layer, sc) => {
      const wb = triplanarW();
      const sx = texture(arr, mul(positionWorld.zy, sc)).depth(layer).rgb;
      const sy = texture(arr, mul(positionWorld.xz, sc)).depth(layer).rgb;
      const sz = texture(arr, mul(positionWorld.xy, sc)).depth(layer).rgb;
      return add(add(mul(sx, wb.x), mul(sy, wb.y)), mul(sz, wb.z));
    };
    const triplanarR = (arr, layer, sc) => {
      const wb = triplanarW();
      const sx = texture(arr, mul(positionWorld.zy, sc)).depth(layer).r;
      const sy = texture(arr, mul(positionWorld.xz, sc)).depth(layer).r;
      const sz = texture(arr, mul(positionWorld.xy, sc)).depth(layer).r;
      return add(add(mul(sx, wb.x), mul(sy, wb.y)), mul(sz, wb.z));
    };
    const triplanarNormal = (arr, layer, sc, str) => {
      const wb = triplanarW();
      const nX = normalMap(
        texture(arr, mul(positionWorld.zy, sc)).depth(layer),
        vec2(str, str),
      );
      const nY = normalMap(
        texture(arr, mul(positionWorld.xz, sc)).depth(layer),
        vec2(str, str),
      );
      const nZ = normalMap(
        texture(arr, mul(positionWorld.xy, sc)).depth(layer),
        vec2(str, str),
      );
      return normalize(add(add(mul(nX, wb.x), mul(nY, wb.y)), mul(nZ, wb.z)));
    };

    const gRGB = () => layerRGB(colorArray, L_AERIAL, uGrassScale);
    const cRGB = () => triplanarRGB(colorArray, L_CLIFF, uCliffScale);
    const dRGB = () => layerRGB(colorArray, L_DIRT, uDirtScale);
    const gR = () => layerR(roughArray, L_AERIAL, uGrassScale);
    const cR = () => triplanarR(roughArray, L_CLIFF, uCliffScale);
    const dR = () => layerR(roughArray, L_DIRT, uDirtScale);
    const gAo = () => layerR(aoArray, L_AERIAL, uGrassScale);
    const cAo = () => triplanarR(aoArray, L_CLIFF, uCliffScale);
    const dAo = () => layerR(aoArray, L_DIRT, uDirtScale);

    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.envMapIntensity = 0;
    material.colorNode = (() => {
      const lw = layerWeights();
      let albedo = add(
        add(mul(gRGB(), lw.x), mul(cRGB(), lw.y)),
        mul(dRGB(), lw.z),
      );
      // Macro variation — two very-low-frequency noises modulate brightness
      // and wash patches toward a dry yellow-brown. Kills texture tiling at
      // RTS zoom and gives fields that patchy, lived-on look.
      const macroB = vnoise(mul(positionWorld.xz, uMacroVarFreq));
      const macroT = vnoise(
        add(mul(positionWorld.xz, mul(uMacroVarFreq, float(0.37))), vec2(7.3, 2.9)),
      );
      const brightMul = mix(
        float(1),
        add(float(0.74), mul(macroB, float(0.5))),
        uMacroVar,
      );
      const dryTint = mix(
        vec3(1, 1, 1),
        vec3(1.1, 1.04, 0.8),
        mul(mul(macroT, macroT), uMacroVar),
      );
      albedo = mul(mul(albedo, brightMul), dryTint);
      // Muted wartime palette.
      const lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
      albedo = mix(vec3(lum, lum, lum), albedo, uSatMul);
      return mul(albedo, uAlbedoMul);
    })();
    material.roughnessNode = (() => {
      const lw = layerWeights();
      const blended = add(
        add(mul(gR(), lw.x), mul(cR(), lw.y)),
        mul(dR(), lw.z),
      );
      // Grass005 roughness map + floor on grass-weighted areas (no glossy turf).
      const matte = max(blended, mul(lw.x, uGrassRoughMin));
      return clamp(matte, float(0.55), float(1));
    })();
    material.aoNode = (() => {
      const lw = layerWeights();
      return clamp(
        add(add(mul(gAo(), lw.x), mul(cAo(), lw.y)), mul(dAo(), lw.z)),
        float(0.25),
        float(1),
      );
    })();
    material.normalNode = (() => {
      const lw = layerWeights();
      const nG = normalMap(
        texture(normalArray, mul(positionWorld.xz, uGrassScale)).depth(L_AERIAL),
        vec2(uNormalGrass, uNormalGrass),
      );
      const nC = triplanarNormal(normalArray, L_CLIFF, uCliffScale, uNormalCliff);
      const nD = normalMap(
        texture(normalArray, mul(positionWorld.xz, uDirtScale)).depth(L_DIRT),
        vec2(uNormalDirt, uNormalDirt),
      );
      return normalize(
        add(add(mul(nG, lw.x), mul(nC, lw.y)), mul(nD, lw.z)),
      );
    })();
    // No positionNode displacement — shadow maps use mesh geometry; vertex
    // displacement caused unit shadows to float above the visible surface.
    material.metalnessNode = uMetalness;
    material.color = new THREE.Color(0xffffff);
  } catch (err) {
    console.warn("[rts-terrain] PBR textures failed to load — matte fallback.", err);
    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = color(0x4a5c3a);
    material.roughnessNode = float(0.985);
    material.metalnessNode = float(0);
  }

  _terrainPbrGen = TERRAIN_PBR_GEN;
  _terrainPbrCacheKey = pbrKey;
  _terrainPbr = { material, uniforms, allTextures, pathMaskTex };
  return _terrainPbr;
}

function gridIdxLocal(xi, zi, vertsX) {
  return zi * vertsX + xi;
}

function sampleHeightBilinear(heights, seg, vertsX, half, size, x, z) {
  const u = ((x + half) / size) * seg;
  const v = ((z + half) / size) * seg;
  const xi = Math.floor(u);
  const zi = Math.floor(v);
  const fx = u - xi;
  const fz = v - zi;
  const x0 = THREE.MathUtils.clamp(xi, 0, seg);
  const x1 = THREE.MathUtils.clamp(xi + 1, 0, seg);
  const z0 = THREE.MathUtils.clamp(zi, 0, seg);
  const z1 = THREE.MathUtils.clamp(zi + 1, 0, seg);
  const h00 = heights[gridIdxLocal(x0, z0, vertsX)];
  const h10 = heights[gridIdxLocal(x1, z0, vertsX)];
  const h01 = heights[gridIdxLocal(x0, z1, vertsX)];
  const h11 = heights[gridIdxLocal(x1, z1, vertsX)];
  const hx0 = h00 * (1 - fx) + h10 * fx;
  const hx1 = h01 * (1 - fx) + h11 * fx;
  return hx0 * (1 - fz) + hx1 * fz;
}

/**
 * Smooth road corridors — blend heightfield toward centerline profile (pre-flatten snapshot).
 * @param {Array<{ points: number[][], width?: number }>} roads
 */
export function applyRoadFlattenToHeights(
  heights,
  seg,
  vertsX,
  half,
  size,
  roads = [],
  opts = {},
) {
  if (!roads?.length) return;
  const feather = opts.feather ?? 3.5;
  const pre = new Float32Array(heights);
  const samplePre = (x, z) =>
    sampleHeightBilinear(pre, seg, vertsX, half, size, x, z);

  for (let zi = 0; zi <= seg; zi++) {
    for (let xi = 0; xi <= seg; xi++) {
      const x = -half + (xi / seg) * size;
      const z = -half + (zi / seg) * size;
      let bestW = 0;
      let bestH = heights[gridIdxLocal(xi, zi, vertsX)];

      for (const road of roads) {
        const pts = road.points;
        if (!pts || pts.length < 2) continue;
        const halfW = (road.width ?? 8) * 0.5;

        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, z0] = pts[i];
          const [x1, z1] = pts[i + 1];
          const sdx = x1 - x0;
          const sdz = z1 - z0;
          const len2 = sdx * sdx + sdz * sdz;
          let t = 0;
          if (len2 > 1e-6) {
            t = Math.max(
              0,
              Math.min(1, ((x - x0) * sdx + (z - z0) * sdz) / len2),
            );
          }
          const cx = x0 + t * sdx;
          const cz = z0 + t * sdz;
          const dist = Math.hypot(x - cx, z - cz);
          const inner = halfW;
          const outer = halfW + feather;
          if (dist >= outer) continue;

          const h0 = samplePre(x0, z0);
          const h1 = samplePre(x1, z1);
          const targetH = h0 * (1 - t) + h1 * t;

          let w = 1;
          if (dist > inner) {
            const edge = (dist - inner) / Math.max(outer - inner, 1e-4);
            w = 1 - edge * edge * (3 - 2 * edge);
          }

          if (w > bestW) {
            bestW = w;
            bestH = targetH;
          }
        }
      }

      if (bestW > 0) {
        const idx = gridIdxLocal(xi, zi, vertsX);
        heights[idx] = heights[idx] * (1 - bestW) + bestH * bestW;
      }
    }
  }
}

function clampHeightsSlopeMasked(
  heights,
  ridgeMask,
  seg,
  vertsX,
  maxDelta,
  ridgeMul,
  passes = 1,
) {
  const rm = Math.max(1, ridgeMul);
  for (let pass = 0; pass < passes; pass++) {
    for (let zi = 0; zi <= seg; zi++) {
      for (let xi = 0; xi <= seg; xi++) {
        const i = gridIdxLocal(xi, zi, vertsX);
        const localMax = maxDelta * (1 + (ridgeMask[i] ?? 0) * (rm - 1));
        let h = heights[i];
        if (xi < seg) {
          const j = gridIdxLocal(xi + 1, zi, vertsX);
          const dh = heights[j] - h;
          if (dh > localMax) heights[j] = h + localMax;
          else if (dh < -localMax) heights[j] = h - localMax;
        }
        if (zi < seg) {
          const j = gridIdxLocal(xi, zi + 1, vertsX);
          const dh = heights[j] - h;
          if (dh > localMax) heights[j] = h + localMax;
          else if (dh < -localMax) heights[j] = h - localMax;
        }
      }
    }
  }
}

function smooth01(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function playBowlFactor(x, z, half, strength, radiusFrac) {
  const r = Math.hypot(x, z) / Math.max(1, half * radiusFrac);
  return smooth01(1, 0.12, r) * strength;
}

function chokeRidgeFactor(x, z, perlin, width, warp, amp) {
  const w1 = perlin.noise(x * warp + 1.2, 0.5, z * warp * 0.72) * width * 0.58;
  const w2 = perlin.noise(x * warp * 0.82, 1.1, z * warp + 2.4) * width * 0.48;
  const d1 = Math.abs(z - w1);
  const d2 = Math.abs(x - w2);
  const r1 = smooth01(width * 1.35, width * 0.07, d1);
  const r2 = smooth01(width * 1.15, width * 0.06, d2);
  return Math.max(r1, r2 * 0.9) * amp;
}

function edgeMassifFactor(x, z, half, startFrac, amp) {
  const r = Math.max(Math.abs(x), Math.abs(z)) / half;
  return smooth01(startFrac, 0.94, r) * amp;
}

/** Authored waypoints — segments are valley-traced on the baked height grid. */
const PROCEDURAL_PATH_ROUTES = [
  [[0, 520], [0, 300], [0, 120], [0, -120], [0, -300], [0, -520]],
  [[-470, 70], [-240, 35], [0, 0], [240, -35], [470, -70]],
  [[-320, 400], [-150, 200], [0, 60]],
  [[320, 400], [150, 200], [0, 60]],
  [[-320, -400], [-150, -200], [0, -60]],
  [[320, -400], [150, -200], [0, -60]],
];

function snapGrid(x, z, half, size, seg, step) {
  const u = ((x + half) / size) * seg;
  const v = ((z + half) / size) * seg;
  return {
    xi: THREE.MathUtils.clamp(Math.round(u / step) * step, 0, seg),
    zi: THREE.MathUtils.clamp(Math.round(v / step) * step, 0, seg),
  };
}

function traceLowPath(heights, seg, vertsX, half, size, x0, z0, x1, z1, step = 2) {
  const hAt = (xi, zi) => heights[zi * vertsX + xi];
  const start = snapGrid(x0, z0, half, size, seg, step);
  const end = snapGrid(x1, z1, half, size, seg, step);
  const key = (xi, zi) => `${xi},${zi}`;
  const open = [];
  const cameFrom = new Map();
  const gScore = new Map();
  const sk = key(start.xi, start.zi);
  gScore.set(sk, 0);
  open.push({
    xi: start.xi,
    zi: start.zi,
    f: Math.hypot(start.xi - end.xi, start.zi - end.zi),
  });

  const neighbors = [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
    [step, step],
    [step, -step],
    [-step, step],
    [-step, -step],
  ];

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.xi === end.xi && cur.zi === end.zi) {
      const path = [];
      let ck = key(cur.xi, cur.zi);
      let node = { xi: cur.xi, zi: cur.zi };
      while (node) {
        path.push({
          x: -half + (node.xi / seg) * size,
          z: -half + (node.zi / seg) * size,
        });
        const prev = cameFrom.get(ck);
        if (!prev) break;
        node = prev;
        ck = key(node.xi, node.zi);
      }
      path.reverse();
      return path;
    }
    const ck = key(cur.xi, cur.zi);
    const curG = gScore.get(ck) ?? Infinity;
    const prev = cameFrom.get(ck);
    for (const [dx, dz] of neighbors) {
      const nxi = cur.xi + dx;
      const nzi = cur.zi + dz;
      if (nxi < 0 || nzi < 0 || nxi > seg || nzi > seg) continue;
      const dist = Math.hypot(dx, dz);
      const dh = hAt(nxi, nzi) - hAt(cur.xi, cur.zi);
      let turnCost = 0;
      if (prev?.dx !== undefined) {
        if (prev.dx !== dx || prev.dz !== dz) {
          turnCost = dist * (Math.abs(prev.dx) === step && Math.abs(prev.dz) === step ? 1.1 : 0.45);
        }
      }
      const cost =
        dist * (1 + Math.max(0, dh) * 2.8) +
        hAt(nxi, nzi) * 0.06 +
        turnCost;
      const nk = key(nxi, nzi);
      const tentG = curG + cost;
      if (tentG >= (gScore.get(nk) ?? Infinity)) continue;
      cameFrom.set(nk, { xi: cur.xi, zi: cur.zi, dx, dz });
      gScore.set(nk, tentG);
      const h = Math.hypot(nxi - end.xi, nzi - end.zi);
      open.push({ xi: nxi, zi: nzi, f: tentG + h });
    }
  }

  return [
    { x: x0, z: z0 },
    { x: x1, z: z1 },
  ];
}

function traceRouteWaypoints(heights, seg, vertsX, half, size, waypoints, step = 2) {
  const merged = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, z0] = waypoints[i];
    const [x1, z1] = waypoints[i + 1];
    const segPath = traceLowPath(heights, seg, vertsX, half, size, x0, z0, x1, z1, step);
    if (i > 0 && segPath.length) segPath.shift();
    merged.push(...segPath);
  }
  return merged;
}

function catmullRom2D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

/** Smooth A* polyline into a gentle winding track. */
function resampleCatmullRom(points, subdiv = 8) {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const out = [];
    const steps = Math.max(4, subdiv * 4);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push({
        x: THREE.MathUtils.lerp(points[0].x, points[1].x, t),
        z: THREE.MathUtils.lerp(points[0].z, points[1].z, t),
      });
    }
    return out;
  }
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < subdiv; j++) {
      out.push(catmullRom2D(p0, p1, p2, p3, j / subdiv));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function stampPathCorridor(mask, vertsX, half, size, seg, points, halfWidth) {
  if (points.length < 2) return;
  const hw = Math.max(2, halfWidth);
  const outer = hw * 1.55;
  const inner = hw * 0.42;
  const stepM = Math.max(0.65, size / seg) * 0.5;
  const cell = size / seg;
  const rCells = Math.ceil(outer / cell) + 1;

  for (let p = 0; p < points.length - 1; p++) {
    const a = points[p];
    const b = points[p + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = THREE.MathUtils.lerp(a.x, b.x, t);
      const pz = THREE.MathUtils.lerp(a.z, b.z, t);
      const u = ((px + half) / size) * seg;
      const v = ((pz + half) / size) * seg;
      const cx = Math.round(u);
      const cz = Math.round(v);
      for (let dz = -rCells; dz <= rCells; dz++) {
        for (let dx = -rCells; dx <= rCells; dx++) {
          const xi = cx + dx;
          const zi = cz + dz;
          if (xi < 0 || zi < 0 || xi > seg || zi > seg) continue;
          const wx = -half + (xi / seg) * size;
          const wz = -half + (zi / seg) * size;
          const d = Math.hypot(wx - px, wz - pz);
          if (d > outer) continue;
          const w = d <= inner ? 1 : smooth01(outer, inner, d);
          const i = zi * vertsX + xi;
          mask[i] = Math.max(mask[i], w);
        }
      }
    }
  }
}

function blurPathMask(mask, vertsX, seg, passes = 2) {
  const tmp = new Float32Array(mask.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let zi = 0; zi <= seg; zi++) {
      for (let xi = 0; xi <= seg; xi++) {
        let sum = 0;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xj = xi + dx;
            const zj = zi + dz;
            if (xj < 0 || zj < 0 || xj > seg || zj > seg) continue;
            sum += mask[zj * vertsX + xj];
            n++;
          }
        }
        tmp[zi * vertsX + xi] = sum / Math.max(1, n);
      }
    }
    mask.set(tmp);
  }
}

function buildProceduralPathMask(heights, seg, vertsX, half, size, routes, halfWidth) {
  const mask = new Float32Array(vertsX * vertsX);
  for (const route of routes) {
    const traced = traceRouteWaypoints(heights, seg, vertsX, half, size, route);
    const smooth = resampleCatmullRom(traced, 10);
    stampPathCorridor(mask, vertsX, half, size, seg, smooth, halfWidth);
  }
  blurPathMask(mask, vertsX, seg, 2);
  return mask;
}

function applyPathDepression(heights, mask, depth) {
  if (!depth) return;
  for (let i = 0; i < heights.length; i++) {
    heights[i] -= mask[i] * depth;
  }
}

function createOrUpdatePathMaskTexture(tex, pathMask, vertsX) {
  const data = new Uint8Array(pathMask.length);
  for (let i = 0; i < pathMask.length; i++) {
    data[i] = Math.round(THREE.MathUtils.clamp(pathMask[i], 0, 1) * 255);
  }
  if (!tex || tex.image.width !== vertsX) {
    const next = new THREE.DataTexture(
      data,
      vertsX,
      vertsX,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    next.wrapS = next.wrapT = THREE.ClampToEdgeWrapping;
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
    next.needsUpdate = true;
    return next;
  }
  tex.image.data = data;
  tex.needsUpdate = true;
  return tex;
}

/** Push path mask + map extents onto terrain material uniforms. */
export function syncRtsTerrainPathMask(terrainData, pathMaskTex, half, size) {
  const u = terrainData?.uniforms;
  if (!u?.pathMask) return;
  if (pathMaskTex) u.pathMask.value = pathMaskTex;
  if (u.mapHalf) u.mapHalf.value = half;
  if (u.mapSize) u.mapSize.value = size;
}

/** Bake height samples + sampler (no GPU geometry allocation). */
function bakeTerrainHeightfield(size, segments, params = {}) {
  const ts = pickShape({ ...RTS_TERRAIN_DEFAULTS, ...params });
  const perlin = new ImprovedNoise(createSeededRandom(4242));

  function mountainRelief(x, z) {
    let sum = 0;
    for (const p of RTS_PEAKS) {
      const dx = x - p.cx;
      const dz = z - p.cz;
      sum += Math.exp(-(dx * dx + dz * dz) / p.r) * p.a;
    }
    return sum * ts.mountainReliefMul;
  }

  function rawHeight(x, z, half) {
    const nx = x * ts.fbmScale;
    const nz = z * ts.fbmScale;
    const oct = THREE.MathUtils.clamp(Math.round(ts.octaves), 1, 14);
    const mOct = THREE.MathUtils.clamp(Math.round(ts.macroOctaves), 1, 8);
    const rOct = THREE.MathUtils.clamp(Math.round(ts.ridgeOctaves), 1, 8);
    const mb = THREE.MathUtils.clamp(ts.macroBlend, 0, 1);
    const mf = ts.macroFreq;
    const macro =
      fbm(perlin, nx * mf + 1.8, 0, nz * mf - 1.2, mOct, ts.persistence, ts.lacunarity) *
        2 -
      1;
    let h = fbm(perlin, nx, 0, nz, oct, ts.persistence, ts.lacunarity);
    let t = h * 0.5 + 0.5;
    const flat = Math.max(0.15, ts.flatness);
    t = Math.pow(Math.min(1, Math.max(1e-7, t)), 1 / flat);
    h = t * 2 - 1;
    h = h * (1 - mb) + macro * mb;
    const rid =
      fbm(
        perlin,
        nx * ts.ridgeFreq + 0.2,
        2.4,
        nz * ts.ridgeFreq - 0.3,
        rOct,
        ts.persistence * 0.96,
        ts.lacunarity,
      ) *
        2 -
      1;
    h += Math.max(0, rid) * ts.ridgeBoost;
    const pk = Math.max(0, h);
    h += pk * pk * Math.max(0, ts.peakBias);

    const mFreq = ts.mountainRidgeFreq ?? RTS_TERRAIN_DEFAULTS.mountainRidgeFreq;
    const region =
      fbm(perlin, nx * mFreq + 2.2, 0, nz * mFreq - 1.6, 3, 0.52, 2.05) * 0.5 +
      0.5;
    const mMask = THREE.MathUtils.smoothstep(region, 0.5, 0.74);
    const ridged = ridgedFbm(
      perlin,
      nx * 0.88 + 0.4,
      0.6,
      nz * 0.88,
      5,
      0.5,
      2.08,
    );
    h += ridged * mMask * (ts.mountainRidgeAmp ?? RTS_TERRAIN_DEFAULTS.mountainRidgeAmp);

    let y = h * ts.heightScale + mountainRelief(x, z);

    const bowl = playBowlFactor(
      x,
      z,
      half,
      ts.playBowlStrength ?? RTS_TERRAIN_DEFAULTS.playBowlStrength,
      ts.playBowlRadius ?? RTS_TERRAIN_DEFAULTS.playBowlRadius,
    );
    y *= 1 - bowl * 0.55;

    const choke = chokeRidgeFactor(
      x,
      z,
      perlin,
      ts.chokeRidgeWidth ?? RTS_TERRAIN_DEFAULTS.chokeRidgeWidth,
      ts.chokeRidgeWarp ?? RTS_TERRAIN_DEFAULTS.chokeRidgeWarp,
      1,
    );
    const chokeRidged = ridgedFbm(perlin, nx * 1.15, 0.4, nz * 1.15, 4, 0.48, 2.1);
    y += choke * chokeRidged * (ts.chokeRidgeAmp ?? RTS_TERRAIN_DEFAULTS.chokeRidgeAmp);

    y += edgeMassifFactor(
      x,
      z,
      half,
      ts.edgeMassifStart ?? RTS_TERRAIN_DEFAULTS.edgeMassifStart,
      ts.edgeMassifAmp ?? RTS_TERRAIN_DEFAULTS.edgeMassifAmp,
    );

    return Math.max(ts.floorY, y);
  }

  const seg = THREE.MathUtils.clamp(Math.round(segments), 32, 512);
  const vertsX = seg + 1;
  const heights = new Float32Array(vertsX * vertsX);
  const ridgeMask = new Float32Array(vertsX * vertsX);
  const half = size * 0.5;

  function gridIdx(xi, zi) {
    return zi * vertsX + xi;
  }

  function gridWorld(xi, zi) {
    return {
      x: -half + (xi / seg) * size,
      z: -half + (zi / seg) * size,
    };
  }

  for (let zi = 0; zi <= seg; zi++) {
    for (let xi = 0; xi <= seg; xi++) {
      const { x, z } = gridWorld(xi, zi);
      const i = gridIdx(xi, zi);
      heights[i] = rawHeight(x, z, half);
      const choke = chokeRidgeFactor(
        x,
        z,
        perlin,
        ts.chokeRidgeWidth ?? RTS_TERRAIN_DEFAULTS.chokeRidgeWidth,
        ts.chokeRidgeWarp ?? RTS_TERRAIN_DEFAULTS.chokeRidgeWarp,
        1,
      );
      ridgeMask[i] = THREE.MathUtils.clamp(choke, 0, 1);
    }
  }

  const edgeDist = size / seg;
  const maxDelta = edgeDist * THREE.MathUtils.clamp(ts.rampMaxGrade, 0.15, 0.95);
  const passes = THREE.MathUtils.clamp(Math.round(ts.slopeClampPasses), 0, 24);
  const ridgeMul = THREE.MathUtils.clamp(
    ts.ridgeClampMul ?? RTS_TERRAIN_DEFAULTS.ridgeClampMul,
    1,
    4,
  );
  clampHeightsSlopeMasked(heights, ridgeMask, seg, vertsX, maxDelta, ridgeMul, passes);

  const flattenPads = (params.flattenPads || []).map((pad) => ({
    x: pad.x,
    z: pad.z,
    radius: pad.radius ?? 34,
    height: pad.height,
    core: pad.core ?? 0.55,
  }));

  function padTargetHeight(pad) {
    if (pad.height != null && Number.isFinite(pad.height)) return pad.height;
    const r = pad.radius ?? 34;
    const r2 = r * r;
    let maxH = -Infinity;
    for (let zi = 0; zi <= seg; zi++) {
      for (let xi = 0; xi <= seg; xi++) {
        const { x, z } = gridWorld(xi, zi);
        const dx = x - pad.x;
        const dz = z - pad.z;
        if (dx * dx + dz * dz > r2) continue;
        maxH = Math.max(maxH, heights[gridIdx(xi, zi)]);
      }
    }
    return Number.isFinite(maxH) ? maxH : 0;
  }

  function padBlendWeight(t, coreFrac = 0.55) {
    if (t <= coreFrac) return 1;
    const u = (t - coreFrac) / Math.max(1e-4, 1 - coreFrac);
    return 1 - u * u * (3 - 2 * u);
  }

  function applyFlattenPads() {
    for (const pad of flattenPads) {
      const targetH = padTargetHeight(pad);
      const core = pad.core ?? 0.55;
      for (let zi = 0; zi <= seg; zi++) {
        for (let xi = 0; xi <= seg; xi++) {
          const { x, z } = gridWorld(xi, zi);
          const dx = x - pad.x;
          const dz = z - pad.z;
          const r = pad.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          const t = d / r;
          const w = padBlendWeight(t, core);
          const i = gridIdx(xi, zi);
          heights[i] = heights[i] * (1 - w) + targetH * w;
        }
      }
    }
  }

  let pathMask = new Float32Array(vertsX * vertsX);
  if (ts.pathsEnabled !== false) {
    pathMask = buildProceduralPathMask(
      heights,
      seg,
      vertsX,
      half,
      size,
      PROCEDURAL_PATH_ROUTES,
      (ts.pathWidth ?? RTS_TERRAIN_DEFAULTS.pathWidth) * 0.5,
    );
    applyPathDepression(heights, pathMask, ts.pathDepth ?? RTS_TERRAIN_DEFAULTS.pathDepth);
    clampHeightsSlopeMasked(heights, ridgeMask, seg, vertsX, maxDelta, ridgeMul, 2);
  }

  applyTerrainCraters(heights, seg, vertsX, half, size, params.craters ?? []);

  // Flatten after paths/craters so pads stay level (path crossings won't carve through).
  applyFlattenPads();

  function sampleHeightGrid(x, z) {
    const u = ((x + half) / size) * seg;
    const v = ((z + half) / size) * seg;
    const xi = Math.floor(u);
    const zi = Math.floor(v);
    const fx = u - xi;
    const fz = v - zi;
    const x0 = THREE.MathUtils.clamp(xi, 0, seg);
    const x1 = THREE.MathUtils.clamp(xi + 1, 0, seg);
    const z0 = THREE.MathUtils.clamp(zi, 0, seg);
    const z1 = THREE.MathUtils.clamp(zi + 1, 0, seg);
    const h00 = heights[gridIdx(x0, z0)];
    const h10 = heights[gridIdx(x1, z0)];
    const h01 = heights[gridIdx(x0, z1)];
    const h11 = heights[gridIdx(x1, z1)];
    const hx0 = h00 * (1 - fx) + h10 * fx;
    const hx1 = h01 * (1 - fx) + h11 * fx;
    return hx0 * (1 - fz) + hx1 * fz;
  }

  return {
    heights,
    pathMask,
    seg,
    vertsX,
    half,
    mapSize: size,
    getHeight: (x, z) => sampleHeightGrid(x, z),
    shape: ts,
  };
}

/** Update an existing plane heightfield in-place (keeps WebGPU buffers alive). */
function applyHeightsToGeometry(geo, heights, seg, vertsX) {
  const pos = geo?.attributes?.position;
  const wantVerts = vertsX * vertsX;
  if (!pos || pos.count !== wantVerts) return false;

  const arr = pos.array;
  for (let i = 0; i < wantVerts; i++) {
    arr[i * 3 + 1] = heights[i];
  }
  pos.setUsage(THREE.DynamicDrawUsage);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const normal = geo.attributes.normal;
  if (normal) {
    normal.setUsage(THREE.DynamicDrawUsage);
    normal.needsUpdate = true;
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return true;
}

/** Bake heightfield mesh only (cheap compared to texture/material setup). */
function buildTerrainHeightfield(size, segments, params = {}) {
  const baked = bakeTerrainHeightfield(size, segments, params);
  const geo = new THREE.PlaneGeometry(size, size, baked.seg, baked.seg);
  geo.rotateX(-Math.PI / 2);
  applyHeightsToGeometry(geo, baked.heights, baked.seg, baked.vertsX);
  return {
    geo,
    getHeight: baked.getHeight,
    heights: baked.heights,
    pathMask: baked.pathMask,
    seg: baked.seg,
    vertsX: baked.vertsX,
    half: baked.half,
    mapSize: baked.mapSize,
    shape: baked.shape,
  };
}

function applyBakedPathMask(terrainData, baked, uniforms) {
  const tex = createOrUpdatePathMaskTexture(
    terrainData?.pathMaskTex,
    baked.pathMask,
    baked.vertsX,
  );
  if (terrainData) terrainData.pathMaskTex = tex;
  syncRtsTerrainPathMask(
    { uniforms: uniforms ?? terrainData?.uniforms },
    tex,
    baked.half,
    baked.mapSize,
  );
  return tex;
}

export async function createRtsTerrain(
  size = RTS_MAP_SIZE,
  segments = 288,
  params = {},
) {
  const surf = pickSurf({ ...RTS_TERRAIN_DEFAULTS, ...params });
  const pbr = await ensureTerrainPbr(params);
  syncRtsTerrainUniforms(pbr.uniforms, params);
  const built = buildTerrainHeightfield(size, segments, params);
  const mesh = new THREE.Mesh(built.geo, pbr.material);
  mesh.name = "RtsTerrain";
  mesh.receiveShadow = true;
  built.geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  if (built.geo.attributes.normal) {
    built.geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  }
  const pathMaskTex = applyBakedPathMask({ uniforms: pbr.uniforms }, built, pbr.uniforms);

  return {
    mesh,
    getHeight: built.getHeight,
    heights: built.heights,
    seg: built.seg,
    vertsX: built.vertsX,
    half: built.half,
    mapSize: built.mapSize,
    craters: params.craters ?? [],
    uniforms: pbr.uniforms,
    pathMaskTex,
    dispose: () => built.geo.dispose(),
    shape: built.shape,
    surf,
  };
}

/** Re-bake heightfield onto an existing terrain mesh (keeps material + scene node). */
export async function rebuildRtsTerrainHeight(
  terrainData,
  size = RTS_MAP_SIZE,
  segments = 288,
  params = {},
  { beforeGeometrySwap } = {},
) {
  const pbr = await ensureTerrainPbr(params);
  syncRtsTerrainUniforms(terrainData.uniforms ?? pbr.uniforms, params);
  const craterList = terrainData.craters ?? params.craters ?? [];
  const baked = bakeTerrainHeightfield(size, segments, {
    ...params,
    craters: craterList,
  });
  const mesh = terrainData.mesh;
  const geo = mesh.geometry;
  const wantVerts = baked.vertsX * baked.vertsX;
  const curVerts = geo?.attributes?.position?.count;

  if (
    curVerts === wantVerts &&
    applyHeightsToGeometry(geo, baked.heights, baked.seg, baked.vertsX)
  ) {
    terrainData.getHeight = baked.getHeight;
    terrainData.heights = baked.heights;
    terrainData.seg = baked.seg;
    terrainData.vertsX = baked.vertsX;
    terrainData.half = baked.half;
    terrainData.mapSize = baked.mapSize;
    terrainData.shape = baked.shape;
    if (!terrainData.uniforms) terrainData.uniforms = pbr.uniforms;
    applyBakedPathMask(terrainData, baked, pbr.uniforms);
    return { inPlace: true };
  }

  const built = buildTerrainHeightfield(size, segments, {
    ...params,
    craters: craterList,
  });
  if (beforeGeometrySwap) await beforeGeometrySwap();
  mesh.geometry = built.geo;
  terrainData.getHeight = built.getHeight;
  terrainData.heights = built.heights;
  terrainData.seg = built.seg;
  terrainData.vertsX = built.vertsX;
  terrainData.half = built.half;
  terrainData.mapSize = built.mapSize;
  terrainData.shape = built.shape;
  if (!terrainData.uniforms) terrainData.uniforms = pbr.uniforms;
  applyBakedPathMask(terrainData, built, pbr.uniforms);
  return { inPlace: false };
}

/**
 * Deform terrain in-place for an artillery crater (cheap — no full re-bake).
 * @returns {boolean} true if the mesh was updated
 */
export function stampRtsTerrainCrater(terrainData, x, z, opts = {}) {
  if (!terrainData?.heights?.length || !terrainData.mesh?.geometry) return false;
  const crater = {
    x,
    z,
    radius: opts.radius ?? 5,
    depth: opts.depth ?? 1.4,
  };
  if (!terrainData.craters) terrainData.craters = [];
  terrainData.craters.push(crater);
  stampCraterIntoHeights(
    terrainData.heights,
    terrainData.seg,
    terrainData.vertsX,
    terrainData.half,
    terrainData.mapSize,
    crater.x,
    crater.z,
    crater.radius,
    crater.depth,
  );
  return applyHeightsToGeometry(
    terrainData.mesh.geometry,
    terrainData.heights,
    terrainData.seg,
    terrainData.vertsX,
  );
}

/**
 * Batched crater stamping — applyHeightsToGeometry (full computeVertexNormals
 * over the whole grid) is the expensive part, so stamp N craters into the
 * heights first and pay the geometry update ONCE. Combat barrages call this
 * via a debounce instead of stamping per shell.
 */
export function stampRtsTerrainCraters(terrainData, list = []) {
  if (
    !terrainData?.heights?.length ||
    !terrainData.mesh?.geometry ||
    !list.length
  ) {
    return false;
  }
  if (!terrainData.craters) terrainData.craters = [];
  for (const c of list) {
    const crater = {
      x: c.x,
      z: c.z,
      radius: c.radius ?? 5,
      depth: c.depth ?? 1.4,
    };
    terrainData.craters.push(crater);
    stampCraterIntoHeights(
      terrainData.heights,
      terrainData.seg,
      terrainData.vertsX,
      terrainData.half,
      terrainData.mapSize,
      crater.x,
      crater.z,
      crater.radius,
      crater.depth,
    );
  }
  return applyHeightsToGeometry(
    terrainData.mesh.geometry,
    terrainData.heights,
    terrainData.seg,
    terrainData.vertsX,
  );
}

/** Push all surface uniform values from a params object. */
export function syncRtsTerrainUniforms(uniforms, params = {}) {
  if (!uniforms) return;
  const surf = pickSurf({ ...RTS_TERRAIN_DEFAULTS, ...params });
  for (const k of SURF_KEYS) {
    if (uniforms[k]) uniforms[k].value = surf[k];
  }
}
