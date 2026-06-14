import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  attribute,
  dot,
  float,
  floor,
  length,
  mix,
  mod,
  mrt,
  output,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const TEX_BASE = "./textures/particles";

const SMOKE_CFG = JSON.parse(
  '{"duration":1,"looping":false,"startLifetime":{"min":0.67,"max":2.86},"startSpeed":{"min":0,"max":2.2},"startSize":{"min":35,"max":60},"startOpacity":{"min":1,"max":1},"startRotation":{"min":-360,"max":360},"startColor":{"min":{"r":0.1,"g":0.1,"b":0.1},"max":{"r":0.2,"g":0.2,"b":0.2}},"gravity":-0.5,"emission":{"rateOverTime":500},"shape":{"sphere":{"radius":0.4,"arc":180}},"sizeOverLifetime":{"isActive":true,"lifetimeCurve":{"bezierPoints":[{"x":0,"y":0,"percentage":0},{"x":0,"y":1},{"x":0,"y":1},{"x":0.5,"y":1,"percentage":0.5},{"x":1,"y":1},{"x":1,"y":1},{"x":1,"y":0,"percentage":1}]}},"opacityOverLifetime":{"isActive":true,"lifetimeCurve":{"bezierPoints":[{"x":0,"y":1,"percentage":0},{"x":0.1666,"y":0.8333},{"x":0.3333,"y":0.6666},{"x":0.5,"y":0.5,"percentage":0.5},{"x":0.6666,"y":0.3332},{"x":0.8333,"y":0.1665},{"x":1,"y":0,"percentage":1}]}},"rotationOverLifetime":{"isActive":true,"min":-22.4,"max":24.3},"noise":{"isActive":true,"useRandomOffset":true,"strength":0.09,"positionAmount":0.191,"rotationAmount":1.677}}',
);

const ROCKS_CFG = JSON.parse(
  '{"transform":{"rotation":{"x":-90}},"duration":0.3,"looping":false,"startLifetime":{"min":0.67,"max":1.77},"startSpeed":{"min":5.6,"max":14.64},"startSize":{"min":0.37,"max":3.11},"startOpacity":{"min":1,"max":1},"startRotation":{"min":-360,"max":360},"startColor":{"min":{"r":0.38823529411764707,"g":0.37254901960784315,"b":0.37254901960784315},"max":{"r":0.2196078431372549,"g":0.1803921568627451,"b":0.1803921568627451}},"gravity":13.7,"maxParticles":36,"emission":{"rateOverTime":500},"shape":{"shape":"CONE","cone":{"angle":36.4845,"radius":1.9553}},"sizeOverLifetime":{"lifetimeCurve":{"bezierPoints":[{"x":0,"y":0,"percentage":0},{"x":1,"y":1,"percentage":1}]}},"opacityOverLifetime":{"isActive":true,"lifetimeCurve":{"bezierPoints":[{"x":0,"y":1,"percentage":0},{"x":0.1666,"y":0.8333},{"x":0.6366,"y":1.0466},{"x":0.8033,"y":0.88,"percentage":0.8033},{"x":0.9699,"y":0.7133},{"x":0.8333,"y":0.1665},{"x":1,"y":0,"percentage":1}]}},"rotationOverLifetime":{"isActive":true,"min":-342.5,"max":299},"textureSheetAnimation":{"tiles":{"x":5,"y":2},"timeMode":"FPS","fps":0,"startFrame":{"min":0,"max":10}}}',
);

