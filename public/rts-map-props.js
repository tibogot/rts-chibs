/**
 * CoH-style static map props — roads, ruin clusters, tank traps, wire.
 * Feeds nav stamping, cover evaluation, and runtime obstacle push-out.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRtsBuildingGlbMesh, isRtsBuildingGlbRoot, snapRtsBuildingGroupToTerrain, snapRtsBuildingGroupToTerrainCenter } from "./rts-buildings.js";

export const RTS_MAP_PROPS_DEFAULTS = {
  enabled: true,
  roads: false,
  ruins: true,
  tankTraps: true,
  wire: true,
  containers: true,
  radioStations: true,
  roadWidth: 1,
  ruinScale: 1,
};

/** Authored placements tuned for RTS_MAP_SIZE ~1440, bases at z ≈ ±528. */
export const RTS_MAP_PROP_LAYOUT = {
  roads: [
    {
      id: "main-ew",
      width: 9,
      points: [
        [-440, 18],
        [-240, 12],
        [-80, 6],
        [80, 0],
        [240, -6],
        [440, -14],
      ],
    },
    {
      id: "main-ns",
      width: 7,
      points: [
        [28, -440],
        [28, -240],
        [28, -60],
        [28, 80],
        [28, 260],
        [28, 440],
      ],
    },
    {
      id: "player-approach",
      width: 6,
      points: [
        [-72, 460],
        [-48, 340],
        [-20, 200],
        [0, 80],
      ],
    },
    {
      id: "enemy-approach",
      width: 6,
      points: [
        [64, -460],
        [36, -340],
        [12, -200],
        [0, -72],
      ],
    },
  ],
  ruinClusters: [
    {
      id: "crossroads",
      x: -88,
      z: 36,
      rot: 0.35,
      pieces: [
        { x: 0, z: 0, w: 14, d: 10, h: 4.2, coverTier: "yellow" },
        { x: 10, z: -6, w: 8, d: 7, h: 2.8, coverTier: "yellow" },
        { x: -9, z: 8, w: 6, d: 9, h: 2.2, coverTier: "green" },
        { x: 5, z: 10, w: 5, d: 5, h: 1.6, coverTier: "green" },
        { x: -12, z: -4, w: 9, d: 5, h: 3.4, coverTier: "red" },
      ],
    },
    {
      id: "west-hamlet",
      x: -268,
      z: 148,
      rot: -0.5,
      pieces: [
        { x: 0, z: 0, w: 12, d: 9, h: 3.8, coverTier: "yellow" },
        { x: 11, z: 4, w: 7, d: 6, h: 2.4, coverTier: "green" },
        { x: -8, z: -7, w: 8, d: 8, h: 2.9, coverTier: "yellow" },
        { x: 4, z: -9, w: 10, d: 4, h: 1.8, coverTier: "green" },
      ],
    },
    {
      id: "east-farm",
      x: 252,
      z: -108,
      rot: 0.9,
      pieces: [
        { x: 0, z: 0, w: 16, d: 8, h: 3.2, coverTier: "yellow" },
        { x: -10, z: 6, w: 6, d: 10, h: 2.5, coverTier: "green" },
        { x: 9, z: -5, w: 7, d: 7, h: 3.6, coverTier: "red" },
        { x: 2, z: 9, w: 5, d: 5, h: 1.5, coverTier: "green" },
      ],
    },
    {
      id: "north-ruins",
      x: -52,
      z: 272,
      rot: 0.1,
      pieces: [
        { x: 0, z: 0, w: 11, d: 11, h: 4.5, coverTier: "red" },
        { x: 8, z: -5, w: 6, d: 8, h: 2.2, coverTier: "yellow" },
        { x: -7, z: 6, w: 7, d: 5, h: 1.9, coverTier: "green" },
      ],
    },
    {
      id: "south-ruins",
      x: 108,
      z: -228,
      rot: -0.25,
      pieces: [
        { x: 0, z: 0, w: 13, d: 9, h: 3.5, coverTier: "yellow" },
        { x: -9, z: 4, w: 8, d: 6, h: 2.8, coverTier: "yellow" },
        { x: 7, z: -6, w: 5, d: 7, h: 2.0, coverTier: "green" },
      ],
    },
  ],
  /** Shipping-container yards — supply clutter near bases and ruins. */
  containerClusters: [
    {
      id: "player-supply",
      x: -42,
      z: 468,
      rot: 0.12,
      items: [
        { x: 0, z: 0, rot: 0 },
        { x: 7.8, z: 0.4, rot: 0.1 },
        { x: 4.2, z: 5.6, rot: -0.14 },
        { x: 11.5, z: 5.2, rot: 0.06 },
      ],
    },
    {
      id: "enemy-supply",
      x: 48,
      z: -465,
      rot: -0.18,
      items: [
        { x: 0, z: 0, rot: 0.05 },
        { x: -7.5, z: 0.8, rot: -0.08 },
        { x: -3.5, z: -5.4, rot: 0.12 },
        { x: 8.2, z: -4.8, rot: -0.05 },
      ],
    },
    {
      id: "crossroads-yard",
      x: -128,
      z: 18,
      rot: 0.65,
      items: [
        { x: 0, z: 0, rot: 0 },
        { x: 6.8, z: 1.8, rot: 0.18 },
        { x: -4.5, z: 5.5, rot: -0.22 },
      ],
    },
    {
      id: "east-farm-yard",
      x: 272,
      z: -98,
      rot: -0.35,
      items: [
        { x: 0, z: 0, rot: 0 },
        { x: 7.2, z: -1.2, rot: 0.1 },
        { x: 3.5, z: 5.8, rot: -0.08 },
      ],
    },
    {
      id: "west-hamlet-yard",
      x: -285,
      z: 142,
      rot: 0.42,
      items: [
        { x: 0, z: 0, rot: 0 },
        { x: 6.5, z: 2.2, rot: 0.15 },
      ],
    },
  ],
  /** Comms masts — placed near capture nodes and approaches. */
  radioStations: [
    { x: 24, z: -22, rot: 0.5 },
    { x: -198, z: 172, rot: -0.85 },
    { x: 188, z: -178, rot: 0.3 },
    { x: -148, z: -308, rot: 1.05 },
    { x: 168, z: 302, rot: -0.4 },
    { x: -62, z: 438, rot: 0.15 },
    { x: 58, z: -432, rot: -0.25 },
  ],
  tankTrapLines: [
    { x: -108, z: -168, rot: 0, count: 11, spacing: 4.2 },
    { x: 108, z: -168, rot: 0, count: 11, spacing: 4.2 },
    { x: -72, z: 156, rot: Math.PI * 0.5, count: 9, spacing: 4.0 },
    { x: 72, z: 156, rot: Math.PI * 0.5, count: 9, spacing: 4.0 },
  ],
  wireLines: [
    {
      id: "enemy-belt",
      halfWidth: 1.35,
      points: [
        [-200, -340],
        [-120, -358],
        [-40, -348],
        [40, -362],
        [120, -352],
        [200, -368],
      ],
    },
    {
      id: "mid-south",
      halfWidth: 1.2,
      points: [
        [-140, -120],
        [-60, -132],
        [20, -124],
        [100, -136],
      ],
    },
    {
      id: "player-belt",
      halfWidth: 1.35,
      points: [
        [-180, 318],
        [-100, 332],
        [-20, 324],
        [60, 338],
        [140, 328],
        [210, 342],
      ],
    },
  ],
};

