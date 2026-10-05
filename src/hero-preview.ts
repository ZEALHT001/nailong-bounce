/**
 * Standalone hero-model preview used to author and review the 奶蛙 mesh.
 *
 * Not part of the shipped game. Open /hero.html?view=front|three-quarter|side|back|top and
 * optionally &state=charge|launch|fall|land|hurt|celebrate to inspect a pose.
 */
import * as THREE from 'three';
import { NailongModel, type NailongState } from './entities/NailongModel';

const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas');
if (!canvas) throw new Error('missing preview canvas');

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'three-quarter';
const state = (params.get('state') ?? 'idle') as NailongState;
const charge = Number(params.get('charge') ?? (state === 'charge' ? 0.85 : 0));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8e4d8');

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);

scene.add(new THREE.HemisphereLight('#ffffff', '#6b6a5c', 2.1));
const key = new THREE.DirectionalLight('#fff6dd', 2.7);
key.position.set(3, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
scene.add(key);
const fill = new THREE.DirectionalLight('#cfe6ff', 0.9);
fill.position.set(-4, 2, -3);
scene.add(fill);

// A faint ground disc gives contact and scale without dominating the silhouette.
const disc = new THREE.Mesh(
  new THREE.CircleGeometry(2.4, 48),
  new THREE.MeshStandardMaterial({ color: '#cfcaba', roughness: 0.95 }),
);
disc.rotation.x = -Math.PI / 2;
disc.receiveShadow = true;
scene.add(disc);

const model = new NailongModel();
scene.add(model.group);
model.setState(state);
model.setCharge(charge);
if (state === 'fall') model.setVerticalSpeed(-12);

// Step the procedural animation so the captured pose is a real animation frame.
for (let i = 0; i < 12; i += 1) model.update(1 / 60, i / 60);

const angles: Record<string, number> = {
  front: Math.PI / 2,
  'three-quarter': Math.PI / 2 - 0.6,
  side: 0,
  back: -Math.PI / 2,
  top: Math.PI / 2,
};

const yaw = angles[view] ?? angles['three-quarter'];
const elevation = view === 'top' ? 1.05 : 0.18;
const radius = 4.1;
camera.position.set(
  Math.cos(yaw) * Math.cos(elevation) * radius,
  0.75 + Math.sin(elevation) * radius,
  Math.sin(yaw) * Math.cos(elevation) * radius,
);
camera.lookAt(0, 0.8, 0);

function resize(): void {
  const width = canvas!.clientWidth;
  const height = canvas!.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

resize();
window.addEventListener('resize', resize);
renderer.render(scene, camera);

window.__HERO_PREVIEW__ = { view, state, ready: true };
