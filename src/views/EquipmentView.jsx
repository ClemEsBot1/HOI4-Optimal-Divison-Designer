import React, { useEffect, useMemo, useRef, useState } from 'react';
import Section, { setAllCollapsed } from '../components/Section.jsx';
import TankCard from '../components/TankCard.jsx';
import Pareto from '../components/Pareto.jsx';
import { TANK_ROLES } from '../lib/tankRoles.js';
import { SHIP_ROLES, SHIP_STATS, isLowerBetter as shipLower } from '../lib/naval.js';
import { PLANE_ROLES, PLANE_STATS, isLowerBetter as planeLower, hasPlaneData, EXCESS_THRUST_SPEED } from '../lib/air.js';
import { AIR_ROLES, AIR_ERAS, eraFor } from '../data/air.js';
import naval from '../data/designers.json';
import { fmt } from '../lib/stats.js';

const TABS = [
  { id: 'tanks', label: 'Tanks', kicker: 'Armor branch' },
  { id: 'air', label: 'Aircraft', kicker: 'Air branch' },
  { id: 'navy', label: 'Ships', kicker: 'Naval branch' },
];

// how many designs each search returns: the recommendation, the ranked alternatives and the chart's points
const KEEP = 30;
const SHOWN = 10;

/** Tanks, aircraft and ships: pick a type, then the same workbench as the division designer. */
export default function EquipmentView({ game, tab, setTab, year, techsKey, designsUsed, requestShip, requestPlane, requestTankRole }) {
  const [picked, setPicked] = useState({ tanks: designsUsed.length ? 'used' : 'mbt', air: 'fighter', navy: 'cl_light_attack' });
  const pick = (id) => setPicked((p) => ({ ...p, [tab]: id }));
  const planesReady = hasPlaneData(naval);
  return (
    <div className="view-equipment">
      <div className="view-head">
        <div>
          <p className="kicker">Ordnance bureau</p>
          <h1>Equipment</h1>
          <p className="lede">Pick a type, and the best design for it at your research level is searched exactly over every module combination, with the alternatives, the trade-offs and your own priorities.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Equipment branch">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              <small>{t.kicker}</small>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tab-stage" key={tab}>
        {tab === 'tanks' && (
          <>
            <TypePicker roles={[...(designsUsed.length ? [{ id: 'used', group: 'Your division', name: 'In your template' }] : []), ...TANK_ROLES.map((r) => ({ ...r, group: 'Tank roles' }))]}
              value={picked.tanks} onPick={pick} />
            {picked.tanks === 'used'
              ? <UsedTanks game={game} designsUsed={designsUsed} />
              : <Workbench key={`tank-${picked.tanks}`} kind={TANK} role={TANK_ROLES.find((r) => r.id === picked.tanks) || TANK_ROLES[0]} game={game}
                  ask={(role, weights) => requestTankRole(role.id, weights)} depKey={techsKey} />}
          </>
        )}
        {tab === 'air' && (planesReady ? (
          <>
            <TypePicker roles={PLANE_ROLES} value={picked.air} onPick={pick} />
            <DataNote kind="air" />
            <Workbench key={`air-${picked.air}`} kind={PLANE} role={PLANE_ROLES.find((r) => r.id === picked.air) || PLANE_ROLES[0]}
              ask={(role, weights) => requestPlane(role.id, clampYear(year, 1933, 1950), weights, KEEP)} depKey={clampYear(year, 1933, 1950)} />
          </>
        ) : (
          <>
            <TypePicker roles={AIR_ROLES} value={AIR_ROLES.some((r) => r.id === picked.air) ? picked.air : AIR_ROLES[0].id} onPick={pick} />
            <AirGuide year={year} role={AIR_ROLES.find((r) => r.id === picked.air) || AIR_ROLES[0]} />
          </>
        ))}
        {tab === 'navy' && (
          <>
            <TypePicker roles={SHIP_ROLES} value={picked.navy} onPick={pick} />
            <DataNote kind="navy" />
            <Workbench key={`navy-${picked.navy}`} kind={SHIP} role={SHIP_ROLES.find((r) => r.id === picked.navy) || SHIP_ROLES[0]}
              ask={(role, weights) => requestShip(role.id, clampYear(year, 1936, 1945), weights, KEEP)} depKey={clampYear(year, 1936, 1945)} />
          </>
        )}
      </div>
    </div>
  );
}

