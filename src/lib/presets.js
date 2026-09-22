/**
 * Role presets, tech presets and helpers that need the game data.
 * Weights use the same keys as the priority sliders (see STATS in stats.js). 0 ignores a stat, 10 matters most.
 * Every stat is compared by percentage change, so a weight of 6 on soft attack and 3 on cost means
 * "a 10% gain in soft attack is worth a 20% saving in cost".
 */
import { STAT_KEYS } from './stats.js';
import { techsUpTo } from './game.js';

export const ZERO_WEIGHTS = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));

export const ROLES = [
  {
    id: 'line', name: 'Line infantry', blurb: 'Mostly defensive infantry: organization, defense and staying power.',
    weights: { def: 10, org: 9, hp: 7, ic: 7, sa: 3, mp: 3, engineer: 8, logistics: 2 },
    constraints: { wmin: 16, wmax: 20, minOrg: 45, minArm: 0, orgTarget: 52, orgCeiling: 65, maxIc: 5000, perWidth: false },
  },
  {
    id: 'offensive_infantry', name: 'Offensive Infantry', blurb: 'Infantry with enough soft attack to push when tanks are scarce.',
    weights: { sa: 9, def: 6, brk: 5, org: 8, hp: 6, ic: 8, engineer: 7, logistics: 2, recon: 2 },
    // Capped at a mass-producible infantry cost and a minority mobile share so the search stays with an
    // infantry-plus-support-artillery build (the classic "7 infantry + 2 artillery" shape) instead of drifting
    // into an all-mechanized division that is really the Armoured or Space marines role wearing an infantry label.
    constraints: { wmin: 18, wmax: 27, minOrg: 40, minArm: 0, orgTarget: 45, orgCeiling: 60, maxMobileShare: 0.35, maxIc: 3200, perWidth: false },
  },
  {
    id: 'armor', name: 'Armoured division', blurb: 'More than half armoured battalions, with the soft attack to break a line.',
    weights: { sa: 10, brk: 8, arm: 5, ha: 4, spd: 5, org: 10, ic: 8, engineer: 5, logistics: 7, maintenance: 7, signal: 4, recon: 3 },
    constraints: { wmin: 30, wmax: 36, minOrg: 32, minArm: 0, orgTarget: 36, orgCeiling: 48, minArmorShare: 0.51, maxArmorShare: 0.78, minMobileShare: 0.20, maxIc: 15000, perWidth: false },
  },
  {
    id: 'hunter', name: 'Tank Hunter', blurb: 'Anti-armour infantry for multiplayer: piercing and hard attack first.',
    weights: { pier: 10, ha: 10, def: 6, org: 8, ic: 5, sa: 3, engineer: 6, logistics: 3 },
    constraints: { wmin: 18, wmax: 24, minOrg: 38, minArm: 0, orgTarget: 45, orgCeiling: 60, maxIc: 10000, perWidth: false },
  },
  {
    id: 'space_marines', name: 'Space marines', blurb: 'Infantry backed by a small armoured component to raise armor and punch.',
    weights: { sa: 8, arm: 9, def: 7, org: 8, brk: 4, ic: 5, ha: 4, engineer: 7, logistics: 4, maintenance: 3 },
    constraints: { wmin: 18, wmax: 27, minOrg: 38, minArm: 0, orgTarget: 42, orgCeiling: 58, minArmorBattalions: 1, maxArmorBattalions: 2, maxArmorShare: 0.5, maxIc: 12000, perWidth: false },
  },
];

export const DOCTRINE_RECOMMENDATIONS = {
  line: [
    { names: ['Grand Battleplan', 'Mass Mobilization'], why: 'Best fit for entrenchment, defense and holding a front.' },
    { names: ['Superior Firepower'], why: 'A strong alternative when support artillery and infantry firepower matter more.' },
  ],
  offensive_infantry: [
    { names: ['Superior Firepower'], why: 'The natural infantry-and-fire-support choice for soft attack.' },
    { names: ['Grand Battleplan'], why: 'Strong when planning bonus and prepared attacks are available.' },
  ],
  armor: [
    { names: ['Mobile Warfare'], why: 'The specialist choice for breakthrough, speed and armoured formations.' },
    { names: ['Superior Firepower'], why: 'A strong alternative when maximizing division firepower.' },
  ],
  hunter: [
    { names: ['Superior Firepower'], why: 'Improves the firepower of anti-tank-heavy infantry formations.' },
    { names: ['Grand Battleplan'], why: 'Useful for planned defensive multiplayer responses.' },
  ],
  space_marines: [
    { names: ['Grand Battleplan'], why: 'A common space-marine choice: planning, entrenchment and defensive value.' },
    { names: ['Superior Firepower'], why: 'Use it when the armoured infantry is intended to attack.' },
  ],
};

export function doctrineRecommendations(game, roleId) {
  return (DOCTRINE_RECOMMENDATIONS[roleId] || []).map((r) => ({
    ...r,
    doctrine: r.names.map((name) => [...game.grands.values()].find((g) => g.name === name)).find(Boolean),
  })).filter((r) => r.doctrine);
}

export const TECH_PRESETS = [
  { year: 1936, label: '1936 start' },
  { year: 1939, label: '1939' },
  { year: 1941, label: '1941' },
  { year: 1943, label: '1943' },
  { year: 1945, label: '1945' },
  { year: 9999, label: 'All research' },
];
export const DEFAULT_TECH_YEAR = 1945;

/** Researched set for a preset. "All research" also includes special-project techs. */
export function techPreset(game, year) {
  return techsUpTo(game, year, year >= 9999);
}
export function defaultTech(game) {
  return techPreset(game, DEFAULT_TECH_YEAR);
}
export const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Support and regimental companies built on the super-heavy tank chassis (a whole extra vehicle design squeezed
// into one company slot) cost several thousand IC apiece for a one-off stat add, with none of the width-scaling
// a normal battalion gets. Community tier lists rank them F ("often useless or just really bad") for exactly that
// reason, next to Motorized Military Police, so the optimizer should not reach for them unless asked to.
// https://stratemgames.space/en/hearts-of-iron-iv/clusters/everything-about-divisions/complete-division-guide/battalions-companies-and-support-regiments/support-company-tier-list-2026
const EXPENSIVE_SUPPORT = new Set(['motorized_military_police']);

/**
 * Units left out of templates unless the player switches them on: the special forces units (marines, paratroopers,
 * mountaineers, rangers, amtracs, amphibious tanks) need specific conditions to be useful, cavalry is obsolete, and
 * the super-heavy-chassis support/regimental companies are F-tier picks that are rarely worth their IC.
 */
export function defaultExclude(game) {
  return [...game.units.values()]
    .filter((u) => u.special || u.id === 'cavalry' || EXPENSIVE_SUPPORT.has(u.id)
      || ((u.role === 'div' || u.role === 'reg') && u.tank && u.tank.chassis === 'super_heavy_tank_chassis'))
    .map((u) => u.id);
}
