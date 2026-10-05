#!/usr/bin/env node
/**
 * Captures hero-model previews from several angles.
 *
 * Usage: node scripts/shoot-hero.mjs [--url http://127.0.0.1:5188] [--out artifacts/hero]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const baseUrl = arg('url', 'http://127.0.0.1:5188');
const outDir = path.resolve(arg('out', 'artifacts/hero'));
const views = (arg('views', 'front,three-quarter,side,back')).split(',');
const state = arg('state', 'idle');
const charge = arg('charge', '0');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

for (const view of views) {
  const url = `${baseUrl}/hero.html?view=${view}&state=${state}&charge=${charge}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__HERO_PREVIEW__?.ready === true).catch(() => {});
  await page.waitForTimeout(250);
  const file = path.join(outDir, `${state}-${view}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured ${file}`);
}

await browser.close();
if (errors.length > 0) {
  console.error(`page errors:\n${errors.join('\n')}`);
  process.exitCode = 1;
}
