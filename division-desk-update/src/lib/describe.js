/** Plain-language summaries of techs, doctrines and tank designs for the UI. */
import { FRAC_KEYS } from './game.js';

const STAT_LABEL = {
  sa: 'soft attack', ha: 'hard attack', def: 'defense', brk: 'breakthrough', pier: 'piercing', air: 'air attack',
  arm: 'armor', hard: 'hardness', spd: 'speed', sup: 'supply use', org: 'organization', hp: 'hit points',
  rec: 'recovery', recon: 'recon', width: 'combat width',
};

export function targetLabel(game, target) {
  const u = game.units.get(target);
  if (u) return u.name;
  return target.replace(/^category_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function describeStats(stats) {
  return Object.entries(stats).filter(([k]) => STAT_LABEL[k]).map(([k, v]) => {
    const frac = FRAC_KEYS.includes(k);
    const n = frac ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
    return `${n > 0 ? '+' : ''}${n}${frac ? '%' : ''} ${STAT_LABEL[k]}`;
  }).join(', ');
}

export function describeMods(game, mods, limit = 3) {
  const lines = mods.map((m) => `${targetLabel(game, m.target)}: ${describeStats(m.stats)}`);
  return lines.length > limit ? [...lines.slice(0, limit), `and ${lines.length - limit} more`] : lines;
}

/** What researching this tech gives you. */
export function describeTech(game, t) {
  const out = [];
  const units = t.unlocks.units.map((id) => game.units.get(id)).filter(Boolean);
  if (units.length) out.push(`Unlocks ${units.map((u) => u.name).join(', ')}`);
  const eq = t.unlocks.equipment.filter((id) => /_\d$|^gw_/.test(id));
  if (eq.length) out.push('New equipment');
  const modules = t.unlocks.modules.map((id) => game.raw.modules[id]).filter(Boolean);
  if (modules.length) out.push(`Tank parts: ${modules.slice(0, 3).map((m) => m.name).join(', ')}${modules.length > 3 ? ` and ${modules.length - 3} more` : ''}`);
  out.push(...describeMods(game, t.mods));
  return out;
}

export function describeReward(game, r) {
  const lines = describeMods(game, r.mods, 2);
  if (r.extra && r.extra.additional_brigade_column_size) lines.push(`Columns hold ${5 + r.extra.additional_brigade_column_size} battalions`);
  return lines;
}

/** Tank design as readable rows: slot -> module name. */
export function describeDesign(game, d) {
  const slotLabel = (s) => s.replace(/_slot(_\d+)?$/, '').replace(/_type$/, '').replace(/_/g, ' ');
  return Object.entries(d.modules).filter(([, id]) => id && game.raw.modules[id]).map(([slot, id]) => ({ slot: slotLabel(slot), name: game.raw.modules[id].name }));
}
