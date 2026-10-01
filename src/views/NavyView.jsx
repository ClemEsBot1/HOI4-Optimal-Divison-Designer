import React, { useEffect, useMemo, useState } from 'react';
import Section, { setAllCollapsed } from '../components/Section.jsx';
import { DesignCard, SHIP } from './EquipmentView.jsx';
import { SHIP_ROLES } from '../lib/naval.js';
import {
  FLEETS, RULES, SOURCES, fleetSlots, slotWeights, composeFleet, fleetSummary, planDockyards, lineItems, fitScale,
  DOCKYARD_OUTPUT, BOMBARD, RAID_REGIONS, MAX_CARRIERS, SCREENS_PER_SHIP,
} from '../lib/fleet.js';
import { readStore, writeStore } from '../lib/storage.js';
import naval from '../data/designers.json';
import './NavyView.css';

const STORE = 'dd.navy';
const SPEEDS = [0, 20, 22, 24, 26, 28, 30, 32];
const BUFFERS = [0, 0.5, 1, 1.5, 2, 3];
const DEADLINES = [1, 2, 3, 4, 5];
const CLASS_NAME = { carrier: 'Carrier', capital: 'Capital ship', screen: 'Screen', sub: 'Submarine' };
const IDS = ['nv-roster', 'nv-designs', 'nv-dockyards', 'nv-why'];
const roleName = (slot) => slot.name || SHIP_ROLES.find((r) => r.id === slot.role)?.name || slot.role;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v) => Math.round(v).toLocaleString('en-GB');
const one = (v) => (Math.round(v * 10) / 10).toLocaleString('en-GB');
const plural = (n, [a, b]) => `${n} ${n === 1 ? a : b}`;
const months = (days) => days / 30.44;

/**
 * Whole fleets: pick a fleet type, scale it up or down, and get its order of battle, the best design for every ship
 * in it (searched with the fleet's speed floor) and the dockyard plan that finishes every ship type together.
 */
