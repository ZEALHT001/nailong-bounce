import { expect, test } from '@playwright/test';
import { collectPageErrors, waitForGame } from './helpers';

/**
 * Scripted playtests. These drive real input and assert the game actually progresses, so a
 * change that soft-locks the frog or breaks the charge verb fails here instead of shipping.
 */

test('bot playtest: charge-and-move covers ground without errors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The scripted bot drives keyboard input.');
  test.setTimeout(90_000);

  const errors = collectPageErrors(page);
  await waitForGame(page);

  const acknowledgement = await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('bot playtest requires test hooks');
    await hooks.seed(20261005);
    return hooks.setState('active-play');
  });
  expect(acknowledgement.state).toBe('active-play');

  const startX = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0);
  let maxX = startX;
  let sawLaunch = false;
  let sawLand = false;

  for (let hop = 0; hop < 14; hop += 1) {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(140);
    await page.keyboard.down('Space');
    await page.waitForTimeout(360 + (hop % 3) * 90);
    await page.keyboard.up('Space');
    await page.waitForTimeout(760);
    await page.keyboard.up('KeyD');

    const snapshot = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    if (!snapshot) break;
    maxX = Math.max(maxX, snapshot.player.position.x);
    if (snapshot.counters.launches > 0) sawLaunch = true;
    if (snapshot.counters.landings > 0) sawLand = true;

    if (snapshot.mode === 'failed' || snapshot.mode === 'won') break;
  }

  // Progress, not perfection: the verb has to carry the frog across real gaps.
  expect(maxX, 'charge-and-move must advance the frog').toBeGreaterThan(startX + 6);
  expect(sawLaunch, 'a charged release must register as a launch').toBe(true);
  expect(sawLand, 'the frog must land again within the script').toBe(true);

  const final = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(final?.frame ?? 0).toBeGreaterThan(10);
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});

test('bot playtest: hazards fail the run and retry returns to the spawn', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Overlay buttons are exercised on desktop.');

  const errors = collectPageErrors(page);
  await waitForGame(page);

  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('bot playtest requires test hooks');
    await hooks.setState('fail');
  });

  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#overlay-kicker')).toHaveText('再来一次');
  await expect(page.locator('#overlay-primary')).toHaveText('重试');

  const spawnX = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0);
  await page.locator('#overlay-primary').click();

  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'playing');
  await expect(page.locator('#overlay')).toBeHidden();

  const afterX = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0);
  expect(Math.abs(afterX - spawnX)).toBeLessThan(2);
  expect(errors.page).toEqual([]);
});

test('bot playtest: pause stops simulation and resume restores it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard pause is exercised on desktop.');

  await waitForGame(page);
  await page.locator('#pause-button').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#overlay-kicker')).toHaveText('已暂停');

  const pausedFrame = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0);
  await page.waitForTimeout(400);
  const laterFrame = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0);
  expect(laterFrame).toBeGreaterThan(pausedFrame);

  await page.locator('#overlay-primary').click();
  await expect(page.locator('#overlay')).toBeHidden();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode))
    .toBe('playing');
});

test('audio unlocks on a real gesture and mute is honoured', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop drives the audio assertions.');

  const errors = collectPageErrors(page);
  await waitForGame(page);

  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.unlocked)).toBe(false);

  // A real pointer gesture must unlock the audio context without throwing in headless.
  await page.locator('#pause-button').click();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.unlocked))
    .toBe(true);

  await page.locator('#overlay-primary').click();
  await expect(page.locator('#overlay')).toBeHidden();

  await page.locator('#mute-button').click();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.muted))
    .toBe(true);
  await expect(page.locator('#mute-button')).toHaveAttribute('data-muted', 'true');

  await page.locator('#mute-button').click();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.muted))
    .toBe(false);

  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
});
