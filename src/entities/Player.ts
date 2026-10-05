import {
  NAILONG_HALF_WIDTH,
  NAILONG_HEIGHT,
  NailongModel,
  type NailongState,
} from './NailongModel';
import {
  createBody,
  stepBody,
  type Body,
  type Collider,
  type StepEvents,
} from '../systems/PlatformerPhysics';

/**
 * The player: one physics body plus the visual 奶蛙.
 *
 * `body.y` is the feet position and the model's origin is the feet, so the mesh position is
 * the body position verbatim — no offset bookkeeping between physics and render.
 */
export class Player {
  readonly model = new NailongModel();
  readonly group = this.model.group;
  readonly body: Body = createBody(0, 0, NAILONG_HALF_WIDTH, NAILONG_HEIGHT);

  private facing = 1;
  private visualX = 0;
  private visualY = 0;

  step(dt: number, moveInput: number, chargeHeld: boolean, colliders: readonly Collider[]): StepEvents {
    // Riders move with the platform under their feet before the sweep runs.
    if (this.body.grounded && this.body.groundId !== null) {
      const carrier = colliders.find((collider) => collider.id === this.body.groundId);
      if (carrier && (carrier.deltaX !== 0 || carrier.deltaY !== 0)) {
        this.body.x += carrier.deltaX;
        this.body.y += carrier.deltaY;
      }
    }

    return stepBody(this.body, moveInput, chargeHeld, colliders, dt);
  }

  render(delta: number, elapsed: number): void {
    // The visual trails the body by a hair horizontally; it sells the squash without ever
    // desyncing enough to read as input lag.
    const k = 1 - Math.exp(-26 * delta);
    this.visualX += (this.body.x - this.visualX) * k;
    this.visualY += (this.body.y - this.visualY) * k;
    this.group.position.set(this.visualX, this.visualY, 0);

    if (Math.abs(this.body.vx) > 0.6) {
      this.facing = this.body.vx > 0 ? 1 : -1;
    }
    this.model.setFacing(this.facing);
    this.model.setCharge(this.body.charge);
    this.model.setVerticalSpeed(this.body.vy);
    this.model.update(delta, elapsed);
  }

  setState(state: NailongState): void {
    this.model.setState(state);
  }

  respawn(x: number, y: number): void {
    this.body.x = x;
    this.body.y = y;
    this.body.vx = 0;
    this.body.vy = 0;
    this.body.grounded = false;
    this.body.groundId = null;
    this.body.coyote = 0;
    this.body.charge = 0;
    this.body.chargeLock = 0;
    this.visualX = x;
    this.visualY = y;
    this.facing = 1;
    this.model.reset();
    this.group.position.set(x, y, 0);
  }

  stabilizeVisuals(): void {
    this.visualX = this.body.x;
    this.visualY = this.body.y;
    this.group.position.set(this.body.x, this.body.y, 0);
    this.model.stabilizeVisuals();
  }

  dispose(): void {
    this.model.dispose();
  }
}
