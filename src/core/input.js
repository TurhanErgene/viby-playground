/**
 * Keyboard, gamepad and touch, normalised to one control shape. Steering is
 * ramped rather than binary so a keyboard player can still be precise enough
 * to hold a drift — the skill ceiling has to be reachable without a wheel.
 */
const KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight', 'KeyN'],
  reset: ['KeyR']
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;
    this.touch = { left: false, right: false, throttle: false, brake: false, handbrake: false, nitro: false };
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (Object.values(KEYMAP).flat().includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  held(action) {
    return KEYMAP[action].some((k) => this.keys.has(k)) || this.touch[action];
  }

  /** Gamepad wins when one is connected and actually being moved. */
  pad() {
    const gp = navigator.getGamepads?.().find((g) => g);
    if (!gp) return null;
    const dead = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    return {
      steer: dead(gp.axes[0] ?? 0),
      throttle: Math.max(gp.buttons[7]?.value ?? 0, gp.buttons[0]?.value ?? 0),
      brake: Math.max(gp.buttons[6]?.value ?? 0, gp.buttons[1]?.value ?? 0),
      handbrake: (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) ?? false,
      nitro: (gp.buttons[3]?.pressed || gp.buttons[4]?.pressed) ?? false
    };
  }

  sample(dt) {
    const pad = this.pad();
    const wantLeft = this.held('left'), wantRight = this.held('right');
    let targetSteer = (wantRight ? 1 : 0) - (wantLeft ? 1 : 0);
    if (pad && Math.abs(pad.steer) > 0) targetSteer = pad.steer;

    // Ramp toward the target; snap back to centre faster than away from it.
    const rate = targetSteer === 0 ? 7.5 : 4.2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, targetSteer - this.steer));
    if (targetSteer === 0 && Math.abs(this.steer) < 0.02) this.steer = 0;

    return {
      steer: this.steer,
      throttle: pad?.throttle || (this.held('throttle') ? 1 : 0),
      brake: pad?.brake || (this.held('brake') ? 1 : 0),
      handbrake: pad?.handbrake || this.held('handbrake'),
      nitro: pad?.nitro || this.held('nitro'),
      pitch: (this.held('throttle') ? -1 : 0) + (this.held('brake') ? 1 : 0)
    };
  }

  bindTouch(root) {
    const press = (name, on) => { this.touch[name] = on; };
    for (const el of root.querySelectorAll('[data-touch]')) {
      const name = el.dataset.touch;
      const set = (v) => (e) => { e.preventDefault(); press(name, v); el.classList.toggle('active', v); };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    }
  }
}
