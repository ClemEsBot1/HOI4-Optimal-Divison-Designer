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
    id: 'line', name: 'Line infantry', blurb: 'Sturdy, affordable divisions that hold and grind.',
    weights: { sa: 5, def: 8, org: 6, hp: 6, ic: 4, mp: 2, engineer: 7, logistics: 2, recon: 2 },
    constraints: { wmin: 20, wmax: 20, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'wall', name: 'Defensive wall', blurb: 'As much defense and staying power as the cost allows.',
    weights: { def: 10, hp: 7, org: 6, rec: 3, ic: 6, sup: 2, engineer: 9, logistics: 5, maintenance: 2 },
    constraints: { wmin: 20, wmax: 20, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'spear', name: 'Breakthrough spearhead', blurb: 'Mobile divisions that punch through and keep going.',
    weights: { brk: 9, org: 6, spd: 6, sa: 4, ha: 3, arm: 3, recon: 5, engineer: 5, logistics: 7, maintenance: 6, signal: 4 },
    constraints: { wmin: 20, wmax: 32, minOrg: 10, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'grinder', name: 'Attrition grinder', blurb: 'The most soft attack for the money.',
    weights: { sa: 9, ic: 7, org: 4, hp: 3, engineer: 4, logistics: 5 },
    constraints: { wmin: 20, wmax: 20, minOrg: 0, minArm: 0, maxIc: 0, perWidth: true },
  },
  {
    id: 'armor', name: 'Armored punch', blurb: 'Tanks first: breakthrough, hard attack and armor.',
    weights: { brk: 8, arm: 6, ha: 5, spd: 5, org: 3, ic: 2, engineer: 4, logistics: 8, maintenance: 8, signal: 5, recon: 4 },
    constraints: { wmin: 24, wmax: 32, minOrg: 8, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'hunter', name: 'Tank hunter', blurb: 'Piercing and hard attack to kill armor.',
    weights: { ha: 8, pier: 9, arm: 5, brk: 3, spd: 3, ic: 3, engineer: 4, logistics: 6, maintenance: 6 },
    constraints: { wmin: 20, wmax: 32, minOrg: 8, minArm: 0, maxIc: 0, perWidth: false },
  },
  {
    id: 'mass', name: 'Cheap mass', blurb: 'High-organization infantry that is cheap to field and reinforce.',
    weights: { def: 6, ic: 8, mp: 7, sa: 2, hp: 3, org: 9, engineer: 5, logistics: 3 },
    constraints: { wmin: 10, wmax: 20, minOrg: 45, minArm: 0, maxIc: 0, perWidth: true },
  },
];

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
