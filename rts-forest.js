/**
 * RTS pine forest — instanced pine2_compressed.glb with 2-tier mesh LOD.
 * Culling uses horizontal distance from the camera pan target and zoom-scaled radii.
 */
import * as THREE from "three";
import { initRtsGltfLoader, loadRtsGltfScene } from "./rts-gltf-loader.js";

const INITIAL_CAPACITY = 8192;
const CULL_MARGIN = 8;
const CULL_HEIGHT = 22;
const _yAxis = new THREE.Vector3(0, 1, 0);
const _sunXZ = new THREE.Vector2();

let _canopyShadowTex = null;
function getCanopyShadowTexture() {
  if (_canopyShadowTex) return _canopyShadowTex;
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.35, "rgba(0,0,0,0.72)");
  g.addColorStop(0.62, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _canopyShadowTex = new THREE.CanvasTexture(canvas);
  _canopyShadowTex.colorSpace = THREE.SRGBColorSpace;
  return _canopyShadowTex;
}

function makeForestRng(seed) {
  if (!seed) return () => Math.random();
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isExcluded(x, z, circles) {
  for (const c of circles) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  return false;
}

function fixFoliageMaterial(mat) {
  if (!mat) return;
  if (mat.alphaMap || mat.map) {
    mat.transparent = false;
    mat.alphaTest = mat.alphaTest > 0 ? mat.alphaTest : 0.38;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
  }
  mat.fog = true;
}

function prepareFoliageShadowMaterial(mat) {
  if (!mat) return;
  fixFoliageMaterial(mat);
  const alphaTest = mat.alphaTest ?? 0.38;
  if (!mat.userData._rtsFoliageDepthMat) {
    const dm = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      alphaTest,
      map: mat.map ?? null,
      alphaMap: mat.alphaMap ?? null,
    });
    dm.side = THREE.DoubleSide;
    mat.userData._rtsFoliageDepthMat = dm;
  } else {
    const dm = mat.userData._rtsFoliageDepthMat;
    dm.alphaTest = alphaTest;
    dm.map = mat.map ?? null;
    dm.alphaMap = mat.alphaMap ?? null;
  }
  mat.customDepthMaterial = mat.userData._rtsFoliageDepthMat;
}

function classifyPineSubmesh(mesh, mat) {
  const meshName = (mesh.name || "").toLowerCase();
  const matName = (mat?.name ?? "").toLowerCase();
  const label = `${meshName} ${matName}`;
  if (/trunk|bark|stem|wood/i.test(label)) return true;
  if (/leaf|leave|foliage|canopy|frond|branch|needle/i.test(label)) {
    return false;
  }
  const isTransparent = mat?.transparent === true;
  const hasMap = !!mat?.map;
  const isDoubleSide = mat?.side === THREE.DoubleSide;
  const hasAlphaTest = mat?.alphaTest != null && mat.alphaTest > 0;
  if (isTransparent || (hasMap && (isDoubleSide || hasAlphaTest))) return false;
  return true;
}

function extractSubmeshes(root) {
  const submeshes = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry.clone();
    const mat = child.material?.clone?.() ?? child.material;
    fixFoliageMaterial(mat);
    const isTrunk = classifyPineSubmesh(child, mat);
    if (!isTrunk) prepareFoliageShadowMaterial(mat);
    submeshes.push({
      geometry: geo,
      material: mat,
      localMatrix: child.matrixWorld.clone(),
      isTrunk,
    });
  });
  return submeshes;
}

function resolveLodTier(dist2, lod0D2, fadeD2) {
  if (dist2 > fadeD2) return -1;
  if (dist2 > lod0D2) return 1;
  return 0;
}

function resolveForestLodRadii(lodCfg, zoom, viewRadius, rtsMode) {
  if (!rtsMode) {
    const zf = THREE.MathUtils.clamp(zoom / 110, 0.35, 1.25);
    return {
      lod0D: (lodCfg.lod0Distance ?? 45) * zf,
      fadeD: (lodCfg.fadeOutDistance ?? lodCfg.lod1Distance ?? 220) * zf,
      skipFrustum: false,
    };
  }
  const vr = Math.max(viewRadius ?? zoom * 0.5, 48);
  const mul = lodCfg.rtsLodMul ?? 1.2;
  const lod0Base = (lodCfg.lod0Distance ?? 45) * mul;
  const fadeBase = lodCfg.fadeOutDistance ?? 300;
  return {
    lod0D: Math.max(lod0Base, vr * 1.2),
    fadeD: Math.max(fadeBase, vr * 2.75),
    skipFrustum: true,
  };
}

