/**
 * Ship designs by role, from the ship designer data in src/data/designers.json.
 *
 *   shipStats(data, variant, modules, year)    final stats of one design
 *   bestShip(data, roleId, year)               exhaustive search for the best design of a role
 *
 * Stat model (Man the Guns ship designer):
 *   stat = (hull + sum of module additions + average of the modules' averaged stats) * (1 + module multipliers)
 *          * (1 + bonuses from researched technologies for the ship type)
 * The ship type (destroyer, light or heavy cruiser, battleship, battlecruiser, carrier, submarine) follows from the
 * hull and, for cruisers and capitals, from the main battery or armor fitted.
 */

import { exactDesign, moduleStats } from './designSearch.js';

const LOWER_IS_BETTER = new Set(['build_cost_ic', 'surface_visibility', 'sub_visibility', 'fuel_consumption']);

export const SHIP_STATS = [
  ['lg_attack', 'Light attack'], ['lg_armor_piercing', 'Light piercing'], ['hg_attack', 'Heavy attack'], ['hg_armor_piercing', 'Heavy piercing'],
  ['torpedo_attack', 'Torpedo attack'], ['sub_attack', 'Anti-submarine attack'], ['anti_air_attack', 'Anti-air attack'],
  ['armor_value', 'Armor'], ['max_strength', 'Hit points'], ['naval_speed', 'Speed (kn)'], ['reliability', 'Reliability'],
  ['naval_range', 'Range (km)'], ['surface_detection', 'Surface detection'], ['sub_detection', 'Sub detection'],
  ['surface_visibility', 'Surface visibility'], ['sub_visibility', 'Sub visibility'], ['mines_planting', 'Mine laying'],
  ['mines_sweeping', 'Mine sweeping'], ['carrier_size', 'Air wings (deck)'], ['build_cost_ic', 'Production cost'],
];

// guns a light cruiser can carry without becoming a heavy cruiser
const LIGHT_GUNS = /^(ship_light_battery|dp_light_battery|ship_light_medium_battery)/;

/**
 * Roles: which hull, what the design is scored on (weight * ln(stat + floor), costs and visibility negative) and
 * what it must carry. Weights follow the common competitive use of each role.
 */
