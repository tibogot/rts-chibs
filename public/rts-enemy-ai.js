/**
 * Enemy rally-at-base + coordinated assault waves.
 */

export function isEnemyAssaultUnit(u) {
  return (
    u.type !== "scout" &&
    u.type !== "harvester" &&
    u.type !== "bulldozer"
  );
}

export function clearEnemyAssaultWaves(brain) {
  brain.assault = { waves: [], nextId: 1 };
}

/** Formation slots in front of the enemy HQ (toward map center). */
export function getEnemyRallySlots(home, count, diff = {}) {
  if (!home || count <= 0) return [];
  const toward = home.z > 0 ? -1 : 1;
  const depth = diff.rallyDepth ?? 32;
  const spacing = diff.rallySpacing ?? 7;
  const baseX = home.x;
  const baseZ = home.z + toward * depth;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    slots.push({
      x: baseX + (col - (cols - 1) / 2) * spacing,
      z: baseZ + toward * row * spacing * 0.9,
    });
  }
  return slots;
}

function getAssaultPushSlots(target, home, count) {
  const toward = home?.z > 0 ? -1 : 1;
  const approachZ = target.z - toward * 38;
  const spacing = 8;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    slots.push({
      x: target.x + (col - (cols - 1) / 2) * spacing,
      z: approachZ + toward * row * spacing * 0.85,
    });
  }
  return slots;
}

/** Close siege line — within weapon range of the player HQ (mirrors player attack-base). */
function getAssaultSiegeSlots(target, home, count, diff = {}) {
  const toward = home?.z > 0 ? -1 : 1;
  const approach = diff.siegeApproachDist ?? 12;
  const approachZ = target.z - toward * approach;
  const spacing = diff.siegeSpacing ?? 7;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    slots.push({
      x: target.x + (col - (cols - 1) / 2) * spacing,
      z: approachZ + toward * row * spacing * 0.85,
    });
  }
  return slots;
}

function waveMembers(units, squadId) {
  return units.filter((u) => !u.dead && u.aiOrder?.squadId === squadId);
}

function assignSquadOrders(members, waveId, phase, rallySlots, pushSlots, siegeSlots) {
  members.forEach((u, i) => {
    const rally = rallySlots[i] ?? rallySlots[0];
    const push = pushSlots[i] ?? pushSlots[0];
    const siege = siegeSlots[i] ?? siegeSlots[0];
    let orderType = "rally";
    let x = rally.x;
    let z = rally.z;
    if (phase === "siege") {
      orderType = "siege";
      x = siege.x;
      z = siege.z;
    } else if (phase === "push") {
      orderType = "push";
      x = push.x;
      z = push.z;
    } else if (phase === "wait") {
      orderType = "wait";
    }
    u.aiOrder = {
      type: orderType,
      squadId: waveId,
      x,
      z,
      pushX: push.x,
      pushZ: push.z,
      siegeX: siege.x,
      siegeZ: siege.z,
    };
  });
}

function refreshWaveFormation(wave, members, home, target, diff) {
  const rallySlots = getEnemyRallySlots(home, members.length, diff);
  const pushSlots = getAssaultPushSlots(target, home, members.length);
  const siegeSlots = getAssaultSiegeSlots(target, home, members.length, diff);
  assignSquadOrders(
    members,
    wave.id,
    wave.phase,
    rallySlots,
    pushSlots,
    siegeSlots,
  );
}

/**
 * Add new assault waves or extend an existing rally wave with fresh units.
 */
export function planOrExtendAssaultWaves({
  brain,
  units,
  home,
  target,
  diff = {},
  allUnits = [],
}) {
  if (!units.length || !home || !target) return;
  if (!brain.assault) brain.assault = { waves: [], nextId: 1 };

  const waveSize = diff.assaultWaveSize ?? 6;
  const maxWaves = diff.assaultWaveCount ?? 2;
  let pending = [...units];

  const openRally = brain.assault.waves.find((w) => w.phase === "rally");
  if (openRally && openRally.memberCount < waveSize && pending.length) {
    const room = waveSize - openRally.memberCount;
    const add = pending.splice(0, room);
    const members = [...waveMembers(allUnits, openRally.id), ...add];
    openRally.memberCount = members.length;
    refreshWaveFormation(openRally, members, home, target, diff);
  }

  while (
    pending.length &&
    brain.assault.waves.filter((w) => w.phase !== "done").length < maxWaves
  ) {
    const chunk = pending.splice(0, waveSize);
    const id = brain.assault.nextId++;
    const activeCount = brain.assault.waves.filter(
      (w) => w.phase !== "done",
    ).length;
    const phase = activeCount === 0 ? "rally" : "wait";
    brain.assault.waves.push({
      id,
      phase,
      rallyTimer: 0,
      launchedAt: 0,
      memberCount: chunk.length,
    });
    refreshWaveFormation(
      brain.assault.waves[brain.assault.waves.length - 1],
      chunk,
      home,
      target,
      diff,
    );
  }

  if (pending.length) {
    const last = [...brain.assault.waves]
      .reverse()
      .find((w) => w.phase !== "done");
    if (last) {
      const members = [...waveMembers(allUnits, last.id), ...pending];
      last.memberCount = members.length;
      refreshWaveFormation(last, members, home, target, diff);
    }
  }
}

