import * as THREE from 'three';

export type PropKind = 'grass-tuft' | 'flower' | 'candy-crystal' | 'rock' | 'tree' | 'cloud';

export type ThemeMaterials = {
  platformTop: THREE.Material;
  platformSide: THREE.Material;
  accent: THREE.Material;
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fogColor: THREE.Color;
  sunColor: THREE.Color;
  ambientColor: THREE.Color;
};

type ThemeSpec = {
  top: string;
  side: string;
  accent: string;
  skyTop: string;
  skyBottom: string;
  fog: string;
  sun: string;
  ambient: string;
};

const THEME_SPECS: readonly ThemeSpec[] = [
  {
    top: '#8fd66a',
    side: '#c98a5a',
    accent: '#ffd23f',
    skyTop: '#74c7ec',
    skyBottom: '#dff3d8',
    fog: '#dbeecf',
    sun: '#fff6cf',
    ambient: '#cfe8f5',
  },
  {
    top: '#ff9ec4',
    side: '#e0687f',
    accent: '#7fe3c4',
    skyTop: '#86d9f0',
    skyBottom: '#ffe6c9',
    fog: '#ffe9d6',
    sun: '#fff2c0',
    ambient: '#ffd9e0',
  },
  {
    top: '#7fbf59',
    side: '#9a6b45',
    accent: '#ffb347',
    skyTop: '#6fbfe0',
    skyBottom: '#f2ecc9',
    fog: '#dfeccb',
    sun: '#fff1c9',
    ambient: '#c9e6d8',
  },
  {
    top: '#f2cf7a',
    side: '#d97a5a',
    accent: '#7fd8e8',
    skyTop: '#7fc4e8',
    skyBottom: '#ffd9a8',
    fog: '#ffe0bd',
    sun: '#ffdf9e',
    ambient: '#ffd9c0',
  },
];

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();
const themeCache = new Map<number, ThemeMaterials>();

function cachedGeometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const existing = geometryCache.get(key);
  if (existing) {
    return existing;
  }
  const created = create();
  geometryCache.set(key, created);
  return created;
}

function cachedMaterial(key: string, create: () => THREE.Material): THREE.Material {
  const existing = materialCache.get(key);
  if (existing) {
    return existing;
  }
  const created = create();
  materialCache.set(key, created);
  return created;
}

function standard(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(params);
}

// Silhouette-first shape recipes. Every geometry is authored once and reused.
function blockGeometry(): THREE.BufferGeometry {
  const r = 0.22;
  const s = 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 6,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function bladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(0.075, 1, 5, 1);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

function petalGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.2, 0.12, 0.19, 0.5, 0, 0.72);
  shape.bezierCurveTo(-0.19, 0.5, -0.2, 0.12, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 8,
    steps: 1,
  });
  geometry.translate(0, 0, -0.025);
  return geometry;
}

function cylinderGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 9, 1);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

function crystalGeometry(): THREE.BufferGeometry {
  const points = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.16, 0.06),
    new THREE.Vector2(0.3, 0.42),
    new THREE.Vector2(0.22, 0.72),
    new THREE.Vector2(0.1, 0.92),
    new THREE.Vector2(0, 1),
  ];
  return new THREE.LatheGeometry(points, 6);
}

function blobLowGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 0);
}

function blobMidGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 2);
}

function hillGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1, 0);
  shape.bezierCurveTo(-0.55, 0.9, 0.55, 0.9, 1, 0);
  shape.lineTo(1, -0.35);
  shape.lineTo(-1, -0.35);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.6,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 12,
    steps: 1,
  });
  geometry.translate(0, 0, -0.3);
  return geometry;
}

function sunGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, 40);
}

function propMaterial(key: string, create: () => THREE.Material): THREE.Material {
  return cachedMaterial(key, create);
}

function grassMaterial(): THREE.Material {
  return propMaterial('grass', () => standard({ color: '#7cc24a', roughness: 0.82, metalness: 0.02 }));
}

function grassDarkMaterial(): THREE.Material {
  return propMaterial('grass-dark', () => standard({ color: '#559a34', roughness: 0.86, metalness: 0.02 }));
}

function stemMaterial(): THREE.Material {
  return propMaterial('stem', () => standard({ color: '#4f9a3c', roughness: 0.8, metalness: 0.02 }));
}

