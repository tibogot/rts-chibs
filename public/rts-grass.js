/**
 * RTS grass — port of game-engine-v1's hybrid grass (Revo skeleton: camera-
 * following wrap tile + compute SSBO + indirect-draw compaction + tiny VS,
 * wearing the Gemini skin: crossed ribbons, arc bend, Voronoi clumps, color
 * variation, AO, SSS). Proven ~3× cheaper GPU than the patch-based system at
 * look parity (grass-lab.html), 1 draw per ring.
 *
 * Self-contained for the RTS lab (no v2 imports). Trimmed vs the v2 module:
 * no cliff rings, no terrain tint, no spec highlights, no paint system, no
 * player interaction — density comes from a baked mask (water + exclusion
 * circles), anchor = the RTS camera focus.
 *
 * createRtsGrass({...}) → { update, sync, setEnabled, setSunDir, rebake }
 */
import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  atan,
  atomicAdd,
  atomicStore,
  attribute,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  mix,
  negate,
  normalize,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  storage,
  texture,
  time,
  uint,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  positionLocal,
  normalLocal,
  cameraPosition,
  PI2,
} from "three/tsl";

// ── TSL helpers (ported from v2 tsl-utils / revoGrass) ──────────────────────

const hash42 = Fn(([pIn]) => {
  const p = vec2(pIn);
  const p4 = fract(
    vec4(p.x, p.y, p.x, p.y).mul(vec4(443.897, 441.423, 437.195, 429.123)),
  );
  const d = dot(p4, p4.wzxy.add(19.19));
  const r = p4.add(d);
  return fract(r.xxyz.add(r.yzzw).mul(r.zywx));
});

/** Infinite tile: shift local offsets when anchor moves, wrap into [-half, half]. */
const wrapTileOffsetXZ = Fn(([offsetXZ, deltaXZ, tileSize]) => {
  const shifted = offsetXZ.sub(deltaXZ);
  const half = tileSize.mul(0.5);
  const wrappedX = shifted.x.add(half).mod(tileSize).sub(half);
  const wrappedZ = shifted.y.add(half).mod(tileSize).sub(half);
  return vec2(wrappedX, wrappedZ);
});

/** NDC frustum test with blade-radius padding (Revo visibility). */
const computeFrustumVisibility = Fn(
  ([worldPos, cameraMatrix, fx, fy, radius, padNdcX, padNdcYNear, padNdcYFar]) => {
    const EPS = float(1e-6);
    const one = float(1);
    const clip = cameraMatrix.mul(vec4(worldPos, 1));
    const invW = one.div(clip.w);
    const ndc = clip.xyz.mul(invW);
    const eyeDepthAbs = clip.w.abs().max(EPS);
    const rNdcX = fx.mul(radius).div(eyeDepthAbs).add(padNdcX);
    const rNdcY = fy.mul(radius).div(eyeDepthAbs);
    const rNdcYNear = rNdcY.add(padNdcYNear);
    const rNdcYFar = rNdcY.sub(padNdcYFar);
    const visX = step(one.negate().sub(rNdcX), ndc.x).mul(
      step(ndc.x, one.add(rNdcX)),
    );
    const visY = step(one.negate().sub(rNdcYNear), ndc.y).mul(
      step(ndc.y.add(rNdcYFar), one),
    );
    const visZ = step(float(-1), ndc.z).mul(step(ndc.z, one));
    return visX.mul(visY).mul(visZ);
  },
);

// ── Wind texture (v2 createWindTexture — baked perlin FBM channels) ─────────
// R=wave (u*8), G=gust (*3), B=zroll (*6), A=micro (*12).

const WIND_RES = 512;
const GRAD2 = [
  1, 0, -1, 0, 0, 1, 0, -1,
  0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
];
function _whash(ix, iy) {
  let n = ix * 1597 + iy * 5171;
  n = (n << 13) ^ n;
  n = n * (n * n * 15731 + 789221) + 1376312589;
  return (n >>> 0) % 8;
}
function _grad(ix, iy, fx, fy) {
  const i = _whash(ix, iy) * 2;
  return GRAD2[i] * fx + GRAD2[i + 1] * fy;
}
function _fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function perlin2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = _fade(fx);
  const v = _fade(fy);
  const n00 = _grad(ix, iy, fx, fy);
  const n10 = _grad(ix + 1, iy, fx - 1, fy);
  const n01 = _grad(ix, iy + 1, fx, fy - 1);
  const n11 = _grad(ix + 1, iy + 1, fx - 1, fy - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
}
function fbm2(x, y, octaves) {
  let s = 0;
  let a = 0.5;
  let m = 0;
  for (let i = 0; i < octaves; i++) {
    s += perlin2(x, y) * a;
    m += a;
    a *= 0.5;
    const nx = x * 2.0327 - y * 1.2671;
    const ny = x * 1.2671 + y * 2.0327;
    x = nx;
    y = ny;
  }
  return m > 0 ? s / m : 0;
}

