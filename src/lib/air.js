/**
 * Aircraft designs by role, from the aircraft designer data in src/data/designers.json (designers of kind 'plane').
 *
 *   planeStats(data, variant, modules, year)   final stats of one design
 *   bestPlane(data, role, year)                exact search for the best design of a role
 *   hasPlaneData(data)                         whether the extracted data includes the aircraft designer
 *
 * Stat model (By Blood Alone aircraft designer), the same as the ship designer's:
 *   stat = (airframe + module additions + average of averaged stats) * (1 + module multipliers)
 *          * (1 + technology bonuses for the plane's type)
 * plus the designer's two rules:
 *   - a design is legal only when the engines' thrust covers the weight of the airframe and every other module;
 *   - thrust left over adds EXCESS_THRUST_SPEED km/h of top speed per point.
 * Because only legal designs are scored, the excess-thrust speed is a sum over modules (thrust minus weight), so the
 * exact search in designSearch.js applies unchanged with each module's speed raised by its share.
 */
import { exactDesign, moduleStats } from './designSearch.js';

/** km/h of top speed per point of thrust above weight (community measurement; check against the game's defines). */
export const EXCESS_THRUST_SPEED = 3;

const LOWER_IS_BETTER = new Set(['build_cost_ic', 'fuel_consumption', 'weight']);

export const PLANE_STATS = [
  ['air_attack', 'Air attack'], ['air_defence', 'Defense'], ['air_agility', 'Agility'], ['maximum_speed', 'Speed (km/h)'],
  ['air_range', 'Range (km)'], ['air_ground_attack', 'Ground attack'], ['naval_strike_attack', 'Naval attack'],
  ['naval_strike_targetting', 'Naval targeting'], ['air_bombing', 'Strategic bombing'], ['surface_detection', 'Naval detection'],
  ['sub_detection', 'Sub detection'], ['air_superiority', 'Air superiority'], ['reliability', 'Reliability'],
  ['thrust', 'Thrust'], ['weight', 'Weight'], ['build_cost_ic', 'Production cost'], ['fuel_consumption', 'Fuel use'],
];

/**
 * Roles: which airframes (matched on the airframe's archetype id), what the main weapon and engine must be (matched on
 * the module category in that slot) and what the design is scored on. Weights follow common competitive use.
 */
