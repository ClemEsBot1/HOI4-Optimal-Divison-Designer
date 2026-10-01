/**
 * How a template is scored once it satisfies every limit.
 *
 * Each stat with a non-zero priority contributes  weight * ln(value + floor)  (costs contribute minus that), so the
 * score compares stats by percentage change: with soft attack at 6 and cost at 3, +10% soft attack is worth -20% cost,
 * whatever the division's size. The floors are fixed per stat (they only matter when a stat is near zero), so the
 * same setup always gives the same score and nothing is calibrated from random samples.
 *
 * Company perks (engineers, hospital, ...) add weight * PERK_VALUE when present, regimental companies add
 * weight * REG_VALUE each, and the two matchup stats are scored like any other stat when an opponent is set.
 * Limits are never part of the score: a template that breaks one is simply not a candidate.
 */
import { STATS } from './stats.js';
import { matchup } from './combat.js';
import { frontageFit } from './frontage.js';

export const FLOOR = {
  sa: 1, ha: 1, brk: 1, air: 1, pier: 1, def: 1, org: 1, rec: 0.05, hp: 1, arm: 1, hard: 1, rel: 1, spd: 0.5,
  ic: 10, mp: 100, sup: 0.05, trucks: 1, recon: 1, mAtk: 0.01, mDef: 0.01,
};
export const PERK_VALUE = 0.3;
export const REG_VALUE = 0.3;
// Stats that grow with the division. Scored per frontage, these are divided by width before scoring.
export const ADDITIVE = new Set(['sa', 'ha', 'brk', 'air', 'def', 'hp', 'ic', 'mp', 'sup', 'trucks', 'recon']);
const FIT_TABLE_MAX = 200;

/**
 * The scored terms for a set of priorities. kind: log (weight * dir * ln(v + floor)), perk (present or not),
 * count (linear in the count) or matchup (log of the matchup ratio, only with an opponent).
 */
export function objectiveTerms(weights, { perWidth = false, frontMix = null, metaWidths = null, metaPull = 0 } = {}, enemy = null) {
  const out = [];
  let fitWeight = 0; let combatWeight = 0; let anyWeight = 0;
  for (const s of STATS) {
    const w = weights[s.key] || 0;
    if (!w) continue;
    if (s.matchup && !enemy) continue;
    const kind = s.perk ? 'perk' : s.count ? 'count' : s.matchup ? 'matchup' : 'log';
    // a negative weight on a signed stat (hardness) means "prefer lower"
    const dir = s.dir * Math.sign(w);
    out.push({ key: s.key, label: s.label, w: Math.abs(w), dir, kind, perWidth: perWidth && ADDITIVE.has(s.key), floor: FLOOR[s.key] ?? 1 });
    if (perWidth && ADDITIVE.has(s.key) && dir > 0) fitWeight += Math.abs(w);
    if (ADDITIVE.has(s.key) && dir > 0) combatWeight += Math.abs(w);
    anyWeight += Math.abs(w);
  }
  /*
   * Scored per frontage, a division is worth what it brings per width times how much of a battle's width whole
   * divisions of its size can use: ln(stat / width * fit) = ln(stat / width) + ln(fit) for every stat that fights.
   * The fit terms of those stats are summed into one term, so a width that leaves a tenth of the frontage empty costs
   * as much as a tenth less of every combat stat.
   */
  if (perWidth && fitWeight > 0) {
    const theatre = frontMix ? { mix: frontMix } : null;
    const table = Float64Array.from({ length: FIT_TABLE_MAX + 1 }, (_, w) => (w ? frontageFit(w, theatre) : 0));
    // best fit of any whole width in [lo, hi], for the search's bounds: rangeMax[lo * (MAX + 1) + hi]
    const n = FIT_TABLE_MAX + 1;
    const rangeMax = new Float64Array(n * n);
    for (let lo = 0; lo < n; lo++) { let m = 0; for (let hi = lo; hi < n; hi++) { m = Math.max(m, table[hi]); rangeMax[lo * n + hi] = m; } }
    out.push({ key: 'frontage', label: 'Frontage fit', w: fitWeight, dir: 1, kind: 'frontage', floor: 0, table, rangeMax, theatre });
  }
  /*
   * Meta widths: the sizes players settle on for a role. They fold in what the model leaves out (command and supply
   * per division, how damage spreads over divisions, reinforcement), so a width that far from every meta width pays
   * metaPull per width step, as a share of every combat stat: with 0.05, two steps off costs about 10%.
   */
  const metas = (metaWidths || []).filter((x) => x > 0);
  if (metas.length && metaPull > 0) {
    out.push({ key: 'meta', label: 'Meta width', w: combatWeight || anyWeight, dir: 1, kind: 'meta', floor: 0, metas, pull: metaPull });
  }
  return out;
}

