/**
 * Unit armor classes + damage multipliers (rock-paper-scissors).
 *
 * Armor classes:
 *   infantry — scout / flamer squads
 *   vehicle  — soft-skinned (rocket launcher, harvester)
 *   heavy    — tanks
 *   siege    — artillery (high burst, fragile hull)
 *   air      — helicopters
 *   building — HQ + placed structures
 *   support  — bulldozer / unarmed
 */

export const ARMOR_CLASS = {
  INFANTRY: "infantry",
  VEHICLE: "vehicle",
  HEAVY: "heavy",
  SIEGE: "siege",
  AIR: "air",
  BUILDING: "building",
  SUPPORT: "support",
};

/** Unit type → default armor class (flying units use air at runtime). */
export const UNIT_ARMOR_CLASS = {
  scout: ARMOR_CLASS.INFANTRY,
  flamer: ARMOR_CLASS.INFANTRY,
  tank: ARMOR_CLASS.HEAVY,
  artillery: ARMOR_CLASS.SIEGE,
  rocketLauncher: ARMOR_CLASS.VEHICLE,
  helicopter: ARMOR_CLASS.VEHICLE,
  harvester: ARMOR_CLASS.SUPPORT,
  bulldozer: ARMOR_CLASS.SUPPORT,
};

const AIR_ROW = {
  infantry: 0.55,
  vehicle: 0.65,
  heavy: 0.42,
  siege: 0.5,
  air: 0.35,
  building: 0.45,
  support: 0.6,
};

/**
 * Shooter → target damage multiplier.
 * Values > 1 = strong vs that class; < 1 = resisted.
 */
export const MATCHUP_MUL = {
  scout: {
    infantry: 1.0,
    vehicle: 0.55,
    heavy: 0.28,
    siege: 0.85,
    air: 1.35,
    building: 0.35,
    support: 0.7,
  },
  tank: {
    infantry: 1.85,
    vehicle: 1.15,
    heavy: 1.0,
    siege: 1.75,
    air: 0.42,
    building: 0.65,
    support: 1.25,
  },
  artillery: {
    infantry: 0.75,
    vehicle: 1.05,
    heavy: 1.8,
    siege: 0.9,
    air: 0,
    building: 1.4,
    support: 1.1,
  },
  rocketLauncher: {
    infantry: 1.65,
    vehicle: 1.1,
    heavy: 0.9,
    siege: 1.45,
    air: 1.85,
    building: 2.05,
    support: 1.0,
  },
  flamer: {
    infantry: 1.2,
    vehicle: 0.48,
    heavy: 0.32,
    siege: 0.65,
    air: 0,
    building: 2.35,
    support: 0.85,
  },
  helicopter: {
    infantry: 1.5,
    vehicle: 1.05,
    heavy: 0.78,
    siege: 1.6,
    air: 0,
    building: 1.35,
    support: 1.0,
  },
  turret: {
    infantry: 1.4,
    vehicle: 1.0,
    heavy: 0.72,
    siege: 0.88,
    air: 1.65,
    building: 0.45,
    support: 1.05,
  },
  aaTurret: {
    ...AIR_ROW,
    air: 2.15,
    vehicle: 0.55,
    heavy: 0.38,
  },
};

export function armorClassForUnitType(type) {
  return UNIT_ARMOR_CLASS[type] ?? ARMOR_CLASS.VEHICLE;
}

/** Resolve armor class from a combat target (unit, structure, or HQ). */
export function armorClassForTarget(target) {
  if (!target) return ARMOR_CLASS.VEHICLE;
  if (target.kind === "base" || target.kind === "structure") {
    return ARMOR_CLASS.BUILDING;
  }
  if (isAirUnit(target)) return ARMOR_CLASS.AIR;
  return armorClassForUnitType(target.type);
}

export function matchupMultiplier(shooterType, target) {
  if (!shooterType) return 1;
  const row = MATCHUP_MUL[shooterType];
  if (!row) return 1;
  const armor = armorClassForTarget(target);
  return row[armor] ?? 1;
}

export function scaleMatchupDamage(baseDamage, shooterType, target) {
  return baseDamage * matchupMultiplier(shooterType, target);
}

/** Shooter types that cannot engage flying units. */
export const NO_ANTI_AIR = new Set(["artillery", "flamer", "helicopter"]);

/** @deprecated alias */
export const GROUND_ONLY_SHOOTERS = NO_ANTI_AIR;

export function isAirUnit(target) {
  return !!(target?.flying || target?.type === "helicopter");
}

export function canShooterTarget(shooterType, target) {
  if (!target || target.dead) return false;
  if (target.kind === "base" || target.kind === "structure") return true;
  if (!isAirUnit(target)) return true;
  return !NO_ANTI_AIR.has(shooterType);
}

export function isAntiAirShooter(shooterType) {
  if (!shooterType || NO_ANTI_AIR.has(shooterType)) return false;
  const row = MATCHUP_MUL[shooterType];
  return (row?.air ?? 0) >= 1.25;
}

/**
 * Short human-readable counter summary for UI / debug.
 * @returns {string[]}
 */
export function describeMatchups(shooterType) {
  const row = MATCHUP_MUL[shooterType];
  if (!row) return [];
  const strong = [];
  const weak = [];
  for (const [cls, mul] of Object.entries(row)) {
    if (mul >= 1.45) strong.push(cls);
    else if (mul > 0 && mul <= 0.55) weak.push(cls);
  }
  const out = [];
  if (NO_ANTI_AIR.has(shooterType)) out.push("No anti-air");
  else if ((row.air ?? 0) >= 1.75) out.unshift("Anti-air");
  else if ((row.air ?? 0) >= 1.25) out.push("Light anti-air");
  if (strong.length) out.push(`Strong vs ${strong.join(", ")}`);
  if (weak.length) out.push(`Weak vs ${weak.join(", ")}`);
  return out;
}
