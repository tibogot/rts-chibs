/**
 * RTS unit GLB instancing — one InstancedMesh per submesh per (type, faction).
 * Scout/flamer primitives stay as individual clones in rts-lab.
 */
import * as THREE from "three";
import {
  createRtsUnitGlbMesh,
  isRtsUnitGlbReady,
  RTS_UNIT_GLB_TYPES,
} from "./rts-units.js";

const INITIAL_CAPACITY = 192;
/** Invisible pick hull scale — easier clicks than tight mesh bounds. */
const PICK_HITBOX_PAD = 1.48;
const FACTIONS = ["player", "enemy"];
const _hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
const _yAxis = new THREE.Vector3(0, 1, 0);
const _invRoot = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _final = new THREE.Matrix4();
const _spin = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

function isRotorNode(name) {
  const n = (name || "").toLowerCase();
  return n === "mainrotor" || n === "tailrotor";
}

function extractSubmeshes(root) {
  root.updateMatrixWorld(true);
  _invRoot.copy(root.matrixWorld).invert();
  const out = [];
  const rotors = { main: [], tail: [] };
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.updateMatrixWorld(true);
    _local.copy(child.matrixWorld).premultiply(_invRoot);
    const entry = {
      geometry: child.geometry,
      material: child.material,
      localMatrix: _local.clone(),
      name: child.name,
    };
    if (child.name === "MainRotor") rotors.main.push(entry);
    else if (child.name === "TailRotor") rotors.tail.push(entry);
    else out.push(entry);
  });
  return { body: out, rotors };
}

function makeInstancedSlot(def, cap, castShadow, parent) {
  const im = new THREE.InstancedMesh(def.geometry, def.material, cap);
  im.count = 0;
  im.name = `rts-unit-${def.name || "mesh"}`;
  im.frustumCulled = false;
  im.castShadow = castShadow;
  im.receiveShadow = true;
  parent.add(im);
  return { im, localMatrix: def.localMatrix, name: def.name };
}