export function assignEnemyRallyOrders({ units, home, diff = {} }) {
  if (!units.length || !home) return;
  const slots = getEnemyRallySlots(home, units.length, diff);
  units.forEach((u, i) => {
    const s = slots[i] ?? slots[0];
    u.aiOrder = { type: "rally", x: s.x, z: s.z };
  });
}

/**
 * Advance assault wave phases (rally → push → siege, staggered waves).
 */
export function tickEnemyAssaultWaves({ brain, dt, diff = {}, units }) {
  const assault = brain.assault;
  if (!assault?.waves?.length) return;

  const rallyReadyFrac = diff.rallyReadyFrac ?? 0.55;
  const rallyMaxSec = diff.rallyMaxSec ?? 9;
  const waveGap = diff.assaultWaveGap ?? 12;
  const rallyDist = diff.rallyArriveDist ?? 14;
  const rallyDistSq = rallyDist * rallyDist;
  const pushReadyFrac = diff.pushReadyFrac ?? 0.45;
  const pushMaxSec = diff.pushMaxSec ?? 22;
  const pushDist = diff.pushArriveDist ?? 24;
  const pushDistSq = pushDist * pushDist;
  const now = performance.now() / 1000;

  for (let wi = 0; wi < assault.waves.length; wi++) {
    const wave = assault.waves[wi];
    const members = waveMembers(units, wave.id);
    wave.memberCount = members.length;
    if (!members.length) {
      wave.phase = "done";
      continue;
    }

    if (wave.phase === "wait") {
      const prev = assault.waves[wi - 1];
      const prevLaunched =
        prev &&
        (prev.phase === "push" ||
          prev.phase === "siege" ||
          prev.phase === "done") &&
        now - (prev.launchedAt || 0) >= waveGap;
      if (!prev || prevLaunched) {
        wave.phase = "rally";
        wave.rallyTimer = 0;
        for (const u of members) {
          if (u.aiOrder) u.aiOrder.type = "rally";
        }
      }
      continue;
    }

    if (wave.phase === "rally") {
      wave.rallyTimer = (wave.rallyTimer ?? 0) + dt;
      const atRally = members.filter((u) => {
        const o = u.aiOrder;
        if (!o) return false;
        const dx = u.pos.x - o.x;
        const dz = u.pos.z - o.z;
        return dx * dx + dz * dz <= rallyDistSq;
      }).length;
      const ready =
        atRally >= Math.max(1, Math.ceil(members.length * rallyReadyFrac)) ||
        wave.rallyTimer >= rallyMaxSec;
      if (ready) {
        wave.phase = "push";
        wave.launchedAt = now;
        wave.pushTimer = 0;
        for (const u of members) {
          const o = u.aiOrder;
          if (!o) continue;
          o.type = "push";
          o.x = o.pushX ?? o.x;
          o.z = o.pushZ ?? o.z;
        }
      }
      continue;
    }

    if (wave.phase === "push") {
      wave.pushTimer = (wave.pushTimer ?? 0) + dt;
      const atPush = members.filter((u) => {
        const o = u.aiOrder;
        if (!o) return false;
        const px = o.pushX ?? o.x;
        const pz = o.pushZ ?? o.z;
        const dx = u.pos.x - px;
        const dz = u.pos.z - pz;
        return dx * dx + dz * dz <= pushDistSq;
      }).length;
      const ready =
        atPush >= Math.max(1, Math.ceil(members.length * pushReadyFrac)) ||
        wave.pushTimer >= pushMaxSec;
      if (ready) {
        wave.phase = "siege";
        for (const u of members) {
          const o = u.aiOrder;
          if (!o) continue;
          o.type = "siege";
          o.x = o.siegeX ?? o.x;
          o.z = o.siegeZ ?? o.z;
        }
      }
    }
  }
}

/** True when an order is part of an active assault wave and should survive replans. */
export function shouldPreserveEnemyOrder(order) {
  if (!order?.squadId) return false;
  return (
    order.type === "rally" ||
    order.type === "push" ||
    order.type === "siege" ||
    order.type === "wait"
  );
}
