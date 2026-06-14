/**
 * RTS WORLD-INTERFACE CONTRACT
 * ============================
 * The contract between the RTS controller (gameplay) and whatever hosts it —
 * the `rts-lab.html` sandbox today, the v2 game-engine later. Derived by tracing
 * what the lab's camera / picking / selection / orders / combat code actually
 * needs from "the world". When the engine implements an object of this shape,
 * the portable controller pieces (camera ✓, future selection/orders/combat) run
 * unchanged on real engine terrain.
 *
 * This file is documentation + a tiny pass-through factory; it holds no logic
 * that could destabilize the lab.
 *
 * @typedef {object} RtsWorldInterface
 *
 * @property {(x:number, z:number) => number} terrainHeight
 *   Ground height (world Y) at world XZ. Used by camera terrain-follow and by
 *   raycastGround's iterative march. Engine: sample the chunked heightfield.
 *
 * @property {(screenX:number, screenY:number) => ({x:number, z:number}|null)} raycastGround
 *   Screen pixel → world ground point, marched against terrainHeight so it is
 *   correct over non-flat terrain (NOT a y=0 plane intersect). Returns null when
 *   the ray is parallel/!below the horizon. Result is clamped to ground bounds.
 *   This is the lab's `pickGround`. Used by orders (move target), build
 *   placement, and click/box selection. THE core query.
 *
 * @property {() => number} groundSize
 *   World extent of the playable map (square, centered at origin). Used to clamp
 *   raycastGround results so orders never go off-map. Engine: terrain world size.
 *
 * @property {(x:number, z:number) => boolean} [visibleToPlayer]
 *   Fog-of-war visibility test at world XZ. Optional (no fog ⇒ always true).
 *   Used by enemy picking / targeting so you can't click what you can't see.
 *
 * UNIT SHAPE the controller assumes (the host supplies the unit list; each unit
 * is expected to expose at least):
 *   - pos:      { x, y, z }   world position
 *   - faction:  string        e.g. "player" | "enemy"
 *   - dead:     boolean       excluded from selection/targeting
 *   - selected: boolean       controller toggles this (box/click select)
 *
 * Already-clean DATA modules the engine reuses as-is alongside this interface:
 *   rts-units.js, rts-squads.js, rts-pathfind.js, rts-fog-of-war.js,
 *   rts-unit-instancer.js, rts-unit-atlas.js — plus rtsCameraControl.js.
 */

/**
 * Bundle a concrete world implementation into the interface object the
 * controller modules consume. The lab passes its real functions; the engine
 * will pass its own equivalents.
 * @param {RtsWorldInterface} impl
 * @returns {RtsWorldInterface}
 */
export function createRtsWorldInterface({
  terrainHeight,
  raycastGround,
  groundSize,
  visibleToPlayer = () => true,
}) {
  return { terrainHeight, raycastGround, groundSize, visibleToPlayer };
}
