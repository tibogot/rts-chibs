/**
 * Enemy harvester targeting, economy gates, and ore escorts.
 */

export function enemyHarvesterTargetCount(diff = {}) {
  return diff.enemyMaxHarvesters ?? 2;
}

export function shouldEnemyBuildHarvester({
  diff = {},
  ore = 0,
  hvCount = 0,
  hasFactory = false,
  oreEnabled = true,
}) {
  if (!oreEnabled || !hasFactory) return false;
  const maxHv = enemyHarvesterTargetCount(diff);
  if (hvCount >= maxHv) return false;
  const reserve = diff.enemyOreReserve ?? 90;
  if (hvCount === 0) return ore < reserve * 1.35;
  if (ore < reserve) return true;
  if (hvCount < maxHv && ore < reserve * 1.5) return true;
  return false;
}

/**
 * Pick a safe, productive ore node for an enemy harvester.
 */
export function pickEnemyOreDeposit({
  deposits,
  home,
  harvesters = [],
  playerUnits = [],
  excludeId = null,
}) {
  const assigned = new Set();
  for (const h of harvesters) {
    if (h.harvestTarget?.id) assigned.add(h.harvestTarget.id);
  }

  let best = null;
  let bestScore = -Infinity;
  for (const d of deposits) {
    if (!d || d.amount <= 0) continue;
    if (d.id === excludeId) continue;
    if (assigned.has(d.id)) continue;

    let score = (d.amount / Math.max(1, d.maxAmount)) * 48;

    if (home) {
      const distHome = Math.hypot(d.x - home.x, d.z - home.z);
      score -= distHome * 0.035;
      if (home.z < 0 && d.z > 40) score -= 22;
      if (home.z > 0 && d.z < -40) score -= 22;
    }

    for (const pu of playerUnits) {
      const dist = Math.hypot(d.x - pu.pos.x, d.z - pu.pos.z);
      if (dist < 130) score -= (130 - dist) * 0.42;
    }

    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function harvesterThreatLevel(harvester, playerUnits, radius = 96) {
  const r2 = radius * radius;
  let n = 0;
  for (const p of playerUnits) {
    if (p.dead) continue;
    const dx = p.pos.x - harvester.pos.x;
    const dz = p.pos.z - harvester.pos.z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

const ESCORT_TYPES = ["scout", "flamer", "tank"];

/**
 * Assign scouts/light units to guard enemy harvesters.
 */
export function planEnemyHarvestEscorts({
  pool,
  playerUnits,
  diff = {},
}) {
  const harvesters = pool.filter((u) => u.type === "harvester");
  if (!harvesters.length) return;

  const baseEscorts = diff.harvesterEscorts ?? 1;
  const escorts = pool.filter(
    (u) =>
      !u.aiOrder &&
      ESCORT_TYPES.includes(u.type) &&
      u.type !== "harvester",
  );

  for (const hv of harvesters) {
    const threat = harvesterThreatLevel(hv, playerUnits);
    const want = Math.min(
      3,
      baseEscorts + (threat > 0 ? 1 : 0) + (threat > 2 ? 1 : 0),
    );
    let got = 0;

    const nearby = [...escorts].sort((a, b) => {
      const da = Math.hypot(a.pos.x - hv.pos.x, a.pos.z - hv.pos.z);
      const db = Math.hypot(b.pos.x - hv.pos.x, b.pos.z - hv.pos.z);
      return da - db;
    });

    for (const escort of nearby) {
      if (got >= want) break;
      if (escort.aiOrder) continue;
      escort.aiEscort = hv;
      escort.aiOrder = {
        type: "escort",
        x: hv.pos.x,
        z: hv.pos.z,
      };
      got++;
    }
  }
}

/** Guard ring position around a moving escort target. */
export function escortGuardPoint(escort, target, radius = 20) {
  const dx = escort.pos.x - target.pos.x;
  const dz = escort.pos.z - target.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d;
  const nz = dz / d;
  return {
    x: target.pos.x + nx * radius * 0.65,
    z: target.pos.z + nz * radius * 0.65,
  };
}
