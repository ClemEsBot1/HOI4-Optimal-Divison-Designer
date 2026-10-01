import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import raw from './data/game.json';
import { buildGame, EMPTY_DOCTRINE } from './lib/game.js';
import { DEFAULT_OPTS, AXIS_STATS, evaluate } from './lib/stats.js';
import { parseKey, DEFAULT_CONSTRAINTS } from './lib/optimizer.js';
import { explain } from './lib/score.js';
import { ROLES, ZERO_WEIGHTS, defaultTech, defaultExclude, roleExclude, doctrineRecommendations, TECH_PRESETS, techPreset, sameSet } from './lib/presets.js';
import { encodeState, decodeState } from './lib/format.js';
import { THEATRES, TERRAINS, frontageFit, fitTable, fittingWidths } from './lib/frontage.js';
import { readStore, writeStore } from './lib/storage.js';
import Menu from './components/Menu.jsx';
import DesignerView, { templateText } from './views/DesignerView.jsx';
import ResearchView from './views/ResearchView.jsx';
import DoctrineView from './views/DoctrineView.jsx';
import EquipmentView from './views/EquipmentView.jsx';
import NavyView from './views/NavyView.jsx';
import FieldManualView from './views/FieldManualView.jsx';

const game = buildGame(raw);

const VIEWS = [
  { id: 'designer', label: 'Designer', icon: '/hoi4/icons/category_all_infantry.png' },
  { id: 'research', label: 'Research', icon: '/hoi4/icons/category_artillery.png' },
  { id: 'doctrine', label: 'Doctrine', icon: '/hoi4/icons/category_all_armor.png' },
  { id: 'equipment', label: 'Equipment', icon: '/hoi4/technologies/basic_medium_tank_chassis.png' },
  { id: 'navy', label: 'Navy', icon: '/icons/navy.svg' },
  { id: 'manual', label: 'Field manual', icon: '/hoi4/technologies/tech_support.png' },
];
const MODES = [
  { id: 'search', label: 'Optimal search', blurb: 'Find and prove the best template for the role and limits.' },
  { id: 'manual', label: 'Manual design', blurb: 'Draft a template by hand and measure it against the best.' },
  { id: 'compare', label: 'Compare', blurb: 'Line up alternatives and saved designs side by side.' },
];
const ROLE_AXES = { line: ['def', 'org'], offensive_infantry: ['sa', 'org'], armor: ['sa', 'brk'], hunter: ['ha', 'pier'], space_marines: ['arm', 'sa'], mountaineers: ['def', 'sa'], marines: ['def', 'org'], custom: ['sa', 'def'] };
const DEFAULT_ENEMY = { id: 'none', focus: 'both', weight: 8 };
const DEFAULT_SCALE = { divisions: 24, factories: 60, efficiency: 70 };
const DEFAULT_THEATRE = { id: 'any', fitOnly: false, minFit: 0.9 };
const FADE_MS = 280;

/** The opponent setting turns into the two matchup priorities. */
function withMatchup(weights, enemy) {
  const on = enemy && enemy.id && enemy.id !== 'none';
  const w = on ? Number(enemy.weight) || 8 : 0;
  return { ...weights, mAtk: on && enemy.focus !== 'defend' ? w : 0, mDef: on && enemy.focus !== 'attack' ? w : 0 };
}

