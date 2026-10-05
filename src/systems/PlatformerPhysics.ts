/**
 * Fixed-timestep AABB platformer physics.
 *
 * Choice: custom collision rather than Rapier. A charge-jump platformer is authored feel,
 * not simulation — the arc has to be identical every frame and the contact response is
 * hand-tuned. Colliders are axis-aligned boxes and the body is one box moved per axis with
 * the leftover time applied to the second axis.
 */

export const FIXED_DT = 1 / 120;

export type ColliderKind = 'solid' | 'pad';

export type Collider = {
  readonly id: number;
  readonly kind: ColliderKind;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  oneWay: boolean;
  /** Movement applied to this collider during the current step (for riders). */
  deltaX: number;
  deltaY: number;
};

export type Body = {
  /** Feet position. The body box spans y .. y + height. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly halfWidth: number;
  readonly height: number;
  grounded: boolean;
  groundId: number | null;
  coyote: number;
  charge: number;
  chargeLock: number;
  /** Was the jump button held on the previous step, used to detect the release edge. */
  jumpHeld: boolean;
  /** Seconds left in which a released jump will still fire on touchdown. */
  jumpBuffer: number;
  /** Power to use when the buffered jump fires. */
  bufferedPower: number;
};

export type StepEvents = {
  /** Downward impact speed normalised 0..1, non-zero only on the frame of landing. */
  landed: number;
  /** 0..1 launch strength when a bounce pad fires, else 0. */
  padBounce: number;
  /** -1 wall on the left, 1 wall on the right, 0 none. */
  hitWall: -1 | 0 | 1;
  hitCeiling: boolean;
  /** True on the frame a charged launch is released. */
  launched: number;
};

export const PHYSICS = {
  gravity: -34,
  terminalVelocity: -27,
  minLaunch: 7.2,
  maxLaunch: 15,
  /** Horizontal launch speed is set by the charge, so charge maps directly to jump distance. */
  launchSpeedMin: 1.6,
  launchSpeedMax: 8,
  maxChargeTime: 0.6,
  groundAccel: 54,
  airAccel: 10,
  groundFriction: 36,
  airFriction: 3.2,
  maxSpeed: 5.5,
  coyoteTime: 0.11,
  chargeLockTime: 0.12,
  /**
   * How long a released jump stays queued. Players let go of jump slightly before touching down
   * all the time; without this the input is silently eaten and the jump "just does not come out".
   */
  jumpBufferTime: 0.16,
  /** Power used when a jump is released while airborne, where no charge could build up. */
  minBufferedPower: 0.14,
  padLaunch: 24,
  /**
   * Horizontal speed floor a pad grants. Deliberately low: the pad is a vertical boost the
   * player steers, so holding a direction lands far and releasing lands short. A high floor made
   * a pad fling the frog clean over the next platform and into the gap behind it.
   */
  padSpeed: 3.6,
  wallRestitution: 0.32,
  minWallSpeed: 3.5,
};

export function createBody(x: number, y: number, halfWidth = 0.44, height = 1.06): Body {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    halfWidth,
    height,
    grounded: false,
    groundId: null,
    coyote: 0,
    charge: 0,
    chargeLock: 0,
    jumpHeld: false,
    jumpBuffer: 0,
    bufferedPower: 0,
  };
}

function bodyMinX(body: Body): number {
  return body.x - body.halfWidth;
}

function bodyMaxX(body: Body): number {
  return body.x + body.halfWidth;
}

function bodyMinY(body: Body): number {
  return body.y;
}

function bodyMaxY(body: Body): number {
  return body.y + body.height;
}

function overlapsX(a: Body, collider: Collider): boolean {
  return bodyMinX(a) < collider.maxX && bodyMaxX(a) > collider.minX;
}

function overlapsY(a: Body, collider: Collider): boolean {
  return bodyMinY(a) < collider.maxY && bodyMaxY(a) > collider.minY;
}

/**
 * Applies a charged launch. Power drives both the rise and the horizontal speed, so charge maps
 * directly to jump distance; steering only picks the direction.
 */
function fireLaunch(body: Body, power: number, moveInput: number, events: StepEvents): void {
  body.vy = PHYSICS.minLaunch + (PHYSICS.maxLaunch - PHYSICS.minLaunch) * power;
  const direction =
    moveInput !== 0 ? Math.sign(moveInput) : Math.abs(body.vx) > 0.4 ? Math.sign(body.vx) : 0;
  if (direction !== 0) {
    body.vx =
      direction * (PHYSICS.launchSpeedMin + (PHYSICS.launchSpeedMax - PHYSICS.launchSpeedMin) * power);
  }
  body.grounded = false;
  body.groundId = null;
  body.coyote = 0;
  body.charge = 0;
  events.launched = power;
}

