import * as THREE from 'three';

/**
 * Procedural 奶蛙 (Nailong) model.
 *
 * Origin is at the ground contact point (feet sit on y = 0) and the character faces +X.
 * Everything is parented under `bodyPivot`, whose origin is also y = 0, so squash and
 * stretch scale the whole frog down onto the floor instead of into it.
 *
 * Joint groups (leftArm, rightArm, leftLeg, rightLeg, head) exist so animation stays
 * procedural but still has real pivots to rotate.
 */

export type NailongState = 'idle' | 'charge' | 'launch' | 'fall' | 'land' | 'hurt' | 'celebrate';

/** Uniform visual scale. Physics reads NAILONG_HEIGHT / NAILONG_HALF_WIDTH so they stay in sync. */
export const NAILONG_SCALE = 1.35;
export const NAILONG_HEIGHT = 1.16 * NAILONG_SCALE;
export const NAILONG_HALF_WIDTH = 0.56;

/**
 * The frog is turned slightly toward the camera so both eyes and the belly read in a
 * side-on platformer, instead of showing a flat profile.
 */
const YAW_TURN = 0.55;

const BODY_COLOR = '#f2c53c';
const BELLY_COLOR = '#f6e9c6';
const LIMB_COLOR = '#4f5033';
const LIMB_DARK = '#3c3d26';
const SCLERA_COLOR = '#eef4d9';
const PUPIL_COLOR = '#1d1f14';
const MOUTH_COLOR = '#8a6b4a';
const CHEEK_COLOR = '#ef8f6d';

/**
 * Paints the frog's skin into the body lathe's UV space.
 *
 * LatheGeometry maps u around the axis of revolution, and u = 0.25 is the +X (front) direction
 * for our profile. Painting the cream belly as a soft ellipse there gives a clean marking with
 * no second mesh, so the silhouette never gets a bump where a belly sphere would poke through.
 */
function createBodyTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the Nailong body texture context.');

  context.fillStyle = BODY_COLOR;
  context.fillRect(0, 0, size, size);

  // A slightly deeper tone low on the body grounds the frog without adding geometry.
  const base = context.createLinearGradient(0, size, 0, size * 0.62);
  base.addColorStop(0, 'rgba(190, 150, 30, 0.28)');
  base.addColorStop(1, 'rgba(190, 150, 30, 0)');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  // Canvas Y runs top-down and Three.js flips the upload, so canvas y = 0.62 maps to the
  // lower-front of the lathe (v ~= 0.38).
  const belly = context.createRadialGradient(
    size * 0.25,
    size * 0.62,
    size * 0.02,
    size * 0.25,
    size * 0.62,
    size * 0.19,
  );
  belly.addColorStop(0, BELLY_COLOR);
  belly.addColorStop(0.86, BELLY_COLOR);
  belly.addColorStop(1, 'rgba(246, 233, 198, 0)');
  context.save();
  context.translate(size * 0.25, size * 0.62);
  context.scale(1, 1.3);
  context.translate(-size * 0.25, -size * 0.62);
  context.fillStyle = belly;
  context.beginPath();
  context.arc(size * 0.25, size * 0.62, size * 0.19, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

export class NailongModel {
  readonly group = new THREE.Group();
  readonly bodyPivot = new THREE.Group();

  private readonly head = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly leftEye = new THREE.Group();
  private readonly rightEye = new THREE.Group();

  private state: NailongState = 'idle';
  private facing = 1;
  private charge = 0;
  private stateTime = 0;
  private elapsed = 0;

  private scaleY = 1;
  private scaleXZ = 1;
  private targetScaleY = 1;
  private targetScaleXZ = 1;
  private tilt = 0;

  private readonly bodyGeometry = new THREE.LatheGeometry(this.createBodyProfile(), 40);
  private readonly scleraGeometry = new THREE.SphereGeometry(0.128, 20, 16);
  private readonly pupilGeometry = new THREE.SphereGeometry(0.082, 18, 14);
  private readonly glintGeometry = new THREE.SphereGeometry(0.026, 10, 8);
  private readonly cheekGeometry = new THREE.SphereGeometry(0.068, 14, 10);
  private readonly armGeometry = new THREE.CapsuleGeometry(0.072, 0.11, 6, 12);
  private readonly handGeometry = new THREE.SphereGeometry(0.082, 14, 10);
  private readonly fingerGeometry = new THREE.CapsuleGeometry(0.022, 0.042, 4, 8);
  private readonly legGeometry = new THREE.CapsuleGeometry(0.105, 0.1, 6, 12);
  private readonly footGeometry = new THREE.SphereGeometry(0.135, 16, 12);
  private readonly toeGeometry = new THREE.CapsuleGeometry(0.032, 0.055, 4, 8);
  private readonly mouthGeometry = new THREE.TorusGeometry(0.055, 0.013, 8, 20, Math.PI);

  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    // The body colour comes from the texture so the cream belly can be painted into the
    // material instead of being a second mesh that has to punch through the silhouette.
    color: '#ffffff',
    map: createBodyTexture(),
    roughness: 0.52,
    metalness: 0.02,
  });
  private readonly limbMaterial = new THREE.MeshStandardMaterial({
    color: LIMB_COLOR,
    roughness: 0.62,
    metalness: 0.02,
  });
  private readonly limbDarkMaterial = new THREE.MeshStandardMaterial({
    color: LIMB_DARK,
    roughness: 0.66,
    metalness: 0.02,
  });
  private readonly scleraMaterial = new THREE.MeshStandardMaterial({
    color: SCLERA_COLOR,
    roughness: 0.24,
    metalness: 0,
  });
  private readonly pupilMaterial = new THREE.MeshStandardMaterial({
    color: PUPIL_COLOR,
    roughness: 0.18,
    metalness: 0.04,
  });
  private readonly glintMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private readonly cheekMaterial = new THREE.MeshStandardMaterial({
    color: CHEEK_COLOR,
    roughness: 0.8,
    metalness: 0,
  });
  private readonly mouthMaterial = new THREE.MeshStandardMaterial({
    color: MOUTH_COLOR,
    roughness: 0.7,
    metalness: 0,
  });

  constructor() {
    this.group.scale.setScalar(NAILONG_SCALE);
    this.group.add(this.bodyPivot);
    this.buildBody();
    this.buildFace();
    this.buildLimbs();
    this.group.rotation.y = -YAW_TURN;
  }

  setState(state: NailongState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;

    if (state === 'launch') {
      this.targetScaleY = 1.3;
      this.targetScaleXZ = 0.84;
    } else if (state === 'land') {
      this.targetScaleY = 0.68;
      this.targetScaleXZ = 1.22;
    }
  }

  setCharge(ratio: number): void {
    this.charge = THREE.MathUtils.clamp(ratio, 0, 1);
  }

  setFacing(direction: number): void {
    const next = direction >= 0 ? 1 : -1;
    if (next === this.facing) return;
    this.facing = next;
    this.group.rotation.y = next > 0 ? -YAW_TURN : Math.PI + YAW_TURN;
  }

  setVerticalSpeed(speed: number): void {
    this.verticalSpeed = speed;
  }

  private verticalSpeed = 0;

  update(delta: number, elapsed: number): void {
    this.elapsed = elapsed;
    this.stateTime += delta;
    const t = this.stateTime;

    this.updateScaleTargets(delta);

    const breathe = Math.sin(elapsed * 2.1) * 0.012;
    const sy = this.scaleY + breathe;
    const sxz = this.scaleXZ - breathe * 0.7;
    this.bodyPivot.scale.set(sxz, sy, sxz);

    this.animateLimbs(t, elapsed);
    this.animateFace(t);
    this.animateTilt(delta);

    const bob = this.state === 'idle' ? Math.sin(elapsed * 2.1) * 0.012 : 0;
    this.bodyPivot.position.y = bob;
  }

  reset(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.charge = 0;
    this.verticalSpeed = 0;
    this.scaleY = 1;
    this.scaleXZ = 1;
    this.targetScaleY = 1;
    this.targetScaleXZ = 1;
    this.tilt = 0;
    this.group.rotation.y = this.facing > 0 ? -YAW_TURN : Math.PI + YAW_TURN;
    this.bodyPivot.rotation.set(0, 0, 0);
    this.stabilizeVisuals();
  }

  stabilizeVisuals(): void {
    this.bodyPivot.scale.set(1, 1, 1);
    this.bodyPivot.position.y = 0;
    this.bodyPivot.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
    this.leftEye.scale.set(1, 1, 1);
    this.rightEye.scale.set(1, 1, 1);
  }

  dispose(): void {
    for (const geometry of [
      this.bodyGeometry,
      this.scleraGeometry,
      this.pupilGeometry,
      this.glintGeometry,
      this.cheekGeometry,
      this.armGeometry,
      this.handGeometry,
      this.fingerGeometry,
      this.legGeometry,
      this.footGeometry,
      this.toeGeometry,
      this.mouthGeometry,
    ]) {
      geometry.dispose();
    }

    for (const material of [
      this.bodyMaterial,
      this.limbMaterial,
      this.limbDarkMaterial,
      this.scleraMaterial,
      this.pupilMaterial,
      this.glintMaterial,
      this.cheekMaterial,
      this.mouthMaterial,
    ]) {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      material.dispose();
    }
  }

  private updateScaleTargets(delta: number): void {
    const airborne = this.state === 'launch' || this.state === 'fall';

    if (this.state === 'charge') {
      // Charging squashes the frog down and spreads it out, so power reads at a glance.
      this.targetScaleY = 1 - 0.44 * this.charge;
      this.targetScaleXZ = 1 + 0.28 * this.charge;
    } else if (this.state === 'fall') {
      const stretch = THREE.MathUtils.clamp(-this.verticalSpeed / 26, 0, 1);
      this.targetScaleY = 1 + 0.16 * stretch;
      this.targetScaleXZ = 1 - 0.09 * stretch;
    } else if (!airborne && this.state !== 'land' && this.state !== 'hurt') {
      this.targetScaleY = 1;
      this.targetScaleXZ = 1;
    }

    // Landing and launch springs are short and sharp; the rest eases back gently.
    const speed = this.state === 'land' ? 16 : 11;
    const k = 1 - Math.exp(-speed * delta);
    this.scaleY += (this.targetScaleY - this.scaleY) * k;
    this.scaleXZ += (this.targetScaleXZ - this.scaleXZ) * k;

    if (this.state === 'launch' && this.stateTime > 0.16) this.setState('fall');
    if (this.state === 'land' && this.stateTime > 0.2) this.setState('idle');
    if (this.state === 'hurt' && this.stateTime > 0.45) this.setState('idle');
  }

  private animateLimbs(t: number, elapsed: number): void {
    const hop = Math.sin(elapsed * 2.1);

    // Both arms swing on the SAME z rotation: the frog is viewed from the side, so mirrored
    // arm swing reads as a human walk instead of a hopper.
    if (this.state === 'charge') {
      const pull = 0.5 + this.charge * 0.9;
      this.leftArm.rotation.z = -0.45 - pull * 0.5;
      this.rightArm.rotation.z = -0.45 - pull * 0.5;
      this.leftArm.rotation.x = 0.3 * this.charge;
      this.rightArm.rotation.x = -0.3 * this.charge;
      this.leftLeg.rotation.z = 0.3 * this.charge;
      this.rightLeg.rotation.z = 0.3 * this.charge;
      return;
    }

    if (this.state === 'launch') {
      const fling = Math.min(t / 0.14, 1);
      this.leftArm.rotation.z = THREE.MathUtils.lerp(-0.9, 1.5, fling);
      this.rightArm.rotation.z = THREE.MathUtils.lerp(-0.9, 1.5, fling);
      this.leftArm.rotation.x = 0;
      this.rightArm.rotation.x = 0;
      this.leftLeg.rotation.z = -0.45 * fling;
      this.rightLeg.rotation.z = -0.45 * fling;
      return;
    }

    if (this.state === 'fall') {
      const flutter = Math.sin(elapsed * 12) * 0.18;
      this.leftArm.rotation.z = 1.25 + flutter;
      this.rightArm.rotation.z = 1.25 - flutter;
      this.leftLeg.rotation.z = 0.35;
      this.rightLeg.rotation.z = 0.2;
      return;
    }

    if (this.state === 'hurt') {
      const spin = Math.min(t / 0.45, 1);
      this.leftArm.rotation.z = 2.1 * (1 - spin);
      this.rightArm.rotation.z = 2.1 * (1 - spin);
      this.leftLeg.rotation.z = -0.8 * (1 - spin);
      this.rightLeg.rotation.z = 0.8 * (1 - spin);
      return;
    }

    if (this.state === 'celebrate') {
      const cheer = Math.sin(elapsed * 7) * 0.35;
      this.leftArm.rotation.z = 1.5 + cheer;
      this.rightArm.rotation.z = 1.5 - cheer;
      this.leftLeg.rotation.z = 0.1;
      this.rightLeg.rotation.z = 0.1;
      return;
    }

    // Idle: soft breathing sway in the arms and a tiny weight shift in the legs.
    const sway = hop * 0.11;
    this.leftArm.rotation.z = 0.8 + sway;
    this.rightArm.rotation.z = 0.8 + sway;
    this.leftArm.rotation.x = 0.2;
    this.rightArm.rotation.x = -0.2;
    this.leftLeg.rotation.z = -hop * 0.04;
    this.rightLeg.rotation.z = hop * 0.04;
  }

  private animateFace(t: number): void {
    // Blink: a fast vertical squash on both eyes at a slow, slightly irregular cadence.
    const cycle = this.elapsed % 4.3;
    const blink = cycle > 4.05 ? Math.max(0.12, Math.abs(cycle - 4.12) / 0.1) : 1;
    const hurt = this.state === 'hurt' ? 1 : 0;
    const squint = this.state === 'charge' ? 1 - this.charge * 0.35 : 1;
    const cheer = this.state === 'celebrate' ? 0.8 : 1;
    const scale = Math.min(blink, squint, cheer) * (1 - hurt * 0.55);
    this.leftEye.scale.set(1, Math.max(0.14, scale), 1);
    this.rightEye.scale.set(1, Math.max(0.14, scale), 1);

    this.head.rotation.z = Math.sin(this.elapsed * 1.6) * 0.02 + (this.state === 'charge' ? 0.08 * this.charge : 0);
    if (hurt > 0) this.head.rotation.z += Math.sin(t * 40) * 0.12 * (1 - t / 0.45);
  }

  private animateTilt(delta: number): void {
    const airborne = this.state === 'launch' || this.state === 'fall';
    const targetTilt = airborne ? THREE.MathUtils.clamp(-this.verticalSpeed * 0.012, -0.22, 0.22) : 0;
    const k = 1 - Math.exp(-9 * delta);
    this.tilt += (targetTilt - this.tilt) * k;
    this.bodyPivot.rotation.z = this.tilt;
  }

  private createBodyProfile(): THREE.Vector2[] {
    // Pear silhouette: narrow at the feet, widest across the belly, tapering to the crown.
    const profile: Array<[number, number]> = [
      [0.0, 0.0],
      [0.24, 0.015],
      [0.4, 0.08],
      [0.51, 0.22],
      [0.56, 0.42],
      [0.545, 0.6],
      [0.49, 0.76],
      [0.41, 0.9],
      [0.32, 1.01],
      [0.22, 1.09],
      [0.11, 1.14],
      [0.0, 1.16],
    ];
    return profile.map(([radius, y]) => new THREE.Vector2(radius, y));
  }

  private buildBody(): void {
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = false;
    body.name = 'body';
    this.bodyPivot.add(body);
  }

  private buildFace(): void {
    this.head.position.set(0, 0.62, 0);
    this.bodyPivot.add(this.head);

    for (const side of [-1, 1] as const) {
      const eye = side < 0 ? this.leftEye : this.rightEye;
      // Eyes sit ON the head surface (radius ~0.38 at this height) and forward of centre.
      eye.position.set(0.3, 0.22, side * 0.245);
      this.head.add(eye);

      const sclera = new THREE.Mesh(this.scleraGeometry, this.scleraMaterial);
      sclera.scale.set(0.9, 1, 1);
      sclera.castShadow = false;
      sclera.name = 'sclera';
      eye.add(sclera);

      const pupil = new THREE.Mesh(this.pupilGeometry, this.pupilMaterial);
      pupil.position.set(0.05, 0.004, side * -0.012);
      pupil.name = 'pupil';
      eye.add(pupil);

      const glint = new THREE.Mesh(this.glintGeometry, this.glintMaterial);
      glint.position.set(0.082, 0.04, side * -0.028);
      eye.add(glint);

      const cheek = new THREE.Mesh(this.cheekGeometry, this.cheekMaterial);
      cheek.position.set(0.36, 0.05, side * 0.21);
      cheek.scale.set(0.45, 0.6, 0.85);
      this.head.add(cheek);
    }

    const mouth = new THREE.Mesh(this.mouthGeometry, this.mouthMaterial);
    mouth.position.set(0.452, 0.17, 0);
    mouth.rotation.set(0, Math.PI / 2, Math.PI);
    mouth.scale.set(1, 1, 1.5);
    mouth.name = 'mouth';
    this.head.add(mouth);
  }

  private buildLimbs(): void {
    const shoulders: Array<[THREE.Group, number]> = [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ];
    for (const [arm, side] of shoulders) {
      // Shoulders sit forward of the widest point so the paw reads at the front of the belly.
      // Shoulders sit forward and low so the paws frame the front of the belly in profile.
      arm.position.set(0.26, 0.42, side * 0.4);
      this.bodyPivot.add(arm);

      const upper = new THREE.Mesh(this.armGeometry, this.limbMaterial);
      upper.position.set(0.0, -0.1, side * 0.02);
      upper.castShadow = true;
      upper.name = 'arm';
      arm.add(upper);

      const hand = new THREE.Mesh(this.handGeometry, this.limbDarkMaterial);
      hand.position.set(0.0, -0.17, side * 0.03);
      hand.scale.set(0.88, 1.0, 0.82);
      hand.castShadow = true;
      hand.name = 'hand';
      arm.add(hand);

      for (let finger = -1; finger <= 1; finger += 1) {
        const digit = new THREE.Mesh(this.fingerGeometry, this.limbDarkMaterial);
        digit.position.set(0.04, -0.21, side * 0.04 + finger * 0.038);
        digit.rotation.z = -0.7;
        digit.rotation.x = finger * 0.28;
        digit.name = 'finger';
        arm.add(digit);
      }
    }

    const hips: Array<[THREE.Group, number]> = [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ];
    for (const [leg, side] of hips) {
      leg.position.set(0.06, 0.36, side * 0.22);
      this.bodyPivot.add(leg);

      const thigh = new THREE.Mesh(this.legGeometry, this.limbMaterial);
      thigh.position.set(0.02, -0.2, 0);
      thigh.castShadow = true;
      thigh.name = 'leg';
      leg.add(thigh);

      const foot = new THREE.Mesh(this.footGeometry, this.limbDarkMaterial);
      foot.position.set(0.08, -0.34, 0);
      foot.scale.set(1.35, 0.52, 1.0);
      foot.castShadow = true;
      foot.name = 'foot';
      leg.add(foot);

      for (let toe = -1; toe <= 1; toe += 1) {
        const digit = new THREE.Mesh(this.toeGeometry, this.limbDarkMaterial);
        digit.position.set(0.22, -0.36, toe * 0.055);
        digit.rotation.z = Math.PI / 2;
        digit.name = 'toe';
        leg.add(digit);
      }
    }
  }
}