export const SHIP_ROLES = [
  { id: 'dd_screen', group: 'Destroyers', name: 'Screen destroyer', hull: 'ship_hull_light',
    blurb: 'Cheap, fast screens that keep the battle line\'s screening ratio up. Spend nothing that does not help them survive.',
    weights: { naval_speed: 6, max_strength: 3, anti_air_attack: 1, sub_attack: 1, build_cost_ic: -8 } },
  { id: 'dd_asw', group: 'Destroyers', name: 'Anti-submarine destroyer', hull: 'ship_hull_light',
    blurb: 'Convoy escort and submarine hunter: depth charges and sonar first, then speed.',
    weights: { sub_attack: 8, sub_detection: 6, naval_speed: 2, build_cost_ic: -4 }, require: ['ship_depth_charge', 'ship_sonar'] },
  { id: 'dd_torpedo', group: 'Destroyers', name: 'Torpedo destroyer', hull: 'ship_hull_light',
    blurb: 'Hits capital ships with torpedoes from the screen line. Low visibility helps it close in.',
    weights: { torpedo_attack: 8, naval_speed: 3, surface_visibility: -2, build_cost_ic: -3 }, require: ['ship_torpedo'] },
  { id: 'dd_aa', group: 'Destroyers', name: 'Anti-air destroyer', hull: 'ship_hull_light',
    blurb: 'Protects the fleet from naval bombers; fleet anti-air stacks with every ship in the task force.',
    weights: { anti_air_attack: 8, naval_speed: 2, max_strength: 1, build_cost_ic: -3 }, require: ['ship_anti_air'] },
  { id: 'dd_minelayer', group: 'Destroyers', name: 'Minelayer', hull: 'ship_hull_light',
    blurb: 'Lays defensive minefields in your own sea zones.',
    weights: { mines_planting: 8, naval_speed: 2, build_cost_ic: -3 }, require: ['ship_mine_layer'] },
  { id: 'dd_minesweeper', group: 'Destroyers', name: 'Minesweeper', hull: 'ship_hull_light',
    blurb: 'Clears enemy minefields ahead of invasions and convoy routes.',
    weights: { mines_sweeping: 8, naval_speed: 1, build_cost_ic: -3 }, require: ['ship_mine_warfare'] },

  { id: 'cl_light_attack', group: 'Cruisers', name: 'Light attack cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'The usual backbone of a surface fleet: every slot that can take a light battery takes one, with armor and fire control.',
    weights: { lg_attack: 8, lg_armor_piercing: 4, armor_value: 3, max_strength: 3, naval_speed: 3, anti_air_attack: 1, build_cost_ic: -5 } },
  { id: 'cl_aa', group: 'Cruisers', name: 'Anti-air cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'A light cruiser built around anti-air guns to cover carriers and the battle line.',
    weights: { anti_air_attack: 8, lg_attack: 2, naval_speed: 2, max_strength: 1, build_cost_ic: -3 }, require: ['ship_anti_air'] },
  { id: 'cl_torpedo', group: 'Cruisers', name: 'Torpedo cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'Light cruiser hull with torpedo tubes in the custom slots.',
    weights: { torpedo_attack: 8, lg_attack: 2, naval_speed: 3, build_cost_ic: -3 }, require: ['ship_torpedo'] },
  { id: 'ca_heavy_attack', group: 'Cruisers', name: 'Heavy cruiser', hull: 'ship_hull_cruiser', needBattery: /^ship_medium_battery_/, type: 'heavy_cruiser',
    blurb: 'Heavy cruiser batteries give heavy attack and piercing, which makes it a capital ship in combat.',
    weights: { hg_attack: 8, hg_armor_piercing: 4, armor_value: 4, max_strength: 3, naval_speed: 2, lg_attack: 1, build_cost_ic: -4 } },
  { id: 'cl_minelayer', group: 'Cruisers', name: 'Minelaying cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'Lays more mines per ship than a destroyer and survives better while doing it.',
    weights: { mines_planting: 8, naval_speed: 2, build_cost_ic: -3 }, require: ['ship_mine_layer'] },

  { id: 'bb', group: 'Capital ships', name: 'Battleship', hull: 'ship_hull_heavy', armor: 'bb', type: 'battleship',
    blurb: 'Heavy batteries, the thickest armor and the most hit points: the core of the battle line.',
    weights: { hg_attack: 8, hg_armor_piercing: 3, armor_value: 6, max_strength: 5, naval_speed: 1, anti_air_attack: 1, build_cost_ic: -4 } },
  { id: 'bc', group: 'Capital ships', name: 'Battlecruiser', hull: 'ship_hull_heavy', armor: 'bc', type: 'battle_cruiser',
    blurb: 'Battleship guns on a faster, lighter hull: keeps up with carriers and cruisers.',
    weights: { hg_attack: 7, naval_speed: 6, armor_value: 3, max_strength: 3, build_cost_ic: -4 } },
  { id: 'shbb', group: 'Capital ships', name: 'Super-heavy battleship', hull: 'ship_hull_heavy', superHeavy: true,
    blurb: 'The largest guns and armor in the game, at a price only a major industry can pay.',
    weights: { hg_attack: 8, hg_armor_piercing: 3, armor_value: 6, max_strength: 5, anti_air_attack: 1, build_cost_ic: -3 } },

  { id: 'cv', group: 'Carriers', name: 'Fleet carrier', hull: 'ship_hull_carrier', standardOnly: true,
    blurb: 'As many air wings as the hull takes, with anti-air and speed. Its planes do the fighting.',
    weights: { carrier_size: 10, anti_air_attack: 2, naval_speed: 3, max_strength: 2, build_cost_ic: -3 } },
  { id: 'cv_armored', group: 'Carriers', name: 'Armored carrier', hull: 'ship_hull_carrier', standardOnly: true,
    blurb: 'Gives up some deck space for an armored deck, so it survives bombing.',
    weights: { carrier_size: 6, max_strength: 4, armor_value: 3, anti_air_attack: 2, build_cost_ic: -3 }, require: ['ship_carrier_armor'] },

  { id: 'ss_raider', group: 'Submarines', name: 'Convoy raider', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'Torpedoes and low visibility for sinking convoys; range lets it reach the shipping lanes.',
    weights: { torpedo_attack: 6, sub_visibility: -8, naval_range: 3, naval_speed: 2, build_cost_ic: -5 } },
  { id: 'ss_minelayer', group: 'Submarines', name: 'Minelaying submarine', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'Lays mines in enemy waters where surface minelayers could not survive.',
    weights: { mines_planting: 8, sub_visibility: -4, naval_range: 2, build_cost_ic: -3 }, require: ['ship_mine_layer_sub'] },
  { id: 'ss_cruiser', group: 'Submarines', name: 'Long-range submarine', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'For distant oceans: range first, then torpedoes and stealth.',
    weights: { naval_range: 6, torpedo_attack: 3, sub_visibility: -4, build_cost_ic: -3 } },
];