/** Axis-separated sweep. Call exactly once per fixed step, after movers have updated. */
export function stepBody(
  body: Body,
  moveInput: number,
  chargeHeld: boolean,
  colliders: readonly Collider[],
  dt: number,
): StepEvents {
  const events: StepEvents = {
    landed: 0,
    padBounce: 0,
    hitWall: 0,
    hitCeiling: false,
    launched: 0,
  };

  body.chargeLock = Math.max(0, body.chargeLock - dt);
  body.jumpBuffer = Math.max(0, body.jumpBuffer - dt);
  const wasGrounded = body.grounded;
  const previousBottom = body.y;
  const previousVy = body.vy;

  if (wasGrounded) body.coyote = PHYSICS.coyoteTime;
  else body.coyote = Math.max(0, body.coyote - dt);

  // ---- Horizontal intent -------------------------------------------------
  const accel = body.grounded ? PHYSICS.groundAccel : PHYSICS.airAccel;
  const cap = PHYSICS.maxSpeed;

  if (moveInput !== 0) {
    const direction = Math.sign(moveInput);
    const fasterInSameDirection = body.vx * direction > cap;
    if (fasterInSameDirection) {
      // A charged launch is already faster than the run cap; steering must not brake it.
    } else {
      const target = direction * cap;
      const step = accel * dt;
      body.vx = Math.abs(target - body.vx) <= step ? target : body.vx + Math.sign(target - body.vx) * step;
    }
  } else {
    const friction = (body.grounded ? PHYSICS.groundFriction : PHYSICS.airFriction) * dt;
    if (Math.abs(body.vx) <= friction) body.vx = 0;
    else body.vx -= Math.sign(body.vx) * friction;
  }

  body.vy += PHYSICS.gravity * dt;
  body.vy = Math.max(body.vy, PHYSICS.terminalVelocity);

  // ---- Horizontal sweep --------------------------------------------------
  body.x += body.vx * dt;
  for (const collider of colliders) {
    if (collider.oneWay) continue;
    if (!overlapsX(body, collider) || !overlapsY(body, collider)) continue;
    if (body.vx > 0) {
      body.x = collider.minX - body.halfWidth;
      events.hitWall = 1;
    } else if (body.vx < 0) {
      body.x = collider.maxX + body.halfWidth;
      events.hitWall = -1;
    }
    if (Math.abs(body.vx) >= PHYSICS.minWallSpeed && !body.grounded) {
      body.vx = -body.vx * PHYSICS.wallRestitution;
    } else {
      body.vx = 0;
    }
  }

  // ---- Vertical sweep ----------------------------------------------------
  body.grounded = false;
  body.groundId = null;
  body.y += body.vy * dt;
  if (body.vy > 0) {
    for (const collider of colliders) {
      if (collider.oneWay) continue;
      if (!overlapsX(body, collider) || !overlapsY(body, collider)) continue;
      body.y = collider.minY - body.height;
      body.vy = 0;
      events.hitCeiling = true;
    }
  } else {
    for (const collider of colliders) {
      if (!overlapsX(body, collider) || !overlapsY(body, collider)) continue;
      if (collider.oneWay) {
        // Only stop on a one-way platform when falling onto it from above.
        const wasAbove = previousBottom + 0.001 >= collider.maxY;
        if (!wasAbove) continue;
      }
      body.y = collider.maxY;
      body.grounded = true;
      body.groundId = collider.id;

      if (collider.kind === 'pad') {
        body.vy = PHYSICS.padLaunch;
        body.grounded = false;
        body.groundId = null;
        body.chargeLock = PHYSICS.chargeLockTime;
        body.charge = 0;
        events.padBounce = clamp(PHYSICS.padLaunch / PHYSICS.padLaunch, 0, 1);
      } else {
        body.vy = 0;
        if (!wasGrounded && previousVy < -1.5) {
          events.landed = clamp(-previousVy / 22, 0, 1);
        }
      }
      break;
    }
  }

  // ---- Charge, launch, and jump buffer -----------------------------------
  // Grounding is re-read after the sweeps: a buffered or released jump should fire on the very
  // step the frog touches down, not one step later.
  if (body.grounded) body.coyote = PHYSICS.coyoteTime;
  const canLaunch = body.grounded || body.coyote > 0;
  const releasedThisStep = body.jumpHeld && !chargeHeld;
  body.jumpHeld = chargeHeld;

  if (chargeHeld) {
    // An active hold supersedes a stale buffered release.
    body.jumpBuffer = 0;
    if (canLaunch && body.chargeLock <= 0) {
      body.charge = clamp(body.charge + dt / PHYSICS.maxChargeTime, 0, 1);
    }
  } else if (releasedThisStep) {
    // A hold that never got to charge (released while airborne) still counts as a jump request.
    const power = body.charge > 0 ? body.charge : PHYSICS.minBufferedPower;
    if (canLaunch && body.chargeLock <= 0) {
      fireLaunch(body, power, moveInput, events);
    } else {
      body.jumpBuffer = PHYSICS.jumpBufferTime;
      body.bufferedPower = power;
      body.charge = 0;
    }
  } else if (body.jumpBuffer > 0 && canLaunch && body.chargeLock <= 0) {
    fireLaunch(body, body.bufferedPower, moveInput, events);
    body.jumpBuffer = 0;
  } else {
    body.charge = 0;
  }

  return events;
}

export function colliderFromBox(
  id: number,
  kind: ColliderKind,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  oneWay = false,
): Collider {
  return { id, kind, minX, minY, maxX, maxY, oneWay, deltaX: 0, deltaY: 0 };
}

export function overlapsBox(
  body: Body,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return (
    bodyMinX(body) < box.maxX &&
    bodyMaxX(body) > box.minX &&
    bodyMinY(body) < box.maxY &&
    bodyMaxY(body) > box.minY
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
