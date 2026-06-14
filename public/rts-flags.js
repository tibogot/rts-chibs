/**
 * RTS base flags — cloth sim from v2 flagFactory, one per team HQ.
 */
import { createFlagProp, FLAG_DEFAULTS } from "./flagFactory.js";

export const RTS_FLAG_DEFAULTS = {
  clothWidth: 5.25,
  clothHeight: 3.45,
  poleHeight: 10.5,
  poleRadius: 0.096,
  xSegs: 10,
  ySegs: 8,
  windIntensity: 520,
  windSpeed: 950,
  showPole: true,
};

function hexColor(n) {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

/** Wind blows from map center toward each HQ so both flags billow outward. */
function windDirectionForFaction(faction) {
  return faction === "player" ? 90 : 270;
}

export function createRtsBaseFlag(faction, palette, flagCfg = {}) {
  const colors = palette?.[faction] ?? palette?.player;
  const flagColor = hexColor(colors?.accent ?? 0xcc0000);
  const textureUrl =
    flagCfg?.textureUrl ??
    flagCfg?.[faction]?.textureUrl ??
    palette?.[faction]?.flagTextureUrl ??
    "";
  return createFlagProp({
    ...FLAG_DEFAULTS,
    ...RTS_FLAG_DEFAULTS,
    flagColor,
    textureUrl,
    windDirection: windDirectionForFaction(faction),
  });
}

/** Remove and dispose flags before base meshes are torn down. */
export function disposeRtsBaseFlags(baseDefs) {
  for (const faction of ["player", "enemy"]) {
    const b = baseDefs?.[faction];
    const flag = b?.flag;
    if (!flag) continue;
    flag.group.parent?.remove(flag.group);
    flag.dispose();
    b.flag = null;
  }
}

/** Parent a wind flag on each live HQ pad (base-local coords). */
export function attachRtsBaseFlags(baseDefs, palette, flagCfg = {}) {
  for (const faction of ["player", "enemy"]) {
    const b = baseDefs?.[faction];
    if (!b?.group || b.dead) continue;
    if (b.flag) {
      b.flag.group.parent?.remove(b.flag.group);
      b.flag.dispose();
    }
    const flag = createRtsBaseFlag(faction, palette, {
      textureUrl: flagCfg?.[faction]?.textureUrl ?? "",
    });
    flag.group.position.set(5.6, 0, 2.85);
    b.group.add(flag.group);
    b.flag = flag;
  }
}

/** Live-update cloth textures without rebuilding bases. */
export function syncRtsBaseFlagTextures(baseDefs, flagCfg = {}) {
  for (const faction of ["player", "enemy"]) {
    const b = baseDefs?.[faction];
    if (!b?.flag || b.dead) continue;
    b.flag.setParam("textureUrl", flagCfg?.[faction]?.textureUrl ?? "");
  }
}

let _flagAccum = 0;

/** Cloth sim is CPU-heavy — 30 Hz is enough for HQ flags. */
export function updateRtsBaseFlags(baseDefs, dt) {
  _flagAccum += dt;
  if (_flagAccum < 1 / 30) return;
  const step = _flagAccum;
  _flagAccum = 0;
  for (const faction of ["player", "enemy"]) {
    const b = baseDefs?.[faction];
    if (!b?.flag || b.dead) continue;
    b.flag.update(step);
  }
}
