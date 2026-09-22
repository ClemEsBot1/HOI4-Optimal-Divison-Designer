import React, { useEffect, useMemo, useRef, useState } from 'react';
import TemplateGrid from './components/TemplateGrid.jsx';
import Pareto from './components/Pareto.jsx';
import TechPicker from './components/TechPicker.jsx';
import DoctrinePicker from './components/DoctrinePicker.jsx';
import UnitPool from './components/UnitPool.jsx';
import ManualDesigner from './components/ManualDesigner.jsx';
import raw from './data/game.json';
import { buildGame, EMPTY_DOCTRINE } from './lib/game.js';
import { STATS, MOD_KEYS, DEFAULT_OPTS, evaluate, fmt } from './lib/stats.js';
import { parseKey, DEFAULT_CONSTRAINTS } from './lib/optimizer.js';
import { ROLES, ZERO_WEIGHTS, defaultTech, defaultExclude, doctrineRecommendations } from './lib/presets.js';
import { describeTemplate, countBy, encodeState, decodeState } from './lib/format.js';
import { describeDesign } from './lib/describe.js';

const game = buildGame(raw);

const ROLE_AXES = {
  line: ['def', 'org'], offensive_infantry: ['sa', 'org'], armor: ['sa', 'brk'], hunter: ['ha', 'pier'],
  space_marines: ['arm', 'sa'], custom: ['sa', 'def'],
};
const SHOW_ADVANCED_PRIORITIES = false; // Keep the optimizer controls implemented, but present role presets for now.

const COST_LABEL = { ic: 'Cheaper to build', mp: 'Uses less manpower', sup: 'Uses less supply', trucks: 'Needs fewer trucks' };
const NAV_ITEMS = [
  { href: '#results', icon: 'category_all_infantry', label: 'Designer' },
  { href: '#technology', icon: 'category_artillery', label: 'Research' },
  { href: '#doctrine', icon: 'category_all_armor', label: 'Doctrine' },
  { href: '#equipment', icon: 'category_artillery', label: 'Equipment' },
];
const ROLE_ICONS = {
  line: 'category_all_infantry',
  offensive_infantry: 'category_artillery',
  armor: 'category_all_armor',
  hunter: 'category_artillery',
  space_marines: 'category_all_armor',
};
const GROUP_ORDER = ['Offense', 'Staying power', 'Mobility', 'Cost', 'Utility'];

const RESULT_STATS = ['width', 'sa', 'ha', 'brk', 'def', 'org', 'rec', 'hp', 'arm', 'pier', 'hard', 'spd', 'air', 'recon', 'ic', 'mp', 'sup', 'trucks'];
const RESULT_LABEL = {
  width: 'Combat width', sa: 'Soft attack', ha: 'Hard attack', brk: 'Breakthrough', def: 'Defense', org: 'Organization',
  rec: 'Recovery rate', hp: 'Hit points', arm: 'Armor', pier: 'Piercing', hard: 'Hardness %', spd: 'Speed (km/h)',
  air: 'Air attack', recon: 'Recon', ic: 'Production cost', mp: 'Manpower', sup: 'Supply use', trucks: 'Trucks needed',
};

function loadInitial() {
  const base = {
    roleId: ROLES[0].id,
    weights: { ...ZERO_WEIGHTS, ...ROLES[0].weights },
    constraints: { ...DEFAULT_CONSTRAINTS, ...ROLES[0].constraints },
    techs: defaultTech(game),
    doctrine: { ...EMPTY_DOCTRINE, slotCount: 1 },
    exclude: defaultExclude(game),
    mods: {},
    opts: { ...DEFAULT_OPTS },
    axes: ROLE_AXES[ROLES[0].id],
  };
  try {
    const m = /#s=(.+)$/.exec(window.location.hash);
    const s = m && decodeState(m[1], game);
    if (s && s.w && s.c) {
      return {
        roleId: s.r || 'custom',
        weights: { ...ZERO_WEIGHTS, ...s.w },
        constraints: { ...DEFAULT_CONSTRAINTS, ...s.c },
        techs: s.t || base.techs, // links made for an older data set fall back to the default research
        doctrine: { ...base.doctrine, ...(s.d || {}) },
        exclude: Array.isArray(s.x) ? s.x : base.exclude,
        mods: s.m || {},
        opts: { ...DEFAULT_OPTS, ...(s.o || {}) },
        axes: s.ax || base.axes,
      };
    }
  } catch { /* ignore malformed links */ }
  return base;
}

