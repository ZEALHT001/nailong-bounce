import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export type CanvasSample = {
  ok: boolean;
  reason: string;
  variance: number;
  colorBuckets: number;
  litPixels: number;
};

/** Samples the WebGL canvas for a non-blank, colour-varied frame. */
export async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small', variance: 0, colorBuckets: 0, litPixels: 0 };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let litPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 8192));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) litPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: litPixels > 256 && (variance > 8 || buckets.size > 3),
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
    litPixels,
  };
}

/** Waits until the game has published diagnostics for a few frames. */
export async function waitForGame(page: Page, frames = 12): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(
    (minimum) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > minimum,
    frames,
  );
}

export function collectPageErrors(page: Page): { console: string[]; page: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { console: consoleErrors, page: pageErrors };
}

/**
 * Holds a control for `ms`. Uses keyboard on desktop and real pointer events on the touch
 * layout, so both projects exercise the same intents through their own device path.
 */
export async function holdControl(
  page: Page,
  control: 'left' | 'right' | 'charge',
  ms: number,
  mobile: boolean,
): Promise<void> {
  if (mobile) {
    const selector = control === 'left' ? '#move-left' : control === 'right' ? '#move-right' : '#charge-button';
    const button = page.locator(selector);
    const box = await button.boundingBox();
    if (!box) throw new Error(`Missing touch control: ${selector}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    return;
  }

  const key = control === 'left' ? 'KeyA' : control === 'right' ? 'KeyD' : 'Space';
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
