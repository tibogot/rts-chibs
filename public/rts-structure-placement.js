/**
 * Structure footprint validation + flatten pad helpers.
 */

export function structureFlattenRadius(buildingTypes, buildingType) {
  const B = buildingTypes?.[buildingType];
  if (B?.flattenRadius != null) return B.flattenRadius;
  const fp = B?.footprint ?? 6;
  if (buildingType === "sandbags") return fp * 0.75;
  if (buildingType === "turret") return fp * 0.9;
  return fp * 0.85;
}

/**
 * Sample heights/slopes under a circular footprint.
 * @returns {{ ok: boolean, padHeight: number, drop: number, maxSlope: number, flatness: number }}
 */
export function evaluateStructureFootprint({
  terrainHeight,
  terrainSlope,
  x,
  z,
  buildingTypes,
  buildingType,
  maxSlope = 0.38,
  maxDrop = 2.8,
  canStandAt = null,
}) {
  const B = buildingTypes?.[buildingType];
  const footprint = B?.footprint ?? 6;
  const sampleR = structureFlattenRadius(buildingTypes, buildingType);
  const heights = [];
  const slopes = [];
  const blocked = [];

  const sample = (px, pz, navCheck = true) => {
    heights.push(terrainHeight(px, pz));
    slopes.push(terrainSlope(px, pz));
    if (navCheck && canStandAt && !canStandAt(px, pz)) blocked.push(true);
  };

  sample(x, z);
  const ringCount = 12;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    sample(x + Math.cos(a) * sampleR, z + Math.sin(a) * sampleR);
  }
  const innerR = footprint * 0.48;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    sample(x + Math.cos(a) * innerR, z + Math.sin(a) * innerR);
  }

  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const drop = maxH - minH;
  const maxS = Math.max(...slopes);
  const padHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
  const navOk = !blocked.length;
  const ok = navOk && maxS <= maxSlope && drop <= maxDrop;
  const flatness = drop * 4 + maxS * 10 + (navOk ? 0 : 50);

  return { ok, padHeight, drop, maxSlope: maxS, flatness, sampleR };
}

export function isStructureFootprintBuildable(ctx) {
  const ev = evaluateStructureFootprint(ctx);
  return ev.ok;
}

/** Lower = flatter build site (for enemy candidate sorting). */
export function structureBuildSiteScore(ctx) {
  const ev = evaluateStructureFootprint(ctx);
  if (!ev.ok) return 1e6 + ev.flatness;
  return ev.flatness;
}