const FIRE_CFG = JSON.parse(
  '{"duration":0.36,"looping":false,"startLifetime":{"min":0.4,"max":0.67},"startSpeed":{"min":3.68,"max":5.87},"startSize":{"min":24.14,"max":53.38},"startOpacity":{"min":0.287,"max":0.442},"startRotation":{"min":-360,"max":360},"startColor":{"min":{"r":0.9098039215686274,"g":0.2901960784313726,"b":0.2901960784313726},"max":{"r":1,"g":0.9686274509803922,"b":0.0392156862745098}},"gravity":-0.5,"emission":{"rateOverTime":500},"shape":{"sphere":{"radius":0.4,"arc":180}},"sizeOverLifetime":{"isActive":true,"lifetimeCurve":{"bezierPoints":[{"x":0,"y":0,"percentage":0},{"x":0,"y":1},{"x":0,"y":1},{"x":0.5,"y":1,"percentage":0.5},{"x":1,"y":1},{"x":1,"y":1},{"x":1,"y":0,"percentage":1}]}},"opacityOverLifetime":{"isActive":true,"lifetimeCurve":{"bezierPoints":[{"x":0,"y":1,"percentage":0},{"x":0.1666,"y":0.8333},{"x":0.3333,"y":0.6666},{"x":0.5,"y":0.5,"percentage":0.5},{"x":0.6666,"y":0.3332},{"x":0.8333,"y":0.1665},{"x":1,"y":0,"percentage":1}]}},"rotationOverLifetime":{"isActive":true,"min":-22.4,"max":24.3},"noise":{"isActive":true,"useRandomOffset":true,"strength":0.09,"positionAmount":0.191,"rotationAmount":1.677}}',
);

const DEFAULT_LOOK = {
  brightness: 0.88,
  contrast: 1.08,
  saturation: 0.92,
  edgeSoft: 0.018,
  sizeScale: 1,
  emissionScale: 1,
  gravityScale: 1,
  smokeDelay: 200,
  fireOpacity: 1,
  smokeOpacity: 1,
  rocksOpacity: 1,
  fireTint: "#ffffff",
  smokeTint: "#b8b8b8",
};

const uLook = {
  brightness: uniform(DEFAULT_LOOK.brightness),
  contrast: uniform(DEFAULT_LOOK.contrast),
  saturation: uniform(DEFAULT_LOOK.saturation),
  edgeSoft: uniform(DEFAULT_LOOK.edgeSoft),
  bypassGrade: uniform(0),
};

const nCr = (n, k) => {
  let z = 1;
  for (let i = 1; i <= k; i++) z *= (n + 1 - i) / i;
  return z;
};

function createBezierCurveFunction(bezierPoints) {
  return (percentage) => {
    if (percentage < 0) return bezierPoints[0].y;
    if (percentage > 1) return bezierPoints[bezierPoints.length - 1].y;
    let start = 0;
    let stop = bezierPoints.length - 1;
    bezierPoints.find((point, index) => {
      const hit = percentage < (point.percentage ?? 0);
      if (hit) stop = index;
      else if (point.percentage !== undefined) start = index;
      return hit;
    });
    const n = stop - start;
    const calculated =
      (percentage - (bezierPoints[start].percentage ?? 0)) /
      ((bezierPoints[stop].percentage ?? 1) - (bezierPoints[start].percentage ?? 0));
    let value = 0;
    for (let i = 0; i <= n; i++) {
      const p = bezierPoints[start + i];
      const c = nCr(n, i) * (1 - calculated) ** (n - i) * calculated ** i;
      value += c * p.y;
    }
    return value;
  };
}

function calculateValue(value, systemT = 0) {
  if (typeof value === "number") return value;
  if (value && "min" in value && "max" in value) {
    if (value.min === value.max) return value.min ?? 0;
    return THREE.MathUtils.randFloat(value.min ?? 0, value.max ?? 1);
  }
  if (value?.bezierPoints) {
    const fn = createBezierCurveFunction(value.bezierPoints);
    return fn(systemT) * (value.scale ?? 1);
  }
  return 0;
}

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _partWorld = new THREE.Vector3();
const _mv = new THREE.Vector3();
const _rootInvQuat = new THREE.Quaternion();

function spawnOnSphere(position, quaternion, velocity, speed, { radius, radiusThickness = 1, arc }) {
  const u = Math.random() * (arc / 360);
  const v = Math.random();
  const randomizedDistanceRatio = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const sinPhi = Math.sin(phi);
  const xDir = sinPhi * Math.cos(theta);
  const yDir = sinPhi * Math.sin(theta);
  const zDir = Math.cos(phi);
  const nt = 1 - radiusThickness;
  position.set(
    radius * nt * xDir + radius * radiusThickness * randomizedDistanceRatio * xDir,
    radius * nt * yDir + radius * radiusThickness * randomizedDistanceRatio * yDir,
    radius * nt * zDir + radius * radiusThickness * randomizedDistanceRatio * zDir,
  );
  position.applyQuaternion(quaternion);
  const mul = speed / Math.max(position.length(), 1e-6);
  velocity.set(position.x * mul, position.y * mul, position.z * mul);
  velocity.applyQuaternion(quaternion);
}

