import { STATS, STAT_KEYS, upgradeCost, WEATHER, BUDGET } from '../game/balance.js';
import { SEASON_LENGTH, INTEL_COST, buildGrade } from '../game/career.js';
import { formatTime } from '../game/race.js';

const money = (n) => '¢' + Math.round(n).toLocaleString();
const el = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
};

export function clear(root) { root.innerHTML = ''; }

export function renderMenu(root, { hasSave, onNew, onContinue, onSeed }) {
  clear(root);
  root.appendChild(el(`
    <div class="screen" style="max-width:760px">
      <h1>Apex Drift</h1>
      <p style="font-size:15px;color:#c6cedd">
        Eight races. The map is rolled before each one and you only see part of the
        forecast before the shop closes. Upgrade for what you think is coming —
        then out-drive whatever actually shows up.
      </p>
      <div class="row" style="margin:18px 0 22px">
        <div class="col">
          <h3>The deal</h3>
          <p>
            Every map is finishable in any car. What the upgrades buy is the
            <em>margin</em>. A map that wants tyres will punish a car without them —
            but a driver who chains drift boosts beats a better-funded one who doesn't.
          </p>
          <div>
            <span class="tag">skill ${Math.round(BUDGET.skill * 100)}%</span>
            <span class="tag unknown">car ${Math.round(BUDGET.stat * 100)}%</span>
            <span class="tag unknown">map roll ${Math.round(BUDGET.luck * 100)}%</span>
          </div>
          <p class="hint" style="margin-top:8px">
            Measured across 120 random maps, not asserted — <code>npm run balance</code>.
          </p>
        </div>
        <div class="col">
          <h3>Controls</h3>
          <p>
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive ·
            <kbd>Space</kbd> handbrake to start a slide ·
            <kbd>Shift</kbd> nitro · <kbd>R</kbd> recover.
            A gamepad works if you have one.
          </p>
          <p>
            Hold a slide near <strong>25°</strong> to charge boost, straighten to
            release it. Release while nitro is burning and the two fuse for a
            bigger exit — that is the fastest thing in the game and it is free.
          </p>
        </div>
      </div>
      <div class="spread">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="primary" id="btn-new">New season</button>
          ${hasSave ? '<button id="btn-cont">Continue season</button>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="hint">Seed</span>
          <input id="seed" placeholder="random" style="width:130px;padding:8px 10px;border-radius:8px;
            border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink);font-family:var(--mono)" />
        </div>
      </div>
    </div>`));

  root.querySelector('#btn-new').onclick = () => onNew(root.querySelector('#seed').value.trim() || undefined);
  root.querySelector('#btn-cont')?.addEventListener('click', onContinue);
}

/**
 * The garage IS the strategy screen. It shows what is known about the coming
 * map, what it would cost to know the rest, and what each upgrade costs — all
 * at once, because the decision only means something if the trade is visible.
 */