export class RtsPineForest {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "RtsPineForest";
    this.scene.add(this.group);

    this.cfg = null;
    this.enabled = true;
    this.trees = [];
    this.treeChunks = new Map();

    this.lod0 = [];
    this.lod1 = [];
    this.contactShadowMesh = null;
    this._sunDir = new THREE.Vector3(0.45, 0.82, 0.35).normalize();
    this._cap = INITIAL_CAPACITY;

    this.stats = {
      treeCount: 0,
      visibleTrees: 0,
      drawCalls: 0,
      lod0Trees: 0,
      lod1Trees: 0,
      contactShadows: 0,
    };

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._finalMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
  }

  async init(cfg) {
    this.cfg = cfg;
    initRtsGltfLoader(this.renderer);
    const [lod0Scene, lod1Scene] = await Promise.all([
      loadRtsGltfScene("models/pine2_compressed.glb"),
      loadRtsGltfScene("models/pine2LOD1_compressed.glb"),
    ]);
    const lod0Defs = extractSubmeshes(lod0Scene);
    const lod1Defs = extractSubmeshes(lod1Scene);

    this._disposeMeshSlots();
    this.lod0 = this._makeSlotMeshes(lod0Defs, "lod0");
    this.lod1 = this._makeSlotMeshes(lod1Defs, "lod1");
    this._makeContactShadowMesh();

    this._populateTrees();
    this.applyShadowFlags();
  }

  _makeContactShadowMesh() {
    if (this.contactShadowMesh) {
      this.group.remove(this.contactShadowMesh);
      this.contactShadowMesh.dispose();
      this.contactShadowMesh = null;
    }
    const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: getCanopyShadowTexture(),
      transparent: true,
      opacity: this.cfg?.shadow?.contactOpacity ?? 0.52,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    const im = new THREE.InstancedMesh(geo, mat, this._cap);
    im.count = 0;
    im.name = "rts-pine-contact-shadow";
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = false;
    im.renderOrder = 1;
    this.group.add(im);
    this.contactShadowMesh = im;
  }

  _makeSlotMeshes(defs, key) {
    return defs.map((sm) => {
      const im = new THREE.InstancedMesh(sm.geometry, sm.material, this._cap);
      im.count = 0;
      im.name = `rts-pine-${key}-${sm.isTrunk ? "trunk" : "leaf"}`;
      im.frustumCulled = false;
      this.group.add(im);
      return { ...sm, instancedMesh: im };
    });
  }

  _populateTrees() {
    const F = this.cfg.forest;
    const rng = makeForestRng(F.placementSeed ?? 0);
    const cs = F.chunkSize ?? 100;
    const half = Math.floor(F.halfExtent / F.spacing);
    this.trees = [];
    this.treeChunks.clear();

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const x = ix * F.spacing + (rng() - 0.5) * F.jitter * 2;
        const z = iz * F.spacing + (rng() - 0.5) * F.jitter * 2;
        if (isExcluded(x, z, F.excludeCircles)) continue;
        if (F.density < 1 && rng() > F.density) continue;
        const scale =
          F.scaleMin + rng() * Math.max(0.01, F.scaleMax - F.scaleMin);
        const rotY = rng() * Math.PI * 2;
        const y = F.getTreeY ? F.getTreeY(x, z) : 0;
        const tree = { x, y, z, scale, rotY };
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        const key = `${cx},${cz}`;
        if (!this.treeChunks.has(key)) {
          this.treeChunks.set(key, { cx, cz, trees: [] });
        }
        this.treeChunks.get(key).trees.push(tree);
        this.trees.push(tree);
      }
    }

    this.stats.treeCount = this.trees.length;
  }

  rebuildForest() {
    this._populateTrees();
    this.stats.treeCount = this.trees.length;
  }

  _treeBlockRadius() {
    return this.cfg?.forest?.treeBlockRadius ?? 1.5;
  }

  _blockNav() {
    return this.enabled && this.cfg?.forest?.blockNav !== false;
  }

  /** Nav-grid circles for every placed tree. */
  getNavBlockers() {
    if (!this._blockNav()) return [];
    const r = this._treeBlockRadius();
    return this.trees.map((t) => ({ x: t.x, z: t.z, r }));
  }

  /** Trees whose trunk footprint may overlap a world query (runtime push-out). */
  getTreesNear(x, z, searchR) {
    if (!this._blockNav()) return [];
    const blockR = this._treeBlockRadius();
    const cs = this.cfg?.forest?.chunkSize ?? 100;
    const out = [];
    const minCx = Math.floor((x - searchR) / cs);
    const maxCx = Math.floor((x + searchR) / cs);
    const minCz = Math.floor((z - searchR) / cs);
    const maxCz = Math.floor((z + searchR) / cs);
    const maxD2 = (searchR + blockR) * (searchR + blockR);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.treeChunks.get(`${cx},${cz}`);
        if (!chunk) continue;
        for (const t of chunk.trees) {
          const dx = t.x - x;
          const dz = t.z - z;
          if (dx * dx + dz * dz <= maxD2) {
            out.push({ x: t.x, z: t.z, r: blockR });
          }
        }
      }
    }
    return out;
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
  }

  applyShadowFlags() {
    const recv = this.cfg?.shadow?.lod0Receive !== false;
    const castTrunk =
      this.cfg?.shadow?.castTrunk !== false &&
      this.cfg?.shadow?.castTrunkShadow !== false;
    const castFoliage =
      this.cfg?.shadow?.castFoliage !== false &&
      this.cfg?.shadow?.castFoliageShadow !== false;
    for (const sm of this.lod0) {
      sm.instancedMesh.castShadow = sm.isTrunk ? castTrunk : castFoliage;
      sm.instancedMesh.receiveShadow = recv;
    }
    for (const sm of this.lod1) {
      sm.instancedMesh.castShadow = false;
      sm.instancedMesh.receiveShadow = false;
    }
    if (this.contactShadowMesh) {
      const on = this.cfg?.shadow?.contactShadow !== false;
      this.contactShadowMesh.visible = on;
      const op = this.cfg?.shadow?.contactOpacity;
      if (op != null && this.contactShadowMesh.material) {
        this.contactShadowMesh.material.opacity = op;
      }
    }
  }

  syncSunDirection(dir) {
    if (dir?.isVector3) this._sunDir.copy(dir).normalize();
  }

  updateTime() {}

  /**
   * @param {THREE.Camera} camera
   * @param {object} lodCfg
   * @param {{ targetX: number, targetZ: number, zoom: number }} rts
   */
  update(camera, lodCfg, rts = {}) {
    if (!this.enabled) return;

    const rtsMode = rts.rtsMode === true;
    const targetX = rts.targetX ?? camera.position.x;
    const targetZ = rts.targetZ ?? camera.position.z;
    const cullX = rts.viewX ?? targetX;
    const cullZ = rts.viewZ ?? targetZ;
    const zoom = Math.max(1, rts.zoom ?? 120);
    const { lod0D, fadeD, skipFrustum } = resolveForestLodRadii(
      lodCfg,
      zoom,
      rts.viewRadius,
      rtsMode,
    );
    const lod0D2 = lod0D * lod0D;
    const fadeD2 = fadeD * fadeD;

    for (const sm of this.lod0) sm.instancedMesh.count = 0;
    for (const sm of this.lod1) sm.instancedMesh.count = 0;
    if (this.contactShadowMesh) this.contactShadowMesh.count = 0;

    this._projScreen.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const cs = this.cfg.forest.chunkSize ?? 100;
    let visible = 0;
    let lod0Count = 0;
    let lod1Count = 0;
    let contactCount = 0;
    let draws = 0;
    const contactOn = this.cfg?.shadow?.contactShadow !== false;
    const contactLod1Only = this.cfg?.shadow?.contactLod1Only !== false;
    const contactRadius = this.cfg?.shadow?.contactRadius ?? 3.5;
    const contactLift = this.cfg?.shadow?.contactLift ?? 0.07;
    const contactStretch = this.cfg?.shadow?.contactStretch ?? 1.1;
    const contactMaxRake = this.cfg?.shadow?.contactMaxRake ?? 3.0;
    const contactWidth = this.cfg?.shadow?.contactWidth ?? 0.78;
    const contactAnchor = this.cfg?.shadow?.contactAnchor ?? 1.0;
    const castFoliageLod0 =
      this.cfg?.shadow?.castFoliage !== false &&
      this.cfg?.shadow?.castFoliageShadow !== false;

    // Directional baked shadow. The sun is static, so this is computed once per
    // update for the whole forest: the shadow falls AWAY from the sun, its
    // length grows as the sun lowers (cot of the elevation), and each decal is
    // pushed out so its near edge sits at the trunk.
    _sunXZ.set(this._sunDir.x, this._sunDir.z);
    const sunLen = _sunXZ.length();
    // Heading + unit vector for the direction the shadow points (away from sun).
    const shadowHdg = sunLen > 1e-4 ? Math.atan2(-_sunXZ.x, -_sunXZ.y) : 0;
    const shDirX = sunLen > 1e-4 ? -_sunXZ.x / sunLen : 0;
    const shDirZ = sunLen > 1e-4 ? -_sunXZ.y / sunLen : 1;
    // cot(elevation) = horizontal / vertical; clamp the vertical so a sun near
    // the horizon doesn't produce an infinitely long shadow.
    const sunUp = Math.max(this._sunDir.y, 0.22);
    const rake = Math.min(sunLen / sunUp, contactMaxRake);
    const lenStretch = 1 + rake * contactStretch;

    for (const chunk of this.treeChunks.values()) {
      if (chunk.trees.length === 0) continue;
      const minX = chunk.cx * cs;
      const minZ = chunk.cz * cs;
      this._box.min.set(minX - CULL_MARGIN, -5, minZ - CULL_MARGIN);
      this._box.max.set(
        minX + cs + CULL_MARGIN,
        CULL_HEIGHT,
        minZ + cs + CULL_MARGIN,
      );
      if (!skipFrustum && !this._frustum.intersectsBox(this._box)) continue;

      for (const t of chunk.trees) {
        const dx = t.x - cullX;
        const dz = t.z - cullZ;
        const dist2 = dx * dx + dz * dz;
        const tier = resolveLodTier(dist2, lod0D2, fadeD2);
        if (tier < 0) continue;

        visible++;
        this._pos.set(t.x, t.y, t.z);
        this._quat.setFromAxisAngle(_yAxis, t.rotY);
        this._scl.setScalar(t.scale);
        this._worldMat.compose(this._pos, this._quat, this._scl);

        if (tier === 0 && lod0Count < this._cap) {
          const idx = lod0Count++;
          for (const sm of this.lod0) {
            this._finalMat.multiplyMatrices(this._worldMat, sm.localMatrix);
            sm.instancedMesh.setMatrixAt(idx, this._finalMat);
          }
        } else if (tier === 1 && lod1Count < this._cap) {
          const idx = lod1Count++;
          for (const sm of this.lod1) {
            this._finalMat.multiplyMatrices(this._worldMat, sm.localMatrix);
            sm.instancedMesh.setMatrixAt(idx, this._finalMat);
          }
        }

        let showContact = contactOn && tier >= 0;
        if (!rtsMode && contactLod1Only) {
          showContact =
            tier === 1 || (tier === 0 && !castFoliageLod0);
        }
        if (showContact && this.contactShadowMesh && contactCount < this._cap) {
          const idx = contactCount++;
          const s = t.scale * contactRadius;
          const len = s * lenStretch; // along the shadow (local +Z)
          const wid = s * contactWidth; // perpendicular (local X)
          // Push the decal's centre out so its near edge stays at the trunk.
          const off = (len - s) * 0.5 * contactAnchor;
          this._pos.set(
            t.x + shDirX * off,
            t.y + contactLift,
            t.z + shDirZ * off,
          );
          this._quat.setFromAxisAngle(_yAxis, shadowHdg);
          this._scl.set(wid, 1, len);
          this._worldMat.compose(this._pos, this._quat, this._scl);
          this.contactShadowMesh.setMatrixAt(idx, this._worldMat);
        }
      }
    }

    for (const sm of this.lod0) {
      sm.instancedMesh.count = lod0Count;
      if (lod0Count > 0) sm.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (lod0Count > 0) draws++;
    for (const sm of this.lod1) {
      sm.instancedMesh.count = lod1Count;
      if (lod1Count > 0) sm.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (lod1Count > 0) draws++;
    if (this.contactShadowMesh) {
      this.contactShadowMesh.count = contactCount;
      if (contactCount > 0) {
        this.contactShadowMesh.instanceMatrix.needsUpdate = true;
        draws++;
      }
    }

    this.stats.visibleTrees = visible;
    this.stats.lod0Trees = lod0Count;
    this.stats.lod1Trees = lod1Count;
    this.stats.contactShadows = contactCount;
    this.stats.drawCalls = draws;
  }

  _disposeMeshSlots() {
    for (const arr of [this.lod0, this.lod1]) {
      for (const sm of arr) {
        this.group.remove(sm.instancedMesh);
        sm.instancedMesh.dispose();
      }
    }
    this.lod0 = [];
    this.lod1 = [];
    if (this.contactShadowMesh) {
      this.group.remove(this.contactShadowMesh);
      this.contactShadowMesh.dispose();
      this.contactShadowMesh = null;
    }
  }

  dispose() {
    this._disposeMeshSlots();
    this.scene.remove(this.group);
    this.trees = [];
    this.treeChunks.clear();
  }
}