function spawnOnCone(position, quaternion, velocity, speed, { radius, radiusThickness = 1, arc, angle = 90 }) {
  const theta = 2 * Math.PI * Math.random() * (arc / 360);
  const randomizedDistanceRatio = Math.random();
  const xDir = Math.cos(theta);
  const yDir = Math.sin(theta);
  const nt = 1 - radiusThickness;
  position.set(
    radius * nt * xDir + radius * radiusThickness * randomizedDistanceRatio * xDir,
    radius * nt * yDir + radius * radiusThickness * randomizedDistanceRatio * yDir,
    0,
  );
  position.applyQuaternion(quaternion);
  const len = Math.max(position.length(), 1e-6);
  const normalizedAngle = Math.abs((len / radius) * THREE.MathUtils.degToRad(angle));
  const sinA = Math.sin(normalizedAngle);
  const mul = (sinA * speed) / len;
  velocity.set(position.x * mul, position.y * mul, Math.cos(normalizedAngle) * speed);
  velocity.applyQuaternion(quaternion);
}

function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const hash = (i, j, k) => {
    let n = i * 374761393 + j * 668265263 + k * 1274126177;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff) * 2 - 1);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const x00 = lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx);
  const x10 = lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx);
  const x01 = lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx);
  const x11 = lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx);
  return lerp(lerp(x00, x01, fy), lerp(x10, x11, fy), fz);
}

function createSpriteMaterial(map, tilesX, tilesY, useLifetimeFrames, hasAtlas, layerOpacity, layerTint, glow = false) {
  const uTiles = uniform(vec2(tilesX, tilesY));
  const uUseLifeFrames = uniform(useLifetimeFrames ? 1 : 0);
  const uLayerOpacity = uniform(layerOpacity);
  const uLayerTint = uniform(new THREE.Color(layerTint));

  const iColor = attribute("iColor", "vec4");
  const iStartFrame = hasAtlas ? attribute("iStartFrame") : float(0);
  const iLifeRatio = hasAtlas ? attribute("iLifeRatio") : float(0);

  const st = uv();
  const dist = length(st.sub(vec2(0.5, 0.5)));
  const edgeInner = float(0.5).sub(uLook.edgeSoft);
  const insideHard = float(1).sub(step(float(0.5), dist));
  const insideSoft = float(1).sub(smoothstep(edgeInner, float(0.5), dist));
  const circle = mix(insideHard, insideSoft, step(float(0.001), uLook.edgeSoft));

  const totalFrames = uTiles.x.mul(uTiles.y);
  const frameIndex = iStartFrame
    .add(iLifeRatio.mul(totalFrames.sub(iStartFrame)).mul(uUseLifeFrames))
    .floor();
  const tileCol = mod(frameIndex, uTiles.x);
  const tileRow = floor(frameIndex.div(uTiles.x));
  const atlasUV = vec2(
    st.x.div(uTiles.x).add(tileCol.div(uTiles.x)),
    st.y.div(uTiles.y).add(tileRow.div(uTiles.y)),
  );

  const samp = texture(map, hasAtlas ? atlasUV : st);
  const particle = vec4(iColor.xyz.mul(uLayerTint), iColor.w.mul(uLayerOpacity));
  const texel = vec4(samp.rgb, samp.a);
  const frag4 = particle.mul(texel);
  const lum = dot(frag4.xyz, vec3(0.2126, 0.7152, 0.0722));
  let graded = mix(vec3(lum), frag4.xyz, uLook.saturation);
  graded = graded.sub(float(0.5)).mul(uLook.contrast).add(float(0.5));
  graded = graded.mul(uLook.brightness);
  const col = mix(graded, frag4.xyz, uLook.bypassGrade);
  const alpha = frag4.w.mul(circle);

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
  mat.colorNode = col;
  mat.opacityNode = alpha;
  if (glow) {
    // Fire layer feeds the selective-bloom emissive buffer (rts-lab MRT
    // pipeline). Ignored when rendering without MRT.
    mat.mrtNode = mrt({ output, emissive: col });
  }
  return { mat, uLayerOpacity, uLayerTint };
}

