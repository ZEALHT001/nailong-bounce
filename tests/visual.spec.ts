import { expect, test } from '@playwright/test';
import { collectPageErrors, sampleCanvas, waitForGame } from './helpers';

test('renders a non-blank game canvas', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);

  await waitForGame(page);
  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  expect(errors.console).toEqual([]);
  expect(errors.page).toEqual([]);
});

test('the frog charges and moves right under real input', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  const errors = collectPageErrors(page);

  await waitForGame(page);
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('test hooks missing');
    await hooks.seed(12345);
    await hooks.setState('active-play');
  });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0);

  // Hold charge while pushing right: the charge must read in diagnostics, then the frog must
  // end up to the right of where it started.
  if (mobile) {
    const charge = page.locator('#charge-button');
    const right = page.locator('#move-right');
    const chargeBox = await charge.boundingBox();
    const rightBox = await right.boundingBox();
    expect(chargeBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    if (!chargeBox || !rightBox) return;

    await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(180);

    // Second pointer for the charge button is not available with one mouse, so release the
    // move control, charge, then re-press move for the flight.
    await page.mouse.up();
    await page.mouse.move(chargeBox.x + chargeBox.width / 2, chargeBox.y + chargeBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(520);
    const charging = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.charge ?? 0);
    expect(charging).toBeGreaterThan(0.2);
    await page.mouse.up();

    await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  } else {
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await page.waitForTimeout(520);
    const charging = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.charge ?? 0);
    expect(charging).toBeGreaterThan(0.2);
    await page.keyboard.up('Space');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyD');
  }

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0))
    .toBeGreaterThan(before + 1.5);

  expect(errors.console).toEqual([]);
  expect(errors.page).toEqual([]);
});
