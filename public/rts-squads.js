/**
 * Infantry squads — shared HP pool, man count, suppression/pin, base reinforcement.
 */

export const RTS_SQUAD_DEFAULTS = {
  enabled: true,
  reinforceRadius: 18,
  reinforceInterval: 1.2,
  reinforceCostPerMan: 5,
  suppressionDecay: 0.38,
  suppressionPerHit: 0.14,
  pinThreshold: 0.62,
  pinSpeedMul: 0.32,
  pinFireRateMul: 0.38,
};

const SQUAD_TYPES = new Set(["scout", "flamer"]);

export function isSquadType(type) {
  return SQUAD_TYPES.has(type);
}

/** Apply squad fields after base unit stats are set. */
export function initSquadUnit(u, typeDef, opts = {}) {
  if (!typeDef?.squad) return false;
  const size = typeDef.squadSize ?? 5;
  const perMan = typeDef.perManHp ?? Math.round(typeDef.hp / size);
  const armorMul = opts.armorMul ?? 1;
  u.squad = true;
  u.squadSize = size;
  u.perManHp = Math.round(perMan * armorMul);
  u.maxHp = u.perManHp * size;
  u.hp = u.maxHp;
  u.men = size;
  u.suppression = 0;
  u.pinned = false;
  return true;
}

export function syncSquadMenFromHp(u) {
  if (!u.squad) return;
  u.men = Math.max(1, Math.min(u.squadSize, Math.ceil(u.hp / u.perManHp)));
}

export function applySquadSuppression(u, amount, cfg = RTS_SQUAD_DEFAULTS) {
  if (!u.squad || u.dead) return;
  u.suppression = Math.min(1, (u.suppression ?? 0) + amount);
  u.pinned = u.suppression >= cfg.pinThreshold;
}

export function tickSquadSuppression(u, dt, cfg = RTS_SQUAD_DEFAULTS) {
  if (!u.squad || u.dead) return;
  if (u.suppression > 0) {
    u.suppression = Math.max(0, u.suppression - cfg.suppressionDecay * dt);
  }
  u.pinned = u.suppression >= cfg.pinThreshold;
}

export function squadSpeedMul(u, cfg = RTS_SQUAD_DEFAULTS) {
  if (!u.squad || !u.pinned) return 1;
  return cfg.pinSpeedMul;
}

export function squadFireRateMul(u, cfg = RTS_SQUAD_DEFAULTS) {
  if (!u.squad || !u.pinned) return 1;
  return cfg.pinFireRateMul;
}

/**
 * Reinforce missing squad members at friendly base / barracks.
 * @param {object} ctx — { bases, structures, getBuildingDef, requisition, canAfford, payCost }
 */
export function tickSquadReinforcement(u, dt, cfg, ctx) {
  if (!u.squad || u.dead || u.men >= u.squadSize) return;

  let near = false;
  for (const b of ctx.bases ?? []) {
    if (b.dead || b.faction !== u.faction) continue;
    const dx = u.pos.x - b.x;
    const dz = u.pos.z - b.z;
    if (dx * dx + dz * dz <= cfg.reinforceRadius ** 2) {
      near = true;
      break;
    }
  }
  if (!near) {
    for (const s of ctx.structures ?? []) {
      if (s.dead || s.faction !== u.faction) continue;
      const B = ctx.getBuildingDef?.(s.buildingType);
      if (s.buildingType !== "barracks" && !(B?.healRadius > 0)) continue;
      const rad = B?.healRadius ?? cfg.reinforceRadius;
      const dx = u.pos.x - s.x;
      const dz = u.pos.z - s.z;
      if (dx * dx + dz * dz <= rad * rad) {
        near = true;
        break;
      }
    }
  }
  if (!near) return;

  u._reinforceAcc = (u._reinforceAcc ?? 0) + dt;
  while (u._reinforceAcc >= cfg.reinforceInterval && u.men < u.squadSize) {
    u._reinforceAcc -= cfg.reinforceInterval;
    if (u.faction === "player") {
      const cost = cfg.reinforceCostPerMan;
      if (!ctx.canAfford?.("player", { supply: cost })) break;
      ctx.payCost?.("player", { supply: cost });
    }
    u.men++;
    u.hp = Math.min(u.maxHp, u.hp + u.perManHp);
  }
}
