/**
 * RTS tactical minimap — baked terrain satellite layer + styled overlays.
 */
import * as THREE from "three";

const TERRAIN_RES = 280;

const _ndcCorners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const _raycaster = new THREE.Raycaster();
const _rayHit = new THREE.Vector3();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ndc = new THREE.Vector2();

/** Perspective camera footprint on the ground — CoH-style trapezoid (no minimap rotation). */
function getCameraGroundFootprint(camera, groundY) {
  _groundPlane.constant = -groundY;
  const pts = [];
  for (const [nx, ny] of _ndcCorners) {
    _ndc.set(nx, ny);
    _raycaster.setFromCamera(_ndc, camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _rayHit);
    if (!hit) return null;
    pts.push({ x: _rayHit.x, z: _rayHit.z });
  }
  return pts;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb(a, b, t) {
  return [
    (lerp(a[0], b[0], t) + 0.5) | 0,
    (lerp(a[1], b[1], t) + 0.5) | 0,
    (lerp(a[2], b[2], t) + 0.5) | 0,
  ];
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Sample height + slope into a satellite-style terrain basemap.
 * @param {object} o
 * @param {number} o.mapSize
 * @param {(x:number,z:number)=>number} o.getHeight
 * @param {(x:number,z:number)=>number} o.getSlope
 * @param {number} [o.res=280]
 */
export function bakeMinimapTerrain({ mapSize, getHeight, getSlope, res = TERRAIN_RES }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(res, res);
  const data = img.data;
  const half = mapSize * 0.5;

  let minH = Infinity;
  let maxH = -Infinity;
  const heights = new Float32Array(res * res);
  for (let py = 0; py < res; py++) {
    const wz = (py / (res - 1)) * mapSize - half;
    for (let px = 0; px < res; px++) {
      const wx = (px / (res - 1)) * mapSize - half;
      const h = getHeight(wx, wz);
      const i = py * res + px;
      heights[i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const hSpan = Math.max(1, maxH - minH);

  const grassLow = [52, 78, 44];
  const grassMid = [68, 96, 54];
  const grassHigh = [82, 108, 62];
  const cliff = [112, 96, 76];
  const cliffSteep = [78, 70, 60];

  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const i = py * res + px;
      const h = heights[i];
      const wz = (py / (res - 1)) * mapSize - half;
      const wx = (px / (res - 1)) * mapSize - half;
      const slope = getSlope(wx, wz);
      const hn = (h - minH) / hSpan;
      const n = hash2(px * 0.31, py * 0.27) * 0.08 - 0.04;

      let rgb;
      if (slope > 0.32) {
        const t = Math.min(1, (slope - 0.32) / 0.28);
        rgb = lerpRgb(cliff, cliffSteep, t);
      } else if (hn < 0.35) {
        rgb = lerpRgb(grassLow, grassMid, hn / 0.35);
      } else {
        rgb = lerpRgb(grassMid, grassHigh, (hn - 0.35) / 0.65);
      }

      rgb[0] = Math.max(0, Math.min(255, rgb[0] + n * 255));
      rgb[1] = Math.max(0, Math.min(255, rgb[1] + n * 255));
      rgb[2] = Math.max(0, Math.min(255, rgb[2] + n * 255));

      const p = i * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Subtle grid (tactical chart lines).
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  const step = res / 8;
  for (let i = 1; i < 8; i++) {
    const g = i * step;
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, res);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(res, g);
    ctx.stroke();
  }

  return canvas;
}

function worldToMini(x, z, mapSize, mini) {
  return {
    x: (x / mapSize + 0.5) * mini,
    y: (z / mapSize + 0.5) * mini,
  };
}

function drawVignette(ctx, mini) {
  const g = ctx.createRadialGradient(
    mini * 0.5,
    mini * 0.5,
    mini * 0.2,
    mini * 0.5,
    mini * 0.5,
    mini * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, mini, mini);
}

function drawCaptureNode(ctx, x, y, owner) {
  const col =
    owner === "player"
      ? "#58a8ff"
      : owner === "enemy"
        ? "#e85848"
        : "#a8a898";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOreDeposit(ctx, x, y, frac) {
  if (frac <= 0.02) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(220,170,60,0.45)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = `rgba(212,168,64,${0.55 + frac * 0.35})`;
  ctx.strokeStyle = "rgba(255,230,160,0.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const r = 3.2 * (0.65 + frac * 0.35);
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBaseIcon(ctx, x, y, r, faction, dead) {
  ctx.save();
  if (dead) {
    ctx.strokeStyle = "rgba(140,140,140,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const col = faction === "player" ? "#58d8ff" : "#ff6050";
  ctx.shadowColor = faction === "player" ? "rgba(88,216,255,0.5)" : "rgba(255,96,80,0.5)";
  ctx.shadowBlur = 6;
  ctx.fillStyle =
    faction === "player" ? "rgba(88,216,255,0.22)" : "rgba(255,96,80,0.22)";
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - r * 0.55, y - r * 0.55, r * 1.1, r * 1.1);
  ctx.fillStyle = col;
  ctx.fillRect(x - 2, y - 2, 4, 4);
  ctx.restore();
}

function drawUnitBlip(ctx, x, y, u) {
  const size =
    u.type === "artillery"
      ? 4.2
      : u.type === "tank"
        ? 3.6
        : u.type === "helicopter"
          ? 3.4
          : u.type === "harvester"
            ? 3.2
            : u.type === "bulldozer"
              ? 3.4
              : 2.8;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(u.heading ?? 0);
  const isPlayer = u.faction === "player";
  ctx.fillStyle = isPlayer
    ? u.selected
      ? "#e8f4ff"
      : "#58a8ff"
    : "#ff5850";
  ctx.strokeStyle = isPlayer ? "rgba(20,40,90,0.7)" : "rgba(40,0,0,0.65)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.72, size * 0.82);
  ctx.lineTo(size * 0.72, size * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (u.selected) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, size + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCameraViewport(ctx, { mini, mapSize, target, camera }) {
  const footprint = getCameraGroundFootprint(camera, target.y);
  if (!footprint) return;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < footprint.length; i++) {
    const { x, y } = worldToMini(footprint[i].x, footprint[i].z, mapSize, mini);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const { x: cx, y: cy } = worldToMini(target.x, target.z, mapSize, mini);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 */
export function drawRtsMinimap(ctx, state) {
  const {
    mini,
    mapSize,
    terrainCanvas,
    fogCanvas,
    fogEnabled,
    obstacles,
    nodes,
    nodesEnabled,
    deposits,
    oreEnabled,
    structures,
    bases,
    units,
    camera,
    target,
    visibleAt,
    exploredAt,
  } = state;

  ctx.clearRect(0, 0, mini, mini);

  if (terrainCanvas) {
    ctx.drawImage(terrainCanvas, 0, 0, mini, mini);
  } else {
    ctx.fillStyle = "#2a3428";
    ctx.fillRect(0, 0, mini, mini);
  }

  if (fogEnabled && fogCanvas) {
    ctx.drawImage(fogCanvas, 0, 0, mini, mini);
  }

  // Obstacles — soft rocky blobs.
  for (const o of obstacles) {
    if (fogEnabled && exploredAt && !exploredAt(o.x, o.z)) continue;
    const { x, y } = worldToMini(o.x, o.z, mapSize, mini);
    const r = Math.max(2, (o.r / mapSize) * mini);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(90,84,78,0.95)");
    g.addColorStop(0.65, "rgba(72,68,62,0.75)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (oreEnabled && deposits) {
    for (const d of deposits) {
      if (fogEnabled && exploredAt && !exploredAt(d.x, d.z)) continue;
      const frac = d.maxAmount > 0 ? d.amount / d.maxAmount : 0;
      const { x, y } = worldToMini(d.x, d.z, mapSize, mini);
      drawOreDeposit(ctx, x, y, frac);
    }
  }

  if (nodesEnabled && nodes) {
    for (const node of nodes) {
      const { x, y } = worldToMini(node.x, node.z, mapSize, mini);
      drawCaptureNode(ctx, x, y, node.owner);
    }
  }

  for (const s of structures) {
    if (s.dead || s.faction !== "player") continue;
    if (fogEnabled && visibleAt && !visibleAt(s.x, s.z)) continue;
    const { x, y } = worldToMini(s.x, s.z, mapSize, mini);
    const col =
      s.buildingType === "turret"
        ? "#88b8e0"
        : s.buildingType === "warFactory"
          ? "#d8b868"
          : "#78b088";
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
  }

  for (const b of bases) {
    if (!b) continue;
    if (b.faction === "enemy" && fogEnabled && visibleAt && !visibleAt(b.x, b.z)) {
      continue;
    }
    const { x, y } = worldToMini(b.x, b.z, mapSize, mini);
    const br = Math.max(4, (b.footprint / mapSize) * mini);
    drawBaseIcon(ctx, x, y, br, b.faction, b.dead);
  }

  for (const u of units) {
    if (u.dead) continue;
    if (u.faction === "enemy" && fogEnabled && visibleAt && !visibleAt(u.pos.x, u.pos.z)) {
      continue;
    }
    const { x, y } = worldToMini(u.pos.x, u.pos.z, mapSize, mini);
    drawUnitBlip(ctx, x, y, u);
  }

  drawCameraViewport(ctx, {
    mini,
    mapSize,
    target,
    camera,
  });

  drawVignette(ctx, mini);
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {number} o.mapSize
 * @param {(x:number,z:number)=>number} o.getHeight
 * @param {(x:number,z:number)=>number} o.getSlope
 * @param {(wx:number,wz:number)=>void} o.onJump
 */
export function createRtsMinimap({ canvas, mapSize, getHeight, getSlope, onJump }) {
  let terrainCanvas = bakeMinimapTerrain({ mapSize, getHeight, getSlope });
  const mini = canvas.width;
  const ctx = canvas.getContext("2d");
  let dragging = false;

  function rebuildTerrain() {
    terrainCanvas = bakeMinimapTerrain({ mapSize, getHeight, getSlope });
  }

  function jumpFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * mini;
    const py = ((ev.clientY - rect.top) / rect.height) * mini;
    const wx = (px / mini - 0.5) * mapSize;
    const wz = (py / mini - 0.5) * mapSize;
    onJump(wx, wz);
  }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    jumpFromEvent(e);
    e.preventDefault();
  });
  window.addEventListener("pointermove", (e) => {
    if (dragging) jumpFromEvent(e);
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });

  function draw(state) {
    drawRtsMinimap(ctx, {
      mini,
      mapSize,
      terrainCanvas,
      ...state,
    });
  }

  return { draw, rebuildTerrain };
}
