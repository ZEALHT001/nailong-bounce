import * as THREE from 'three';
import type { HazardSpec, LevelSpec, PlatformSpec } from '../game/levels';
import { levelExtent } from '../game/levels';
import {
  createProp,
  createPlatformBlock,
  createBackdrop,
  disposePropKit,
  type PropKind,
} from '../world/PropKit';
import { colliderFromBox, type Collider } from './PlatformerPhysics';

type Mover = {
  platform: PlatformSpec;
  baseX: number;
  baseY: number;
  group: THREE.Group;
  collider: Collider;
  time: number;
  previousX: number;
  previousY: number;
};

type Hazard = {
  spec: HazardSpec;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  group: THREE.Group;
  surface?: THREE.Mesh;
};

export type Treat = {
  x: number;
  y: number;
  collected: boolean;
  group: THREE.Group;
  spin: number;
};

export class LevelWorld {
  readonly root = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly treats: Treat[] = [];

  /** Platform colliders in authored order, so index maps 1:1 onto the level's platform list. */
  private readonly platformColliders: Collider[] = [];
  private readonly movers: Mover[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly pads: Array<{ group: THREE.Group; top: THREE.Mesh; glow: THREE.Mesh; pulse: number }> = [];
  private readonly goal = new THREE.Group();
  private readonly goalPosition = new THREE.Vector2();
  private goalRadius = 1.5;
  /** Resources this class created itself, safe to dispose individually. */
  private readonly ownedResources: Array<{ dispose(): void }> = [];
  /** Objects built by PropKit, which shares module-level caches; remove only, never dispose. */
  private readonly sharedObjects: THREE.Object3D[] = [];
  private nextId = 1;

  constructor(
    private readonly level: LevelSpec,
    private readonly rng: () => number,
  ) {
    const backdrop = createBackdrop(level.theme, this.rng);
    // The backdrop is scenery far behind the play plane; its shadows only smear across the
    // platform tops as unreadable stains.
    backdrop.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });
    this.root.add(backdrop);
    this.sharedObjects.push(backdrop);
    this.buildValleyFloor();
    this.buildPlatforms();
    this.buildPads();
    this.buildHazards();
    this.buildTreats();
    this.buildGoal();
    this.buildScenery();
  }

  update(delta: number, elapsed: number): void {
    for (const hazard of this.hazards) {
      if (hazard.spec.kind === 'water' && hazard.surface) {
        hazard.surface.position.y = hazard.spec.y + hazard.spec.h - 0.04 + Math.sin(elapsed * 1.8 + hazard.spec.x) * 0.045;
      }
    }

    for (const treat of this.treats) {
      if (treat.collected) continue;
      treat.group.rotation.y = treat.spin + elapsed * 1.5;
      treat.group.position.y = treat.y + Math.sin(elapsed * 2.4 + treat.x) * 0.14;
    }

    for (const pad of this.pads) {
      pad.pulse = Math.max(0, pad.pulse - delta * 3.4);
      const squash = 1 - pad.pulse * 0.5;
      pad.top.scale.set(1 + pad.pulse * 0.18, squash, 1 + pad.pulse * 0.18);
      pad.glow.scale.setScalar(1 + Math.sin(elapsed * 3.2) * 0.06 + pad.pulse * 0.9);
      (pad.glow.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(elapsed * 3.2) * 0.06 + pad.pulse * 0.6;
    }

    this.goal.rotation.y = Math.sin(elapsed * 0.8) * 0.08;
  }

  /**
   * Advances moving platforms by exactly one fixed physics step.
   *
   * This has to run inside the fixed-step loop, not once per rendered frame. A rendered frame
   * runs several 1/120 s physics substeps, and a rider on a platform inherits the collider's
   * per-step delta: computing that delta once per frame made riders move 2-8x the platform's
   * real motion, so they repeatedly fell off and were snapped back, which read in play as the
   * frog being bounced off the platform it had just landed on.
   */
  advanceMovers(dt: number): void {
    for (const mover of this.movers) {
      mover.time += dt;
      const { axis, range, speed, phase = 0 } = mover.platform.move!;
      const offset = Math.sin(mover.time * speed + phase) * range;
      const x = mover.baseX + (axis === 'x' ? offset : 0);
      const y = mover.baseY + (axis === 'y' ? offset : 0);

      // Riders inherit exactly this movement, so it must be the movement of this single step.
      mover.collider.deltaX = x - mover.previousX;
      mover.collider.deltaY = y - mover.previousY;
      mover.previousX = x;
      mover.previousY = y;

      mover.group.position.set(x, y - mover.platform.h / 2, 0);
      const halfW = mover.platform.w / 2;
      mover.collider.minX = x - halfW;
      mover.collider.maxX = x + halfW;
      mover.collider.minY = y - mover.platform.h;
      mover.collider.maxY = y;
    }
  }

  pulsePadAt(x: number, y: number): void {
    let best: (typeof this.pads)[number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const pad of this.pads) {
      const dx = pad.group.position.x - x;
      const dy = pad.group.position.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pad;
      }
    }
    if (best) best.pulse = 1;
  }

  /** Returns the number of treats collected by this body box. */
  collectTreats(minX: number, minY: number, maxX: number, maxY: number): number {
    let collected = 0;
    for (const treat of this.treats) {
      if (treat.collected) continue;
      const radius = 0.42;
      if (
        treat.x + radius > minX &&
        treat.x - radius < maxX &&
        treat.y + radius > minY &&
        treat.y - radius < maxY
      ) {
        treat.collected = true;
        treat.group.visible = false;
        collected += 1;
      }
    }
    return collected;
  }

  hazardAt(minX: number, minY: number, maxX: number, maxY: number): HazardSpec | null {
    for (const hazard of this.hazards) {
      const box = hazard.box;
      // Shrink the spike box so grazing the very edge reads as a near miss, not a death.
      const pad = hazard.spec.kind === 'spike' ? 0.12 : 0;
      if (
        minX < box.maxX - pad &&
        maxX > box.minX + pad &&
        minY < box.maxY - pad * 0.35 &&
        maxY > box.minY + pad * 0.5
      ) {
        return hazard.spec;
      }
    }
    return null;
  }

  reachedGoal(minX: number, minY: number, maxX: number, maxY: number): boolean {
    const dx = Math.max(minX - this.goalPosition.x, 0, this.goalPosition.x - maxX);
    const dy = Math.max(minY - this.goalPosition.y, 0, this.goalPosition.y - maxY);
    return dx * dx + dy * dy < this.goalRadius * this.goalRadius;
  }

  get goalX(): number {
    return this.goalPosition.x;
  }

  get goalY(): number {
    return this.goalPosition.y;
  }

  /**
   * Live platform rectangles. Moving platforms report where they are right now, which is what a
   * player reads off the screen; authored coordinates would be wrong by the mover's travel.
   */
  platformRects(): Array<{ index: number; minX: number; maxX: number; minY: number; maxY: number }> {
    return this.platformColliders.map((collider, index) => ({
      index,
      minX: collider.minX,
      maxX: collider.maxX,
      minY: collider.minY,
      maxY: collider.maxY,
    }));
  }

  reset(): void {
    for (const mover of this.movers) {
      mover.time = 0;
      const { axis, range, phase = 0 } = mover.platform.move!;
      const offset = Math.sin(phase) * range;
      const x = mover.baseX + (axis === 'x' ? offset : 0);
      const y = mover.baseY + (axis === 'y' ? offset : 0);
      mover.group.position.set(x, y - mover.platform.h / 2, 0);
      mover.previousX = x;
      mover.previousY = y;
      mover.collider.deltaX = 0;
      mover.collider.deltaY = 0;
      const halfW = mover.platform.w / 2;
      mover.collider.minX = x - halfW;
      mover.collider.maxX = x + halfW;
      mover.collider.minY = y - mover.platform.h;
      mover.collider.maxY = y;
    }
    for (const treat of this.treats) {
      treat.collected = false;
      treat.group.visible = true;
      treat.group.position.y = treat.y;
    }
    for (const pad of this.pads) pad.pulse = 0;
  }

  dispose(): void {
    for (const object of this.sharedObjects) {
      object.removeFromParent();
    }
    for (const resource of this.ownedResources) resource.dispose();
    this.sharedObjects.length = 0;
    this.ownedResources.length = 0;
    disposePropKit();
  }

  private buildPlatforms(): void {
    for (const platform of this.level.platforms) {
      const group = createPlatformBlock(this.level.theme, platform.w, platform.h, 2.4);
      group.position.set(platform.x, platform.y - platform.h / 2, 0);
      this.root.add(group);
      this.sharedObjects.push(group);

      const collider = colliderFromBox(
        this.nextId++,
        'solid',
        platform.x - platform.w / 2,
        platform.y - platform.h,
        platform.x + platform.w / 2,
        platform.y,
      );
      this.colliders.push(collider);
      this.platformColliders.push(collider);

      if (platform.move) {
        this.movers.push({
          platform,
          baseX: platform.x,
          baseY: platform.y,
          group,
          collider,
          time: 0,
          previousX: platform.x,
          previousY: platform.y,
        });
      }
    }
  }

  /**
   * A wide ground plane under the play area. Without it the space below the platforms reads as
   * empty fog, and the hazards in the gaps look like they are floating in nothing.
   */
  private buildValleyFloor(): void {
    const extent = levelExtent(this.level);
    const width = extent.max - extent.min;
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: '#6f9c56',
      roughness: 0.92,
      metalness: 0,
    });
    // Over-sized on purpose: the floor has to fill the frame behind and below every gap.
    const floorGeometry = new THREE.PlaneGeometry(width + 90, 70, 1, 1);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((extent.min + extent.max) / 2, -3.1, 0);
    floor.receiveShadow = false;
    this.ownedResources.push(floorMaterial, floorGeometry);
    this.root.add(floor);
  }

  private buildPads(): void {
    const padMaterial = new THREE.MeshStandardMaterial({
      color: '#5ad07a',
      roughness: 0.42,
      metalness: 0.05,
      emissive: '#1c6b33',
      emissiveIntensity: 0.5,
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: '#2f8f4c',
      roughness: 0.55,
      metalness: 0.08,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: '#c8ffe0',
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const topGeometry = new THREE.CylinderGeometry(0.78, 0.86, 0.26, 28);
    const rimGeometry = new THREE.TorusGeometry(0.82, 0.075, 10, 28);
    const stemGeometry = new THREE.CylinderGeometry(0.2, 0.32, 0.5, 16);
    const glowGeometry = new THREE.TorusGeometry(0.95, 0.05, 8, 32);

    for (const material of [padMaterial, rimMaterial, glowMaterial]) this.ownedResources.push(material);
    for (const geometry of [topGeometry, rimGeometry, stemGeometry, glowGeometry]) this.ownedResources.push(geometry);

    for (const pad of this.level.pads) {
      const group = new THREE.Group();
      group.position.set(pad.x, pad.y, 0);

      const stem = new THREE.Mesh(stemGeometry, rimMaterial);
      stem.position.y = -0.36;
      stem.castShadow = true;
      group.add(stem);

      const top = new THREE.Mesh(topGeometry, padMaterial);
      top.position.y = -0.13;
      top.castShadow = true;
      top.receiveShadow = true;
      top.name = 'padTop';
      group.add(top);

      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.02;
      group.add(rim);

      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.rotation.x = Math.PI / 2;
      glow.position.y = -0.02;
      group.add(glow);

      this.root.add(group);
      this.pads.push({ group, top, glow, pulse: 0 });
    }
  }

  /**
   * Pads are trigger volumes, not colliders. A solid pad would block the frog from the side and
   * force a step-up; a trigger lets it walk or land onto the pad and get launched.
   */
  padTriggerAt(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): { x: number; y: number; index: number } | null {
    for (let index = 0; index < this.level.pads.length; index += 1) {
      const pad = this.level.pads[index];
      if (
        minX < pad.x + 0.95 &&
        maxX > pad.x - 0.95 &&
        minY < pad.y + 0.2 &&
        maxY > pad.y - 0.5
      ) {
        return { x: pad.x, y: pad.y, index };
      }
    }
    return null;
  }

  private buildHazards(): void {
    const spikeMaterial = new THREE.MeshStandardMaterial({
      color: '#e5624f',
      roughness: 0.4,
      metalness: 0.15,
    });
    const spikeBaseMaterial = new THREE.MeshStandardMaterial({
      color: '#7d3a34',
      roughness: 0.75,
      metalness: 0.05,
    });
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: '#3f9fd6',
      roughness: 0.18,
      metalness: 0.12,
      transparent: true,
      opacity: 0.82,
    });
    const waterSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: '#9fe0ff',
      roughness: 0.12,
      metalness: 0.2,
      transparent: true,
      opacity: 0.7,
    });
    for (const material of [spikeMaterial, spikeBaseMaterial, waterMaterial, waterSurfaceMaterial]) {
      this.ownedResources.push(material);
    }

    for (const hazard of this.level.hazards) {
      const group = new THREE.Group();
      group.position.set(hazard.x, hazard.y, 0);
      const box = {
        minX: hazard.x - hazard.w / 2,
        minY: hazard.y,
        maxX: hazard.x + hazard.w / 2,
        maxY: hazard.y + hazard.h,
      };

      if (hazard.kind === 'spike') {
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(hazard.w, hazard.h * 0.4, 2.6),
          spikeBaseMaterial,
        );
        base.position.y = hazard.h * 0.2;
        base.receiveShadow = true;
        group.add(base);
        this.ownedResources.push(base.geometry);

        const count = Math.max(2, Math.round(hazard.w / 0.5));
        const spikeGeometry = new THREE.ConeGeometry(0.24, hazard.h * 0.86, 6);
        this.ownedResources.push(spikeGeometry);
        const spikes = new THREE.InstancedMesh(spikeGeometry, spikeMaterial, count);
        spikes.castShadow = true;
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < count; i += 1) {
          const t = (i + 0.5) / count;
          matrix.makeTranslation(-hazard.w / 2 + t * hazard.w, hazard.h * 0.6, 0);
          spikes.setMatrixAt(i, matrix);
        }
        spikes.instanceMatrix.needsUpdate = true;
        group.add(spikes);
        this.hazards.push({ spec: hazard, box, group });
      } else {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(hazard.w, hazard.h, 3.4),
          waterMaterial,
        );
        body.position.y = hazard.h / 2;
        group.add(body);
        this.ownedResources.push(body.geometry);

        const surface = new THREE.Mesh(
          new THREE.PlaneGeometry(hazard.w, 3.4, 12, 2),
          waterSurfaceMaterial,
        );
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = hazard.h - 0.04;
        group.add(surface);
        this.ownedResources.push(surface.geometry);
        this.hazards.push({ spec: hazard, box, group, surface });
      }

      this.root.add(group);
    }
  }

  private buildTreats(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: '#ff9d5c',
      roughness: 0.35,
      metalness: 0.12,
      emissive: '#7a3512',
      emissiveIntensity: 0.32,
    });
    const tailMaterial = new THREE.MeshStandardMaterial({
      color: '#ffd07a',
      roughness: 0.4,
      metalness: 0.1,
      emissive: '#7a5212',
      emissiveIntensity: 0.3,
    });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#26200f' });
    const bodyGeometry = new THREE.SphereGeometry(0.24, 16, 12);
    const tailGeometry = new THREE.ConeGeometry(0.2, 0.28, 4);
    const eyeGeometry = new THREE.SphereGeometry(0.045, 8, 6);
    const ringGeometry = new THREE.TorusGeometry(0.4, 0.028, 8, 24);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe9b0',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    for (const item of [bodyMaterial, tailMaterial, eyeMaterial, ringMaterial, bodyGeometry, tailGeometry, eyeGeometry, ringGeometry]) {
      this.ownedResources.push(item);
    }

    for (const treat of this.level.treats) {
      const group = new THREE.Group();
      group.position.set(treat.x, treat.y, 0);

      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.scale.set(1.25, 0.86, 0.86);
      body.castShadow = true;
      group.add(body);

      const tail = new THREE.Mesh(tailGeometry, tailMaterial);
      tail.position.x = -0.32;
      tail.rotation.z = Math.PI / 2;
      group.add(tail);

      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(0.2, 0.08, 0.12);
      group.add(eye);

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);

      this.root.add(group);
      this.treats.push({ x: treat.x, y: treat.y, collected: false, group, spin: 0 });
    }
  }

  private buildGoal(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: '#f4f1e4',
      roughness: 0.45,
      metalness: 0.2,
    });
    const flagMaterial = new THREE.MeshStandardMaterial({
      color: '#ef6a5a',
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const poleGeometry = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 10);
    const flagGeometry = new THREE.PlaneGeometry(1.1, 0.72, 8, 4);
    const baseGeometry = new THREE.CylinderGeometry(0.46, 0.6, 0.24, 18);
    const haloGeometry = new THREE.TorusGeometry(1.15, 0.06, 8, 36);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe3a3',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    for (const item of [poleMaterial, flagMaterial, haloMaterial, poleGeometry, flagGeometry, baseGeometry, haloGeometry]) {
      this.ownedResources.push(item);
    }

    const { x, y } = this.level.goal;
    this.goalPosition.set(x, y + 1.2);
    this.goal.position.set(x, y, 0);

    const base = new THREE.Mesh(baseGeometry, poleMaterial);
    base.position.y = 0.12;
    base.receiveShadow = true;
    this.goal.add(base);

    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 1.3;
    pole.castShadow = true;
    this.goal.add(pole);

    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.position.set(0.6, 2.2, 0);
    flag.castShadow = true;
    this.goal.add(flag);

    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.2;
    this.goal.add(halo);

    this.root.add(this.goal);
  }

  private buildScenery(): void {
    const extent = levelExtent(this.level);
    // Clouds belong in the air, not standing on a platform.
    const kinds: PropKind[] = ['grass-tuft', 'flower', 'candy-crystal', 'rock', 'tree'];
    const solid = this.level.platforms.filter((platform) => !platform.move);

    // Dressing sits on real platforms so props never float over a gap, and it is pushed behind
    // the frog's plane (negative z) so nothing ever occludes the hero.
    for (const platform of solid) {
      const count = Math.max(1, Math.floor(platform.w / 3));
      const usable = platform.w - 1.4;
      for (let i = 0; i < count; i += 1) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const x = platform.x - usable / 2 + t * usable;
        const kind = kinds[Math.floor(this.rng() * kinds.length)];
        const prop = createProp(kind, this.rng);
        prop.position.set(x, platform.y, -0.5 - this.rng() * 0.9);
        const scale = 0.45 + this.rng() * 0.4;
        prop.scale.setScalar(scale);
        // Decorative props do not cast shadows: the blur reads as a stain on the platform top
        // and the shadow budget is better spent on the hero and the pads.
        prop.traverse((object: THREE.Object3D) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = false;
        });
        this.root.add(prop);
        this.sharedObjects.push(prop);
      }
    }

    // A few airborne cloud props under the last levels' gaps for depth cues.
    const cloudCount = 6;
    for (let i = 0; i < cloudCount; i += 1) {
      const x = extent.min + (i / (cloudCount - 1)) * (extent.max - extent.min);
      const cloud = createProp('cloud', this.rng);
      cloud.position.set(x, 5 + this.rng() * 3.5, -6 - this.rng() * 4);
      cloud.scale.setScalar(1.4 + this.rng() * 1.1);
      cloud.traverse((object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = false;
      });
      this.root.add(cloud);
      this.sharedObjects.push(cloud);
    }
  }
}