export const PLANE_ROLES = [
  { id: 'fighter', group: 'Air superiority', name: 'Fighter', frame: /^small_plane_airframe/, main: /fighter/,
    blurb: 'Wins the air: air superiority and escort. Attack and agility decide dogfights; cost decides how many you field.',
    weights: { air_attack: 8, air_agility: 5, maximum_speed: 4, air_defence: 2, air_range: 1, reliability: 1, build_cost_ic: -5 } },
  { id: 'interceptor', group: 'Air superiority', name: 'Interceptor', frame: /^small_plane_airframe/, main: /fighter/,
    blurb: 'Defends your own skies against bombers: firepower and speed, range does not matter.',
    weights: { air_attack: 8, maximum_speed: 6, air_agility: 3, air_defence: 2, build_cost_ic: -5 } },
  { id: 'heavy_fighter', group: 'Air superiority', name: 'Heavy fighter', frame: /^medium_plane_(fighter_)?airframe/, main: /fighter/,
    blurb: 'Long-range escort and air superiority where small fighters cannot reach.',
    weights: { air_attack: 7, air_range: 5, air_defence: 4, air_agility: 2, maximum_speed: 2, build_cost_ic: -5 } },
  { id: 'cas', group: 'Ground support', name: 'Close air support', frame: /^small_plane_(cas_)?airframe/, main: /cas/,
    blurb: 'Attacks enemy divisions in battle. Defense keeps it alive over anti-air.',
    weights: { air_ground_attack: 8, air_defence: 4, air_agility: 1, maximum_speed: 1, reliability: 1, build_cost_ic: -5 } },
  { id: 'tac', group: 'Ground support', name: 'Tactical bomber', frame: /^medium_plane_airframe/, main: /tac/,
    blurb: 'A generalist: ground support, logistics strikes and light strategic bombing in one design.',
    weights: { air_ground_attack: 5, air_bombing: 4, air_defence: 4, air_range: 2, build_cost_ic: -5 } },
  { id: 'naval_bomber', group: 'Naval', name: 'Naval bomber', frame: /^small_plane_(naval_bomber_)?airframe/, main: /nav/,
    blurb: 'Sinks ships from land bases: naval attack and targeting first.',
    weights: { naval_strike_attack: 8, naval_strike_targetting: 5, air_defence: 2, air_range: 2, build_cost_ic: -5 } },
  { id: 'medium_naval', group: 'Naval', name: 'Medium naval bomber', frame: /^medium_plane_airframe/,
    blurb: 'Longer-range naval strikes with more payload per plane, torpedoes in the auxiliary slots.',
    weights: { naval_strike_attack: 7, naval_strike_targetting: 4, air_range: 4, air_defence: 3, build_cost_ic: -5 } },
  { id: 'patrol', group: 'Naval', name: 'Maritime patrol', frame: /^large_plane_airframe/, main: /nav/,
    blurb: 'Finds fleets and submarines for your navy and bombers, and hunts submarines; range and detection first.',
    weights: { surface_detection: 6, sub_detection: 4, air_range: 6, naval_strike_attack: 2, air_defence: 2, build_cost_ic: -4 } },
  { id: 'strategic', group: 'Strategic', name: 'Strategic bomber', frame: /^large_plane_airframe/, main: /strat/,
    blurb: 'Destroys industry far behind the front. Unescorted bombers die, so defense matters as much as bombs.',
    weights: { air_bombing: 8, air_defence: 5, air_range: 3, build_cost_ic: -5 } },
  { id: 'cv_fighter', group: 'Carrier', name: 'Carrier fighter', frame: /^cv_small_plane_airframe/, main: /fighter/,
    blurb: 'Protects the carrier fleet; deck space is limited, so every wing has to count.',
    weights: { air_attack: 8, air_agility: 5, maximum_speed: 3, air_defence: 2, build_cost_ic: -4 } },
  { id: 'cv_naval', group: 'Carrier', name: 'Carrier naval bomber', frame: /^cv_small_plane_airframe/, main: /nav/,
    blurb: 'The carrier fleet\'s strike arm against enemy ships.',
    weights: { naval_strike_attack: 8, naval_strike_targetting: 5, air_defence: 2, build_cost_ic: -4 } },
  { id: 'cv_cas', group: 'Carrier', name: 'Carrier CAS', frame: /^cv_small_plane_airframe/, main: /cas/,
    blurb: 'Supports naval invasions and coastal battles from the carrier.',
    weights: { air_ground_attack: 8, air_defence: 4, build_cost_ic: -4 } },
  { id: 'jet_fighter', group: 'Late war', name: 'Jet fighter', frame: /^small_plane_airframe/, main: /fighter/, engine: /jet/,
    blurb: 'Late-war air superiority on a jet engine: speed no piston fighter can match.',
    weights: { air_attack: 8, maximum_speed: 6, air_agility: 4, air_defence: 2, build_cost_ic: -5 } },
];

export const FLOOR = { reliability: 0.05, maximum_speed: 50, build_cost_ic: 5, air_range: 100, fuel_consumption: 0.1 };

const MAIN_SLOT = /main_weapon/;
// slots that take the same modules in any order
const SWAP = /special_type_slot|auxiliary_weapon_slot|custom/;
const ENGINE_SLOT = /engine/;

export const planeDesigners = (data) => Object.values(data.designers || {}).filter((d) => d.kind === 'plane');
export const hasPlaneData = (data) => planeDesigners(data).some((d) => d.variants.length);

/** Airframe variants a role can use in a year. */
export function framesFor(data, role, year) {
  return planeDesigners(data)
    .filter((d) => role.frame.test(d.id))
    .flatMap((d) => d.variants.map((v) => ({ ...v, archetype: d.id, allowedTypes: v.allowedTypes || d.allowedTypes || [], baseType: d.type })))
    .filter((v) => v.year <= year);
}

// which plane type a main weapon category makes, in order of preference, among the airframe's allowed types
const CAT_TYPES = [
  [/kamikaze|suicide/, ['suicide']],
  [/fighter/, ['fighter', 'heavy_fighter', 'interceptor']],
  [/cas/, ['cas']],
  [/tac/, ['tactical_bomber']],
  [/strat/, ['strategic_bomber']],
  [/nav|torpedo/, ['naval_bomber', 'maritime_patrol_plane', 'maritime_patrol']],
  [/recon|camera|scout/, ['scout_plane']],
];

function planeTypeOf(data, frame, mainId) {
  const allowed = frame.allowedTypes?.length ? frame.allowedTypes : [frame.baseType].filter(Boolean);
  const cat = mainId ? data.modules[mainId]?.cat || '' : '';
  for (const [re, types] of CAT_TYPES) {
    if (!re.test(cat)) continue;
    const t = types.find((x) => allowed.includes(x));
    if (t) return t;
  }
  return (Array.isArray(frame.baseType) ? frame.baseType[0] : frame.baseType) || allowed[0] || 'plane';
}