function loadInitial() {
  const base = {
    roleId: ROLES[0].id, weights: { ...ZERO_WEIGHTS, ...ROLES[0].weights }, constraints: { ...DEFAULT_CONSTRAINTS, ...ROLES[0].constraints },
    techs: defaultTech(game), doctrine: { ...EMPTY_DOCTRINE, slotCount: 1 }, exclude: defaultExclude(game), mods: {}, opts: { ...DEFAULT_OPTS },
    axes: ROLE_AXES[ROLES[0].id], enemy: { ...DEFAULT_ENEMY }, scale: { ...DEFAULT_SCALE }, theatre: { ...DEFAULT_THEATRE },
    view: 'designer', mode: 'search', equipTab: 'tanks',
  };
  try {
    const m = /#s=(.+)$/.exec(window.location.hash);
    const s = m && decodeState(m[1], game);
    if (s && s.w && s.c) {
      const ax = Array.isArray(s.ax) && s.ax.length === 2 && s.ax.every((k) => AXIS_STATS.includes(k)) ? s.ax : base.axes;
      return {
        ...base,
        roleId: s.r || 'custom', weights: { ...ZERO_WEIGHTS, ...s.w }, constraints: { ...DEFAULT_CONSTRAINTS, ...s.c },
        techs: s.t || base.techs, doctrine: { ...base.doctrine, ...(s.d || {}) }, exclude: Array.isArray(s.x) ? s.x : base.exclude,
        mods: s.m || {}, opts: { ...DEFAULT_OPTS, ...(s.o || {}) }, axes: ax,
        enemy: { ...DEFAULT_ENEMY, ...(s.e && typeof s.e === 'object' ? s.e : {}) },
        scale: { ...DEFAULT_SCALE, ...(s.k && typeof s.k === 'object' ? s.k : {}) },
        theatre: { ...DEFAULT_THEATRE, ...(s.th && typeof s.th === 'object' ? s.th : {}) },
        view: VIEWS.some((v) => v.id === s.v) ? s.v : base.view,
        mode: MODES.some((x) => x.id === s.md) ? s.md : base.mode,
        equipTab: ['tanks', 'air', 'navy'].includes(s.eq) ? s.eq : base.equipTab,
      };
    }
  } catch { /* ignore malformed links */ }
  return base;
}

