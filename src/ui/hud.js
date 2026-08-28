import { formatTime } from '../game/race.js';
import { SKILL } from '../game/balance.js';

/**
 * The HUD's job is to make the skill mechanics legible. Drift charge and its
 * tier have to be readable at a glance or the highest-value mechanic in the
 * game stays invisible to the player.
 */
export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="corner tl">
        <div class="hud-mid" id="hud-pos">P1</div>
        <div class="hud-sub" id="hud-lap">Lap 1/3</div>
        <div class="pos-list" id="hud-order"></div>
      </div>
      <div class="corner tr">
        <div class="hud-mid" id="hud-time">0:00.00</div>
        <div class="hud-sub">Race</div>
        <div class="hud-sub" id="hud-best" style="margin-top:8px"></div>
      </div>
      <div class="corner br">
        <div class="hud-big"><span id="hud-speed">0</span><span style="font-size:16px"> km/h</span></div>
        <div class="hud-sub" id="hud-surface">Asphalt</div>
      </div>
      <div class="corner bl">
        <div class="tier" id="hud-tier"></div>
        <div class="bar drift"><i id="hud-drift"></i></div>
        <div class="hud-sub">Drift charge</div>
        <div class="bar nitro" style="margin-top:9px"><i id="hud-nitro"></i></div>
        <div class="hud-sub">Nitro</div>
      </div>
      <div class="flash" id="hud-flash"></div>
      <div class="countdown" id="hud-count" style="display:none"></div>`;

    this.el = {};
    for (const id of ['pos', 'lap', 'order', 'time', 'best', 'speed', 'surface',
      'tier', 'drift', 'nitro', 'flash', 'count']) {
      this.el[id] = root.querySelector('#hud-' + id);
    }
    this.flashTimer = 0;
  }

  show(on) { this.root.hidden = !on; }

  flash(text, color = '#fff') {
    const f = this.el.flash;
    f.textContent = text;
    f.style.color = color;
    f.classList.remove('show');
    void f.offsetWidth;   // restart the animation
    f.classList.add('show');
  }

  update(race, dt) {
    const p = race.player;
    const order = race.standings();
    const pos = order.findIndex((e) => e.isPlayer) + 1;

    this.el.pos.textContent = 'P' + pos;
    this.el.lap.textContent = `Lap ${Math.min(race.laps, Math.max(1, p.lap))}/${race.laps}`;
    this.el.time.textContent = formatTime(Math.max(0, race.time));
    this.el.speed.textContent = Math.round(p.kmh);

    const best = race.bestLap(p);
    this.el.best.textContent = best ? 'Best ' + formatTime(best) : '';

    const surf = p.surfaceId ?? 'asphalt';
    this.el.surface.textContent = surf === 'asphalt' ? 'Asphalt' :
      surf.charAt(0).toUpperCase() + surf.slice(1);

    // Drift charge: fill within the current tier, tier shown as chevrons.
    const charge = p.driftCharge ?? 0;
    const tier = Math.floor(charge);
    this.el.drift.style.width = ((charge / SKILL.maxTier) * 100).toFixed(1) + '%';
    this.el.tier.textContent = '›'.repeat(tier);
    this.el.tier.classList.toggle('fused', !!p.fusion);
    this.el.nitro.style.width = ((p.nitro / p.stats.nitroTank) * 100).toFixed(1) + '%';

    this.el.order.innerHTML = order.slice(0, 6).map((e, i) =>
      `<div class="${e.isPlayer ? 'me' : ''}">${i + 1}. ${e.name}</div>`).join('');

    if (race.state === 'countdown') {
      const n = Math.ceil(-race.time);
      this.el.count.style.display = 'grid';
      this.el.count.textContent = n > 0 ? String(n) : 'GO';
    } else {
      this.el.count.style.display = 'none';
    }
  }
}
