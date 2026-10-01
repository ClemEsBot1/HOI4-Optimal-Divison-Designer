import React, { useEffect, useMemo, useState } from 'react';
import Section, { setAllCollapsed } from '../components/Section.jsx';
import TankCard from '../components/TankCard.jsx';
import { TANK_ROLES } from '../lib/tankRoles.js';
import { SHIP_ROLES, SHIP_STATS, isLowerBetter } from '../lib/naval.js';
import { AIR_ROLES, AIR_ERAS, eraFor } from '../data/air.js';
import naval from '../data/designers.json';
import { fmt } from '../lib/stats.js';

const TABS = [
  { id: 'tanks', label: 'Tanks', kicker: 'Armor branch' },
  { id: 'air', label: 'Aircraft', kicker: 'Air branch' },
  { id: 'navy', label: 'Ships', kicker: 'Naval branch' },
];

/** Tanks, aircraft and ships, each by role. */
export default function EquipmentView({ game, tab, setTab, year, techsKey, designsUsed, requestTanks, requestShip }) {
  return (
    <div className="view-equipment">
      <div className="view-head">
        <div>
          <p className="kicker">Ordnance bureau</p>
          <h1>Equipment</h1>
          <p className="lede">The best design for every role at your research level. Tanks and ships are searched exhaustively over every module combination; aircraft are a role guide.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Equipment type">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              <small>{t.kicker}</small>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tab-stage" key={tab}>
        {tab === 'tanks' && <TanksTab game={game} techsKey={techsKey} designsUsed={designsUsed} requestTanks={requestTanks} />}
        {tab === 'air' && <AirTab year={year} />}
        {tab === 'navy' && <NavyTab year={year} requestShip={requestShip} />}
      </div>
    </div>
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

// ---------------------------------------------------------------- tanks
function TanksTab({ game, techsKey, designsUsed, requestTanks }) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    let live = true;
    setMeta(null);
    requestTanks().then((r) => { if (live) setMeta(r); });
    return () => { live = false; };
  }, [techsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = ['eq-tanks-used', ...TANK_ROLES.map((r) => `eq-tank-${r.id}`)];
  return (
    <>
      <FoldAll ids={ids} />
      <Section id="eq-tanks-used" kicker="Your division" title="Designs in your template">
        {designsUsed.length
          ? <div className="card-grid">{designsUsed.map((d) => <TankCard key={`${d.chassis}|${d.role}`} game={game} d={d} badge={d.tuned ? 'Tuned to your division' : undefined} />)}</div>
          : <p className="note">The selected template uses no tanks. Pick an armored role or template to see its designs here.</p>}
        <p className="note">These are chosen together with the template: each chassis and role is searched over every module combination, valued by what each stat is worth to the winning division.</p>
      </Section>
      {TANK_ROLES.map((r) => {
        const m = meta && meta.find((x) => x.id === r.id);
        return (
          <Section key={r.id} id={`eq-tank-${r.id}`} kicker="Role" title={r.name}>
            <p className="lede small">{r.blurb}</p>
            {!meta && <p className="busy">Designing</p>}
            {m && !m.options.length && <p className="note">No chassis for this role is researched yet.</p>}
            {m && m.options.length > 0 && (
              <div className="role-designs">
                <TankCard game={game} d={{ ...m.options[0], role: r.unitRole }} title="Recommended" />
                {m.options.length > 1 && (
                  <div className="table-scroll">
                    <table className="rank compact">
                      <thead><tr><th scope="col">Chassis</th><th scope="col">Score</th><th scope="col">Soft</th><th scope="col">Hard</th><th scope="col">Pierce</th><th scope="col">Armor</th><th scope="col">Brk</th><th scope="col">Speed</th><th scope="col">Cost</th></tr></thead>
                      <tbody>
                        {m.options.map((o, i) => (
                          <tr key={o.chassis} className={i === 0 ? 'on' : ''}>
                            <td className="txt">{o.chassisName}</td><td>{o.score.toFixed(2)}</td>
                            <td>{fmt(o.stats.sa, 'sa')}</td><td>{fmt(o.stats.ha, 'ha')}</td><td>{fmt(o.stats.pier, 'pier')}</td>
                            <td>{fmt(o.stats.arm, 'arm')}</td><td>{fmt(o.stats.brk, 'brk')}</td><td>{fmt(o.stats.spd, 'spd')}</td><td>{fmt(o.stats.ic, 'ic')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- aircraft
function AirTab({ year }) {
  const [era, setEra] = useState(eraFor(year));
  useEffect(() => setEra(eraFor(year)), [year]);
  const groups = [...new Set(AIR_ROLES.map((r) => r.group))];
  const ids = groups.map((g) => `eq-air-${g}`);
  return (
    <>
      <div className="callout">
        <strong>Role guide</strong>
        <p>The aircraft designer's files are not in this app's game data, so these designs are guidance rather than a computed optimum: what each role is for, what to maximize, and which modules do it at each stage. Run <code>node scripts/extract-designers.mjs</code> on a current install to add the aircraft designer.</p>
      </div>
      <div className="row-between">
        <div className="seg" role="group" aria-label="Research stage">
          {AIR_ERAS.map((e) => <button key={e} type="button" className={era === e ? 'on' : ''} aria-pressed={era === e} onClick={() => setEra(e)}>{e === 1936 ? 'Early war' : e === 1940 ? 'Mid war' : 'Late war'} · {e}</button>)}
        </div>
        <FoldAll ids={ids} />
      </div>
      {groups.map((g) => (
        <Section key={g} id={`eq-air-${g}`} kicker="Air wing" title={g}>
          <div className="card-grid">
            {AIR_ROLES.filter((r) => r.group === g).map((r) => {
              const e = r.eras[era];
              return (
                <article key={r.id} className="spec-card">
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
              );
            })}
          </div>
        </Section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- ships
const SLOT_LABEL = (slot) => {
  const m = /^(front|mid|rear)_(\d)_custom_slot$/.exec(slot);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`;
  return ({
    fixed_ship_battery_slot: 'Main battery', fixed_ship_anti_air_slot: 'Anti-air', fixed_ship_fire_control_system_slot: 'Fire control',
    fixed_ship_radar_slot: 'Radar', fixed_ship_torpedo_slot: 'Torpedoes', fixed_ship_engine_slot: 'Engine', fixed_ship_secondaries_slot: 'Secondaries',
    fixed_ship_armor_slot: 'Armor', fixed_ship_deck_slot_1: 'Deck', fixed_ship_deck_slot_2: 'Deck 2',
  })[slot] || slot.replace(/_slot.*$/, '').replace(/_/g, ' ');
};
const TYPE_LABEL = { destroyer: 'Destroyer', light_cruiser: 'Light cruiser', heavy_cruiser: 'Heavy cruiser', battleship: 'Battleship', battle_cruiser: 'Battlecruiser', super_heavy_battleship: 'Super-heavy battleship', carrier: 'Carrier', submarine: 'Submarine' };

function NavyTab({ year, requestShip }) {
  const navalYear = Math.max(1936, Math.min(1945, year));
  const groups = [...new Set(SHIP_ROLES.map((r) => r.group))];
  const ids = groups.map((g) => `eq-navy-${g}`);
  return (
    <>
      <div className="callout">
        <strong>Ship designer data</strong>
        <p>Hulls, modules and naval technology from {naval.meta.source} (game version {naval.meta.gameVersion}). Every legal module combination is considered for each role and the answer is proven best: modules another module beats on every scored stat are skipped, and a bound that relaxes the score slot by slot rules out the rest without scoring them. Re-run <code>node scripts/extract-designers.mjs</code> on a current install for the latest values.</p>
      </div>
      <div className="row-between">
        <p className="note">Designs for {navalYear}. Change the year from the command bar.</p>
        <FoldAll ids={ids} />
      </div>
      {groups.map((g) => (
        <Section key={g} id={`eq-navy-${g}`} kicker="Fleet" title={g}>
          <div className="card-grid">
            {SHIP_ROLES.filter((r) => r.group === g).map((r) => <ShipCard key={`${r.id}-${navalYear}`} role={r} year={navalYear} requestShip={requestShip} />)}
          </div>
        </Section>
      ))}
    </>
  );
}

function ShipCard({ role, year, requestShip }) {
  const [res, setRes] = useState(undefined);
  useEffect(() => {
    let live = true;
    requestShip(role.id, year).then((r) => { if (live) setRes(r); });
    return () => { live = false; };
  }, [role.id, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => {
    const scored = Object.keys(role.weights);
    return SHIP_STATS.filter(([k]) => scored.includes(k) || ['max_strength', 'naval_speed', 'build_cost_ic'].includes(k));
  }, [role]);
  return (
    <article className="spec-card ship">
      <header><span className="spec-tag">{res?.stats ? TYPE_LABEL[res.stats.type] || res.stats.type : 'Ship'}</span><h3>{role.name}</h3></header>
      <p className="spec-job">{role.blurb}</p>
      {res === undefined && <p className="busy">Designing</p>}
      {res === null && <p className="note">No hull for this role is available in {year}.</p>}
      {res && (
        <>
          <p className="ship-hull">{res.hullName}</p>
          <dl className="spec-slots">
            {Object.entries(res.modules).filter(([, id]) => id).map(([slot, id]) => (
              <div key={slot}><dt>{SLOT_LABEL(slot)}</dt><dd>{naval.modules[id]?.name || id}</dd></div>
            ))}
          </dl>
          <dl className="ship-stats">
            {keys.map(([k, label]) => (
              <div key={k} className={isLowerBetter(k) ? 'cost' : ''}><dt>{label}</dt><dd>{formatShip(k, res.stats[k])}</dd></div>
            ))}
          </dl>
          {res.truncated && <p className="note">The search stopped at its budget; this is the best design it reached.</p>}
        </>
      )}
    </article>
  );
}

function formatShip(k, v) {
  if (v == null) return '–';
  if (k === 'reliability') return `${(v * 100).toFixed(0)}%`;
  if (k === 'build_cost_ic' || k === 'naval_range') return Math.round(v).toLocaleString('en-GB');
  return (Math.round(v * 10) / 10).toLocaleString('en-GB');
}