/** Terrain flatten pads for GLB field props (smooth pad before placement). */
export function getRtsMapPropFlattenPads(layout = RTS_MAP_PROP_LAYOUT) {
  const pads = [];
  for (const st of layout.radioStations ?? []) {
    pads.push({
      x: st.x,
      z: st.z,
      radius: st.flattenR ?? 38,
      core: st.flattenCore ?? 0.6,
    });
  }
  for (const cl of layout.containerClusters ?? []) {
    pads.push({
      x: cl.x,
      z: cl.z,
      radius: cl.flattenR ?? 22,
      core: cl.flattenCore ?? 0.58,
    });
  }
  return pads;
}

function yawPoint(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c - z * s, z: x * s + z * c };
}

function coverRadius(w, d) {
  return Math.max(w, d) * 0.42 + 1.2;
}

function addHedgehog(group, x, z, rotY, mats, getHeight) {
  const g = createRtsBuildingGlbMesh("hedgehog") ?? new THREE.Group();
  if (!g.userData.glbBuilding) {
    const len = 2.1;
    const thick = 0.22;
    for (let i = 0; i < 3; i++) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(thick, thick, len),
        mats.trap,
      );
      beam.rotation.y = rotY + (i * Math.PI) / 3;
      beam.position.y = len * 0.28;
      beam.castShadow = true;
      g.add(beam);
    }
  }
  const y = getHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rotY * 0.37;
  group.add(g);
  return { x, z, r: 1.85, coverTier: "green" };
}

