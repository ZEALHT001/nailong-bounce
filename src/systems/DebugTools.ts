import GUI from 'lil-gui';
import { PHYSICS } from './PlatformerPhysics';

export type DebugTuning = {
  exposure: number;
  maxDpr: number;
  hitstopScale: number;
  shakeAmount: number;
};

/**
 * Live tuning panel. Gated behind `?debug` so it never ships as player-facing UI.
 * Physics constants are bound directly so feel can be dialled in while playing.
 */
export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: '奶蛙弹跳 tuning' });
    const physics = this.gui.addFolder('Physics');
    physics.add(PHYSICS, 'gravity', -60, -12, 0.5);
    physics.add(PHYSICS, 'minLaunch', 4, 16, 0.1);
    physics.add(PHYSICS, 'maxLaunch', 12, 30, 0.1);
    physics.add(PHYSICS, 'maxChargeTime', 0.2, 1.6, 0.01);
    physics.add(PHYSICS, 'groundAccel', 10, 120, 1);
    physics.add(PHYSICS, 'airAccel', 5, 80, 1);
    physics.add(PHYSICS, 'maxSpeed', 2, 14, 0.1);
    physics.add(PHYSICS, 'padLaunch', 12, 40, 0.5);

    const render = this.gui.addFolder('Render');
    render.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    render.add(tuning, 'exposure', 0.6, 1.6, 0.01).onChange(onChange);

    const feel = this.gui.addFolder('Feel');
    feel.add(tuning, 'shakeAmount', 0, 2, 0.05);
    feel.add(tuning, 'hitstopScale', 0, 1, 0.05);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
