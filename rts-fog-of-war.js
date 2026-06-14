/**
 * RTS fog of war — vision grid → RG texture (strength + shroud flag).
 * Terrain samples the map in the material; post overlay covers props/sky line.
 */
import * as THREE from "three/webgpu";
import {
  texture,
  screenUV,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  mix,
  dot,
  step,
  Fn,
  max,
  normalize,
  positionWorld,
} from "three/tsl";

export const RTS_FOW_TEX_RES = 256;

/** Separable box blur on a square Float32 strength field. */
function boxBlur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const cx = Math.min(size - 1, Math.max(0, x + k));
        sum += src[y * size + cx];
      }
      tmp[y * size + x] = sum / span;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const cy = Math.min(size - 1, Math.max(0, y + k));
        sum += tmp[cy * size + x];
      }
      dst[y * size + x] = sum / span;
    }
  }

  return dst;
}

export function createRtsFogOfWarTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RTS_FOW_TEX_RES;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.width = minimapCanvas.height = RTS_FOW_TEX_RES;
  const minimapCtx = minimapCanvas.getContext("2d");

  return { canvas, ctx, tex, minimapCanvas, minimapCtx };
}

/**
 * Bake explored / visible grid into RG map: R = blurred overlay strength, G = shroud flag.
 */
export function updateRtsFogOfWarTexture(
  ctx,
  tex,
  minimapCtx,
  {
    fog,
    mapSize,
    shroudAlpha,
    fogAlpha,
    worldToFogCell,
    fogIdx,
    blurRadius = 1,
    blurPasses = 1,
  },
) {
  const res = RTS_FOW_TEX_RES;
  const half = mapSize * 0.5;
  let strengths = new Float32Array(res * res);
  const states = new Float32Array(res * res);

  for (let py = 0; py < res; py++) {
    const wz = (py / res) * mapSize - half;
    for (let px = 0; px < res; px++) {
      const wx = (px / res) * mapSize - half;
      const { c, r } = worldToFogCell(wx, wz);
      let s = fogAlpha;
      let st = 0;
      if (c >= 0 && r >= 0 && c < fog.cols && r < fog.rows) {
        const i = fogIdx(c, r);
        if (fog.visible[i]) {
          s = 0;
          st = 1;
        } else if (fog.explored[i]) {
          s = shroudAlpha;
          st = 1;
        }
      }
      const idx = py * res + px;
      strengths[idx] = s;
      states[idx] = st;
    }
  }

  for (let pass = 0; pass < blurPasses; pass++) {
    strengths = boxBlur(strengths, res, blurRadius);
  }

  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let i = 0; i < strengths.length; i++) {
    const p = i * 4;
    data[p] = Math.round(Math.min(1, Math.max(0, strengths[i])) * 255);
    data[p + 1] = Math.round(states[i] * 255);
    data[p + 2] = 0;
    data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;

  if (minimapCtx) {
    const mini = minimapCtx.createImageData(res, res);
    const md = mini.data;
    for (let i = 0; i < strengths.length; i++) {
      const s = Math.min(1, Math.max(0, strengths[i]));
      const st = states[i];
      const p = i * 4;
      if (s < 0.04) {
        md[p] = 255;
        md[p + 1] = 255;
        md[p + 2] = 255;
        md[p + 3] = 0;
      } else if (st > 0.5) {
        md[p] = 70;
        md[p + 1] = 78;
        md[p + 2] = 88;
        md[p + 3] = Math.round(s * 200);
      } else {
        md[p] = 12;
        md[p + 1] = 16;
        md[p + 2] = 24;
        md[p + 3] = Math.round(s * 255);
      }
    }
    minimapCtx.putImageData(mini, 0, 0);
  }
}

function createRtsFogOfWarUniforms(mapSize) {
  return {
    uFoWEnabled: uniform(0),
    uMapHalf: uniform(mapSize * 0.5),
    uMapSize: uniform(mapSize),
    uGroundY: uniform(0),
    uInvProj: uniform(new THREE.Matrix4()),
    uCameraWorld: uniform(new THREE.Matrix4()),
    uCamPos: uniform(new THREE.Vector3()),
    uShroudTint: uniform(new THREE.Color(0x454c55).convertSRGBToLinear()),
    uUnexploredTint: uniform(new THREE.Color(0x080a0f).convertSRGBToLinear()),
    uShroudDesat: uniform(0.58),
  };
}

