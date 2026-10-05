/**
 * Level data for 奶蛙弹跳.
 *
 * Conventions
 * - A platform's `y` is its TOP surface; `x` is its horizontal centre.
 * - A pad's `y` is the surface the frog lands on; pads launch much higher than a charge jump.
 * - Every gap is authored to be clearable with a ~0.75 charge so the level stays readable,
 *   with pads opening the faster and higher routes.
 */

export type MoveSpec = {
  axis: 'x' | 'y';
  range: number;
  speed: number;
  phase?: number;
};

export type PlatformSpec = {
  x: number;
  y: number;
  w: number;
  h: number;
  oneWay?: boolean;
  move?: MoveSpec;
};

export type PadSpec = { x: number; y: number };

export type HazardSpec = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'spike' | 'water';
};

export type TreatSpec = { x: number; y: number };

export type LevelSpec = {
  name: string;
  tagline: string;
  theme: number;
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
  parTime: number;
  platforms: PlatformSpec[];
  pads: PadSpec[];
  hazards: HazardSpec[];
  treats: TreatSpec[];
};

export const LEVELS: LevelSpec[] = [
  {
    name: '甜筒草地',
    tagline: '按住蓄力，松手起跳',
    theme: 0,
    spawn: { x: -1.5, y: 0.4 },
    goal: { x: 37.5, y: 2.3 },
    parTime: 45,
    platforms: [
      { x: 1, y: 0, w: 11, h: 1.3 },
      { x: 10.6, y: 0.7, w: 3.6, h: 1.3 },
      { x: 17.4, y: 1.5, w: 3.6, h: 1.35 },
      { x: 25, y: 2.3, w: 4.2, h: 1.4 },
      { x: 35.5, y: 2.3, w: 5.6, h: 1.4 },
    ],
    pads: [{ x: 26.6, y: 2.85 }],
    hazards: [{ x: 29.9, y: -3.0, w: 5.6, h: 1.4, kind: 'water' }],
    treats: [
      { x: 3.4, y: 1.3 },
      { x: 14, y: 2.6 },
      { x: 17.4, y: 3 },
      { x: 29.4, y: 5.4 },
      { x: 35.5, y: 3.4 },
    ],
  },
  {
    name: '果冻栈道',
    tagline: '会动的果冻，小心尖刺',
    theme: 1,
    spawn: { x: -1.5, y: 0.4 },
    goal: { x: 44.6, y: 2.9 },
    parTime: 60,
    platforms: [
      { x: 0, y: 0, w: 10, h: 1.3 },
      { x: 9.8, y: 0.6, w: 3.4, h: 1.3, move: { axis: 'y', range: 1.2, speed: 1.1, phase: 0 } },
      { x: 17.6, y: 1.4, w: 4, h: 1.35, move: { axis: 'x', range: 1.8, speed: 0.9, phase: 1.2 } },
      { x: 26, y: 2.2, w: 4.6, h: 1.4 },
      { x: 34.4, y: 2.2, w: 3.6, h: 1.4, move: { axis: 'y', range: 1.4, speed: 1.25, phase: 2.4 } },
      { x: 42.6, y: 2.9, w: 6.5, h: 1.45 },
    ],
    pads: [{ x: 27.2, y: 2.75 }],
    hazards: [
      // Sits under the gap, not under the moving platform's travel: landing ON the platform
      // must always be safe, and only falling short should be punished.
      { x: 12.6, y: -3.0, w: 2.0, h: 1.4, kind: 'spike' },
      { x: 31.5, y: -3.0, w: 3, h: 1.4, kind: 'spike' },
    ],
    treats: [
      { x: 3.6, y: 1.3 },
      { x: 9.8, y: 3.2 },
      { x: 21.5, y: 4.2 },
      { x: 30.5, y: 5.6 },
      { x: 42.6, y: 4 },
    ],
  },
  {
    name: '弹跳峡谷',
    tagline: '踩着弹板连跳，别掉进水里',
    theme: 2,
    spawn: { x: -1.5, y: 0.4 },
    goal: { x: 49, y: 3.2 },
    parTime: 70,
    platforms: [
      { x: 0, y: 0, w: 10, h: 1.3 },
      { x: 9.6, y: 0.8, w: 3, h: 1.35 },
      { x: 17, y: 1.8, w: 2.8, h: 1.4 },
      { x: 24.6, y: 1.8, w: 3, h: 1.4 },
      { x: 32.6, y: 2.4, w: 3.6, h: 1.45 },
      { x: 40.8, y: 2.8, w: 3.4, h: 1.5 },
      { x: 49, y: 3.2, w: 6.5, h: 1.5 },
    ],
    pads: [
      { x: 10.2, y: 1.05 },
      { x: 24.6, y: 2.05 },
      { x: 41.6, y: 3.05 },
    ],
    hazards: [
      { x: 6.65, y: -3.0, w: 2.4, h: 1.4, kind: 'spike' },
      { x: 13.35, y: -3.1, w: 4.5, h: 1.4, kind: 'water' },
      { x: 20.7, y: -3.1, w: 4.6, h: 1.4, kind: 'water' },
      { x: 28.45, y: -3.1, w: 4.6, h: 1.4, kind: 'water' },
      { x: 36.7, y: -3.1, w: 4.6, h: 1.4, kind: 'water' },
      { x: 44.1, y: -3.1, w: 3.3, h: 1.4, kind: 'water' },
    ],
    treats: [
      { x: 3.4, y: 1.0 },
      { x: 9.6, y: 1.8 },
      { x: 17, y: 2.8 },
      { x: 24.6, y: 2.8 },
      { x: 32.6, y: 3.4 },
      { x: 49, y: 4.2 },
    ],
  },
  {
    name: '棉花云顶',
    tagline: '会飘的云，会咬人的尖刺',
    theme: 3,
    spawn: { x: -1.5, y: 0.4 },
    goal: { x: 55, y: 3.8 },
    parTime: 85,
    platforms: [
      { x: 0, y: 0, w: 10, h: 1.3 },
      { x: 9.8, y: 1, w: 3, h: 1.35, move: { axis: 'y', range: 1.2, speed: 1.2, phase: 0 } },
      { x: 17.2, y: 2, w: 3.4, h: 1.4 },
      { x: 24, y: 2.6, w: 3.2, h: 1.45, move: { axis: 'x', range: 1.2, speed: 1.15, phase: 0.8 } },
      { x: 32, y: 3.2, w: 3.2, h: 1.45 },
      // Static on purpose: the pad on the previous platform has to land somewhere predictable, so
      // the moving platform went to the last step instead of sitting in a bounce-pad landing zone.
      { x: 39.8, y: 3.2, w: 3, h: 1.45 },
      { x: 47.6, y: 3.6, w: 3.2, h: 1.5, move: { axis: 'y', range: 1.0, speed: 1.3, phase: 1.9 } },
      { x: 55, y: 3.8, w: 6.5, h: 1.5 },
    ],
    pads: [
      { x: 10.2, y: 1.45 },
      { x: 31.8, y: 3.45 },
    ],
    hazards: [
      { x: 6.65, y: -3.0, w: 2.4, h: 1.4, kind: 'spike' },
      { x: 13.4, y: -3.2, w: 4.2, h: 1.5, kind: 'water' },
      { x: 20.05, y: -3.2, w: 2.3, h: 1.5, kind: 'water' },
      { x: 28, y: -3.2, w: 4.8, h: 1.5, kind: 'water' },
      { x: 35.95, y: -3.2, w: 4.7, h: 1.5, kind: 'water' },
      { x: 43.65, y: -3.2, w: 4.7, h: 1.5, kind: 'water' },
      { x: 50.5, y: -3.0, w: 2.5, h: 1.4, kind: 'spike' },
    ],
    treats: [
      { x: 3.4, y: 1.0 },
      { x: 9.8, y: 1.9 },
      { x: 17.2, y: 2.9 },
      { x: 24, y: 3.5 },
      { x: 32, y: 4.1 },
      { x: 39.8, y: 4.1 },
      { x: 55, y: 4.7 },
    ],
  },
];

/** Horizontal world extent used to place backdrops and clamp decorative props. */
export function levelExtent(level: LevelSpec): { min: number; max: number } {
  let min = level.spawn.x - 10;
  let max = level.goal.x + 12;
  for (const platform of level.platforms) {
    min = Math.min(min, platform.x - platform.w / 2 - 6);
    max = Math.max(max, platform.x + platform.w / 2 + 6);
  }
  return { min, max };
}
