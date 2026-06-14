/**
 * RTS cover — craters, structures, sandbags reduce incoming damage by tier.
 * Green = light, yellow = medium, red = heavy (CoH-style positioning).
 */

export const COVER_TIERS = {
  none: { id: 0, mul: 1, color: 0xffffff, label: "Open" },
  green: { id: 1, mul: 0.72, color: 0x3dcc66, label: "Light" },
  yellow: { id: 2, mul: 0.52, color: 0xddbb22, label: "Medium" },
  red: { id: 3, mul: 0.32, color: 0xdd4422, label: "Heavy" },
};

const TIER_BY_NAME = {
  green: 1,
  yellow: 2,
  red: 3,
  light: 1,
  medium: 2,
  heavy: 3,
};

function distSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Does the segment shooter→unit pass within radius of cover center? */
function lineBlocksShot(sx, sz, ux, uz, cx, cz, blockR) {
  const dx = ux - sx;
  const dz = uz - sz;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return false;
  const t = Math.max(0, Math.min(1, ((cx - sx) * dx + (cz - sz) * dz) / len2));
  const px = sx + t * dx;
  const pz = sz + t * dz;
  return distSq(cx, cz, px, pz) <= blockR * blockR;
}

/**
 * @param {object} opts
 * @param {Array} opts.craters — { x, z, radius }
 * @param {Array} opts.structures — { x, z, r, coverTier? }
 * @param {Array} [opts.bases] — HQ footprints
 * @param {Array} [opts.props] — static map props { x, z, r, coverTier? }
 */
export function buildCoverSources({
  craters = [],
  structures = [],
  bases = [],
  props = [],
} = {}) {
  const out = [];

  for (const c of craters) {
    const r = c.radius ?? 5;
    out.push({
      x: c.x,
      z: c.z,
      r,
      tier: 3,
      inHole: true,
      proximity: r * 1.12,
      blockR: r * 0.88,
    });
  }

  for (const s of structures) {
    const tierName = s.coverTier ?? "yellow";
    const tier = TIER_BY_NAME[tierName] ?? 2;
    const r = s.r ?? 6;
    out.push({
      x: s.x,
      z: s.z,
      r,
      tier,
      proximity: r + (tier === 1 ? 2.5 : 3.5),
      blockR: r * (tier === 1 ? 0.85 : 0.95),
    });
  }

  for (const b of bases) {
    const r = b.r ?? 10;
    out.push({
      x: b.x,
      z: b.z,
      r,
      tier: 3,
      proximity: r + 4,
      blockR: r * 1.05,
    });
  }

  for (const p of props) {
    const tierName = p.coverTier ?? "green";
    const tier = TIER_BY_NAME[tierName] ?? 1;
    const r = p.r ?? 3;
    out.push({
      x: p.x,
      z: p.z,
      r,
      tier,
      proximity: r + (tier >= 3 ? 3.5 : tier === 2 ? 3 : 2.2),
      blockR: r * (tier >= 3 ? 0.95 : 0.88),
    });
  }

  return out;
}

/**
 * Best cover tier when shot at from (sx,sz) while standing at (ux,uz).
 * @returns {{ tier: number, mul: number, color: number, label: string }}
 */
export function evaluateCover(ux, uz, sx, sz, sources, tierMul = COVER_TIERS) {
  let best = 0;
  for (const src of sources) {
    const prox = src.proximity ?? src.r * 1.2;
    const near = distSq(ux, uz, src.x, src.z) <= prox * prox;
    if (!near) continue;

    if (src.inHole && distSq(ux, uz, src.x, src.z) <= (src.r * 0.78) ** 2) {
      best = Math.max(best, 3);
      continue;
    }

    const blockR = src.blockR ?? src.r;
    if (lineBlocksShot(sx, sz, ux, uz, src.x, src.z, blockR)) {
      best = Math.max(best, src.tier ?? 1);
    }
  }

  const names = ["none", "green", "yellow", "red"];
  const key = names[best] ?? "none";
  const t = tierMul[key] ?? tierMul.none;
  return { tier: best, mul: t.mul, color: t.color, label: t.label };
}

export function applyCoverToDamage(damage, cover) {
  if (!cover || cover.tier <= 0) return damage;
  return damage * cover.mul;
}