const INST_STRIDE = 6;

/** Shared sprite materials per layer signature — see TSLParticleSystem ctor. */
const _spriteMatCache = new Map();

class TSLParticleSystem {
  constructor(scene, cfg, map, maxParticles, renderOrder, atlas, layer, look) {
    this.cfg = cfg;
    this.look = look;
    this.maxParticles = maxParticles;
    this.layerKey = layer.key ?? "fire";
    this.sizeScale = layer.sizeScale ?? 1;
    this.emissionScale = layer.emissionScale ?? 1;
    this.gravityScale = layer.gravityScale ?? 1;
    this.atlas = atlas;
    this.hasAtlas = atlas.x * atlas.y > 1;
    this.useLifetimeFrames =
      cfg.textureSheetAnimation?.timeMode !== "FPS" && !!cfg.textureSheetAnimation?.tiles;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.deleteAttribute("normal");
    const n = maxParticles;
    this.instData = new Float32Array(n * INST_STRIDE);
    this.instBuffer = new THREE.InstancedInterleavedBuffer(this.instData, INST_STRIDE);
    geo.setAttribute("iColor", new THREE.InterleavedBufferAttribute(this.instBuffer, 4, 0));
    if (this.hasAtlas) {
      geo.setAttribute("iStartFrame", new THREE.InterleavedBufferAttribute(this.instBuffer, 1, 4));
      geo.setAttribute("iLifeRatio", new THREE.InterleavedBufferAttribute(this.instBuffer, 1, 5));
    }

    this.velocities = Array.from({ length: n }, () => new THREE.Vector3());
    this.creationTimes = new Float32Array(n);
    this.startLifetimes = new Float32Array(n);
    this.startSizes = new Float32Array(n);
    this.startOpacities = new Float32Array(n);
    this.rotSpeeds = new Float32Array(n);
    this.noiseOffsets = new Float32Array(n);
    this.isActive = new Uint8Array(n);
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.posZ = new Float32Array(n);
    this.rotations = new Float32Array(n);
    this.startFrames = new Float32Array(n);

    this.sizeCurve = cfg.sizeOverLifetime?.lifetimeCurve?.bezierPoints
      ? createBezierCurveFunction(cfg.sizeOverLifetime.lifetimeCurve.bezierPoints)
      : null;
    this.opacityCurve = cfg.opacityOverLifetime?.lifetimeCurve?.bezierPoints
      ? createBezierCurveFunction(cfg.opacityOverLifetime.lifetimeCurve.bezierPoints)
      : null;
    this.sizeOverLife = cfg.sizeOverLifetime?.isActive === true;
    this.opacityOverLife = cfg.opacityOverLifetime?.isActive === true;

    const layerOpacity =
      this.layerKey === "fire"
        ? look.fireOpacity
        : this.layerKey === "smoke"
          ? look.smokeOpacity
          : look.rocksOpacity;
    const layerTint =
      this.layerKey === "fire" ? look.fireTint : this.layerKey === "smoke" ? look.smokeTint : "#ffffff";

    // Materials are CACHED per layer signature — explosions fire constantly
    // in combat and rebuilding the TSL node graph + pipeline per explosion
    // was real per-shot CPU. Shared materials must never be disposed.
    const matKey = `${this.layerKey}|${atlas.x}x${atlas.y}|${this.useLifetimeFrames ? 1 : 0}|${layerOpacity}|${layerTint}`;
    let cached = _spriteMatCache.get(matKey);
    if (!cached) {
      cached = createSpriteMaterial(
        map,
        atlas.x,
        atlas.y,
        this.useLifetimeFrames,
        this.hasAtlas,
        layerOpacity,
        layerTint,
        this.layerKey === "fire",
      );
      _spriteMatCache.set(matKey, cached);
    }
    const { mat, uLayerOpacity, uLayerTint } = cached;
    this.uLayerOpacity = uLayerOpacity;
    this.uLayerTint = uLayerTint;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;

    this.root = new THREE.Group();
    const tr = cfg.transform?.rotation;
    if (tr) {
      this.root.rotation.set(
        THREE.MathUtils.degToRad(tr.x ?? 0),
        THREE.MathUtils.degToRad(tr.y ?? 0),
        THREE.MathUtils.degToRad(tr.z ?? 0),
      );
    }
    this.root.add(this.mesh);
    scene.add(this.root);

    this.gravityVelocity = new THREE.Vector3();
    this.isEmitting = false;
    this.creationTime = 0;
    this.lastEmissionTime = 0;
    this.systemAge = 0;
    this._dummy = new THREE.Object3D();
  }

