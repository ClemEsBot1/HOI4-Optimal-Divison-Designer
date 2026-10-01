/**
 * Tank designs by role for the Equipment section: for every role, the exhaustive module search (designSearch) on each
 * chassis that can fill it, with the role's own priorities. The highest score is the recommendation.
 */
import { autoDesign, unlocks } from './game.js';

export const TANK_ROLES = [
  {
    id: 'mbt', name: 'Main battle tank', unitRole: 'armor', chassis: ['medium_tank_chassis', 'modern_tank_chassis'],
    blurb: 'The workhorse of an armored division: soft attack and breakthrough to exploit, armor to shrug off infantry, enough speed to keep up.',
    objective: { sa: 3, ha: 2, brk: 3, arm: 3, pier: 2, def: 1, spd: 2, ic: 2, rel: 2 },
  },
  {
    id: 'breakthrough', name: 'Breakthrough tank', unitRole: 'armor', chassis: ['heavy_tank_chassis', 'super_heavy_tank_chassis'],
    blurb: 'Slow and expensive, but its armor makes enemy infantry nearly useless against it. Leads assaults on prepared lines.',
    objective: { brk: 4, arm: 5, ha: 2, sa: 2, def: 2, spd: 1, ic: 1, rel: 2 },
  },
  {
    id: 'light', name: 'Light / recon tank', unitRole: 'armor', chassis: ['light_tank_chassis'],
    blurb: 'Fast and cheap. Good early-war armor and recon, and the cheapest way to make a division count as armored.',
    objective: { spd: 4, sa: 2, brk: 2, arm: 1, rel: 3, ic: 3 },
  },
  {
    id: 'support', name: 'Infantry support tank', unitRole: 'armor', chassis: ['medium_tank_chassis', 'heavy_tank_chassis'],
    blurb: 'Armor per production cost above all: one or two of these raise a whole infantry division\'s armor above enemy piercing.',
    objective: { arm: 6, ic: 4, rel: 2, brk: 1 },
  },
  {
    id: 'td', name: 'Tank destroyer', unitRole: 'anti_tank', chassis: ['light_tank_chassis', 'medium_tank_chassis', 'heavy_tank_chassis', 'modern_tank_chassis'],
    blurb: 'Piercing and hard attack on a fixed casemate: kills enemy tanks and gives infantry divisions the piercing they lack.',
    objective: { ha: 3, pier: 5, arm: 3, def: 1, spd: 1, ic: 2, rel: 2 },
  },
  {
    id: 'spg', name: 'Self-propelled gun', unitRole: 'artillery', chassis: ['light_tank_chassis', 'medium_tank_chassis', 'heavy_tank_chassis', 'modern_tank_chassis'],
    blurb: 'Armored artillery that keeps pace with tanks and adds soft attack without lowering the division\'s armor much.',
    objective: { sa: 6, def: 1, arm: 1, spd: 1, ic: 2, rel: 2 },
  },
  {
    id: 'spaa', name: 'Self-propelled anti-air', unitRole: 'anti_air', chassis: ['light_tank_chassis', 'medium_tank_chassis', 'heavy_tank_chassis', 'modern_tank_chassis'],
    blurb: 'Protects armored columns from close air support; cheap chassis are usually enough.',
    objective: { air: 6, arm: 1, def: 1, spd: 1, ic: 2, rel: 2 },
  },
];

/** Every role's best design per chassis for this research. Heavy: call it from the worker. */
export function metaTanks(game, techs) {
  const techSet = techs instanceof Set ? techs : new Set(techs);
  const open = unlocks(game, techSet);
  return TANK_ROLES.map((r) => {
    const options = [];
    for (const chassis of r.chassis) {
      if (!game.raw.designers[chassis]) continue;
      const d = autoDesign(game, techSet, chassis, r.unitRole, r.objective, open);
      if (d) options.push({ chassis, chassisName: game.raw.designers[chassis].name || chassis, modules: d.modules, stats: d.stats, score: d.score });
    }
    options.sort((a, b) => b.score - a.score);
    return { id: r.id, options };
  });
}
