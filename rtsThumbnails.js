import * as THREE from "three";

/**
 * Live thumbnail baker for RTS unit/building UI tiles.
 * Lighting matches the main RTS scene (low IBL + moderate sun) so PBR GLBs
 * don't blow out; framing fills ~90% of the tile so models read larger in UI.
 *
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer
 * @param {{key:string, make:()=>THREE.Object3D}[]} o.items
 * @param {THREE.Texture} [o.environment]
 * @param {number} [o.environmentIntensity=0.1]
 * @param {number} [o.size=256]
 * @param {number} [o.fill=0.9] — fraction of frame height used by model
 * @returns {Promise<Map<string,string>>}
 */
export async function bakeRtsThumbnails({
  renderer,
  items,
  environment = null,
  environmentIntensity = 0.1,
  size = 256,
  fill = 0.9,
}) {
  const out = new Map();
  if (!renderer || !Array.isArray(items)) return out;

  const rt = new THREE.RenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    samples: 4,
  });

  const scene = new THREE.Scene();
  if (environment) {
    scene.environment = environment;
    scene.environmentIntensity = environmentIntensity;
  }
  // Match in-game lights (rts-lab.html) — not the brighter modular-road bake.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 9, 6);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 5000);
  const group = new THREE.Group();
  scene.add(group);

  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const center = new THREE.Vector3();
  const camDir = new THREE.Vector3(0.78, 0.82, 0.95).normalize();

  const prevTarget = renderer.getRenderTarget();
  const prevClearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);

  // NOTE: never dispose geometries here. `make()` may return a clone of a
  // cached GLB template (rts-units.js, windmill) whose geometry is SHARED
  // with every live unit on the map — disposing it destroys the template's
  // GPU buffers and the next frame submits them ("used in submit while
  // destroyed"). Primitive-built thumbs leak a few small geometries once at
  // startup, which is negligible; correctness wins.
  const clearGroup = () => {
    group.position.set(0, 0, 0);
    while (group.children.length) {
      group.children.pop();
    }
  };

  try {
    for (const item of items) {
      if (!item?.make) continue;
      clearGroup();
      group.add(item.make());

      // Sit mesh on y=0 without a visible floor (invisible ground only).
      box.setFromObject(group);
      if (!box.isEmpty()) group.position.y -= box.min.y;

      box.setFromObject(group);
      if (box.isEmpty()) continue;

      box.getBoundingSphere(sphere);
      center.copy(sphere.center);
      const r = Math.max(sphere.radius, 0.5);
      const halfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5;
      const dist = (r / (Math.tan(halfFov) * fill));
      camera.position.copy(center).addScaledVector(camDir, dist);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);

      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      const buf = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size);
      out.set(item.key, pixelsToDataURL(new Uint8Array(buf.buffer ?? buf), size));
    }
  } catch (err) {
    console.warn("[rts] thumbnail bake failed; falling back to text icons.", err);
  } finally {
    clearGroup();
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(0x000000, prevClearAlpha);
    rt.dispose();
  }

  return out;
}

function pixelsToDataURL(buf, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  img.data.set(buf.subarray(0, size * size * 4));
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