const clampYear = (y, lo, hi) => Math.max(lo, Math.min(hi, y));

/** One button per type, grouped like the game's own production categories. */
function TypePicker({ roles, value, onPick }) {
  const groups = [...new Set(roles.map((r) => r.group))];
  return (
    <nav className="type-picker" aria-label="Type">
      {groups.map((g) => (
        <div key={g} className="type-group">
          <span className="type-group-name">{g}</span>
          <div className="seg">
            {roles.filter((r) => r.group === g).map((r) => (
              <button key={r.id} type="button" className={value === r.id ? 'on' : ''} aria-pressed={value === r.id} onClick={() => onPick(r.id)}>{r.name}</button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function DataNote({ kind }) {
  return (
    <p className="note data-note">
      {kind === 'air'
        ? <>Airframes, modules and air technology from {naval.meta.source} (game version {naval.meta.gameVersion}). A design is legal only when the engines&apos; thrust covers the weight; thrust left over adds {EXCESS_THRUST_SPEED} km/h of speed per point. Change the year from the command bar.</>
        : <>Hulls, modules and naval technology from {naval.meta.source} (game version {naval.meta.gameVersion}). Change the year from the command bar.</>}
    </p>
  );
}

function levelsFor(kind, role) {
  return Object.fromEntries(kind.stats.map(([k]) => [k, kind.levelOf(role, k)]).filter(([, v]) => v));
}

/**
 * The designer's layout for one type: the recommended design, priorities, ranked alternatives and the trade-off chart.
 * Moving a priority searches again (the role's own priorities are cached by the worker).
 */
function Workbench({ kind, role, game, ask, depKey }) {
  const [levels, setLevels] = useState(() => levelsFor(kind, role));
  const [res, setRes] = useState(undefined);
  const [sel, setSel] = useState(0);
  const custom = useMemo(() => JSON.stringify(levels) !== JSON.stringify(levelsFor(kind, role)), [levels, kind, role]);
  const weights = useMemo(() => (custom ? kind.toSearch(levels, kind.lower) : null), [custom, levels, kind]);
  const wKey = weights ? JSON.stringify(weights) : '';
  const timer = useRef(null);
  useEffect(() => {
    let live = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setRes(undefined);
      ask(role, weights).then((r) => { if (live) { setRes(r); setSel(0); } });
    }, weights ? 350 : 0);
    return () => { live = false; clearTimeout(timer.current); };
  }, [role.id, wKey, depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = kind.ranked(res);
  const shown = ranked[sel] || ranked[0];
  const scored = Object.keys(levels).filter((k) => levels[k]);
  const cols = kind.stats.filter(([k]) => scored.includes(k) || kind.lower(k));
  const ids = [`eq-${kind.id}-result`, `eq-${kind.id}-prio`, `eq-${kind.id}-ranked`, `eq-${kind.id}-chart`];

  // chart: every kept design, with the Pareto front over the stats the priorities score
  const axes = kind.stats.map(([k]) => k);
  const labels = Object.fromEntries(kind.stats);
  const dirs = Object.fromEntries(axes.map((k) => [k, kind.lower(k) ? -1 : 1]));
  const pool = ranked.map((d) => d.stats);
  const front = useMemo(() => pool.map((p, i) => !pool.some((q, j) => j !== i
    && scored.every((k) => (q[k] || 0) * dirs[k] >= (p[k] || 0) * dirs[k] - 1e-9)
    && scored.some((k) => (q[k] || 0) * dirs[k] > (p[k] || 0) * dirs[k] + 1e-9))), [res, wKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstAxis = cols.find(([k]) => !kind.lower(k))?.[0] || axes[0];
  const [axisX, setAxisX] = useState(cols.find(([k]) => kind.lower(k))?.[0] || axes[axes.length - 1]);
  const [axisY, setAxisY] = useState(firstAxis);

  return (
    <>
      <div className="row-between">
        <p className="lede small">{role.blurb}</p>
        <FoldAll ids={ids} />
      </div>
      <Section id={ids[0]} kicker={`${role.group || 'Role'} // ${role.name}`} title={sel ? `Alternative #${sel + 1}` : custom ? 'Best design for your priorities' : 'Recommended design'}>
        {res === undefined && <p className="busy">Designing</p>}
        {res === null || (res && !ranked.length) ? <p className="note">No {kind.frame} for this type is available at your research level, or none can carry what it needs.</p> : null}
        {shown && (
          <>
            <div className="kpis">
              {cols.slice(0, 6).map(([k, label]) => <div key={k}><span>{label}</span><b>{kind.fmt(k, shown.stats[k])}</b></div>)}
            </div>
            {kind.id === 'tank'
              ? <div className="card-grid"><TankCard game={game} d={shown} title={sel ? `Alternative #${sel + 1}` : 'Recommended'} /></div>
              : <div className="card-grid"><DesignCard kind={kind} d={shown} /></div>}
            {res?.truncated && <p className="note">The search stopped at its budget; this is the best design it reached.</p>}
          </>
        )}
      </Section>

      <Section id={ids[1]} kicker="Custom orders" title="Priorities" defaultOpen={false}
        actions={custom && <button type="button" className="ghost small" onClick={() => setLevels(levelsFor(kind, role))}>Reset to role</button>}>
        <p className="note">The type sets these. Change any to make your own; 0 ignores a stat, 10 matters most. {kind.id === 'tank' ? 'Production cost counts against the design.' : 'Costs and visibility count against the design.'} The {kind.frame} and what the design must carry stay those of the type.</p>
        <div className="goal-sliders">
          {kind.stats.map(([k, label]) => (
            <label className="slider" key={k}>
              <span className="slider-name">{kind.lower(k) ? `Keep ${label.toLowerCase()} low` : label}</span>
              <output>{levels[k] || 0}</output>
              <input type="range" min="0" max="10" step="1" value={levels[k] || 0} onChange={(e) => setLevels((x) => ({ ...x, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
      </Section>

      {ranked.length > 1 && (
        <Section id={ids[2]} kicker="Alternatives" title="Ranked alternatives">
          <p className="note">The proven best, then the next best designs the search found. Gap is how far each is behind the best in score points.</p>
          <div className="table-scroll">
            <table className="rank">
              <thead>
                <tr>
                  <th scope="col">#</th><th scope="col">{kind.frame[0].toUpperCase() + kind.frame.slice(1)}</th>
                  {cols.map(([k, label]) => <th scope="col" key={k}>{label}</th>)}
                  <th scope="col">Gap</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, SHOWN).map((d, i) => (
                  <tr key={i} className={i === sel ? 'on' : ''}>
                    <td><button type="button" className="rowbtn" aria-pressed={i === sel} onClick={() => setSel(i)}>{i + 1}</button></td>
                    <td className="txt">{kind.frameOf(d)}</td>
                    {cols.map(([k]) => <td key={k}>{kind.fmt(k, d.stats[k])}</td>)}
                    <td>{i === 0 ? 'best' : (d.score - ranked[0].score).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {ranked.length > 2 && (
        <Section id={ids[3]} kicker="Analysis" title="Trade-offs and the Pareto front">
          <Pareto pool={pool} poolKeys={ranked.map((_, i) => i)} poolFront={front} axisX={axisX} axisY={axisY} setAxisX={setAxisX} setAxisY={setAxisY}
            topKeys={ranked.slice(0, SHOWN).map((_, i) => i)} selectedKey={sel} onPick={(i) => setSel(i)}
            stats={axes} labels={labels} dirs={dirs} format={(v, k) => kind.fmt(k, v)} noun="design"
            note={`The ${ranked.length} best designs for these priorities. Click a point to view it. Filled rings are the ranked alternatives, the line is the frontier: no design does better on both stats. Brighter dots are on the Pareto front over every stat your priorities score.`} />
        </Section>
      )}
    </>
  );
}

function FoldAll({ ids }) {
  return (
    <div className="fold-all">
      <button type="button" className="ghost small" onClick={() => setAllCollapsed(ids, false)}>Expand all</button>
      <button type="button" className="ghost small" onClick={() => setAllCollapsed(ids, true)}>Collapse all</button>
    </div>
  );
}

// ---------------------------------------------------------------- tanks in your division
function UsedTanks({ game, designsUsed }) {
  return (
    <Section id="eq-tanks-used" kicker="Your division" title="Designs in your template">
      <div className="card-grid">{designsUsed.map((d) => <TankCard key={`${d.chassis}|${d.role}`} game={game} d={d} badge={d.tuned ? 'Tuned to your division' : undefined} />)}</div>
      <p className="note">These are chosen together with the template: each chassis and role is searched over every module combination, valued by what each stat is worth to the winning division.</p>
    </Section>
  );
}

// ---------------------------------------------------------------- aircraft role guide (until the designer data is extracted)
function AirGuide({ year, role: r }) {
  const [era, setEra] = useState(eraFor(year));
  useEffect(() => setEra(eraFor(year)), [year]);
  const e = r.eras[era];
  return (
    <>
      <div className="callout">
        <strong>Role guide</strong>
        <p>The aircraft optimizer is built (an exact search over every airframe and module combination, with thrust covering weight), but this app&apos;s game data does not include the aircraft designer files yet, so this is guidance rather than a computed optimum. Run <code>npm run designers</code> on a patch 1.12 or later install and this tab becomes the optimizer, with alternatives and trade-offs like tanks and ships.</p>
      </div>
      <div className="seg" role="group" aria-label="Research stage">
        {AIR_ERAS.map((x) => <button key={x} type="button" className={era === x ? 'on' : ''} aria-pressed={era === x} onClick={() => setEra(x)}>{x === 1936 ? 'Early war' : x === 1940 ? 'Mid war' : 'Late war'} · {x}</button>)}
      </div>
      <Section id="eq-air-guide" kicker={`${r.group} // ${r.name}`} title="Recommended layout">
        <article className="spec-card">
          <header><span className="spec-tag">{r.airframe}{r.engines > 1 ? ` · ${r.engines} engines` : ''}</span><h3>{r.name}</h3></header>
          <p className="spec-job">{r.job}</p>
          {e ? (
            <dl className="spec-slots">
              <div><dt>Main weapons</dt><dd>{e.main}</dd></div>
              <div><dt>Secondary</dt><dd>{e.secondary}</dd></div>
              <div><dt>Special</dt><dd>{e.special}</dd></div>
            </dl>
          ) : <p className="note">Not available yet at this stage of research.</p>}
          {e?.note && <p className="note">{e.note}</p>}
          <div className="spec-tags">
            {r.maximize.map((m) => <span key={m} className="pill good">{m}</span>)}
            {r.avoid.map((m) => <span key={m} className="pill bad">{m}</span>)}
          </div>
        </article>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- ship and aircraft design card
function SLOT_LABEL(slot) {
  const m = /^(front|mid|rear)_(\d)_custom_slot$/.exec(slot);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`;
  return ({
    fixed_ship_battery_slot: 'Main battery', fixed_ship_anti_air_slot: 'Anti-air', fixed_ship_fire_control_system_slot: 'Fire control',
    fixed_ship_radar_slot: 'Radar', fixed_ship_torpedo_slot: 'Torpedoes', fixed_ship_engine_slot: 'Engine', fixed_ship_secondaries_slot: 'Secondaries',
    fixed_ship_armor_slot: 'Armor', fixed_ship_deck_slot_1: 'Deck', fixed_ship_deck_slot_2: 'Deck 2',
  })[slot] || slot.replace(/_slot.*$/, '').replace(/_/g, ' ');
}
const TYPE_LABEL = { destroyer: 'Destroyer', light_cruiser: 'Light cruiser', heavy_cruiser: 'Heavy cruiser', battleship: 'Battleship', battle_cruiser: 'Battlecruiser', super_heavy_battleship: 'Super-heavy battleship', carrier: 'Carrier', submarine: 'Submarine' };
function PLANE_SLOT_LABEL(slot) {
  let m = /^fixed_auxiliary_weapon_slot_(\d)$/.exec(slot);
  if (m) return `Auxiliary ${m[1]}`;
  m = /^special_type_slot_(\d)$/.exec(slot);
  if (m) return `Special ${m[1]}`;
  return ({ fixed_main_weapon_slot: 'Main weapon', engine_type_slot: 'Engine' })[slot] || slot.replace(/_slot.*$/, '').replace(/_/g, ' ');
}
const PLANE_TYPE_LABEL = {
  fighter: 'Fighter', heavy_fighter: 'Heavy fighter', interceptor: 'Interceptor', cas: 'Close air support', naval_bomber: 'Naval bomber',
  tactical_bomber: 'Tactical bomber', strategic_bomber: 'Strategic bomber', scout_plane: 'Scout plane', maritime_patrol_plane: 'Maritime patrol',
  maritime_patrol: 'Maritime patrol', transport_plane: 'Transport', suicide: 'Suicide craft',
};

function DesignCard({ kind, d }) {
  const all = kind.stats.filter(([k]) => d.stats[k]);
  return (
    <article className="spec-card ship">
      <header><span className="spec-tag">{kind.typeLabel[d.stats.type] || d.stats.type}</span><h3>{d.hullName}</h3></header>
      <dl className="spec-slots">
        {Object.entries(d.modules).filter(([, id]) => id).map(([slot, id]) => (
          <div key={slot}><dt>{kind.slotLabel(slot)}</dt><dd>{naval.modules[id]?.name || id}</dd></div>
        ))}
      </dl>
      <dl className="ship-stats">
        {all.map(([k, label]) => (
          <div key={k} className={kind.lower(k) ? 'cost' : ''}><dt>{label}</dt><dd>{kind.fmt(k, d.stats[k])}</dd></div>
        ))}
      </dl>
    </article>
  );
}

function formatShip(k, v) {
  if (v == null) return '–';
  if (k === 'reliability') return `${(v * 100).toFixed(0)}%`;
  if (k === 'build_cost_ic' || k === 'naval_range') return Math.round(v).toLocaleString('en-GB');
  return (Math.round(v * 10) / 10).toLocaleString('en-GB');
}

function formatPlane(k, v) {
  if (v == null) return '–';
  if (k === 'reliability') return `${(v * 100).toFixed(0)}%`;
  if (k === 'maximum_speed' || k === 'air_range') return Math.round(v).toLocaleString('en-GB');
  return (Math.round(v * 10) / 10).toLocaleString('en-GB');
}

// ---------------------------------------------------------------- kinds: what differs between tanks, planes and ships
// (at the end of the file so the label tables above exist when these are built)
const TANK_STATS = [['sa', 'Soft attack'], ['ha', 'Hard attack'], ['pier', 'Piercing'], ['arm', 'Armor'], ['brk', 'Breakthrough'], ['def', 'Defense'], ['air', 'Air attack'], ['spd', 'Speed (km/h)'], ['rel', 'Reliability'], ['ic', 'Production cost']];
const TANK = {
  id: 'tank', noun: 'design', frame: 'chassis', stats: TANK_STATS, lower: (k) => k === 'ic',
  // tank priorities are the role's objective as it is (cost already counts against the design)
  toSearch: (levels) => ({ ...levels }),
  levelOf: (role, k) => role.objective[k] || 0,
  fmt: (k, v) => (k === 'rel' ? `${((v || 0) * 100).toFixed(0)}%` : fmt(v, k)),
  frameOf: (d) => d.chassisName, ranked: (res) => res?.ranked || [],
};
const SHIP = {
  id: 'ship', noun: 'design', frame: 'hull', stats: SHIP_STATS, lower: shipLower,
  levelOf: (role, k) => Math.abs(role.weights[k] || 0),
  toSearch: (levels, lower) => Object.fromEntries(Object.entries(levels).filter(([, v]) => v).map(([k, v]) => [k, lower(k) ? -v : v])),
  fmt: formatShip, frameOf: (d) => d.hullName, ranked: (res) => (res ? res.ranked || [res] : []),
  slotLabel: SLOT_LABEL, typeLabel: TYPE_LABEL,
};
const PLANE = {
  ...SHIP, id: 'plane', frame: 'airframe', stats: PLANE_STATS.filter(([k]) => !['thrust', 'weight'].includes(k)), lower: planeLower,
  fmt: formatPlane, slotLabel: PLANE_SLOT_LABEL, typeLabel: PLANE_TYPE_LABEL,
};

