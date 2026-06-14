/**
 * Selective bloom (MRT emissive) helpers for RTS UI + combat punctuation.
 * Only materials built here opt into the post bloom pass.
 */
import * as THREE from "three/webgpu";
import {
  mrt,
  output,
  float,
  mul,
  materialColor,
  materialOpacity,
  materialEmissive,
} from "three/tsl";

/** HDR multipliers for the emissive MRT buffer (not display brightness). */
export const RTS_BLOOM_SCALE = {
  ui: 0.62, // HQ pad ring, capture progress ring
  beacon: 1.2, // HQ landmark cylinder
  muzzle: 2.6, // brief muzzle flash
  tracer: 1.9, // hitscan streak
  impact: 2.4, // micro hit spark (scout/tank)
  impactRing: 1.05, // impact shock ring
  rocket: 2.1, // in-flight rocket body + exhaust
  rocketTrail: 1.55, // rocket smoke streak
};

/**
 * Transparent or opaque basic material with selective bloom.
 * `material.color` / `material.opacity` remain live-tunable from JS.
 */
export function makeBloomBasicMaterial(opts = {}, bloomScale = RTS_BLOOM_SCALE.ui) {
  const {
    color = 0xffffff,
    opacity = 1,
    transparent = opacity < 1 || !!opts.transparent,
    depthWrite = false,
    depthTest = true,
    side = THREE.DoubleSide,
    polygonOffset = false,
    polygonOffsetFactor = 0,
    polygonOffsetUnits = 0,
  } = opts;

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent,
    opacity,
    depthWrite,
    depthTest,
    side,
    polygonOffset,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
  mat.color.set(color);
  mat.opacity = opacity;

  const bloom = mul(materialColor.rgb, float(bloomScale));
  const emissive = transparent ? mul(bloom, materialOpacity) : bloom;
  mat.mrtNode = mrt({ output, emissive });

  return mat;
}

/**
 * Line material with selective bloom (tracers, rocket trails).
 */
export function makeBloomLineMaterial(opts = {}, bloomScale = RTS_BLOOM_SCALE.tracer) {
  const {
    color = 0xffffff,
    opacity = 1,
    transparent = opacity < 1 || !!opts.transparent,
    depthWrite = false,
    depthTest = true,
  } = opts;

  const mat = new THREE.LineBasicNodeMaterial({
    transparent,
    opacity,
    depthWrite,
    depthTest,
  });
  mat.color.set(color);
  mat.opacity = opacity;

  const bloom = mul(materialColor.rgb, float(bloomScale));
  const emissive = transparent ? mul(bloom, materialOpacity) : bloom;
  mat.mrtNode = mrt({ output, emissive });

  return mat;
}

/**
 * Standard PBR material with emissive + selective bloom on the emissive term.
 */
export function makeBloomStandardMaterial(
  opts = {},
  bloomScale = RTS_BLOOM_SCALE.beacon,
) {
  const {
    color = 0xffffff,
    emissive = color,
    emissiveIntensity = 1,
    roughness = 0.5,
    metalness = 0,
  } = opts;

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness,
    metalness,
  });
  mat.color.set(color);
  mat.emissive.set(emissive);
  mat.emissiveIntensity = emissiveIntensity;

  const emissiveBloom = mul(
    materialEmissive,
    float(emissiveIntensity * bloomScale),
  );
  mat.mrtNode = mrt({ output, emissive: emissiveBloom });

  return mat;
}
