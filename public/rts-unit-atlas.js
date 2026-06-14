/**
 * Unit portrait atlas — models/rts/units.png (6×3 grid, 18 portraits).
 * Rows 0–1: US / player team. Row 2: PAVN–VC / enemy team.
 *
 * Row 0: Rifleman, Grenadier, Automatic Rifleman, Machine Gunner, Sniper, Scout
 * Row 1: Medic, Radio Operator, Light AT, Bazooka, Flamethrower, Helicopter Crew
 * Row 2: PAVN Rifleman, PAVN MG, PAVN RPG, VC Rifleman, VC Sapper, VC Sniper
 */

export const UNIT_ATLAS = {
  path: "models/rts/units.png",
  cols: 6,
  rows: 3,
};

/** Infantry squad types only (capsule meshes) — vehicles use 3D baked thumbs. */
export const UNIT_ATLAS_INFANTRY_TYPES = ["scout", "flamer"];

/** @type {Record<string, { col: number, row: number }>} */
export const UNIT_ATLAS_PLAYER = {
  scout: { col: 5, row: 0 }, // Scout
  flamer: { col: 4, row: 1 }, // Flamethrower
};

/** @type {Record<string, { col: number, row: number }>} */
export const UNIT_ATLAS_ENEMY = {
  scout: { col: 5, row: 2 }, // Viet Cong Sniper
  flamer: { col: 4, row: 2 }, // Viet Cong Sapper
};

export function thumbKeyUnitAtlas(faction, type) {
  return `unit:${faction}:${type}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`unit atlas failed to load: ${src}`));
    img.src = src;
  });
}

function sliceCellToDataURL(img, col, row, cellW, cellH, outSize) {
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  const sx = col * cellW;
  const sy = row * cellH;
  const side = Math.min(cellW, cellH);
  const cx = sx + (cellW - side) * 0.5;
  const cy = sy + (cellH - side) * 0.5;
  ctx.drawImage(img, cx, cy, side, side, 0, 0, outSize, outSize);
  return canvas.toDataURL("image/png");
}

/**
 * Slice faction-specific unit portraits from the atlas.
 * @param {string[]} types — unit type keys (e.g. scout, tank)
 * @param {number} [outSize=192]
 * @returns {Promise<Map<string, string>>} keys like unit:player:scout
 */
export async function loadUnitAtlasThumbnails(
  types,
  { outSize = 192, path = UNIT_ATLAS.path } = {},
) {
  const map = new Map();
  if (!types?.length) return map;

  let img;
  try {
    img = await loadImage(path);
  } catch (err) {
    console.warn("[rts] unit atlas load failed:", err);
    return map;
  }

  const cellW = img.naturalWidth / UNIT_ATLAS.cols;
  const cellH = img.naturalHeight / UNIT_ATLAS.rows;
  const factions = [
    ["player", UNIT_ATLAS_PLAYER],
    ["enemy", UNIT_ATLAS_ENEMY],
  ];

  for (const type of types) {
    for (const [faction, atlas] of factions) {
      const cell = atlas[type];
      if (!cell) continue;
      map.set(
        thumbKeyUnitAtlas(faction, type),
        sliceCellToDataURL(img, cell.col, cell.row, cellW, cellH, outSize),
      );
    }
  }

  return map;
}