  _ib(i) {
    return i * INST_STRIDE;
  }

  start(worldPos, now) {
    this.root.position.copy(worldPos);
    this.isEmitting = true;
    this.creationTime = now;
    this.lastEmissionTime = now;
    this.systemAge = 0;
    for (let i = 0; i < this.maxParticles; i++) this.deactivate(i);
    this.mesh.count = 0;
  }

  deactivate(i) {
    this.isActive[i] = 0;
    this.instData[this._ib(i) + 3] = 0;
  }

  activate(i, now) {
    const cfg = this.cfg;
    const b = this._ib(i);
    this.isActive[i] = 1;
    this.creationTimes[i] = now;
    this.noiseOffsets[i] = Math.random() * 100;

    const lt = calculateValue(cfg.startLifetime) * 1000;
    this.startLifetimes[i] = lt;
    const speed = calculateValue(cfg.startSpeed);
    this.startSizes[i] = calculateValue(cfg.startSize);
    this.startOpacities[i] = calculateValue(cfg.startOpacity);
    this.instData[b + 3] = this.startOpacities[i];

    const ratio = Math.random();
    const cmin = cfg.startColor.min;
    const cmax = cfg.startColor.max ?? cmin;
    const ch = (k) => {
      const lo = cmin[k] ?? 0;
      const hi = cmax[k] ?? 1;
      return lo + ratio * (hi - lo);
    };
    this.instData[b] = ch("r");
    this.instData[b + 1] = ch("g");
    this.instData[b + 2] = ch("b");

    this.rotations[i] = calculateValue(cfg.startRotation);
    this.rotSpeeds[i] = cfg.rotationOverLifetime?.isActive
      ? THREE.MathUtils.randFloat(cfg.rotationOverLifetime.min, cfg.rotationOverLifetime.max)
      : 0;

    if (this.hasAtlas) {
      const sf = cfg.textureSheetAnimation?.startFrame ? calculateValue(cfg.textureSheetAnimation.startFrame) : 0;
      this.startFrames[i] = sf;
      this.instData[b + 4] = sf;
      this.instData[b + 5] = 0;
    }

    _q.setFromEuler(this.root.rotation);
    if (cfg.shape?.sphere) {
      spawnOnSphere(_pos, _q, _vel, speed, {
        radius: cfg.shape.sphere.radius,
        radiusThickness: cfg.shape.sphere.radiusThickness ?? 1,
        arc: cfg.shape.sphere.arc ?? 360,
      });
    } else if (cfg.shape?.cone || cfg.shape?.shape === "CONE") {
      const cone = cfg.shape.cone;
      spawnOnCone(_pos, _q, _vel, speed, {
        radius: cone.radius,
        radiusThickness: cone.radiusThickness ?? 1,
        arc: cone.arc ?? 360,
        angle: cone.angle ?? 90,
      });
    }

    this.velocities[i].copy(_vel);
    this.posX[i] = _pos.x;
    this.posY[i] = _pos.y;
    this.posZ[i] = _pos.z;
  }

