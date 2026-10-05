import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectPageErrors, waitForGame } from './helpers';

/**
 * Mobile usability regressions.
 *
 * Two reported problems on phones:
 * 1. Long-pressing the charge button started a text selection and raised the system copy callout,
 *    which interrupts the jump.
 * 2. A portrait viewport showed far less of the level horizontally than a laptop, so the next
 *    platform was off screen until it was too late.
 */

test.describe('mobile usability', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.name.includes('mobile'),
      'These assertions are about the touch layout and the portrait framing.',
    );
  });

  test('touch controls cannot be selected or focused by a long press', async ({ page }) => {
    const errors = collectPageErrors(page);
    await waitForGame(page);

    // The controls, their labels and their icons must all opt out of selection and the iOS
    // callout, otherwise holding jump raises the copy menu mid-air.
    for (const selector of ['#charge-button', '#charge-button-label', '#move-left', '#move-right', '#touch-controls']) {
      const styles = await page.locator(selector).evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          userSelect: computed.userSelect || computed.webkitUserSelect,
          webkitUserSelect: computed.getPropertyValue('-webkit-user-select').trim(),
          touchCallout: computed.getPropertyValue('-webkit-touch-callout').trim(),
          touchAction: computed.touchAction,
        };
      });
      expect(styles.userSelect || styles.webkitUserSelect, `${selector} must not be selectable`).toBe('none');
    }

    // -webkit-touch-callout is Safari-only: Chromium neither reports it via getComputedStyle nor
    // keeps it in the CSSOM. Check the shipped stylesheet source instead, because without it iOS
    // still raises the copy callout on a long press.
    const css = readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css, 'the stylesheet must suppress the iOS callout').toContain('-webkit-touch-callout: none');
    expect(css, 'the stylesheet must disable text selection').toContain('user-select: none');

    // The label must not swallow the press meant for the button, or a long press lands on text.
    const labelPointerEvents = await page
      .locator('#charge-button-label')
      .evaluate((element) => getComputedStyle(element).pointerEvents);
    expect(labelPointerEvents, 'the charge label must not capture pointer events').toBe('none');

    expect(errors.page).toEqual([]);
    expect(errors.console).toEqual([]);
  });

  test('a long press on the charge button charges without selecting anything', async ({ page }) => {
    await waitForGame(page);

    const button = page.locator('#charge-button');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Well past the iOS long-press threshold that used to raise the callout.
    await page.waitForTimeout(800);

    const charging = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.charge ?? 0);
    const selection = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    await page.mouse.up();

    expect(charging, 'a long press must keep charging').toBeGreaterThan(0.2);
    expect(selection, 'a long press must not select text').toBe('');
  });

  test('the portrait camera shows enough of the level ahead', async ({ page }) => {
    await waitForGame(page);

    const view = await page.evaluate(() => {
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      if (!d) return null;
      return { ...d.view, playerX: d.player.position.x, aspect: d.canvas.clientWidth / d.canvas.clientHeight };
    });
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view.aspect, 'this test is about portrait viewports').toBeLessThan(1);
    // The next platform sits about 5-8 units ahead of a take-off lip, so the view has to cover
    // comfortably more than that or the player is jumping blind.
    expect(view.width, `horizontal span on screen (width=${view.width.toFixed(2)})`).toBeGreaterThan(11);
    const ahead = view.right - view.playerX;
    const behind = view.playerX - view.left;
    expect(ahead, `visible span ahead of the frog (ahead=${ahead.toFixed(2)})`).toBeGreaterThan(7);
    expect(ahead, 'a narrow viewport should look further ahead than behind').toBeGreaterThan(behind);
  });
});