function petalCoralMaterial(): THREE.Material {
  return propMaterial('petal-coral', () => standard({ color: '#ff8f6b', roughness: 0.62, metalness: 0.03 }));
}

function flowerCenterMaterial(): THREE.Material {
  return propMaterial('flower-center', () => standard({ color: '#ffd447', roughness: 0.55, metalness: 0.04 }));
}

function crystalPinkMaterial(): THREE.Material {
  return propMaterial(
    'crystal-pink',
    () => standard({ color: '#ff87b5', roughness: 0.24, metalness: 0.06, flatShading: true }),
  );
}

function crystalMintMaterial(): THREE.Material {
  return propMaterial(
    'crystal-mint',
    () => standard({ color: '#6fe0c2', roughness: 0.24, metalness: 0.06, flatShading: true }),
  );
}

function rockMaterial(): THREE.Material {
  return propMaterial(
    'rock',
    () => standard({ color: '#b6a291', roughness: 0.9, metalness: 0.02, flatShading: true }),
  );
}

function barkMaterial(): THREE.Material {
  return propMaterial('bark', () => standard({ color: '#a9764f', roughness: 0.88, metalness: 0.02 }));
}

function leafMaterial(): THREE.Material {
  return propMaterial('leaf', () => standard({ color: '#6fc05a', roughness: 0.72, metalness: 0.02 }));
}

function leafLightMaterial(): THREE.Material {
  return propMaterial('leaf-light', () => standard({ color: '#92d473', roughness: 0.68, metalness: 0.02 }));
}

function cloudMaterial(): THREE.Material {
  return propMaterial('cloud', () => standard({ color: '#fdfcf6', roughness: 1, metalness: 0 }));
}

function hillFarMaterial(): THREE.Material {
  return propMaterial('hill-far', () => standard({ color: '#cfe3cf', roughness: 0.95, metalness: 0.01 }));
}

function sunMaterial(): THREE.Material {
  return propMaterial('sun', () => new THREE.MeshBasicMaterial({ color: '#ffe6a2' }));
}

function sunGlowMaterial(): THREE.Material {
  return propMaterial(
    'sun-glow',
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff3c8',
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
  );
}

function instanceMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  scratch: THREE.Matrix4,
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  scale: THREE.Vector3,
): void {
  scratch.compose(position, rotation, scale);
  mesh.setMatrixAt(index, scratch);
}

function createGrassTuft(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const count = 5 + Math.floor(rng() * 4);
  const blades = new THREE.InstancedMesh(cachedGeometry('blade', bladeGeometry), grassMaterial(), count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) - 0.5 : 0;
    const lean = -t * 0.6 + (rng() - 0.5) * 0.3;
    const height = 0.5 + rng() * 0.45;
    position.set(t * (0.5 + rng() * 0.2), 0, (rng() - 0.5) * 0.16);
    euler.set(0, rng() * Math.PI, lean);
    rotation.setFromEuler(euler);
    scale.set(0.85 + rng() * 0.4, height, 0.85 + rng() * 0.4);
    instanceMatrix(blades, i, matrix, position, rotation, scale);
  }
  blades.instanceMatrix.needsUpdate = true;
  blades.castShadow = true;
  group.add(blades);

  const mound = new THREE.Mesh(cachedGeometry('blob-mid', blobMidGeometry), grassDarkMaterial());
  mound.scale.set(0.46, 0.16, 0.46);
  mound.position.y = 0.02;
  mound.receiveShadow = true;
  group.add(mound);
  return group;
}