function placeGlbProp(
  group,
  type,
  x,
  z,
  rotY,
  getHeight,
  fallbackMat,
  fallbackSize,
  opts = {},
) {
  let g = createRtsBuildingGlbMesh(type);
  if (!g && fallbackMat && fallbackSize) {
    g = new THREE.Mesh(
      new THREE.BoxGeometry(fallbackSize[0], fallbackSize[1], fallbackSize[2]),
      fallbackMat,
    );
    g.position.y = fallbackSize[1] * 0.5;
  }
  if (!g) return null;
  g.rotation.y = rotY;
  if (opts.useFootprintSnap) {
    g.position.set(x, getHeight(x, z), z);
    snapRtsBuildingGroupToTerrain(g, getHeight, x, z);
  } else {
    snapRtsBuildingGroupToTerrainCenter(g, getHeight, x, z);
  }
  group.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const hx = (box.max.x - box.min.x) * 0.5;
  const hz = (box.max.z - box.min.z) * 0.5;
  const r = Math.max(hx, hz) + 0.6;
  return { x, z, r };
}

function buildContainerCluster(group, cluster, getHeight, out) {
  const c = Math.cos(cluster.rot ?? 0);
  const s = Math.sin(cluster.rot ?? 0);
  for (const item of cluster.items) {
    const lx = item.x;
    const lz = item.z;
    const wx = cluster.x + lx * c - lz * s;
    const wz = cluster.z + lx * s + lz * c;
    const rotY = (cluster.rot ?? 0) + (item.rot ?? 0);
    const fp = placeGlbProp(
      group,
      "container",
      wx,
      wz,
      rotY,
      getHeight,
      null,
      null,
    );
    if (!fp) continue;
    out.navCircles.push({ x: fp.x, z: fp.z, r: fp.r * 0.82 });
    out.pushCircles.push({ x: fp.x, z: fp.z, r: fp.r });
    out.coverPieces.push({
      x: fp.x,
      z: fp.z,
      r: fp.r + 0.8,
      coverTier: "yellow",
    });
  }
}

function buildRadioStations(group, stations, getHeight, out) {
  for (const st of stations) {
    const fp = placeGlbProp(
      group,
      "radiostation",
      st.x,
      st.z,
      st.rot ?? 0,
      getHeight,
      null,
      null,
    );
    if (!fp) continue;
    out.navCircles.push({ x: fp.x, z: fp.z, r: fp.r * 0.9 });
    out.pushCircles.push({ x: fp.x, z: fp.z, r: fp.r + 0.5 });
    out.coverPieces.push({
      x: fp.x,
      z: fp.z,
      r: fp.r + 1.4,
      coverTier: "yellow",
    });
  }
}

const ROAD_LIFT = 0.14;
const ROAD_STEP = 2;
const ROAD_PROBE = 2.8;

/** Max height in a small neighborhood + slope-aware lift so the deck clears the mesh. */
function sampleRoadSurfaceY(getHeight, x, z, lift = ROAD_LIFT) {
  let h = getHeight(x, z);
  const p = ROAD_PROBE;
  const offsets = [
    [p, 0],
    [-p, 0],
    [0, p],
    [0, -p],
    [p * 0.72, p * 0.72],
    [-p * 0.72, p * 0.72],
    [p * 0.72, -p * 0.72],
    [-p * 0.72, -p * 0.72],
    [p * 0.38, 0],
    [-p * 0.38, 0],
    [0, p * 0.38],
    [0, -p * 0.38],
  ];
  for (const [ox, oz] of offsets) {
    h = Math.max(h, getHeight(x + ox, z + oz));
  }
  const hPx = getHeight(x + 1.4, z) - getHeight(x - 1.4, z);
  const hPz = getHeight(x, z + 1.4) - getHeight(x, z - 1.4);
  const slope = Math.hypot(hPx, hPz) * 0.5;
  return h + lift + Math.min(slope * 0.4, 0.3);
}

