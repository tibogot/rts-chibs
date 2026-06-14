/**
 * RTS adapter for v2 RevoGrassSystem — fluffy sprite-blade grass (read-only v2 import).
 * Keeps hybrid Gemini grass in rts-grass.js as an alternate backend.
 */
import * as THREE from "three";
import { RevoGrassSystem } from "./revoGrassSystem.js";

function bakeHeightField({ mapSize, res = 512, getHeight }) {
  const heightData = new Float32Array(res * res * 4);
  const fillRange = (ix0, iy0, ix1, iy1) => {
    for (let iy = iy0; iy <= iy1; iy++) {
      const z = (iy / (res - 1) - 0.5) * mapSize;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (ix / (res - 1) - 0.5) * mapSize;
        const i = (iy * res + ix) * 4;
        heightData[i] = getHeight(x, z);
        heightData[i + 1] = 0;
        heightData[i + 2] = 0;
        heightData[i + 3] = 1;
      }
    }
  };
  const fill = () => fillRange(0, 0, res - 1, res - 1);
  fill();

  const heightTex = new THREE.DataTexture(
    heightData,
    res,
    res,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  return {
    heightTex,
    rebake() {
      fill();
      heightTex.needsUpdate = true;
    },
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
    },
  };
}

function rebuildExclusionMask(mask, { mapSize, reject }) {
  mask.fillAllow();
  if (!reject) return;
  const res = mask.res;
  const data = mask.texture.image.data;
  const half = mapSize * 0.5;
  for (let iz = 0; iz < res; iz++) {
    const wz = (iz / (res - 1)) * mapSize - half;
    for (let ix = 0; ix < res; ix++) {
      const wx = (ix / (res - 1)) * mapSize - half;
      if (reject(wx, wz)) data[(iz * res + ix) * 4 + 1] = 0;
    }
  }
  mask.texture.needsUpdate = true;
}

/** Map RTS PARAMS.grass → v2 toolState.revoGrass shape. */
export function mapRtsGrassToRevo(G) {
  const gust = G.windGust ?? 0.4;
  return {
    enabled: !!G.enabled,
    qualityPreset: G.qualityPreset ?? "high",
    tileSize: G.tileSize ?? 130,
    bladesPerSide: G.bladesPerSide ?? null,
    segments: G.segments ?? 3,
    receiveShadow: G.receiveShadow === true,
    bladeHeight: G.bladeHeight ?? 1.75,
    bladeWidth: G.bladeWidth ?? 0.06,
    bladeMinScale: G.bladeMinScale ?? 0.75,
    bladeMaxScale: G.bladeMaxScale ?? 2.0,
    clumpStrength: G.clumpStrength ?? 0,
    clumpScale: G.clumpScale ?? 2.0,
    baseColor: G.bladeColor ?? "#8c6b30",
    tipColor: G.tipColor ?? "#77be13",
    colorMixFactor: G.colorMixFactor ?? 0.8,
    colorVariationStrength:
      G.colorVariation === false ? 0 : (G.colorVariationStrength ?? 2.75),
    aoScale: G.aoBase ?? 0.5,
    aoRimSmoothness: G.aoRimSmoothness ?? 5,
    aoRadius: G.aoRadius ?? 25,
    baseWindShade: G.baseWindShade ?? 0.75,
    baseShadeHeight: G.baseShadeHeight ?? 1,
    baseBending: G.baseBending ?? 2,
    windStrength: G.windStrength ?? 0.4,
    windSpeed: G.windSpeed ?? 0.25,
    windAngle: G.windAngle ?? 0,
    uvWindScale: G.uvWindScale ?? 1.75,
    windIntensity: G.windIntensity ?? 1 + gust * 0.35,
    windColorStrength: G.windColorStrength ?? 0.6,
    colorBrightness: G.colorBrightness ?? 1,
    trailGrowthRate: 0,
    trailMinScale: 1,
    trailRadius: 0,
    trailCrushSpeed: 0,
    playerRadius: 0,
    playerShadowEnabled: false,
    stochasticR0: G.stochasticR0 ?? 10,
    stochasticR1: G.stochasticR1 ?? 60,
    stochasticPMin: G.density != null ? Math.max(0.05, 1 - G.density) : 0.1,
    cullPadNdcX: 0.075,
    cullPadNdcYNear: 0.75,
    cullPadNdcYFar: 0.2,
    frustumCullEnabled: true,
    bakedShadowWeight: 1,
    exclusionEnabled: true,
    exclusionSource: "mask",
    exclusionThreshold: 0.25,
    useGlobalWindInPlay: false,
  };
}

/**
 * @param {object} o
 *   scene, renderer, camera, mapSize, getHeight, reject?, sunDir?, maskRes?
 */
export async function createRtsRevoGrass({
  scene,
  renderer,
  camera,
  mapSize,
  getHeight,
  reject = null,
  sunDir = null,
  maskRes = 512,
}) {
  const heightField = bakeHeightField({ mapSize, res: maskRes, getHeight });
  const _sunDir = sunDir?.clone?.() ?? new THREE.Vector3(0.5, 0.8, 0.3);
  const toolState = { revoGrass: mapRtsGrassToRevo({ enabled: false }) };

  const system = new RevoGrassSystem({
    scene,
    config: { world: { size: mapSize } },
  });

  await system.init(renderer, heightField.heightTex, _sunDir, toolState);
  rebuildExclusionMask(system.mask, { mapSize, reject });

  async function ensureReady() {
    const rp = toolState.revoGrass;
    if (!rp.enabled) {
      system.setEnabled(false);
      return;
    }
    await system.ensureBuilt(rp, _sunDir);
    system.syncFromState(rp, _sunDir);
    await system.precompile(renderer, camera);
  }

  return {
    system,
    update(anchorPos, cam) {
      if (!toolState.revoGrass.enabled) return;
      system.update(toolState.revoGrass, anchorPos, cam, { gustMul: 1 });
    },
    setEnabled(on) {
      toolState.revoGrass.enabled = !!on;
      system.setEnabled(on);
    },
    setSunDir(dir) {
      if (dir) _sunDir.copy(dir);
      system.syncFromState(toolState.revoGrass, _sunDir);
    },
    /** Push PARAMS.grass → revo uniforms; rebuilds GPU mesh when needed. */
    async sync(G) {
      const prev = toolState.revoGrass;
      const rp = mapRtsGrassToRevo(G);
      const needRebuild =
        !!system._mesh &&
        (rp.tileSize !== prev.tileSize ||
          rp.qualityPreset !== prev.qualityPreset ||
          rp.segments !== prev.segments ||
          rp.bladeWidth !== prev.bladeWidth);
      Object.assign(toolState.revoGrass, rp);
      if (G.enabled) {
        if (needRebuild) {
          await system.rebuild(toolState.revoGrass, _sunDir);
          await system.precompile(renderer, camera);
        } else {
          await ensureReady();
        }
      } else {
        system.setEnabled(false);
      }
      system.syncFromState(toolState.revoGrass, _sunDir);
    },
    rebake() {
      heightField.rebake();
      rebuildExclusionMask(system.mask, { mapSize, reject });
    },
    rebakeRegion(x, z, radius) {
      heightField.rebakeRegion(x, z, radius);
    },
    dispose() {
      system.dispose();
    },
  };
}