/** How far a width is from the nearest meta width. */
export function metaDistance(term, width) {
  let d = Infinity;
  for (const m of term.metas) d = Math.min(d, Math.abs(width - m));
  return d;
}

/** Nearest any width in [lo, hi] gets to a meta width. */
export function metaDistanceIn(term, lo, hi) {
  let d = Infinity;
  for (const m of term.metas) d = Math.min(d, m < lo ? lo - m : m > hi ? m - hi : 0);
  return d;
}

/** Best frontage fit of any whole width in [lo, hi] (1 when there is none to judge). */
export function bestFitIn(term, lo, hi) {
  const a = Math.max(1, Math.ceil(lo - 1e-9)); const b = Math.min(FIT_TABLE_MAX, Math.floor(hi + 1e-9));
  if (hi > FIT_TABLE_MAX || a > b) return 1;
  return term.rangeMax[a * (FIT_TABLE_MAX + 1) + b];
}

/** Frontage fit of a width for a frontage term (exact for whole widths, computed otherwise). */
export function fitOf(term, width) {
  const r = Math.round(width);
  if (Math.abs(r - width) < 1e-9 && r >= 0 && r <= FIT_TABLE_MAX) return term.table[r];
  return frontageFit(width, term.theatre) || 0;
}

/** The value a term scores (per width if asked). */
export function termValue(term, st, enemy) {
  if (term.kind === 'matchup') return matchup(st, enemy)[term.key];
  if (term.kind === 'frontage') return fitOf(term, st.width || 0);
  if (term.kind === 'meta') return metaDistance(term, st.width || 0);
  const v = st[term.key] || 0;
  return term.perWidth && st.width > 0 ? v / st.width : v;
}

/** Score contribution of one term at a value. */
export function termScore(term, v) {
  if (term.kind === 'perk') return v > 0 ? term.w * PERK_VALUE : 0;
  if (term.kind === 'count') return term.w * REG_VALUE * v;
  if (term.kind === 'frontage') return term.w * Math.log(Math.max(v, 1e-6));
  if (term.kind === 'meta') return -term.w * term.pull * v;
  return term.w * term.dir * Math.log(Math.max(0, v) + term.floor);
}

export function utility(st, terms, enemy) {
  let s = 0;
  const m = terms.some((t) => t.kind === 'matchup') ? matchup(st, enemy) : null;
  for (const t of terms) s += termScore(t, t.kind === 'matchup' ? m[t.key] : termValue(t, st, enemy));
  return s;
}

/**
 * Why a template scores what it does, stat by stat, compared with a reference template (the runner-up, say).
 * delta is in score points; a positive delta is where this template beats the reference.
 */
export function explain(st, ref, terms, enemy) {
  const m = enemy ? matchup(st, enemy) : null;
  const mr = enemy && ref ? matchup(ref, enemy) : null;
  return terms.map((t) => {
    const v = t.kind === 'matchup' ? m[t.key] : termValue(t, st, enemy);
    const rv = ref ? (t.kind === 'matchup' ? mr[t.key] : termValue(t, ref, enemy)) : null;
    const score = termScore(t, v);
    return { key: t.key, label: t.label, weight: t.w * t.dir, value: v, refValue: rv, score, delta: ref ? score - termScore(t, rv) : 0 };
  });
}

/** Is a dominated by b on every scored stat (and strictly worse on one)? */
export function dominates(b, a, terms, enemy) {
  let strict = false;
  for (const t of terms) {
    const d = termScore(t, termValue(t, b, enemy)) - termScore(t, termValue(t, a, enemy));
    if (d < -1e-9) return false;
    if (d > 1e-9) strict = true;
  }
  return strict;
}
