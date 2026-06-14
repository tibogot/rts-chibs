/**
 * RTS river + bridges — carve channel into heightfield, water surface, deck crossings.
 */
import * as THREE from "three/webgpu";

export const RTS_RIVER_DEFAULTS = {
  enabled: false,
  halfWidth: 20,
  depth: 7.5,
  bankSharpness: 1.35,
  waterOffset: 0.45,
  deckClearance: 2.6,
  waterColor: "#1e4a5c",
  waterOpacity: 0.78,
};

/** Meandering centerline (map flows roughly NW → SE). */
export const RTS_RIVER_PATH = [
  { x: -580, z: 200 },
  { x: -360, z: 90 },
  { x: -160, z: 25 },
  { x: 40, z: -15 },
  { x: 240, z: 5 },
  { x: 460, z: -55 },
  { x: 600, z: -130 },
];

/** Extra footprint beyond deck mesh so nav cells (3 m) register as crossable. */
export const BRIDGE_NAV_MARGIN = 3.2;

/** Deck crossings — center on path, span perpendicular to flow. */
export const RTS_RIVER_BRIDGES = [
  { x: -280, z: 72, deckLength: 38, deckWidth: 12 },
  { x: -60, z: 18, deckLength: 42, deckWidth: 12 },
  { x: 200, z: -2, deckLength: 36, deckWidth: 12 },
];

function distPointToSegment2D(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) {
    const ex = px - x0;
    const ez = pz - z0;
    return Math.sqrt(ex * ex + ez * ez);
  }
  const t = THREE.MathUtils.clamp(
    ((px - x0) * dx + (pz - z0) * dz) / len2,
    0,
    1,
  );
  const qx = x0 + t * dx;
  const qz = z0 + t * dz;
  const ex = px - qx;
  const ez = pz - qz;
  return Math.sqrt(ex * ex + ez * ez);
}

/**
 * @returns {{ dist: number, px: number, pz: number, tx: number, tz: number, seg: number }}
 */
export function sampleRiver(x, z, path = RTS_RIVER_PATH) {
  let bestD = Infinity;
  let px = path[0].x;
  let pz = path[0].z;
  let tx = 1;
  let tz = 0;
  let seg = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 1e-8) {
      t = THREE.MathUtils.clamp(
        ((x - a.x) * dx + (z - a.z) * dz) / len2,
        0,
        1,
      );
    }
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    const ex = x - qx;
    const ez = z - qz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < bestD) {
      bestD = d;
      px = qx;
      pz = qz;
      const len = Math.sqrt(len2) || 1;
      tx = dx / len;
      tz = dz / len;
      seg = i;
    }
  }
  return { dist: bestD, px, pz, tx, tz, seg };
}

export function riverHalfWidth(config = RTS_RIVER_DEFAULTS) {
  return config.halfWidth ?? RTS_RIVER_DEFAULTS.halfWidth;
}

export function isInRiverWater(
  x,
  z,
  config = RTS_RIVER_DEFAULTS,
  path = RTS_RIVER_PATH,
) {
  if (config.enabled === false) return false;
  const hw = riverHalfWidth(config);
  return sampleRiver(x, z, path).dist <= hw * 1.02;
}

function bridgeYaw(br, path) {
  if (br.yaw != null) return br.yaw;
  // Memoized — bridges are static and this used to re-run sampleRiver per
  // bridge on every isOnBridgeDeck call (≈650k calls per nav-grid bake).
  if (br._yaw != null) return br._yaw;
  const { tx, tz } = sampleRiver(br.x, br.z, path);
  // Deck length is local +X; align it across the river (perpendicular to flow).
  br._yaw = Math.atan2(tx, tz) + Math.PI;
  return br._yaw;
}

/** Oriented rectangle test (deck footprint). */
export function isOnBridgeDeck(
  x,
  z,
  bridges = RTS_RIVER_BRIDGES,
  path = RTS_RIVER_PATH,
  margin = 0,
) {
  for (const br of bridges) {
    const yaw = bridgeYaw(br, path);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const lx = x - br.x;
    const lz = z - br.z;
    const localX = lx * cos + lz * sin;
    const localZ = -lx * sin + lz * cos;
    const halfL = (br.deckLength ?? 36) * 0.5 + margin;
    const halfW = (br.deckWidth ?? 12) * 0.5 + margin;
    if (Math.abs(localX) <= halfL && Math.abs(localZ) <= halfW) return true;
  }
  return false;
}

export function isBridgeNavZone(
  x,
  z,
  bridges = RTS_RIVER_BRIDGES,
  path = RTS_RIVER_PATH,
  margin = BRIDGE_NAV_MARGIN,
) {
  return isOnBridgeDeck(x, z, bridges, path, margin);
}

export function blocksRiverNav(
  x,
  z,
  config = RTS_RIVER_DEFAULTS,
  path = RTS_RIVER_PATH,
  bridges = RTS_RIVER_BRIDGES,
) {
  if (config.enabled === false) return false;
  if (isBridgeNavZone(x, z, bridges, path)) return false;
  return isInRiverWater(x, z, config, path);
}

