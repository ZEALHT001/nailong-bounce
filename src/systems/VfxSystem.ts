import * as THREE from 'three';

type Particle = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  spin: number;
  angle: number;
};

/**
 * Pooled burst particles.
 *
 * One InstancedMesh and one material for every burst in the game keeps this to a single draw
 * call. Particles are recycled from a fixed pool, so gameplay never allocates.
 */
export class VfxSystem {
  readonly group = new THREE.Group();

  private readonly maxParticles = 220;
  private readonly particles: Particle[] = [];
  private readonly geometry = new THREE.IcosahedronGeometry(0.12, 0);
  private readonly material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private cursor = 0;
  private readonly palette: number[];

  constructor(
    palette: number[],
    private readonly rng: () => number,
  ) {
    this.palette = palette;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxParticles);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    for (let i = 0; i < this.maxParticles; i += 1) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: 0xffffff,
        spin: 0,
        angle: 0,
      });
      this.writeInstance(i, 0, 0, 0, 0, 0);
    }
    this.mesh.count = this.maxParticles;
  }

  /**
   * @param power 0..1 scales count, speed and size so a soft landing never reads like a death.
   */
  burst(x: number, y: number, power: number, kind: 'ground' | 'bounce' | 'collect' | 'pop'): void {
    const clamped = Math.min(Math.max(power, 0), 1);
    const count = Math.round(4 + clamped * 14);
    const baseSpeed = kind === 'collect' ? 3.4 : kind === 'pop' ? 6 : 2.6 + clamped * 3.4;

    for (let i = 0; i < count; i += 1) {
      const index = this.cursor;
      const particle = this.particles[index];
      this.cursor = (this.cursor + 1) % this.maxParticles;

      const angle = (i / count) * Math.PI * 2 + this.rng() * 0.5;
      const spread = kind === 'bounce' ? 0.55 : 1;
      const speed = baseSpeed * (0.55 + this.rng() * 0.7);

      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.z = (this.rng() - 0.5) * 1.2;
      particle.vx = Math.cos(angle) * speed * spread;
      particle.vy = kind === 'collect' ? Math.abs(Math.sin(angle)) * speed + 1.4 : Math.abs(Math.sin(angle)) * speed;
      particle.vz = (this.rng() - 0.5) * speed * 0.4;
      particle.maxLife = kind === 'collect' ? 0.42 : 0.3 + this.rng() * 0.34;
      particle.life = particle.maxLife;
      particle.size = (kind === 'pop' ? 0.9 : 0.55) * (0.6 + this.rng() * 0.8) * (0.8 + clamped * 0.5);
      particle.color = this.palette[Math.floor(this.rng() * this.palette.length)];
      particle.spin = (this.rng() - 0.5) * 12;
      particle.angle = this.rng() * Math.PI;
      this.mesh.setColorAt(index, this.color.setHex(particle.color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(delta: number): void {
    let dirty = false;
    for (let i = 0; i < this.maxParticles; i += 1) {
      const particle = this.particles[i];
      if (!particle.active) continue;
      dirty = true;

      particle.life -= delta;
      if (particle.life <= 0) {
        particle.active = false;
        this.writeInstance(i, 0, 0, 0, 0, 0);
        continue;
      }

      particle.vy -= 26 * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.z += particle.vz * delta;
      particle.angle += particle.spin * delta;
      if (particle.y < 0) {
        particle.y = 0;
        particle.vy *= -0.3;
        particle.vx *= 0.7;
      }

      const t = particle.life / particle.maxLife;
      this.writeInstance(i, particle.x, particle.y, particle.z, particle.size * t, particle.angle);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (let i = 0; i < this.maxParticles; i += 1) {
      this.particles[i].active = false;
      this.writeInstance(i, 0, 0, 0, 0, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private writeInstance(index: number, x: number, y: number, z: number, size: number, angle: number): void {
    this.position.set(x, y, z);
    this.euler.set(angle, angle * 0.7, angle * 0.4);
    this.quaternion.setFromEuler(this.euler);
    this.scale.setScalar(Math.max(size, 0.0001));
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }
}