/** Technology bonuses for a plane type, plus those given to the airframe's archetype itself. */
export function typeBonuses(data, type, year, archetype) {
  const out = {};
  for (const m of data.typeMods || []) {
    if (m.year > year || (m.type !== type && m.type !== archetype)) continue;
    for (const [k, v] of Object.entries(m.stats)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

// the excess-thrust speed folded into each module and airframe: (thrust - weight) * EXCESS_THRUST_SPEED km/h
const foldCache = new WeakMap();
const fold = (add) => {
  const net = (add.thrust || 0) - (add.weight || 0);
  return net && EXCESS_THRUST_SPEED ? { ...add, maximum_speed: (add.maximum_speed || 0) + EXCESS_THRUST_SPEED * net } : add;
};
function folded(data) {
  if (!foldCache.has(data)) foldCache.set(data, Object.fromEntries(Object.entries(data.modules).map(([id, m]) => [id, { ...m, add: fold(m.add) }])));
  return foldCache.get(data);
}

/**
 * Final stats of one design; `legal` says whether thrust covers weight. Leftover thrust adds to the speed before the
 * module and technology multipliers, like every other added amount.
 */
export function planeStats(data, frame, modules, year) {
  const s = moduleStats(folded(data), fold(frame.stats), modules);
  const main = Object.entries(modules).find(([slot, id]) => id && MAIN_SLOT.test(slot))?.[1];
  const type = planeTypeOf(data, frame, main);
  for (const [k, v] of Object.entries(typeBonuses(data, type, year, frame.archetype))) if (k in s) s[k] *= 1 + v;
  s.legal = (s.thrust || 0) >= (s.weight || 0) - 1e-9;
  if (s.reliability != null) s.reliability = Math.max(0, Math.min(1, s.reliability));
  s.type = type;
  return s;
}

/**
 * Exact search for one role. Thrust >= weight is checked on every complete design and pruned slot by slot while no
 * module multiplies thrust or weight (true of the game's modules).
 */
export function bestPlane(data, role, year, { budget = 6e5, gap = 0, weights = role.weights, keep = 1 } = {}) {
  const frames = framesFor(data, role, year).sort((x, y) => y.year - x.year);
  if (!frames.length) return null;
  const modules = folded(data);
  const additive = !Object.values(data.modules).some((m) => m.mul.thrust || m.mul.weight);
  const hulls = frames.map((f) => ({ ...f, stats: fold(f.stats) }));
  const byId = Object.fromEntries(frames.map((f) => [f.id, f]));
  const mainSlot = (hull) => Object.keys(hull.slots || {}).find((n) => hull.slots[n] && MAIN_SLOT.test(n));
  const orderedSlots = (hull) => {
    const names = Object.keys(hull.slots).filter((n) => hull.slots[n]);
    return [...names.filter((n) => !SWAP.test(n)), ...names.filter((n) => SWAP.test(n))];
  };
  const res = exactDesign({
    modules, weights, floor: FLOOR, budget, gap, keep, hulls,
    atLeast: additive ? [['thrust', 'weight']] : [],
    slotOptions: (hull, n, slot) => Object.values(modules).filter((m) => slot.cats.includes(m.cat) && m.year <= year
      && !(role.main && n === mainSlot(hull) && !role.main.test(m.cat))
      && !(role.engine && ENGINE_SLOT.test(n) && !role.engine.test(m.cat))),
    typesOf: (hull) => {
      const n = mainSlot(hull);
      const mains = n ? Object.values(modules).filter((m) => hull.slots[n].cats.includes(m.cat)).map((m) => m.id) : [];
      return [...new Set([null, ...mains].map((id) => planeTypeOf(data, hull, id)))];
    },
    typeOf: (hull, chosen) => {
      const i = orderedSlots(hull).findIndex((n) => MAIN_SLOT.test(n));
      return planeTypeOf(data, hull, i >= 0 ? chosen[i] : null);
    },
    bonusOf: (type, hull) => typeBonuses(data, type, year, hull.archetype),
    interchangeable: SWAP,
    stats: (hull, mods) => planeStats(data, byId[hull.id], mods, year),
    accept: (hull, chosen) => {
      if (!role.main) return true;
      const i = orderedSlots(hull).findIndex((n) => MAIN_SLOT.test(n));
      return i < 0 || (chosen[i] != null && role.main.test(modules[chosen[i]].cat));
    },
    acceptStats: (st) => st.legal,
  });
  return res ? { ...res, role: role.id } : null;
}

export const isLowerBetter = (k) => LOWER_IS_BETTER.has(k);
