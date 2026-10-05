import * as THREE from 'three';

export type CameraTarget = {
  x: number;
  y: number;
  vx: number;
};

/**
 * Side-on follow camera for a horizontal platformer.
 *
 * Two rules drive the tuning:
 * - The camera leads the player in the direction they are heading, so the next platform is
 *   on screen before the frog lands. During a launch the lead is stronger because that is
 *   exactly when the player is committing to an arc.
 * - Vertical follow is damped much harder than horizontal follow; a bouncy jump should not
 *   make the whole level bob.
 */
export class CameraRig {
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private lead = 0;
  private verticalOffset = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly distance = 9.8,
    private readonly height = 2.3,
  ) {
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
  }

  snapTo(target: CameraTarget): void {
    this.lead = 0;
    this.verticalOffset = 0;
    this.updateDesired(target, 0);
    this.camera.position.copy(this.desired);
    this.applyLookAt();
  }

  update(delta: number, target: CameraTarget, airborne: boolean): void {
    const leadTarget = THREE.MathUtils.clamp(target.vx * 0.34, -3.4, 3.4) + (airborne ? 0.9 : 0);
    const leadK = 1 - Math.exp(-2.6 * delta);
    this.lead += (leadTarget - this.lead) * leadK;

    // Float the camera down a little when the frog is high up, so tall arcs stay framed.
    const heightTarget = THREE.MathUtils.clamp((target.y - 1.6) * 0.34, -0.6, 2.6);
    const heightK = 1 - Math.exp(-3.4 * delta);
    this.verticalOffset += (heightTarget - this.verticalOffset) * heightK;

    this.updateDesired(target, 0);
    const followK = 1 - Math.exp(-6.5 * delta);
    this.camera.position.lerp(this.desired, followK);
    this.applyLookAt();
  }

  private updateDesired(target: CameraTarget, extraY: number): void {
    this.desired.set(target.x + this.lead, target.y + this.height + this.verticalOffset + extraY, this.distance);
    this.lookAt.set(target.x + this.lead * 0.75, target.y + 0.7 + this.verticalOffset * 0.4 + extraY, 0);
  }

  private applyLookAt(): void {
    this.camera.lookAt(this.lookAt);
  }
}