/** Research year shown in the command bar: the matching preset, or the latest start year among researched techs. */
function researchYear(techs) {
  const preset = TECH_PRESETS.find((p) => sameSet(techs, techPreset(game, p.year)));
  if (preset) return { year: Math.min(1945, preset.year), label: preset.label, preset };
  let y = 1936;
  for (const id of techs) { const t = game.techs.get(id); if (t && !t.special && t.year && t.year > y) y = t.year; }
  return { year: Math.min(1945, y), label: `Custom (${Math.min(1945, y)})`, preset: null };
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
  const [enemy, setEnemy] = useState(initial.enemy);
  const [scale, setScale] = useState(initial.scale);
  const [theatreState, setTheatreState] = useState(initial.theatre);
  const [mode, setMode] = useState(initial.mode);
  const [equipTab, setEquipTab] = useState(initial.equipTab);

  const [result, setResult] = useState(null); // { res, mods, opts, roleId }
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(null);
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(null);
  const [manual, setManual] = useState({ items: [], support: [], reg: [] });
  const [saved, setSaved] = useState(() => readStore('dd.saved', []));

  // ---- views with a fade between them ----
  const [view, setView] = useState(initial.view);
  const [shownView, setShownView] = useState(initial.view);
  const [phase, setPhase] = useState('in');
  const fadeTimer = useRef(null);
  const go = useCallback((v, tab) => {
    if (tab) setEquipTab(tab);
    if (v === view) return;
    setView(v);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShownView(v); window.scrollTo({ top: 0 }); return; }
    setPhase('out');
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setShownView(v);
      window.scrollTo({ top: 0 });
      setPhase('in');
    }, FADE_MS);
  }, [view]);
  const switchMode = (m) => { setMode(m); go('designer'); };

  // ---- theatre ----
  const theatre = THEATRES.find((t) => t.id === theatreState.id) || THEATRES[0];
  const fitOf = useCallback((w) => frontageFit(w, theatre), [theatre]);
  const fitWidths = useMemo(() => (theatre.mix && theatreState.fitOnly ? fittingWidths(theatre, constraints.wmin, constraints.wmax, theatreState.minFit) : null), [theatre, theatreState, constraints.wmin, constraints.wmax]);

  // ---- search worker: long-lived, replaced only when a search must be cancelled ----
  const workerRef = useRef(null);
  const busyRef = useRef(false);
  const runId = useRef(0);
  const newWorker = () => new Worker(new URL('./lib/worker.js', import.meta.url), { type: 'module' });
  useEffect(() => {
    const total = Object.values(weights).reduce((a, b) => a + Math.abs(b), 0);
    if (!total) {
      setResult({ res: { error: 'Set at least one priority above zero.' }, mods, opts, roleId });
      setRunning(false);
      return undefined;
    }
    setRunning(true);
    setTick(null);
    const id = ++runId.current;
    const timer = setTimeout(() => {
      if (workerRef.current && busyRef.current) { workerRef.current.terminate(); workerRef.current = null; }
      if (!workerRef.current) workerRef.current = newWorker();
      const w = workerRef.current;
      busyRef.current = true;
      w.onmessage = (e) => {
        if (e.data.id !== id) return;
        if (e.data.tick) { setTick(e.data.tick); return; }
        const r = e.data.res;
        setResult({ res: r, mods, opts, roleId });
        if (r.top) setSelected({ items: r.top[0].items, support: r.top[0].support, reg: r.top[0].reg, key: r.top[0].key });
        else setSelected(null);
        if (!e.data.partial) { setRunning(false); busyRef.current = false; setTick(null); }
      };
      w.onerror = () => {
        if (runId.current !== id) return;
        busyRef.current = false;
        setResult({ res: { error: 'The search worker failed to start.' }, mods, opts, roleId });
        setRunning(false);
      };
      const enemyParam = enemy.id && enemy.id !== 'none' ? enemy : null;
      const cons = { ...constraints, frontMix: theatre.mix, ...(fitWidths && fitWidths.length ? { widths: fitWidths } : {}) };
      w.postMessage({ id, type: 'search', params: { techs: [...techs], doctrine, exclude, weights: withMatchup(weights, enemy), constraints: cons, mods, opts, enemy: enemyParam, topN: 10 } });
    }, 400);
    return () => clearTimeout(timer);
  }, [weights, constraints, techs, doctrine, exclude, mods, opts, enemy, fitWidths, theatre]); // roleId only labels the result
  useEffect(() => () => workerRef.current && workerRef.current.terminate(), []);

  // ---- equipment worker: separate, so equipment pages never wait for a long search ----
  const equipRef = useRef(null);
  const equipSeq = useRef(0);
  const equipWaiters = useRef(new Map());
  const askEquip = useCallback((msg) => new Promise((resolve) => {
    if (!equipRef.current) {
      equipRef.current = newWorker();
      equipRef.current.onmessage = (e) => { const f = equipWaiters.current.get(e.data.id); if (f) { equipWaiters.current.delete(e.data.id); f(e.data.res); } };
    }
    const id = `eq${++equipSeq.current}`;
    equipWaiters.current.set(id, resolve);
    equipRef.current.postMessage({ id, ...msg });
  }), []);
  useEffect(() => () => equipRef.current && equipRef.current.terminate(), []);
  const tankCache = useRef(new Map());
  const techsKey = useMemo(() => [...techs].sort().join(','), [techs]);
  const requestTanks = useCallback(() => {
    if (!tankCache.current.has(techsKey)) tankCache.current.set(techsKey, askEquip({ type: 'tanks', techs: [...techs] }));
    return tankCache.current.get(techsKey);
  }, [techsKey, techs, askEquip]);
  const requestShip = useCallback((role, year, weights, keep, minStats) => askEquip({ type: 'ship', role, year, weights, keep, minStats }), [askEquip]);
  const requestPlane = useCallback((role, year, weights, keep) => askEquip({ type: 'plane', role, year, weights, keep }), [askEquip]);
  const requestTankRole = useCallback((role, objective) => askEquip({ type: 'tankRole', techs: [...techs], role, objective }), [askEquip, techs]);

  // ---- share link ----
  useEffect(() => {
    const s = encodeState({ r: roleId, w: weights, c: constraints, t: [...techs], d: doctrine, x: exclude, m: mods, o: opts, ax: [axisX, axisY], e: enemy, k: scale, th: theatreState, v: view, md: mode, eq: equipTab }, game);
    if (s) window.history.replaceState(null, '', '#s=' + s);
  }, [roleId, weights, constraints, techs, doctrine, exclude, mods, opts, axisX, axisY, enemy, scale, theatreState, view, mode, equipTab]);

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
  const why = useMemo(() => {
    if (!shown || !res?.top || !res.terms) return null;
    const isWinner = selected?.key === res.top[0].key;
    const ref = isWinner ? res.top[1]?.stats : res.top[0].stats;
    return { rows: explain(shown, ref || null, res.terms, res.enemy), isWinner, hasRef: !!ref };
  }, [shown, res, selected]);
  const designsUsed = useMemo(() => {
    if (!selected || !byId || !res?.designs) return [];
    const seen = new Map();
    for (const id of [...selected.items, ...selected.support, ...(selected.reg || [])]) {
      const u = byId.get(id);
      if (u && u.design) {
        const key = `${u.design.chassis}|${u.design.role}`;
        const d = res.designs[key];
        if (d) seen.set(key, { ...d, title: `${game.raw.designers[d.chassis]?.name || d.chassis}${d.role === 'armor' ? '' : ` (${d.role.replace('_', '-')})`}` });
      }
    }
    return [...seen.values()];
  }, [selected, byId, res]);
  const ry = useMemo(() => researchYear(techs), [techs]);

  // ---- handlers ----
  const applyRole = (r) => {
    setRoleId(r.id);
    setWeights({ ...ZERO_WEIGHTS, ...r.weights });
    setConstraints({ ...DEFAULT_CONSTRAINTS, ...r.constraints });
    setExclude(roleExclude(game, r));
    const ax = ROLE_AXES[r.id];
    setAxisX(ax[0]); setAxisY(ax[1]);
  };
  const setWeight = (k, v) => { setRoleId('custom'); setWeights((w) => ({ ...w, [k]: v })); };
  const setCons = (k, v) => { setRoleId('custom'); setConstraints((c) => ({ ...c, [k]: v })); };
  const pickKey = (key) => { const { items, support, reg } = parseKey(key); setSelected({ items, support, reg, key }); };
  const flash = (what) => { setCopied(what); setTimeout(() => setCopied(null), 1800); };
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); flash('link'); } catch { /* clipboard unavailable */ } };
  const copyText = async (tpl, st) => { try { await navigator.clipboard.writeText(templateText(tpl, st, byId)); flash('text'); } catch { /* clipboard unavailable */ } };
  const saveTemplate = (tpl, st) => {
    if (!tpl || !st) return;
    const name = `${role ? role.name : 'Custom'} · ${Math.round(st.width)}w · ${ry.label}`;
    const entry = { id: Date.now().toString(36), name, items: tpl.items.slice(), support: tpl.support.slice(), reg: (tpl.reg || []).slice(), savedAt: new Date().toISOString() };
    setSaved((cur) => { const next = [entry, ...cur].slice(0, 40); writeStore('dd.saved', next); return next; });
    flash('saved');
  };
  const removeSaved = (id) => setSaved((cur) => { const next = cur.filter((s) => s.id !== id); writeStore('dd.saved', next); return next; });

  const version = /^unknown/.test(game.meta.gameVersion) ? null : game.meta.gameVersion;
  const ctx = {
    game, mode, setMode: switchMode, roleId, applyRole, weights, setWeight, constraints, setCons, enemy, setEnemy, exclude, setExclude,
    mods, setMods, opts, setOpts, scale, setScale, res, result, running, tick, selected, setSelected, byId, shown, why, topKeys,
    axisX, setAxisX, axisY, setAxisY, copyLink, copyText, copied, saveTemplate, saved, removeSaved, manual, setManual, role,
    theatre, theatreState, fitOf, fitWidths, go, designsUsed, pickKey,
  };

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#designer" onClick={(e) => { e.preventDefault(); go('designer'); }} aria-label="Division Desk">
          <span className="brand-mark"><img src="/hoi4/icons/category_all_infantry.png" alt="" /></span>
          <span className="brand-text"><small>HOI4 // General staff</small><strong>Division Desk</strong></span>
        </a>
        <nav className="nav" aria-label="Sections">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={'nav-item' + (view === v.id ? ' on' : '')} aria-current={view === v.id ? 'page' : undefined} onClick={() => go(v.id)}>
              <img src={v.icon} alt="" /><span>{v.label}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-status">
          <span className={'signal' + (running ? ' busy' : '')}><i />{running ? 'Computing' : 'Ready'}</span>
          <span className="patch">{version ? `Patch ${version}` : `Game files · ${game.meta.generatedAt.slice(0, 10)}`}</span>
        </div>
      </header>

      <div className="commandbar" role="toolbar" aria-label="Setup">
        <Menu label="Theatre" value={theatre.name} wide>
          {(close) => <TheatreMenu theatre={theatre} state={theatreState} setState={setTheatreState} wmin={constraints.wmin} wmax={constraints.wmax} fitWidths={fitWidths} close={close} />}
        </Menu>
        <Menu label="Year" value={ry.label}>
          {(close) => (
            <div className="menu-list">
              <p className="menu-title">Research level</p>
              {TECH_PRESETS.map((p) => (
                <button key={p.year} type="button" className={'menu-item' + (ry.preset?.year === p.year ? ' on' : '')} onClick={() => { setTechs(techPreset(game, p.year)); close(); }}>
                  <b>{p.label}</b><small>{p.year >= 9999 ? 'Everything, including special projects' : `Every technology that starts by ${p.year}`}</small>
                </button>
              ))}
              <button type="button" className="menu-item" onClick={() => { close(); go('research'); }}><b>Pick technologies…</b><small>Open the research tree</small></button>
            </div>
          )}
        </Menu>
        <Menu label="Mode" value={MODES.find((m) => m.id === mode)?.label}>
          {(close) => (
            <div className="menu-list">
              <p className="menu-title">Designer mode</p>
              {MODES.map((m) => (
                <button key={m.id} type="button" className={'menu-item' + (mode === m.id ? ' on' : '')} onClick={() => { switchMode(m.id); close(); }}>
                  <b>{m.label}</b><small>{m.blurb}</small>
                </button>
              ))}
            </div>
          )}
        </Menu>
        <span className="commandbar-note">{role ? role.name : 'Custom priorities'}{saved.length ? ` · ${saved.length} saved` : ''}{copied === 'saved' ? ' · Saved' : ''}</span>
      </div>

      <main className={'stage ' + phase} aria-live="polite">
        {shownView === 'designer' && <DesignerView {...ctx} />}
        {shownView === 'research' && <ResearchView game={game} techs={techs} setTechs={setTechs} />}
        {shownView === 'doctrine' && <DoctrineView game={game} doctrine={doctrine} setDoctrine={setDoctrine} recommendations={doctrineRecommendations(game, result?.roleId)} roleName={role?.name} />}
        {shownView === 'equipment' && <EquipmentView game={game} tab={equipTab} setTab={setEquipTab} year={ry.year} techsKey={techsKey} designsUsed={designsUsed} requestTanks={requestTanks} requestShip={requestShip} requestPlane={requestPlane} requestTankRole={requestTankRole} />}
        {shownView === 'navy' && <NavyView year={ry.year} requestShip={requestShip} />}
        {shownView === 'manual' && <FieldManualView version={version} meta={game.meta} />}
      </main>
      <div className={'veil ' + phase} aria-hidden="true"><span>{VIEWS.find((v) => v.id === view)?.label}</span></div>

      <footer className="footer">
        <span>Hearts of Iron IV is a trademark of Paradox Interactive. Unofficial fan tool.</span>
        <span>All DLC · no mods · data from the game files</span>
      </footer>
    </div>
  );
}

