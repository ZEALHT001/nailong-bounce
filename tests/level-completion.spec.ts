import { expect, test } from '@playwright/test';
import { LEVELS } from '../src/game/levels';
import { collectPageErrors, waitForGame } from './helpers';
import { measureEnvelope, resetToLevel, runLevelBot } from './levelBot';

/**
 * Proves the core loop is playable rather than merely present.
 *
 * `jump distance grows with charge` measures the shipped integrator directly. The completion
 * tests then invert that measured envelope to pick a charge for each authored gap and fly the
 * level with real keyboard input, so they fail if the physics and the level data stop agreeing.
 *
 * Every level gets a scripted completion run. Levels 3 and 4 also exercise moving platforms and
 * bounce-pad chains, which is where "I jumped on it and got thrown off" bugs live.
 */

test('jump distance grows with charge', async ({ page }) => {
  await waitForGame(page);

  const envelope = await measureEnvelope(page);
  const byPower = new Map(envelope.map((sample) => [sample.power, sample.distance]));
  const weak = byPower.get(0.05) ?? 0;
  const mid = byPower.get(0.5) ?? 0;
  const strong = byPower.get(0.95) ?? 0;

  expect(weak, 'the shortest hop must be small').toBeLessThan(3);
  expect(mid, 'a half charge must beat the shortest hop').toBeGreaterThan(weak + 0.8);
  expect(strong, 'a full charge must beat a half charge').toBeGreaterThan(mid + 1.5);

  // The envelope must be monotonic, otherwise "charge more to go further" is a lie.
  for (let i = 1; i < envelope.length; i += 1) {
    expect(
      envelope[i].distance,
      `charge ${envelope[i].power} must reach at least as far as ${envelope[i - 1].power}`,
    ).toBeGreaterThanOrEqual(envelope[i - 1].distance - 0.02);
  }
});

test('every authored gap is inside the measured jump envelope', async ({ page }) => {
  await waitForGame(page);
  const envelope = await measureEnvelope(page);
  const maxDistance = Math.max(...envelope.map((sample) => sample.distance));
  const minDistance = Math.min(...envelope.map((sample) => sample.distance));

  const problems: string[] = [];
  const demands: string[] = [];

  for (const level of LEVELS) {
    let hardest = 0;
    for (let index = 0; index < level.platforms.length - 1; index += 1) {
      const from = level.platforms[index];
      const to = level.platforms[index + 1];
      const fromRange = from.move?.axis === 'x' ? from.move.range : 0;
      const toRange = to.move?.axis === 'x' ? to.move.range : 0;
      // Worst case: the take-off platform at its furthest back and the landing platform at
      // its furthest forward.
      const gap = to.x - to.w / 2 + toRange - (from.x + from.w / 2 - fromRange);
      if (gap <= 0) continue;

      // The frog's centre only has to travel the gap minus the half-body overhang at each lip.
      const needed = Math.max(0.4, gap - 1.12);
      if (needed > maxDistance) {
        problems.push(
          `${level.name} platforms ${index}->${index + 1}: gap ${gap.toFixed(2)} needs ${needed.toFixed(2)}, max ${maxDistance.toFixed(2)}`,
        );
      }
      hardest = Math.max(hardest, needed);
    }
    demands.push(`${level.name}: hardest gap needs ${hardest.toFixed(2)} of ${maxDistance.toFixed(2)}`);

    // A level whose gaps are all cleared by the smallest hop never asks the player to charge.
    if (hardest <= minDistance) {
      problems.push(`${level.name}: no gap requires more than the shortest hop`);
    }
  }

  expect(problems, `charge-vs-gap audit:\n${demands.join('\n')}`).toEqual([]);
});

for (let index = 0; index < LEVELS.length; index += 1) {
  const level = LEVELS[index];
  test(`bot completes level ${index + 1}: ${level.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'The scripted bot drives keyboard input.');
    test.setTimeout(180_000);

    const errors = collectPageErrors(page);
    await waitForGame(page);

    const envelope = await measureEnvelope(page);
    // Measuring the envelope rebuilds the level repeatedly, so reset before driving input.
    await resetToLevel(page, index);

    const result = await runLevelBot(page, index, envelope);
    const detail = `level ${index + 1} ${level.name}: mode=${result.mode} hops=${result.hops}\n${result.trace.join('\n')}`;

    expect(result.mode, `scripted run trace:\n${detail}`).toBe('won');
    expect(result.score, 'the run should have collected at least one treat').toBeGreaterThan(0);
    expect(errors.page).toEqual([]);
    expect(errors.console).toEqual([]);
  });
}