export default function NavyView({ year, requestShip }) {
  const [st, setSt] = useState(() => ({ fleet: FLEETS[0].id, scale: {}, buffer: {}, speed: {}, dockyards: 30, output: DOCKYARD_OUTPUT, deadline: 3, ...readStore(STORE, {}) }));
  useEffect(() => writeStore(STORE, st), [st]);
  const fleet = FLEETS.find((f) => f.id === st.fleet) || FLEETS[0];
  const scale = clamp(st.scale[fleet.id] ?? fleet.scale.start, fleet.scale.min, fleet.scale.max);
  const buffer = st.buffer[fleet.id] ?? fleet.buffer ?? 0;
  const speed = st.speed[fleet.id] ?? fleet.speed ?? 0;
  const per = (key, value) => setSt((s) => ({ ...s, [key]: { ...s[key], [fleet.id]: value } }));
  const setScale = (n) => per('scale', clamp(n, fleet.scale.min, fleet.scale.max));
  const shipYear = clamp(year, 1936, 1945);

  const designs = useFleetDesigns(fleet, shipYear, speed, requestShip);
  const slots = fleetSlots(fleet);
  const pending = slots.some((s) => designs[s.id] === undefined);
  const comp = useMemo(() => composeFleet(fleet, { scale, buffer }), [fleet, scale, buffer]);
  const sum = useMemo(() => fleetSummary(fleet, comp, designs), [fleet, comp, designs]);
  const plan = useMemo(() => (pending ? null : planDockyards(lineItems(fleet, comp, designs), st.dockyards, st.output)), [pending, fleet, comp, designs, st.dockyards, st.output]);
  const [fitNote, setFitNote] = useState(null);
  useEffect(() => setFitNote(null), [fleet.id]);
  const fit = () => {
    const days = st.deadline * 365;
    const n = fitScale(fleet, designs, { buffer, dockyards: st.dockyards, output: st.output, days });
    setScale(n);
    const p = planDockyards(lineItems(fleet, composeFleet(fleet, { scale: n, buffer }), designs), st.dockyards, st.output);
    setFitNote(p && !p.short && p.days <= days
      ? `${plural(n, fleet.unit)} is the largest fleet ${st.dockyards} dockyards finish within ${plural(st.deadline, ['year', 'years'])}.`
      : `Even ${plural(n, fleet.unit)} takes ${p && !p.short ? `${int(p.days)} days` : 'more dockyards'} with ${st.dockyards} dockyards.`);
  };

  return (
    <div className="view-navy">
      <div className="view-head">
        <div>
          <p className="kicker">Admiralty</p>
          <h1>Navy</h1>
          <p className="lede">Pick a fleet. Its make-up follows the compositions current guides recommend, scaled by the game&apos;s screening rules; every ship gets the best design for your research level, and the dockyard plan finishes every ship type together.</p>
        </div>
      </div>

      <FleetPicker value={fleet.id} onPick={(id) => setSt((s) => ({ ...s, fleet: id }))} />
      <div className="row-between">
        <p className="lede small">{fleet.blurb}</p>
        <div className="fold-all">
          <button type="button" className="ghost small" onClick={() => setAllCollapsed(IDS, false)}>Expand all</button>
          <button type="button" className="ghost small" onClick={() => setAllCollapsed(IDS, true)}>Collapse all</button>
        </div>
      </div>

      <div className="fleet-controls">
        <div className="scale" role="group" aria-label="Fleet size">
          <button type="button" className="ghost" onClick={() => setScale(scale - 1)} disabled={scale <= fleet.scale.min}>− Scale down</button>
          <div className="scale-value" aria-live="polite">
            <span><b>{scale}</b> {scale === 1 ? fleet.unit[0] : fleet.unit[1]}</span>
            <small>{plural(comp.ships, ['ship', 'ships'])} · {plural(comp.taskForces.length, ['task force', 'task forces'])}</small>
          </div>
          <button type="button" className="ghost" onClick={() => setScale(scale + 1)} disabled={scale >= fleet.scale.max}>Scale up +</button>
        </div>
        {!fleet.members && (
          <label>Screens per capital ship
            <select value={buffer} onChange={(e) => per('buffer', Number(e.target.value))}>
              {BUFFERS.map((b) => <option key={b} value={b}>{one(SCREENS_PER_SHIP + b)}{b ? ` (${one(b)} spare)` : ' (the minimum)'}</option>)}
            </select>
          </label>
        )}
        <label>Speed floor
          <select value={speed} onChange={(e) => per('speed', Number(e.target.value))}>
            {SPEEDS.map((v) => <option key={v} value={v}>{v ? `${v} knots` : 'None'}</option>)}
          </select>
        </label>
      </div>

      <Section id={IDS[0]} kicker={`${fleet.doctrine === 'Any' ? 'Any doctrine' : fleet.doctrine} // ${fleet.mission}`} title="Order of battle">
        <Kpis fleet={fleet} comp={comp} sum={sum} pending={pending} />
        <CompositionBar slots={slots} comp={comp} />
        <div className="table-scroll">
          <table className="rank fleet-table">
            <thead>
              <tr>
                <th scope="col">Ship</th><th scope="col">Class</th><th scope="col">Hull</th><th scope="col">Ships</th>
                <th scope="col">{fleet.members ? 'Per group' : 'Per task force'}</th><th scope="col">Speed</th><th scope="col">Cost each</th><th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {slots.filter((s) => comp.counts[s.id]).map((s) => {
                const d = designs[s.id];
                const perTf = [...new Set(comp.taskForces.map((tf) => tf.counts[s.id] || 0))];
                return (
                  <tr key={s.id}>
                    <td className="txt"><span className={`cls-dot ${s.cls}`} />{roleName(s)}</td>
                    <td className="txt">{CLASS_NAME[s.cls]}</td>
                    <td className="txt">{d ? d.hullName : d === null ? 'None available' : '…'}</td>
                    <td>{comp.counts[s.id]}</td>
                    <td>{perTf.join(' / ')}</td>
                    <td className={d?.slow ? 'bad' : ''}>{d ? `${one(d.stats.naval_speed)} kn` : '–'}</td>
                    <td>{d ? int(d.stats.build_cost_ic) : '–'}</td>
                    <td>{d ? int(d.stats.build_cost_ic * comp.counts[s.id]) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Checks fleet={fleet} comp={comp} sum={sum} designs={designs} speed={speed} pending={pending} />
      </Section>

      <Section id={IDS[1]} kicker="Naval designer" title="Ship designs">
        <p className="note">The proven-best design for each ship at your research level ({shipYear}; change it from the command bar), searched over every hull and module like the Equipment page{speed ? `, keeping only designs that make ${speed} knots so the fleet sails together` : ''}. Hulls, modules and naval technology from {naval.meta.source} (game version {naval.meta.gameVersion}).</p>
        <div className="card-grid">
          {slots.filter((s) => comp.counts[s.id]).map((s) => {
            const d = designs[s.id];
            return (
              <div key={s.id} className="fleet-design">
                <div className="fleet-design-head">
                  <span className={`cls-dot ${s.cls}`} /><b>{comp.counts[s.id]}×</b> {roleName(s)}
                  {d?.slow && <span className="pill bad">cannot make {speed} kn</span>}
                </div>
                {d === undefined && <p className="busy">Designing</p>}
                {d === null && <p className="note">No hull for this ship at your research level.</p>}
                {d && <DesignCard kind={SHIP} d={d} />}
              </div>
            );
          })}
        </div>
      </Section>

      <Section id={IDS[2]} kicker="Production" title="Dockyard plan">
        <div className="fields compact dock-fields">
          <label>Dockyards for this fleet
            <input type="number" min="1" max="999" step="1" value={st.dockyards} onChange={(e) => setSt((s) => ({ ...s, dockyards: clamp(Math.round(Number(e.target.value)) || 1, 1, 999) }))} />
          </label>
          <label>Output per dockyard (IC a day)
            <input type="number" min="0.5" max="10" step="0.05" value={st.output} onChange={(e) => setSt((s) => ({ ...s, output: clamp(Number(e.target.value) || DOCKYARD_OUTPUT, 0.5, 10) }))} />
          </label>
          <label>Fit the fleet to finish within
            <span className="fit-row">
              <select value={st.deadline} onChange={(e) => setSt((s) => ({ ...s, deadline: Number(e.target.value) }))}>
                {DEADLINES.map((y) => <option key={y} value={y}>{plural(y, ['year', 'years'])}</option>)}
              </select>
              <button type="button" className="small" onClick={fit} disabled={pending}>Fit fleet</button>
            </span>
          </label>
        </div>
        {fitNote && <p className="note">{fitNote}</p>}
        <DockyardPlan plan={plan} pending={pending} slots={slots} designs={designs} dockyards={st.dockyards} year={shipYear} />
      </Section>

      <Section id={IDS[3]} kicker="Doctrine and sources" title="Why this fleet" defaultOpen={false}>
        <Why fleet={fleet} />
      </Section>
    </div>
  );
}

/** Designs for every ship of a fleet; a ship that cannot make the speed floor falls back to its best design, marked slow. */
function useFleetDesigns(fleet, year, speed, requestShip) {
  const [designs, setDesigns] = useState({});
  useEffect(() => {
    let live = true;
    setDesigns({});
    const minStats = speed ? { naval_speed: speed } : undefined;
    for (const slot of fleetSlots(fleet)) {
      const weights = slotWeights(slot, SHIP_ROLES) || undefined;
      requestShip(slot.role, year, weights, 1, minStats)
        .then((d) => (d || !minStats ? { d, slow: false } : requestShip(slot.role, year, weights, 1).then((x) => ({ d: x, slow: !!x }))))
        .then(({ d, slow }) => { if (live) setDesigns((cur) => ({ ...cur, [slot.id]: d && !d.error ? { ...d, slow } : null })); });
    }
    return () => { live = false; };
  }, [fleet.id, year, speed]); // eslint-disable-line react-hooks/exhaustive-deps
  return designs;
}

function FleetPicker({ value, onPick }) {
  const groups = [...new Set(FLEETS.map((f) => f.group))];
  return (
    <nav className="type-picker" aria-label="Fleet type">
      {groups.map((g) => (
        <div key={g} className="type-group">
          <span className="type-group-name">{g}</span>
          <div className="seg">
            {FLEETS.filter((f) => f.group === g).map((f) => (
              <button key={f.id} type="button" className={value === f.id ? 'on' : ''} aria-pressed={value === f.id} onClick={() => onPick(f.id)}>{f.name}</button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Kpis({ fleet, comp, sum, pending }) {
  const extra = {
    carrier_size: ['Air wings (deck)', one(sum.sum.carrier_size)],
    anti_air_attack: ['Anti-air', one(sum.sum.anti_air_attack)],
    lg_attack: ['Light attack', one(sum.sum.lg_attack)],
    hg_attack: ['Heavy attack', one(sum.sum.hg_attack)],
    torpedo_attack: ['Torpedo attack', one(sum.sum.torpedo_attack)],
    sub_attack: ['Anti-submarine', one(sum.sum.sub_attack)],
    max_strength: ['Hit points', int(sum.sum.max_strength)],
    mines_planting: ['Mine laying', one(sum.sum.mines_planting)],
    surface_detection: ['Best surface detection', one(sum.max.surface_detection)],
    sub_detection: ['Best sub detection', one(sum.max.sub_detection)],
    bombard: ['Shore bombardment', `−${one(sum.bombard * 100)}%`],
  };
  const wait = (v) => (pending ? '…' : v);
  return (
    <div className="kpis">
      <div><span>Ships</span><b>{comp.ships}</b></div>
      <div><span>Task forces</span><b>{comp.taskForces.length}</b></div>
      {sum.ratio != null && <div className={sum.screening < 1 ? 'bad' : 'good'}><span>Screens per capital</span><b>{one(sum.ratio)}</b></div>}
      <div><span>Fleet speed</span><b>{wait(sum.speed ? `${one(sum.speed)} kn` : '–')}</b></div>
      <div><span>Production cost</span><b>{wait(int(sum.cost))}</b></div>
      {fleet.kpis.includes('regions') && <div><span>Raiding coverage</span><b>{one(comp.taskForces.length * RAID_REGIONS)} regions</b></div>}
      {fleet.kpis.filter((k) => extra[k]).map((k) => <div key={k}><span>{extra[k][0]}</span><b>{wait(extra[k][1])}</b></div>)}
    </div>
  );
}

function CompositionBar({ slots, comp }) {
  const shown = slots.filter((s) => comp.counts[s.id]);
  return (
    <div className="compo-bar" role="img" aria-label={shown.map((s) => `${comp.counts[s.id]} ${roleName(s)}`).join(', ')}>
      {shown.map((s) => <i key={s.id} className={s.cls} style={{ flexGrow: comp.counts[s.id] }} title={`${comp.counts[s.id]} × ${roleName(s)}`} />)}
    </div>
  );
}

/** What the game's rules ask of this fleet, and whether it meets them. */
function Checks({ fleet, comp, sum, designs, speed, pending }) {
  const rows = [];
  if (sum.ratio != null) {
    rows.push({ ok: sum.screening >= 1, text: `${one(sum.ratio)} screens per capital ship and carrier in every task force: ${SCREENS_PER_SHIP} give full screening${sum.screening < 1 ? `, so screening is only ${Math.round(sum.screening * 100)}%` : ''}.` });
  }
  if (sum.carrierScreening != null) {
    const perCarrier = Math.min(...comp.taskForces.filter((tf) => tf.carriers).map((tf) => tf.capitals / tf.carriers));
    rows.push({ ok: sum.carrierScreening >= 1, text: `${one(perCarrier)} capital ships per carrier: one gives the carriers full screening.` });
    rows.push({ ok: sum.maxCarriers <= MAX_CARRIERS, text: `${plural(sum.maxCarriers, ['carrier', 'carriers'])} in the largest task force, ${MAX_CARRIERS} at most before planes are lost${comp.taskForces.length > 1 ? `; the fleet is split into ${comp.taskForces.length} task forces` : ''}.` });
  }
  if (!pending) {
    const slow = fleetSlots(fleet).filter((s) => comp.counts[s.id] && designs[s.id]?.slow);
    if (speed) {
      rows.push(slow.length
        ? { ok: false, text: `${slow.map(roleName).join(' and ')} cannot make ${speed} knots at this research level, so the fleet sails at ${one(sum.speed)} knots.` }
        : { ok: true, text: `Every ship makes the ${speed}-knot floor; the fleet sails at ${one(sum.speed)} knots, its slowest ship.` });
    } else if (sum.speed) {
      rows.push({ ok: true, warn: !fleet.members, text: `No speed floor: the fleet sails at ${one(sum.speed)} knots, its slowest ship.` });
    }
    if (fleet.kpis.includes('bombard')) {
      const cap = fleetSlots(fleet).find((s) => s.cls === 'capital');
      const d = cap && designs[cap.id];
      const each = d ? BOMBARD.hg * (d.stats.hg_attack || 0) + BOMBARD.lg * (d.stats.lg_attack || 0) : 0;
      rows.push({ ok: sum.bombard >= BOMBARD.cap - 1e-9, warn: sum.bombard < BOMBARD.cap - 1e-9, text: `Shore bombardment −${one(sum.bombard * 100)}% of the ${BOMBARD.cap * 100}% cap${each ? `; ${Math.ceil((BOMBARD.cap - 1e-9) / each)} of these battleships alone reach it` : ''}.` });
    }
  }
  if (fleet.kpis.includes('regions')) rows.push({ ok: true, text: `${plural(comp.taskForces.length, ['pack', 'packs'])} of ten cover about ${one(comp.taskForces.length * RAID_REGIONS)} strategic regions at full raiding efficiency.` });
  if (!rows.length) return null;
  return <ul className="checks">{rows.map((r, i) => <li key={i} className={r.ok ? (r.warn ? 'warn' : '') : r.warn ? 'warn' : 'bad'}>{r.text}</li>)}</ul>;
}

function DockyardPlan({ plan, pending, slots, designs, dockyards, year }) {
  if (pending) return <p className="busy">Waiting for the designs</p>;
  if (!plan) return <p className="note">No ship of this fleet can be built at your research level.</p>;
  if (plan.short) return <p className="note error">The fleet needs at least {plan.short} dockyards: one production line for each kind of ship.</p>;
  const bySlot = Object.fromEntries(slots.map((s) => [s.id, s]));
  // identical lines (same ship, dockyards and queue) are shown once with how many there are
  const groups = [];
  for (const l of plan.lines) {
    const g = groups.find((x) => x.id === l.id && x.dockyards === l.dockyards && x.ships === l.ships);
    if (g) g.n++; else groups.push({ ...l, n: 1 });
  }
  const start = new Date(Date.UTC(year, 0, 1));
  const done = new Date(start.getTime() + plan.days * 864e5);
  const ticks = axisTicks(plan.days);
  const b = plan.balance;
  return (
    <>
      <div className="kpis">
        <div><span>Fleet complete</span><b>{int(plan.days)} days</b></div>
        <div><span>From 1 Jan {year}</span><b>{done.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</b></div>
        <div><span>Dockyards used</span><b>{plan.used} of {dockyards}</b></div>
        <div><span>Fastest possible</span><b>{int(plan.fastest.days)} days</b></div>
        {b && <div className={b.ratio < SCREENS_PER_SHIP - 1e-9 ? 'bad' : 'good'}><span>Worst screening mid-build</span><b>{one(b.ratio)} : 1</b></div>}
      </div>
      <p className="note">
        Every kind of ship gets the fewest dockyards that still finish it by the day the fleet is complete, so all of them build in parallel{b ? ' and the screens come in alongside the ships they screen' : ''}.
        {b ? ' A production line takes at most 5 dockyards for a capital ship or carrier and 10 for a screen or submarine, so the big ships are split over parallel lines.' : ' A production line takes at most 10 dockyards for a screen or submarine, so a large order is split over parallel lines.'}
        {b && (b.ratio >= SCREENS_PER_SHIP - 1e-9
          ? ' Every capital ship and carrier launches with at least three screens per big ship already afloat, so the fleet is fully screened at every stage of the build.'
          : ` On day ${int(b.day)} the fleet has ${plural(b.big, ['big ship', 'big ships'])} but only ${plural(b.screens, ['screen', 'screens'])} (${one(b.ratio)} per big ship), as whole dockyards cannot keep every line exactly in step${b.from != null ? `; keep it in port until day ${int(b.from)}, when the screens catch up` : ''}.`)}
        {plan.spare > 0 && ` ${plural(plan.spare, ['dockyard is', 'dockyards are'])} left over: every line that holds the fleet back is already full, so scale the fleet up or use ${plan.spare === 1 ? 'it' : 'them'} for convoys.`}
        {plan.fastest.dockyards > dockyards && ` With ${plan.fastest.dockyards} dockyards the fleet would be done in ${int(plan.fastest.days)} days${plan.fastest.days >= 45 ? ` (about ${plural(Math.round(months(plan.fastest.days)), ['month', 'months'])})` : ''}, the most its lines can use.`}
      </p>
      <div className="table-scroll">
        <table className="rank compact dock-table">
          <thead>
            <tr><th scope="col">Ship</th><th scope="col">Lines</th><th scope="col">Dockyards each</th><th scope="col">Ships each</th><th scope="col">Days per ship</th><th scope="col">Done on day</th></tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i}>
                <td className="txt"><span className={`cls-dot ${bySlot[g.id].cls}`} />{roleName(bySlot[g.id])} <small>{designs[g.id]?.hullName}</small></td>
                <td>{g.n}</td><td>{g.dockyards}</td><td>{g.ships}</td><td>{int(g.every)}</td><td>{int(g.finish)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gantt" role="img" aria-label={`Production timeline: the fleet is complete on day ${int(plan.days)}`}>
        {groups.map((g, i) => (
          <div key={i} className="gantt-row">
            <span className="gantt-label"><b>{g.n > 1 ? `${g.n} × ` : ''}{roleName(bySlot[g.id])}</b> · {g.dockyards} dockyards</span>
            <span className="gantt-track">
              <i className={`gantt-bar ${bySlot[g.id].cls}`} style={{ width: `${(g.finish / plan.days) * 100}%` }} />
              {Array.from({ length: g.ships }, (_, k) => <i key={k} className="gantt-tick" style={{ left: `${(((k + 1) * g.every) / plan.days) * 100}%` }} />)}
            </span>
          </div>
        ))}
        <div className="gantt-row gantt-axis" aria-hidden="true">
          <span />
          <span className="gantt-scale">{ticks.map((t) => <i key={t.at} style={{ left: `${(t.at / plan.days) * 100}%` }}>{t.label}</i>)}</span>
        </div>
      </div>
    </>
  );
}

/** Axis labels in months or years, about five of them. */
function axisTicks(days) {
  const m = months(days);
  const step = [1, 2, 3, 6, 12, 24, 36, 60, 120, 240].find((s) => m / s <= 6) || 480;
  const out = [];
  for (let k = 0; k * step <= m + 1e-9; k++) {
    const mo = k * step;
    out.push({ at: mo * 30.44, label: mo === 0 ? '0' : mo % 12 === 0 ? `${mo / 12} y` : `${mo} mo` });
  }
  return out;
}

function Why({ fleet }) {
  // number the sources in the order they are first cited
  const order = [];
  const cite = (src) => src.map((id) => { if (!order.includes(id)) order.push(id); return id; });
  const why = fleet.why.map((w) => ({ ...w, ids: cite(w.src) }));
  const rules = RULES.map((r) => ({ ...r, ids: cite(r.src) }));
  const Cite = ({ ids }) => (
    <sup className="cite">{ids.map((id) => <a key={id} href={SOURCES[id].url} target="_blank" rel="noreferrer" title={SOURCES[id].name}>[{order.indexOf(id) + 1}]</a>)}</sup>
  );
  return (
    <>
      <p><b>Doctrine:</b> {fleet.doctrine === 'Any' ? 'any; the fleet does not lean on one' : fleet.doctrine}. <b>Mission:</b> {fleet.mission}.</p>
      <h3>What the guides recommend</h3>
      <ul className="rules">{why.map((w, i) => <li key={i}>{w.text}<Cite ids={w.ids} /></li>)}</ul>
      <h3>Rules the fleet is built on</h3>
      <ul className="rules">{rules.map((r, i) => <li key={i}>{r.text}<Cite ids={r.ids} /></li>)}</ul>
      <p className="note">Ship counts are rounded per task force (largest remainder), so each task force meets the rules on its own. Designs come from the exact ship search with this fleet&apos;s priorities; the dockyard plan is the earliest finish any split of your dockyards into production lines can reach.</p>
      <h3>Sources</h3>
      <ol className="sources">{order.map((id) => <li key={id}><a href={SOURCES[id].url} target="_blank" rel="noreferrer">{SOURCES[id].name}</a></li>)}</ol>
    </>
  );
}
