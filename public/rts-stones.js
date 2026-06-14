/**
 * RTS terrain stones — instanced stone_low-poly.glb with chunk + frustum culling.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { initRtsGltfLoader, loadRtsGltfScene } from "./rts-gltf-loader.js";

const INITIAL_CAPACITY = 8192;
const CULL_MARGIN = 5;
const CULL_HEIGHT = 12;
const _yAxis = new THREE.Vector3(0, 1, 0);
const _normalizeRoot = new THREE.Group();

function makeRng(seed) {
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

function normalizeStoneScene(scene, targetSize = 1.1) {
  _normalizeRoot.clear();
  _normalizeRoot.add(scene);
  _normalizeRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(_normalizeRoot);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const s = targetSize / maxDim;
  scene.scale.setScalar(s);
  _normalizeRoot.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(_normalizeRoot);
  const center = grounded.getCenter(new THREE.Vector3());
  scene.position.set(-center.x, -grounded.min.y, -center.z);
  _normalizeRoot.updateMatrixWorld(true);
  return s;
}

function buildMergedStoneMesh(root) {
  const meshList = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && o.geometry) meshList.push(o);
  });
  if (!meshList.length) return null;

  const geos = [];
  const mat = meshList[0].material?.clone?.() ?? meshList[0].material;
  if (mat) {
    mat.roughness = mat.roughness ?? 0.92;
    mat.metalness = mat.metalness ?? 0.02;
    mat.fog = true;
  }

  for (const m of meshList) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    geos.push(g);
  }

  const geometry = mergeGeometries(geos, true);
  geometry.computeBoundingBox();
  if (geometry.boundingBox) {
    const minY = geometry.boundingBox.min.y;
    if (Math.abs(minY) > 1e-5) geometry.translate(0, -minY, 0);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, material: mat };
}

function pickStoneScale(S, rng) {
  const bigChance = S.bigRockChance ?? 0;
  if (bigChance > 0 && rng() < bigChance) {
    const lo = S.bigScaleMin ?? 1.6;
    const hi = S.bigScaleMax ?? 3;
    return lo + rng() * Math.max(0.01, hi - lo);
  }
  const lo = S.scaleMin ?? 0.5;
  const hi = S.scaleMax ?? 1.2;
  return lo + rng() * Math.max(0.01, hi - lo);
}

export class RtsTerrainStones {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "RtsTerrainStones";
    this.scene.add(this.group);

    this.cfg = null;
    this.enabled = true;
    this.stones = [];
    this.stoneChunks = new Map();
    this.template = null;
    this.instancedMesh = null;
    this._cap = INITIAL_CAPACITY;

    this.stats = {
      stoneCount: 0,
      visibleStones: 0,
      drawCalls: 0,
    };

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._tiltMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  async init(cfg) {
    this.cfg = cfg;
    initRtsGltfLoader(this.renderer);
    const scene = await loadRtsGltfScene(cfg.modelPath ?? "models/stone_low-poly.glb");
    normalizeStoneScene(scene, cfg.targetSize ?? 1.1);
    const merged = buildMergedStoneMesh(scene);
    if (!merged) throw new Error("[rts-stones] GLB has no meshes");

    this.template = merged;
    this._disposeMesh();
    this.instancedMesh = new THREE.InstancedMesh(
      merged.geometry,
      merged.material,
      this._cap,
    );
    this.instancedMesh.count = 0;
    this.instancedMesh.name = "rts-stone-field";
    this.instancedMesh.frustumCulled = false;
    this.group.add(this.instancedMesh);
    this.applyShadowFlags();
    this._populateStones();
  }

  _disposeMesh() {
    if (!this.instancedMesh) return;
    this.group.remove(this.instancedMesh);
    this.instancedMesh.dispose();
    this.instancedMesh = null;
  }

  _populateStones() {
    const S = this.cfg;
    const rng = makeRng(S.placementSeed ?? 0);
    const cs = S.chunkSize ?? 80;
    const half = Math.floor((S.halfExtent ?? 600) / (S.spacing ?? 6));
    const spacing = S.spacing ?? 6;
    const jitter = S.jitter ?? 2;
    const maxSlope = S.maxSlope ?? 0.55;
    const getY = S.getStoneY ?? (() => 0);
    const getSlope = S.getSlope ?? (() => 0);

    this.stones = [];
    this.stoneChunks.clear();

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const x = ix * spacing + (rng() - 0.5) * jitter * 2;
        const z = iz * spacing + (rng() - 0.5) * jitter * 2;
        const ext = S.halfExtent ?? 600;
        if (Math.abs(x) > ext || Math.abs(z) > ext) continue;
        if (isExcluded(x, z, S.excludeCircles ?? [])) continue;
        if ((S.density ?? 1) < 1 && rng() > S.density) continue;
        const slope = getSlope(x, z);
        if (slope > maxSlope) continue;
        const y = getY(x, z);
        if (y < (S.minHeight ?? -20) || y > (S.maxHeight ?? 500)) continue;

        const scale = pickStoneScale(S, rng);
        const rotY = rng() * Math.PI * 2;
        const tiltX = (rng() - 0.5) * 0.22 * slope;
        const tiltZ = (rng() - 0.5) * 0.22 * slope;
        const stone = { x, y, z, scale, rotY, tiltX, tiltZ };
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        const key = `${cx},${cz}`;
        if (!this.stoneChunks.has(key)) {
          this.stoneChunks.set(key, { cx, cz, stones: [] });
        }
        this.stoneChunks.get(key).stones.push(stone);
        this.stones.push(stone);
      }
    }

    this.stats.stoneCount = this.stones.length;
  }

  rebuild() {
    this._populateStones();
    this.stats.stoneCount = this.stones.length;
  }

  refreshHeights() {
    const getY = this.cfg?.getStoneY ?? (() => 0);
    for (const s of this.stones) {
      s.y = getY(s.x, s.z);
    }
  }

  setExcludeCircles(circles) {
    if (this.cfg) this.cfg.excludeCircles = circles ?? [];
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
  }

  applyShadowFlags() {
    if (!this.instancedMesh || !this.cfg) return;
    this.instancedMesh.castShadow = this.cfg.castShadow !== false;
    this.instancedMesh.receiveShadow = this.cfg.receiveShadow !== false;
  }

  /** Single decorative rock (nav obstacles, etc.). */
  createProp(scale = 1, rotY = 0, tiltX = 0, tiltZ = 0) {
    if (!this.template) return null;
    const mesh = new THREE.Mesh(this.template.geometry, this.template.material);
    mesh.castShadow = this.cfg?.castShadow !== false;
    mesh.receiveShadow = this.cfg?.receiveShadow !== false;
    this._euler.set(tiltX, rotY, tiltZ, "YXZ");
    mesh.quaternion.setFromEuler(this._euler);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  placeProp(mesh, x, z, y) {
    if (!mesh) return;
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const delta = y - box.min.y;
    if (Math.abs(delta) > 1e-4) mesh.position.y += delta;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{ targetX: number, targetZ: number, zoom: number }} rts
   */
  update(camera, rts = {}) {
    if (!this.enabled || !this.instancedMesh) return;

    const targetX = rts.targetX ?? camera.position.x;
    const targetZ = rts.targetZ ?? camera.position.z;
    const zoom = Math.max(1, rts.zoom ?? 120);
    const zf = THREE.MathUtils.clamp(zoom / 110, 0.35, 1.25);
    const fadeD = (this.cfg.fadeDistance ?? 260) * zf;
    const fadeD2 = fadeD * fadeD;

    this.instancedMesh.count = 0;
    this._projScreen.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const cs = this.cfg.chunkSize ?? 80;
    let visible = 0;
    let drawCount = 0;

    for (const chunk of this.stoneChunks.values()) {
      if (!chunk.stones.length) continue;
      const minX = chunk.cx * cs;
      const minZ = chunk.cz * cs;
      this._box.min.set(minX - CULL_MARGIN, -4, minZ - CULL_MARGIN);
      this._box.max.set(
        minX + cs + CULL_MARGIN,
        CULL_HEIGHT,
        minZ + cs + CULL_MARGIN,
      );
      if (!this._frustum.intersectsBox(this._box)) continue;

      for (const s of chunk.stones) {
        const dx = s.x - targetX;
        const dz = s.z - targetZ;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > fadeD2) continue;
        if (visible >= this._cap) break;

        this._euler.set(s.tiltX, s.rotY, s.tiltZ, "YXZ");
        this._quat.setFromEuler(this._euler);
        const getY = this.cfg?.getStoneY ?? (() => 0);
        this._pos.set(s.x, getY(s.x, s.z), s.z);
        this._scl.setScalar(s.scale);
        this._worldMat.compose(this._pos, this._quat, this._scl);
        this.instancedMesh.setMatrixAt(visible, this._worldMat);
        visible++;
      }
    }

    this.instancedMesh.count = visible;
    if (visible > 0) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      drawCount = 1;
    }

    this.stats.visibleStones = visible;
    this.stats.drawCalls = drawCount;
  }

  dispose() {
    this._disposeMesh();
    this.scene.remove(this.group);
    this.template?.geometry?.dispose?.();
    const mat = this.template?.material;
    if (mat?.dispose) mat.dispose();
    this.template = null;
    this.stones = [];
    this.stoneChunks.clear();
  }
}