export default function App() {
  const initial = useMemo(loadInitial, []);
  const [roleId, setRoleId] = useState(initial.roleId);
  const [weights, setWeights] = useState(initial.weights);
  const [constraints, setConstraints] = useState(initial.constraints);
  const [techs, setTechs] = useState(initial.techs);
  const [doctrine, setDoctrine] = useState(initial.doctrine);
  const [exclude, setExclude] = useState(initial.exclude);
  const [mods, setMods] = useState(initial.mods);
  const [opts, setOpts] = useState(initial.opts);
  const [axisX, setAxisX] = useState(initial.axes[0]);
  const [axisY, setAxisY] = useState(initial.axes[1]);

  const [result, setResult] = useState(null); // { res, mods, opts, roleId }
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);

  const workerRef = useRef(null);
  const runId = useRef(0);

  // ---- search: debounce, run in a worker, cancel stale runs ----
  useEffect(() => {
    const total = Object.values(weights).reduce((a, b) => a + Math.abs(b), 0);
    if (!total) {
      setResult({ res: { error: 'Set at least one priority above zero.' }, mods, opts, roleId });
      setRunning(false);
      return undefined;
    }
    setRunning(true);
    const id = ++runId.current;
    const timer = setTimeout(() => {
      if (workerRef.current) workerRef.current.terminate();
      const w = new Worker(new URL('./lib/worker.js', import.meta.url), { type: 'module' });
      workerRef.current = w;
      w.onmessage = (e) => {
        if (e.data.id !== id) return;
        const r = e.data.res;
        setResult({ res: r, mods, opts, roleId });
        if (r.top) setSelected({ items: r.top[0].items, support: r.top[0].support, reg: r.top[0].reg, key: r.top[0].key });
        else setSelected(null);
        setRunning(false);
      };
      w.onerror = () => {
        setResult({ res: { error: 'The search worker failed to start.' }, mods, opts, roleId });
        setRunning(false);
      };
      w.postMessage({ id, params: { techs: [...techs], doctrine, exclude, weights, constraints, mods, opts, topN: 10 } });
    }, 400);
    return () => clearTimeout(timer);
  }, [weights, constraints, techs, doctrine, exclude, mods, opts]); // roleId only labels the result

  useEffect(() => () => workerRef.current && workerRef.current.terminate(), []);

  // ---- keep the URL in sync so a setup can be shared ----
  useEffect(() => {
    const s = encodeState({ r: roleId, w: weights, c: constraints, t: [...techs], d: doctrine, x: exclude, m: mods, o: opts, ax: [axisX, axisY] }, game);
    if (s) window.history.replaceState(null, '', '#s=' + s);
  }, [roleId, weights, constraints, techs, doctrine, exclude, mods, opts, axisX, axisY]);

  // ---- derived display data ----
  const res = result?.res;
  const byId = useMemo(() => (res?.units ? new Map(res.units.map((u) => [u.id, u])) : null), [res]);
  const shown = useMemo(() => {
    if (!res?.top || !selected || !byId) return null;
    const ids = [...selected.items, ...selected.support, ...(selected.reg || [])];
    if (!ids.every((id) => byId.has(id))) return null;
    return evaluate(selected, byId, result.mods, result.opts, res.columnSize);
  }, [res, selected, byId, result]);
  const topKeys = useMemo(() => (res?.top ? res.top.map((t) => t.key) : []), [res]);
  const role = ROLES.find((r) => r.id === result?.roleId);
  const recommendations = doctrineRecommendations(game, result?.roleId);
  const bestScore = res?.top?.[0]?.score;

  const designsUsed = useMemo(() => {
    if (!selected || !byId) return [];
    const seen = new Map();
    for (const id of [...selected.items, ...selected.support, ...(selected.reg || [])]) {
      const u = byId.get(id);
      if (u && u.design) seen.set(`${u.design.chassis}|${u.design.role}`, u);
    }
    return [...seen.values()].map((u) => ({
      key: `${u.design.chassis}|${u.design.role}`,
      title: `${game.raw.designers[u.design.chassis]?.name || u.design.chassis}${u.design.role === 'armor' ? '' : `, ${u.design.role.replace('_', '-')}`}`,
      parts: describeDesign(game, u.design),
    }));
  }, [selected, byId]);

  // ---- handlers ----
  const applyRole = (r) => {
    setRoleId(r.id);
    setWeights({ ...ZERO_WEIGHTS, ...r.weights });
    setConstraints({ ...DEFAULT_CONSTRAINTS, ...r.constraints });
    const ax = ROLE_AXES[r.id];
    setAxisX(ax[0]);
    setAxisY(ax[1]);
  };
  const setWeight = (k, v) => { setRoleId('custom'); setWeights((w) => ({ ...w, [k]: v })); };
  const setCons = (k, v) => { setRoleId('custom'); setConstraints((c) => ({ ...c, [k]: v })); };
  const pickKey = (key) => {
    const { items, support, reg } = parseKey(key);
    setSelected({ items, support, reg, key });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const groups = GROUP_ORDER.map((g) => ({ g, stats: STATS.filter((s) => s.group === g) }));
  const version = /^unknown/.test(game.meta.gameVersion) ? null : game.meta.gameVersion;

  return (
    <div className="app">
      <header className="game-bar">
        <a className="brand-lockup" href="#results" aria-label="Division Desk home">
          <span className="brand-crest"><img src="/hoi4/icons/category_all_infantry.png" alt="" /></span>
          <span className="brand-copy"><small>HOI4 // FIELD COMMAND</small><strong>DIVISION DESK</strong></span>
        </a>
        <nav className="game-nav" aria-label="Designer sections">
          {NAV_ITEMS.map((item, i) => (
            <a key={item.href} className={'nav-tab' + (i === 0 ? ' active' : '')} href={item.href}>
              <img src={`/hoi4/icons/${item.icon}.png`} alt="" />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="game-actions">
          <span className="connection"><i /> LOCAL DATA</span>
          <span className="patch">{version ? `PATCH ${version}` : 'PATCH // UNKNOWN'}</span>
        </div>
      </header>

      <div className="command-strip" aria-label="Current setup summary">
        <span><b>THEATRE</b> GERMANY</span>
        <span><b>YEAR</b> 1936—1945</span>
        <span><b>MODE</b> OPTIMAL TEMPLATE SEARCH</span>
        <span className="strip-right">ALL DLC // NO MODS</span>
      </div>

      <header className="masthead">
        <div className="masthead-topline"><span>STRATEGIC COMMAND // RESEARCH &amp; DEVELOPMENT</span><span>DESIGN BUREAU 01</span></div>
        <div className="masthead-main">
          <div>
            <div className="eyebrow">DIVISION OPTIMIZATION SYSTEM</div>
            <h1>Division Desk</h1>
            <p>Say what the division is for. The bureau searches thousands of templates, ranks the strongest formations, and records what each design gives up.</p>
          </div>
          <div className="masthead-seal" aria-hidden="true"><span>R&amp;D</span><b>★</b><small>FIELD<br />READY</small></div>
        </div>
      </header>

      <div className="layout">
        <aside className="rail" aria-label="Division goals">
          <section className="block">
            <h2>Role</h2>
            <div className="roles" role="radiogroup" aria-label="Role presets">
              {ROLES.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={roleId === r.id}
                  className={'role' + (roleId === r.id ? ' on' : '')} onClick={() => applyRole(r)}>
                  <span className="role-title">
                    <img src={`/hoi4/icons/${ROLE_ICONS[r.id] || 'category_all_infantry'}.png`} alt="" />
                    <strong>{r.name}</strong>
                    <em>{roleId === r.id ? 'ACTIVE' : 'SELECT'}</em>
                  </span>
                  <span className="role-blurb">{r.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          {SHOW_ADVANCED_PRIORITIES && <section className="block">
            <h2>Advanced priorities</h2>
            <p className="note">These controls remain available for future custom optimization. Role presets currently define the search priorities.</p>
            {groups.map(({ g, stats }) => (
              <details key={g} className="group" open={g !== 'Utility'}>
                <summary>{g}</summary>
                {stats.map((s) => {
                  const signed = !!s.signed;
                  const label = COST_LABEL[s.key] || (signed ? 'Hardness (armored ↔ soft)' : s.label);
                  return (
                    <label className="slider" key={s.key}>
                      <span className="slider-name">{label}</span>
                      <output>{weights[s.key] || 0}</output>
                      <input type="range" min={signed ? -10 : 0} max="10" step="1" value={weights[s.key] || 0}
                        onChange={(e) => setWeight(s.key, Number(e.target.value))} />
                    </label>
                  );
                })}
              </details>
            ))}
          </section>}

          <section className="block">
            <h2>Limits</h2>
            <div className="fields">
              <label>Combat width, from
                <input type="number" min="0" max="45" value={constraints.wmin}
                  onChange={(e) => setCons('wmin', Math.max(0, Math.min(45, Number(e.target.value) || 0)))} /></label>
              <label>to
                <input type="number" min="0" max="45" value={constraints.wmax}
                  onChange={(e) => setCons('wmax', Math.max(0, Math.min(45, Number(e.target.value) || 0)))} /></label>
              <label>Organization at least
                <input type="number" min="0" max="100" value={constraints.minOrg}
                  onChange={(e) => setCons('minOrg', Math.max(0, Number(e.target.value) || 0))} /></label>
              <label>Armor at least
                <input type="number" min="0" max="400" value={constraints.minArm}
                  onChange={(e) => setCons('minArm', Math.max(0, Number(e.target.value) || 0))} /></label>
              <label className="wide">Production cost at most (0 for no limit)
                <input type="number" min="0" step="100" value={constraints.maxIc}
                  onChange={(e) => setCons('maxIc', Math.max(0, Number(e.target.value) || 0))} /></label>
            </div>
            <label className="check">
              <input type="checkbox" checked={!!constraints.perWidth} onChange={(e) => setCons('perWidth', e.target.checked)} />
              Compare designs per combat width, so a wider division is not favoured just for being bigger
            </label>
          </section>

          <section className="block" id="technology">
            <h2>Technology</h2>
            <TechPicker game={game} techs={techs} setTechs={setTechs} />
          </section>

          <section className="block" id="doctrine">
            <h2>Recommended doctrines</h2>
            <DoctrineRecommendations recommendations={recommendations} />
          </section>

          <section className="block">
            <h2>Doctrine setup</h2>
            <DoctrinePicker game={game} doctrine={doctrine} setDoctrine={setDoctrine} />
          </section>

          <section className="block">
            <h2>Allowed units</h2>
            <UnitPool game={game} exclude={exclude} setExclude={setExclude} />
          </section>

          <section className="block">
            <h2>Other bonuses</h2>
            <details className="group">
              <summary>Bonus modifiers (percent)</summary>
              <p className="note">Leaders, national spirits and anything else the data does not model. These scale the division totals.</p>
              <div className="fields">
                {MOD_KEYS.map((m) => (
                  <label key={m.key}>{m.label}
                    <input type="number" step="1" value={mods[m.key] ?? 0}
                      onChange={(e) => setMods((x) => ({ ...x, [m.key]: Number(e.target.value) || 0 }))} /></label>
                ))}
              </div>
            </details>
            <label className="check">
              <input type="checkbox" checked={opts.supportDilutesOrg}
                onChange={(e) => setOpts((o) => ({ ...o, supportDilutesOrg: e.target.checked }))} />
              Support companies count in the organization average
            </label>
          </section>
        </aside>

        <main className="main">
          <div className="banner" role="note">
            <strong>Numbers come from the game files</strong>{version ? ` (version ${version})` : ''}, with every DLC and no mods. A few rules are still assumptions, including how many regimental companies a column takes and how tank modules are chosen. Check a result in game before you trust it. See <a href="#data">data and assumptions</a>.
          </div>

          <section className="result" id="results" aria-live="polite">
            <div className="result-head">
              <h2>{role ? role.name : 'Custom priorities'}</h2>
              <div className="status">
                {running && <span className="busy">Searching</span>}
                {!running && res?.explored && <span>{res.explored.toLocaleString('en-GB')} valid templates tried in {(res.ms / 1000).toFixed(1)} s</span>}
                <button type="button" className="ghost" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this setup'}</button>
              </div>
            </div>

            {shown && byId && (
              <div className="result-summary">
                <div className="summary-stamp"><span>RECOMMENDED FORMATION</span><strong>{role ? role.name : 'Custom priorities'}</strong><small>{selected?.items.length || 0} battalions // {selected?.support.length || 0} support companies</small></div>
                <div className="summary-kpis">
                  <div><span>COMBAT WIDTH</span><b>{fmt(shown.width, 'width')}</b></div>
                  <div><span>ORGANIZATION</span><b>{fmt(shown.org, 'org')}</b></div>
                  <div><span>SOFT ATTACK</span><b>{fmt(shown.sa, 'sa')}</b></div>
                  <div><span>BREAKTHROUGH</span><b>{fmt(shown.brk, 'brk')}</b></div>
                  <div><span>PRODUCTION COST</span><b>{fmt(shown.ic, 'ic')}</b></div>
                </div>
              </div>
            )}

            {res?.error && <p className="error" role="alert">{res.error}</p>}

            {shown && byId && (
              <div className="result-body">
                <TemplateGrid items={selected.items} support={selected.support} reg={selected.reg || []} byId={byId} columnSize={res.columnSize} layout={shown.layout} />
                <div className="detail">
                  <h3>Composition</h3>
                  <ul className="compo">
                    {[...countBy(selected.items)].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                      <li key={id}><b>{n}</b> {byId.get(id).name}</li>
                    ))}
                    {selected.support.length > 0 && (
                      <li className="compo-sup">Support: {selected.support.map((id) => byId.get(id).name).join(', ')}</li>
                    )}
                    {(selected.reg || []).length > 0 && (
                      <li className="compo-sup">Regimental: {[...countBy(selected.reg)].map(([id, n]) => (n > 1 ? `${n} ${byId.get(id).name}` : byId.get(id).name)).join(', ')}</li>
                    )}
                  </ul>
                  <h3>Stats</h3>
                  <dl className="stats">
                    {RESULT_STATS.filter((k) => !((k === 'air' || k === 'trucks' || k === 'recon') && !shown[k])).map((k) => (
                      <div key={k}><dt>{RESULT_LABEL[k]}</dt><dd>{fmt(shown[k], k)}</dd></div>
                    ))}
                  </dl>
                  {designsUsed.length > 0 && (
                    <>
                      <h3>Tank designs used</h3>
                      <p className="note">Picked automatically from the modules you have researched, weighted by your priorities.</p>
                      <dl className="designs">
                        {designsUsed.map((d) => (
                          <React.Fragment key={d.key}>
                            <dt>{d.title}</dt>
                            <dd>{d.parts.map((p) => p.name).join(', ')}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>

          {res?.units && byId && (
            <ManualDesigner units={res.units} columnSize={res.columnSize} mods={result.mods} opts={result.opts} best={res.top?.[0]} />
          )}

          {res?.designs && <DesignSection designs={res.designs} />}

          {res?.top && byId && (
            <section className="block wide-block">
              <h2>Ranked alternatives</h2>
              <p className="note">Different designs, not tweaks of one. Fit is scored against the best result at 100.</p>
              <div className="table-scroll">
                <table className="rank">
                  <thead>
                    <tr>
                      <th scope="col">Rank</th><th scope="col">Battalions</th><th scope="col">Support</th><th scope="col">Regimental</th>
                      <th scope="col">Width</th><th scope="col">Soft atk</th><th scope="col">Hard atk</th><th scope="col">Brk</th>
                      <th scope="col">Def</th><th scope="col">Org</th><th scope="col">Cost</th><th scope="col">Fit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.top.map((t, i) => {
                      const d = describeTemplate(t, byId);
                      const on = selected?.key === t.key;
                      return (
                        <tr key={t.key} className={on ? 'on' : ''}>
                          <td><button type="button" className="rowbtn" aria-pressed={on}
                            onClick={() => setSelected({ items: t.items, support: t.support, reg: t.reg, key: t.key })}>{i + 1}</button></td>
                          <td className="txt">{d.combat}</td>
                          <td className="txt">{d.support || 'none'}</td>
                          <td className="txt">{d.reg || 'none'}</td>
                          <td>{fmt(t.stats.width, 'width')}</td>
                          <td>{fmt(t.stats.sa, 'sa')}</td>
                          <td>{fmt(t.stats.ha, 'ha')}</td>
                          <td>{fmt(t.stats.brk, 'brk')}</td>
                          <td>{fmt(t.stats.def, 'def')}</td>
                          <td>{fmt(t.stats.org, 'org')}</td>
                          <td>{fmt(t.stats.ic, 'ic')}</td>
                          <td>{bestScore > 0 ? Math.round((t.score / bestScore) * 100) : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {res?.pool && (
            <section className="block wide-block">
              <h2>Trade-offs</h2>
              <p className="note">Pick any two stats to see what improving one costs in the other.</p>
              <Pareto pool={res.pool} poolKeys={res.poolKeys} axisX={axisX} axisY={axisY} setAxisX={setAxisX} setAxisY={setAxisY}
                topKeys={topKeys} selectedKey={selected?.key} onPick={pickKey} />
            </section>
          )}

          <DataSection version={version} meta={game.meta} />
        </main>
      </div>
    </div>
  );
}

function DesignSection({ designs }) {
  const tankDesigns = Object.values(designs).filter(Boolean);
  return (
    <section className="block wide-block designs-panel" id="equipment">
      <h2>Optimal equipment designs</h2>
      <p className="note">Tank designs are selected from researched modules, then applied automatically to every matching tank or self-propelled battalion in the divisions above.</p>
      <div className="design-grid">
        {tankDesigns.length > 0 ? tankDesigns.map((d) => (
          <article className="design-card" key={`${d.chassis}|${d.role}`}>
            <div className="rec-kicker">{d.role.replaceAll('_', ' ')}</div>
            <h3>{d.chassis.replaceAll('_', ' ')}</h3>
            <dl className="design-stats">
              {['sa', 'ha', 'brk', 'arm', 'pier', 'spd', 'ic', 'rel'].filter((k) => d.stats && d.stats[k] != null).map((k) => (
                <div key={k}><dt>{k.toUpperCase()}</dt><dd>{fmt(d.stats[k], k === 'spd' ? 'spd' : k)}</dd></div>
              ))}
            </dl>
            <p className="note">{Object.entries(d.modules || {}).filter(([, id]) => id).map(([slot, id]) => `${slot.replaceAll('_', ' ')}: ${id.replaceAll('_', ' ')}`).join(' · ')}</p>
          </article>
        )) : <p className="note">No researched tank chassis are available.</p>}
      </div>
      <article className="air-design-note">
        <strong>Air designs</strong>
        <p>The current game extraction contains no aircraft designer chassis, aircraft modules, or aircraft equipment definitions—only land equipment is available to the optimizer. The section is reserved for air designs and will populate when aircraft designer data is added to the extractor.</p>
      </article>
    </section>
  );
}

function DoctrineRecommendations({ recommendations }) {
  if (!recommendations.length) return <p className="note">Select a role to see doctrine guidance.</p>;
  return (
    <div className="doctrine-recs">
      {recommendations.map((r, i) => (
        <article key={r.doctrine.id} className={'doctrine-rec' + (i === 0 ? ' primary' : '')}>
          <div className="rec-kicker">{i === 0 ? 'Primary recommendation' : 'Alternative'}</div>
          <img className="doctrine-icon" src={`/hoi4/icons/${({ new_mobile_warfare: 'mob_warfare_bg', superior_firepower: 'sup_firepower_bg', grand_battleplan: 'grand_battleplan_bg', mass_assault: 'mass_assault_bg' }[r.doctrine.id] || 'grand_battleplan_bg')}.png`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <strong>{r.doctrine.name}</strong>
          <p>{r.why}</p>
        </article>
      ))}
    </div>
  );
}

function DataSection({ version, meta }) {
  return (
    <section className="block wide-block" id="data">
      <h2>Data and assumptions</h2>
      <p>
        Every unit, equipment, technology, doctrine and tank module comes straight from the game's own files
        ({version ? `version ${version}, ` : ''}extracted {meta.generatedAt.slice(0, 10)}). {meta.assumptions.join('. ')}.
        Run <code>node scripts/extract.mjs</code> against a new install to update it.
      </p>
      <h3>Rules as implemented</h3>
      <ul className="rules">
        <li>A template has up to five columns. Infantry, artillery, mobile, mobile-artillery and armor battalions use separate columns, with five battalions per column or more if a doctrine milestone raises the column size.</li>
        <li>A column needs at least three battalions before it can take a regimental support company. The search spreads battalions over spare columns when that unlocks more regimental slots.</li>
        <li>Special forces units (marines, paratroopers, mountaineers, rangers, amtracs, amphibious tanks) and cavalry are left out unless you switch them on under Allowed units.</li>
        <li>Attack, defense, breakthrough, air attack, hit points, cost, manpower and supply are summed over battalions and support companies.</li>
        <li>Organization and recovery are averaged over battalions and support companies, matching the current HOI4 reference formula. The sidebar switch remains for comparing alternate assumptions.</li>
        <li>Armor, piercing and hardness are averaged over line battalions only. Speed is the slowest line battalion.</li>
        <li>Unit stats are the sum of the equipment each unit needs (best researched variant) times one plus the unit, tech and doctrine bonuses. Organization, hit points, recovery and combat width take flat bonuses.</li>
        <li>Support companies can lift whole categories of battalions (a recon company boosts artillery, for example). Divisional support allows one company per type, up to five.</li>
        <li>Tank battalions and self-propelled support use a design built from the tank modules you have researched, at the highest No Step Back engine and armor upgrade levels your research allows.</li>
        <li>Not verified against the game: one regimental support company per column, which column types each regimental company can attach to, and whether doctrine supply bonuses are fractions of a unit's supply.</li>
        <li>Space marines are modelled as mostly infantry with one or two armoured battalions to raise armor and resist ordinary piercing; they remain especially matchup- and multiplayer-dependent.</li>
        <li>Not modelled: national focus techs, leaders, terrain, equipment stockpiles, the land cruiser, flame tanks, amphibious tank roles, and hand-editing a tank design.</li>
      </ul>
    </section>
  );
}
