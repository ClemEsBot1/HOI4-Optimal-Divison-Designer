import React, { useMemo, useState } from 'react';
import Section, { setAllCollapsed } from '../components/Section.jsx';
import TemplateGrid from '../components/TemplateGrid.jsx';
import Pareto from '../components/Pareto.jsx';
import UnitPool from '../components/UnitPool.jsx';
import ManualDesigner from '../components/ManualDesigner.jsx';
import { TdPanel } from '../components/TankCard.jsx';
import { ScoreExplain, Sensitivity, Logistics, OpponentPicker, MatchupSummary } from '../components/Insights.jsx';
import { STATS, MOD_KEYS, evaluate, fmt, STAT_BY_KEY } from '../lib/stats.js';
import { GAP_SHARE } from '../lib/optimizer.js';
import { ROLES, ROLE_GROUPS } from '../lib/presets.js';
import { describeTemplate, countBy } from '../lib/format.js';

const ROLE_ICONS = { line: 'category_all_infantry', offensive_infantry: 'category_artillery', armor: 'category_all_armor', hunter: 'category_artillery', space_marines: 'category_all_armor', mountaineers: 'category_all_infantry', marines: 'category_all_infantry' };
const GROUP_ORDER = ['Offense', 'Staying power', 'Mobility', 'Cost', 'Utility'];
const COST_LABEL = { ic: 'Cheaper to build', mp: 'Uses less manpower', sup: 'Uses less supply', trucks: 'Needs fewer trucks' };
export const RESULT_LABEL = {
  width: 'Combat width', sa: 'Soft attack', ha: 'Hard attack', brk: 'Breakthrough', def: 'Defense', org: 'Organization',
  rec: 'Recovery rate', hp: 'Hit points', arm: 'Armor', pier: 'Piercing', hard: 'Hardness %', spd: 'Speed (km/h)', rel: 'Reliability %',
  air: 'Air attack', recon: 'Recon', ic: 'Production cost', mp: 'Manpower', sup: 'Supply use', trucks: 'Trucks needed',
};
const RESULT_PANELS = [
  { title: 'Base stats', keys: ['spd', 'hp', 'org', 'rec', 'rel', 'recon', 'width'] },
  { title: 'Combat stats', keys: ['sa', 'ha', 'air', 'def', 'brk', 'arm', 'pier', 'hard'] },
  { title: 'Equipment cost', keys: ['mp', 'ic', 'sup', 'trucks'] },
];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

/** A template as plain text, for pasting into a chat or a note. */
export function templateText(tpl, st, byId) {
  const d = describeTemplate(tpl, byId);
  return [
    `Width ${fmt(st.width, 'width')}: ${d.combat}`,
    d.support ? `Support: ${d.support}` : null,
    d.reg ? `Regimental: ${d.reg}` : null,
    `Soft ${fmt(st.sa, 'sa')} · Hard ${fmt(st.ha, 'ha')} · Def ${fmt(st.def, 'def')} · Brk ${fmt(st.brk, 'brk')} · Org ${fmt(st.org, 'org')} · Armor ${fmt(st.arm, 'arm')} · Pierce ${fmt(st.pier, 'pier')} · ${fmt(st.ic, 'ic')} IC`,
  ].filter(Boolean).join('\n');
}