  update(now, delta, camera, canvasHeight) {
    const cfg = this.cfg;
    if (!this.isEmitting && this.mesh.count === 0) return;

    this.systemAge = (now - this.creationTime) / 1000;
    this.root.getWorldPosition(_pos);
    this.gravityVelocity.set(_pos.x, _pos.y + (cfg.gravity ?? 0) * this.gravityScale, _pos.z);
    this.root.worldToLocal(this.gravityVelocity);

    if (this.isEmitting && this.systemAge <= cfg.duration) {
      const emissionDelta = now - this.lastEmissionTime;
      const needed = Math.floor(
        calculateValue(cfg.emission?.rateOverTime ?? 0) * this.emissionScale * (emissionDelta / 1000),
      );
      for (let n = 0; n < needed; n++) {
        const slot = this.isActive.findIndex((v) => v === 0);
        if (slot < 0) break;
        this.activate(slot, now);
      }
      this.lastEmissionTime = now;
    } else if (this.systemAge > cfg.duration) {
      this.isEmitting = false;
    }

    const noise = cfg.noise;
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_rootInvQuat).invert();
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const projFactor = (2 * Math.tan(fovRad * 0.5)) / Math.max(canvasHeight, 1);

    for (let i = 0; i < this.maxParticles; i++) {
      const b = this._ib(i);
      if (!this.isActive[i]) {
        this.instData[b + 3] = 0;
        this._dummy.position.set(0, -9999, 0);
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this._dummy.matrix);
        continue;
      }

      const particleLife = now - this.creationTimes[i];
      if (particleLife >= this.startLifetimes[i]) {
        this.deactivate(i);
        continue;
      }

      const lifePct = particleLife / this.startLifetimes[i];
      if (this.hasAtlas) this.instData[b + 5] = lifePct;

      const vel = this.velocities[i];
      vel.x -= this.gravityVelocity.x * delta;
      vel.y -= this.gravityVelocity.y * delta;
      vel.z -= this.gravityVelocity.z * delta;
      this.posX[i] += vel.x * delta;
      this.posY[i] += vel.y * delta;
      this.posZ[i] += vel.z * delta;

      if (noise?.isActive) {
        const str = noise.strength ?? 1;
        const nPos = (lifePct + this.noiseOffsets[i]) * 10 * str;
        const nPow = 0.15 * str;
        const nAmt = noise.positionAmount ?? 1;
        this.posX[i] += noise3(nPos, 0, 0) * nPow * nAmt;
        this.posY[i] += noise3(nPos, nPos, 0) * nPow * nAmt;
        this.posZ[i] += noise3(nPos, nPos, nPos) * nPow * nAmt;
        if (noise.rotationAmount) {
          this.rotations[i] += noise3(nPos, 0, 0) * nPow * noise.rotationAmount;
        }
      }

      this.rotations[i] += this.rotSpeeds[i] * delta * 0.02;

      let size = this.startSizes[i];
      if (this.sizeOverLife && this.sizeCurve) size *= Math.max(0, this.sizeCurve(lifePct));

      if (this.opacityOverLife && this.opacityCurve) {
        this.instData[b + 3] = this.startOpacities[i] * Math.max(0, this.opacityCurve(lifePct));
      }

      const px = this.posX[i];
      const py = this.posY[i];
      const pz = this.posZ[i];
      this._dummy.position.set(px, py, pz);
      this._dummy.quaternion.copy(_rootInvQuat).multiply(camera.quaternion);
      this._dummy.rotateZ(THREE.MathUtils.degToRad(this.rotations[i]));

      _partWorld.set(px, py, pz).applyMatrix4(this.root.matrixWorld);
      _mv.copy(_partWorld).applyMatrix4(camera.matrixWorldInverse);
      const mvLen = Math.max(_mv.length(), 0.01);
      const pixelSize = (size * 100) / mvLen;
      const worldScale = pixelSize * projFactor * Math.abs(_mv.z) * this.sizeScale;
      this._dummy.scale.set(worldScale, worldScale, 1);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }

    this.mesh.count = this.maxParticles;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.instBuffer.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mesh.geometry.dispose();
    // Material is shared via _spriteMatCache — never dispose it here.
  }
}

const MAX_CONCURRENT_EXPLOSIONS = 5;

class ExplosionDirector {
  constructor(scene, textures, look) {
    this.scene = scene;
    this.textures = textures;
    this.look = look;
    this.groups = [];
  }

