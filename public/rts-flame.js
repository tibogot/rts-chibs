/**
 * RTS flamethrower jets — the zelda-smoke.html "Fire" preset material
 * (triplanar voronoi erosion + hot→orange→dark emissive ramp, additive)
 * driving a world-space directional jet pool instead of a rising plume.
 * One shared InstancedMesh serves every flamer on the map.
 *
 * `createRtsFlameJets(scene)` → { spray, attachTorch, spawnBurn, update(dt, timeMs), dispose }
 */
import * as THREE from "three/webgpu";
import {
  attribute,
  texture,
  uniform,
  vec2,
  float,
  mix,
  smoothstep,
  dot,
  positionLocal,
  positionWorld,
  normalLocal,
  normalWorld,
  cameraPosition,
  mrt,
  output,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const VORO_URL = "./textures/particles/T_Voronoi01.png";

// zelda-smoke FIRE_LOOK, tuned for a fast horizontal jet.
const JET = {
  tiling: 0.5,
  panSpeed: 0.25,
  holeDepth: 0.5,
  edgeNoise: 0.6,
  cutoff: 0.1,
  dissolveSoft: 0.2,
  erode: 0.7,
  fadeIn: 0.08,
  opacity: 1.0,
  colHot: "#fff2c0",
  colMid: "#ff7a18",
  colTip: "#5a1203",
  intensity: 3.2, // HDR >1 → selective-bloom emissive buffer (not display brightness)
  midPoint: 0.4,
  // jet sim
  speed: 26, // initial blob speed along aim (world u/s)
  drag: 2.2, // 1/s velocity damping
  buoyancy: 3.0, // upward drift as the blob ages
  coneJitter: 0.16, // radians of spray cone
  sizeStart: 0.48,
  sizeEnd: 1.95,
  spin: 2.2,
  blobsPerSpray: 3,
};

// Barrel / torch — slow rising plume, continuously recycled at a fixed anchor.
const TORCH = {
  blobsPerTorch: 4,
  riseSpeed: 1.85,
  wobble: 0.24,
  lifeMin: 0.55,
  lifeMax: 0.95,
  sizeStart: 0.28,
  sizeEnd: 0.78,
  maxHeight: 1.65,
  baseSpread: 0.12,
  spin: 0.9,
};

// Rocket / shell impacts — short violent burn at the crater.
const BURN = {
  blobsPerTorch: 6,
  riseSpeed: 2.4,
  wobble: 0.38,
  lifeMin: 0.42,
  lifeMax: 0.95,
  sizeStart: 0.5,
  sizeEnd: 1.45,
  maxHeight: 2.8,
  baseSpread: 0.38,
  spin: 1.2,
};

// Building / HQ destruction — tall inferno, lingers.
const INFERNO = {
  blobsPerTorch: 8,
  riseSpeed: 3.1,
  wobble: 0.48,
  lifeMin: 0.4,
  lifeMax: 1.05,
  sizeStart: 0.72,
  sizeEnd: 2.05,
  maxHeight: 4.8,
  baseSpread: 0.58,
  spin: 1.35,
};

const MAX_BLOBS = 256;
const MAX_TORCHES = 48;
const MODE_FREE = 0;
const MODE_JET = 1;
const MODE_TORCH = 2;

function makeBlobGeometry() {
  const a = new THREE.IcosahedronGeometry(1.0, 3);
  const b = new THREE.IcosahedronGeometry(0.8, 3).translate(0.95, 0.45, 0.15);
  const c = new THREE.IcosahedronGeometry(0.78, 3).translate(-0.7, 0.55, -0.35);
  const g = mergeGeometries([a, b, c]);
  g.deleteAttribute("uv");
  g.center();
  return g;
}

function buildFireMaterial(voroTex, u) {
  const iSeed = attribute("iSeed", "float");
  const iLife = attribute("iLife", "float");

  // triplanar voronoi (object space) — identical to the zelda-smoke recipe
  const p = positionLocal.mul(u.tiling);
  const aN = normalLocal.abs();
  const bl = aN.div(aN.x.add(aN.y).add(aN.z).add(0.0001));
  const t = u.time.mul(u.panSpeed);
  const off = vec2(iSeed, iSeed.mul(1.7)).add(vec2(t.mul(0.3), t.negate()));
  const sX = texture(voroTex, p.yz.add(off)).r;
  const sY = texture(voroTex, p.xz.add(off)).r;
  const sZ = texture(voroTex, p.xy.add(off)).r;
  const V = sX.mul(bl.x).add(sY.mul(bl.y)).add(sZ.mul(bl.z));

  const N = normalWorld.normalize();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const facing = dot(N, viewDir).clamp(0, 1);

  // erosion / dissolve
  const holed = facing.mul(mix(float(1), V, u.holeDepth));
  const edged = holed.add(V.sub(0.5).mul(u.edgeNoise));
  const thr = u.cutoff.add(iLife.mul(u.erode));
  const fadeIn = smoothstep(float(0), u.fadeIn, iLife);
  const alpha = smoothstep(thr, thr.add(u.dissolveSoft), edged)
    .mul(fadeIn)
    .mul(u.opacity);

  // emissive colour ramp over life: hot core → orange → dark tip
  const c1 = mix(u.colHot, u.colMid, smoothstep(float(0), u.midPoint, iLife));
  const ramp = mix(c1, u.colTip, smoothstep(u.midPoint, float(1), iLife));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const col = ramp.mul(u.intensity);
  mat.colorNode = col;
  mat.opacityNode = alpha;
  // Opt into the emissive MRT buffer — bloom reads this, not the colour buffer.
  // Write full HDR ramp (no ×alpha); alpha only gates the beauty-pass blend.
  mat.mrtNode = mrt({ output, emissive: col });
  return mat;
}

export async function createRtsFlameJets(scene) {
  const u = {
    time: uniform(0),
    tiling: uniform(JET.tiling),
    panSpeed: uniform(JET.panSpeed),
    holeDepth: uniform(JET.holeDepth),
    edgeNoise: uniform(JET.edgeNoise),
    cutoff: uniform(JET.cutoff),
    dissolveSoft: uniform(JET.dissolveSoft),
    erode: uniform(JET.erode),
    fadeIn: uniform(JET.fadeIn),
    opacity: uniform(JET.opacity),
    colHot: uniform(new THREE.Color(JET.colHot)),
    colMid: uniform(new THREE.Color(JET.colMid)),
    colTip: uniform(new THREE.Color(JET.colTip)),
    intensity: uniform(JET.intensity),
    midPoint: uniform(JET.midPoint),
  };

  const voroTex = await new Promise((res, rej) => {
    new THREE.TextureLoader().load(
      VORO_URL,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        res(tex);
      },
      undefined,
      rej,
    );
  });

  const geo = makeBlobGeometry();
  const seedArr = new Float32Array(MAX_BLOBS);
  const lifeArr = new Float32Array(MAX_BLOBS).fill(1);
  geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seedArr, 1));
  const lifeAttr = new THREE.InstancedBufferAttribute(lifeArr, 1);
  geo.setAttribute("iLife", lifeAttr);

  const mat = buildFireMaterial(voroTex, u);
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOBS);
  mesh.frustumCulled = false;
  mesh.count = MAX_BLOBS;
  mesh.renderOrder = 8;
  scene.add(mesh);

  const active = new Uint8Array(MAX_BLOBS);
  const torchForBlob = new Int16Array(MAX_BLOBS).fill(-1);
  const torches = new Array(MAX_TORCHES).fill(null);
  const px = new Float32Array(MAX_BLOBS);
  const py = new Float32Array(MAX_BLOBS);
  const pz = new Float32Array(MAX_BLOBS);
  const vx = new Float32Array(MAX_BLOBS);
  const vy = new Float32Array(MAX_BLOBS);
  const vz = new Float32Array(MAX_BLOBS);
  const age = new Float32Array(MAX_BLOBS);
  const life = new Float32Array(MAX_BLOBS);
  const axX = new Float32Array(MAX_BLOBS);
  const axY = new Float32Array(MAX_BLOBS);
  const axZ = new Float32Array(MAX_BLOBS);
  const spin = new Float32Array(MAX_BLOBS);
  const ang = new Float32Array(MAX_BLOBS);

  const _d = new THREE.Object3D();
  const _axis = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function presetBase(preset) {
    if (preset === "burn") return BURN;
    if (preset === "inferno") return INFERNO;
    return TORCH;
  }

  function torchCfg(torch) {
    const base = presetBase(torch.preset);
    const s = torch.scale ?? 1;
    const blobMul =
      torch.preset === "torch" ? 1 : THREE.MathUtils.clamp(s * 0.65 + 0.55, 0.8, 2.4);
    return {
      blobsPerTorch: Math.min(
        12,
        Math.ceil(base.blobsPerTorch * blobMul),
      ),
      riseSpeed: base.riseSpeed * (0.85 + s * 0.15),
      wobble: base.wobble * s,
      lifeMin: base.lifeMin,
      lifeMax: base.lifeMax,
      sizeStart: base.sizeStart * s,
      sizeEnd: base.sizeEnd * s,
      maxHeight: base.maxHeight * s,
      baseSpread: base.baseSpread * s,
      spin: base.spin,
    };
  }

  function allocBlob() {
    return active.indexOf(MODE_FREE);
  }

  function freeBlob(i) {
    active[i] = MODE_FREE;
    torchForBlob[i] = -1;
    mesh.setMatrixAt(i, _hidden);
    lifeArr[i] = 1;
  }

  function spawnTorchBlob(i, torch, phase = 0) {
    const cfg = torchCfg(torch);
    active[i] = MODE_TORCH;
    torchForBlob[i] = torch.id;
    const spread = cfg.baseSpread;
    px[i] = torch.x + (Math.random() - 0.5) * spread;
    py[i] = torch.y + Math.random() * 0.06 * (torch.scale ?? 1);
    pz[i] = torch.z + (Math.random() - 0.5) * spread;
    vx[i] = (Math.random() - 0.5) * cfg.wobble;
    vy[i] = cfg.riseSpeed * (0.82 + Math.random() * 0.36);
    vz[i] = (Math.random() - 0.5) * cfg.wobble;
    age[i] = phase * cfg.lifeMax;
    life[i] = cfg.lifeMin + Math.random() * (cfg.lifeMax - cfg.lifeMin);
    _axis
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize();
    axX[i] = _axis.x;
    axY[i] = _axis.y;
    axZ[i] = _axis.z;
    spin[i] = (Math.random() - 0.5) * 2;
    ang[i] = Math.random() * Math.PI * 2;
    seedArr[i] = Math.random() * 10;
  }

  /** Permanent campfire / barrel flame at a world anchor. */
  function attachTorch(x, y, z, opts = {}) {
    let id = torches.findIndex((t) => t === null);
    if (id < 0) return -1;
    const torch = {
      id,
      x,
      y,
      z,
      blobs: [],
      preset: opts.preset ?? "torch",
      ttl: opts.duration ?? Infinity,
      scale: opts.scale ?? 1,
    };
    torches[id] = torch;
    const cfg = torchCfg(torch);
    for (let k = 0; k < cfg.blobsPerTorch; k++) {
      const i = allocBlob();
      if (i < 0) break;
      spawnTorchBlob(i, torch, k * 0.28);
      torch.blobs.push(i);
    }
    return id;
  }

  /** Timed combat burn (rockets, building destruction). Same pool as torches. */
  function spawnBurn(x, y, z, opts = {}) {
    return attachTorch(x, y, z, {
      preset: opts.preset ?? "burn",
      duration: opts.duration ?? 4,
      scale: opts.scale ?? 1.25,
      ...opts,
    });
  }

  function setTorchPosition(id, x, y, z) {
    const torch = torches[id];
    if (!torch) return;
    torch.x = x;
    torch.y = y;
    torch.z = z;
    const cfg = torchCfg(torch);
    for (const i of torch.blobs) {
      if (active[i] !== MODE_TORCH) continue;
      const relY = Math.max(0, py[i] - torch.y);
      px[i] = x + (Math.random() - 0.5) * cfg.baseSpread * 0.4;
      py[i] = y + relY * 0.15;
      pz[i] = z + (Math.random() - 0.5) * cfg.baseSpread * 0.4;
    }
  }

  function detachTorch(id) {
    const torch = torches[id];
    if (!torch) return;
    for (const i of torch.blobs) freeBlob(i);
    torch.blobs.length = 0;
    torches[id] = null;
  }

  /** Emit a burst of blobs from `from` toward `to` (Vector3-likes). */
  function spray(from, to) {
    _dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const dist = Math.max(1, _dir.length());
    _dir.normalize();
    for (let k = 0; k < JET.blobsPerSpray; k++) {
      const i = allocBlob();
      if (i < 0) return;
      active[i] = MODE_JET;
      torchForBlob[i] = -1;
      // small stagger back along the jet so a burst reads as a stream
      const lag = k * 0.55;
      px[i] = from.x - _dir.x * lag + (Math.random() - 0.5) * 0.2;
      py[i] = from.y - _dir.y * lag + (Math.random() - 0.5) * 0.2;
      pz[i] = from.z - _dir.z * lag + (Math.random() - 0.5) * 0.2;
      const speed = JET.speed * (0.9 + Math.random() * 0.25);
      const jx = (Math.random() - 0.5) * JET.coneJitter;
      const jy = (Math.random() - 0.5) * JET.coneJitter * 0.6;
      vx[i] = (_dir.x + jx) * speed;
      vy[i] = (_dir.y + jy) * speed;
      vz[i] = (_dir.z + (Math.random() - 0.5) * JET.coneJitter) * speed;
      age[i] = 0;
      // live just long enough to cross the gap, plus a lick of overshoot
      life[i] = Math.min(0.85, (dist / speed) * 1.2 + 0.12);
      _axis
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      axX[i] = _axis.x;
      axY[i] = _axis.y;
      axZ[i] = _axis.z;
      spin[i] = (Math.random() - 0.5) * 2;
      ang[i] = Math.random() * Math.PI * 2;
      seedArr[i] = Math.random() * 10;
    }
  }

  function update(dt, timeMs) {
    u.time.value = timeMs * 0.001;
    const tSec = u.time.value;
    let any = false;
    const damp = Math.max(0, 1 - JET.drag * dt);
    for (let i = 0; i < MAX_BLOBS; i++) {
      if (active[i] === MODE_FREE) {
        mesh.setMatrixAt(i, _hidden);
        lifeArr[i] = 1;
        continue;
      }
      any = true;
      age[i] += dt;
      const lr = age[i] / life[i];

      if (active[i] === MODE_TORCH) {
        const torch = torches[torchForBlob[i]];
        const cfg = torch ? torchCfg(torch) : TORCH;
        if (!torch || lr >= 1 || py[i] > torch.y + cfg.maxHeight) {
          if (torch) spawnTorchBlob(i, torch, Math.random() * 0.35);
          else freeBlob(i);
          continue;
        }
        const sway = tSec * 2.4 + i * 0.7;
        px[i] +=
          vx[i] * dt + Math.sin(sway) * 0.0018 + (torch.x - px[i]) * 0.02 * dt;
        py[i] += vy[i] * dt;
        pz[i] +=
          vz[i] * dt + Math.cos(sway * 0.85) * 0.0018 + (torch.z - pz[i]) * 0.02 * dt;
        ang[i] += spin[i] * cfg.spin * dt;
        const ease = 1 - (1 - lr) * (1 - lr);
        const scale =
          cfg.sizeStart + (cfg.sizeEnd - cfg.sizeStart) * ease;
        _d.position.set(px[i], py[i], pz[i]);
        _axis.set(axX[i], axY[i], axZ[i]);
        _d.quaternion.setFromAxisAngle(_axis, ang[i]);
        _d.scale.setScalar(scale);
        _d.updateMatrix();
        mesh.setMatrixAt(i, _d.matrix);
        lifeArr[i] = lr;
        continue;
      }

      if (lr >= 1) {
        freeBlob(i);
        continue;
      }
      vx[i] *= damp;
      vz[i] *= damp;
      vy[i] = vy[i] * damp + JET.buoyancy * lr * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      ang[i] += spin[i] * JET.spin * dt;

      const ease = 1 - (1 - lr) * (1 - lr);
      const scale = JET.sizeStart + (JET.sizeEnd - JET.sizeStart) * ease;
      _d.position.set(px[i], py[i], pz[i]);
      _axis.set(axX[i], axY[i], axZ[i]);
      _d.quaternion.setFromAxisAngle(_axis, ang[i]);
      _d.scale.setScalar(scale);
      _d.updateMatrix();
      mesh.setMatrixAt(i, _d.matrix);
      lifeArr[i] = lr;
    }
    for (let tid = 0; tid < MAX_TORCHES; tid++) {
      const torch = torches[tid];
      if (!torch || !Number.isFinite(torch.ttl)) continue;
      torch.ttl -= dt;
      if (torch.ttl <= 0) detachTorch(tid);
    }
    mesh.instanceMatrix.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    mesh.visible = any;
  }

  function clear() {
    for (let i = 0; i < MAX_BLOBS; i++) freeBlob(i);
    for (let i = 0; i < MAX_TORCHES; i++) torches[i] = null;
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    voroTex.dispose();
  }

  return {
    spray,
    attachTorch,
    spawnBurn,
    setTorchPosition,
    detachTorch,
    update,
    clear,
    dispose,
    uniforms: u,
    mesh,
  };
}
