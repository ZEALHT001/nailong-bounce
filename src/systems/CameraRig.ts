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
  /**
   * Horizontal world span the framing tries to keep on screen, in world units. Authored levels
   * put the next platform about 5-10 units ahead of the take-off lip, so this covers the gap plus
   * the landing platform. Wide viewports already exceed it and are left untouched.
   */
  private static readonly TARGET_VISIBLE_WIDTH = 12.5;
  /** Hard cap on how far the camera may pull back before the frog gets too small to read. */
  private static readonly MAX_ZOOM_OUT = 3.2;

  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private lead = 0;
  private verticalOffset = 0;
  private zoom = 1;
  private forwardBias = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly distance = 9.8,
    private readonly height = 2.3,
  ) {
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Reframes for the current viewport aspect ratio.
   *
   * A PerspectiveCamera's field of view is vertical, so the horizontal span visible at a given
   * distance scales with the aspect ratio. A portrait phone therefore sees a fraction of what a
   * laptop does at the same camera distance, and the next platform is simply off screen. Narrow
   * viewports pull the camera back and lead further ahead so the upcoming gap is visible before
   * the player has to commit to it.
   */
  setAspect(aspect: number): void {
    const safeAspect = Math.max(0.15, aspect);
    const visibleAtBaseDistance =
      2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * safeAspect;
    const needed = CameraRig.TARGET_VISIBLE_WIDTH / Math.max(0.01, visibleAtBaseDistance);
    this.zoom = THREE.MathUtils.clamp(needed, 1, CameraRig.MAX_ZOOM_OUT);

    // Extra goal-ward look-ahead bias. Progress is always to the right, so a narrow viewport keeps
    // more room in front of the frog than behind it, and the framing stays stable instead of
    // flipping whenever the player nudges backwards.
    const narrowness = THREE.MathUtils.clamp((1.3 - safeAspect) / 0.9, 0, 1);
    this.forwardBias = narrowness * 3.4;
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
    const lead = this.lead + this.forwardBias;
    this.desired.set(
      target.x + lead,
      target.y + this.height + this.verticalOffset + extraY,
      this.distance * this.zoom,
    );
    this.lookAt.set(
      target.x + lead * 0.75,
      target.y + 0.7 + this.verticalOffset * 0.4 + extraY,
      0,
    );
  }

  private applyLookAt(): void {
    this.camera.lookAt(this.lookAt);
  }
}
