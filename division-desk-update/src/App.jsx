import React, { useEffect, useMemo, useRef, useState } from 'react';
import TemplateGrid from './components/TemplateGrid.jsx';
import Pareto from './components/Pareto.jsx';
import TechPicker from './components/TechPicker.jsx';
import DoctrinePicker from './components/DoctrinePicker.jsx';
import raw from './data/game.json';
import { buildGame, EMPTY_DOCTRINE } from './lib/game.js';
import { STATS, MOD_KEYS, DEFAULT_OPTS, evaluate, fmt } from './lib/stats.js';
import { parseKey, DEFAULT_CONSTRAINTS } from './lib/optimizer.js';
import { ROLES, ZERO_WEIGHTS, defaultTech } from './lib/presets.js';
import { describeTemplate, countBy, encodeState, decodeState } from './lib/format.js';
import { describeDesign } from './lib/describe.js';

const game = buildGame(raw);

const ROLE_AXES = {
  line: ['sa', 'def'], wall: ['def', 'ic'], spear: ['brk', 'org'], grinder: ['sa', 'ic'],
  armor: ['brk', 'arm'], hunter: ['ha', 'pier'], mass: ['def', 'ic'], custom: ['sa', 'def'],
};

const COST_LABEL = { ic: 'Cheaper to build', mp: 'Uses less manpower', sup: 'Uses less supply', trucks: 'Needs fewer trucks' };
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
      w.postMessage({ id, params: { techs: [...techs], doctrine, weights, constraints, mods, opts, topN: 10 } });
    }, 400);
    return () => clearTimeout(timer);
  }, [weights, constraints, techs, doctrine, mods, opts]); // roleId only labels the result

  useEffect(() => () => workerRef.current && workerRef.current.terminate(), []);

  // ---- keep the URL in sync so a setup can be shared ----
  useEffect(() => {
    const s = encodeState({ r: roleId, w: weights, c: constraints, t: [...techs], d: doctrine, m: mods, o: opts, ax: [axisX, axisY] }, game);
    if (s) window.history.replaceState(null, '', '#s=' + s);
  }, [roleId, weights, constraints, techs, doctrine, mods, opts, axisX, axisY]);

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
  const version = game.meta.gameVersion;

  return (
    <div className="app">
      <header className="masthead">
        <h1>Division Desk</h1>
        <p>Say what the division is for. Division Desk searches thousands of templates, shows the best ones, and shows what each gives up.</p>
      </header>

      <div className="layout">
        <aside className="rail" aria-label="Division goals">
          <section className="block">
            <h2>Role</h2>
            <div className="roles" role="radiogroup" aria-label="Role presets">
              {ROLES.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={roleId === r.id}
                  className={'role' + (roleId === r.id ? ' on' : '')} onClick={() => applyRole(r)}>
                  <strong>{r.name}</strong>
                  <span>{r.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="block">
            <h2>Priorities</h2>
            <p className="note">Slide right for stats you want more of. Every stat is compared by percentage change, so weights are directly comparable. Zero ignores a stat.</p>
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
          </section>

          <section className="block">
            <h2>Limits</h2>
            <div className="fields">
              <label>Combat width, from
                <input type="number" min="1" max="60" value={constraints.wmin}
                  onChange={(e) => setCons('wmin', Math.max(1, Number(e.target.value) || 1))} /></label>
              <label>to
                <input type="number" min="1" max="60" value={constraints.wmax}
                  onChange={(e) => setCons('wmax', Math.max(1, Number(e.target.value) || 1))} /></label>
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

          <section className="block">
            <h2>Technology</h2>
            <TechPicker game={game} techs={techs} setTechs={setTechs} />
          </section>

          <section className="block">
            <h2>Doctrine</h2>
            <DoctrinePicker game={game} doctrine={doctrine} setDoctrine={setDoctrine} />
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
            <strong>Numbers come from the game files</strong> (version {version}), with every DLC and no mods. A few rules are still assumptions, including how regimental support attaches to columns and how tank modules are chosen. Check a result in game before you trust it. See <a href="#data">data and assumptions</a>.
          </div>

          <section className="result" aria-live="polite">
            <div className="result-head">
              <h2>{role ? role.name : 'Custom priorities'}</h2>
              <div className="status">
                {running && <span className="busy">Searching</span>}
                {!running && res?.explored && <span>{res.explored.toLocaleString('en-GB')} valid templates tried in {(res.ms / 1000).toFixed(1)} s</span>}
                <button type="button" className="ghost" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this setup'}</button>
              </div>
            </div>

            {res?.error && <p className="error" role="alert">{res.error}</p>}

            {shown && byId && (
              <div className="result-body">
                <TemplateGrid items={selected.items} support={[...selected.support, ...(selected.reg || [])]} byId={byId} />
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

function DataSection({ version, meta }) {
  return (
    <section className="block wide-block" id="data">
      <h2>Data and assumptions</h2>
      <p>
        Every unit, equipment, technology, doctrine and tank module comes straight from the game's own files
        (version {version}, extracted {meta.generatedAt.slice(0, 10)}). {meta.assumptions.join('. ')}.
        Run <code>node scripts/extract.mjs</code> against a new install to update it.
      </p>
      <h3>Rules as implemented</h3>
      <ul className="rules">
        <li>A template has up to five columns. A column holds one type (infantry, mobile or armor) and five battalions, or more if a doctrine milestone raises the column size. Artillery, anti-tank and anti-air brigades sit in the column that matches their chassis.</li>
        <li>Attack, defense, breakthrough, air attack, hit points, cost, manpower and supply are summed over battalions and support companies.</li>
        <li>Organization and recovery are averaged over battalions. Whether support companies join that average is unverified, so it is a switch in the sidebar.</li>
        <li>Armor, piercing and hardness are averaged over line battalions only. Speed is the slowest line battalion.</li>
        <li>Unit stats are the sum of the equipment each unit needs (best researched variant) times one plus the unit, tech and doctrine bonuses. Organization, hit points, recovery and combat width take flat bonuses.</li>
        <li>Support companies can lift whole categories of battalions (a recon company boosts artillery, for example). Divisional support allows one company per type, up to five.</li>
        <li>Tank battalions and self-propelled support use a design built from the tank modules you have researched, at the highest No Step Back engine and armor upgrade levels your research allows.</li>
        <li>Not verified against the game: one regimental support company per column, which column types each regimental company can attach to, and whether doctrine supply bonuses are fractions of a unit's supply.</li>
        <li>Not modelled: national focus techs, leaders, terrain, equipment stockpiles, the land cruiser, flame tanks, amphibious tank roles, and hand-editing a tank design.</li>
      </ul>
    </section>
  );
}
