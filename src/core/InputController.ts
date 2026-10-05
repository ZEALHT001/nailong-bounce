/**
 * Input intents for 奶蛙弹跳.
 *
 * The game only needs three continuous signals (move left/right, charge held) and a few
 * one-shot commands (restart, mute, pause). Keyboard and touch both write the same intents so
 * gameplay never branches on input device.
 */

export class InputController {
  private readonly keys = new Set<string>();
  private pointerLeft = false;
  private pointerRight = false;
  private pointerCharge = false;
  private justPressed = new Set<string>();
  /** Charge-button edges seen since the last frame, used to catch a tap that no step could see. */
  private chargeDownThisFrame = false;
  private chargeUpThisFrame = false;
  private chargeTapPending = false;

  private static isChargeKey(code: string): boolean {
    return code === 'Space' || code === 'KeyW' || code === 'ArrowUp';
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    this.keys.add(event.code);
    this.justPressed.add(event.code);
    if (InputController.isChargeKey(event.code)) this.markChargePressed();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (InputController.isChargeKey(event.code)) this.markChargeReleased();
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.pointerLeft = false;
    this.pointerRight = false;
    this.pointerCharge = false;
    this.chargeDownThisFrame = false;
    this.chargeUpThisFrame = false;
    this.chargeTapPending = false;
  };

  constructor(
    private readonly leftButton: HTMLElement,
    private readonly rightButton: HTMLElement,
    private readonly chargeButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.bindHold(this.leftButton, (held) => {
      this.pointerLeft = held;
    });
    this.bindHold(this.rightButton, (held) => {
      this.pointerRight = held;
    });
    this.bindHold(this.chargeButton, (held) => {
      this.pointerCharge = held;
      if (held) this.markChargePressed();
      else this.markChargeReleased();
    });
  }

  /** -1 left, 1 right, 0 neutral. Holding both cancels out. */
  readMove(): number {
    let move = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.pointerLeft) move -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.pointerRight) move += 1;
    return move;
  }

  isChargeHeld(): boolean {
    return (
      this.keys.has('Space') ||
      this.keys.has('KeyW') ||
      this.keys.has('ArrowUp') ||
      this.pointerCharge
    );
  }

  /** One-shot commands are consumed so a single press cannot fire twice. */
  consumeRestart(): boolean {
    return this.consume('KeyR');
  }

  consumeMute(): boolean {
    return this.consume('KeyM');
  }

  consumePause(): boolean {
    return this.consume('KeyP') || this.consume('Escape');
  }

  consumeConfirm(): boolean {
    return this.consume('Space') || this.consume('Enter');
  }

  /**
   * True when the jump button was pressed and released inside a single frame.
   *
   * At a low frame rate no physics step ever observes the button as held, so the press would be
   * lost entirely; the caller turns this into a queued tap jump.
   */
  consumeChargeTap(): boolean {
    const tap = this.chargeTapPending;
    this.chargeTapPending = false;
    return tap;
  }

  /** Called once per frame after the game has read its intents. */
  endFrame(): void {
    this.justPressed.clear();
    // Both edges inside one frame, and the button is no longer down: a tap the steps could miss.
    if (this.chargeDownThisFrame && this.chargeUpThisFrame && !this.isChargeHeld()) {
      this.chargeTapPending = true;
    }
    this.chargeDownThisFrame = false;
    this.chargeUpThisFrame = false;
  }

  private markChargePressed(): void {
    this.chargeDownThisFrame = true;
  }

  private markChargeReleased(): void {
    this.chargeUpThisFrame = true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.unbindHold(this.leftButton);
    this.unbindHold(this.rightButton);
    this.unbindHold(this.chargeButton);
  }

  private consume(code: string): boolean {
    if (!this.justPressed.has(code)) return false;
    this.justPressed.delete(code);
    return true;
  }

  private readonly holdHandlers = new WeakMap<
    HTMLElement,
    {
      down: (event: PointerEvent) => void;
      up: (event: PointerEvent) => void;
      leave: (event: PointerEvent) => void;
      menu: (event: Event) => void;
    }
  >();

  private bindHold(element: HTMLElement, set: (held: boolean) => void): void {
    const down = (event: PointerEvent) => {
      event.preventDefault();
      // Anything that fires a pointer also counts as the gesture that unlocks audio.
      set(true);
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic test events do not always have a capturable pointer id.
      }
    };
    const up = (event: PointerEvent) => {
      event.preventDefault();
      set(false);
    };
    const leave = () => set(false);
    // Long-pressing a control (especially on iOS) can raise the context menu or a selection
    // callout; neither should interrupt a held jump.
    const menu = (event: Event) => event.preventDefault();

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('contextmenu', menu);
    element.addEventListener('selectstart', menu);
    this.holdHandlers.set(element, { down, up, leave, menu });
  }

  private unbindHold(element: HTMLElement): void {
    const handlers = this.holdHandlers.get(element);
    if (!handlers) return;
    element.removeEventListener('pointerdown', handlers.down);
    element.removeEventListener('pointerup', handlers.up);
    element.removeEventListener('pointercancel', handlers.up);
    element.removeEventListener('lostpointercapture', handlers.up);
    element.removeEventListener('pointerleave', handlers.leave);
    element.removeEventListener('contextmenu', handlers.menu);
    element.removeEventListener('selectstart', handlers.menu);
    this.holdHandlers.delete(element);
  }
}