/** Carve channel + flatten bridge decks into baked heightfield. */
export function applyRiverToHeights(
  heights,
  seg,
  vertsX,
  half,
  size,
  config = RTS_RIVER_DEFAULTS,
  path = RTS_RIVER_PATH,
  bridges = RTS_RIVER_BRIDGES,
) {
  if (config.enabled === false) return;

  const hw = riverHalfWidth(config);
  const depth = config.depth ?? RTS_RIVER_DEFAULTS.depth;
  const sharp = config.bankSharpness ?? RTS_RIVER_DEFAULTS.bankSharpness;
  const bankOuter = hw * 1.15;
  const pre = heights.slice();

  for (let zi = 0; zi <= seg; zi++) {
    const z = -half + (zi / seg) * size;
    for (let xi = 0; xi <= seg; xi++) {
      const x = -half + (xi / seg) * size;
      const { dist } = sampleRiver(x, z, path);
      if (dist > bankOuter) continue;
      const bank = Math.pow(
        1 - THREE.MathUtils.smoothstep(dist, hw * 0.55, hw),
        sharp,
      );
      if (bank <= 0) continue;
      const i = zi * vertsX + xi;
      heights[i] -= depth * bank;
    }
  }

  const clearance = config.deckClearance ?? RTS_RIVER_DEFAULTS.deckClearance;
  for (const br of bridges) {
    const yaw = bridgeYaw(br, path);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const halfL = (br.deckLength ?? 36) * 0.5;
    const halfW = (br.deckWidth ?? 12) * 0.5;
    let approachY = -Infinity;
    for (let zi = 0; zi <= seg; zi++) {
      const z = -half + (zi / seg) * size;
      for (let xi = 0; xi <= seg; xi++) {
        const x = -half + (xi / seg) * size;
        const lx = x - br.x;
        const lz = z - br.z;
        const localX = lx * cos + lz * sin;
        const localZ = -lx * sin + lz * cos;
        if (Math.abs(localX) > halfL + 4 || Math.abs(localZ) > halfW + 6) continue;
        const i = zi * vertsX + xi;
        approachY = Math.max(approachY, pre[i]);
      }
    }
    const { px, pz } = sampleRiver(br.x, br.z, path);
    const bed = sampleHeightAt(pre, seg, vertsX, half, size, px, pz);
    const deckY = Math.max(approachY - 0.5, bed + clearance);

    const rampLen = 12;
    const sidePad = 2.5;
    for (let zi = 0; zi <= seg; zi++) {
      const z = -half + (zi / seg) * size;
      for (let xi = 0; xi <= seg; xi++) {
        const x = -half + (xi / seg) * size;
        const lx = x - br.x;
        const lz = z - br.z;
        const localX = lx * cos + lz * sin;
        const localZ = -lx * sin + lz * cos;
        const absLX = Math.abs(localX);
        if (absLX > halfL + rampLen || Math.abs(localZ) > halfW + sidePad) continue;
        const i = zi * vertsX + xi;
        if (absLX <= halfL) {
          heights[i] = deckY;
        } else {
          const t = (absLX - halfL) / rampLen;
          heights[i] = deckY + (pre[i] - deckY) * t;
        }
      }
    }
  }
}

function sampleHeightAt(heights, seg, vertsX, half, size, x, z) {
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
  const idx = (a, b) => b * vertsX + a;
  const h00 = heights[idx(x0, z0)];
  const h10 = heights[idx(x1, z0)];
  const h01 = heights[idx(x0, z1)];
  const h11 = heights[idx(x1, z1)];
  const hx0 = h00 * (1 - fx) + h10 * fx;
  const hx1 = h01 * (1 - fx) + h11 * fx;
  return hx0 * (1 - fz) + hx1 * fz;
}

export function riverWaterY(
  x,
  z,
  getHeight,
  config = RTS_RIVER_DEFAULTS,
  path = RTS_RIVER_PATH,
) {
  if (!isInRiverWater(x, z, config, path)) return null;
  const off = config.waterOffset ?? RTS_RIVER_DEFAULTS.waterOffset;
  return getHeight(x, z) + off;
}

