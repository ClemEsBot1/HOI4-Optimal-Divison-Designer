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
 *   - thrust left over adds agility: NAir.THRUST_WEIGHT_AGILITY_FACTOR (0.5 in 1.14) per point, read from the defines
 *     into designers.json `planeRules.thrustAgility`.
 * and, from 1.14, mission-dependent module stats: a torpedo adds naval attack (and its weight) only on naval strikes,
 * a bomb bay adds ground attack on CAS missions and strategic bombing on bombing runs. Each role names the mission it
 * is designed for (`mission`), and optionally secondary missions whose output stats also count (`also`, the
 * tactical bomber's bombing runs). The weight, agility and cost of a module are those of the primary mission.
 * On naval strikes only torpedo-class weapons count (NAir.USE_SINGLE_NAVAL_ARMAMENT_CATEGORY: the armament category
 * that deals the most naval damage is the only one that contributes).
 * Because only legal designs are scored, the excess-thrust agility is a sum over modules (thrust minus weight), so the
 * exact search in designSearch.js applies unchanged with each module's agility raised by its share.
 */
import { exactDesign, moduleStats } from './designSearch.js';

/** Agility per point of thrust above weight: NAir.THRUST_WEIGHT_AGILITY_FACTOR in the 1.14 defines. */
export const EXCESS_THRUST_AGILITY = 0.5;
export const thrustAgility = (data) => data.planeRules?.thrustAgility ?? EXCESS_THRUST_AGILITY;

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
  { id: 'fighter', mission: 'air_superiority', group: 'Air superiority', name: 'Fighter', frame: /^small_plane_airframe/, main: /fighter/,
    blurb: 'Wins the air: air superiority and escort. Attack and agility decide dogfights; cost decides how many you field.',
    weights: { air_attack: 8, air_agility: 5, maximum_speed: 4, air_defence: 2, air_range: 1, reliability: 1, build_cost_ic: -5 } },
  { id: 'interceptor', mission: 'interception', group: 'Air superiority', name: 'Interceptor', frame: /^small_plane_airframe/, main: /fighter/,
    blurb: 'Defends your own skies against bombers: firepower and speed, range does not matter.',
    weights: { air_attack: 8, maximum_speed: 6, air_agility: 3, air_defence: 2, build_cost_ic: -5 } },
  { id: 'heavy_fighter', mission: 'air_superiority', group: 'Air superiority', name: 'Heavy fighter', frame: /^medium_plane_(fighter_)?airframe/, main: /fighter/,
    blurb: 'Long-range escort and air superiority where small fighters cannot reach.',
    weights: { air_attack: 7, air_range: 5, air_defence: 4, air_agility: 2, maximum_speed: 2, build_cost_ic: -5 } },
  { id: 'cas', mission: 'cas', group: 'Ground support', name: 'Close air support', frame: /^small_plane_(cas_)?airframe/, main: /cas/,
    blurb: 'Attacks enemy divisions in battle. Defense keeps it alive over anti-air.',
    weights: { air_ground_attack: 8, air_defence: 4, air_agility: 1, maximum_speed: 1, air_range: 1, reliability: 1, build_cost_ic: -5 } },
  { id: 'tac', mission: 'cas', also: ['strategic_bomber'], group: 'Ground support', name: 'Tactical bomber', frame: /^medium_plane_airframe/, main: /tac/,
    blurb: 'A generalist: ground support, logistics strikes and light strategic bombing in one design.',
    weights: { air_ground_attack: 5, air_bombing: 4, air_defence: 4, air_range: 2, build_cost_ic: -5 } },
  { id: 'naval_bomber', mission: 'naval_bomber', group: 'Naval', name: 'Naval bomber', frame: /^small_plane_(naval_bomber_)?airframe/, main: /nav/,
    blurb: 'Sinks ships from land bases: naval attack and targeting first.',
    weights: { naval_strike_attack: 8, naval_strike_targetting: 5, air_defence: 2, air_range: 2, build_cost_ic: -5 } },
  { id: 'medium_naval', mission: 'naval_bomber', group: 'Naval', name: 'Medium naval bomber', frame: /^medium_plane_airframe/, main: /tac/,
    blurb: 'Longer-range naval strikes with more payload per plane, torpedoes in the auxiliary slots.',
    weights: { naval_strike_attack: 7, naval_strike_targetting: 4, air_range: 4, air_defence: 3, build_cost_ic: -5 } },
  { id: 'patrol', mission: 'naval_patrol', group: 'Naval', name: 'Maritime patrol', frame: /^large_plane_airframe/, main: /nav/,
    blurb: 'Finds fleets and submarines for your navy and bombers, and hunts submarines; range and detection first.',
    weights: { surface_detection: 6, sub_detection: 4, air_range: 6, naval_strike_attack: 2, air_defence: 2, build_cost_ic: -4 } },
  { id: 'strategic', mission: 'strategic_bomber', group: 'Strategic', name: 'Strategic bomber', frame: /^large_plane_airframe/, main: /strat/,
    blurb: 'Destroys industry far behind the front. Unescorted bombers die, so defense matters as much as bombs.',
    weights: { air_bombing: 8, air_defence: 5, air_range: 3, build_cost_ic: -5 } },
  { id: 'cv_fighter', mission: 'air_superiority', group: 'Carrier', name: 'Carrier fighter', frame: /^cv_small_plane_airframe/, main: /fighter/,
    blurb: 'Protects the carrier fleet; deck space is limited, so every wing has to count.',
    weights: { air_attack: 8, air_agility: 5, maximum_speed: 3, air_defence: 2, build_cost_ic: -4 } },
  { id: 'cv_naval', mission: 'naval_bomber', group: 'Carrier', name: 'Carrier naval bomber', frame: /^cv_small_plane_airframe/, main: /nav/,
    blurb: 'The carrier fleet\'s strike arm against enemy ships.',
    weights: { naval_strike_attack: 8, naval_strike_targetting: 5, air_defence: 2, build_cost_ic: -4 } },
  { id: 'cv_cas', mission: 'cas', group: 'Carrier', name: 'Carrier CAS', frame: /^cv_small_plane_airframe/, main: /cas/,
    blurb: 'Supports naval invasions and coastal battles from the carrier.',
    weights: { air_ground_attack: 8, air_defence: 4, build_cost_ic: -4 } },
  { id: 'jet_fighter', mission: 'air_superiority', group: 'Late war', name: 'Jet fighter', frame: /^small_plane_airframe/, main: /fighter/, engine: /jet/,
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
  const m = mainId ? data.modules[mainId] : null;
  const own = (m?.types || []).find((x) => allowed.includes(x));
  if (own) return own;
  const cat = m?.cat || '';
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

// the excess-thrust agility folded into each module and airframe: (thrust - weight) * thrustAgility(data)
const fold = (add, k) => {
  const net = (add.thrust || 0) - (add.weight || 0);
  return net && k ? { ...add, air_agility: (add.air_agility || 0) + k * net } : add;
};
const NAVAL_MISSIONS = new Set(['naval_bomber', 'port_strike']);
const NAVAL_STATS = ['naval_strike_attack', 'naval_strike_targetting'];
// stats a secondary mission contributes: what the mission produces, not what flying it costs
const SIDE_COSTS = new Set(['weight', 'air_agility', 'build_cost_ic', 'fuel_consumption', 'maximum_speed', 'air_range', 'reliability']);
const addInto = (to, from, only) => { for (const [k, v] of Object.entries(from || {})) if (!only || only(k)) to[k] = (to[k] || 0) + v; };

/**
 * A module's stats on one mission: its base stats plus every mission block that names the mission, plus the output
 * stats of the `also` missions. On naval strikes, naval attack and targeting come only from torpedo-class weapons.
 */
export function moduleOnMission(m, mission, also = []) {
  if (!m.missions && !NAVAL_MISSIONS.has(mission)) return m;
  const add = { ...m.add }; const mul = { ...m.mul }; const avg = { ...m.avg };
  for (const b of m.missions || []) {
    if (b.on.includes(mission)) { addInto(add, b.add); addInto(mul, b.mul); addInto(avg, b.avg); continue; }
    if (also.some((x) => b.on.includes(x))) { const out = (k) => !SIDE_COSTS.has(k); addInto(add, b.add, out); addInto(mul, b.mul, out); addInto(avg, b.avg, out); }
  }
  if (NAVAL_MISSIONS.has(mission) && m.cat !== 'nav_bomber_weapon') for (const o of [add, avg]) for (const k of NAVAL_STATS) delete o[k];
  return { ...m, add, mul, avg };
}

// every module's stats on a role's mission, with the excess-thrust agility folded in
const roleCache = new WeakMap();
function roleModules(data, role) {
  if (!roleCache.has(data)) roleCache.set(data, new Map());
  const cache = roleCache.get(data);
  const key = `${role?.mission || ''}|${(role?.also || []).join(',')}`;
  if (!cache.has(key)) {
    const k = thrustAgility(data);
    cache.set(key, Object.fromEntries(Object.entries(data.modules).map(([id, m]) => {
      const x = role?.mission ? moduleOnMission(m, role.mission, role.also) : m;
      return [id, { ...x, add: fold(x.add, k) }];
    })));
  }
  return cache.get(key);
}

/**
 * Final stats of one design flown on `role`'s mission (base stats only when no role is given); `legal` says whether
 * thrust covers weight. Leftover thrust adds to the agility before the module and technology multipliers, like every
 * other added amount.
 */
export function planeStats(data, frame, modules, year, role) {
  const s = moduleStats(roleModules(data, role), fold(frame.stats, thrustAgility(data)), modules);
  const main = Object.entries(modules).find(([slot, id]) => id && MAIN_SLOT.test(slot))?.[1];
  const type = planeTypeOf(data, frame, main);
  for (const [k, v] of Object.entries(typeBonuses(data, type, year, frame.archetype))) if (k in s) s[k] *= 1 + v;
  s.legal = (s.thrust || 0) >= (s.weight || 0) - 1e-9;
  if (s.reliability != null) s.reliability = Math.max(0, Math.min(1, s.reliability));
  if (s.air_agility != null) s.air_agility = Math.max(0, s.air_agility);
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
  const modules = roleModules(data, role);
  const additive = !Object.values(modules).some((m) => m.mul.thrust || m.mul.weight);
  const hulls = frames.map((f) => ({ ...f, stats: fold(f.stats, thrustAgility(data)) }));
  const byId = Object.fromEntries(frames.map((f) => [f.id, f]));
  const mainSlot = (hull) => Object.keys(hull.slots || {}).find((n) => hull.slots[n] && MAIN_SLOT.test(n));
  const orderedSlots = (hull) => {
    const names = Object.keys(hull.slots).filter((n) => hull.slots[n]);
    return [...names.filter((n) => !SWAP.test(n)), ...names.filter((n) => SWAP.test(n))];
  };
  const res = exactDesign({
    modules, weights, floor: FLOOR, budget, gap, keep, hulls, dropUseless: true, keepSlot: MAIN_SLOT,
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
    stats: (hull, mods) => planeStats(data, byId[hull.id], mods, year, role),
    accept: (hull, chosen) => {
      if (!role.main) return true;
      const i = orderedSlots(hull).findIndex((n) => MAIN_SLOT.test(n));
      return i < 0 || (chosen[i] != null && role.main.test(modules[chosen[i]].cat));
    },
    acceptStats: (st) => st.legal,
  });
  if (!res) return null;
  const tag = (d) => ({ ...d, mission: role.mission });
  return { ...tag(res), ranked: res.ranked.map(tag), role: role.id };
}

export const MISSION_LABEL = {
  air_superiority: 'Air superiority', interception: 'Interception', cas: 'Close air support', naval_bomber: 'Naval strike',
  naval_patrol: 'Naval patrol', strategic_bomber: 'Strategic bombing', port_strike: 'Port strike', attack_logistics: 'Logistics strike',
};

export const isLowerBetter = (k) => LOWER_IS_BETTER.has(k);