function buildRtsFogOfWarMix(fowTex, uniforms) {
  const fowTexNode = texture(fowTex);

  const shadeRgb = (rgbNode, fowUv) => {
    const fowSample = texture(fowTexNode, fowUv);
    const strength = fowSample.r.mul(uniforms.uFoWEnabled);
    const isShroud = step(float(0.5), fowSample.g);
    const lum = dot(rgbNode, vec3(0.2126, 0.7152, 0.0722));
    const desatRgb = mix(vec3(lum), rgbNode, float(1).sub(uniforms.uShroudDesat));
    const shroudRgb = mix(
      desatRgb,
      uniforms.uShroudTint,
      strength.mul(float(0.72)),
    );
    const unexploredRgb = mix(rgbNode, uniforms.uUnexploredTint, strength);
    const fowRgb = mix(unexploredRgb, shroudRgb, isShroud);
    return mix(rgbNode, fowRgb, strength);
  };

  const worldUvFromXZ = (xz) =>
    xz.add(vec2(uniforms.uMapHalf, uniforms.uMapHalf)).div(uniforms.uMapSize);

  return { shadeRgb, worldUvFromXZ };
}

/**
 * Apply FoW directly on terrain albedo — reliable for RTS (uses positionWorld.xz).
 */
export function bindRtsFogOfWarTerrainMaterial(material, fowTex, mapSize) {
  if (!material || material._rtsFowBound) return null;
  const uniforms = createRtsFogOfWarUniforms(mapSize);
  const { shadeRgb, worldUvFromXZ } = buildRtsFogOfWarMix(fowTex, uniforms);
  const baseColor = material.colorNode;
  material.colorNode = shadeRgb(baseColor, worldUvFromXZ(positionWorld.xz));
  material.needsUpdate = true;
  material._rtsFowBound = true;

  function syncCamera(cam) {
    uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(cam.matrixWorld);
    uniforms.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
  }

  return { uniforms, syncCamera, material };
}

/**
 * Post-process FoW for non-terrain pixels (props, cliffs in view).
 */
export function createRtsFogOfWarPostOverlay({
  scenePass: _scenePass,
  camera,
  fowTex,
  mapSize,
  uniforms: sharedUniforms,
}) {
  const uniforms = sharedUniforms ?? createRtsFogOfWarUniforms(mapSize);
  const { shadeRgb, worldUvFromXZ } = buildRtsFogOfWarMix(fowTex, uniforms);

  const applyFoW = Fn(([color]) => {
    const ndc = vec2(screenUV.x, float(1).sub(screenUV.y)).mul(2.0).sub(1.0);
    const near4 = uniforms.uInvProj.mul(vec4(ndc.x, ndc.y, float(-1), float(1)));
    const far4 = uniforms.uInvProj.mul(vec4(ndc.x, ndc.y, float(1), float(1)));
    const nearView = near4.xyz.div(near4.w);
    const farView = far4.xyz.div(far4.w);
    const worldNear = uniforms.uCameraWorld.mul(vec4(nearView, float(1))).xyz;
    const worldFar = uniforms.uCameraWorld.mul(vec4(farView, float(1))).xyz;
    const rayDir = normalize(worldFar.sub(worldNear));
    const camPos = uniforms.uCamPos;
    const t = uniforms.uGroundY.sub(camPos.y).div(rayDir.y);
    const hitsGround = rayDir.y
      .lessThan(float(-0.0001))
      .select(step(float(0.001), t), float(0));
    const groundHit = camPos.add(rayDir.mul(max(t, float(0))));
    const shadedRgb = shadeRgb(color.rgb, worldUvFromXZ(groundHit.xz));
    const shaded = vec4(shadedRgb, color.a);
    return mix(color, shaded, hitsGround);
  });

  function syncCamera(cam) {
    uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(cam.matrixWorld);
    uniforms.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
  }

  if (camera) syncCamera(camera);

  return {
    uniforms,
    uFoWEnabled: uniforms.uFoWEnabled,
    uMapHalf: uniforms.uMapHalf,
    uMapSize: uniforms.uMapSize,
    uGroundY: uniforms.uGroundY,
    uShroudTint: uniforms.uShroudTint,
    uUnexploredTint: uniforms.uUnexploredTint,
    uShroudDesat: uniforms.uShroudDesat,
    syncCamera,
    apply: (colorNode) => applyFoW(colorNode),
  };
}

export function syncRtsFogOfWarOverlayUniforms(overlay, fogParams, camera) {
  if (!overlay) return;
  const u = overlay.uniforms ?? overlay;
  u.uFoWEnabled.value = fogParams.enabled ? 1 : 0;
  u.uShroudDesat.value = fogParams.shroudDesat ?? 0.58;
  u.uShroudTint.value
    .set(fogParams.shroudColor ?? "#454c55")
    .convertSRGBToLinear();
  u.uUnexploredTint.value
    .set(fogParams.unexploredColor ?? "#080a0f")
    .convertSRGBToLinear();
  if (camera) overlay.syncCamera?.(camera);
}
