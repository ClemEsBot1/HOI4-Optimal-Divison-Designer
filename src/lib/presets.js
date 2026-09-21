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
    constraints: { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'offensive_infantry', name: 'Offensive Infantry', blurb: 'Infantry with enough soft attack to push when tanks are scarce.',
    weights: { sa: 9, def: 6, brk: 5, org: 8, hp: 6, ic: 4, engineer: 7, logistics: 2, recon: 2 },
    constraints: { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'armor', name: 'Armoured division', blurb: 'More than half armoured battalions, with the soft attack to break a line.',
    weights: { sa: 9, brk: 9, arm: 7, ha: 6, spd: 5, org: 5, ic: 2, engineer: 5, logistics: 8, maintenance: 8, signal: 5, recon: 4 },
    constraints: { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, minArmorShare: 0.51, maxIc: 0, perWidth: false },
  },
  {
    id: 'hunter', name: 'Tank Hunter', blurb: 'Anti-armour infantry for multiplayer: piercing and hard attack first.',
    weights: { pier: 10, ha: 10, def: 6, org: 8, ic: 5, sa: 3, engineer: 6, logistics: 3 },
    constraints: { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'space_marines', name: 'Space marines', blurb: 'Infantry backed by a small armoured component to raise armor and punch.',
    weights: { sa: 8, arm: 9, def: 7, org: 8, brk: 4, ic: 5, ha: 4, engineer: 7, logistics: 4, maintenance: 3 },
    constraints: { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, minArmorBattalions: 1, maxArmorBattalions: 2, maxArmorShare: 0.5, maxIc: 0, perWidth: false },
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

/**
 * Units left out of templates unless the player switches them on: the special forces units (marines, paratroopers,
 * mountaineers, rangers, amtracs, amphibious tanks) need specific conditions to be useful, and cavalry is obsolete.
 */
export function defaultExclude(game) {
  return [...game.units.values()].filter((u) => u.special || u.id === 'cavalry').map((u) => u.id);
}
