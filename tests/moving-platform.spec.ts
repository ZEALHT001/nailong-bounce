import { expect, test, type Page } from '@playwright/test';
import { LEVELS } from '../src/game/levels';
import { collectPageErrors, waitForGame } from './helpers';

/**
 * Regression cover for riding a vertically moving platform.
 *
 * The reported bug: jumping onto the first floating step in level 2 and getting thrown off it.
 * These tests sit the frog on the platform and watch it for a full travel cycle, so any
 * double-applied rider delta, embed, or spurious launch fails here.
 */

type Sample = { x: number; y: number; vy: number; grounded: boolean; mode: string };

async function sample(page: Page): Promise<Sample | null> {
  return page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d) return null;
    return {
      x: d.player.position.x,
      y: d.player.position.y,
      vy: d.player.velocity.y,
      grounded: d.grounded,
      mode: d.mode,
    };
  });
}

async function sampleFor(page: Page, ms: number, intervalMs = 40): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await sample(page);
    if (value) samples.push(value);
    await page.waitForTimeout(intervalMs);
  }
  return samples;
}

test('the frog rides a vertical mover without being thrown off', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  const errors = collectPageErrors(page);
  await waitForGame(page);

  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks?.placePlayer) throw new Error('placePlayer hook missing');
    await hooks.setState('level-2');
  });

  // The first floating step in level 2 oscillates 1.2 units around y = 0.6.
  const mover = LEVELS[1].platforms.find((platform) => platform.move?.axis === 'y');
  expect(mover, 'level 2 should have a vertically moving platform').toBeTruthy();
  if (!mover) return;

  const centerX = mover.x;
  const startY = mover.y + 0.05;

  // Drop onto the middle of the platform from just above it.
  await page.evaluate(
    ({ x, y }) => window.__THREE_GAME_TEST_HOOKS__?.placePlayer?.(x, y, 0, -0.5),
    { x: centerX, y: startY + 0.6 },
  );

  // Watch a full travel cycle (the mover's speed is 1.1, so one period is about 5.7s).
  const samples = await sampleFor(page, 4200);
  const frames = samples.length;
  const groundedFrames = samples.filter((value) => value.grounded).length;
  const horizontalDrift = Math.max(...samples.map((value) => Math.abs(value.x - centerX)));
  const highest = Math.max(...samples.map((value) => value.y));
  const lowest = Math.min(...samples.map((value) => value.y));
  const flewAway = samples.some((value) => value.y > mover.y + mover.move!.range + 0.6);
  const modes = new Set(samples.map((value) => value.mode));

  const detail =
    `frames=${frames} grounded=${groundedFrames} drift=${horizontalDrift.toFixed(3)} ` +
    `y=[${lowest.toFixed(2)}, ${highest.toFixed(2)}] mover=[${(mover.y - mover.move!.range).toFixed(2)}, ${(mover.y + mover.move!.range).toFixed(2)}] modes=${[...modes].join(',')}`;

  // It must stay on the platform: grounded for nearly the whole window, and never launched.
  expect(groundedFrames / frames, `should stay grounded while riding:\n${detail}`).toBeGreaterThan(0.9);
  expect(flewAway, `must not be thrown upward off the platform:\n${detail}`).toBe(false);
  expect(horizontalDrift, `must not be pushed sideways off the platform:\n${detail}`).toBeLessThan(0.9);
  expect(modes.has('playing'), `run must stay live:\n${detail}`).toBe(true);
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});

test('standing still on a mover keeps the frog at the platform top', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('level-2');
  });

  const mover = LEVELS[1].platforms.find((platform) => platform.move?.axis === 'y');
  if (!mover) return;

  await page.evaluate(
    ({ x, y }) => window.__THREE_GAME_TEST_HOOKS__?.placePlayer?.(x, y, 0, -0.5),
    { x: mover.x, y: mover.y + 0.9 },
  );

  const samples = await sampleFor(page, 3000);
  const grounded = samples.filter((value) => value.grounded);
  expect(grounded.length, 'the frog must settle onto the platform').toBeGreaterThan(20);

  // While grounded, the frog's feet must track the platform top, not sink through or float.
  const worstSink = Math.min(...grounded.map((value) => value.y));
  const worstFloat = Math.max(...grounded.map((value) => value.y));
  const detail = `feet y range on the mover: [${worstSink.toFixed(3)}, ${worstFloat.toFixed(3)}], mover y=${mover.y} +-${mover.move!.range}`;

  expect(worstSink, `feet must not sink below the mover's full travel:\n${detail}`).toBeGreaterThan(
    mover.y - mover.move!.range - 0.35,
  );
  expect(worstFloat, `feet must not float above the mover's full travel:\n${detail}`).toBeLessThan(
    mover.y + mover.move!.range + 0.35,
  );
});
