import { type Page } from '@playwright/test';
import { LEVELS } from '../src/game/levels';

/**
 * A scripted player that can finish any level.
 *
 * Two design notes, both learned the hard way:
 *
 * 1. Whole hops run inside the page. Driving each key press over the test protocol costs about
 *    a second per round trip in a loaded environment, so "release the key when the frog reaches
 *    the lip" arrives long after the frog has walked off the platform. The in-page loop dispatches
 *    the same keydown/keyup events the game listens for, but resolves them on the exact animation
 *    frame the condition is met, so the bot is latency-independent.
 * 2. Every decision reads live geometry from the diagnostics rather than authored coordinates.
 *    A moving platform's authored position is wrong by its whole travel, which is exactly the
 *    mistake that made the bot walk off a moving platform and fall into a pit.
 */

export type JumpSample = { power: number; distance: number; apex: number; airTime: number };

export type BotResult = {
  completed: boolean;
  mode: string;
  score: number;
  hops: number;
  trace: string[];
};

export type Rect = { index: number; minX: number; maxX: number; minY: number; maxY: number };

type Snapshot = {
  x: number;
  y: number;
  grounded: boolean;
  mode: string;
  score: number;
  platforms: Rect[];
};

export async function measureEnvelope(page: Page): Promise<JumpSample[]> {
  return page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks?.measureJump) throw new Error('measureJump hook missing');
    const samples: Array<{ power: number; distance: number; apex: number; airTime: number }> = [];
    for (let power = 0.05; power <= 0.9501; power += 0.05) {
      const result = await hooks.measureJump(Number(power.toFixed(2)));
      samples.push({
        power: Number(power.toFixed(2)),
        distance: result.distance,
        apex: result.apex,
        airTime: result.airTime,
      });
    }
    return samples;
  });
}

/**
 * Smallest charge that both reaches the landing spot and clears the height difference.
 *
 * Distance alone is not enough: a landing platform that sits higher than the take-off platform
 * needs a jump whose apex clears the rise, otherwise the frog clips the lip on the way up.
 */
export function pickCharge(
  envelope: JumpSample[],
  neededDistance: number,
  neededRise: number,
): JumpSample | null {
  // Pick the charge that lands closest to the aim point while still clearing the rise. Overshooting
  // past a platform's far edge is as fatal as falling short, so distance is matched, not padded.
  let best: JumpSample | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const sample of envelope) {
    if (sample.apex < neededRise + 0.35) continue;
    if (sample.distance < neededDistance - 0.25) continue;
    const error = Math.abs(sample.distance - neededDistance);
    if (error < bestError) {
      bestError = error;
      best = sample;
    }
  }
  return best;
}

export async function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d) return null;
    return {
      x: d.player.position.x,
      y: d.player.position.y,
      grounded: d.grounded,
      mode: d.mode,
      score: d.score,
      platforms: d.platforms.map((platform) => ({ ...platform })),
    };
  });
}

export async function resetToLevel(page: Page, levelIndex: number): Promise<void> {
  await page.evaluate(async (index) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('test hooks missing');
    await hooks.setState(index === 0 ? 'active-play' : `level-${index + 1}`);
  }, levelIndex);
  // Let the frog settle onto the first platform.
  await page
    .waitForFunction(
      () => {
        const d = window.__THREE_GAME_DIAGNOSTICS__;
        return Boolean(d && d.grounded && d.mode === 'playing');
      },
      undefined,
      { timeout: 8000 },
    )
    .catch(() => {});
}

type HopOutcome = {
  status: 'launched' | 'walked-off' | 'exhausted' | 'finished' | 'stuck';
  trace: string;
  end: Snapshot;
};

/**
 * Runs one hop entirely inside the page: walk to the lip, wait for a jump window on a mover,
 * charge to the requested power, release, and wait to land.
 */
