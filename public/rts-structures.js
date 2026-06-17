/**
 * Structure placement, lifecycle, footprints, and production spawn helpers.
 */
import {
  buildingDef,
  buildStructureMesh,
  structureGroundY,
  snapBarracksToGround,
} from "./rts-structure-meshes.js";

export function createRtsStructureSystem(deps) {
  const {
    scene,
    getBuildingTypes,
    getTerrainHeight,
    getFactionColors,
    makeHealthBar,
    applyStructureFlattenAt,
    unregisterStructureFlatten,
    syncTerrainFlatten,
    scheduleTerrainShapeRebuild,
    rebuildCoverSources,
    onStructureNavAdded,
    onStructureNavRemoved,
    disposeProceduralMeshTree,
    onStructureKilled,
  } = deps;

  const list = [];
  const footprints = [];
  const pickBodies = [];
  const group = deps.structuresGroup;
  group.name = "Structures";
  if (!group.parent) scene.add(group);

  let idSeq = 1;

  function def(type) {
    return buildingDef(getBuildingTypes(), type);
  }

  function syncGround(s) {
    const y = structureGroundY(
      getTerrainHeight(),
      getBuildingTypes(),
      s.x,
      s.z,
      s.buildingType,
    );
    s.group.position.set(s.x, y, s.z);
    if (s.buildingType === "barracks") {
      snapBarracksToGround(s.group, getTerrainHeight(), s.x, s.z);
    }
    s.pos.y = s.group.position.y;
  }

  function registerPickables() {
    pickBodies.length = 0;
    for (const s of list) {
      if (s.dead || !s.group) continue;
      s.group.traverse((o) => {
        if (o.isMesh) {
          o.userData.structure = s;
          pickBodies.push(o);
        }
      });
    }
  }

  function syncFootprints() {
    footprints.length = 0;
    for (const s of list) {
      if (s.dead) continue;
      const B = def(s.buildingType);
      footprints.push({
        x: s.x,
        z: s.z,
        r: B?.footprint ?? 6,
        coverTier: B?.coverTier ?? "yellow",
      });
    }
    rebuildCoverSources?.();
  }

  function create(faction, buildingType, x, z) {
    const B = def(buildingType);
    if (B?.flattenRadius !== 0) {
      applyStructureFlattenAt?.(x, z, buildingType);
    }
    const { group: meshGroup, turretHead } = buildStructureMesh(
      faction,
      buildingType,
      getFactionColors(faction),
    );
    group.add(meshGroup);
    const s = {
      id: idSeq++,
      kind: "structure",
      buildingType,
      faction,
      x,
      z,
      pos: { x, y: 0, z },
      group: meshGroup,
      bar: makeHealthBar(faction, 3.6),
      hp: B.hp,
      maxHp: B.hp,
      dead: false,
      queue: [],
      spawnSlot: 0,
      turretHead,
      turretCooldown: 0,
    };
    syncGround(s);
    list.push(s);
    syncFootprints();
    onStructureNavAdded?.(s);
    registerPickables();
    return s;
  }

  function kill(s) {
    if (!s || s.dead) return;
    if (def(s.buildingType)?.flattenRadius !== 0) {
      unregisterStructureFlatten?.(s.x, s.z);
      syncTerrainFlatten?.();
    }
    s.dead = true;
    s.hp = 0;
    group.remove(s.group);
    disposeProceduralMeshTree(s.group);
    if (s.bar) {
      deps.removeHealthBar?.(s.bar);
      s.bar = null;
    }
    onStructureKilled?.(s);
    syncFootprints();
    onStructureNavRemoved?.(s);
    registerPickables();
  }

  function clear() {
    const live = list.filter((s) => !s.dead);
    let hadFlattenPads = false;
    for (const s of list) {
      if (def(s.buildingType)?.flattenRadius !== 0) {
        unregisterStructureFlatten?.(s.x, s.z);
        hadFlattenPads = true;
      }
      if (!s.dead) {
        group.remove(s.group);
        if (s.bar) deps.removeHealthBar?.(s.bar);
      }
    }
    for (const s of live) onStructureNavRemoved?.(s);
    list.length = 0;
    footprints.length = 0;
    pickBodies.length = 0;
    syncFootprints();
    if (hadFlattenPads) scheduleTerrainShapeRebuild?.(false);
  }

  function refreshMeshes() {
    for (const s of list) {
      if (s.dead || !s.group) continue;
      const y = s.group.position.y;
      const rotY = s.group.rotation.y;
      group.remove(s.group);
      disposeProceduralMeshTree(s.group);
      const { group: meshGroup, turretHead } = buildStructureMesh(
        s.faction,
        s.buildingType,
        getFactionColors(s.faction),
      );
      meshGroup.position.set(s.x, y, s.z);
      meshGroup.rotation.y = rotY;
      group.add(meshGroup);
      s.group = meshGroup;
      s.turretHead = turretHead;
    }
    registerPickables();
  }

  function spawnPos(s) {
    const slot = s.spawnSlot % 5;
    s.spawnSlot++;
    const lateral = (slot - 2) * 5.5;
    const toward = s.z > 0 ? -1 : 1;
    return {
      x: s.x + lateral,
      z: s.z + toward * (def(s.buildingType).footprint + 4),
    };
  }

  function findFaction(faction, buildingType) {
    return list.find(
      (s) => !s.dead && s.faction === faction && s.buildingType === buildingType,
    );
  }

  function hasFaction(faction, buildingType) {
    return !!findFaction(faction, buildingType);
  }

  function canPlace(x, z, buildingType, ctx) {
    const B = def(buildingType);
    if (!B) return false;
    const half = ctx.mapHalf - B.footprint - 4;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (!ctx.canStandAt(x, z)) return false;
    const minGap = ctx.minSpacing + B.footprint;
    for (const s of list) {
      if (s.dead) continue;
      const dx = x - s.x;
      const dz = z - s.z;
      const otherR = (def(s.buildingType)?.footprint ?? 6) + B.footprint;
      if (dx * dx + dz * dz < otherR * otherR) return false;
    }
    for (const b of ctx.baseFootprints) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < (b.r + B.footprint + 4) ** 2) return false;
    }
    for (const o of ctx.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + B.footprint + 2) ** 2) return false;
    }
    if (ctx.treesNear) {
      const tr = ctx.treeBlockRadius ?? 1.5;
      for (const t of ctx.treesNear(x, z, B.footprint + tr + 2)) {
        const dx = x - t.x;
        const dz = z - t.z;
        if (dx * dx + dz * dz < (t.r + B.footprint + 1) ** 2) return false;
      }
    }
    for (const d of ctx.oreDeposits) {
      if (d.amount <= 0) continue;
      const dx = x - d.x;
      const dz = z - d.z;
      if (dx * dx + dz * dz < (ctx.oreRadius + B.footprint + 2) ** 2) {
        return false;
      }
    }
    const c = ctx.worldToCell(x, z);
    if (!ctx.inBounds(c.c, c.r) || ctx.isBlockedCell(c.c, c.r)) return false;
    if (ctx.footprintBuildable) {
      if (!ctx.footprintBuildable(x, z, buildingType)) return false;
    }
    return true;
  }

  return {
    list,
    footprints,
    pickBodies,
    group,
    def,
    create,
    kill,
    clear,
    syncGround,
    syncFootprints,
    registerPickables,
    refreshMeshes,
    spawnPos,
    findFaction,
    hasFaction,
    canPlace,
    groundY: (x, z, buildingType) =>
      structureGroundY(getTerrainHeight(), getBuildingTypes(), x, z, buildingType),
  };
}
