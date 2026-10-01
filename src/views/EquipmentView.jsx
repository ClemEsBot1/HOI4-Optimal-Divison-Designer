import React, { useEffect, useMemo, useState } from 'react';
import Section, { setAllCollapsed } from '../components/Section.jsx';
import TankCard from '../components/TankCard.jsx';
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

/** Tanks, aircraft and ships, each by role. */
export default function EquipmentView({ game, tab, setTab, year, techsKey, designsUsed, requestTanks, requestShip, requestPlane }) {
  return (
    <div className="view-equipment">
      <div className="view-head">
        <div>
          <p className="kicker">Ordnance bureau</p>
          <h1>Equipment</h1>
          <p className="lede">The best design for every role at your research level, searched exactly over every module combination, or for priorities you set yourself.</p>
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
        {tab === 'air' && (hasPlaneData(naval) ? <PlaneTab year={year} requestPlane={requestPlane} /> : <AirTab year={year} />)}
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
        <p>The aircraft optimizer is built (an exact search over every airframe and module combination, with thrust covering weight), but this app's game data does not include the aircraft designer files yet, so these designs are guidance rather than a computed optimum. Run <code>npm run designers</code> on a patch 1.12 or later install and this tab becomes the optimizer.</p>
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

// ---------------------------------------------------------------- aircraft (computed)
const PLANE_SLOT_LABEL = (slot) => {
  let m = /^fixed_auxiliary_weapon_slot_(\d)$/.exec(slot);
  if (m) return `Auxiliary ${m[1]}`;
  m = /^special_type_slot_(\d)$/.exec(slot);
  if (m) return `Special ${m[1]}`;
  return ({ fixed_main_weapon_slot: 'Main weapon', engine_type_slot: 'Engine' })[slot] || slot.replace(/_slot.*$/, '').replace(/_/g, ' ');
};
const PLANE_TYPE_LABEL = {
  fighter: 'Fighter', heavy_fighter: 'Heavy fighter', interceptor: 'Interceptor', cas: 'Close air support', naval_bomber: 'Naval bomber',
  tactical_bomber: 'Tactical bomber', strategic_bomber: 'Strategic bomber', scout_plane: 'Scout plane', maritime_patrol_plane: 'Maritime patrol',
  maritime_patrol: 'Maritime patrol', transport_plane: 'Transport', suicide: 'Suicide craft',
};
const PLANE = { roles: PLANE_ROLES, stats: PLANE_STATS, lower: planeLower, slotLabel: PLANE_SLOT_LABEL, typeLabel: PLANE_TYPE_LABEL, always: ['maximum_speed', 'air_range', 'build_cost_ic'], noun: 'airframe', fmt: formatPlane };

function PlaneTab({ year, requestPlane }) {
  const airYear = Math.max(1933, Math.min(1950, year));
  const groups = [...new Set(PLANE_ROLES.map((r) => r.group))];
  const ids = ['eq-air-custom', ...groups.map((g) => `eq-air-${g}`)];
  return (
    <>
      <div className="callout">
        <strong>Aircraft designer data</strong>
        <p>Airframes, modules and air technology from {naval.meta.source} (game version {naval.meta.gameVersion}). Every legal module combination is considered for each role and the answer is proven best. A design is legal only when the engines' thrust covers the weight of the airframe and its modules; thrust left over adds {EXCESS_THRUST_SPEED} km/h of speed per point.</p>
      </div>
      <div className="row-between">
        <p className="note">Designs for {airYear}. Change the year from the command bar.</p>
        <FoldAll ids={ids} />
      </div>
      <Section id="eq-air-custom" kicker="Custom orders" title="Your own goal" defaultOpen={false}>
        <CustomGoal kind={PLANE} year={airYear} request={requestPlane} />
      </Section>
      {groups.map((g) => (
        <Section key={g} id={`eq-air-${g}`} kicker="Air wing" title={g}>
          <div className="card-grid">
            {PLANE_ROLES.filter((r) => r.group === g).map((r) => <DesignCard key={`${r.id}-${airYear}`} kind={PLANE} role={r} year={airYear} request={requestPlane} />)}
          </div>
        </Section>
      ))}
    </>
  );
}

const SHIP = { roles: SHIP_ROLES, stats: SHIP_STATS, lower: shipLower, slotLabel: SLOT_LABEL, typeLabel: TYPE_LABEL, always: ['max_strength', 'naval_speed', 'build_cost_ic'], noun: 'hull', fmt: formatShip };

function NavyTab({ year, requestShip }) {
  const navalYear = Math.max(1936, Math.min(1945, year));
  const groups = [...new Set(SHIP_ROLES.map((r) => r.group))];
  const ids = ['eq-navy-custom', ...groups.map((g) => `eq-navy-${g}`)];
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
      <Section id="eq-navy-custom" kicker="Custom orders" title="Your own goal" defaultOpen={false}>
        <CustomGoal kind={SHIP} year={navalYear} request={requestShip} />
      </Section>
      {groups.map((g) => (
        <Section key={g} id={`eq-navy-${g}`} kicker="Fleet" title={g}>
          <div className="card-grid">
            {SHIP_ROLES.filter((r) => r.group === g).map((r) => <DesignCard key={`${r.id}-${navalYear}`} kind={SHIP} role={r} year={navalYear} request={requestShip} />)}
          </div>
        </Section>
      ))}
    </>
  );
}

/** The best design of one role (or of the role's hull and requirements on custom weights). */
function DesignCard({ kind, role, year, request, weights, title }) {
  const [res, setRes] = useState(undefined);
  const wKey = weights ? JSON.stringify(weights) : '';
  useEffect(() => {
    let live = true;
    setRes(undefined);
    request(role.id, year, weights).then((r) => { if (live) setRes(r); });
    return () => { live = false; };
  }, [role.id, year, wKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => {
    const scored = Object.keys(weights || role.weights).filter((k) => (weights || role.weights)[k]);
    return kind.stats.filter(([k]) => scored.includes(k) || kind.always.includes(k));
  }, [kind, role, wKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <article className="spec-card ship">
      <header><span className="spec-tag">{res?.stats ? kind.typeLabel[res.stats.type] || res.stats.type : role.group}</span><h3>{title || role.name}</h3></header>
      {!title && <p className="spec-job">{role.blurb}</p>}
      {res === undefined && <p className="busy">Designing</p>}
      {res === null && <p className="note">No {kind.noun} for this role is available in {year}, or none can carry what it needs.</p>}
      {res && (
        <>
          <p className="ship-hull">{res.hullName}</p>
          <dl className="spec-slots">
            {Object.entries(res.modules).filter(([, id]) => id).map(([slot, id]) => (
              <div key={slot}><dt>{kind.slotLabel(slot)}</dt><dd>{naval.modules[id]?.name || id}</dd></div>
            ))}
          </dl>
          <dl className="ship-stats">
            {keys.map(([k, label]) => (
              <div key={k} className={kind.lower(k) ? 'cost' : ''}><dt>{label}</dt><dd>{kind.fmt(k, res.stats[k])}</dd></div>
            ))}
          </dl>
          {res.truncated && <p className="note">The search stopped at its budget; this is the best design it reached.</p>}
        </>
      )}
    </article>
  );
}

/**
 * Priorities set by hand, like the division designer's: pick the role whose hull and requirements to keep, then how
 * much each stat matters (0 ignores it, 10 matters most). Costs and visibility count against the design.
 */
function CustomGoal({ kind, year, request }) {
  const [roleId, setRoleId] = useState(kind.roles[0].id);
  const role = kind.roles.find((r) => r.id === roleId) || kind.roles[0];
  const fromRole = (r) => Object.fromEntries(Object.entries(r.weights).map(([k, v]) => [k, Math.abs(v)]));
  const [levels, setLevels] = useState(() => fromRole(role));
  const [asked, setAsked] = useState(null);
  const pick = (id) => { const r = kind.roles.find((x) => x.id === id); setRoleId(id); setLevels(fromRole(r)); };
  const weights = Object.fromEntries(Object.entries(levels).filter(([, v]) => v).map(([k, v]) => [k, kind.lower(k) ? -v : v]));
  const stats = kind.stats.filter(([k]) => !['thrust', 'weight'].includes(k));
  return (
    <div className="custom-goal">
      <p className="note">Start from a role (it sets the {kind.noun} and what the design must carry), then change any priority. The search is the same exact one the roles use.</p>
      <label className="field-inline">Start from
        <select value={roleId} onChange={(e) => pick(e.target.value)}>
          {kind.roles.map((r) => <option key={r.id} value={r.id}>{r.group} · {r.name}</option>)}
        </select>
      </label>
      <div className="goal-sliders">
        {stats.map(([k, label]) => (
          <label className="slider" key={k}>
            <span className="slider-name">{kind.lower(k) ? `Keep ${label.toLowerCase()} low` : label}</span>
            <output>{levels[k] || 0}</output>
            <input type="range" min="0" max="10" step="1" value={levels[k] || 0} onChange={(e) => setLevels((x) => ({ ...x, [k]: Number(e.target.value) }))} />
          </label>
        ))}
      </div>
      <button type="button" disabled={!Object.keys(weights).length} onClick={() => setAsked({ roleId, weights })}>Design it</button>
      {asked && (
        <div className="card-grid">
          <DesignCard kind={kind} role={kind.roles.find((r) => r.id === asked.roleId)} year={year} request={request} weights={asked.weights} title={`Your ${kind.roles.find((r) => r.id === asked.roleId).name.toLowerCase()}`} />
        </div>
      )}
    </div>
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
