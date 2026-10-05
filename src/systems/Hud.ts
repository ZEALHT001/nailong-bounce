/**
 * HUD and overlay wiring.
 *
 * The HUD is a pure view over game state: it never owns rules, it only renders what the game
 * hands it. Callbacks are injected so the game keeps ownership of pause/mute/retry intents.
 */

export type OverlayKind = 'level-complete' | 'all-complete' | 'fail' | 'paused';

export type OverlayStat = { label: string; value: string };

export type HudCallbacks = {
  onPauseToggle: () => void;
  onMuteToggle: () => void;
  onPrimary: () => void;
  onSecondary: () => void;
};

export class Hud {
  private readonly levelIndex = this.getElement('#level-index');
  private readonly levelName = this.getElement('#level-name');
  private readonly treatValue = this.getElement('#treat-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly scoreValue = this.getElement('#score-value');
  private readonly muteButton = this.getElement('#mute-button');
  private readonly chargeCluster = this.getElement('#charge-cluster');
  private readonly chargeFill = this.getElement('#charge-fill');
  private readonly chargeButton = this.getElement('#charge-button');
  private readonly goalIndicator = this.getElement('#goal-indicator');
  private readonly banner = this.getElement('#banner');
  private readonly overlay = this.getElement('#overlay');
  private readonly overlayKicker = this.getElement('#overlay-kicker');
  private readonly overlayTitle = this.getElement('#overlay-title');
  private readonly overlaySubtitle = this.getElement('#overlay-subtitle');
  private readonly overlayStats = this.getElement('#overlay-stats');
  private readonly overlayPrimary = this.getElement('#overlay-primary');
  private readonly overlaySecondary = this.getElement('#overlay-secondary');

  private bannerTimer = 0;

  constructor(private readonly callbacks: HudCallbacks) {
    this.muteButton.addEventListener('click', () => this.callbacks.onMuteToggle());
    this.getElement('#pause-button').addEventListener('click', () => this.callbacks.onPauseToggle());
    this.overlayPrimary.addEventListener('click', () => this.callbacks.onPrimary());
    this.overlaySecondary.addEventListener('click', () => this.callbacks.onSecondary());
  }

  setLevel(levelNumber: number, name: string, treatTotal: number): void {
    this.levelIndex.textContent = String(levelNumber);
    this.levelName.textContent = name;
    this.treatValue.textContent = `0/${treatTotal}`;
  }

  update(score: number, treats: number, treatTotal: number, elapsed: number, running: boolean): void {
    this.scoreValue.textContent = String(score);
    this.treatValue.textContent = `${treats}/${treatTotal}`;
    this.timerValue.textContent = running ? formatTime(elapsed) : this.timerValue.textContent;
  }

  setCharge(ratio: number, active: boolean): void {
    this.chargeCluster.dataset.active = active ? 'true' : 'false';
    this.chargeFill.style.width = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`;
    this.chargeButton.dataset.charging = active ? 'true' : 'false';
  }

  setMuted(muted: boolean): void {
    this.muteButton.dataset.muted = muted ? 'true' : 'false';
    this.muteButton.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
  }

  /**
   * Points at the goal when it is off screen. `screenX` is in pixels; `side` picks which edge
   * the marker docks to.
   */
  setGoalIndicator(visible: boolean, side: 'left' | 'right'): void {
    this.goalIndicator.dataset.visible = visible ? 'true' : 'false';
    this.goalIndicator.dataset.side = side;
  }

  showBanner(text: string, tone: 'good' | 'bad' | 'neutral', seconds = 0.9): void {
    this.banner.textContent = text;
    this.banner.dataset.tone = tone;
    this.banner.dataset.visible = 'true';
    this.bannerTimer = seconds;
  }

  /** Advances the banner countdown with real (unscaled) time. */
  tick(delta: number): void {
    if (this.bannerTimer <= 0) return;
    this.bannerTimer -= delta;
    if (this.bannerTimer <= 0) {
      this.banner.dataset.visible = 'false';
    }
  }

  showOverlay(
    kind: OverlayKind,
    title: string,
    subtitle: string,
    stats: OverlayStat[],
    primaryLabel: string,
    secondaryLabel?: string,
  ): void {
    const kickers: Record<OverlayKind, string> = {
      'level-complete': '关卡完成',
      'all-complete': '全部通关',
      fail: '再来一次',
      paused: '已暂停',
    };
    this.overlayKicker.textContent = kickers[kind];
    this.overlayTitle.textContent = title;
    this.overlaySubtitle.textContent = subtitle;
    this.overlayStats.replaceChildren(
      ...stats.map((stat) => {
        const wrap = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = stat.label;
        const dd = document.createElement('dd');
        dd.textContent = stat.value;
        wrap.append(dt, dd);
        return wrap;
      }),
    );
    this.overlayPrimary.textContent = primaryLabel;
    if (secondaryLabel) {
      this.overlaySecondary.textContent = secondaryLabel;
      this.overlaySecondary.hidden = false;
    } else {
      this.overlaySecondary.hidden = true;
    }
    this.overlay.hidden = false;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
  }

  get overlayVisible(): boolean {
    return !this.overlay.hidden;
  }

  /** Hides gameplay HUD while a modal overlay is up. */
  setHudDimmed(dimmed: boolean): void {
    this.getElement('#hud').style.opacity = dimmed ? '0.25' : '1';
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const rest = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}