/** Ribbon deck — uniform height per cross-section (matches flattened corridor). */
function buildRoadRibbon(group, pts, halfW, mat, getHeight, lift = ROAD_LIFT) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;

    const steps = Math.max(2, Math.ceil(len / ROAD_STEP));
    const perpX = -dz / len;
    const perpZ = dx / len;

    const positions = [];
    const uvs = [];
    const indices = [];

    const stations = [];
    const pushStation = (t) => {
      const cx = x0 + dx * t;
      const cz = z0 + dz * t;
      const y = sampleRoadSurfaceY(getHeight, cx, cz, lift);
      stations.push({
        lx: cx + perpX * halfW,
        lz: cz + perpZ * halfW,
        rx: cx - perpX * halfW,
        rz: cz - perpZ * halfW,
        y,
        t,
      });
    };

    for (let s = 0; s <= steps; s++) pushStation(s / steps);
    for (let s = 0; s < steps; s++) pushStation((s + 0.5) / steps);
    stations.sort((a, b) => a.t - b.t);

    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      positions.push(st.lx, st.y, st.lz, st.rx, st.y, st.rz);
      uvs.push(st.t, 0, st.t, 1);

      if (s < stations.length - 1) {
        const a = s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
}

function buildRoadStrip(group, road, mats, getHeight, widthMul) {
  const width = road.width * widthMul;
  const halfW = width * 0.5;
  buildRoadRibbon(group, road.points, halfW, mats.road, getHeight);

  const edgeW = 0.42;
  const outer = halfW + edgeW * 0.5;
  for (const side of [-1, 1]) {
    const offsetPts = [];
    const pts = road.points;
    for (let p = 0; p < pts.length; p++) {
      let dirX = 0;
      let dirZ = 1;
      if (p < pts.length - 1) {
        const dx = pts[p + 1][0] - pts[p][0];
        const dz = pts[p + 1][1] - pts[p][1];
        const l = Math.hypot(dx, dz) || 1;
        dirX = dx / l;
        dirZ = dz / l;
      } else if (p > 0) {
        const dx = pts[p][0] - pts[p - 1][0];
        const dz = pts[p][1] - pts[p - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        dirX = dx / l;
        dirZ = dz / l;
      }
      const perpX = -dirZ * side;
      const perpZ = dirX * side;
      offsetPts.push([
        pts[p][0] + perpX * outer,
        pts[p][1] + perpZ * outer,
      ]);
    }
    buildRoadRibbon(
      group,
      offsetPts,
      edgeW * 0.5,
      mats.roadEdge,
      getHeight,
      ROAD_LIFT - 0.02,
    );
  }
}

function buildRuinPiece(group, cluster, piece, mats, getHeight, scale) {
  const local = yawPoint(piece.x * scale, piece.z * scale, cluster.rot);
  const x = cluster.x + local.x;
  const z = cluster.z + local.z;
  const w = piece.w * scale;
  const d = piece.d * scale;
  const h = piece.h * scale;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    piece.coverTier === "red" ? mats.rubbleHeavy : mats.rubble,
  );
  const y = getHeight(x, z);
  mesh.position.set(x, y + h * 0.5 - 0.15, z);
  mesh.rotation.y = cluster.rot + (piece.x + piece.z) * 0.07;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const r = coverRadius(w, d);
  return {
    x,
    z,
    r,
    coverTier: piece.coverTier ?? "yellow",
    navR: Math.max(w, d) * 0.38 + 0.8,
  };
}