export function renderGarage(root, career, { onRace, onIntel, onUpgrade, onQuit }) {
  clear(root);
  const f = career.forecast();
  const e = career.event;
  const known = new Set(f.tags.map((t) => t.key));

  const statRows = STAT_KEYS.map((key) => {
    const lvl = career.levels[key];
    const cost = upgradeCost(key, lvl);
    const s = STATS[key];
    const wanted = known.has(key);
    const pips = Array.from({ length: 5 }, (_, i) =>
      `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
    return `
      <div class="stat ${wanted ? 'wanted' : ''}">
        <div class="icon">${s.icon}</div>
        <div>
          <div class="name">${s.label} ${wanted ? '<span class="tag" style="margin-left:6px">wanted here</span>' : ''}</div>
          <div class="blurb">${s.blurb}</div>
          <div class="pips">${pips}</div>
        </div>
        <div class="num muted" style="font-family:var(--mono);font-size:12px">${lvl}/5</div>
        <button data-up="${key}" ${cost == null || cost > career.credits ? 'disabled' : ''}>
          ${cost == null ? 'MAX' : money(cost)}
        </button>
      </div>`;
  }).join('');

  const tagHtml = f.tags.map((t) => `<span class="tag">${t.label}</span>`).join('') +
    (f.hiddenCount > 0
      ? `<span class="tag unknown">+${f.hiddenCount} unknown</span>`
      : '');

  const surfaceHtml = f.surfaces
    ? Object.entries(f.surfaces).filter(([, v]) => v > 0.02)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<span class="tag unknown">${k} ${Math.round(v * 100)}%</span>`).join('')
    : '<span class="hint">Surface breakdown needs scouting intel.</span>';

  root.appendChild(el(`
    <div class="screen">
      <div class="spread" style="margin-bottom:16px">
        <div>
          <h3 style="margin:0">Round ${e.round} of ${SEASON_LENGTH}</h3>
          <h1 style="font-size:27px;margin:2px 0 0">${e.track.name}</h1>
        </div>
        <div style="text-align:right">
          <div class="credits">${money(career.credits)}</div>
          <div class="hint">${career.points} pts · ${buildGrade(career.levels)} spec</div>
        </div>
      </div>

      <div class="row">
        <div class="col" style="flex:1 1 300px">
          <h3>The forecast</h3>
          <p style="margin-bottom:10px">
            ${f.biome} · ${(f.length / 1000).toFixed(2)} km · ${e.laps} laps
            ${f.jumps ? ` · ${f.jumps} jump${f.jumps === 1 ? '' : 's'}` : ''}
          </p>
          <div style="margin-bottom:10px">
            <span class="tag weather">${f.weather.label}</span>
            ${f.weather.favours.length
              ? `<span class="hint">favours ${f.weather.favours.map((k) => STATS[k].label).join(' & ')}</span>`
              : ''}
          </div>
          <h3>What it rewards</h3>
          <div>${tagHtml}</div>
          <h3 style="margin-top:14px">Surfaces</h3>
          <div>${surfaceHtml}</div>

          <div style="margin-top:16px">
            <button id="btn-intel" ${f.full || career.credits < INTEL_COST ? 'disabled' : ''}>
              ${f.full ? 'Intel purchased' : `Scout the map — ${money(INTEL_COST)}`}
            </button>
            <p class="hint" style="margin-top:8px">
              ${f.full
                ? 'You know exactly what this map wants. Spend accordingly.'
                : 'Buying certainty costs credits you could put in the car. That is the bet.'}
            </p>
          </div>

          <h3 style="margin-top:16px">Fit</h3>
          <div class="meter"><i style="width:${(career.fit() * 100).toFixed(0)}%"></i></div>
          <p class="hint" style="margin-top:6px">
            ${f.full
              ? `Your car answers ${Math.round(career.fit() * 100)}% of what this map asks for.`
              : 'Fit is estimated from what you can see. Scout for the real number.'}
          </p>
        </div>

        <div class="col" style="flex:1.35 1 420px">
          <h3>Garage</h3>
          <div class="stat-list">${statRows}</div>
        </div>
      </div>

      <div class="spread" style="margin-top:20px">
        <button id="btn-quit" class="muted">Abandon season</button>
        <button class="primary" id="btn-race">To the grid →</button>
      </div>
    </div>`));

  for (const b of root.querySelectorAll('[data-up]')) {
    b.onclick = () => onUpgrade(b.dataset.up);
  }
  root.querySelector('#btn-intel').onclick = onIntel;
  root.querySelector('#btn-race').onclick = onRace;
  root.querySelector('#btn-quit').onclick = onQuit;
}

export function renderResult(root, career, result, event, { onNext }) {
  clear(root);
  const rows = result.order.map((entry, i) => `
    <tr class="${entry.isPlayer ? 'you' : ''}">
      <td class="num">${i + 1}</td>
      <td>${entry.name}</td>
      <td class="num">${entry.finished ? formatTime(entry.finishTime) : 'DNF'}</td>
      <td class="num">${entry.isPlayer ? '' : money(entry.buildValue ?? 0)}</td>
    </tr>`).join('');

  const payout = result.lines.map((l) =>
    `<tr><td>${l.label}</td><td class="num">${money(l.amount)}</td></tr>`).join('');

  const t = result.telemetry;
  root.appendChild(el(`
    <div class="screen">
      <div class="spread" style="margin-bottom:6px">
        <h1 style="margin:0">P${result.position} · ${event.track.name}</h1>
        <div class="credits" style="color:var(--accent)">+${money(result.credits)}</div>
      </div>
      <p>${event.track.biomeLabel} · ${WEATHER[event.track.weather].label} ·
         best lap ${formatTime(result.bestLap)}</p>

      <div class="row" style="margin-top:14px">
        <div class="col">
          <h3>Finishing order</h3>
          <table>
            <thead><tr><th class="num">#</th><th>Driver</th><th class="num">Time</th><th class="num">Car value</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="col">
          <h3>Prize money</h3>
          <table><tbody>${payout}</tbody></table>
          <h3 style="margin-top:16px">How you drove</h3>
          <p class="hint">
            ${t.driftSeconds.toFixed(1)}s of clean drift ·
            ${t.cleanLandings} clean landing${t.cleanLandings === 1 ? '' : 's'} ·
            ${t.wallHits} wall hit${t.wallHits === 1 ? '' : 's'} ·
            top ${Math.round(t.topSpeed * 3.6)} km/h
          </p>
          <p class="hint">
            This map wanted ${event.track.tags.map((x) => STATS[x.key].label).join(', ') || 'nothing in particular'}.
          </p>
        </div>
      </div>

      <div class="spread" style="margin-top:20px">
        <div class="hint">${career.points} championship points</div>
        <button class="primary" id="btn-next">
          ${career.finished ? 'Season results →' : 'Next round →'}
        </button>
      </div>
    </div>`));
  root.querySelector('#btn-next').onclick = onNext;
}

export function renderSeasonEnd(root, career, { onRestart }) {
  clear(root);
  const rows = career.history.map((h) => `
    <tr>
      <td class="num">${h.round}</td>
      <td>${h.track}</td>
      <td class="hint">${h.biome}</td>
      <td class="num">P${h.position}</td>
      <td class="num">${h.points}</td>
      <td class="num">${money(h.credits)}</td>
    </tr>`).join('');

  const wins = career.history.filter((h) => h.position === 1).length;
  const podiums = career.history.filter((h) => h.position <= 3).length;

  root.appendChild(el(`
    <div class="screen" style="max-width:820px">
      <h1>Season complete</h1>
      <p>${career.points} points · ${wins} win${wins === 1 ? '' : 's'} ·
         ${podiums} podium${podiums === 1 ? '' : 's'} ·
         finished with ${money(career.credits)} and a ${buildGrade(career.levels)} car.</p>
      <table style="margin-top:14px">
        <thead><tr><th class="num">R</th><th>Map</th><th>Type</th><th class="num">Pos</th><th class="num">Pts</th><th class="num">Prize</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:20px;text-align:right">
        <button class="primary" id="btn-restart">New season</button>
      </div>
    </div>`));
  root.querySelector('#btn-restart').onclick = onRestart;
}
