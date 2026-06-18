/**
 * Procedural structure meshes + ground height helpers.
 */
import * as THREE from "three";
import { createRtsBuildingGlbMesh } from "./rts-buildings.js";
import { snapRtsBuildingGroupToTerrain } from "./rts-buildings.js";

export function buildingDef(buildingTypes, type) {
  return buildingTypes?.[type];
}

export function maxTerrainHeightInRadius(
  terrainHeight,
  x,
  z,
  radius,
  rings = 3,
  spokes = 10,
) {
  let maxY = terrainHeight(x, z);
  for (let ring = 1; ring <= rings; ring++) {
    const rr = (radius * ring) / rings;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const sx = x + Math.cos(a) * rr;
      const sz = z + Math.sin(a) * rr;
      maxY = Math.max(maxY, terrainHeight(sx, sz));
    }
  }
  return maxY;
}

export function structureGroundY(terrainHeight, buildingTypes, x, z, buildingType) {
  const B = buildingDef(buildingTypes, buildingType);
  const y = terrainHeight(x, z);
  if (buildingType === "barracks" && B) {
    const footprint = B.footprint ?? 14;
    const maxY = maxTerrainHeightInRadius(
      terrainHeight,
      x,
      z,
      footprint * 0.35,
      2,
      8,
    );
    return Math.max(y, maxY - 0.15);
  }
  return y;
}

export function snapBarracksToGround(group, terrainHeight, x, z) {
  if (!group?.userData?.glbBuilding) return group?.position?.y ?? 0;
  return snapRtsBuildingGroupToTerrain(group, terrainHeight, x, z);
}

function buildBarracksMesh(faction, colors) {
  const glb = createRtsBuildingGlbMesh("tent");
  if (glb) return glb;
  const { accent, trim } = colors;
  const g = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x5a5a52,
    roughness: 0.9,
    metalness: 0.05,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.78,
    metalness: 0.12,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: trim,
    roughness: 0.7,
    metalness: 0.15,
  });
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.35, 6), padMat), 0, 0.18, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.4, 4.5), wallMat), 0, 1.45, -0.4);
  add(new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.3, 4.8), trimMat), 0, 2.72, -0.4);
  add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.0), wallMat), 2.2, 1.1, 1.6);
  add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), trimMat),
    3.0,
    2.8,
    1.6,
  );
  return g;
}

function buildWarFactoryMesh(colors) {
  const { accent, trim } = colors;
  const g = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x555550,
    roughness: 0.92,
    metalness: 0.06,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.8,
    metalness: 0.14,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: trim,
    roughness: 0.72,
    metalness: 0.16,
  });
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  add(new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 8), padMat), 0, 0.2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(8.5, 3.2, 6.5), wallMat), 0, 1.8, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.35, 6.8), trimMat), 0, 3.48, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 2.4), wallMat), -3.2, 1.6, 2.8);
  add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 8), trimMat),
    3.6,
    2.5,
    -2.2,
  );
  return g;
}

function buildSandbagsMesh() {
  const g = new THREE.Group();
  const bagMat = new THREE.MeshStandardMaterial({
    color: 0x9a8a62,
    roughness: 0.92,
    metalness: 0.02,
  });
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.42, 0.62),
        bagMat,
      );
      bag.rotation.y = (row + col) * 0.18;
      add(bag, (col - 1.5) * 0.88, 0.22 + row * 0.36, (row - 0.5) * 0.55);
    }
  }
  return g;
}

function buildHelipadMesh() {
  const g = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x3d4540,
    roughness: 0.9,
    metalness: 0.06,
  });
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xffd200,
    roughness: 0.55,
    metalness: 0.04,
    emissive: 0x4a3800,
    emissiveIntensity: 0.22,
  });
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const addFlat = (mesh, px, py, pz) => {
    mesh.rotation.x = -Math.PI / 2;
    add(mesh, px, py, pz);
  };

  add(
    new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.35, 32), padMat),
    0,
    0.18,
    0,
  );
  addFlat(
    new THREE.Mesh(new THREE.RingGeometry(4.15, 4.95, 48), yellowMat),
    0,
    0.37,
    0,
  );
  addFlat(
    new THREE.Mesh(new THREE.RingGeometry(0.28, 0.5, 20), yellowMat),
    0,
    0.37,
    0,
  );

  const markY = 0.38;
  const legX = 1.35;
  const legSpan = 3.0;
  const stroke = 0.42;
  add(
    new THREE.Mesh(new THREE.BoxGeometry(stroke, 0.1, legSpan), yellowMat),
    -legX,
    markY,
    0,
  );
  add(
    new THREE.Mesh(new THREE.BoxGeometry(stroke, 0.1, legSpan), yellowMat),
    legX,
    markY,
    0,
  );
  add(
    new THREE.Mesh(new THREE.BoxGeometry(legX * 2 + stroke, 0.1, stroke), yellowMat),
    0,
    markY,
    0,
  );
  add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 2.2), padMat), -3.2, 0.45, 2.4);
  return g;
}

export function buildTurretMesh(accent, trim) {
  const g = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a44,
    roughness: 0.88,
    metalness: 0.08,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.75,
    metalness: 0.14,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: trim,
    roughness: 0.7,
    metalness: 0.18,
  });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 1.05, 0.45, 8),
    padMat,
  );
  base.position.y = 0.22;
  base.castShadow = true;
  g.add(base);
  const head = new THREE.Group();
  head.position.y = 0.55;
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.55, 1.15),
    wallMat,
  );
  housing.castShadow = true;
  head.add(housing);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 1.35, 8),
    darkMat,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.12, 0.95);
  barrel.castShadow = true;
  head.add(barrel);
  g.add(head);
  g.userData.head = head;
  return { group: g, head };
}

function buildRadioStationMesh() {
  const glb = createRtsBuildingGlbMesh("radiostation");
  if (glb) return { group: glb, turretHead: null };
  const g = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x4a4e52,
    roughness: 0.9,
    metalness: 0.08,
  });
  const mastMat = new THREE.MeshStandardMaterial({
    color: 0x8a9098,
    roughness: 0.55,
    metalness: 0.35,
  });
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  add(new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.2, 0.35, 16), padMat), 0, 0.18, 0);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 8.5, 8), mastMat), 0, 4.4, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 1.2), mastMat), 0.55, 7.2, 0);
  return { group: g, turretHead: null };
}

export function buildStructureMesh(faction, buildingType, colors) {
  if (buildingType === "barracks") {
    return { group: buildBarracksMesh(faction, colors), turretHead: null };
  }
  if (buildingType === "warFactory") {
    return { group: buildWarFactoryMesh(colors), turretHead: null };
  }
  if (buildingType === "helipad") {
    return { group: buildHelipadMesh(), turretHead: null };
  }
  if (buildingType === "sandbags") {
    return { group: buildSandbagsMesh(), turretHead: null };
  }
  if (buildingType === "radioStation") {
    return buildRadioStationMesh();
  }
  if (buildingType === "aaTurret") {
    const { accent, trim } = colors;
    const { group, head } = buildTurretMesh(accent, trim);
    head.position.y = 0.72;
    return { group, turretHead: head };
  }
  const { accent, trim } = colors;
  const { group, head } = buildTurretMesh(accent, trim);
  return { group, turretHead: head };
}
