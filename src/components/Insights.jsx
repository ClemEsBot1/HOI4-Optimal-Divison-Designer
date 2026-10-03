import React from 'react';
import NumberInput from './NumberInput.jsx';
import { fmt } from '../lib/stats.js';
import { equipmentIcon } from '../lib/icons.js';
import { OPPONENTS, ENEMY_KEYS, matchup } from '../lib/combat.js';

const signed = (x, dp = 2) => `${x > 0 ? '+' : ''}${x.toFixed(dp)}`;
const show = (v, key) => (key === 'frontage' ? `${(v * 100).toFixed(1)}%` : fmt(v, key));

/** Why the winner wins: each scored stat's share of the score, compared with the runner-up. */
export function ScoreExplain({ explain, hasRef }) {
  if (!explain?.length) return null;
  const max = Math.max(...explain.map((e) => Math.abs(e.delta)), 1e-9);
  const total = explain.reduce((a, e) => a + e.delta, 0);
  // against a runner-up, stats where the two are level only add noise: list them in one line under the bars
  const tied = hasRef ? explain.filter((e) => Math.abs(e.delta) < 0.005) : [];
  const rows = hasRef ? explain.filter((e) => Math.abs(e.delta) >= 0.005) : explain;
  return (
    <div className="explain">
      <h3>Why this template wins</h3>
      <p className="note">
        {hasRef
          ? <>Score difference with the runner-up, stat by stat (total {signed(total)}). A bar to the right is where this template is ahead; each point is worth about a 10% gain on a stat with priority 10.</>
          : <>Each stat's contribution to the score.</>}
      </p>
      <ul className="explain-rows">
        {rows.map((e) => (
          <li key={e.key}>
            <span className="ex-label">{e.label} <em>({e.key === 'frontage' ? `share of each battle's width used; weight ${e.weight}, the sum of the combat priorities` : `${e.weight > 0 ? '' : 'lower is better, '}priority ${Math.abs(e.weight)}`})</em></span>
            <span className="ex-bar" aria-hidden="true">
              <i className={e.delta >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(e.delta) / max) * 50}%`, [e.delta >= 0 ? 'left' : 'right']: '50%' }} />
            </span>
            <span className="ex-val">{show(e.value, e.key)}{e.refValue != null ? <small> vs {show(e.refValue, e.key)}</small> : null}</span>
            <span className="ex-delta">{hasRef ? signed(e.delta) : e.score.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {tied.length > 0 && <p className="note">Level with the runner-up on {tied.map((e) => e.label.toLowerCase()).join(', ')}.</p>}
    </div>
  );
}

/** How the winner changes if one priority moves by 1 or 2. */
export function Sensitivity({ sensitivity, winnerKey, describe, onPick }) {
  if (!sensitivity?.rows?.length) return null;
  const fragile = sensitivity.rows.filter((r) => r.fragile === 1);
  return (
    <div className="sensitivity">
      <h3>How stable is this pick?</h3>
      <p className="note">
        Each priority moved by 1 or 2, with every one of the {sensitivity.candidates.toLocaleString('en-GB')} templates the search found re-scored.
        {' '}{fragile.length ? <strong>Fragile: moving {fragile.map((r) => r.label.toLowerCase()).join(', ')} by one changes the winner.</strong> : 'No single step of 1 changes the winner.'}
      </p>
      <div className="table-scroll">
        <table className="rank sens">
          <thead><tr><th scope="col">Priority</th><th scope="col">Now</th><th scope="col">−2</th><th scope="col">−1</th><th scope="col">+1</th><th scope="col">+2</th></tr></thead>
          <tbody>
            {sensitivity.rows.map((r) => (
              <tr key={r.key}>
                <td className="txt">{r.label}</td>
                <td>{r.weight}</td>
                {[-2, -1, 1, 2].map((d) => {
                  const c = r.changes.find((x) => x.delta === d);
                  if (!c) return <td key={d}>–</td>;
                  if (c.same || c.key === winnerKey) return <td key={d} className="same">same</td>;
                  return (
                    <td key={d} className="txt">
                      <button type="button" className="linkish" title={describe(c)} onClick={() => onPick(c)}>changes</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EQUIPMENT_NAME = (game, key) => {
  if (key.startsWith('tank:')) {
    const [chassis, role] = key.slice(5).split('|');
    const name = game.raw.designers[chassis]?.name || chassis.replace(/_/g, ' ');
    return `${name}${role === 'armor' ? '' : ` (${role.replace('_', '-')})`}`;
  }
  return game.raw.equipment[key]?.name || key.replace(/_/g, ' ');
};

/** What a template needs to field, and what fielding many of them costs. */
export function Logistics({ game, stats, scale, setScale }) {
  if (!stats) return null;
  const equipment = Object.entries(stats.equipment || {}).sort((a, b) => b[1] - a[1]);
  const n = Math.max(0, Number(scale.divisions) || 0);
  const factories = Math.max(0, Number(scale.factories) || 0);
  const efficiency = Math.min(100, Math.max(1, Number(scale.efficiency) || 50)) / 100;
  // A military factory makes 4.5 production points a day at full efficiency (base game value).
  const perDay = factories * 4.5 * efficiency;
  const totalIc = n * stats.ic;
  const days = perDay > 0 ? totalIc / perDay : null;
  return (
    <div className="logistics">
      <h3>Equipment, supply and cost at scale</h3>
      <div className="td-stats result-stats">
        <div className="td-panel">
          <h4>Equipment per division</h4>
          <dl>
            {equipment.map(([k, v]) => <div key={k}><dt>{equipmentIcon(k) && <img className="eq-icon" src={equipmentIcon(k)} alt="" />}{EQUIPMENT_NAME(game, k)}</dt><dd>{Math.round(v).toLocaleString('en-GB')}</dd></div>)}
          </dl>
        </div>
        <div className="td-panel">
          <h4>Upkeep</h4>
          <dl>
            <div><dt>Reliability</dt><dd>{fmt(stats.rel, 'rel')}%</dd></div>
            <div><dt>Supply use</dt><dd>{fmt(stats.sup, 'sup')}</dd></div>
            <div><dt>Trucks</dt><dd>{fmt(stats.trucks, 'trucks')}</dd></div>
            <div><dt>Manpower</dt><dd>{fmt(stats.mp, 'mp')}</dd></div>
          </dl>
        </div>
        <div className="td-panel">
          <h4>Fielding {n || '…'} divisions</h4>
          <div className="fields compact">
            <label>Divisions<NumberInput min="0" integer value={scale.divisions} onChange={(v) => setScale((s) => ({ ...s, divisions: v }))} /></label>
            <label>Military factories<NumberInput min="0" integer value={scale.factories} onChange={(v) => setScale((s) => ({ ...s, factories: v }))} /></label>
            <label>Efficiency %<NumberInput min="1" max="100" value={scale.efficiency} onChange={(v) => setScale((s) => ({ ...s, efficiency: v }))} /></label>
          </div>
          <dl>
            <div><dt>Production cost</dt><dd>{Math.round(totalIc).toLocaleString('en-GB')}</dd></div>
            <div><dt>Manpower</dt><dd>{Math.round(n * stats.mp).toLocaleString('en-GB')}</dd></div>
            <div><dt>Supply use</dt><dd>{(n * stats.sup).toFixed(1)}</dd></div>
            <div><dt>Days to equip</dt><dd>{days == null ? '–' : Math.ceil(days).toLocaleString('en-GB')}</dd></div>
          </dl>
        </div>
      </div>
      <p className="note">Factories are assumed to make 4.5 production points a day at full efficiency. Reliability is the average over every piece of equipment; lower reliability means more equipment lost to attrition.</p>
    </div>
  );
}

/** Pick the opponent the matchup scores are computed against. */
export function OpponentPicker({ enemy, setEnemy }) {
  const custom = enemy.id === 'custom';
  return (
    <div className="opponent">
      <label className="wide">Score against
        <select value={enemy.id || 'none'} onChange={(e) => setEnemy((x) => ({ ...x, id: e.target.value }))}>
          <option value="none">No opponent (raw stats only)</option>
          {OPPONENTS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="custom">Custom numbers…</option>
        </select>
      </label>
      {enemy.id && enemy.id !== 'none' && (
        <>
          <p className="note">{custom ? 'Enter the opponent division\'s stats as shown in game.' : OPPONENTS.find((o) => o.id === enemy.id)?.blurb + ' Built from your own research.'}</p>
          <div className="fields">
            <label>Matters when
              <select value={enemy.focus || 'both'} onChange={(e) => setEnemy((x) => ({ ...x, focus: e.target.value }))}>
                <option value="both">Attacking and defending</option>
                <option value="attack">We attack them</option>
                <option value="defend">They attack us</option>
              </select>
            </label>
            <label>Priority
              <NumberInput min="1" max="10" integer value={enemy.weight ?? 8} onChange={(v) => setEnemy((x) => ({ ...x, weight: v }))} />
            </label>
          </div>
          {custom && (
            <div className="fields">
              {ENEMY_KEYS.map((k) => (
                <label key={k}>{({ width: 'Width', sa: 'Soft attack', ha: 'Hard attack', def: 'Defense', brk: 'Breakthrough', org: 'Organization', arm: 'Armor', pier: 'Piercing', hard: 'Hardness %' })[k]}
                  <NumberInput min="0" allowEmpty value={enemy[k] ?? ''} onChange={(v) => setEnemy((x) => ({ ...x, [k]: v }))} />
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The selected template against the opponent. */
export function MatchupSummary({ stats, enemy }) {
  if (!stats || !enemy) return null;
  const m = matchup(stats, enemy);
  const verdict = (x) => (x >= 1.15 ? 'wins' : x <= 0.87 ? 'loses' : 'about even');
  return (
    <div className="td-panel matchup">
      <h4>Against the opponent</h4>
      <dl>
        <div><dt>We attack</dt><dd>{m.mAtk.toFixed(2)}× ({verdict(m.mAtk)})</dd></div>
        <div><dt>They attack</dt><dd>{m.mDef.toFixed(2)}× ({verdict(m.mDef)})</dd></div>
        <div><dt>Their soft / hard attack</dt><dd>{fmt(enemy.sa, 'sa')} / {fmt(enemy.ha, 'ha')}</dd></div>
        <div><dt>Their armor / piercing</dt><dd>{fmt(enemy.arm, 'arm')} / {fmt(enemy.pier, 'pier')}</dd></div>
      </dl>
      <p className="note">How much faster the opponent loses organization than we do on the same frontage. Above 1 we break them first. Terrain, entrenchment, planning and air are left out.</p>
    </div>
  );
}