function createFlower(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const stemHeight = 0.5 + rng() * 0.35;

  const stem = new THREE.Mesh(cachedGeometry('cylinder', cylinderGeometry), stemMaterial());
  stem.scale.set(0.06, stemHeight, 0.06);
  stem.castShadow = true;
  group.add(stem);

  const petalCount = 5;
  const petals = new THREE.InstancedMesh(cachedGeometry('petal', petalGeometry), petalCoralMaterial(), petalCount);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(0, stemHeight, 0);
  const spin = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const axisZ = new THREE.Vector3(0, 0, 1);
  const axisX = new THREE.Vector3(1, 0, 0);
  const scale = new THREE.Vector3(0.9, 0.9, 0.9);
  for (let i = 0; i < petalCount; i += 1) {
    const theta = (i / petalCount) * Math.PI * 2;
    spin.setFromAxisAngle(axisZ, theta);
    tilt.setFromAxisAngle(axisX, 0.5);
    spin.multiply(tilt);
    instanceMatrix(petals, i, matrix, position, spin, scale);
  }
  petals.instanceMatrix.needsUpdate = true;
  petals.castShadow = true;
  group.add(petals);

  const center = new THREE.Mesh(cachedGeometry('blob-mid', blobMidGeometry), flowerCenterMaterial());
  center.scale.setScalar(0.08);
  center.position.set(0, stemHeight + 0.07, 0);
  group.add(center);

  const leaf = new THREE.Mesh(cachedGeometry('petal', petalGeometry), leafMaterial());
  leaf.scale.set(0.7, 0.7, 0.7);
  leaf.position.set(0.03, stemHeight * 0.4, 0);
  leaf.rotation.set(0.9, 0.4, Math.PI / 2.4);
  group.add(leaf);
  return group;
}