export class RtsUnitInstancer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "RtsUnitInstances";
    scene.add(this.group);

    /** @type {Map<string, object>} */
    this.pools = new Map();
    this.pickMeshes = [];
    this.enabled = true;
    this.castShadow = false;
    this._palette = null;

    this.stats = { pools: 0, drawCalls: 0, instances: 0 };
  }

  static canInstance(type) {
    return isRtsUnitGlbReady(type);
  }

  async init({ palette, castShadow = false } = {}) {
    this._palette = palette;
    this.setCastShadow(castShadow);
    this._buildPools();
  }

  _poolKey(type, faction) {
    return `${type}:${faction}`;
  }

  _buildPools() {
    this.clear();
    for (const type of RTS_UNIT_GLB_TYPES) {
      if (!isRtsUnitGlbReady(type)) continue;
      for (const faction of FACTIONS) {
        const root = createRtsUnitGlbMesh(faction, type, this._palette);
        if (!root) continue;
        const { body, rotors } = extractSubmeshes(root);
        if (!body.length) continue;

        root.updateMatrixWorld(true);
        _box.setFromObject(root);
        _box.getSize(_size);
        _box.getCenter(_center);
        const hitboxGeo = new THREE.BoxGeometry(
          _size.x * PICK_HITBOX_PAD,
          _size.y * PICK_HITBOX_PAD,
          _size.z * PICK_HITBOX_PAD,
        );
        const boxCenterMatrix = new THREE.Matrix4().makeTranslation(
          _center.x,
          _center.y,
          _center.z,
        );

        const key = this._poolKey(type, faction);
        const pool = {
          type,
          faction,
          units: [],
          capacity: INITIAL_CAPACITY,
          bodySlots: body.map((def) =>
            makeInstancedSlot(def, INITIAL_CAPACITY, this.castShadow, this.group),
          ),
          mainRotor: rotors.main.map((def) =>
            makeInstancedSlot(def, INITIAL_CAPACITY, false, this.group),
          ),
          tailRotor: rotors.tail.map((def) =>
            makeInstancedSlot(def, INITIAL_CAPACITY, false, this.group),
          ),
          hitbox: new THREE.InstancedMesh(hitboxGeo, _hitboxMat, INITIAL_CAPACITY),
          hitboxGeo,
          boxCenterMatrix,
          pickUnits: [],
        };
        pool.hitbox.count = 0;
        pool.hitbox.frustumCulled = false;
        pool.hitbox.userData.unitPool = pool;
        this.group.add(pool.hitbox);
        this.pickMeshes.push(pool.hitbox);

        this.pools.set(key, pool);
      }
    }
    this.stats.pools = this.pools.size;
  }

  setCastShadow(on) {
    this.castShadow = !!on;
    for (const pool of this.pools.values()) {
      for (const slot of pool.bodySlots) slot.im.castShadow = this.castShadow;
    }
  }

  attach(unit) {
    if (!this.enabled || !RtsUnitInstancer.canInstance(unit.type)) return false;
    const key = this._poolKey(unit.type, unit.faction);
    const pool = this.pools.get(key);
    if (!pool) return false;
    if (pool.units.includes(unit)) return true;
    pool.units.push(unit);
    unit.instanced = true;
    unit._poolKey = key;
    return true;
  }

  detach(unit) {
    if (!unit.instanced || !unit._poolKey) return;
    const pool = this.pools.get(unit._poolKey);
    if (!pool) return;
    const idx = pool.units.indexOf(unit);
    if (idx >= 0) {
      const last = pool.units.pop();
      if (last !== unit) pool.units[idx] = last;
    }
    unit.instanced = false;
    unit._poolKey = null;
    unit._renderQuat = null;
    unit._mainRotorAngle = 0;
    unit._tailRotorAngle = 0;
  }

  clear() {
    for (const pool of this.pools.values()) {
      pool.units.length = 0;
      for (const slot of pool.bodySlots) slot.im.count = 0;
      for (const slot of pool.mainRotor) slot.im.count = 0;
      for (const slot of pool.tailRotor) slot.im.count = 0;
      pool.hitbox.count = 0;
      pool.pickUnits.length = 0;
    }
  }

  dispose() {
    for (const pool of this.pools.values()) {
      for (const slot of pool.bodySlots) {
        this.group.remove(slot.im);
        slot.im.dispose();
      }
      for (const slot of pool.mainRotor) {
        this.group.remove(slot.im);
        slot.im.dispose();
      }
      for (const slot of pool.tailRotor) {
        this.group.remove(slot.im);
        slot.im.dispose();
      }
      this.group.remove(pool.hitbox);
      pool.hitbox.dispose();
      pool.hitboxGeo.dispose();
    }
    this.pools.clear();
    this.pickMeshes.length = 0;
    this.scene.remove(this.group);
  }

  /**
   * @param {object[]} units
   * @param {{ dt?: number, rotorSpeed?: number }} opts
   */
  sync(units, opts = {}) {
    if (!this.enabled) return;
    const dt = opts.dt ?? 0;
    const rotorSpeed = opts.rotorSpeed ?? 28;
    let draws = 0;
    let instances = 0;

    for (const pool of this.pools.values()) {
      pool.pickUnits.length = 0;
      let write = 0;

      for (const u of pool.units) {
        if (u.dead) continue;
        if (u.fogVisible === false) continue;

        _pos.copy(u.pos);
        if (u._renderQuat) _quat.copy(u._renderQuat);
        else {
          _quat.setFromAxisAngle(_yAxis, u.heading ?? 0);
        }
        _body.compose(_pos, _quat, _scl);

        for (const slot of pool.bodySlots) {
          _final.multiplyMatrices(_body, slot.localMatrix);
          slot.im.setMatrixAt(write, _final);
        }

        for (const slot of pool.mainRotor) {
          u._mainRotorAngle = (u._mainRotorAngle ?? 0) + dt * rotorSpeed;
          _spin.makeRotationY(u._mainRotorAngle);
          _final.multiplyMatrices(_body, slot.localMatrix).multiply(_spin);
          slot.im.setMatrixAt(write, _final);
        }
        for (const slot of pool.tailRotor) {
          u._tailRotorAngle = (u._tailRotorAngle ?? 0) + dt * rotorSpeed * 2.4;
          _spin.makeRotationX(u._tailRotorAngle);
          _final.multiplyMatrices(_body, slot.localMatrix).multiply(_spin);
          slot.im.setMatrixAt(write, _final);
        }

        _final.multiplyMatrices(_body, pool.boxCenterMatrix);
        pool.hitbox.setMatrixAt(write, _final);
        pool.pickUnits[write] = u;
        write++;
      }

      for (const slot of pool.bodySlots) {
        slot.im.count = write;
        if (write > 0) {
          slot.im.instanceMatrix.needsUpdate = true;
          draws++;
        }
      }
      for (const slot of pool.mainRotor) {
        slot.im.count = write;
        if (write > 0) {
          slot.im.instanceMatrix.needsUpdate = true;
          draws++;
        }
      }
      for (const slot of pool.tailRotor) {
        slot.im.count = write;
        if (write > 0) {
          slot.im.instanceMatrix.needsUpdate = true;
          draws++;
        }
      }
      pool.hitbox.count = write;
      if (write > 0) pool.hitbox.instanceMatrix.needsUpdate = true;
      instances += write;
    }

    this.stats.drawCalls = draws;
    this.stats.instances = instances;
  }

  /** Resolve a raycast hit on a pool hitbox to the unit. */
  resolvePick(hit) {
    const pool = hit.object?.userData?.unitPool;
    if (!pool || hit.instanceId == null) return null;
    return pool.pickUnits[hit.instanceId] ?? null;
  }

  /** Build wreck debris from the instanced template (no per-unit clone). */
  buildWreckMeshes(unit, wreckGroup, wreckMat) {
    const pool = this.pools.get(this._poolKey(unit.type, unit.faction));
    if (!pool) return false;
    const q = unit._renderQuat ?? _quat.setFromAxisAngle(_yAxis, unit.heading ?? 0);
    _body.compose(unit.pos, q, _scl);
    for (const slot of pool.bodySlots) {
      _final.multiplyMatrices(_body, slot.localMatrix);
      const m = new THREE.Mesh(slot.im.geometry, wreckMat);
      m.applyMatrix4(_final);
      m.castShadow = true;
      wreckGroup.add(m);
    }
    return true;
  }

  getPool(type, faction) {
    return this.pools.get(this._poolKey(type, faction));
  }
}

export function getRtsUnitInstancerTypes() {
  return RTS_UNIT_GLB_TYPES.filter((t) => isRtsUnitGlbReady(t));
}
