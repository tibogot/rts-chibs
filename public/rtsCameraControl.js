import * as THREE from "three";

/**
 * RTS runtime camera controller — WASD/arrow panning, mouse edge-scroll, and
 * terrain-follow. Extracted from rts-lab.html as the first slice of the
 * portable RTS controller (the part that will run inside the engine; the lab's
 * Tweakpane camera-config functions stay in the HTML and don't port).
 *
 * All dependencies are injected so this module knows nothing about the lab's
 * globals. The notable one is `terrainHeight` — this is the WORLD-INTERFACE the
 * host (lab today, engine later) must provide: "ground height at world XZ".
 *
 * @param {object}   deps
 * @param {THREE.Camera}        deps.camera     camera being driven
 * @param {object}              deps.controls   OrbitControls (reads/writes .target)
 * @param {object}              deps.params     PARAMS.camera (panSpeed, edgeSpeed,
 *                                              edgeSize, followTerrain,
 *                                              terrainFollowSpeed, targetY)
 * @param {() => boolean}       deps.isRtsMode  true while the RTS camera is active
 * @param {() => boolean}       [deps.isEdgeScrollEnabled] edge pan at screen
 *                                              borders; defaults to isRtsMode
 * @param {(x:number,z:number)=>number} deps.terrainHeight  world-interface: ground Y at XZ
 * @param {object}              deps.input      live input: { keys, getPointer() }
 *                                              keys: { [code]: bool }; getPointer():
 *                                              { x, y, inCanvas, dragging }
 * @param {THREE.Vector3}       [deps.worldUp]  up axis (default +Y)
 */
export function createRtsCameraControl({
  camera,
  controls,
  params,
  isRtsMode,
  isEdgeScrollEnabled = isRtsMode,
  terrainHeight,
  input,
  worldUp = new THREE.Vector3(0, 1, 0),
}) {
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _pan = new THREE.Vector3();

  // Slide the whole view (camera + orbit target) across the ground plane.
  // ix = right, iz = forward (away from camera). Scaled by zoom distance so it
  // feels constant on screen.
  function panView(ix, iz, speedMul, dt) {
    if (!ix && !iz) return;
    _fwd.copy(controls.target).sub(camera.position);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-8) return;
    _fwd.normalize();
    _right.crossVectors(_fwd, worldUp).normalize();
    const dist = camera.position.distanceTo(controls.target);
    const sp = speedMul * dist * 0.9 * dt;
    _pan
      .set(0, 0, 0)
      .addScaledVector(_fwd, iz * sp)
      .addScaledVector(_right, ix * sp);
    camera.position.add(_pan);
    controls.target.add(_pan);
  }

  // Keyboard pan (WASD / arrows; Q = left, since A is attack-move) + edge
  // scroll at screen borders when enabled (play mode only in the lab).
  function panAndEdge(dt) {
    const keys = input.keys;
    let kx = 0;
    let kz = 0;
    if (keys.KeyW || keys.ArrowUp) kz += 1;
    if (keys.KeyS || keys.ArrowDown) kz -= 1;
    if (keys.KeyD || keys.ArrowRight) kx += 1;
    if (keys.KeyQ || keys.ArrowLeft) kx -= 1;
    panView(kx, kz, params.panSpeed, dt);

    if (!isEdgeScrollEnabled()) return;
    const p = input.getPointer();
    if (!p.inCanvas || p.dragging) return;
    const E = params.edgeSize;
    let ix = 0;
    let iz = 0;
    if (p.x < E) ix -= 1;
    else if (p.x > window.innerWidth - E) ix += 1;
    if (p.y < E) iz += 1;
    else if (p.y > window.innerHeight - E) iz -= 1;
    panView(ix, iz, params.edgeSpeed, dt);
  }

  // Ease the orbit target's Y toward the terrain so the focus point hugs hills.
  function groundFollow(dt) {
    if (!isRtsMode() || !params.followTerrain) return;
    const wantY =
      terrainHeight(controls.target.x, controls.target.z) + params.targetY;
    const t = Math.min(1, dt * (params.terrainFollowSpeed ?? 10));
    const newY = THREE.MathUtils.lerp(controls.target.y, wantY, t);
    const dy = newY - controls.target.y;
    if (Math.abs(dy) < 0.0005) return;
    controls.target.y = newY;
    camera.position.y += dy;
  }

  return { panView, panAndEdge, groundFollow };
}
