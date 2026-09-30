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

export const FLOOR = {
  sa: 1, ha: 1, brk: 1, air: 1, pier: 1, def: 1, org: 1, rec: 0.05, hp: 1, arm: 1, hard: 1, rel: 1, spd: 0.5,
  ic: 10, mp: 100, sup: 0.05, trucks: 1, recon: 1, mAtk: 0.01, mDef: 0.01,
};
export const PERK_VALUE = 0.3;
export const REG_VALUE = 0.3;
// Stats that grow with the division. With "compare per combat width" these are divided by width before scoring.
export const ADDITIVE = new Set(['sa', 'ha', 'brk', 'air', 'def', 'hp', 'ic', 'mp', 'sup', 'trucks', 'recon']);

/**
 * The scored terms for a set of priorities. kind: log (weight * dir * ln(v + floor)), perk (present or not),
 * count (linear in the count) or matchup (log of the matchup ratio, only with an opponent).
 */
export function objectiveTerms(weights, { perWidth = false } = {}, enemy = null) {
  const out = [];
  for (const s of STATS) {
    const w = weights[s.key] || 0;
    if (!w) continue;
    if (s.matchup && !enemy) continue;
    const kind = s.perk ? 'perk' : s.count ? 'count' : s.matchup ? 'matchup' : 'log';
    // a negative weight on a signed stat (hardness) means "prefer lower"
    const dir = s.dir * Math.sign(w);
    out.push({ key: s.key, label: s.label, w: Math.abs(w), dir, kind, perWidth: perWidth && ADDITIVE.has(s.key), floor: FLOOR[s.key] ?? 1 });
  }
  return out;
}

/** The value a term scores (per width if asked). */
export function termValue(term, st, enemy) {
  if (term.kind === 'matchup') return matchup(st, enemy)[term.key];
  const v = st[term.key] || 0;
  return term.perWidth && st.width > 0 ? v / st.width : v;
}

/** Score contribution of one term at a value. */
export function termScore(term, v) {
  if (term.kind === 'perk') return v > 0 ? term.w * PERK_VALUE : 0;
  if (term.kind === 'count') return term.w * REG_VALUE * v;
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