function buildWaterGeometry(
  getHeight,
  config,
  path,
  step = 14,
) {
  const hw = riverHalfWidth(config);
  const positions = [];
  const indices = [];
  const uvs = [];
  let totalLen = 0;
  const centers = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (i > 0 && k === 0) continue;
      centers.push({ x, z, tx: dx / (len || 1), tz: dz / (len || 1) });
      totalLen += len / n;
    }
  }

  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    const nx = -c.tz;
    const nz = c.tx;
    const y = riverWaterY(c.x, c.z, getHeight, config, path) ?? getHeight(c.x, c.z);
    const left = { x: c.x + nx * hw, y, z: c.z + nz * hw };
    const right = { x: c.x - nx * hw, y, z: c.z - nz * hw };
    const base = positions.length / 3;
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    const v = i * 0.08;
    uvs.push(0, v, 1, v);
    if (i < centers.length - 1) {
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildBridgeGroup(getHeight, path, bridges) {
  const g = new THREE.Group();
  g.name = "RtsBridges";
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x8a8478,
    roughness: 0.88,
    metalness: 0.06,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x5c584e,
    roughness: 0.75,
    metalness: 0.12,
  });

  for (const br of bridges) {
    const yaw = bridgeYaw(br, path);
    const deckLen = br.deckLength ?? 36;
    const deckW = br.deckWidth ?? 12;
    const y = getHeight(br.x, br.z) + 0.08;
    const bridge = new THREE.Group();
    bridge.position.set(br.x, y, br.z);
    bridge.rotation.y = yaw;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckLen, 0.55, deckW),
      deckMat,
    );
    deck.position.y = 0.28;
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridge.add(deck);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(deckLen, 0.35, 0.22),
        railMat,
      );
      rail.position.set(0, 0.72, side * (deckW * 0.42));
      rail.castShadow = true;
      bridge.add(rail);
    }

    for (const end of [-1, 1]) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(deckW * 0.7, 2.2, 1.4),
        railMat,
      );
      pier.position.set(end * (deckLen * 0.38), -0.85, 0);
      pier.castShadow = true;
      bridge.add(pier);
    }

    g.add(bridge);
  }
  return g;
}

/**
 * @param {THREE.Scene} scene
 * @param {(x:number,z:number)=>number} getHeight
 */
export function createRtsRiverSystem(
  scene,
  getHeight,
  {
    config = RTS_RIVER_DEFAULTS,
    path = RTS_RIVER_PATH,
    bridges = RTS_RIVER_BRIDGES,
  } = {},
) {
  const group = new THREE.Group();
  group.name = "RtsRiver";

  const waterMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.waterColor ?? RTS_RIVER_DEFAULTS.waterColor),
    transparent: true,
    opacity: config.waterOpacity ?? RTS_RIVER_DEFAULTS.waterOpacity,
    roughness: 0.15,
    metalness: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  let waterMesh = null;
  let bridgeGroup = null;

  function rebuild() {
    if (waterMesh) {
      group.remove(waterMesh);
      waterMesh.geometry.dispose();
      waterMesh = null;
    }
    if (bridgeGroup) {
      bridgeGroup.traverse((o) => {
        if (o.isMesh) o.geometry?.dispose();
      });
      group.remove(bridgeGroup);
      bridgeGroup = null;
    }

    if (config.enabled === false) return;

    const wGeo = buildWaterGeometry(getHeight, config, path);
    waterMesh = new THREE.Mesh(wGeo, waterMat);
    waterMesh.name = "RiverWater";
    waterMesh.receiveShadow = true;
    waterMesh.renderOrder = 1;
    group.add(waterMesh);

    bridgeGroup = buildBridgeGroup(getHeight, path, bridges);
    group.add(bridgeGroup);
  }

  rebuild();
  scene.add(group);

  return {
    group,
    config,
    path,
    bridges,
    rebuild,
    blocksNav: (x, z) => blocksRiverNav(x, z, config, path, bridges),
    blocksPlacement: (x, z) => blocksRiverNav(x, z, config, path, bridges),
    isWater: (x, z) => isInRiverWater(x, z, config, path),
    isBridge: (x, z) => isOnBridgeDeck(x, z, bridges, path),
    isBridgeNav: (x, z) => isBridgeNavZone(x, z, bridges, path),
    dispose() {
      scene.remove(group);
      waterMesh?.geometry?.dispose();
      waterMat.dispose();
      bridgeGroup?.traverse((o) => {
        if (o.isMesh) o.geometry?.dispose();
      });
    },
  };
}

/** Minimap overlay — river ribbon + bridge ticks. */
export function drawRiverOnMinimap(
  ctx,
  mini,
  mapSize,
  path = RTS_RIVER_PATH,
  bridges = RTS_RIVER_BRIDGES,
  config = RTS_RIVER_DEFAULTS,
) {
  if (config.enabled === false) return;
  const half = mapSize * 0.5;
  const toMini = (wx, wz) => ({
    x: ((wx + half) / mapSize) * mini,
    y: ((wz + half) / mapSize) * mini,
  });

  ctx.save();
  ctx.strokeStyle = "rgba(42,110,140,0.55)";
  ctx.lineWidth = Math.max(3, (riverHalfWidth(config) / mapSize) * mini * 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    const p = toMini(path[i].x, path[i].z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(200,190,170,0.9)";
  ctx.lineWidth = 2;
  for (const br of bridges) {
    const yaw = bridgeYaw(br, path);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const halfL = (br.deckLength ?? 36) * 0.5;
    const x0 = br.x - cos * halfL;
    const z0 = br.z - sin * halfL;
    const x1 = br.x + cos * halfL;
    const z1 = br.z + sin * halfL;
    const a = toMini(x0, z0);
    const b = toMini(x1, z1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}
