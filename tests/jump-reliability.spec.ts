import { expect, test, type Page } from '@playwright/test';
import { LEVELS } from '../src/game/levels';
import { collectPageErrors, waitForGame } from './helpers';

/**
 * "Sometimes the jump just does not come out."
 *
 * These tests turn that report into deterministic cases. Both failures they cover are classic
 * platformer bugs that only show up intermittently in play:
 *
 * 1. A jump released a moment before landing is silently eaten, because the launch is only
 *    allowed while the frog is grounded. Players release jump early all the time.
 * 2. Landing on the lip of a platform catches the frog's side and pushes it back off, instead of
 *    letting it land on the top.
 */

type State = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  mode: string;
  launches: number;
  charge: number;
};

async function state(page: Page): Promise<State | null> {
  return page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d) return null;
    return {
      x: d.player.position.x,
      y: d.player.position.y,
      vx: d.player.velocity.x,
      vy: d.player.velocity.y,
      grounded: d.grounded,
      mode: d.mode,
      launches: d.counters.launches,
      charge: d.charge,
    };
  });
}

async function place(page: Page, x: number, y: number, vx = 0, vy = 0): Promise<void> {
  await page.evaluate(
    ({ px, py, pvx, pvy }) => window.__THREE_GAME_TEST_HOOKS__?.placePlayer?.(px, py, pvx, pvy),
    { px: x, py: y, pvx: vx, pvy: vy },
  );
}

test('a jump released just before landing still fires (jump buffer)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  const errors = collectPageErrors(page);
  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
  });

  const platform = LEVELS[0].platforms[0];

  // The whole gesture runs inside the page. Driving key events over the test protocol costs about
  // a second per round trip here, which would make "release before landing" land after touchdown
  // and hide the bug entirely.
  const result = await page.evaluate(
    async ({ x, y, platformTop }) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      if (!hooks?.placePlayer) throw new Error('placePlayer hook missing');

      const key = (type: 'keydown' | 'keyup', code: string) =>
        window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const read = () => window.__THREE_GAME_DIAGNOSTICS__;

      hooks.placePlayer(x, y, 0, -1.6);

      const launchesBefore = read()?.counters.launches ?? 0;
      // Hold the jump button while still airborne, then release on the frame the frog is nearly
      // touching down but still in the air. Checking the height each frame keeps the gesture the
      // same regardless of how fast frames are running here.
      key('keydown', 'Space');
      let releasedAirborne = false;
      for (let i = 0; i < 120; i += 1) {
        const d = read();
        if (!d) break;
        const height = d.player.position.y - platformTop;
        if (d.grounded) break;
        if (height < 0.12) {
          releasedAirborne = true;
          break;
        }
        await frame();
      }
      // ...and release before touching down. A player reads this as "jump as I land".
      key('keyup', 'Space');

      let launched = false;
      let maxCharge = 0;
      for (let i = 0; i < 200; i += 1) {
        await frame();
        const d = read();
        if (!d) break;
        maxCharge = Math.max(maxCharge, d.charge);
        if (d.counters.launches > launchesBefore) {
          launched = true;
          break;
        }
      }
      return { releasedAirborne, launched, maxCharge, state: read() };
    },
    { x: platform.x, y: platform.y + 0.42, platformTop: platform.y },
  );

  expect(result.releasedAirborne, 'the release must really happen while airborne for this test to mean anything').toBe(true);
  expect(
    result.launched,
    `a jump released 0.09s before landing must still fire (y=${result.state?.player.position.y.toFixed(2)} grounded=${result.state?.grounded} vy=${result.state?.player.velocity.y.toFixed(2)})`,
  ).toBe(true);
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});

test('a jump held through the landing fires as soon as the frog is down', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
  });

  const platform = LEVELS[0].platforms[0];
  await place(page, platform.x, platform.y + 0.5, 0, -1.4);

  // Hold the button from the air, through the landing, and keep holding to charge.
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  const charging = await state(page);
  expect(charging?.charge ?? 0, 'holding through a landing should start charging').toBeGreaterThan(0.2);

  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  const after = await state(page);
  expect(after?.launches ?? 0, 'the held jump must launch').toBeGreaterThan(0);
});

