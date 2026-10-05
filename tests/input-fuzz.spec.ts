import { expect, test } from '@playwright/test';
import { LEVELS } from '../src/game/levels';
import { waitForGame } from './helpers';

/**
 * Randomised input fuzz over every level.
 *
 * The reported symptom is intermittent ("sometimes the jump sticks"), which is exactly the shape
 * of bug that a hand-written scenario misses. This drives thousands of frames of seeded random
 * input and asserts hard invariants on the result: the frog is never left embedded inside a
 * platform, never produces NaN, and never stops being simulated.
 */

test('random input never wedges the frog inside geometry on any level', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The fuzz loop needs the desktop diagnostics hooks.');
  test.setTimeout(240_000);

  await waitForGame(page);

  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex += 1) {
    const report = await page.evaluate(
      async ({ index, frameBudget, seed }) => {
        const hooks = window.__THREE_GAME_TEST_HOOKS__;
        if (!hooks) throw new Error('test hooks missing');
        await hooks.setState(index === 0 ? 'active-play' : `level-${index + 1}`);
        // Let the frog settle onto the first platform before fuzzing.
        for (let i = 0; i < 40; i += 1) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }

        // Deterministic PRNG so a failure is reproducible.
        let state = seed >>> 0;
        const rng = () => {
          state = (state + 0x6d2b79f5) >>> 0;
          let t = state;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        const key = (type: 'keydown' | 'keyup', code: string) =>
          window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const read = () => window.__THREE_GAME_DIAGNOSTICS__;

        let holdingLeft = false;
        let holdingRight = false;
        let holdingCharge = false;
        const setDir = (dir: 'left' | 'right' | 'none') => {
          if (dir === 'left' && !holdingLeft) {
            key('keydown', 'KeyA');
            holdingLeft = true;
          } else if (dir !== 'left' && holdingLeft) {
            key('keyup', 'KeyA');
            holdingLeft = false;
          }
          if (dir === 'right' && !holdingRight) {
            key('keydown', 'KeyD');
            holdingRight = true;
          } else if (dir !== 'right' && holdingRight) {
            key('keyup', 'KeyD');
            holdingRight = false;
          }
        };
        const setCharge = (held: boolean) => {
          if (held === holdingCharge) return;
          key(held ? 'keydown' : 'keyup', 'Space');
          holdingCharge = held;
        };

        let embeddedFrames = 0;
        let nanFrames = 0;
        let frozenFrames = 0;
        let lastRunTime = read()?.runTime ?? 0;
        let lastFrame = read()?.frame ?? 0;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let worstEmbed = 'none';

        for (let i = 0; i < frameBudget; i += 1) {
          // Change intent on a slow cadence so the frog actually commits to moves.
          if (i % 11 === 0) {
            const roll = rng();
            setDir(roll < 0.42 ? 'right' : roll < 0.58 ? 'left' : 'none');
          }
          if (i % 17 === 0) setCharge(rng() < 0.55);

          await frame();
          const d = read();
          if (!d) continue;

          const { x, y } = d.player.position;
          if (!Number.isFinite(x) || !Number.isFinite(y) || Number.isNaN(d.player.velocity.x)) {
            nanFrames += 1;
            continue;
          }
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);

          for (const rect of d.platforms) {
            const insideX = x > rect.minX + 0.06 && x < rect.maxX - 0.06;
            const insideY = y > rect.minY + 0.06 && y < rect.maxY - 0.06;
            if (insideX && insideY) {
              embeddedFrames += 1;
              if (worstEmbed === 'none') {
                worstEmbed = `frame ${i}: x=${x.toFixed(2)} y=${y.toFixed(2)} inside platform ${rect.index} [${rect.minX.toFixed(2)}..${rect.maxX.toFixed(2)}]x[${rect.minY.toFixed(2)}..${rect.maxY.toFixed(2)}]`;
              }
              break;
            }
          }

          // Time must keep flowing: a permanently frozen simulation is a hard failure.
          if (d.mode === 'playing') {
            if (d.runTime <= lastRunTime - 0.001 && d.frame <= lastFrame) frozenFrames += 1;
            lastRunTime = Math.max(lastRunTime, d.runTime);
            lastFrame = Math.max(lastFrame, d.frame);
          }

          // A failed run restarts the level; keep fuzzing the fresh state.
          if (d.mode === 'failed') {
            await hooks.setState(index === 0 ? 'active-play' : `level-${index + 1}`);
            for (let k = 0; k < 30; k += 1) await frame();
          }
        }

        setDir('none');
        setCharge(false);

        return { frames: frameBudget, embeddedFrames, nanFrames, frozenFrames, minX, maxX, worstEmbed };
      },
      { index: levelIndex, frameBudget: 700, seed: 20261005 + levelIndex },
    );

    const detail =
      `level ${levelIndex + 1} ${LEVELS[levelIndex].name}: ${JSON.stringify(report)}`;
    expect(report.nanFrames, `no NaN in position/velocity\n${detail}`).toBe(0);
    expect(report.embeddedFrames, `the frog must never be embedded inside geometry\n${report.worstEmbed}\n${detail}`).toBe(0);
    expect(report.frozenFrames, `simulation time must keep advancing\n${detail}`).toBe(0);
  }
});