  explode(x, y, z, scale = 1, now = performance.now()) {
    if (this.groups.length >= MAX_CONCURRENT_EXPLOSIONS) return;
    const pos = new THREE.Vector3(x, y, z);
    const layerOpts = {
      sizeScale: this.look.sizeScale * scale,
      emissionScale: this.look.emissionScale * Math.sqrt(scale),
      gravityScale: this.look.gravityScale,
    };
    const lite = scale < 1.35;
    const fireCount = lite ? 40 : 64;
    const smokeCount = lite ? 36 : 56;
    const rockCount = lite ? 0 : 20;

    const fire = new TSLParticleSystem(this.scene, FIRE_CFG, this.textures.flame, fireCount, 12, { x: 1, y: 1 }, { key: "fire", ...layerOpts }, this.look);
    const rocks = rockCount
      ? new TSLParticleSystem(this.scene, ROCKS_CFG, this.textures.rocks, rockCount, 13, { x: 5, y: 2 }, { key: "rocks", ...layerOpts }, this.look)
      : null;
    const smoke = new TSLParticleSystem(this.scene, SMOKE_CFG, this.textures.cloud, smokeCount, 14, { x: 1, y: 1 }, { key: "smoke", ...layerOpts }, this.look);

    fire.start(pos, now);
    if (rocks) rocks.start(pos, now);
    const smokePos = pos.clone();
    const smokeStart = now + this.look.smokeDelay;
    const group = { fire, rocks, smoke, smokePos, smokeStart, smokeStarted: false, born: now };
    this.groups.push(group);

    setTimeout(() => {
      const idx = this.groups.indexOf(group);
      if (idx >= 0) this.groups.splice(idx, 1);
      fire.dispose(this.scene);
      if (rocks) rocks.dispose(this.scene);
      smoke.dispose(this.scene);
    }, 5000);
  }

  update(now, delta, camera, canvasHeight) {
    if (!this.groups.length) return;
    for (const g of this.groups) {
      if (!g.smokeStarted && now >= g.smokeStart) {
        g.smoke.start(g.smokePos, now);
        g.smokeStarted = true;
      }
      g.fire.update(now, delta, camera, canvasHeight);
      if (g.rocks) g.rocks.update(now, delta, camera, canvasHeight);
      if (g.smokeStarted) g.smoke.update(now, delta, camera, canvasHeight);
    }
  }

  dispose() {
    for (const g of [...this.groups]) {
      g.fire.dispose(this.scene);
      if (g.rocks) g.rocks.dispose(this.scene);
      g.smoke.dispose(this.scene);
    }
    this.groups.length = 0;
  }
}

/**
 * Stylized fire/smoke/rocks burst from stylized-explosion-showcase.html
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @returns {Promise<{explode:(x:number,y:number,z:number,scale?:number)=>void, update:(now:number,delta:number,camera:THREE.Camera,canvasHeight:number)=>void, dispose:()=>void}>}
 */
export async function createStylizedExplosionSystem(scene, opts = {}) {
  const look = { ...DEFAULT_LOOK, ...(opts.look ?? {}) };
  uLook.brightness.value = look.brightness;
  uLook.contrast.value = look.contrast;
  uLook.saturation.value = look.saturation;
  uLook.edgeSoft.value = look.edgeSoft;

  const base = opts.textureBase ?? TEX_BASE;
  const loader = new THREE.TextureLoader();
  const loadTex = (url) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          resolve(t);
        },
        undefined,
        reject,
      );
    });

  const [cloud, rocks, flame] = await Promise.all([
    loadTex(`${base}/cloud.webp`),
    loadTex(`${base}/rocks.webp`),
    loadTex(`${base}/flame.webp`),
  ]);

  const director = new ExplosionDirector(scene, { cloud, rocks, flame }, look);

  return {
    explode(x, y, z, scale = 1) {
      director.explode(x, y, z, scale);
    },
    update(now, delta, camera, canvasHeight) {
      director.update(now, delta, camera, canvasHeight);
    },
    dispose() {
      director.dispose();
    },
  };
}