function buildWireLine(group, line, mats, getHeight, out) {
  const pts = line.points;
  const hw = line.halfWidth ?? 1.2;
  const postH = 1.85;
  const postY = postH * 0.5;
  // Multiple horizontal runs — readable from the RTS camera (single 8cm strand was invisible).
  const strandHeights = [0.42, 0.78, 1.12, 1.44];

  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const y = getHeight(x, z);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.13, postH, 6),
      mats.wirePost,
    );
    post.position.set(x, y + postY, z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.1, 0.22),
      mats.wirePostCap,
    );
    cap.position.set(x, y + postH + 0.02, z);
    cap.castShadow = true;
    group.add(cap);

    out.navCircles.push({ x, z, r: hw + 0.35 });
    out.pushCircles.push({ x, z, r: hw + 0.5 });
    out.coverPieces.push({
      x,
      z,
      r: hw + 1.8,
      coverTier: "green",
    });
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const midX = (x0 + x1) * 0.5;
    const midZ = (z0 + z1) * 0.5;
    const y0 = getHeight(x0, z0);
    const y1 = getHeight(x1, z1);
    const rotY = Math.atan2(dx, dz);

    for (const strandLift of strandHeights) {
      const strand = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.1, 0.09),
        mats.wire,
      );
      const t0 = strandLift / postH;
      const strandY = y0 * (1 - t0) + y1 * t0 + strandLift;
      strand.position.set(midX, strandY, midZ);
      strand.rotation.y = rotY;
      strand.castShadow = true;
      group.add(strand);
    }

    // Occasional barb spurs along the run (silhouette from above).
    const spurCount = Math.max(2, Math.floor(len / 7));
    for (let s = 1; s < spurCount; s++) {
      const t = s / spurCount;
      const sx = x0 + dx * t;
      const sz = z0 + dz * t;
      const sy = y0 * (1 - t) + y1 * t;
      const spur = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.32, 0.06),
        mats.wireBarb,
      );
      spur.position.set(sx, sy + 0.92, sz);
      spur.rotation.y = rotY + (s % 2 ? 0.55 : -0.55);
      spur.castShadow = true;
      group.add(spur);
    }

    out.navSegments.push({ x0, z0, x1, z1, halfWidth: hw });
  }
}

/**
/**
 * Collapse the props group into a handful of draw calls:
 *   - repeated GLB props (all share their template's geometry/material) →
 *     one InstancedMesh per template submesh,
 *   - one-off procedural meshes → merged by material into one mesh each.
 * The group sits at the scene origin with identity transform, so each child's
 * world matrix is already its group-local matrix. Nav/cover data is derived
 * from positions during build() and is untouched here — this is purely visual.
 */