function TheatreMenu({ theatre, state, setState, wmin, wmax, fitWidths, close }) {
  const table = theatre.mix ? fitTable(theatre, 8, 45) : null;
  return (
    <div className="theatre-menu">
      <div className="menu-list">
        <p className="menu-title">Theatre of operations</p>
        {THEATRES.map((t) => (
          <button key={t.id} type="button" className={'menu-item' + (t.id === theatre.id ? ' on' : '')} onClick={() => setState((s) => ({ ...s, id: t.id }))}>
            <b>{t.name}</b><small>{t.blurb}</small>
          </button>
        ))}
      </div>
      <div className="theatre-side">
        {table ? (
          <>
            <p className="menu-title">Frontage fit by division width</p>
            <div className="fit-chart" role="img" aria-label={`Frontage fit for widths 8 to 45 in ${theatre.name}`}>
              {table.map((x) => (
                <span key={x.width} className={'fit-bar' + (x.width >= wmin && x.width <= wmax ? ' in' : '') + (x.fit >= state.minFit ? ' good' : '')} style={{ height: `${Math.max(4, x.fit * 100)}%` }} title={`${x.width} width: ${Math.round(x.fit * 100)}%`} />
              ))}
            </div>
            <div className="fit-axis"><span>8</span><span>20</span><span>30</span><span>45</span></div>
            <p className="note">Mix: {Object.entries(theatre.mix).map(([k, v]) => `${TERRAINS.find((t) => t.id === k)?.name} ${v}%`).join(', ')}.</p>
            <label className="check">
              <input type="checkbox" checked={state.fitOnly} onChange={(e) => setState((s) => ({ ...s, fitOnly: e.target.checked }))} />
              Only search widths that fill at least
              <select value={state.minFit} onChange={(e) => setState((s) => ({ ...s, minFit: Number(e.target.value) }))}>
                {[0.8, 0.85, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
              </select>
              of the frontage
            </label>
            {state.fitOnly && <p className="note">{fitWidths && fitWidths.length ? `Allowed in your ${wmin}–${wmax} range: ${fitWidths.join(', ')}.` : 'No width in your range fits that well; width is not restricted.'}</p>}
          </>
        ) : <p className="note">Pick a theatre to see which division widths fill its frontage, and optionally restrict the search to them.</p>}
        <button type="button" className="small" onClick={close}>Done</button>
      </div>
    </div>
  );
}