async function driveHop(page: Page, levelIndex: number, envelope: JumpSample[]): Promise<HopOutcome> {
  return page.evaluate(
    async ({ level, samples }) => {
      const read = () => window.__THREE_GAME_DIAGNOSTICS__;
      const snap = () => {
        const d = read();
        if (!d) throw new Error('diagnostics missing');
        return {
          x: d.player.position.x,
          y: d.player.position.y,
          grounded: d.grounded,
          mode: d.mode,
          score: d.score,
          platforms: d.platforms.map((platform) => ({ ...platform })),
        };
      };
      const key = (type: 'keydown' | 'keyup', code: string) =>
        window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const settle = async (frames: number) => {
        for (let i = 0; i < frames; i += 1) await frame();
      };

      const levelSpec = level as {
        platforms: Array<{ move?: { axis: 'x' | 'y'; range: number } }>;
      };

      const standingOn = (s: ReturnType<typeof snap>) => {
        let best: (typeof s.platforms)[number] | null = null;
        let bestError = Number.POSITIVE_INFINITY;
        for (const platform of s.platforms) {
          if (s.x < platform.minX - 0.9 || s.x > platform.maxX + 0.9) continue;
          const error = Math.abs(platform.maxY - s.y);
          if (error > 1.2) continue;
          if (error < bestError) {
            bestError = error;
            best = platform;
          }
        }
        return best;
      };

      const chargeFor = (needed: number, rise: number) => {
        let best: number | null = null;
        let bestError = Number.POSITIVE_INFINITY;
        for (const sample of samples) {
          if (sample.apex < rise + 0.35) continue;
          if (sample.distance < needed - 0.25) continue;
          const error = Math.abs(sample.distance - needed);
          if (error < bestError) {
            bestError = error;
            best = sample.power;
          }
        }
        return best;
      };

      let state = snap();
      if (state.mode === 'won' || state.mode === 'failed') {
        return { status: 'finished' as const, trace: `already ${state.mode}`, end: state };
      }
      if (!state.grounded) {
        for (let i = 0; i < 400 && !read()?.grounded; i += 1) await frame();
        state = snap();
      }

      const current = standingOn(state);
      if (!current) {
        return { status: 'stuck' as const, trace: `off-grid at x=${state.x.toFixed(2)} y=${state.y.toFixed(2)}`, end: state };
      }

      // Walk to the lip. The release happens on the frame the lip is reached, so it cannot
      // overshoot the way a cross-process key release does.
      const lip = current.maxX - 0.75;
      if (state.x < lip) {
        key('keydown', 'KeyD');
        let wentAirborne = false;
        for (let i = 0; i < 900; i += 1) {
          const d = read();
          if (!d || d.mode === 'won' || d.mode === 'failed') break;
          if (!d.grounded) {
            wentAirborne = true;
            break;
          }
          if (d.player.position.x >= lip) break;
          await frame();
        }

        // A bounce pad in the walking line fires as soon as the frog touches it. Keep holding
        // the direction through the whole arc, exactly as a player would: releasing the key
        // mid-flight bleeds the horizontal speed and drops the frog into the gap.
        if (wentAirborne) {
          for (let i = 0; i < 900; i += 1) {
            const d = read();
            if (!d || d.mode === 'won' || d.mode === 'failed') break;
            if (d.grounded && i > 4) break;
            await frame();
          }
        }

        key('keyup', 'KeyD');
        await settle(6);
        state = snap();
        if (wentAirborne) {
          return {
            status: 'walked-off' as const,
            trace: `a pad in the walking line launched the frog to x=${state.x.toFixed(2)} y=${state.y.toFixed(2)} ${state.mode}`,
            end: state,
          };
        }
        if (!state.grounded || standingOn(state)?.index !== current.index) {
          return {
            status: 'walked-off' as const,
            trace: `walk to ${lip.toFixed(2)} left the platform at x=${state.x.toFixed(2)} grounded=${state.grounded} mode=${state.mode}`,
            end: state,
          };
        }
      }

      const nextRect = [...state.platforms]
        .filter((platform) => platform.minX > current.maxX + 0.2)
        .sort((a, b) => a.minX - b.minX)[0];
      if (!nextRect) {
        // Last platform: walk into the goal flag.
        key('keydown', 'KeyD');
        for (let i = 0; i < 900; i += 1) {
          const d = read();
          if (!d || d.mode === 'won' || d.mode === 'failed') break;
          await frame();
        }
        key('keyup', 'KeyD');
        return { status: 'finished' as const, trace: 'walked to the flag', end: snap() };
      }

      // Wait for a jump window on a mover: a landing platform must be near its closest point
      // when the frog arrives, which is how a player times these jumps too.
      const nextMove = levelSpec.platforms[nextRect.index]?.move;
      if (nextMove) {
        const baseLow = nextMove.axis === 'x' ? nextRect.minX - nextMove.range : nextRect.maxY - nextMove.range;
        for (let i = 0; i < 900; i += 1) {
          const rect = read()?.platforms[nextRect.index];
          if (!rect) break;
          const value = nextMove.axis === 'x' ? rect.minX : rect.maxY;
          if (value <= baseLow + 0.5) break;
          await frame();
        }
      }

      // Re-read everything: the platform underfoot may have carried the frog while waiting.
      state = snap();
      const launchFrom = standingOn(state);
      if (!launchFrom) {
        return {
          status: 'walked-off' as const,
          trace: `lost the platform while waiting at x=${state.x.toFixed(2)}`,
          end: state,
        };
      }
      const landing = state.platforms[nextRect.index];
      if (!landing) {
        return { status: 'stuck' as const, trace: 'landing platform vanished', end: state };
      }
      const gap = landing.minX - launchFrom.maxX;
      const isMover = Boolean(levelSpec.platforms[nextRect.index]?.move);
      // Aim at the middle of a moving platform, not its lip. The platform keeps travelling while
      // the frog is in the air, and aiming at the lip means landing where the lip used to be.
      const targetX = isMover ? (landing.minX + landing.maxX) / 2 : landing.minX + 0.6;
      const needed = Math.max(0.4, targetX - state.x);
      const rise = Math.max(0, landing.maxY - state.y);
      const power = chargeFor(needed, rise);
      if (power === null) {
        return {
          status: 'exhausted' as const,
          trace: `gap ${gap.toFixed(2)} rise ${rise.toFixed(2)} from platform ${launchFrom.index} exceeds the envelope`,
          end: state,
        };
      }

      const startsBefore = read()?.counters.launches ?? 0;
      // Charge standing still. Holding a direction while charging walks the frog off the lip
      // before the charge finishes, and a release with no footing does not launch at all.
      key('keydown', 'Space');
      let charged = 0;
      for (let i = 0; i < 300; i += 1) {
        const d = read();
        if (!d) break;
        charged = d.charge;
        if (charged >= power) break;
        await frame();
      }
      // Aim and release in the same frame so the launch uses this direction and the frog has
      // not moved off the lip.
      key('keydown', 'KeyD');
      key('keyup', 'Space');

      // Fly until contact or the run resolves.
      let landed = false;
      let mode = read()?.mode ?? 'playing';
      for (let i = 0; i < 600; i += 1) {
        const d = read();
        if (!d) break;
        mode = d.mode;
        if (mode === 'won' || mode === 'failed') break;
        if (d.grounded && i > 4) {
          landed = true;
          break;
        }
        await frame();
      }
      key('keyup', 'KeyD');
      const end = snap();
      const launched = (read()?.counters.launches ?? 0) > startsBefore;
      const trace =
        `hop: gap ${gap.toFixed(2)} rise ${rise.toFixed(2)} charge ${power.toFixed(2)}/${charged.toFixed(2)} ` +
        `-> x ${state.x.toFixed(2)}..${end.x.toFixed(2)} y=${end.y.toFixed(2)} ${end.mode} ` +
        `landed=${landed} launched=${launched}`;
      if (!launched) {
        return { status: 'stuck' as const, trace: `${trace} (launch never registered)`, end };
      }
      return { status: 'launched' as const, trace, end };
    },
    { level: LEVELS[levelIndex], samples: envelope },
  );
}

export async function runLevelBot(
  page: Page,
  levelIndex: number,
  envelope: JumpSample[],
): Promise<BotResult> {
  const level = LEVELS[levelIndex];
  const trace: string[] = [];
  let completed = false;
  let hops = 0;
  let stuck = 0;

  for (let attempt = 0; attempt < level.platforms.length * 4 + 6 && !completed; attempt += 1) {
    const outcome = await driveHop(page, levelIndex, envelope);
    trace.push(outcome.trace);
    if (outcome.trace.startsWith('hop:')) hops += 1;

    if (outcome.end.mode === 'won') {
      completed = true;
      break;
    }
    if (outcome.end.mode === 'failed') {
      trace.push(`failed at x=${outcome.end.x.toFixed(2)} y=${outcome.end.y.toFixed(2)}`);
      break;
    }
    if (outcome.status === 'stuck' || outcome.status === 'exhausted') {
      stuck += 1;
      if (stuck > 2) break;
    } else {
      stuck = 0;
    }
  }

  const final = await snapshot(page);
  return {
    completed,
    mode: final?.mode ?? 'unknown',
    score: final?.score ?? 0,
    hops,
    trace,
  };
}
