/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  mode: 'playing' | 'paused' | 'failed' | 'won' | 'complete';
  level: number;
  levelName: string;
  score: number;
  treats: number;
  treatTotal: number;
  runTime: number;
  charging: boolean;
  charge: number;
  grounded: boolean;
  player: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number };
    speed: number;
  };
  lastEvents: {
    landed: number;
    padBounce: number;
    hitWall: -1 | 0 | 1;
    hitCeiling: boolean;
    launched: number;
  };
  counters: {
    launches: number;
    landings: number;
    padBounces: number;
    hurts: number;
    wins: number;
  };
  audio: {
    unlocked: boolean;
    muted: boolean;
  };
  /** Live platform geometry, in authored order. Moving platforms report their current position. */
  platforms: Array<{ index: number; minX: number; maxX: number; minY: number; maxY: number }>;
  /** Horizontal slice of the play plane currently on screen, in world units. */
  view: { width: number; left: number; right: number };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throw for unknown states. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation/state transitions immediately; keep rendering. Await optional synchronization. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals without requiring an unpaused simulation tick. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
  /** Deterministic jump-envelope probe: release a charged jump on flat ground and measure it. */
  measureJump?(power: number): { distance: number; apex: number; airTime: number };
  /** Test-only teleport, used to set up contact situations deterministically. */
  placePlayer?(x: number, y: number, vx?: number, vy?: number): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
  __HERO_PREVIEW__?: { view: string; state: string; ready: boolean };
}
