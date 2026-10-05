#!/usr/bin/env node
/** Prints the real charge -> jump-distance envelope, plus the gaps authored in each level. */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5188/');
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

const rows = await page.evaluate(async () => {
  const hooks = window.__THREE_GAME_TEST_HOOKS__;
  if (!hooks?.measureJump) throw new Error('measureJump hook missing');
  const out = [];
  for (const power of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
    const result = await hooks.measureJump(power);
    out.push({ power, ...result });
  }
  return out;
});

console.log('charge  distance  apex   airtime');
for (const row of rows) {
  console.log(
    `${row.power.toFixed(2)}    ${String(row.distance).padStart(7)}  ${String(row.apex).padStart(5)}  ${row.airTime}`,
  );
}

await browser.close();