function batchStaticGroup(group) {
  group.updateMatrixWorld(true);
  // glbType -> { submeshes:[{geo,mat,local,castShadow,receiveShadow}], matrices:[] }
  const glbBuckets = new Map();
  // material.uuid -> { material, originals:[mesh], castShadow, receiveShadow }
  const procBuckets = new Map();

  for (const child of group.children) {
    if (child.userData?.glbBuilding) {
      child.updateMatrixWorld(true);
      let bucket = glbBuckets.get(child.userData.glbBuilding);
      if (!bucket) {
        // First instance defines the (shared) submesh templates.
        bucket = { submeshes: [], matrices: [] };
        const rootInv = child.matrixWorld.clone().invert();
        child.traverse((o) => {
          if (!o.isMesh || Array.isArray(o.material)) return;
          o.updateMatrixWorld(true);
          bucket.submeshes.push({
            geo: o.geometry,
            mat: o.material,
            local: o.matrixWorld.clone().premultiply(rootInv),
            castShadow: o.castShadow,
            receiveShadow: o.receiveShadow,
          });
        });
        glbBuckets.set(child.userData.glbBuilding, bucket);
      }
      bucket.matrices.push(child.matrixWorld.clone());
    } else if (child.isMesh && !Array.isArray(child.material)) {
      const key = child.material.uuid;
      let pb = procBuckets.get(key);
      if (!pb) {
        pb = {
          material: child.material,
          originals: [],
          castShadow: child.castShadow,
          receiveShadow: child.receiveShadow,
        };
        procBuckets.set(key, pb);
      }
      pb.originals.push(child);
    }
    // Non-mesh / multi-material children (e.g. hedgehog fallback group) are
    // left as-is — they're rare and not worth the special-casing.
  }

  // Instance the GLB props. Geometry/material are shared with the cached
  // template, so they're marked glbBatch and never disposed by clearGroup().
  for (const [type, bucket] of glbBuckets) {
    const n = bucket.matrices.length;
    if (!n) continue;
    const m = new THREE.Matrix4();
    for (const sm of bucket.submeshes) {
      const im = new THREE.InstancedMesh(sm.geo, sm.mat, n);
      im.name = `RtsMapProps-${type}`;
      im.userData.glbBatch = true;
      im.frustumCulled = false;
      im.castShadow = sm.castShadow;
      im.receiveShadow = sm.receiveShadow;
      for (let i = 0; i < n; i++) {
        m.multiplyMatrices(bucket.matrices[i], sm.local);
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
    // GLB roots are now redundant — remove without disposing shared resources.
    for (const child of group.children.slice()) {
      if (child.userData?.glbBuilding === type) group.remove(child);
    }
  }

  // Merge each procedural material bucket into a single mesh.
  for (const pb of procBuckets.values()) {
    if (pb.originals.length < 2) continue; // nothing to gain from a single mesh
    const geos = pb.originals.map((mesh) => {
      mesh.updateMatrixWorld(true);
      return mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    });
    let merged = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch {
      merged = null;
    }
    for (const g of geos) g.dispose?.();
    if (!merged) continue; // attribute mismatch — leave originals in place
    for (const mesh of pb.originals) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
    }
    const mesh = new THREE.Mesh(merged, pb.material);
    mesh.name = "RtsMapProps-merged";
    mesh.userData.procBatch = true;
    mesh.castShadow = pb.castShadow;
    mesh.receiveShadow = pb.receiveShadow;
    group.add(mesh);
  }
}

/**
 * @param {THREE.Scene} scene
 * @param {object} opts
 * @param {(x:number,z:number)=>number} opts.getHeight
 * @param {object} [opts.config]
 * @param {object} [opts.layout]
 */
export function createRtsMapProps(scene, opts = {}) {
  const getHeight = opts.getHeight ?? (() => 0);
  const config = { ...RTS_MAP_PROPS_DEFAULTS, ...opts.config };
  const layout = opts.layout ?? RTS_MAP_PROP_LAYOUT;

  const group = new THREE.Group();
  group.name = "RtsMapProps";
  scene.add(group);

  const roadMatOpts = {
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  };
  const mats = {
    road: new THREE.MeshStandardMaterial({
      color: 0x5a5248,
      roughness: 0.92,
      metalness: 0.02,
      ...roadMatOpts,
    }),
    roadEdge: new THREE.MeshStandardMaterial({
      color: 0x4a4438,
      roughness: 0.95,
      metalness: 0,
      ...roadMatOpts,
    }),
    rubble: new THREE.MeshStandardMaterial({
      color: 0x6a6258,
      roughness: 0.94,
      metalness: 0.03,
    }),
    rubbleHeavy: new THREE.MeshStandardMaterial({
      color: 0x524a42,
      roughness: 0.96,
      metalness: 0.04,
    }),
    trap: new THREE.MeshStandardMaterial({
      color: 0x4a4a52,
      roughness: 0.72,
      metalness: 0.35,
    }),
    wire: new THREE.MeshStandardMaterial({
      color: 0xc8ccd4,
      roughness: 0.38,
      metalness: 0.62,
      emissive: 0x1a1a22,
      emissiveIntensity: 0.08,
    }),
    wireBarb: new THREE.MeshStandardMaterial({
      color: 0x9aa0aa,
      roughness: 0.42,
      metalness: 0.55,
    }),
    wirePost: new THREE.MeshStandardMaterial({
      color: 0x4a4034,
      roughness: 0.88,
      metalness: 0.08,
    }),
    wirePostCap: new THREE.MeshStandardMaterial({
      color: 0x6a5c48,
      roughness: 0.78,
      metalness: 0.12,
    }),
  };

  const state = {
    navCircles: [],
    navSegments: [],
    coverPieces: [],
    pushCircles: [],
  };

  function clearGroup() {
    while (group.children.length) {
      const ch = group.children[0];
      group.remove(ch);
      // GLB roots and instanced GLB batches reference shared template
      // geometry/material from the building cache — never dispose those.
      if (isRtsBuildingGlbRoot(ch) || ch.userData?.glbBatch) continue;
      // Merged procedural batch owns its geometry — dispose it.
      if (ch.userData?.procBatch) {
        ch.geometry?.dispose?.();
        continue;
      }
      ch.traverse?.((o) => {
        if (o.geometry && o.geometry !== ch.geometry) o.geometry.dispose?.();
      });
    }
    state.navCircles.length = 0;
    state.navSegments.length = 0;
    state.coverPieces.length = 0;
    state.pushCircles.length = 0;
  }

  function build() {
    clearGroup();
    if (!config.enabled) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const rs = config.ruinScale ?? 1;
    const rw = config.roadWidth ?? 1;

    if (config.roads) {
      for (const road of layout.roads) {
        buildRoadStrip(group, road, mats, getHeight, rw);
      }
    }

    if (config.ruins) {
      for (const cluster of layout.ruinClusters) {
        for (const piece of cluster.pieces) {
          const fp = buildRuinPiece(group, cluster, piece, mats, getHeight, rs);
          state.navCircles.push({ x: fp.x, z: fp.z, r: fp.navR });
          state.pushCircles.push({ x: fp.x, z: fp.z, r: fp.navR });
          state.coverPieces.push({
            x: fp.x,
            z: fp.z,
            r: fp.r,
            coverTier: fp.coverTier,
          });
        }
      }
    }

    if (config.tankTraps) {
      for (const line of layout.tankTrapLines) {
        const c = Math.cos(line.rot ?? 0);
        const s = Math.sin(line.rot ?? 0);
        for (let i = 0; i < line.count; i++) {
          const ox = (i - (line.count - 1) * 0.5) * line.spacing;
          const x = line.x + ox * c;
          const z = line.z + ox * s;
          const fp = addHedgehog(
            group,
            x,
            z,
            line.rot ?? 0,
            mats,
            getHeight,
          );
          state.navCircles.push(fp);
          state.pushCircles.push({ x: fp.x, z: fp.z, r: fp.r });
          state.coverPieces.push(fp);
        }
      }
    }

    if (config.wire) {
      for (const wire of layout.wireLines) {
        buildWireLine(group, wire, mats, getHeight, state);
      }
    }

    if (config.containers) {
      for (const cluster of layout.containerClusters ?? []) {
        buildContainerCluster(group, cluster, getHeight, state);
      }
    }

    if (config.radioStations) {
      buildRadioStations(
        group,
        layout.radioStations ?? [],
        getHeight,
        state,
      );
    }

    // Collapse the hundreds of individual prop meshes into a handful of
    // instanced/merged draw calls.
    batchStaticGroup(group);

    // Props never move after placement. Update world matrices once, then opt
    // the whole subtree out of the renderer's per-frame matrix traversal —
    // these were a big chunk of the ~14% spent in updateMatrixWorld/compose
    // under load. Re-runs on every rebuild() so freshly placed props are fixed.
    group.matrixWorldAutoUpdate = true;
    group.updateMatrixWorld(true);
    group.matrixWorldAutoUpdate = false;
  }

  build();

  return {
    group,
    config,
    layout,
    mats,
    get navCircles() {
      return state.navCircles;
    },
    get navSegments() {
      return state.navSegments;
    },
    get coverPieces() {
      return state.coverPieces;
    },
    get pushCircles() {
      return state.pushCircles;
    },
    rebuild(nextConfig) {
      Object.assign(config, nextConfig);
      build();
    },
    dispose() {
      clearGroup();
      scene.remove(group);
      for (const m of Object.values(mats)) m.dispose?.();
    },
  };
}

/** Stamp a nav segment as a chain of blocked circles (wire, walls). */
export function stampNavSegment(
  grid,
  cols,
  rows,
  minX,
  minZ,
  cellSize,
  x0,
  z0,
  x1,
  z1,
  halfWidth,
  blockReason = null,
  reason = 6,
) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(2, Math.ceil(len / (cellSize * 0.45)));
  const rr = halfWidth;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const minC = Math.max(0, Math.floor((x - rr - minX) / cellSize));
    const maxC = Math.min(cols - 1, Math.ceil((x + rr - minX) / cellSize));
    const minR = Math.max(0, Math.floor((z - rr - minZ) / cellSize));
    const maxR = Math.min(rows - 1, Math.ceil((z + rr - minZ) / cellSize));
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const wx = minX + (c + 0.5) * cellSize;
        const wz = minZ + (r + 0.5) * cellSize;
        const dx = wx - x;
        const dz = wz - z;
        if (dx * dx + dz * dz < rr * rr) {
          const hi = r * cols + c;
          grid[hi] = 1;
          if (blockReason) blockReason[hi] = reason;
        }
      }
    }
  }
}