function createWindTexture() {
  const data = new Float32Array(WIND_RES * WIND_RES * 4);
  for (let iy = 0; iy < WIND_RES; iy++) {
    for (let ix = 0; ix < WIND_RES; ix++) {
      const u = ix / WIND_RES;
      const v = iy / WIND_RES;
      const idx = (iy * WIND_RES + ix) * 4;
      data[idx] = fbm2(u * 8, v * 8, 4) * 0.5 + 0.5;
      data[idx + 1] = fbm2(u * 3 + 73.1, v * 3 + 41.3, 3) * 0.5 + 0.5;
      data[idx + 2] = fbm2(u * 6 + 137.9, v * 6 + 259.1, 4) * 0.5 + 0.5;
      data[idx + 3] = fbm2(u * 12 + 317.3, v * 12 + 197.7, 3) * 0.5 + 0.5;
    }
  }
  const tex = new THREE.DataTexture(
    data,
    WIND_RES,
    WIND_RES,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ── Blade geometry (Gemini ribbon + folded cross copy) ──────────────────────

function createBladeGeometry(height, baseWidth, ySegments, taperStart = 0.7) {
  const taper = THREE.MathUtils.clamp(taperStart, 0.05, 0.999);
  const baseHalf = baseWidth * 0.5;
  const positions = [];
  const uvs = [];
  const indices = [];
  const rowVertCount = [];
  const rowBase = [];
  let v = 0;
  for (let j = 0; j <= ySegments; j++) {
    const t = j / ySegments;
    const y = t * height;
    rowBase[j] = v;
    if (j === ySegments) {
      positions.push(0, y, 0);
      uvs.push(0.5, t);
      rowVertCount.push(1);
      v += 1;
    } else {
      const s = THREE.MathUtils.smoothstep(t, taper, 1);
      const w = baseHalf * (1 - s);
      positions.push(-w, y, 0, w, y, 0);
      uvs.push(0, t, 1, t);
      rowVertCount.push(2);
      v += 2;
    }
  }
  for (let j = 0; j < ySegments; j++) {
    const a0 = rowBase[j];
    const a1 = rowBase[j] + 1;
    const b0 = rowBase[j + 1];
    if (rowVertCount[j + 1] === 2) {
      const b1 = b0 + 1;
      indices.push(a0, a1, b1, a0, b1, b0);
    } else {
      indices.push(a0, a1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Cross ribbon folded into the geometry (aCross attr, VS rotates +90°).
 *  Normals MUST be copied — missing attributes bind ZEROS in WebGPU and the
 *  lighting silently turns to garbage (hard-won grass-lab lesson). */
function createCrossedBladeGeometry(height, width, segs, taper, includeCross) {
  const base = createBladeGeometry(height, width, segs, taper);
  if (!includeCross) {
    const n0 = base.attributes.position.count;
    base.setAttribute(
      "aCross",
      new THREE.BufferAttribute(new Float32Array(n0), 1),
    );
    return base;
  }
  const srcPos = base.attributes.position.array;
  const srcUv = base.attributes.uv.array;
  const srcNorm = base.attributes.normal.array;
  const srcIdx = base.index.array;
  const n = base.attributes.position.count;
  const positions = new Float32Array(n * 2 * 3);
  positions.set(srcPos, 0);
  positions.set(srcPos, n * 3);
  const uvs = new Float32Array(n * 2 * 2);
  uvs.set(srcUv, 0);
  uvs.set(srcUv, n * 2);
  const normals = new Float32Array(n * 2 * 3);
  normals.set(srcNorm, 0);
  normals.set(srcNorm, n * 3);
  const aCross = new Float32Array(n * 2);
  aCross.fill(1, n);
  const indices = new Uint32Array(srcIdx.length * 2);
  indices.set(srcIdx, 0);
  for (let i = 0; i < srcIdx.length; i++) {
    indices[srcIdx.length + i] = srcIdx[i] + n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("aCross", new THREE.BufferAttribute(aCross, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  base.dispose();
  return geo;
}

// ── Field textures baked from the RTS heightfield ───────────────────────────
// v2 uv convention: terrainUV = worldXZ / mapSize + 0.5.

function bakeFieldTextures({ mapSize, res = 512, getHeight, reject }) {
  const heightData = new Float32Array(res * res * 4);
  const normalData = new Float32Array(res * res * 4);
  const densityData = new Float32Array(res * res * 4);

  const fillRange = (ix0, iy0, ix1, iy1) => {
    const eps = (mapSize / res) * 0.5;
    for (let iy = iy0; iy <= iy1; iy++) {
      const z = (iy / (res - 1) - 0.5) * mapSize;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (ix / (res - 1) - 0.5) * mapSize;
        const i = (iy * res + ix) * 4;
        heightData[i] = getHeight(x, z);
        const hL = getHeight(x - eps, z);
        const hR = getHeight(x + eps, z);
        const hD = getHeight(x, z - eps);
        const hU = getHeight(x, z + eps);
        const nx = hL - hR;
        const nz = hD - hU;
        const ny = 2 * eps;
        const inv = 1 / Math.hypot(nx, ny, nz);
        normalData[i] = nx * inv;
        normalData[i + 1] = ny * inv;
        normalData[i + 2] = nz * inv;
        densityData[i] = reject && reject(x, z) ? 0 : 1;
      }
    }
  };
  const fill = () => fillRange(0, 0, res - 1, res - 1);
  fill();

  const mk = (data) => {
    const t = new THREE.DataTexture(
      data,
      res,
      res,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  const heightTex = mk(heightData);
  const normalTex = mk(normalData);
  const densityTex = mk(densityData);

  return {
    heightTex,
    normalTex,
    densityTex,
    // In-place refill + re-upload — never disposes (GPU-safe by design).
    rebake() {
      fill();
      heightTex.needsUpdate = true;
      normalTex.needsUpdate = true;
      densityTex.needsUpdate = true;
    },
    /** Refill only the texels covering a world-space disc (e.g. a crater) —
     *  a few dozen samples instead of the full res² bake. */
    rebakeRegion(x, z, radius) {
      const toTexel = (w) => ((w / mapSize + 0.5) * (res - 1)) | 0;
      const pad = 1;
      const ix0 = Math.max(0, toTexel(x - radius) - pad);
      const ix1 = Math.min(res - 1, toTexel(x + radius) + pad);
      const iy0 = Math.max(0, toTexel(z - radius) - pad);
      const iy1 = Math.min(res - 1, toTexel(z + radius) + pad);
      if (ix1 < ix0 || iy1 < iy0) return;
      fillRange(ix0, iy0, ix1, iy1);
      heightTex.needsUpdate = true;
      normalTex.needsUpdate = true;
      densityTex.needsUpdate = true;
    },
  };
}

// ── One ring of the hybrid system ───────────────────────────────────────────

const LOD_DEBUG_TINTS = {
  RtsGrassNear: [0.2, 1.0, 0.2],
  RtsGrassMid: [0.2, 0.4, 1.0],
  RtsGrassFar: [0.85, 0.35, 1.0],
};

class RtsGrassRing {
  constructor({
    scene,
    renderer,
    heightTex,
    normalTex,
    densityTex,
    windTex,
    worldSize,
    name,
    tileSize,
    bladesPerSide,
    bladeWidth,
    segments,
    bladeHeightMul = 1,
    innerR0 = 0,
    innerR1 = 0,
    outerR0,
    outerR1,
    crossed = false,
    normalMode = "flat", // "blade" near ring: per-blade emissive normal (SSS)
    crossFadeR0 = 40,
    crossFadeR1 = 62,
  }) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = name;
    scene.add(this.group);

    this.count = bladesPerSide * bladesPerSide;
    this.tileSize = tileSize;
    this._normalMode = normalMode;
    this._crossed = crossed;
    this._crossFadeR0 = crossFadeR0;
    this._crossFadeR1 = crossFadeR1;
    this._bladeHeightMul = bladeHeightMul;

    const u = (this.u = {
      uAnchorPos: uniform(new THREE.Vector3()),
      uAnchorDeltaXZ: uniform(new THREE.Vector2()),
      uTileSize: uniform(tileSize),
      uTerrainSize: uniform(worldSize),
      uCameraMatrix: uniform(new THREE.Matrix4()),
      uFx: uniform(1),
      uFy: uniform(1),
      uSunDir: uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize()),
      uBladeHeight: uniform(1 * bladeHeightMul),
      uBendFocus: uniform(0.5),
      uStiffness: uniform(0),
      uLodDebug: uniform(0),
      uMaxAngle: uniform(1.4),
      uNaturalLean: uniform(0.9),
      uWindSpeed: uniform(0.25),
      uWindStrength: uniform(1.2),
      uWindGust: uniform(0.4),
      uWindWaveScale: uniform(0.12),
      uWindDir: uniform(new THREE.Vector2(1, 0)),
      uClumpScale: uniform(1.5),
      uClumpStrength: uniform(0.7),
      uGrassDensity: uniform(1),
      uInnerR0: uniform(innerR0),
      uInnerR1: uniform(Math.max(innerR1, innerR0 + 0.001)),
      uOuterR0: uniform(outerR0 ?? tileSize * 0.28),
      uOuterR1: uniform(outerR1 ?? tileSize * 0.5),
      uCullPadNdcX: uniform(0.1),
      uCullPadNdcYNear: uniform(0.75),
      uCullPadNdcYFar: uniform(0.2),
      uBladeCol: uniform(new THREE.Color("#2f6b1a")),
      uTipCol: uniform(new THREE.Color("#8cc63f")),
      uAoBase: uniform(0.25),
      uAoPower: uniform(2),
      uColorVar: uniform(1),
      uCvHueSpread: uniform(0.08),
      uCvSatSpread: uniform(0.3),
      uCvDryAmount: uniform(0.15),
      uCvDryCol: uniform(new THREE.Color("#8a7a3a")),
      uSkyBlend: uniform(0.8),
      uCylindrical: uniform(0.3),
      uViewThicken: uniform(0.45),
      uCameraPos: uniform(new THREE.Vector3()),
      uBssCol: uniform(new THREE.Color("#2d7a2d")),
      uBssIntensity: uniform(1.2),
      uBssPower: uniform(2),
      uFrontScatter: uniform(0.3),
      uRimSSS: uniform(0.25),
      uSlopeEnabled: uniform(1),
      uSlopeMin: uniform(0.65),
      uSlopeMax: uniform(0.85),
    });

    // ── Geometry (before compaction buffers — indexCount needed) ──
    const geom = createCrossedBladeGeometry(
      1.0, // unit height — bladeH from SSBO scales it
      bladeWidth,
      Math.max(1, Math.round(segments)),
      0.5,
      crossed,
    );

    // ── SSBOs ──
    // bufPos: x,y = tile-local offset, z = smoothed force, w = smoothed zRoll
    // bufA:   y = force, z = zRoll, w = terrainY
    // bufB:   x = bladeH, y = yaw, z = clumpShade
    // bufC:   x = h4 hue, y = h5 sat/dry, z = terrainNx, w = terrainNz
    const bufPos = instancedArray(this.count, "vec4");
    const bufA = instancedArray(this.count, "vec4");
    const bufB = instancedArray(this.count, "vec4");
    const bufC = instancedArray(this.count, "vec4");
    const compactBuf = instancedArray(this.count, "uint");

    const indirectData = new Uint32Array(5);
    indirectData[0] = geom.index.count;
    this._indirectAttr = new THREE.IndirectStorageBufferAttribute(
      indirectData,
      5,
    );
    if (typeof geom.setIndirect === "function") {
      geom.setIndirect(this._indirectAttr);
    } else {
      geom.indirect = this._indirectAttr;
    }
    const indirectStorage = storage(this._indirectAttr, "uint", 5).toAtomic();

    this.computeReset = Fn(() => {
      atomicStore(indirectStorage.element(1), uint(0));
    })().compute(1, [1]);

    const fSide = float(bladesPerSide);
    const fSpacing = float(tileSize / bladesPerSide);
    const fHalf = float(tileSize * 0.5);

    this.computeInit = Fn(() => {
      const p = bufPos.element(instanceIndex);
      const row = floor(float(instanceIndex).div(fSide));
      const col = float(instanceIndex).mod(fSide);
      const jx = hash(instanceIndex.add(4321));
      const jz = hash(instanceIndex.add(1234));
      p.x.assign(col.mul(fSpacing).sub(fHalf).add(jx.mul(fSpacing)));
      p.y.assign(row.mul(fSpacing).sub(fHalf).add(jz.mul(fSpacing)));
      p.z.assign(float(0));
      p.w.assign(float(0));
    })().compute(this.count, [64]);

    // ── UPDATE: once per blade — height, density, clump, wind, culls ──
    this.computeUpdate = Fn(() => {
      const p = bufPos.element(instanceIndex);
      const a = bufA.element(instanceIndex);
      const b = bufB.element(instanceIndex);
      const c = bufC.element(instanceIndex);

      const wrapped = wrapTileOffsetXZ(
        vec2(p.x, p.y),
        u.uAnchorDeltaXZ,
        u.uTileSize,
      );
      p.x.assign(wrapped.x);
      p.y.assign(wrapped.y);

      const worldX = wrapped.x.add(u.uAnchorPos.x);
      const worldZ = wrapped.y.add(u.uAnchorPos.z);
      const worldXZ = vec2(worldX, worldZ);
      const terrainUV = worldXZ.div(u.uTerrainSize).add(0.5);

      const terrainY = texture(heightTex, terrainUV).x;
      const tN = texture(normalTex, terrainUV).xyz;
      const painted = texture(densityTex, terrainUV).x;
      const hasDensity = smoothstep(float(0.0), float(0.005), painted);
      const worldPos = vec3(worldX, terrainY, worldZ);

      const densityHash = hash(instanceIndex.add(7919));
      const densityKeep = step(densityHash, u.uGrassDensity.mul(painted)).mul(
        hasDensity,
      );

      // playable-map edge fade
      const mapHalf = u.uTerrainSize.mul(0.5);
      const outMax = max(abs(worldX), abs(worldZ));
      const mapStay = float(1).sub(
        smoothstep(mapHalf.sub(2), mapHalf.add(0.35), outMax),
      );

      // Radial ring window (dist² like Revo)
      const dxA = worldX.sub(u.uAnchorPos.x);
      const dzA = worldZ.sub(u.uAnchorPos.z);
      const distSqA = dxA.mul(dxA).add(dzA.mul(dzA));
      const pIn = smoothstep(
        u.uInnerR0.mul(u.uInnerR0),
        u.uInnerR1.mul(u.uInnerR1),
        distSqA,
      );
      const tOut = smoothstep(
        u.uOuterR0.mul(u.uOuterR0),
        u.uOuterR1.mul(u.uOuterR1),
        distSqA,
      );
      // Slope rejection as keep-probability (compaction needs binary keep)
      const slopeProb = mix(
        float(1),
        smoothstep(u.uSlopeMin, u.uSlopeMax, tN.y),
        u.uSlopeEnabled,
      );
      const pKeep = pIn.mul(float(1).sub(tOut)).mul(slopeProb);
      const stochasticKeep = step(hash(instanceIndex.add(31337)), pKeep);
      const frustumVis = computeFrustumVisibility(
        worldPos,
        u.uCameraMatrix,
        u.uFx,
        u.uFy,
        u.uBladeHeight.mul(1.6),
        u.uCullPadNdcX,
        u.uCullPadNdcYNear,
        u.uCullPadNdcYFar,
      );
      const vis = densityKeep.mul(mapStay).mul(stochasticKeep).mul(frustumVis);

      If(vis.greaterThan(0.5), () => {
        const slot = atomicAdd(indirectStorage.element(1), uint(1));
        compactBuf.element(slot).assign(instanceIndex);

        a.w.assign(terrainY);
        const h0 = hash(instanceIndex.add(196));
        const h2 = hash(instanceIndex.add(3197));
        const h3 = hash(instanceIndex.add(577));
        const h4 = hash(instanceIndex.add(911));
        const h5 = hash(instanceIndex.add(2741));

        // Per-blade shape — clumped (near) vs uniform carpet (far, Gemini mega)
        let yaw, naturalLean, bladeH, clumpShade;
        if (this._normalMode === "flat") {
          yaw = h0.mul(PI2);
          naturalLean = h3.mul(u.uNaturalLean);
          bladeH = u.uBladeHeight.mul(mix(float(0.82), float(1.08), h2));
          clumpShade = float(1.0);
        } else {
          const cellP = worldXZ.div(u.uClumpScale);
          const cellID = floor(cellP);
          const cellFrac = fract(cellP);
          const cv = hash42(cellID);
          const clumpDist = length(vec2(cv.x, cv.y).sub(cellFrac));
          const clumpInfluence = smoothstep(0.75, 0.05, clumpDist).mul(
            u.uClumpStrength,
          );
          yaw = mix(h0, cv.z, clumpInfluence).mul(PI2);
          const hScale = mix(float(0.75), float(1.5), h2);
          const clumpHeightScale = mix(float(0.6), float(1.4), cv.x);
          naturalLean = mix(h3, cv.w, clumpInfluence).mul(u.uNaturalLean);
          bladeH = u.uBladeHeight.mul(
            mix(hScale, clumpHeightScale, clumpInfluence),
          );
          clumpShade = mix(
            float(1.0),
            mix(float(0.82), float(1.18), cv.y),
            clumpInfluence,
          );
        }

        // ── Wind (Gemini formulas, baked windTex channels) ──
        const tBase = time.mul(u.uWindSpeed);
        const dirX = u.uWindDir.x;
        const dirZ = u.uWindDir.y;
        const waveUV = vec2(
          worldX.mul(u.uWindWaveScale).add(dirX.mul(tBase)).div(8.0),
          worldZ.mul(u.uWindWaveScale).add(dirZ.mul(tBase)).div(8.0),
        );
        const gustUV = vec2(
          worldX.mul(u.uWindWaveScale).mul(0.25).add(dirX.mul(tBase).mul(0.3)).div(3.0),
          worldZ.mul(u.uWindWaveScale).mul(0.25).add(dirZ.mul(tBase).mul(0.3)).div(3.0),
        );
        const zUV = vec2(
          worldZ.mul(u.uWindWaveScale).add(dirZ.mul(tBase)).add(17.3).div(6.0),
          worldX.mul(u.uWindWaveScale).sub(dirX.mul(tBase)).add(31.7).div(6.0),
        );
        const wave = texture(windTex, waveUV).x.mul(2).sub(1);
        const gustRaw = texture(windTex, gustUV).y.mul(2).sub(1);
        const zRollRaw = texture(windTex, zUV).z.mul(2).sub(1);
        const micro = sin(tBase.add(h0.mul(PI2)).mul(4.0)).mul(0.15);

        const gustStr = smoothstep(float(0.5), float(0.9), gustRaw).mul(
          u.uWindGust,
        );
        const windBase = wave.add(0.4).add(gustStr);
        const room = max(float(0), u.uMaxAngle.sub(naturalLean));
        const windScaled = windBase
          .add(micro)
          .mul(u.uWindStrength)
          .mul(room.div(u.uMaxAngle));

        // Smoothed force + zRoll across ticks (raw per-tick = visible jitter)
        const targetForce = naturalLean.add(windScaled);
        const prevForce = p.z;
        const kF = float(0.18);
        const newForce = prevForce.add(targetForce.sub(prevForce).mul(kF));
        p.z.assign(newForce);
        const targetZRoll = zRollRaw.mul(0.4).sub(0.2);
        const prevZRoll = p.w;
        const newZRoll = prevZRoll.add(targetZRoll.sub(prevZRoll).mul(kF));
        p.w.assign(newZRoll);
        a.y.assign(newForce);
        a.z.assign(newZRoll);

        // View-thicken: rotate edge-on blades toward the camera (keeps width
        // and lit normals from any azimuth — some angles read dark without it)
        const viewL = normalize(
          vec3(
            u.uCameraPos.x.sub(worldX),
            u.uCameraPos.y.sub(terrainY),
            u.uCameraPos.z.sub(worldZ),
          ),
        );
        const lenXZ = length(viewL.xz);
        const faceZ = abs(viewL.z);
        const edgeOn = smoothstep(float(0.12), float(0.55), float(1).sub(faceZ)).mul(
          smoothstep(float(0.08), float(0.35), lenXZ),
        );
        const deltaYaw = u.uViewThicken
          .mul(edgeOn)
          .mul(0.55)
          .mul(atan(viewL.x, viewL.z));

        b.x.assign(bladeH);
        b.y.assign(yaw.add(deltaYaw));
        b.z.assign(clumpShade);
        c.x.assign(h4);
        c.y.assign(h5);
        c.z.assign(tN.x);
        c.w.assign(tN.z);
      });
    })().compute(this.count, [64]);

    // ── Material — tiny VS reading SSBOs, standard lighting (CSM shadows) ──
    const mat = new THREE.MeshStandardNodeMaterial({
      side: THREE.FrontSide,
      roughness: 0.92,
      metalness: 0,
    });
    mat.envMapIntensity = 0;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
    this._assignNodes(mat, u, { bufPos, bufA, bufB, bufC, compactBuf });
    this.material = mat;

    // Plain Mesh (NOT InstancedMesh): instance count comes from the GPU-
    // written indirect buffer; per-blade data lives in SSBOs.
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);

    this._lastAnchor = new THREE.Vector3();
    this._anchorDelta = new THREE.Vector2();
    this._cameraMatrix = new THREE.Matrix4();
    this._initDone = false;
    this._enabled = false;
    this.group.visible = false;
  }

  _assignNodes(mat, u, { bufPos, bufA, bufB, bufC, compactBuf }) {
    const vData = varying(vec4(1, 1, 0, 0), "v_rg_data"); // clumpShade, shadeRand, h4, h5
    const vNormal = varying(vec3(0, 1, 0), "v_rg_n");
    const vWorld = varying(vec3(0), "v_rg_w");

    const rotY = (ang, v) => {
      const cc = cos(ang);
      const ss = sin(ang);
      return vec3(
        v.x.mul(cc).add(v.z.mul(ss)),
        v.y,
        negate(v.x).mul(ss).add(v.z.mul(cc)),
      );
    };

    mat.positionNode = Fn(() => {
      // Compacted draw: remap slot → real blade id; culled blades cost zero VS
      const bladeIdx = compactBuf.element(instanceIndex);
      const p = bufPos.element(bladeIdx);
      const a = bufA.element(bladeIdx);
      const b = bufB.element(bladeIdx);
      const c = bufC.element(bladeIdx);

      const totalForce = a.y;
      const zRoll = a.z;
      const terrainY = a.w;
      const bladeH = b.x;
      const yaw = b.y;

      const shadeRand = mix(float(0.75), float(1.0), hash(bladeIdx.add(8521)));
      vData.assign(vec4(b.z, shadeRand, c.x, c.y));

      const isCross = attribute("aCross", "float");
      const crossedYaw = yaw.add(isCross.mul(Math.PI * 0.5));

      const distXZ = length(vec2(p.x, p.y));
      const lodK = this._crossed
        ? smoothstep(float(this._crossFadeR0), float(this._crossFadeR1), distXZ)
        : float(1);

      const h = uv().y;
      const baseStiff = smoothstep(float(0), max(u.uStiffness, float(1e-4)), h);
      const curveWeight = pow(max(h, 1e-4), u.uBendFocus).mul(baseStiff);
      const angle = totalForce.mul(curveWeight);
      const L = h.mul(bladeH);
      const arcX = sin(angle).mul(L);
      const arcY = cos(angle).mul(L);
      const arcZ = sin(zRoll).mul(L).mul(curveWeight).mul(0.2);

      // Per-frame high-frequency sway between compute ticks
      const phase = hash(bladeIdx).mul(PI2);
      const swayAmp = clamp(u.uWindStrength, float(0), float(2)).mul(0.5);
      const swayA = sin(time.mul(2.3).add(phase)).mul(0.06).mul(swayAmp);
      const flutterA = sin(time.mul(4.1).add(phase.mul(1.7)))
        .mul(0.025)
        .mul(swayAmp);
      const windPerp = vec2(negate(u.uWindDir.y), u.uWindDir.x);
      const hh = h.mul(h).mul(bladeH);
      const swayX = u.uWindDir.x.mul(swayA).add(windPerp.x.mul(flutterA)).mul(hh);
      const swayZ = u.uWindDir.y.mul(swayA).add(windPerp.y.mul(flutterA)).mul(hh);

      const crossWidth = float(1).sub(isCross.mul(lodK));
      const pArc = vec3(
        arcX.add(positionLocal.x.mul(crossWidth)),
        arcY,
        arcZ.add(positionLocal.z),
      );
      const pRot = rotY(crossedYaw, pArc);
      const pFinal = vec3(pRot.x.add(swayX), pRot.y, pRot.z.add(swayZ));

      // Normals: lighting ALWAYS flat (terrain-blended); per-blade normal
      // only feeds the emissive SSS on near rings (Gemini-observed behavior)
      const spread = uv().x.mul(2).sub(1).mul(u.uCylindrical).mul(Math.PI * 0.5);
      const bladeN = rotY(crossedYaw.add(spread), vec3(0, 0, 1));
      const tNy = sqrt(
        max(float(0), float(1).sub(c.z.mul(c.z)).sub(c.w.mul(c.w))),
      );
      const terrainN = vec3(c.z, tNy, c.w);
      const nFlat = normalize(mix(vec3(0, 1, 0), terrainN, u.uSkyBlend));
      normalLocal.assign(nFlat);
      const nEmissive =
        this._normalMode === "blade"
          ? normalize(
              mix(normalize(mix(bladeN, terrainN, u.uSkyBlend)), nFlat, lodK),
            )
          : nFlat;
      vNormal.assign(nEmissive);

      const outPos = vec3(
        pFinal.x.add(p.x),
        pFinal.y.add(terrainY),
        pFinal.z.add(p.y),
      );
      vWorld.assign(outPos.add(vec3(u.uAnchorPos.x, 0, u.uAnchorPos.z)));
      return outPos;
    })();

    mat.colorNode = Fn(() => {
      const clumpShade = vData.x;
      const shadeRand = vData.y;
      const h4 = vData.z;
      const h5 = vData.w;
      const hPct = uv().y;

      const aoFloor =
        this._normalMode === "flat" ? u.uAoBase.mul(0.55) : u.uAoBase;
      const ao = mix(aoFloor, float(1.0), pow(hPct, u.uAoPower));
      const baseCol = mix(u.uBladeCol, u.uTipCol, hPct);

      const warmCol = vec3(0.18, 0.28, 0.02);
      const coolCol = vec3(0.02, 0.18, 0.08);
      const tintTarget = mix(warmCol, coolCol, h4);
      const hueCol = mix(baseCol, tintTarget, u.uCvHueSpread);
      const lum = dot(hueCol, vec3(0.299, 0.587, 0.114));
      const satFactor = float(1.0).sub(h5.mul(u.uCvSatSpread));
      const satCol = mix(vec3(lum, lum, lum), hueCol, satFactor);
      const dryBlend = smoothstep(u.uCvDryAmount, float(0), h5).mul(
        float(1.0).sub(hPct).mul(0.5).add(0.5),
      );
      const dryCol = mix(satCol, u.uCvDryCol, dryBlend);
      const variedCol = mix(baseCol, dryCol, u.uColorVar);

      const finalAlbedo = variedCol.mul(clumpShade).mul(shadeRand).mul(ao);
      const dbg = LOD_DEBUG_TINTS[this.group.name] ?? [1, 0, 1];
      return mix(finalAlbedo, vec3(dbg[0], dbg[1], dbg[2]), u.uLodDebug);
    })();

    // Emissive SSS — near ring only (far rings = none, like Gemini mega)
    if (this._normalMode === "flat") {
      mat.emissiveNode = vec3(0, 0, 0);
      return;
    }
    mat.emissiveNode = Fn(() => {
      const hPct = uv().y;
      const N = normalize(vNormal);
      const viewDir = normalize(cameraPosition.sub(vWorld));
      const thickness = float(1).sub(hPct).mul(0.7).add(0.3);
      const transmitCol = mix(
        u.uBssCol,
        u.uBssCol.mul(vec3(1.3, 1.1, 0.7)),
        float(1).sub(thickness),
      );
      const backScat = max(dot(negate(u.uSunDir), N), float(0));
      const frontScat = max(dot(u.uSunDir, N), float(0));
      const rim = float(1).sub(max(dot(N, viewDir), float(0)));
      const totalSSS = clamp(
        pow(backScat, u.uBssPower)
          .mul(thickness)
          .add(pow(frontScat, float(1.5)).mul(thickness).mul(u.uFrontScatter))
          .add(pow(rim, float(3.0)).mul(thickness).mul(u.uRimSSS)),
        float(0),
        float(1),
      );
      return transmitCol.mul(float(0.35)).mul(totalSSS).mul(u.uBssIntensity);
    })();
  }

  async init(camera) {
    await this.renderer.computeAsync(this.computeInit);
    await this.renderer.computeAsync([this.computeReset, this.computeUpdate]);
    this._initDone = true;
    await this.renderer.compileAsync(this.mesh, camera);
  }

  setEnabled(on) {
    this._enabled = !!on;
    this.group.visible = this._enabled;
  }

  update(anchorPos, camera) {
    if (!this._initDone || !this._enabled) return;
    const u = this.u;
    const dx = anchorPos.x - this._lastAnchor.x;
    const dz = anchorPos.z - this._lastAnchor.z;
    this._anchorDelta.set(dx, dz);
    u.uAnchorDeltaXZ.value.copy(this._anchorDelta);
    u.uAnchorPos.value.copy(anchorPos);
    this.mesh.position.set(anchorPos.x, 0, anchorPos.z);
    this._lastAnchor.copy(anchorPos);

    this._cameraMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    u.uCameraMatrix.value.copy(this._cameraMatrix);
    u.uCameraPos.value.setFromMatrixPosition(camera.matrixWorld);
    const e = camera.projectionMatrix.elements;
    u.uFx.value = e[0];
    u.uFy.value = e[5];

    // Per-frame SYNCHRONOUS compute (async + busy-flag = stepped 20–30 Hz
    // wind — grass-lab hard lesson). Reset + cull in ONE submission or a
    // render between them draws zero instances.
    this.renderer.compute([this.computeReset, this.computeUpdate]);
  }
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * @param {object} o
 *   scene, renderer, camera — three
 *   mapSize     — terrain world size
 *   getHeight   — (x,z)=>y terrain sampler
 *   reject      — (x,z)=>bool : no grass here (water, base pads, rocks)
 *   maskRes     — density/height texture resolution (default 512)
 */
export async function createRtsGrass({
  scene,
  renderer,
  camera,
  mapSize,
  getHeight,
  reject = null,
  maskRes = 512,
}) {
  const windTex = createWindTexture();
  const field = bakeFieldTextures({ mapSize, res: maskRes, getHeight, reject });

  const shared = {
    scene,
    renderer,
    heightTex: field.heightTex,
    normalTex: field.normalTex,
    densityTex: field.densityTex,
    windTex,
    worldSize: mapSize,
  };

  // Ring table — Gemini-mirrored tiers, trimmed for the RTS camera (mostly
  // aerial; near ring matters when zoomed in). Blades widen with distance so
  // far tiers stay visible without subpixel shimmer.
  const rings = [
    new RtsGrassRing({
      ...shared,
      name: "RtsGrassNear",
      tileSize: 130,
      bladesPerSide: 384,
      bladeWidth: 0.18,
      segments: 5,
      crossed: true,
      normalMode: "blade",
      outerR0: 40,
      outerR1: 62,
      crossFadeR0: 40,
      crossFadeR1: 62,
    }),
    new RtsGrassRing({
      ...shared,
      name: "RtsGrassMid",
      tileSize: 440,
      bladesPerSide: 448,
      bladeWidth: 0.45,
      segments: 2,
      normalMode: "flat",
      innerR0: 50,
      innerR1: 70,
      outerR0: 195,
      outerR1: 218,
    }),
    new RtsGrassRing({
      ...shared,
      name: "RtsGrassFar",
      tileSize: 880,
      bladesPerSide: 320,
      bladeWidth: 0.7,
      segments: 2,
      bladeHeightMul: 1.15,
      normalMode: "flat",
      innerR0: 200,
      innerR1: 245,
      outerR0: 400,
      outerR1: 435,
    }),
  ];

  for (const r of rings) await r.init(camera);

  return {
    rings,
    update(anchorPos, cam) {
      for (const r of rings) r.update(anchorPos, cam);
    },
    setEnabled(on) {
      for (const r of rings) r.setEnabled(on);
    },
    setSunDir(dir) {
      for (const r of rings) r.u.uSunDir.value.copy(dir);
    },
    /** Push PARAMS.grass values onto every ring's uniforms. */
    sync(P) {
      const wr = ((P.windAngle ?? 0) * Math.PI) / 180;
      for (const r of rings) {
        const u = r.u;
        u.uBladeHeight.value = (P.bladeHeight ?? 1) * r._bladeHeightMul;
        u.uGrassDensity.value = P.density ?? 1;
        u.uWindSpeed.value = P.windSpeed ?? 0.25;
        u.uWindStrength.value = P.windStrength ?? 1.2;
        u.uWindGust.value = P.windGust ?? 0.4;
        u.uWindDir.value.set(Math.cos(wr), Math.sin(wr));
        u.uClumpScale.value = P.clumpScale ?? 1.5;
        u.uClumpStrength.value = P.clumpStrength ?? 0.7;
        u.uBladeCol.value.set(P.bladeColor ?? "#2f6b1a");
        u.uTipCol.value.set(P.tipColor ?? "#8cc63f");
        u.uAoBase.value = P.aoBase ?? 0.25;
        u.uColorVar.value = P.colorVariation === false ? 0 : 1;
        u.uSkyBlend.value = P.skyBlend ?? 0.8;
        u.uSlopeEnabled.value = P.slopeEnabled === false ? 0 : 1;
        u.uSlopeMin.value = P.slopeMin ?? 0.65;
        u.uSlopeMax.value = P.slopeMax ?? 0.85;
        u.uLodDebug.value = P.lodDebug ? 1 : 0;
        if (r.mesh) r.mesh.receiveShadow = !!P.receiveShadow;
      }
    },
    /** Re-bake height/normal/density after a terrain rebuild — in-place
     *  texture refill, never disposes (GPU-safe). */
    rebake() {
      field.rebake();
    },
    /** Cheap localized refresh (crater impacts). */
    rebakeRegion(x, z, radius) {
      field.rebakeRegion(x, z, radius);
    },
  };
}