function createCandyCrystal(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const geometry = cachedGeometry('crystal', crystalGeometry);
  const tallCount = 2 + Math.floor(rng() * 2);
  const shortCount = 1 + Math.floor(rng() * 2);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();

  const tall = new THREE.InstancedMesh(geometry, crystalMintMaterial(), tallCount);
  for (let i = 0; i < tallCount; i += 1) {
    const height = 1.2 + rng() * 0.9;
    position.set((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5);
    euler.set((rng() - 0.5) * 0.25, rng() * Math.PI, (rng() - 0.5) * 0.25);
    rotation.setFromEuler(euler);
    scale.set(0.5 + rng() * 0.3, height, 0.5 + rng() * 0.3);
    instanceMatrix(tall, i, matrix, position, rotation, scale);
  }
  tall.instanceMatrix.needsUpdate = true;
  tall.castShadow = true;
  group.add(tall);

  const short = new THREE.InstancedMesh(geometry, crystalPinkMaterial(), shortCount);
  for (let i = 0; i < shortCount; i += 1) {
    const height = 0.7 + rng() * 0.5;
    position.set((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7);
    euler.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
    rotation.setFromEuler(euler);
    scale.set(0.4 + rng() * 0.25, height, 0.4 + rng() * 0.25);
    instanceMatrix(short, i, matrix, position, rotation, scale);
  }
  short.instanceMatrix.needsUpdate = true;
  short.castShadow = true;
  group.add(short);
  return group;
}

function createRock(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const count = 2 + Math.floor(rng() * 2);
  const rocks = new THREE.InstancedMesh(cachedGeometry('blob-low', blobLowGeometry), rockMaterial(), count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const sx = 0.34 + rng() * 0.36;
    const sy = 0.3 + rng() * 0.3;
    const sz = 0.34 + rng() * 0.36;
    position.set((rng() - 0.5) * 0.6, sy * 0.9, (rng() - 0.5) * 0.6);
    euler.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rotation.setFromEuler(euler);
    scale.set(sx, sy, sz);
    instanceMatrix(rocks, i, matrix, position, rotation, scale);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  return group;
}

function createTree(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const trunkHeight = 0.8 + rng() * 0.3;

  const trunk = new THREE.Mesh(cachedGeometry('cylinder', cylinderGeometry), barkMaterial());
  trunk.scale.set(0.28, trunkHeight, 0.28);
  trunk.castShadow = true;
  group.add(trunk);

  const canopyCount = 5;
  const canopy = new THREE.InstancedMesh(cachedGeometry('blob-mid', blobMidGeometry), leafMaterial(), canopyCount);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const crownY = trunkHeight + 0.28;
  for (let i = 0; i < canopyCount; i += 1) {
    const angle = (i / canopyCount) * Math.PI * 2;
    const radius = i === 0 ? 0 : 0.4 + rng() * 0.14;
    position.set(Math.cos(angle) * radius, crownY + (rng() - 0.5) * 0.28 + (i === 0 ? 0.14 : 0), Math.sin(angle) * radius);
    euler.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rotation.setFromEuler(euler);
    const size = i === 0 ? 0.58 : 0.42 + rng() * 0.16;
    scale.set(size, size * 0.9, size);
    instanceMatrix(canopy, i, matrix, position, rotation, scale);
  }
  canopy.instanceMatrix.needsUpdate = true;
  canopy.castShadow = true;
  group.add(canopy);

  const highlightCount = 3;
  const highlights = new THREE.InstancedMesh(
    cachedGeometry('blob-mid', blobMidGeometry),
    leafLightMaterial(),
    highlightCount,
  );
  for (let i = 0; i < highlightCount; i += 1) {
    position.set((rng() - 0.5) * 0.45, crownY + 0.26 + rng() * 0.2, (rng() - 0.5) * 0.45);
    euler.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rotation.setFromEuler(euler);
    const size = 0.2 + rng() * 0.1;
    scale.set(size, size, size);
    instanceMatrix(highlights, i, matrix, position, rotation, scale);
  }
  highlights.instanceMatrix.needsUpdate = true;
  group.add(highlights);
  return group;
}

function createCloud(rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const count = 5 + Math.floor(rng() * 3);
  const puffs = new THREE.InstancedMesh(cachedGeometry('blob-mid', blobMidGeometry), cloudMaterial(), count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const x = -0.75 + t * 1.5;
    const arc = 1 - Math.abs(t - 0.5) * 2;
    position.set(x, 0.35 + arc * 0.32 + (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.3);
    euler.set(0, rng() * Math.PI, 0);
    rotation.setFromEuler(euler);
    const size = 0.34 + arc * 0.22 + rng() * 0.08;
    scale.set(size, size * 0.85, size);
    instanceMatrix(puffs, i, matrix, position, rotation, scale);
  }
  puffs.instanceMatrix.needsUpdate = true;
  group.add(puffs);
  return group;
}

export function getTheme(themeIndex: number): ThemeMaterials {
  const normalized = ((Math.trunc(themeIndex) % THEME_SPECS.length) + THEME_SPECS.length) % THEME_SPECS.length;
  const cached = themeCache.get(normalized);
  if (cached) {
    return cached;
  }
  const spec = THEME_SPECS[normalized];
  const theme: ThemeMaterials = {
    platformTop: standard({ color: spec.top, roughness: 0.86, metalness: 0.02 }),
    platformSide: standard({ color: spec.side, roughness: 0.9, metalness: 0.02 }),
    accent: standard({ color: spec.accent, roughness: 0.5, metalness: 0.08 }),
    skyTop: new THREE.Color(spec.skyTop),
    skyBottom: new THREE.Color(spec.skyBottom),
    fogColor: new THREE.Color(spec.fog),
    sunColor: new THREE.Color(spec.sun),
    ambientColor: new THREE.Color(spec.ambient),
  };
  themeCache.set(normalized, theme);
  return theme;
}

export function createProp(kind: PropKind, rng: () => number): THREE.Group {
  switch (kind) {
    case 'grass-tuft':
      return createGrassTuft(rng);
    case 'flower':
      return createFlower(rng);
    case 'candy-crystal':
      return createCandyCrystal(rng);
    case 'rock':
      return createRock(rng);
    case 'tree':
      return createTree(rng);
    case 'cloud':
      return createCloud(rng);
    default:
      return new THREE.Group();
  }
}

export function createBackdrop(themeIndex: number, rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const theme = getTheme(themeIndex);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const hill = cachedGeometry('hill', hillGeometry);

  const farCount = 9;
  const far = new THREE.InstancedMesh(hill, hillFarMaterial(), farCount);
  for (let i = 0; i < farCount; i += 1) {
    const t = farCount > 1 ? i / (farCount - 1) : 0.5;
    position.set(-26 + t * 52 + (rng() - 0.5) * 1.5, -1.6 - rng() * 0.4, -15 - rng() * 2);
    rotation.setFromEuler(new THREE.Euler(0, (rng() - 0.5) * 0.4, 0));
    scale.set(4 + rng() * 1.8, 2.6 + rng() * 1.6, 1);
    instanceMatrix(far, i, matrix, position, rotation, scale);
  }
  far.instanceMatrix.needsUpdate = true;
  group.add(far);

  const nearCount = 7;
  const near = new THREE.InstancedMesh(hill, theme.accent, nearCount);
  for (let i = 0; i < nearCount; i += 1) {
    const t = nearCount > 1 ? i / (nearCount - 1) : 0.5;
    position.set(-23 + t * 46 + (rng() - 0.5) * 2, -1.0 - rng() * 0.3, -9 - rng() * 1.5);
    rotation.setFromEuler(new THREE.Euler(0, (rng() - 0.5) * 0.5, 0));
    scale.set(3.6 + rng() * 1.6, 2.8 + rng() * 1.8, 1);
    instanceMatrix(near, i, matrix, position, rotation, scale);
  }
  near.instanceMatrix.needsUpdate = true;
  group.add(near);

  const cloudCount = 8;
  const clouds = new THREE.InstancedMesh(cachedGeometry('blob-mid', blobMidGeometry), cloudMaterial(), cloudCount);
  for (let i = 0; i < cloudCount; i += 1) {
    const t = i / (cloudCount - 1);
    position.set(-26 + t * 52 + (rng() - 0.5) * 3, 3.6 + rng() * 2.6, -18 - rng() * 5);
    rotation.setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0));
    const size = 0.9 + rng() * 0.9;
    scale.set(size, size * 0.72, size);
    instanceMatrix(clouds, i, matrix, position, rotation, scale);
  }
  clouds.instanceMatrix.needsUpdate = true;
  group.add(clouds);

  const sun = new THREE.Mesh(cachedGeometry('sun', sunGeometry), sunMaterial());
  sun.position.set(15, 6.5, -34);
  sun.scale.setScalar(2.4);
  group.add(sun);

  const glow = new THREE.Mesh(cachedGeometry('sun', sunGeometry), sunGlowMaterial());
  glow.position.copy(sun.position);
  glow.position.z -= 0.5;
  glow.scale.setScalar(4.2);
  group.add(glow);

  return group;
}

export function createPlatformBlock(themeIndex: number, width: number, height: number, depth: number): THREE.Group {
  const theme = getTheme(themeIndex);
  const group = new THREE.Group();
  const block = cachedGeometry('block', blockGeometry);
  const capHeight = Math.min(0.26, Math.max(0.08, height * 0.3));
  // The rounded block carries a bevel, so scale it down to land on the requested extents.
  const fit = 1 / 1.08;

  // Stack the pieces so no two faces are coplanar: a shared plane makes the top z-fight into a
  // speckled patch instead of a clean cap.
  const bodyHeight = Math.max(0.05, height - capHeight);
  const body = new THREE.Mesh(block, theme.platformSide);
  body.scale.set(width * fit, bodyHeight * fit, depth * fit);
  body.position.y = -height / 2 + bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(block, theme.platformTop);
  cap.scale.set(width * 1.01 * fit, capHeight * fit, depth * 1.01 * fit);
  // Sit the cap on top of the body rather than overlapping it.
  cap.position.y = height / 2 - capHeight / 2 + 0.002;
  cap.castShadow = true;
  group.add(cap);

  const trimThickness = Math.min(0.05, capHeight * 0.3);
  const trim = new THREE.Mesh(block, theme.accent);
  trim.scale.set(width * 1.005 * fit, trimThickness * fit, depth * 1.005 * fit);
  trim.position.y = height / 2 - capHeight - trimThickness / 2 - 0.002;
  group.add(trim);

  const studCount = width >= 3 ? 3 : width >= 1.6 ? 2 : 1;
  if (height >= 0.7) {
    const studs = new THREE.InstancedMesh(
      cachedGeometry('blob-low', blobLowGeometry),
      theme.accent,
      studCount,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const step = width / (studCount + 1);
    for (let i = 0; i < studCount; i += 1) {
      position.set(-width / 2 + step * (i + 1), 0, depth / 2 + 0.01);
      const size = Math.min(0.12, height * 0.22);
      scale.set(size, size, size);
      instanceMatrix(studs, i, matrix, position, rotation, scale);
    }
    studs.instanceMatrix.needsUpdate = true;
    group.add(studs);
  }
  return group;
}

export function disposePropKit(): void {
  for (const geometry of geometryCache.values()) {
    geometry.dispose();
  }
  geometryCache.clear();

  for (const material of materialCache.values()) {
    material.dispose();
  }
  materialCache.clear();

  for (const theme of themeCache.values()) {
    theme.platformTop.dispose();
    theme.platformSide.dispose();
    theme.accent.dispose();
  }
  themeCache.clear();
}
