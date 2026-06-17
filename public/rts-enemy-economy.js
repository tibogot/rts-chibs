/**
 * Enemy structure placement + structure-gated production + base expansion.
 */

export const BARRACKS_UNIT_TYPES = ["scout", "flamer"];
export const FACTORY_UNIT_TYPES = [
  "harvester",
  "tank",
  "artillery",
  "rocketLauncher",
];
export const HELIPAD_UNIT_TYPES = ["helicopter"];

const PRODUCTION_TYPES = ["barracks", "warFactory", "helipad"];

const EXPANSION_LIMITS = {
  easy: { turret: 1, sandbags: 1, barracks: 0, warFactory: 0, helipad: 0 },
  normal: { turret: 2, sandbags: 2, barracks: 1, warFactory: 0, helipad: 0 },
  hard: { turret: 3, sandbags: 2, barracks: 1, warFactory: 1, helipad: 0 },
};

const EXPANSION_OFFSETS = {
  turret: [
    { dx: -58, dz: 18 },
    { dx: 58, dz: 18 },
    { dx: -72, dz: 42 },
    { dx: 72, dz: 42 },
    { dx: -38, dz: 62 },
    { dx: 38, dz: 62 },
  ],
  sandbags: [
    { dx: -24, dz: 32 },
    { dx: 24, dz: 32 },
    { dx: -48, dz: 52 },
    { dx: 48, dz: 52 },
  ],
  barracks: [
    { dx: -68, dz: 52 },
    { dx: -48, dz: 72 },
  ],
  warFactory: [
    { dx: 68, dz: 52 },
    { dx: 48, dz: 72 },
  ],
  helipad: [{ dx: 0, dz: 92 }],
};

export function structureTypeForUnit(type) {
  if (BARRACKS_UNIT_TYPES.includes(type)) return "barracks";
  if (FACTORY_UNIT_TYPES.includes(type)) return "warFactory";
  if (HELIPAD_UNIT_TYPES.includes(type)) return "helipad";
  return null;
}

export function countFactionStructures(structures, faction, buildingType) {
  return structures.filter(
    (s) => !s.dead && s.faction === faction && s.buildingType === buildingType,
  ).length;
}

export function findFactionStructure(structures, faction, buildingType) {
  return structures.find(
    (s) =>
      !s.dead && s.faction === faction && s.buildingType === buildingType,
  );
}

export function findBestProductionStructure(structures, faction, buildingType) {
  const candidates = structures.filter(
    (s) => !s.dead && s.faction === faction && s.buildingType === buildingType,
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, s) =>
    !best || s.queue.length < best.queue.length ? s : best,
  );
}

export function factionHasStructure(structures, faction, buildingType) {
  return countFactionStructures(structures, faction, buildingType) > 0;
}

export function enemyRequiredProductionTypes(difficulty = "normal") {
  const types = ["barracks", "warFactory"];
  // Helipad required whenever the enemy roster includes air units (normal+).
  if (difficulty === "hard" || difficulty === "normal") types.push("helipad");
  return types;
}

export function enemyMissingProductionTypes(structures, difficulty = "normal") {
  return enemyRequiredProductionTypes(difficulty).filter(
    (t) => !factionHasStructure(structures, "enemy", t),
  );
}

/** Slots in front of the enemy HQ (toward map center). */
export function getEnemyBaseStructureSlots(base) {
  const toward = base.z > 0 ? -1 : 1;
  const side = 42;
  const forward = 58;
  return {
    barracks: { x: base.x - side, z: base.z + toward * forward },
    warFactory: { x: base.x + side, z: base.z + toward * forward },
    helipad: { x: base.x, z: base.z + toward * (forward + 22) },
  };
}

const SLOT_FALLBACKS = {
  barracks: [
    { dx: -32, dz: 48 },
    { dx: -52, dz: 38 },
    { dx: -22, dz: 62 },
  ],
  warFactory: [
    { dx: 32, dz: 48 },
    { dx: 52, dz: 38 },
    { dx: 22, dz: 62 },
  ],
  helipad: [
    { dx: 0, dz: 72 },
    { dx: 28, dz: 68 },
    { dx: -28, dz: 68 },
  ],
};

function towardCenterSign(base) {
  return base.z > 0 ? -1 : 1;
}

/** Candidate build sites for one structure type (primary, fallbacks, expansion ring). */
export function getEnemyStructureCandidates(base, buildingType, existingCount = 0) {
  const toward = towardCenterSign(base);
  const slots = getEnemyBaseStructureSlots(base);
  const candidates = [];

  if (existingCount === 0 && slots[buildingType]) {
    candidates.push(slots[buildingType]);
  }

  for (const o of SLOT_FALLBACKS[buildingType] ?? []) {
    candidates.push({
      x: base.x + o.dx,
      z: base.z + toward * o.dz,
    });
  }

  const offsets = EXPANSION_OFFSETS[buildingType] ?? [];
  const expandFrom = Math.max(0, existingCount - 1);
  for (let i = expandFrom; i < offsets.length; i++) {
    const o = offsets[i];
    candidates.push({
      x: base.x + o.dx,
      z: base.z + toward * o.dz,
    });
  }

  return candidates;
}