test('landing on the lip of a platform lands on top instead of being pushed off', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  const errors = collectPageErrors(page);
  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
  });

  const platform = LEVELS[0].platforms[0];
  const rightEdge = platform.x + platform.w / 2;

  // Only the frog's left edge overlaps the platform, and only slightly: this is the "I caught the
  // corner" case. It must settle on the platform, not slide off the side.
  for (const overlap of [0.08, 0.16, 0.24]) {
    const x = rightEdge + 0.56 - overlap;
    await place(page, x, platform.y + 1.1, 0, -2.5);
    await page.waitForTimeout(700);
    const settled = await state(page);

    expect(
      settled?.grounded,
      `falling onto the lip with ${overlap} of overlap should land (x=${settled?.x.toFixed(2)} y=${settled?.y.toFixed(2)} mode=${settled?.mode})`,
    ).toBe(true);
    expect(
      Math.abs((settled?.y ?? -99) - platform.y),
      `the frog should be standing on the platform top, not below it (y=${settled?.y.toFixed(2)})`,
    ).toBeLessThan(0.2);
  }

  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});

test('a platform seen as a step is not blocked while walking', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
  });

  // Walk off the first platform towards the second. The launch has to remain available the whole
  // way to the lip: getting blocked short of the edge is what "stuck" feels like.
  const platform = LEVELS[0].platforms[0];
  const reachable = platform.x + platform.w / 2 - 0.6;

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyD');
  const walked = await state(page);

  expect(
    walked?.x ?? 0,
    `holding right should carry the frog to the lip (reached x=${walked?.x.toFixed(2)}, wanted ${reachable.toFixed(2)})`,
  ).toBeGreaterThan(reachable - 0.35);
});

test('a very short tap of the jump button is not swallowed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
  });

  const platform = LEVELS[0].platforms[0];

  // Press and release inside a single frame. At a low frame rate no physics step ever observes the
  // button as held, so without an explicit tap latch the input disappears completely.
  const result = await page.evaluate(
    async ({ x, y }) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      if (!hooks?.placePlayer) throw new Error('placePlayer hook missing');
      const key = (type: 'keydown' | 'keyup', code: string) =>
        window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const read = () => window.__THREE_GAME_DIAGNOSTICS__;

      hooks.placePlayer(x, y, 0, 0);
      await frame();
      await frame();

      const launchesBefore = read()?.counters.launches ?? 0;
      key('keydown', 'Space');
      key('keyup', 'Space');

      let launched = false;
      for (let i = 0; i < 120; i += 1) {
        await frame();
        if ((read()?.counters.launches ?? 0) > launchesBefore) {
          launched = true;
          break;
        }
      }
      return { launched, state: read() };
    },
    { x: platform.x, y: platform.y },
  );

  expect(
    result.launched,
    `a tap that starts and ends inside one frame must still jump (grounded=${result.state?.grounded} charge=${result.state?.charge.toFixed(2)})`,
  ).toBe(true);
});

test('a horizontally moving platform pushes the frog out instead of trapping it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Deterministic placement needs desktop hooks.');

  const errors = collectPageErrors(page);
  await waitForGame(page);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__?.setState('level-2');
  });

  const moverIndex = LEVELS[1].platforms.findIndex((platform) => platform.move?.axis === 'x');
  expect(moverIndex, 'level 2 should have a horizontally moving platform').toBeGreaterThan(0);

  // Stand the frog in the path of the mover, on a static platform at the mover's height is not
  // available, so drop it into the mover's lane and let the mover come to it.
  const placed = await page.evaluate(
    async ({ index }) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      if (!hooks?.placePlayer) throw new Error('placePlayer hook missing');
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      if (!d) throw new Error('diagnostics missing');
      const rect = d.platforms[index];
      // Halfway between the mover's two extremes, at its top height, with no horizontal speed.
      hooks.placePlayer(rect.minX - rect.maxX + rect.minX + (rect.maxX - rect.minX) / 2, rect.maxY, 0, 0);
      return { rect };
    },
    { index: moverIndex },
  );

  // Watch a full travel cycle and make sure the frog is never left embedded inside the platform.
  const embedded = await page.evaluate(
    async ({ index, ms }) => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const deadline = performance.now() + ms;
      let worst = 0;
      while (performance.now() < deadline) {
        const d = window.__THREE_GAME_DIAGNOSTICS__;
        if (d) {
          const rect = d.platforms[index];
          const { x, y } = d.player.position;
          const insideX = x > rect.minX + 0.05 && x < rect.maxX - 0.05;
          const insideY = y > rect.minY + 0.05 && y < rect.maxY - 0.05;
          if (insideX && insideY) worst += 1;
        }
        await frame();
      }
      return worst;
    },
    { index: moverIndex, ms: 2600 },
  );

  expect(placed.rect, 'the mover must exist').toBeTruthy();
  expect(embedded, 'the frog must not sit embedded inside a moving platform').toBe(0);
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});