export default function DesignerView(ctx) {
  const { mode } = ctx;
  return (
    <div className="view-designer">
      <div className="view-head">
        <div>
          <p className="kicker">{mode === 'manual' ? 'Drafting table' : mode === 'compare' ? 'Review board' : 'Operations'}</p>
          <h1>{mode === 'manual' ? 'Manual design' : mode === 'compare' ? 'Compare templates' : 'Division designer'}</h1>
          <p className="lede">{mode === 'manual'
            ? 'Build a template by hand and see how it measures up against the best the search found.'
            : mode === 'compare'
              ? 'Line up the search\'s alternatives, your saved designs and your manual draft side by side.'
              : 'Say what the division is for. The search goes through every legal template, proves which is best, and shows what each alternative gives up.'}</p>
        </div>
        <div className="seg mode-switch" role="group" aria-label="Mode">
          {[['search', 'Optimal search'], ['manual', 'Manual design'], ['compare', 'Compare']].map(([id, label]) => (
            <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => ctx.setMode(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="layout">
        <Rail {...ctx} />
        <div className="main">
          <a className="rail-jump" href="#division-goals">Role, limits and priorities are below the results</a>
          {mode === 'search' && <SearchMain {...ctx} />}
          {mode === 'manual' && <ManualMain {...ctx} />}
          {mode === 'compare' && <CompareMain {...ctx} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- left rail
function Rail(ctx) {
  const { roleId, applyRole, constraints, setCons, weights, setWeight, game, exclude, setExclude, mods, setMods, opts, setOpts, enemy, setEnemy, theatre, fitWidths } = ctx;
  const groups = GROUP_ORDER.map((g) => ({ g, stats: STATS.filter((s) => s.group === g) }));
  const ids = ['dz-role', 'dz-limits', 'dz-priorities', 'dz-opponent', 'dz-units', 'dz-bonuses'];
  return (
    <aside className="rail" id="division-goals" aria-label="Division goals">
      <div className="fold-all">
        <button type="button" className="ghost small" onClick={() => setAllCollapsed(ids, false)}>Expand all</button>
        <button type="button" className="ghost small" onClick={() => setAllCollapsed(ids, true)}>Collapse all</button>
      </div>
      <Section id="dz-role" kicker="Orders" title="Role">
        {ROLE_GROUPS.map((g) => (
          <div key={g.id} className="role-group">
            {g.id !== 'regular' && <h3 className="role-group-title">{g.name}</h3>}
            <div className="roles" role="radiogroup" aria-label={g.name}>
              {ROLES.filter((r) => r.group === g.id).map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={roleId === r.id} className={'role' + (roleId === r.id ? ' on' : '')} onClick={() => applyRole(r)}>
                  <span className="role-title">
                    <img src={`/hoi4/icons/${ROLE_ICONS[r.id] || 'category_all_infantry'}.png`} alt="" />
                    <strong>{r.name}</strong>
                    <em>{roleId === r.id ? 'Active' : 'Select'}</em>
                  </span>
                  <span className="role-blurb">{r.blurb}</span>
                  {r.constraints.metaWidths?.length > 0 && <span className="role-meta">Meta width {r.constraints.metaWidths.join(' or ')}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section id="dz-limits" kicker="Hard limits" title="Limits">
        <div className="fields">
          <label>Combat width, from
            <input type="number" min="0" max="45" value={constraints.wmin} onChange={(e) => setCons('wmin', Math.max(0, Math.min(45, Number(e.target.value) || 0)))} /></label>
          <label>to
            <input type="number" min="0" max="45" value={constraints.wmax} onChange={(e) => setCons('wmax', Math.max(0, Math.min(45, Number(e.target.value) || 0)))} /></label>
          <label>Organization at least
            <input type="number" min="0" max="100" value={constraints.minOrg} onChange={(e) => setCons('minOrg', Math.max(0, Number(e.target.value) || 0))} /></label>
          <label>Armor at least
            <input type="number" min="0" max="400" value={constraints.minArm} onChange={(e) => setCons('minArm', Math.max(0, Number(e.target.value) || 0))} /></label>
          <label className="wide">Production cost at most (0 for no limit)
            <input type="number" min="0" step="100" value={constraints.maxIc} onChange={(e) => setCons('maxIc', Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        <div className="fields">
          <label>Meta widths
            <input type="text" inputMode="numeric" value={(constraints.metaWidths || []).join(', ')} placeholder="e.g. 20, 15"
              onChange={(e) => setCons('metaWidths', e.target.value.split(/[ ,;]+/).map(Number).filter((x) => x > 0 && x <= 60))} /></label>
          <label>Pull toward them
            <select value={constraints.metaPull ?? 0.05} onChange={(e) => setCons('metaPull', Number(e.target.value))}>
              <option value={0}>Off</option>
              <option value={0.02}>Light (2% a width step)</option>
              <option value={0.05}>Normal (5% a width step)</option>
              <option value={0.1}>Strong (10% a width step)</option>
            </select></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!constraints.perWidth} onChange={(e) => setCons('perWidth', e.target.checked)} />
          Score per frontage: stats per width times how much of a battle's width whole divisions use (over-width costs 2% per 1% over, up to 33%), so the widest division is not picked just for being bigger
        </label>
        <p className="note">The width range is a hard limit; inside it the search goes for the width that scores best, usually a meta width, not the widest.</p>
        {theatre.mix && (
          <p className="note theatre-note">
            {ctx.theatreState.fitOnly
              ? (fitWidths && fitWidths.length ? <>Theatre <b>{theatre.name}</b>: only widths {fitWidths.join(', ')} (they fill at least {Math.round(ctx.theatreState.minFit * 100)}% of its frontage).</> : <>No width in this range fills {Math.round(ctx.theatreState.minFit * 100)}% of {theatre.name}'s frontage, so width is not restricted.</>)
              : <>Theatre <b>{theatre.name}</b> is set; turn on its width filter in the theatre menu to search only widths that fit.</>}
          </p>
        )}
      </Section>
      <Section id="dz-priorities" kicker="Custom orders" title="Priorities" defaultOpen={false}>
        <p className="note">The role sets these. Change any to make your own; 0 ignores a stat, 10 matters most.</p>
        {groups.map(({ g, stats }) => (
          <details key={g} className="group" open={g === 'Offense' || g === 'Staying power'}>
            <summary>{g}</summary>
            {stats.filter((s) => !s.matchup).map((s) => {
              const signed = !!s.signed;
              const label = COST_LABEL[s.key] || (signed ? 'Hardness (armored ↔ soft)' : s.label);
              return (
                <label className="slider" key={s.key}>
                  <span className="slider-name">{label}</span>
                  <output>{weights[s.key] || 0}</output>
                  <input type="range" min={signed ? -10 : 0} max="10" step="1" value={weights[s.key] || 0} onChange={(e) => setWeight(s.key, Number(e.target.value))} />
                </label>
              );
            })}
          </details>
        ))}
      </Section>
      <Section id="dz-opponent" kicker="Intelligence" title="Opponent" defaultOpen={false}>
        <OpponentPicker enemy={enemy} setEnemy={setEnemy} />
      </Section>
      <Section id="dz-units" kicker="Order of battle" title="Allowed units" defaultOpen={false}>
        <UnitPool game={game} exclude={exclude} setExclude={setExclude} />
      </Section>
      <Section id="dz-bonuses" kicker="Modifiers" title="Other bonuses" defaultOpen={false}>
        <p className="note">Leaders, national spirits and anything else the data does not model. These scale the division totals.</p>
        <div className="fields">
          {MOD_KEYS.map((m) => (
            <label key={m.key}>{m.label} %
              <input type="number" step="1" value={mods[m.key] ?? 0} onChange={(e) => setMods((x) => ({ ...x, [m.key]: Number(e.target.value) || 0 }))} /></label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={opts.supportDilutesOrg} onChange={(e) => setOpts((o) => ({ ...o, supportDilutesOrg: e.target.checked }))} />
          Support companies count in the organization average
        </label>
      </Section>
    </aside>
  );
}

// ---------------------------------------------------------------- optimal search
function Status({ running, res, tick, copyLink, copied }) {
  return (
    <div className="status">
      {running && (
        <span className="busy">
          {res?.provisional ? 'Proving it is the best' : 'Searching'}
          {tick && <span className="progress" aria-hidden="true"><i style={{ width: `${Math.min(100, (tick.nodes / tick.limit) * 100)}%` }} /></span>}
          {tick && <small>{tick.nodes.toLocaleString('en-GB')} branches</small>}
        </span>
      )}
      {!running && res?.explored != null && (
        <span className={'verdict ' + (res.proven ? 'ok' : 'warn')}>
          <b>{res.proven ? `Proven best (to within ${(GAP_SHARE * 100).toFixed(1)}%)` : 'Best found; proof stopped at its budget'}</b>
          <small>{res.nodes.toLocaleString('en-GB')} branches · {res.explored.toLocaleString('en-GB')} complete templates · {(res.ms / 1000).toFixed(1)} s</small>
        </span>
      )}
      <button type="button" className="ghost small" onClick={copyLink}>{copied === 'link' ? 'Link copied' : 'Copy link'}</button>
    </div>
  );
}

function SearchMain(ctx) {
  const { res, result, running, tick, selected, setSelected, byId, shown, why, topKeys, axisX, axisY, setAxisX, setAxisY, role, scale, setScale, game, go, fitOf, theatre, saveTemplate, copyText, copied } = ctx;
  const bestScore = res?.top?.[0]?.score;
  const pickTemplate = (t) => setSelected({ items: t.items, support: t.support, reg: t.reg, key: t.key });
  const designsUsed = ctx.designsUsed;
  const fit = shown && theatre.mix ? fitOf(shown.width) : null;
  return (
    <>
      <Section id="dz-result" kicker={role ? `Role // ${role.name}` : 'Role // Custom priorities'} title="Recommended formation"
        actions={shown && byId && (
          <div className="seg">
            <button type="button" className="ghost small" onClick={() => saveTemplate(selected, shown)}>Save</button>
            <button type="button" className="ghost small" onClick={() => copyText(selected, shown)}>{copied === 'text' ? 'Copied' : 'Copy as text'}</button>
          </div>
        )}>
        <Status running={running} res={res} tick={tick} copyLink={ctx.copyLink} copied={copied} />
        {res?.error && <p className="error" role="alert">{res.error}</p>}
        {shown && byId && (
          <>
            <div className="kpis">
              <div><span>Combat width</span><b>{fmt(shown.width, 'width')}</b></div>
              <div><span>Organization</span><b>{fmt(shown.org, 'org')}</b></div>
              <div><span>Soft attack</span><b>{fmt(shown.sa, 'sa')}</b></div>
              <div><span>Breakthrough</span><b>{fmt(shown.brk, 'brk')}</b></div>
              <div><span>Production cost</span><b>{fmt(shown.ic, 'ic')}</b></div>
              {fit != null && <div className={fit >= 0.9 ? 'good' : fit < 0.75 ? 'bad' : ''}><span>Frontage fit · {theatre.name}</span><b>{pct(fit)}</b></div>}
            </div>
            <div className="result-body">
              <div className="template-frame">
                <TemplateGrid items={selected.items} support={selected.support} reg={selected.reg || []} byId={byId} columnSize={res.columnSize} layout={shown.layout} mods={result?.mods} opts={result?.opts} />
              </div>
              <div className="detail">
                <h3>Composition</h3>
                <ul className="compo">
                  {[...countBy(selected.items)].sort((a, b) => b[1] - a[1]).map(([id, n]) => <li key={id}><b>{n}</b> {byId.get(id).name}</li>)}
                  {selected.support.length > 0 && <li className="compo-sup">Support: {selected.support.map((id) => byId.get(id).name).join(', ')}</li>}
                  {(selected.reg || []).length > 0 && <li className="compo-sup">Regimental: {[...countBy(selected.reg)].map(([id, n]) => (n > 1 ? `${n} ${byId.get(id).name}` : byId.get(id).name)).join(', ')}</li>}
                </ul>
                <h3>Stats</h3>
                <div className="td-stats result-stats">
                  {RESULT_PANELS.map((panel) => {
                    const keys = panel.keys.filter((k) => !((k === 'air' || k === 'trucks' || k === 'recon') && !shown[k]));
                    return <TdPanel key={panel.title} title={panel.title} rows={keys.map((k) => [RESULT_LABEL[k], fmt(shown[k], k)])} />;
                  })}
                </div>
                {res.enemy && <MatchupSummary stats={shown} enemy={res.enemy} />}
                {designsUsed.length > 0 && (
                  <p className="note designs-link">
                    Tank designs used: {designsUsed.map((d) => d.title).join(', ')}.{' '}
                    <button type="button" className="linkish" onClick={() => go('equipment', 'tanks')}>Open in Equipment</button>
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </Section>

      {shown && byId && why && (
        <Section id="dz-explain" kicker="Debrief" title="Why it wins, and how stable it is">
          <ScoreExplain explain={why.rows} hasRef={why.hasRef} />
          {!why.isWinner && <p className="note">Compared with the top result: bars to the left are where the top result is ahead.</p>}
          {res.sensitivity && (
            <Sensitivity sensitivity={res.sensitivity} winnerKey={res.top[0].key}
              describe={(c) => describeTemplate(c, byId).combat} onPick={(c) => pickTemplate({ ...c, key: c.key })} />
          )}
        </Section>
      )}

      {shown && byId && (
        <Section id="dz-logistics" kicker="Quartermaster" title="Equipment, supply and cost at scale" defaultOpen={false}>
          <Logistics game={game} stats={shown} scale={scale} setScale={setScale} />
        </Section>
      )}

      {res?.top && byId && (
        <Section id="dz-ranked" kicker="Alternatives" title="Ranked alternatives">
          <p className="note">The proven best, then the best template the search found for each other kind of division. Gap is how far each is behind the best in score points (1 point ≈ a 10% loss on a priority-10 stat).</p>
          <div className="table-scroll">
            <table className="rank">
              <thead>
                <tr>
                  <th scope="col">#</th><th scope="col">Kind</th><th scope="col">Battalions</th><th scope="col">Support</th><th scope="col">Regimental</th>
                  <th scope="col">Width</th><th scope="col">Soft</th><th scope="col">Hard</th><th scope="col">Brk</th><th scope="col">Def</th><th scope="col">Org</th><th scope="col">Cost</th>
                  {theatre.mix && <th scope="col">Fit</th>}<th scope="col">Gap</th>
                </tr>
              </thead>
              <tbody>
                {res.top.map((t, i) => {
                  const d = describeTemplate(t, byId);
                  const on = selected?.key === t.key;
                  return (
                    <tr key={t.key} className={on ? 'on' : ''}>
                      <td><button type="button" className="rowbtn" aria-pressed={on} onClick={() => pickTemplate(t)}>{i + 1}</button></td>
                      <td className="txt">{t.archetypeLabel || ''}</td>
                      <td className="txt">{d.combat}</td>
                      <td className="txt">{d.support || 'none'}</td>
                      <td className="txt">{d.reg || 'none'}</td>
                      <td>{fmt(t.stats.width, 'width')}</td><td>{fmt(t.stats.sa, 'sa')}</td><td>{fmt(t.stats.ha, 'ha')}</td>
                      <td>{fmt(t.stats.brk, 'brk')}</td><td>{fmt(t.stats.def, 'def')}</td><td>{fmt(t.stats.org, 'org')}</td><td>{fmt(t.stats.ic, 'ic')}</td>
                      {theatre.mix && <td>{pct(fitOf(t.stats.width))}</td>}
                      <td>{i === 0 ? 'best' : (t.score - bestScore).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {res?.pool && (
        <Section id="dz-tradeoffs" kicker="Analysis" title="Trade-offs and the Pareto front">
          <p className="note">Pick any two stats to see what improving one costs in the other. {res.frontSize ? `${res.frontSize.toLocaleString('en-GB')} of these templates are on the Pareto front of your priorities; the priorities pick the winner among them.` : ''}</p>
          <Pareto pool={res.pool} poolKeys={res.poolKeys} poolFront={res.poolFront} axisX={axisX} axisY={axisY} setAxisX={setAxisX} setAxisY={setAxisY}
            topKeys={topKeys} selectedKey={selected?.key} onPick={ctx.pickKey} />
        </Section>
      )}
      {!res && <p className="note">Starting the search…</p>}
      {result && null}
    </>
  );
}

// ---------------------------------------------------------------- manual design
function ManualMain(ctx) {
  const { res, result, byId, manual, setManual, saveTemplate, fitOf, theatre } = ctx;
  const st = useMemo(() => (byId && manual.items.length && manual.items.every((id) => byId.has(id))
    ? evaluate(manual, byId, result.mods, result.opts, res.columnSize) : null), [byId, manual, result, res]);
  if (!res?.units || !byId) return <p className="note">Waiting for the first search to load the units.</p>;
  return (
    <>
      <Section id="mn-draft" kicker="Drafting table" title="Design your own division">
        <ManualDesigner units={res.units} columnSize={res.columnSize} mods={result.mods} opts={result.opts} best={res.top?.[0]}
          design={manual} setDesign={setManual} onSave={(tpl) => saveTemplate(tpl, evaluate(tpl, byId, result.mods, result.opts, res.columnSize))} />
      </Section>
      {st && (
        <Section id="mn-preview" kicker="Preview" title="Your template">
          {!st.valid && <p className="error">Not valid: check columns, support companies and regimental slots.</p>}
          <div className="kpis">
            <div><span>Combat width</span><b>{fmt(st.width, 'width')}</b></div>
            <div><span>Organization</span><b>{fmt(st.org, 'org')}</b></div>
            <div><span>Soft attack</span><b>{fmt(st.sa, 'sa')}</b></div>
            <div><span>Defense</span><b>{fmt(st.def, 'def')}</b></div>
            <div><span>Production cost</span><b>{fmt(st.ic, 'ic')}</b></div>
            {theatre.mix && <div><span>Frontage fit</span><b>{pct(fitOf(st.width))}</b></div>}
          </div>
          <div className="template-frame">
            <TemplateGrid items={manual.items} support={manual.support} reg={manual.reg} byId={byId} columnSize={res.columnSize} layout={st.layout} mods={result?.mods} opts={result?.opts} />
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- compare
const COMPARE_KEYS = ['width', 'sa', 'ha', 'brk', 'def', 'org', 'hp', 'arm', 'pier', 'hard', 'spd', 'rel', 'ic', 'mp', 'sup', 'trucks'];

function CompareMain(ctx) {
  const { res, result, byId, saved, removeSaved, manual, fitOf, theatre } = ctx;
  const candidates = useMemo(() => {
    if (!res?.top || !byId) return [];
    const list = res.top.map((t, i) => ({ id: `top:${t.key}`, label: `#${i + 1} ${t.archetypeLabel || ''}`, tpl: t }));
    for (const s of saved) list.push({ id: `saved:${s.id}`, label: `Saved: ${s.name}`, tpl: s, saved: s });
    if (manual.items.length) list.push({ id: 'manual', label: 'Manual draft', tpl: manual });
    return list;
  }, [res, byId, saved, manual]);
  const [picked, setPicked] = useState([]);
  const chosen = (picked.length ? picked : candidates.slice(0, 3).map((c) => c.id)).map((id) => candidates.find((c) => c.id === id)).filter(Boolean);
  if (!res?.top || !byId) return <p className="note">Waiting for the first search.</p>;
  const evals = chosen.map((c) => {
    const ok = [...c.tpl.items, ...(c.tpl.support || []), ...(c.tpl.reg || [])].every((id) => byId.has(id));
    return { ...c, st: ok ? evaluate({ items: c.tpl.items, support: c.tpl.support || [], reg: c.tpl.reg || [] }, byId, result.mods, result.opts, res.columnSize) : null };
  });
  const toggle = (id) => setPicked((cur) => {
    const base = cur.length ? cur : chosen.map((c) => c.id);
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(-4);
  });
  return (
    <>
      <Section id="cp-pick" kicker="Candidates" title="Pick up to four">
        <div className="chips">
          {candidates.map((c) => (
            <span key={c.id} className={'chip' + (chosen.some((x) => x.id === c.id) ? ' on' : '')}>
              <button type="button" onClick={() => toggle(c.id)} aria-pressed={chosen.some((x) => x.id === c.id)}>{c.label}</button>
              {c.saved && <button type="button" className="chip-x" aria-label={`Delete ${c.saved.name}`} onClick={() => removeSaved(c.saved.id)}>×</button>}
            </span>
          ))}
        </div>
        {!saved.length && <p className="note">Save templates from the designer or the manual draft to compare them here; saved templates stay in this browser.</p>}
      </Section>
      <Section id="cp-table" kicker="Side by side" title="Comparison">
        <div className="table-scroll">
          <table className="rank compare">
            <thead><tr><th scope="col">Stat</th>{evals.map((e) => <th key={e.id} scope="col">{e.label}</th>)}</tr></thead>
            <tbody>
              {COMPARE_KEYS.map((k) => {
                const dir = k === 'width' ? 0 : (STAT_BY_KEY[k]?.dir ?? 1);
                const vals = evals.map((e) => (e.st ? e.st[k] : null));
                const nums = vals.filter((v) => v != null);
                const best = dir > 0 ? Math.max(...nums) : dir < 0 ? Math.min(...nums) : null;
                return (
                  <tr key={k}>
                    <th scope="row" className="txt">{RESULT_LABEL[k]}</th>
                    {vals.map((v, i) => <td key={i} className={best != null && v != null && Math.abs(v - best) < 1e-9 && nums.length > 1 ? 'best' : ''}>{v == null ? 'not buildable' : fmt(v, k)}</td>)}
                  </tr>
                );
              })}
              {theatre.mix && <tr><th scope="row" className="txt">Frontage fit</th>{evals.map((e) => <td key={e.id}>{e.st ? pct(fitOf(e.st.width)) : '–'}</td>)}</tr>}
            </tbody>
          </table>
        </div>
        <div className="compare-grids">
          {evals.map((e) => e.st && (
            <figure key={e.id} className="template-frame">
              <figcaption>{e.label}</figcaption>
              <TemplateGrid items={e.tpl.items} support={e.tpl.support || []} reg={e.tpl.reg || []} byId={byId} columnSize={res.columnSize} layout={e.st.layout} mods={result?.mods} opts={result?.opts} />
            </figure>
          ))}
        </div>
      </Section>
      <p className="note">{plural(saved.length, 'saved template', 'saved templates')} in this browser.</p>
    </>
  );
}
