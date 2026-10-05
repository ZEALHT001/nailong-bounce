import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Player } from '../entities/Player';
import { LEVELS, type LevelSpec } from './levels';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, formatTime, type OverlayKind } from '../systems/Hud';
import { LevelWorld } from '../systems/LevelWorld';
import { FIXED_DT, type StepEvents } from '../systems/PlatformerPhysics';
import { colliderFromBox, stepBody } from '../systems/PlatformerPhysics';
import { PHYSICS } from '../systems/PlatformerPhysics';
import { VfxSystem } from '../systems/VfxSystem';
import { createSeededRandom } from '../utils/random';
import { getTheme } from '../world/PropKit';

type Mode = 'playing' | 'paused' | 'failed' | 'won' | 'complete';

type PendingOverlay = {
  kind: OverlayKind;
  title: string;
  subtitle: string;
  primary: string;
  secondary?: string;
  delay: number;
};

const VFX_PALETTE = [
  0xf5c542, 0x4fd18c, 0xef6a5a, 0x63b7e6, 0xfdf6dd, 0xffffff,
];

const TRAUMA_PICKUP = 0.14;
const TRAUMA_LAND = 0.3;
const TRAUMA_BOUNCE = 0.45;
const TRAUMA_HURT = 0.75;

/** Upper bound on physics substeps per frame, so a hitch cannot stall the frame. */
const MAX_SUBSTEPS = 8;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly audio = new AudioSystem();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly vfx = new VfxSystem(VFX_PALETTE, () => this.rng());
  private readonly hud: Hud;
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = {
    exposure: 1.02,
    maxDpr: 2,
    hitstopScale: 0.06,
    shakeAmount: 1,
  };

  private readonly debugTools: DebugTools;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly skyTexture: THREE.CanvasTexture;

  private world: LevelWorld;
  private levelIndex = 0;
  private mode: Mode = 'playing';
  private frame = 0;
  private elapsed = 0;
  private runTime = 0;
  private accumulator = 0;
  private score = 0;
  private levelScore = 0;
  private treatsThisLevel = 0;
  private pendingOverlay: PendingOverlay | null = null;
  private overlayDelay = 0;
  private trauma = 0;
  private padCooldown = 0;
  private shakeTime = 0;
  private timeScale = 1;
  private hitstopRemaining = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private muted = false;
  private lastEvents: StepEvents = emptyEvents();
  /** Cumulative run counters. Per-step events are gone by the time a test samples them. */
  private counters = { launches: 0, landings: 0, padBounces: 0, hurts: 0, wins: 0 };
  // Route ALL gameplay randomness through this.rng (never Math.random) so the seed() test
  // hook keeps screenshot baselines and bot playtests deterministic.
  private rng = createSeededRandom(20261005);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;

    this.input = new InputController(
      this.getElement('#move-left'),
      this.getElement('#move-right'),
      this.getElement('#charge-button'),
    );

    this.hud = new Hud({
      onPauseToggle: () => this.togglePause(),
      onMuteToggle: () => this.toggleMute(),
      onPrimary: () => this.handlePrimary(),
      onSecondary: () => this.handleSecondary(),
    });

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.hemisphere = new THREE.HemisphereLight('#ffffff', '#3b4a33', 1.5);
    this.sun = new THREE.DirectionalLight('#fff3cd', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 46;
    this.sun.shadow.camera.left = -13;
    this.sun.shadow.camera.right = 13;
    this.sun.shadow.camera.top = 14;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.hemisphere);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.skyTexture = new THREE.CanvasTexture(document.createElement('canvas'));
    this.scene.background = this.skyTexture;

    this.scene.add(this.player.group);
    this.scene.add(this.vfx.group);

    this.world = new LevelWorld(LEVELS[0], this.rng);
    this.scene.add(this.world.root);
    this.applyTheme(LEVELS[0]);
    this.loadLevel(0);

    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.vfx.dispose();
    this.player.dispose();
    this.world.dispose();
    this.skyTexture.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ------------------------------------------------------------------ loop --

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.shakeTime += delta;

    // Feedback stays alive during hitstop, so the banner/HUD use real delta.
    this.hud.tick(delta);
    this.handleCommands();
    // One-shot key presses must expire every frame, otherwise a Space held long ago keeps
    // auto-confirming overlays the moment they appear.
    this.input.endFrame();
    // A press and release inside one frame never reaches a physics step, so queue it as a short
    // buffered jump instead of dropping the input.
    if (this.input.consumeChargeTap()) {
      this.player.body.jumpBuffer = PHYSICS.jumpBufferTime;
      this.player.body.bufferedPower = PHYSICS.minBufferedPower;
    }

    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    const scaled = delta * this.timeScale;
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= delta;
      if (this.hitstopRemaining <= 0) this.timeScale = 1;
    }

    const animDelta = this.reducedMotion ? 0 : scaled;
    const animElapsed = this.reducedMotion ? 0 : elapsed;
    this.elapsed = animElapsed;

    if (this.mode === 'playing') {
      this.runTime += scaled;
      this.accumulator += Math.min(scaled, 0.1);
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        this.physicsStep();
        this.accumulator -= FIXED_DT;
        steps += 1;
        if (this.mode !== 'playing') break;
      }
      // Drop time we could not simulate. Letting the leftover build up would leave the game in
      // permanent slow motion on a device that cannot keep up, which reads in play as everything
      // getting sticky rather than as a frame rate problem.
      this.accumulator = Math.min(this.accumulator, FIXED_DT * 2);
    } else if (this.mode === 'failed' || this.mode === 'won') {
      this.accumulator = 0;
    }

    this.world.update(animDelta, animElapsed);
    this.vfx.update(animDelta);

    const airborne = !this.player.body.grounded && this.mode === 'playing';
    // Reframe for the current viewport: a portrait phone sees far less horizontally than a
    // laptop, so the camera pulls back and leads further ahead on narrow screens.
    this.cameraRig.setAspect(this.camera.aspect);
    this.cameraRig.update(delta, this.player.body, airborne);
    this.applyShake(delta);
    this.updateSun();

    this.player.render(animDelta, animElapsed);
    this.audio.update(delta, this.dangerLevel());
    this.audio.setCharge(this.player.body.charge, this.mode === 'playing' && this.player.body.charge > 0);
    this.hud.setCharge(this.player.body.charge, this.mode === 'playing' && this.player.body.charge > 0);

    this.updateGoalIndicator();
    this.hud.update(this.score, this.treatsThisLevel, this.world.treats.length, this.runTime, this.mode === 'playing');
    this.advanceOverlay(delta);
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------- gameplay --

  private physicsStep(): void {
    // Movers advance on the same fixed step as the player, so a rider inherits the platform's
    // real per-step motion instead of a whole rendered frame of it.
    this.world.advanceMovers(FIXED_DT);

    const move = this.input.readMove();
    const chargeHeld = this.input.isChargeHeld();
    const events = this.player.step(FIXED_DT, move, chargeHeld, this.world.colliders);

    // Pads are triggers: a walking or falling frog that touches the pad gets launched.
    this.padCooldown = Math.max(0, this.padCooldown - FIXED_DT);
    if (this.padCooldown <= 0 && this.player.body.vy <= 0.2) {
      const body = this.player.body;
      const pad = this.world.padTriggerAt(
        body.x - body.halfWidth,
        body.y,
        body.x + body.halfWidth,
        body.y + body.height,
      );
      if (pad) {
        body.vy = PHYSICS.padLaunch;
        // A pad converts motion into a mostly vertical launch and normalises horizontal drift.
        // Preserving a near-full-charge launch speed sent the frog 12 units past the platform the
        // pad was meant to deliver it to.
        if (Math.abs(body.vx) > 0.4) {
          body.vx =
            Math.sign(body.vx) *
            Math.min(Math.max(Math.abs(body.vx), PHYSICS.padSpeed), PHYSICS.maxSpeed);
        }
        body.grounded = false;
        body.groundId = null;
        body.charge = 0;
        body.chargeLock = PHYSICS.chargeLockTime;
        // A pad launch owns the frog's next moment; a queued jump must not stack on top of it.
        body.jumpBuffer = 0;
        this.padCooldown = 0.25;
        events.padBounce = 1;
      }
    }

    this.lastEvents = events;

    if (events.launched > 0) {
      this.counters.launches += 1;
      this.audio.launch(events.launched);
      this.vfx.burst(this.player.body.x, this.player.body.y + 0.1, 0.3 + events.launched * 0.7, 'ground');
      this.addTrauma(0.1 + events.launched * 0.14);
      this.player.setState('launch');
    } else if (events.padBounce > 0) {
      this.counters.padBounces += 1;
      this.audio.bounce(events.padBounce);
      this.world.pulsePadAt(this.player.body.x, this.player.body.y);
      this.vfx.burst(this.player.body.x, this.player.body.y, 1, 'bounce');
      this.addTrauma(TRAUMA_BOUNCE);
      this.hitstop(55, 0.2);
      this.hud.showBanner('弹板起跳！', 'good', 0.7);
      this.player.setState('launch');
    } else if (events.landed > 0) {
      this.counters.landings += 1;
      this.audio.land(events.landed);
      this.vfx.burst(this.player.body.x, this.player.body.y, events.landed, 'ground');
      this.addTrauma(TRAUMA_LAND * (0.5 + events.landed));
      this.player.setState('land');
    } else if (!this.player.body.grounded) {
      this.player.setState(this.player.body.vy > 0 ? 'launch' : 'fall');
    } else if (chargeHeld && this.player.body.charge > 0) {
      this.player.setState('charge');
    } else {
      this.player.setState('idle');
    }

    const body = this.player.body;
    const minX = body.x - body.halfWidth;
    const maxX = body.x + body.halfWidth;
    const minY = body.y;
    const maxY = body.y + body.height;

    const gathered = this.world.collectTreats(minX, minY, maxX, maxY);
    for (let i = 0; i < gathered; i += 1) {
      this.score += 1;
      this.levelScore += 1;
      this.treatsThisLevel += 1;
      this.audio.collect(this.treatsThisLevel);
      this.vfx.burst(body.x, body.y + 0.7, 0.5, 'collect');
      this.addTrauma(TRAUMA_PICKUP);
    }

    const hazard = this.world.hazardAt(minX, minY, maxX, maxY);
    if (hazard) {
      this.fail(hazard.kind === 'water' ? '掉进水里了' : '被尖刺弹到了');
      return;
    }

    // Falling out of the world is always a fail, even off the edge of the level.
    if (body.y < -6) {
      this.fail('掉下去了');
      return;
    }

    if (this.world.reachedGoal(minX, minY, maxX, maxY)) {
      this.winLevel();
    }
  }

  private fail(reason: string): void {
    if (this.mode !== 'playing') return;
    this.mode = 'failed';
    this.counters.hurts += 1;
    this.player.setState('hurt');
    this.audio.hurt();
    this.vfx.burst(this.player.body.x, this.player.body.y + 0.5, 1, 'pop');
    this.addTrauma(TRAUMA_HURT);
    this.hitstop(140, this.tuning.hitstopScale);
    this.hud.showBanner(reason, 'bad', 1.1);
    this.pendingOverlay = {
      kind: 'fail',
      title: '再试一次',
      subtitle: reason,
      primary: '重试',
      delay: 0.6,
    };
    this.overlayDelay = 0.6;
  }

  private winLevel(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'won';
    this.counters.wins += 1;
    this.player.setState('celebrate');
    this.audio.win();
    this.vfx.burst(this.world.goalX, this.world.goalY, 1, 'pop');
    this.addTrauma(0.35);
    this.hud.showBanner('到达终点！', 'good', 1);

    const total = this.world.treats.length;
    const allTreats = this.treatsThisLevel >= total;
    const underPar = this.runTime <= LEVELS[this.levelIndex].parTime;
    const stars = allTreats && underPar ? 3 : allTreats || underPar ? 2 : 1;
    const isLast = this.levelIndex >= LEVELS.length - 1;

    this.pendingOverlay = {
      kind: isLast ? 'all-complete' : 'level-complete',
      title: isLast ? '全部通关！' : LEVELS[this.levelIndex].name,
      subtitle: isLast
        ? '四关都走完了，奶蛙心满意足。'
        : starLine(stars),
      primary: isLast ? '再玩一次' : '下一关',
      secondary: '重玩本关',
      delay: 0.7,
    };
    this.overlayDelay = 0.7;
  }

  private loadLevel(index: number): void {
    const previous = this.world;
    this.scene.remove(previous.root);
    previous.dispose();

    const level: LevelSpec = LEVELS[index];
    this.levelIndex = index;
    this.world = new LevelWorld(level, this.rng);
    this.scene.add(this.world.root);
    this.applyTheme(level);

    this.mode = 'playing';
    this.treatsThisLevel = 0;
    this.levelScore = 0;
    this.runTime = 0;
    this.counters = { launches: 0, landings: 0, padBounces: 0, hurts: 0, wins: 0 };
    this.accumulator = 0;
    this.pendingOverlay = null;
    this.overlayDelay = 0;
    this.trauma = 0;
    this.timeScale = 1;
    this.hitstopRemaining = 0;
    this.vfx.reset();

    this.player.respawn(level.spawn.x, level.spawn.y);
    this.cameraRig.snapTo(this.player.body);
    this.hud.setLevel(index + 1, level.name, this.world.treats.length);
    this.hud.hideOverlay();
    this.hud.setHudDimmed(false);
    this.hud.update(this.score, 0, this.world.treats.length, 0, true);
    this.hud.showBanner(`${index + 1} · ${level.name}`, 'neutral', 1.3);
    this.audio.levelStart();
    this.updateSun();
  }

  private restartLevel(): void {
    const level = LEVELS[this.levelIndex];
    this.mode = 'playing';
    this.treatsThisLevel = 0;
    this.levelScore = 0;
    this.runTime = 0;
    this.accumulator = 0;
    this.pendingOverlay = null;
    this.overlayDelay = 0;
    this.timeScale = 1;
    this.hitstopRemaining = 0;
    // Rebuild the world so moving platforms and collected treats return to their start state.
    const previous = this.world;
    this.scene.remove(previous.root);
    previous.dispose();
    this.world = new LevelWorld(level, this.rng);
    this.scene.add(this.world.root);
    this.vfx.reset();
    this.player.respawn(level.spawn.x, level.spawn.y);
    this.cameraRig.snapTo(this.player.body);
    this.hud.hideOverlay();
    this.hud.setHudDimmed(false);
    this.hud.setLevel(this.levelIndex + 1, level.name, this.world.treats.length);
    this.hud.update(this.score, 0, this.world.treats.length, 0, true);
  }

  // --------------------------------------------------------------- commands --

  private handleCommands(): void {
    if (this.input.consumeMute()) this.toggleMute();
    if (this.input.consumePause()) this.togglePause();
    if (this.input.consumeRestart()) this.restartLevel();
    if (this.hud.overlayVisible && this.input.consumeConfirm()) this.handlePrimary();
  }

  private togglePause(): void {
    if (this.mode === 'playing') {
      this.mode = 'paused';
      this.player.setState('idle');
      this.hud.showOverlay('paused', LEVELS[this.levelIndex].name, '游戏已暂停。', [], '继续', '重玩本关');
      this.hud.setHudDimmed(true);
      this.audio.ui();
    } else if (this.mode === 'paused') {
      this.mode = 'playing';
      this.hud.hideOverlay();
      this.hud.setHudDimmed(false);
      this.audio.ui();
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuted(this.muted);
    if (!this.muted) this.audio.ui();
  }

  private handlePrimary(): void {
    this.audio.ui();
    if (this.mode === 'paused') {
      this.mode = 'playing';
      this.hud.hideOverlay();
      this.hud.setHudDimmed(false);
      return;
    }
    if (this.mode === 'failed') {
      this.restartLevel();
      return;
    }
    if (this.mode === 'complete') {
      this.score = 0;
      this.loadLevel(0);
      return;
    }
    if (this.mode === 'won') {
      if (this.levelIndex >= LEVELS.length - 1) {
        this.mode = 'complete';
        this.score = 0;
        this.loadLevel(0);
      } else {
        this.loadLevel(this.levelIndex + 1);
      }
    }
  }

  private handleSecondary(): void {
    this.audio.ui();
    if (this.mode === 'paused' || this.mode === 'failed' || this.mode === 'won') {
      this.restartLevel();
    }
  }

  private advanceOverlay(delta: number): void {
    if (!this.pendingOverlay) return;
    this.overlayDelay -= delta;
    if (this.overlayDelay > 0) return;

    const pending = this.pendingOverlay;
    this.pendingOverlay = null;
    const total = this.world.treats.length;
    const stats = [
      { label: '小鱼干', value: `${this.treatsThisLevel}/${total}` },
      { label: '用时', value: formatTime(this.runTime) },
      { label: '总分', value: String(this.score) },
    ];
    this.hud.showOverlay(pending.kind, pending.title, pending.subtitle, stats, pending.primary, pending.secondary);
    this.hud.setHudDimmed(true);
  }

  // ------------------------------------------------------------------ feel --

  private addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * this.tuning.shakeAmount);
  }

  private hitstop(durationMs: number, scale: number): void {
    this.timeScale = Math.min(this.timeScale, scale);
    this.hitstopRemaining = Math.max(this.hitstopRemaining, durationMs / 1000);
  }

  private applyShake(delta: number): void {
    this.trauma = Math.max(0, this.trauma - 1.5 * delta);
    if (this.trauma <= 0 || this.reducedMotion) return;
    const shake = this.trauma * this.trauma;
    const freq = this.shakeTime * 34;
    this.camera.position.x += 0.5 * shake * noise(freq, 1);
    this.camera.position.y += 0.42 * shake * noise(freq, 2);
    this.camera.rotation.z += 0.055 * shake * noise(freq, 3);
  }

  private updateSun(): void {
    const focus = this.player.body;
    this.sun.target.position.set(focus.x, focus.y, 0);
    this.sun.position.set(focus.x - 6, focus.y + 13, 9);
    this.sun.target.updateMatrixWorld();
  }

  private dangerLevel(): number {
    if (this.mode === 'failed') return 1;
    if (this.mode === 'won' || this.mode === 'complete') return 0.15;
    const progress = this.world.goalX > 0
      ? THREE.MathUtils.clamp((this.player.body.x - LEVELS[this.levelIndex].spawn.x) / Math.max(1, this.world.goalX - LEVELS[this.levelIndex].spawn.x), 0, 1)
      : 0;
    return 0.25 + progress * 0.5;
  }

  // -------------------------------------------------------------- rendering --

  private applyTheme(level: LevelSpec): void {
    const theme = getTheme(level.theme);
    this.drawSky(theme.skyTop, theme.skyBottom);
    this.scene.fog = new THREE.Fog(theme.fogColor, 24, 62);
    this.hemisphere.color.copy(theme.ambientColor);
    this.hemisphere.groundColor = theme.fogColor.clone().multiplyScalar(0.7);
    this.sun.color.copy(theme.sunColor);
  }

  private drawSky(top: THREE.Color, bottom: THREE.Color): void {
    const canvas = this.skyTexture.image as HTMLCanvasElement;
    const size = 256;
    if (canvas.width !== 16 || canvas.height !== size) {
      canvas.width = 16;
      canvas.height = size;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const gradient = context.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, `#${top.getHexString()}`);
    gradient.addColorStop(0.62, `#${bottom.getHexString()}`);
    gradient.addColorStop(1, `#${bottom.clone().lerp(new THREE.Color('#ffffff'), 0.22).getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    this.skyTexture.needsUpdate = true;
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
  }

  private updateGoalIndicator(): void {
    const projected = new THREE.Vector3(
      this.world.goalX,
      this.world.goalY,
      0,
    ).project(this.camera);
    const offRight = projected.x > 0.86;
    const offLeft = projected.x < -0.86;
    const offScreen = offRight || offLeft || projected.z > 1;
    this.hud.setGoalIndicator(offScreen && this.mode === 'playing', offLeft ? 'left' : 'right');
  }

  // ------------------------------------------------------------- testing ----

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') {
          this.restartLevel();
        } else if (name === 'charging') {
          this.restartLevel();
          this.player.body.charge = 0.82;
          this.player.setState('charge');
          // Named screenshot states skip the update loop, so drive the charge UI explicitly.
          this.hud.setCharge(0.82, true);
          this.hud.update(this.score, this.treatsThisLevel, this.world.treats.length, this.runTime, true);
        } else if (name === 'airborne') {
          this.restartLevel();
          this.player.body.x += 4.5;
          this.player.body.y += 3.2;
          this.player.body.vy = 6.5;
          this.player.body.grounded = false;
          this.player.setState('fall');
        } else if (name === 'level-complete') {
          this.restartLevel();
          this.treatsThisLevel = this.world.treats.length;
          this.levelScore = this.treatsThisLevel;
          this.score = this.treatsThisLevel;
          this.runTime = 18.4;
          this.winLevel();
          this.overlayDelay = 0;
          this.advanceOverlay(0);
        } else if (name === 'level-2') {
          this.loadLevel(1);
        } else if (name === 'level-3') {
          this.loadLevel(2);
        } else if (name === 'level-4') {
          this.loadLevel(3);
        } else if (name === 'hero-closeup') {
          this.restartLevel();
          // Frame the frog tightly so the hero model can be judged on its own.
          this.camera.position.set(this.player.body.x + 0.6, this.player.body.y + 1.0, 3.1);
          this.camera.lookAt(this.player.body.x, this.player.body.y + 0.62, 0);
          this.pausedForScreenshot = true;
          this.player.render(0, 0);
          this.render();
          this.publishDiagnostics();
          return { state: name };
        } else if (name === 'fail') {
          this.restartLevel();
          this.fail('掉进水里了');
          this.overlayDelay = 0;
          this.advanceOverlay(0);
        } else {
          throw new Error(`Unknown test state: ${name}`);
        }
        this.player.render(0, 0);
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) {
          this.player.stabilizeVisuals();
          this.vfx.reset();
        }
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
      measureJump: (power: number) => this.measureJump(power),
      placePlayer: (x: number, y: number, vx = 0, vy = 0) => {
        const body = this.player.body;
        body.x = x;
        body.y = y;
        body.vx = vx;
        body.vy = vy;
        body.grounded = false;
        body.groundId = null;
        body.charge = 0;
        body.chargeLock = 0;
        this.player.stabilizeVisuals();
        this.cameraRig.snapTo(body);
        this.render();
        this.publishDiagnostics();
      },
    };
  }

  /**
   * Deterministic jump-envelope probe used to tune gaps against the real physics.
   *
   * Runs the shipped fixed-step integrator from a known flat platform with a synthesised
   * release, so the numbers in the level data can be checked instead of estimated.
   */
  private measureJump(power: number): { distance: number; apex: number; airTime: number } {
    this.restartLevel();
    const level = LEVELS[this.levelIndex];
    const platform = level.platforms[0];
    const body = this.player.body;

    body.x = platform.x + Math.min(2, platform.w / 4);
    body.y = platform.y;
    body.vx = 0;
    body.vy = 0;
    body.grounded = true;
    body.groundId = 9001;
    body.coyote = 0;
    body.charge = THREE.MathUtils.clamp(power, 0, 1);
    body.chargeLock = 0;
    // The probe releases a charged jump on the first step, so the body has to look like the
    // button was being held: the release edge is what triggers the launch.
    body.jumpHeld = true;
    body.jumpBuffer = 0;
    body.bufferedPower = 0;

    const startX = body.x;
    const startY = body.y;
    let apex = startY;
    let airTime = 0;
    let distance = 0;
    let steps = 0;

    // A private flat runway isolates the arc: no later platform can cut the flight short, so
    // the number is the true jump distance for that charge.
    const runway = [
      colliderFromBox(9001, 'solid', body.x - 40, body.y - 6, body.x + 260, body.y),
    ];

    while (steps < 1500) {
      // moveInput = 1 and chargeHeld = false reproduces "player holds right and releases".
      stepBody(body, 1, false, runway, FIXED_DT);
      steps += 1;
      airTime += FIXED_DT;
      apex = Math.max(apex, body.y);
      distance = body.x - startX;
      if (body.grounded && steps > 2) break;
      if (body.y < -12) break;
    }

    this.restartLevel();
    return {
      distance: Number(distance.toFixed(3)),
      apex: Number((apex - startY).toFixed(3)),
      airTime: Number(airTime.toFixed(3)),
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      mode: this.mode,
      level: this.levelIndex + 1,
      levelName: LEVELS[this.levelIndex].name,
      score: this.score,
      treats: this.treatsThisLevel,
      treatTotal: this.world.treats.length,
      runTime: this.runTime,
      charging: this.player.body.charge > 0,
      charge: this.player.body.charge,
      grounded: this.player.body.grounded,
      player: {
        position: {
          x: this.player.body.x,
          y: this.player.body.y,
          z: 0,
        },
        velocity: { x: this.player.body.vx, y: this.player.body.vy },
        speed: Math.hypot(this.player.body.vx, this.player.body.vy),
      },
      lastEvents: { ...this.lastEvents },
      counters: { ...this.counters },
      audio: { unlocked: this.audio.isUnlocked(), muted: this.muted },
      platforms: this.world.platformRects(),
      view: this.measureView(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }

  /**
   * Horizontal slice of the play plane (z = 0) currently on screen, in world units.
   *
   * This is the number that matters for readability in a side-on platformer: how far ahead the
   * player can see. It shrinks with the viewport aspect ratio, which is why narrow screens were
   * showing so little of the level.
   */
  private measureView(): { width: number; left: number; right: number } {
    const left = this.playPlaneXAtNdc(-1);
    const right = this.playPlaneXAtNdc(1);
    return {
      width: Math.abs(right - left),
      left: Math.min(left, right),
      right: Math.max(left, right),
    };
  }

  /** World x where the ray through the given NDC x crosses the gameplay plane at z = 0. */
  private playPlaneXAtNdc(ndcX: number): number {
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const direction = new THREE.Vector3(ndcX * tanHalfFov * this.camera.aspect, 0, -1);
    direction.applyQuaternion(this.camera.quaternion);
    const origin = this.camera.position;
    if (Math.abs(direction.z) < 1e-6) return origin.x;
    const t = -origin.z / direction.z;
    return origin.x + direction.x * t;
  }
}

function emptyEvents(): StepEvents {
  return { landed: 0, padBounce: 0, hitWall: 0, hitCeiling: false, launched: 0 };
}

function starLine(stars: number): string {
  if (stars >= 3) return '三星！小鱼干全收，还快过标准时间。';
  if (stars === 2) return '两星。再快一点，或者把小鱼干收全。';
  return '一星。先稳稳通关，再回头收小鱼干。';
}

/** Deterministic value noise in [-1, 1]; per-axis seed keeps the shake axes independent. */
function noise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