/**
 * Try to place one enemy structure near HQ.
 * @returns {object|null} created structure
 */
export function tryPlaceEnemyStructure({
  base,
  buildingType,
  structures,
  createStructure,
  canPlaceBuilding,
  scoreBuildSite = null,
}) {
  if (!base || base.dead) return null;
  const existing = countFactionStructures(structures, "enemy", buildingType);
  const candidates = getEnemyStructureCandidates(base, buildingType, existing);
  const ranked = candidates
    .map((pos) => ({
      pos,
      score: scoreBuildSite?.(pos.x, pos.z, buildingType) ?? 0,
    }))
    .sort((a, b) => a.score - b.score);
  for (const { pos } of ranked) {
    if (!canPlaceBuilding(pos.x, pos.z, buildingType)) continue;
    return createStructure("enemy", buildingType, pos.x, pos.z);
  }
  return null;
}

export function createEnemyExpansionState() {
  return { expandTimer: 0 };
}

function expansionLimits(difficulty) {
  return EXPANSION_LIMITS[difficulty] ?? EXPANSION_LIMITS.normal;
}

function requiredCountForType(buildingType, difficulty) {
  const limits = expansionLimits(difficulty);
  if (PRODUCTION_TYPES.includes(buildingType)) {
    return 1 + (limits[buildingType] ?? 0);
  }
  return limits[buildingType] ?? 0;
}

/**
 * Pick the next structure the enemy should build (rebuilds first, then expansion).
 * @returns {{ buildingType: string, rebuild: boolean }|null}
 */
export function pickEnemyStructureBuild(structures, difficulty = "normal") {
  const missing = enemyMissingProductionTypes(structures, difficulty);
  if (missing.length) {
    return { buildingType: missing[0], rebuild: true };
  }

  const limits = expansionLimits(difficulty);
  const priority = ["turret", "sandbags", "warFactory", "barracks", "helipad"];
  for (const buildingType of priority) {
    const have = countFactionStructures(structures, "enemy", buildingType);
    const want = requiredCountForType(buildingType, difficulty);
    if (have < want) return { buildingType, rebuild: false };
  }
  return null;
}

/**
 * Spawn enemy barracks + war factory (and helipad on hard) near HQ.
 * @returns {object[]} created structures
 */
export function spawnEnemyStartingStructures({
  base,
  createStructure,
  canPlaceBuilding,
  scoreBuildSite = null,
  difficulty = "normal",
}) {
  if (!base || base.dead) return [];
  const types = enemyRequiredProductionTypes(difficulty);
  const created = [];
  for (const buildingType of types) {
    const s = tryPlaceEnemyStructure({
      base,
      buildingType,
      structures: created,
      createStructure,
      canPlaceBuilding,
      scoreBuildSite,
    });
    if (s) created.push(s);
  }
  return created;
}

/**
 * Periodic enemy base expansion / rebuild tick.
 * @returns {object|null} structure created this tick
 */
export function updateEnemyBaseExpansion({
  base,
  structures,
  buildingTypes,
  difficulty = "normal",
  supply,
  expandSupplyBuffer = 30,
  createStructure,
  canPlaceBuilding,
  scoreBuildSite = null,
}) {
  if (!base || base.dead) return null;

  const pick = pickEnemyStructureBuild(structures, difficulty);
  if (!pick) return null;

  const def = buildingTypes[pick.buildingType];
  const cost = def?.cost ?? 0;
  const buffer = pick.rebuild ? 0 : expandSupplyBuffer;
  if (supply < cost + buffer) return null;

  const created = tryPlaceEnemyStructure({
    base,
    buildingType: pick.buildingType,
    structures,
    createStructure,
    canPlaceBuilding,
    scoreBuildSite,
  });
  if (!created) return null;

  return { structure: created, cost, rebuild: pick.rebuild };
}

/**
 * Queue a unit on an owned production structure (enemy AI).
 * @returns {boolean} whether the order was queued
 */
export function queueEnemyStructureProduction({
  structures,
  buildingTypes,
  type,
  maxQueue,
  canAfford,
  payCost,
}) {
  const structType = structureTypeForUnit(type);
  if (!structType) return false;
  const s = findBestProductionStructure(structures, "enemy", structType);
  if (!s) return false;
  if (s.queue.length >= maxQueue) return false;
  if (!canAfford(type)) return false;
  payCost(type);
  const prodTime = buildingTypes[structType]?.prodTime ?? 8;
  s.queue.push({ type, timeLeft: prodTime });
  return true;
}

/**
 * Filter unit pick when the required production building is missing.
 */
export function enemyPickRequiresStructure(structures, type) {
  const needed = structureTypeForUnit(type);
  if (!needed) return true;
  return factionHasStructure(structures, "enemy", needed);
}