export const FLOOR = { reliability: 0.05, naval_speed: 1, build_cost_ic: 50, naval_range: 100 };

const STANDARD_HULL = /^ship_hull_(light|cruiser|heavy|carrier|submarine)_\d$/;

/** Hull variants a role can use in a year: the standard line, plus the super-heavy hull for that role. */
export function hullsFor(data, role, year) {
  const d = data.designers[role.hull];
  if (!d) return [];
  return d.variants.filter((v) => {
    if (v.year > year) return false;
    if (role.superHeavy) return /super_heavy/.test(v.id);
    if (/super_heavy/.test(v.id)) return false;
    return STANDARD_HULL.test(v.id);
  });
}

export function shipType(hull, modules) {
  if (hull.startsWith('ship_hull_light')) return 'destroyer';
  if (hull.startsWith('ship_hull_cruiser')) return Object.values(modules).some((id) => /^ship_medium_battery_/.test(id || '')) ? 'heavy_cruiser' : 'light_cruiser';
  if (/super_heavy/.test(hull)) return 'super_heavy_battleship';
  if (hull.startsWith('ship_hull_heavy')) return Object.values(modules).some((id) => /armor_bc/.test(id || '')) ? 'battle_cruiser' : 'battleship';
  if (hull.startsWith('ship_hull_carrier')) return 'carrier';
  if (hull.startsWith('ship_hull_submarine')) return 'submarine';
  return null;
}

export function typeBonuses(data, type, year) {
  const out = {};
  for (const m of data.typeMods || []) {
    if (m.year > year || m.type !== type) continue;
    for (const [k, v] of Object.entries(m.stats)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

export function shipStats(data, variant, modules, year) {
  const s = moduleStats(data.modules, variant.stats, modules);
  const type = shipType(variant.id, modules);
  for (const [k, v] of Object.entries(typeBonuses(data, type, year))) if (k in s) s[k] *= 1 + v;
  if (s.reliability != null) s.reliability = Math.max(0, Math.min(1, s.reliability));
  s.type = type;
  return s;
}

/**
 * Exact search for one role (see designSearch.js): every legal module combination on every hull the role can use is
 * either scored or ruled out by a bound, so the answer is proven best. minStats ({ naval_speed: 28 }) only accepts
 * designs that reach those values, such as a fleet's speed floor.
 */
export function bestShip(data, role, year, { budget = 6e5, gap = 0, weights = role.weights, keep = 1, minStats } = {}) {
  const allowed = (m) => !(role.batteryOk && /battery/.test(m.cat) && !role.batteryOk.test(m.id));
  const reqCats = role.require || [];
  const res = exactDesign({
    // one tangent point per node: on ship hulls extra rounds barely cut the nodes and cost a full bound each
    modules: data.modules, weights, floor: FLOOR, budget, gap, keep, minStats, tangentRounds: 0,
    hulls: [...hullsFor(data, role, year)].sort((x, y) => y.year - x.year),
    slotOptions: (hull, n, slot) => {
      let mods = Object.values(data.modules).filter((m) => slot.cats.includes(m.cat) && m.year <= year).filter(allowed);
      if (role.armor) mods = mods.filter((m) => m.cat !== 'ship_heavy_armor' || new RegExp(`armor_${role.armor}_`).test(m.id));
      return mods;
    },
    typesOf: (hull) => (hull.id.startsWith('ship_hull_cruiser') ? ['light_cruiser', 'heavy_cruiser'] : hull.id.startsWith('ship_hull_heavy') && !/super/.test(hull.id) ? ['battleship', 'battle_cruiser'] : [shipType(hull.id, {})]),
    typeOf: (hull, chosen) => shipType(hull.id, chosen),
    bonusOf: (type) => typeBonuses(data, type, year),
    stats: (hull, mods) => shipStats(data, hull, mods, year),
    accept: (hull, chosen, type) => {
      for (const c of reqCats) if (!chosen.some((id) => id && data.modules[id].cat === c)) return false;
      if (role.needBattery && !chosen.some((id) => id && role.needBattery.test(id))) return false;
      return !(role.type && type !== role.type);
    },
  });
  return res ? { ...res, role: role.id } : null;
}

export const isLowerBetter = (k) => LOWER_IS_BETTER.has(k);
