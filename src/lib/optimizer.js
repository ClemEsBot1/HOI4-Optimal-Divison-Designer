/**
 * Template search by branch and bound.
 *
 * The search is exact for the scoring rule in score.js: when it reports `proven`, no legal template scores more than
 * GAP_SHARE better than the one it returns (a 0.5% gain on every priority), and the same setup always gives the same
 * answer. There is no randomness and no time budget, only a node budget; if that runs out, the answer is the best
 * found and is reported as not proven.
 *
 *   1. For every total battalion count N, a depth-first search picks how many battalions of each line unit to take.
 *      Limits (width, columns, armor and mobile shares, organization, cost) are hard: a branch is cut as soon as it
 *      can no longer meet one.
 *   2. When the battalions are fixed, the non-dominated sets of divisional support companies are tried best first,
 *      then the regimental slots of each layout planColumns() can draw are filled.
 *   3. Every node gets an upper bound on the best score any completion could reach. The score is a sum of
 *      weight * ln(stat) terms, each stat a ratio of sums over the template. Concave terms (ln of something we want
 *      more of) are bounded by tangents; convex ones (costs, denominators) are kept exact, which makes the bound
 *      convex in what is left to add, so its maximum sits at a vertex of the choices (all remaining battalions of one
 *      unit, or two units that fill the width). Companies are bounded by knapsacks against the room the organization
 *      floor and the cost cap leave. A branch whose bound cannot beat the best template so far is dropped.
 *
 * The winner is proven; the other ranked templates are the best of each other archetype (column types used and
 * lead battalion) among the templates the search completed or started from.
 */
import { resolve, MAX_COLUMNS, MAX_SUPPORT } from './game.js';
import { evaluate, planColumns, supportConflict, regFitsColumn, DEFAULT_OPTS, COLUMN_TYPES, ARMOR_MAX_SHARE } from './stats.js';
import { objectiveTerms, utility, termScore, termValue, explain, PERK_VALUE, REG_VALUE } from './score.js';
import { enemyStats, matchup } from './combat.js';
import { coDesign } from './design.js';

export const DEFAULT_CONSTRAINTS = { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false };
export const PROOF_TOLERANCE = 1e-6;
const DEFAULT_NODE_LIMIT = 2.5e6;
const CODESIGN_NODE_LIMIT = 1e5;
const POOL_OUT = 2000;

// ---- keys (used for de-duplication, the URL and the trade-off chart) ----
export const templateKey = (t) => `${[...t.items].sort().join(',')}|${[...t.support].sort().join(',')}|${[...(t.reg || [])].sort().join(',')}`;
export function parseKey(key) {
  const [a = '', b = '', c = ''] = key.split('|');
  const split = (s) => (s ? s.split(',') : []);
  return { items: split(a), support: split(b), reg: split(c) };
}

/** Group battalions by column type, then by unit, so templates read like a division designer. */
export function orderItems(items, byId) {
  const rank = { infantry: 0, artillery: 1, mobile: 2, mobile_artillery: 3, armor: 4 };
  return [...items].sort((a, b) => {
    const ua = byId.get(a); const ub = byId.get(b);
    return (rank[ua.cat] - rank[ub.cat]) || (ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : 0);
  });
}

// ---------------------------------------------------------------- sums
// Everything the score needs is a function of these per-template sums (plus three extremes: the best armor and
// piercing and the slowest speed), which is what makes the bounds cheap.
const SK = ['sa', 'ha', 'air', 'def', 'brk', 'hp', 'ic', 'mp', 'sup', 'trucks', 'recon', 'width', 'org', 'rec', 'den',
  'arm', 'pier', 'hard', 'rel', 'regs', 'engineer', 'hospital', 'logistics', 'maintenance', 'signal', 'police'];
const I = Object.fromEntries(SK.map((k, i) => [k, i]));
const K = SK.length;
const PERKS = ['engineer', 'hospital', 'logistics', 'maintenance', 'signal', 'police'];
const BOOST_STATS = ['sa', 'ha', 'def', 'brk', 'pier', 'air'];
const MOD_STATS = { sa: 'sa', ha: 'ha', def: 'def', brk: 'brk', hp: 'hp', org: 'org', arm: 'arm', pier: 'pier' };

function lineVec(u) {
  const v = new Float64Array(K);
  for (const k of ['sa', 'ha', 'air', 'def', 'brk', 'hp', 'ic', 'mp', 'sup', 'trucks', 'width', 'org', 'rec', 'arm', 'pier', 'hard']) v[I[k]] = u[k] || 0;
  v[I.den] = 1;
  v[I.rel] = u.rel ?? 1;
  return v;
}

function companyVec(u, dilutes, mult = 1) {
  const v = new Float64Array(K);
  for (const k of ['sa', 'ha', 'air', 'def', 'brk', 'hp', 'ic', 'mp', 'sup', 'trucks', 'recon']) v[I[k]] = (u[k] || 0) * mult;
  if (dilutes) { v[I.org] = u.org * mult; v[I.rec] = u.rec * mult; v[I.den] = mult; }
  for (const p of PERKS) if (u.perks[p]) v[I[p]] = u.perks[p] * mult;
  return v;
}

/** Per line unit, the fraction a company adds to each boostable stat (support companies lifting categories). */
function boostFractions(company, line) {
  return line.map((u) => {
    const f = {};
    for (const bm of company.battalionMult) {
      if (!u.cats.includes(bm.category)) continue;
      for (const [k, x] of Object.entries(bm.stats)) if (BOOST_STATS.includes(k)) f[k] = (f[k] || 0) + x;
    }
    return f;
  });
}

// ---------------------------------------------------------------- bounds
// ln L <= ln x + (L - x) / x for any x > 0 (tangent), and on [lo, hi] -ln L <= chord. Both add a linear function of
// the sums to (c, c0). A linear form is { a: [[index, coef]...], b: constant } with every coef >= 0.
function formRange(form, lo, hi, bLo, bHi) {
  let l = bLo; let h = bHi;
  for (const [s, a] of form.a) { l += a * lo[s]; h += a * hi[s]; }
  return [Math.max(l, 1e-9), Math.max(h, 1e-9)];
}
function addTangent(c, form, weight, x, b) {
  // weight * ln(L) <= weight * (ln x - 1 + L / x)
  for (const [s, a] of form.a) c[s] += weight * a / x;
  return weight * (Math.log(x) - 1 + b / x);
}
function addChord(c, form, weight, lo, hi, b) {
  // weight * -ln(L) on [lo, hi] <= weight * (-ln lo + slope * (L - lo))
  if (hi - lo < 1e-9 * Math.max(1, lo)) return -weight * Math.log(lo);
  const slope = -(Math.log(hi) - Math.log(lo)) / (hi - lo);
  for (const [s, a] of form.a) c[s] += weight * slope * a;
  return weight * (-Math.log(lo) + slope * (b - lo));
}

/**
 * For each log term: stat + floor = num / den, with num and den linear forms in the sums. `b` of `num` may depend on
 * the best armor or piercing, passed in at bound time.
 */
function termForms(term, ctx) {
  const k = term.key;
  const mk = ctx.mods[MOD_STATS[k]] ?? 1;
  const f = term.floor;
  const W = I.width;
  if (['sa', 'ha', 'def', 'brk', 'hp', 'air', 'ic', 'mp', 'sup', 'trucks', 'recon'].includes(k)) {
    if (term.perWidth) return { num: { a: [[I[k], mk], [W, f]], b: 0 }, den: { a: [[W, 1]], b: 0 } };
    return { num: { a: [[I[k], mk]], b: f }, den: null };
  }
  if (k === 'org' || k === 'rec') return { num: { a: [[I[k], mk], [I.den, f]], b: 0 }, den: { a: [[I.den, 1]], b: 0 } };
  if (k === 'arm' || k === 'pier') return { num: { a: [[I[k], (1 - ARMOR_MAX_SHARE) * mk / ctx.N]], b: f, maxOf: k }, den: null, mk };
  if (k === 'hard') return { num: { a: [[I.hard, 1 / ctx.N]], b: f }, den: null };
  if (k === 'rel') return { num: { a: [[I.rel, 100 / ctx.N]], b: f }, den: null };
  if (k === 'spd') return { spd: true };
  return null;
}

// ---------------------------------------------------------------- search
function rankInsert(list, entry, cap) {
  // keeps `list` sorted by score, best first, at most `cap` long
  let i = list.length;
  while (i > 0 && list[i - 1].score < entry.score) i--;
  if (i >= cap) return;
  list.splice(i, 0, entry);
  if (list.length > cap) list.pop();
}

/**
 * One branch-and-bound run over a resolved unit set.
 * opts: { topN, window, nodeLimit, seeds: [{items, support, reg}] (known good templates to start from) }
 */
function branchAndBound(resolved, P, run) {
  const { byId, columnSize: cs } = resolved;
  const C = P.C;
  const terms = P.terms;
  const enemy = P.enemy;
  const dilutes = P.opts.supportDilutesOrg;
  const mods = Object.fromEntries(Object.keys(MOD_STATS).map((k) => [k, 1 + (P.mods[k] || 0) / 100]));
  const topN = run.topN;
  const nodeLimit = run.nodeLimit || DEFAULT_NODE_LIMIT;
  const window = run.window;
  // Branches that could beat the bar by no more than `tol` are dropped: the answer is optimal to within tol.
  const tol = Math.max(PROOF_TOLERANCE, run.tolerance ?? 0);

  const line = resolved.combat;
  const T = line.length;
  const colIdx = (u) => COLUMN_TYPES.indexOf(u.cat);
  const supports = resolved.support;
  const regs = resolved.regimental;
  const supVec = supports.map((u) => companyVec(u, dilutes));
  const supBoost = supports.map((u) => (u.battalionMult.length ? boostFractions(u, line) : null));
  const regBoost = regs.map((u) => (u.battalionMult.length ? boostFractions(u, line) : null));
  const regBase = regs.map((u) => companyVec(u, dilutes));
  const anyPierBoost = [...supBoost, ...regBoost].some((b) => b && b.some((f) => f.pier));
  const anyBoost = [...supBoost, ...regBoost].some(Boolean);

  // Limits that the sums can already rule out: organization cannot reach its floor, or cost is already over its cap.
  // An average can only move towards the values it averages in (the mediant rule), so organization can end no higher
  // than the larger of its current average and the best organization per battalion of anything still to come.
  const companyOrgRatio = Math.max(0, ...(dilutes ? [...supports, ...regs].map((u) => u.org) : [0]));
  const infeasible = (Pp, lo, hi, lineOrgMax = Infinity) => {
    if (C.minOrg) {
      const now = Pp[I.den] > 0 ? Pp[I.org] / Pp[I.den] : -Infinity;
      const mediant = Math.max(now, lineOrgMax, companyOrgRatio);
      const linear = (Pp[I.org] + hi[I.org]) / Math.max(1e-9, Pp[I.den] + lo[I.den]);
      if (mods.org * Math.min(mediant, linear) < C.minOrg - 1e-9) return true;
    }
    if (C.maxIc && Pp[I.ic] + lo[I.ic] > C.maxIc + 1e-9) return true;
    return false;
  };

  // Which way each sum moves the score (and the limits): +1 more is better, -1 less is better, 0 no effect.
  const orient = new Int8Array(K);
  {
    const has = (k) => terms.some((t) => t.key === k);
    const dirOf = (k) => terms.find((t) => t.key === k)?.dir || 0;
    const matchup = terms.some((t) => t.kind === 'matchup');
    for (const k of ['sa', 'ha', 'def', 'brk']) if (has(k) || matchup) orient[I[k]] = has(k) ? dirOf(k) : 1;
    for (const k of ['hp', 'air', 'recon', 'ic', 'mp', 'sup', 'trucks']) if (has(k)) orient[I[k]] = dirOf(k);
    if (C.maxIc) orient[I.ic] = orient[I.ic] || -1;
    if (has('org') || has('rec') || C.minOrg || matchup) { orient[I.org] = 1; orient[I.den] = -1; }
    if (has('rec')) { orient[I.rec] = 1; orient[I.den] = -1; }
    for (const p of PERKS) if (has(p)) orient[I[p]] = 1;
    if (has('regs')) orient[I.regs] = 1;
    // a sum that pulls both ways cannot be ordered: keep every set that differs in it
    for (const k of ['sa', 'ha', 'def', 'brk']) if (has(k) && matchup && dirOf(k) < 0) orient[I[k]] = 2;
  }

  /**
   * Regimental companies worth considering. One whose every effect on the score and the limits is neutral or bad can
   * always be left out, and one that at least MAX_COLUMNS others beat on everything never gets a slot they could not
   * take instead (companies are unique, so it takes that many to be sure).
   */
  const regUseful = (() => {
    const boostKeys = [...new Set(regs.flatMap((u) => u.battalionMult.flatMap((bm) => Object.keys(bm.stats).filter((k) => BOOST_STATS.includes(k)).map((k) => `${bm.category}:${k}`))))];
    const vec = regs.map((u, j) => {
      const v = [];
      for (let s = 0; s < K; s++) {
        if (!orient[s]) continue;
        const x = regBase[j][s] + (s === I.regs ? 1 / 3 : 0);
        if (orient[s] === 2) v.push(x, -x); else v.push(orient[s] * x);
      }
      if (orient[I.regs]) v.push(orient[I.regs]);
      for (const bk of boostKeys) { const [cat, k] = bk.split(':'); let x = 0; for (const bm of u.battalionMult) if (bm.category === cat) x += bm.stats[k] || 0; v.push(x); }
      return v;
    });
    const geq = (a, b) => a.every((x, i) => x >= b[i] - 1e-12);
    return regs.map((u, j) => {
      if (vec[j].every((x) => x <= 1e-12)) return false;
      const same = regs.filter((w, q) => q !== j && regFitsColumn(w, 'armor') === regFitsColumn(u, 'armor') && geq(vec[q], vec[j]) && !(geq(vec[j], vec[q]) && q > j));
      return same.length < MAX_COLUMNS;
    });
  })();
  const regOther = regs.map((u, j) => j).filter((j) => regUseful[j] && regFitsColumn(regs[j], 'infantry'));
  const regArmor = regs.map((u, j) => j).filter((j) => regUseful[j] && regFitsColumn(regs[j], 'armor'));

  /**
   * Every legal set of divisional support companies (at most five, no two of a kind), minus the sets another set beats
   * or matches on every sum the score depends on (including how much they lift each category of battalion).
   * Dropping those can never lose: the score only improves when a sum moves in its good direction.
   */
  const supportSets = (() => {
    const boostKeys = [...new Set(supports.flatMap((u) => u.battalionMult.flatMap((bm) => Object.keys(bm.stats).filter((k) => BOOST_STATS.includes(k)).map((k) => `${bm.category}:${k}`))))];
    const vecOf = (set) => {
      const v = [];
      for (let s = 0; s < K; s++) {
        if (!orient[s]) continue;
        let x = 0; for (const j of set) x += supVec[j][s];
        if (orient[s] === 2) v.push(x, -x); else v.push(orient[s] * x);
      }
      for (const bk of boostKeys) {
        const [cat, k] = bk.split(':');
        let x = 0;
        for (const j of set) for (const bm of supports[j].battalionMult) if (bm.category === cat) x += bm.stats[k] || 0;
        v.push(x);
      }
      return v;
    };
    const all = [];
    const cur = [];
    const rec = (start) => {
      all.push(cur.slice());
      if (cur.length === MAX_SUPPORT) return;
      for (let j = start; j < supports.length; j++) {
        if (cur.some((q) => supportConflict(supports[q], supports[j]))) continue;
        cur.push(j); rec(j + 1); cur.pop();
      }
    };
    rec(0);
    const vs = all.map(vecOf);
    const order = all.map((_, i) => i).sort((x, y) => vs[y].reduce((a, b) => a + b, 0) - vs[x].reduce((a, b) => a + b, 0) || all[x].length - all[y].length);
    const keep = [];
    for (const i of order) {
      const v = vs[i];
      if (keep.some((k) => { const w = vs[k]; for (let d = 0; d < v.length; d++) if (w[d] < v[d] - 1e-12) return false; return true; })) continue;
      keep.push(i);
    }
    return keep.map((i) => all[i]);
  })();
  const supportSetBoosted = supportSets.map((set) => set.some((j) => supBoost[j]));
  const orgFloorEarly = C.minOrg && dilutes ? C.minOrg / mods.org : 0;
  const supportSetBase = supportSets.map((set) => { const v = new Float64Array(K); for (const j of set) for (let s = 0; s < K; s++) v[s] += supVec[j][s]; return v; });
  // organization a set adds minus what it costs at the floor: the set fits only if the battalions leave that much
  const supportSetOrgRoom = supportSetBase.map((v) => v[I.org] - orgFloorEarly * v[I.den]);
  const regOrgMax = dilutes ? Math.max(-Infinity, ...regs.map((u) => u.org)) : Infinity;

  // ---- bookkeeping shared by every N ----
  let nodes = 0; let leaves = 0; let aborted = false;
  // Once the node budget runs out, every branch still open is bounded instead of searched: openUb is the best score
  // any of them could reach, so the answer is proven to within openUb - best.
  let openUb = -Infinity;
  const leaveOpen = (ub) => { if (ub > openUb) openUb = ub; };
  const archetypes = new Map(); // archetype -> best entry
  let ranked = []; // best entry per archetype, best first
  let best = null; // best entry overall
  const pool = []; // good complete templates for the chart, best first
  const POOL_CAP = 2500;
  const threshold = () => {
    let t = -Infinity;
    if (ranked.length >= topN) t = ranked[topN - 1].score;
    if (best && window != null) t = Math.max(t, best.score - window);
    return t;
  };

  // ---- exact score of a complete template from its sums ----
  const statsFrom = (S, N, armMax, pierMax, spdMin, cnt, regCount) => {
    const st = {
      sa: S[I.sa] * mods.sa, ha: S[I.ha] * mods.ha, air: S[I.air], def: S[I.def] * mods.def, brk: S[I.brk] * mods.brk,
      pier: (ARMOR_MAX_SHARE * pierMax + (1 - ARMOR_MAX_SHARE) * S[I.pier] / N) * mods.pier,
      org: (S[I.org] / S[I.den]) * mods.org, rec: S[I.rec] / S[I.den], hp: S[I.hp] * mods.hp,
      arm: (ARMOR_MAX_SHARE * armMax + (1 - ARMOR_MAX_SHARE) * S[I.arm] / N) * mods.arm,
      hard: S[I.hard] / N, rel: (S[I.rel] / N) * 100, spd: spdMin === Infinity ? 0 : spdMin,
      ic: S[I.ic], mp: S[I.mp], sup: S[I.sup], trucks: S[I.trucks], recon: S[I.recon], width: S[I.width], n: N,
      regs: regCount, regCount,
    };
    for (const p of PERKS) st[p] = S[I[p]];
    st.cnt = cnt;
    return st;
  };
  const feasible = (st) => st.width >= C.wmin - 1e-9 && st.width <= C.wmax + 1e-9
    && !(C.minOrg && st.org < C.minOrg - 1e-9) && !(C.minArm && st.arm < C.minArm - 1e-9)
    && !(C.maxIc && st.ic > C.maxIc + 1e-9);

  // ---- tangent points: the incumbent's value of each linear form ----
  let tangentFrom = null; // { S, N, armMax, pierMax }
  const formValue = (form, S, N, armMax, pierMax, mk) => {
    let v = form.b;
    for (const [s, a] of form.a) v += a * S[s];
    if (form.maxOf) v += ARMOR_MAX_SHARE * mk * (form.maxOf === 'arm' ? armMax : pierMax);
    return v;
  };

  // hard/soft direction for matchup bounds: higher hardness helps when the enemy has more soft than hard attack
  const hardHelps = enemy ? enemy.sa >= enemy.ha : true;

  /**
   * Upper bound on the score over all completions, as c0 + c . (partial + added) with added in [lo, hi] per sum.
   * Returns { c, c0 } for the caller to finish with the best completion it can find for c.
   */
  const formCache = new Map();
  const boundLo = new Float64Array(K); const boundHi = new Float64Array(K);
  const tanHiBuf = new Float64Array(K);
  const linearBound = (Pp, lo, hi, N, ext, convexOut = null, tangentHi = null) => {
    const c = new Float64Array(K);
    let c0 = 0;
    const Slo = boundLo; const Shi = boundHi;
    for (let s = 0; s < K; s++) { Slo[s] = Pp[s] + lo[s]; Shi[s] = Pp[s] + hi[s]; }
    let formsN = formCache.get(N);
    if (!formsN) { formsN = terms.map((t) => (t.kind === 'log' ? termForms(t, { mods, N }) : null)); formCache.set(N, formsN); }
    for (let ti = 0; ti < terms.length; ti++) {
      const t = terms[ti];
      if (t.kind === 'perk') { c[I[t.key]] += t.w * PERK_VALUE; continue; }
      if (t.kind === 'count') { c[I.regs] += t.w * REG_VALUE; continue; }
      if (t.kind === 'matchup') {
        // monotone in each of our stats, so the best corner of the box bounds it
        const org = mods.org * Shi[I.org] / Math.max(1e-9, Slo[I.den]);
        const armHi = mods.arm * (ARMOR_MAX_SHARE * ext.armHi + (1 - ARMOR_MAX_SHARE) * Shi[I.arm] / N);
        const pierHi = mods.pier * (ARMOR_MAX_SHARE * ext.pierHi + (1 - ARMOR_MAX_SHARE) * Shi[I.pier] / N);
        const us = {
          sa: Shi[I.sa] * mods.sa, ha: Shi[I.ha] * mods.ha, def: Shi[I.def] * mods.def, brk: Shi[I.brk] * mods.brk,
          org, arm: armHi, pier: pierHi, hard: (hardHelps ? Shi[I.hard] : Slo[I.hard]) / N, width: Math.max(1e-9, Slo[I.width]),
        };
        c0 += termScore(t, matchup(us, enemy)[t.key]);
        continue;
      }
      const forms = formsN[ti];
      if (forms.spd) { c0 += t.w * t.dir * Math.log(Math.max(0, ext.spdHi) + t.floor); continue; }
      const { num, den } = forms;
      const maxHi = num.maxOf ? ARMOR_MAX_SHARE * forms.mk * (num.maxOf === 'arm' ? ext.armHi : ext.pierHi) : 0;
      const maxLo = num.maxOf ? ARMOR_MAX_SHARE * forms.mk * (num.maxOf === 'arm' ? ext.armLo : ext.pierLo) : 0;
      const [nLo, nHi] = formRange(num, Slo, Shi, num.b + maxLo, num.b + maxHi);
      if (t.dir > 0) {
        let x = tangentFrom ? formValue(num, tangentFrom.S, tangentFrom.N, tangentFrom.armMax, tangentFrom.pierMax, forms.mk) : nHi;
        // an incumbent at the bottom of the range (a stat it lacks) gives a needlessly steep tangent
        let top = nHi;
        if (tangentHi) { for (let s = 0; s < K; s++) tanHiBuf[s] = Pp[s] + tangentHi[s]; top = Math.max(nLo, formRange(num, Slo, tanHiBuf, num.b + maxLo, num.b + maxHi)[1]); if (top <= nLo * (1 + 1e-9)) top = nHi; }
        x = x <= nLo * (1 + 1e-9) ? Math.sqrt(nLo * top) : Math.min(top, x);
        c0 += addTangent(c, num, t.w, x, num.b + maxHi);
        if (den) {
          if (convexOut) convexOut.push({ a: den.a, b: den.b, w: t.w });
          else { const [dLo, dHi] = formRange(den, Slo, Shi, den.b, den.b); c0 += addChord(c, den, t.w, dLo, dHi, den.b); }
        }
      } else {
        if (convexOut) convexOut.push({ a: num.a, b: num.b + maxLo, w: t.w });
        else c0 += addChord(c, num, t.w, nLo, nHi, num.b + maxLo);
        if (den) {
          const [dLo, dHi] = formRange(den, Slo, Shi, den.b, den.b);
          let x = tangentFrom ? formValue(den, tangentFrom.S, tangentFrom.N, 0, 0, 1) : dHi;
          x = Math.min(dHi, Math.max(dLo, x));
          c0 += addTangent(c, den, t.w, x, den.b);
        }
      }
    }
    // everything was bounded in terms of the final sums; the fixed part is c . partial
    for (let s = 0; s < K; s++) c0 += c[s] * Pp[s];
    return { c, c0 };
  };
  const dot = (c, v) => { let x = 0; for (let s = 0; s < K; s++) x += c[s] * v[s]; return x; };

  // ---- record a complete template ----
  const record = (tpl, st, S, N, armMax, pierMax, archetype) => {
    leaves++;
    const score = utility(st, terms, enemy);
    const entry = { score, tpl, st, archetype };
    if (!best || score > best.score + 1e-12) { best = entry; tangentFrom = { S: Float64Array.from(S), N, armMax, pierMax }; }
    const prev = archetypes.get(archetype);
    if (!prev || score > prev.score + 1e-12) {
      archetypes.set(archetype, entry);
      ranked = [...archetypes.values()].sort((a, b) => b.score - a.score);
    }
    if (pool.length < POOL_CAP || score > pool[pool.length - 1].score) rankInsert(pool, entry, POOL_CAP);
  };

  // layouts for every mix of armor and other regimental companies: the slot sizes planColumns() would draw
  const layoutCache2 = new Map();
  const layoutsFor = (ct) => {
    const ctKey = ct.join(',');
    let layouts = layoutCache2.get(ctKey);
    if (layouts) return layouts;
    layouts = [];
    const seen = new Set();
    for (let a = 0; a <= MAX_COLUMNS; a++) for (let o = 0; a + o <= MAX_COLUMNS; o++) {
      const counts = Object.fromEntries(COLUMN_TYPES.map((t, i) => [t, ct[i]]));
      const L = planColumns(counts, cs, a, o);
      if (!L.ok) continue;
      const slots = COLUMN_TYPES.flatMap((type) => (L.sizes[type] || []).filter((b) => b >= 3).map((b) => ({ type, b })));
      const other = slots.filter((x) => x.type !== 'armor').slice(0, o).map((x) => x.b);
      const armor = slots.filter((x) => x.type === 'armor').slice(0, a).map((x) => x.b);
      if (other.length < o || armor.length < a) continue;
      const sig = `${other.join('-')}/${armor.join('-')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      layouts.push({ other, armor });
    }
    layoutCache2.set(ctKey, layouts);
    return layouts;
  };
  // ---- company-level search for a fixed set of line battalions ----
  const layoutCache = new Map();
  const companies = (cnt, ct, S0, N, armMax0, pierMax0, spdMin, archetype) => {
    // Within an archetype only its own best matters, so the bar is at least that archetype's best so far.
    const bar = () => Math.max(threshold(), archetypes.get(archetype)?.score ?? -Infinity);
    // line-dependent boost additions for each company that lifts categories
    const boostVec = (fr, mult) => {
      const v = new Float64Array(K);
      for (let i = 0; i < T; i++) {
        if (!cnt[i]) continue;
        const f = fr[i];
        for (const k in f) v[I[k]] += cnt[i] * line[i][k] * f[k] * mult;
      }
      return v;
    };
    const sVec = supports.map((u, j) => {
      if (!supBoost[j]) return supVec[j];
      const v = Float64Array.from(supVec[j]); const b = boostVec(supBoost[j], 1);
      for (let s = 0; s < K; s++) v[s] += b[s];
      return v;
    });
    const ext = { armHi: armMax0, armLo: armMax0, pierHi: pierMax0, pierLo: pierMax0, spdHi: spdMin === Infinity ? 0 : spdMin };
    if (anyPierBoost) { ext.pierHi = pierMax0 * 2; }
    const exactPierMax = (chosenSup, chosenReg) => {
      if (!anyPierBoost) return pierMax0;
      let m = 0;
      for (let i = 0; i < T; i++) {
        if (!cnt[i]) continue;
        let f = 0;
        for (const j of chosenSup) if (supBoost[j]) f += supBoost[j][i].pier || 0;
        for (const [j, mult] of chosenReg) if (regBoost[j]) f += (regBoost[j][i].pier || 0) * mult;
        m = Math.max(m, line[i].pier * (1 + f));
      }
      return m;
    };

    const layouts = layoutsFor(ct);
    const maxMult = Math.max(3, cs);
        const regVecAt = (j, mult) => {
      const v = new Float64Array(K);
      const base = regBase[j];
      for (let s = 0; s < K; s++) v[s] = base[s] * mult;
      if (regBoost[j]) { const b = boostVec(regBoost[j], mult); for (let s = 0; s < K; s++) v[s] += b[s]; }
      v[I.regs] = 1;
      return v;
    };
    const nSup = supports.length;
    // what regimental companies can add, per sum: the best layout for each sum, each slot at its own size
    const regLoAll = new Float64Array(K); const regHiAll = new Float64Array(K);
    const slotLists = layouts.map((L) => [...L.other.map((b) => ({ b, pool: regOther })), ...L.armor.map((b) => ({ b, pool: regArmor }))]);
    const slotVecs = slotLists.map((sl) => sl.map((x) => x.pool.map((j) => regVecAt(j, x.b))));
    for (let s = 0; s < K; s++) {
      for (const vs of slotVecs) {
        let h = 0; let l = 0;
        for (const opts of vs) { let mx = 0; let mn = 0; for (const v of opts) { mx = Math.max(mx, v[s]); mn = Math.min(mn, v[s]); } h += mx; l += mn; }
        regHiAll[s] = Math.max(regHiAll[s], h); regLoAll[s] = Math.min(regLoAll[s], l);
      }
    }
    const regGainBound = (c) => {
      let best = 0;
      for (const vs of slotVecs) {
        let g = 0;
        for (const opts of vs) { let mx = 0; for (const v of opts) mx = Math.max(mx, dot(c, v)); g += mx; }
        best = Math.max(best, g);
      }
      return best;
    };

    const S = Float64Array.from(S0);
    let chosenSup = [];
    // Support companies: only the non-dominated sets (see supportSets), best first by their value at this leaf.
    const supportStage = () => {
      // boosts depend on the battalions: each boosting company's extra over its base vector, at this leaf
      const boostDelta = supports.map((u, j) => {
        if (!supBoost[j]) return null;
        const d = new Float64Array(K);
        for (let s = 0; s < K; s++) d[s] = sVec[j][s] - supVec[j][s];
        return d;
      });
      // one linear bound valid for every support set and regimental fill at this leaf
      const lo = new Float64Array(K); const hi = new Float64Array(K);
      for (let s = 0; s < K; s++) {
        lo[s] = regLoAll[s] + supLoBase[s]; hi[s] = regHiAll[s] + supHiBase[s];
        for (const d of boostDelta) if (d) { if (d[s] > 0) hi[s] += d[s]; else lo[s] += d[s]; }
      }
      if (infeasible(S0, lo, hi, -Infinity)) return;
      const { c, c0 } = linearBound(S0, lo, hi, N, ext);
      const rg = regs.length ? regGainBound(c) : 0;
      const nz = []; for (let s = 0; s < K; s++) if (c[s] !== 0) nz.push(s);
      const boostGain = boostDelta.map((d) => (d ? dot(c, d) : 0));
      // With an organization floor that no regimental company reaches, a support set is only possible if the
      // battalions leave enough organization above the floor for it: skip the others without looking at them.
      let orgNeed = -Infinity;
      if (orgFloor && regOrgMax < orgFloor) orgNeed = orgFloor * S0[I.den] - S0[I.org] - 1e-9;
      const cut = bar() + tol - c0 - rg;
      const gs = new Float64Array(supportSets.length);
      const order = [];
      for (let i = 0; i < supportSets.length; i++) {
        if (supportSetOrgRoom[i] < orgNeed) continue;
        const base = supportSetBase[i];
        let g = 0; for (const s2 of nz) g += c[s2] * base[s2];
        if (supportSetBoosted[i]) for (const j of supportSets[i]) g += boostGain[j];
        if (g <= cut) continue;
        gs[i] = g;
        order.push(i);
      }
      const vecOf = (i) => {
        if (!supportSetBoosted[i]) return supportSetBase[i];
        const v = Float64Array.from(supportSetBase[i]);
        for (const j of supportSets[i]) if (boostDelta[j]) for (let s = 0; s < K; s++) v[s] += boostDelta[j][s];
        return v;
      };
      order.sort((x, y) => gs[y] - gs[x]);
      for (const i of order) {
        const set = supportSets[i]; const v = vecOf(i); const g = gs[i];
        // sorted by g, so once one set cannot reach the bar none of the rest can
        if (c0 + g + rg <= bar() + tol) break;
        // this and every later set is worth at most c0 + g + rg (they are sorted by g)
        if (aborted || ++nodes > nodeLimit) { aborted = true; leaveOpen(c0 + g + rg); return; }
        for (let s = 0; s < K; s++) S[s] = S0[s] + v[s];
        if (infeasible(S, regLoAll, regHiAll, -Infinity)) continue;
        const b = linearBound(S, regLoAll, regHiAll, N, ext);
        const ub = b.c0 + (regs.length ? regGainBound(b.c) : 0);
        if (ub <= bar() + tol) continue;
        chosenSup = set;
        regStage();
        if (aborted) { leaveOpen(c0 + g + rg); return; }
      }
    };

    // regimental stage: for each layout, fill the first slots in order with distinct companies
    // per layout: each slot's candidate companies with their vectors at that slot's size, and what the slots from
    // k onwards can add at most / least (ignoring that a company can only be used once, which only loosens it)
    const vecCache = new Map();
    const vecAt = (j, b) => { const key = j * 64 + b; let v = vecCache.get(key); if (!v) { v = regVecAt(j, b); vecCache.set(key, v); } return v; };
    const plans = layouts.map((L) => {
      const slots = [...L.other.map((b) => ({ b, pool: regOther })), ...L.armor.map((b) => ({ b, pool: regArmor }))]
        .map((x) => ({ ...x, vecs: x.pool.map((j) => vecAt(j, x.b)) }));
      const sufLo = []; const sufHi = [];
      for (let k = slots.length; k >= 0; k--) {
        const lo = new Float64Array(K); const hi = new Float64Array(K);
        if (k < slots.length) {
          for (let s = 0; s < K; s++) {
            let mn = 0; let mx = 0;
            for (const v of slots[k].vecs) { if (v[s] < mn) mn = v[s]; if (v[s] > mx) mx = v[s]; }
            lo[s] = sufLo[0][s] + mn; hi[s] = sufHi[0][s] + mx;
          }
        }
        sufLo.unshift(lo); sufHi.unshift(hi);
      }
      return { slots, sufLo, sufHi };
    });
    const regStage = () => {
      for (const { slots, sufLo, sufHi } of plans) {
        if (aborted) return;
        const used = new Set();
        const chosen = []; // [j, mult]
        const regDfs = (k) => {
          if (aborted) return;
          if (++nodes > nodeLimit) { aborted = true; return; } // the support stage bounds what is left
          if (k === slots.length) { leaf(chosen); return; }
          {
            if (infeasible(S, sufLo[k], sufHi[k], -Infinity)) return;
            const { c, c0 } = linearBound(S, sufLo[k], sufHi[k], N, ext);
            let ub = c0;
            for (let q = k; q < slots.length; q++) {
              let g = 0;
              for (const v of slots[q].vecs) g = Math.max(g, dot(c, v));
              ub += g;
            }
            if (ub <= bar() + tol) return;
          }
          // slots of the same kind and size are interchangeable: take their companies in increasing order
          const prev = k > 0 && slots[k - 1].pool === slots[k].pool && slots[k - 1].b === slots[k].b ? chosen[k - 1][0] : -1;
          const { pool, vecs, b } = slots[k];
          for (let p = 0; p < pool.length; p++) {
            const j = pool[p];
            if (used.has(j) || j <= prev) continue;
            const v = vecs[p];
            for (let s = 0; s < K; s++) S[s] += v[s];
            used.add(j); chosen.push([j, b]);
            regDfs(k + 1);
            chosen.pop(); used.delete(j);
            for (let s = 0; s < K; s++) S[s] -= v[s];
          }
        };
        regDfs(0);
      }
    };

    const leaf = (chosenReg) => {
      const pierMax = exactPierMax(chosenSup, chosenReg);
      const st = statsFrom(S, N, armMax0, pierMax, spdMin, cntByCol(ct), chosenReg.length);
      if (!feasible(st)) return;
      const score = utility(st, terms, enemy);
      if (score <= bar() + PROOF_TOLERANCE && pool.length >= POOL_CAP && score <= pool[pool.length - 1].score) { leaves++; return; }
      const items = [];
      for (let i = 0; i < T; i++) for (let q = 0; q < cnt[i]; q++) items.push(line[i].id);
      const tpl = { items, support: chosenSup.map((j) => supports[j].id), reg: chosenReg.map(([j]) => regs[j].id) };
      record(tpl, st, S, N, armMax0, pierMax, archetype);
    };

    supportStage();
  };
  const cntByCol = (ct) => Object.fromEntries(COLUMN_TYPES.map((t, i) => [t, ct[i]]));

  // ---- seeds: known templates give the search a score to beat (and a point to take its bounds at) from the start ----
  // Cheap starting points so the bar is not empty: one or two line units filling the width, with or without the
  // best-looking single support company. They only speed the search up; they never decide the answer.
  const heuristicSeeds = () => {
    const out = [];
    const colsOk = (items) => {
      const ct = Object.fromEntries(COLUMN_TYPES.map((t) => [t, 0]));
      for (const id of items) ct[byId.get(id).cat]++;
      return COLUMN_TYPES.reduce((n, t) => n + Math.ceil(ct[t] / cs), 0) <= MAX_COLUMNS;
    };
    const fill = (a, b, nb) => {
      const items = [];
      for (let i = 0; i < nb; i++) items.push(b.id);
      let w = nb * b.width;
      while (w + a.width <= C.wmax + 1e-9 && items.length < MAX_COLUMNS * cs) { items.push(a.id); w += a.width; if (!colsOk(items)) { items.pop(); break; } }
      return w >= C.wmin - 1e-9 && items.length && colsOk(items) ? items : null;
    };
    const supportOpts = [[], ...supports.filter((u) => u.perks.engineer || u.id === 'artillery').map((u) => [u.id])];
    const scored = [];
    for (const a of line) {
      const items = fill(a, a, 0);
      if (!items) continue;
      for (const sup of supportOpts) {
        const tpl = { items, support: sup, reg: [] };
        const st = evaluate(tpl, byId, P.mods, P.opts, cs);
        scored.push({ a, st, tpl, ok: st && st.valid && feasible(st) && shareOk(st.cnt, st.n, C) });
      }
    }
    const top = [...new Set(scored.sort((x, y) => (y.st ? utility(y.st, terms, enemy) : -1e9) - (x.st ? utility(x.st, terms, enemy) : -1e9)).map((x) => x.a))].slice(0, 8);
    // the best few also get a greedy pass over support and regimental companies
    const improve = (tpl) => {
      let cur = tpl; let st = evaluate(cur, byId, P.mods, P.opts, cs); let sc = st && st.valid && feasible(st) ? utility(st, terms, enemy) : -Infinity;
      for (let round = 0; round < 10; round++) {
        let bestT = null; let bestS = sc;
        const tries = [];
        for (const u of regs) if (!cur.reg.includes(u.id)) tries.push({ ...cur, reg: [...cur.reg, u.id] });
        for (const u of supports) if (!cur.support.includes(u.id) && cur.support.length < MAX_SUPPORT && cur.support.every((id) => !supportConflict(byId.get(id), u))) tries.push({ ...cur, support: [...cur.support, u.id] });
        for (const t of tries) {
          const s2 = evaluate(t, byId, P.mods, P.opts, cs);
          if (!s2 || !s2.valid || !feasible(s2)) continue;
          const v = utility(s2, terms, enemy);
          if (v > bestS + 1e-12) { bestS = v; bestT = t; }
        }
        if (!bestT) break;
        cur = bestT; sc = bestS;
      }
      return cur;
    };
    for (const x of scored) if (x.ok) out.push(x.tpl);
    for (const a of top) for (const b of line) {
      if (a === b) continue;
      for (let nb = 1; nb <= Math.min(12, MAX_COLUMNS * cs); nb++) {
        const items = fill(a, b, nb);
        if (!items) continue;
        for (const sup of supportOpts) out.push({ items, support: sup, reg: [] });
      }
    }
    // the best few feasible ones also get a greedy pass over support and regimental companies
    const ranked0 = out.map((tpl) => {
      const st = evaluate(tpl, byId, P.mods, P.opts, cs);
      return { tpl, v: st && st.valid && feasible(st) && shareOk(st.cnt, st.n, C) ? utility(st, terms, enemy) : -Infinity };
    }).filter((x) => x.v > -Infinity).sort((a, b) => b.v - a.v);
    for (const x of ranked0.slice(0, 6)) out.push(improve(x.tpl));
    return out;
  };
  const hs = heuristicSeeds();
  const seedPool = [];
  for (const seed of [...(run.seeds || []), ...hs]) {
    if (!seed.items.every((id) => byId.has(id)) || !seed.support.every((id) => byId.has(id)) || !seed.reg.every((id) => byId.has(id))) continue;
    const st = evaluate(seed, byId, P.mods, P.opts, cs);
    if (!st || !st.valid || !feasible(st) || !shareOk(st.cnt, st.n, C)) continue;
    const score = utility(st, terms, enemy);
    const entry = { score, tpl: seed, st, archetype: archetypeOf(seed.items, byId), seed: true };
    seedPool.push(entry);
    if (best && score <= best.score) continue;
    best = entry;
    const S = new Float64Array(K);
    for (const id of seed.items) { const v = lineVec(byId.get(id)); for (let s = 0; s < K; s++) S[s] += v[s]; }
    for (const id of seed.support) { const v = companyVec(byId.get(id), dilutes); for (let s = 0; s < K; s++) S[s] += v[s]; }
    for (const id of seed.reg) { const v = companyVec(byId.get(id), dilutes, 3); for (let s = 0; s < K; s++) S[s] += v[s]; S[I.regs] += 1; }
    const items = seed.items.map((id) => byId.get(id));
    tangentFrom = { S, N: items.length, armMax: Math.max(...items.map((u) => u.arm)), pierMax: Math.max(...items.map((u) => u.pier)) };
  }
  const seedBest = best;
  // The seed only raises the bar. Its own template is pruned by that bar and restored at the end if nothing beats it.

  // ---- line-battalion search ----
  if (!T) return { ranked: [], pool: [], seedPool: [], nodes, leaves, aborted };
  const widths = line.map((u) => u.width);
  const minW = Math.min(...widths.filter((w) => w > 0), Infinity);
  const maxW = Math.max(...widths);
  const Nmax = Math.min(MAX_COLUMNS * cs, minW > 0 && Number.isFinite(minW) ? Math.floor((C.wmax + 1e-9) / minW) : MAX_COLUMNS * cs);
  const Nmin = Math.max(1, maxW > 0 ? Math.ceil((C.wmin - 1e-9) / maxW) : 1);
  const lvec = line.map(lineVec);

  // company bound pieces that do not depend on the line
  const supHiBase = new Float64Array(K); const supLoBase = new Float64Array(K);
  // the most and least any legal set of support companies adds to each sum
  for (let s = 0; s < K; s++) {
    for (const v of supportSetBase) { if (v[s] > supHiBase[s]) supHiBase[s] = v[s]; if (v[s] < supLoBase[s]) supLoBase[s] = v[s]; }
  }
  // Companies that exclude each other (all recon companies, say) form groups; at most one per group can be taken.
  const supGroups = (() => {
    const seen = new Set(); const groups = [];
    for (let j = 0; j < supports.length; j++) {
      if (seen.has(j)) continue;
      const comp = [j]; seen.add(j);
      for (let q = 0; q < comp.length; q++) for (let k = 0; k < supports.length; k++) if (!seen.has(k) && supportConflict(supports[comp[q]], supports[k])) { seen.add(k); comp.push(k); }
      const clique = comp.every((a) => comp.every((b) => a === b || supportConflict(supports[a], supports[b])));
      if (clique) groups.push(comp); else for (const k of comp) groups.push([k]);
    }
    return groups;
  })();
  /**
   * With an organization floor, companies below the floor use up the room the battalions leave above it:
   * sum over companies of (floor - org) * battalions they count as <= organization sum - floor * battalions.
   * The best use of that room is a fractional knapsack, which bounds what companies can add.
   */
  const orgFloor = C.minOrg && dilutes ? C.minOrg / mods.org : 0;
  const roomBound = (room, supGain, regGainPerBattalion, regBattalions, supWeight, regWeight) => {
    const items = [];
    for (let j = 0; j < supports.length; j++) { const g = supGain(j); if (g > 0) items.push({ g, w: supWeight(j), cap: 1 }); }
    for (let j = 0; j < regs.length; j++) { const g = regGainPerBattalion(j); if (g > 0) items.push({ g, w: regWeight(j), cap: regBattalions }); }
    let total = 0; let left = Math.max(0, room);
    const costly = [];
    for (const it of items) { if (it.w <= 0) total += it.g * it.cap; else costly.push(it); }
    costly.sort((a, b) => b.g / b.w - a.g / a.w);
    for (const it of costly) { if (left <= 0) break; const x = Math.min(it.cap, left / it.w); total += x * it.g; left -= x * it.w; }
    return total;
  };
  const orgRoomBound = (room, supGain, regGainPerBattalion, regBattalions) => (orgFloor
    ? roomBound(room, supGain, regGainPerBattalion, regBattalions, (j) => orgFloor - supports[j].org, (j) => orgFloor - regs[j].org)
    : Infinity);
  // the same with the cost cap: companies must fit in the production cost the battalions leave free
  const icRoomBound = (room, supGain, regGainPerBattalion, regBattalions) => (C.maxIc
    ? roomBound(room, supGain, regGainPerBattalion, regBattalions, (j) => supports[j].ic, (j) => regs[j].ic)
    : Infinity);
  const supportGainBound = (gainOf) => {
    const g = supGroups.map((grp) => Math.max(...grp.map(gainOf))).filter((x) => x > 0).sort((a, b) => b - a);
    let t = 0; for (let k = 0; k < Math.min(MAX_SUPPORT, g.length); k++) t += g[k];
    return t;
  };
  const maxMultAll = Math.max(3, cs);
  const regHiBase = new Float64Array(K); const regLoBase = new Float64Array(K);
  for (let s = 0; s < K; s++) {
    const hv = regBase.map((v) => v[s] * maxMultAll).sort((a, b) => b - a);
    const lv = regBase.map((v) => Math.min(v[s] * 3, v[s] * maxMultAll)).sort((a, b) => a - b);
    for (let q = 0; q < Math.min(MAX_COLUMNS, hv.length); q++) { if (hv[q] > 0) regHiBase[s] += hv[q]; if (lv[q] < 0) regLoBase[s] += lv[q]; }
  }
  if (regs.length) regHiBase[I.regs] = MAX_COLUMNS;
  // boosts: the most any combination of boosting companies can add per battalion of each line unit
  const boostPerUnit = line.map((u, i) => {
    const v = new Float64Array(K);
    for (const fr of supBoost) if (fr) for (const k in fr[i]) v[I[k]] += Math.max(0, u[k] * fr[i][k]);
    for (const fr of regBoost) if (fr) for (const k in fr[i]) v[I[k]] += Math.max(0, u[k] * fr[i][k] * maxMultAll);
    return v;
  });

  const armorCol = COLUMN_TYPES.indexOf('armor');
  const mobileCol = COLUMN_TYPES.indexOf('mobile');
  const nOrder = [];
  for (let N = Nmin; N <= Nmax; N++) nOrder.push(N);
  const pivot = seedBest ? seedBest.tpl.items.length : Math.round((Nmin + Nmax) / 2);
  nOrder.sort((a, b) => Math.abs(a - pivot) - Math.abs(b - pivot) || a - b);

  for (const N of nOrder) {
    // after the budget runs out the remaining battalion counts are still bounded at their roots
    // share limits turn into battalion-count limits once N is known
    const armorMin = Math.max(C.minArmorBattalions || 0, C.minArmorShare ? Math.ceil(C.minArmorShare * N - 1e-9) : 0);
    const armorMax = Math.min(C.maxArmorBattalions || Infinity, C.maxArmorShare ? Math.floor(C.maxArmorShare * N + 1e-9) : Infinity);
    const mobileMin = C.minMobileShare ? Math.ceil(C.minMobileShare * N - 1e-9) : 0;
    const mobileMax = C.maxMobileShare ? Math.floor(C.maxMobileShare * N + 1e-9) : Infinity;
    if (armorMin > armorMax || mobileMin > mobileMax) continue;

    // order line units by their value at the root, so good templates turn up early
    const rootLo = new Float64Array(K); const rootHi = new Float64Array(K);
    for (let s = 0; s < K; s++) {
      let mn = Infinity; let mx = -Infinity;
      for (const v of lvec) { mn = Math.min(mn, v[s]); mx = Math.max(mx, v[s]); }
      rootLo[s] = N * mn + supLoBase[s] + regLoBase[s];
      rootHi[s] = N * mx + supHiBase[s] + regHiBase[s];
    }
    const extRoot = {
      armHi: Math.max(...line.map((u) => u.arm)), armLo: 0,
      pierHi: Math.max(...line.map((u, i) => u.pier + boostPerUnit[i][I.pier])), pierLo: 0,
      spdHi: Math.max(0, ...line.filter((u) => u.affectsSpeed && u.spd > 0).map((u) => u.spd)),
    };
    const { c: rootC } = linearBound(new Float64Array(K), rootLo, rootHi, N, extRoot);
    const order = line.map((u, i) => i).sort((a, b) => dot(rootC, lvec[b]) - dot(rootC, lvec[a]) || (line[a].id < line[b].id ? -1 : 1));
    const L = order.map((i) => ({ i, u: line[i], v: lvec[i], col: colIdx(line[i]), boost: boostPerUnit[i] }));
    // suffix summaries over the order
    const suf = Array.from({ length: T + 1 }, () => ({ min: new Float64Array(K).fill(Infinity), max: new Float64Array(K).fill(-Infinity), wMin: Infinity, wMax: -Infinity, arm: 0, pier: 0, spd: 0, armor: false, mobile: false, orgArmor: -Infinity, orgMobile: -Infinity }));
    for (let q = T - 1; q >= 0; q--) {
      const a = suf[q]; const b = suf[q + 1]; const x = L[q];
      for (let s = 0; s < K; s++) { a.min[s] = Math.min(b.min[s], x.v[s]); a.max[s] = Math.max(b.max[s], x.v[s] + x.boost[s]); }
      a.wMin = Math.min(b.wMin, x.u.width); a.wMax = Math.max(b.wMax, x.u.width);
      a.arm = Math.max(b.arm, x.u.arm); a.pier = Math.max(b.pier, x.u.pier + x.boost[I.pier]);
      a.spd = Math.max(b.spd, x.u.affectsSpeed && x.u.spd > 0 ? x.u.spd : 0);
      a.armor = b.armor || x.col === armorCol; a.mobile = b.mobile || x.col === mobileCol;
      a.orgArmor = Math.max(b.orgArmor, x.col === armorCol ? x.u.org : -Infinity);
      a.orgMobile = Math.max(b.orgMobile, x.col === mobileCol ? x.u.org : -Infinity);
    }

    const compLo = new Float64Array(K); const compHi = new Float64Array(K); const lineHi = new Float64Array(K);
    // scratch buffers for the bound (reused at every node)
    const MAXC = 2 * terms.length + 2;
    const conv = []; const Lp = new Float64Array(MAXC); const compX = new Float64Array(MAXC); const Lmax = new Float64Array(MAXC); const slopeB = new Float64Array(MAXC);
    const gsB = new Float64Array(T); const wsB = new Float64Array(T); const dLB = new Float64Array(T * MAXC);
    const nzB = new Int32Array(K); const supAdj = new Float64Array(supports.length); const regAdj = new Float64Array(regs.length);
    for (let s2 = 0; s2 < K; s2++) { compLo[s2] = supLoBase[s2] + regLoBase[s2]; compHi[s2] = supHiBase[s2] + regHiBase[s2]; }
    const cnt = new Array(T).fill(0);
    const ct = [0, 0, 0, 0, 0];
    const S = new Float64Array(K);
    const lo = new Float64Array(K); const hi = new Float64Array(K);
    const placedBoost = new Float64Array(K);
    let placed = 0; let armMax = 0; let pierMax = 0; let spdMin = Infinity;

    const colsUsed = () => { let n = 0; for (let t = 0; t < 5; t++) n += Math.ceil(ct[t] / cs); return n; };

    // at a complete set of battalions: bound over every company choice before searching them
    const lineLeafBound = () => {
      for (let s = 0; s < K; s++) { lo[s] = supLoBase[s] + regLoBase[s]; hi[s] = supHiBase[s] + regHiBase[s]; }
      if (infeasible(S, lo, hi, -Infinity)) return -Infinity;
      const ext = { armHi: armMax, armLo: armMax, pierHi: pierMax + (anyPierBoost ? pierMax : 0), pierLo: pierMax, spdHi: spdMin < Infinity ? spdMin : 0 };
      const { c, c0 } = linearBound(S, lo, hi, N, ext);
      let ub = c0;
      ub += supportGainBound((j) => dot(c, supVec[j]));
      // regimental companies on the slots this set of battalions actually has
      let rg = 0;
      for (const L of layoutsFor(ct)) {
        let g = 0;
        for (const [sizes, pool] of [[L.other, regOther], [L.armor, regArmor]]) {
          for (const b of sizes) { let m = 0; for (const j of pool) m = Math.max(m, dot(c, regBase[j]) * b + c[I.regs]); g += m; }
        }
        rg = Math.max(rg, g);
      }
      ub += rg;
      if (anyBoost) for (let s = 0; s < K; s++) if (c[s] > 0) ub += c[s] * placedBoost[s];
      return ub;
    };
    const dfs = (q) => {
      if (++nodes > nodeLimit) aborted = true; // still bound this node, but go no deeper
      const r = N - placed;
      if (r === 0) {
        const w = S[I.width];
        if (w < C.wmin - 1e-9 || w > C.wmax + 1e-9) return;
        if (ct[armorCol] < armorMin || ct[armorCol] > armorMax || ct[mobileCol] < mobileMin || ct[mobileCol] > mobileMax) return;
        if (C.minArm && mods.arm * (ARMOR_MAX_SHARE * armMax + (1 - ARMOR_MAX_SHARE) * S[I.arm] / N) < C.minArm - 1e-9) return;
        let lead = -1;
        for (let i = 0; i < T; i++) if (cnt[i] && (lead < 0 || cnt[i] > cnt[lead] || (cnt[i] === cnt[lead] && line[i].id < line[lead].id))) lead = i;
        const arch = `${COLUMN_TYPES.filter((t, i) => ct[i]).join('+')}:${line[lead].id}`;
        const leafUb = lineLeafBound();
        if (leafUb <= threshold() + tol) return;
        if (aborted) { leaveOpen(leafUb); return; }
        companies(cnt, ct, S, N, armMax, pierMax, spdMin, arch);
        if (aborted) leaveOpen(leafUb);
        return;
      }
      if (q >= T) return;
      const sq = suf[q];
      // limits that can no longer be met
      if (S[I.width] + r * sq.wMin > C.wmax + 1e-9 || S[I.width] + r * sq.wMax < C.wmin - 1e-9) return;
      if (ct[armorCol] > armorMax || ct[mobileCol] > mobileMax) return;
      if (ct[armorCol] + (sq.armor ? r : 0) < armorMin || ct[mobileCol] + (sq.mobile ? r : 0) < mobileMin) return;
      // bound
      for (let s = 0; s < K; s++) {
        lo[s] = r * sq.min[s] + supLoBase[s] + regLoBase[s];
        hi[s] = r * sq.max[s] + supHiBase[s] + regHiBase[s];
      }
      const ext = {
        armHi: Math.max(armMax, sq.arm), armLo: armMax, pierHi: Math.max(pierMax, sq.pier), pierLo: pierMax,
        spdHi: spdMin < Infinity ? spdMin : sq.spd,
      };
      // the most organization the remaining battalions can bring, given the armor and mobile they must include
      const needA = Math.max(0, armorMin - ct[armorCol]); const needM = Math.max(0, mobileMin - ct[mobileCol]);
      if (needA + needM > r) return;
      const remOrg = (needA ? needA * sq.orgArmor : 0) + (needM ? needM * sq.orgMobile : 0) + (r - needA - needM) * sq.max[I.org];
      if (C.minOrg && mods.org * Math.max((S[I.org] + remOrg) / N, dilutes ? companyOrgRatio : -Infinity) < C.minOrg - 1e-9) return;
      if (infeasible(S, lo, hi)) return;
      if (C.minArm && mods.arm * (ARMOR_MAX_SHARE * ext.armHi + (1 - ARMOR_MAX_SHARE) * (S[I.arm] + hi[I.arm]) / N) < C.minArm - 1e-9) return;
      // Concave terms become tangent lines (c, c0). Convex terms (costs, denominators) are kept exact: the bound is
      // then convex in how many of each unit we add, so its maximum over the (relaxed) choices sits at a vertex:
      // all remaining battalions of one unit, or two units that use the width exactly.
      conv.length = 0;
      for (let s2 = 0; s2 < K; s2++) lineHi[s2] = r * sq.max[s2];
      const { c, c0 } = linearBound(S, lo, hi, N, ext, conv, lineHi);
      const nC = conv.length;
      for (let k = 0; k < nC; k++) {
        const f = conv[k];
        let lp = f.b; let clo = 0; let chi = 0;
        for (const [s2, a] of f.a) { lp += a * S[s2]; clo += a * compLo[s2]; chi += a * compHi[s2]; }
        Lp[k] = lp + clo; compX[k] = Math.max(0, chi - clo); Lmax[k] = 0;
      }
      const wRoom = C.wmax - S[I.width];
      const nT = T - q;
      let nnz = 0; for (let s2 = 0; s2 < K; s2++) if (c[s2] !== 0) nzB[nnz++] = s2;
      for (let p = q, i = 0; p < T; p++, i++) {
        const v = L[p].v; let g = 0;
        for (let z = 0; z < nnz; z++) g += c[nzB[z]] * v[nzB[z]];
        if (anyBoost) g += dot(c, L[p].boost);
        gsB[i] = g; wsB[i] = L[p].u.width;
        for (let k = 0; k < nC; k++) { let x = 0; for (const [s2, a] of conv[k].a) x += a * L[p].v[s2]; dLB[i * MAXC + k] = x; }
      }
      let lineUb = -Infinity;
      const vertex = (g, i, xi, j, xj) => {
        let v = g;
        for (let k = 0; k < nC; k++) {
          const x = Lp[k] + xi * dLB[i * MAXC + k] + (j >= 0 ? xj * dLB[j * MAXC + k] : 0);
          v -= conv[k].w * Math.log(x > 1e-9 ? x : 1e-9);
          if (x > Lmax[k]) Lmax[k] = x;
        }
        if (v > lineUb) lineUb = v;
      };
      let anyWide = false;
      for (let i = 0; i < nT; i++) {
        if (r * wsB[i] <= wRoom + 1e-9) vertex(r * gsB[i], i, r, -1, 0);
        else anyWide = true;
      }
      if (anyWide) {
        const wAvg = wRoom / r;
        for (let i = 0; i < nT; i++) {
          if (wsB[i] <= wAvg + 1e-9) continue;
          for (let j = 0; j < nT; j++) {
            if (wsB[j] >= wAvg - 1e-12) continue;
            const x1 = (wRoom - r * wsB[j]) / (wsB[i] - wsB[j]); const x2 = r - x1;
            vertex(x1 * gsB[i] + x2 * gsB[j], i, x1, j, x2);
          }
        }
      }
      if (lineUb === -Infinity) return;
      // companies: their share of the convex terms is bounded by the flattest chord any vertex allows
      for (let k = 0; k < nC; k++) slopeB[k] = compX[k] > 1e-12 ? -conv[k].w * (Math.log(Lmax[k] + compX[k]) - Math.log(Lmax[k] > 1e-9 ? Lmax[k] : 1e-9)) / compX[k] : 0;
      const adj = (v) => { let g = dot(c, v); for (let k = 0; k < nC; k++) { let x = 0; for (const [s2, a] of conv[k].a) x += a * v[s2]; g += slopeB[k] * x; } return g; };
      for (let j = 0; j < supports.length; j++) supAdj[j] = adj(supVec[j]);
      for (let j = 0; j < regs.length; j++) regAdj[j] = adj(regBase[j]);
      let compUb = 0;
      {
        compUb += supportGainBound((j) => supAdj[j]);
        // regimental companies scale with the battalions in their column, and no battalion is in two columns
        const slotsMax = Math.min(MAX_COLUMNS, Math.floor(N / 3));
        let perBattalion = 0; let perCompany = 0;
        for (let j = 0; j < regs.length; j++) if (regAdj[j] > perBattalion) perBattalion = regAdj[j];
        if (slotsMax > 0) perCompany = Math.max(0, c[I.regs]);
        const regBattalions = Math.min(N, slotsMax * maxMultAll);
        compUb += perBattalion * regBattalions + perCompany * slotsMax;
        const regPer = (j) => regAdj[j] + (slotsMax ? perCompany / 3 : 0);
        // the organization floor may leave room for far fewer companies
        if (orgFloor) {
          const knap = orgRoomBound(S[I.org] + remOrg - N * orgFloor, (j) => supAdj[j], regPer, regBattalions);
          if (knap < compUb) compUb = knap;
        }
        if (C.maxIc) {
          const knap2 = icRoomBound(C.maxIc - S[I.ic] - r * sq.min[I.ic], (j) => supAdj[j], regPer, regBattalions);
          if (knap2 < compUb) compUb = knap2;
        }
        if (anyBoost) for (let s2 = 0; s2 < K; s2++) if (c[s2] > 0) compUb += c[s2] * placedBoost[s2];
      }
      const nodeUb = c0 + lineUb + compUb;
      if (nodeUb <= threshold() + tol) return;
      if (aborted) { leaveOpen(nodeUb); return; }

      const x0 = L[q];
      const t = x0.col;
      const others = colsUsed() - Math.ceil(ct[t] / cs);
      const cap = Math.min(r, (MAX_COLUMNS - others) * cs - ct[t]);
      const last = q === T - 1;
      for (let x = last ? r : cap; x >= (last ? r : 0); x--) {
        if (last && x > cap) return;
        if (x > 0) {
          const w = S[I.width] + x * x0.u.width;
          const rr = r - x;
          if (w + (rr ? rr * (q + 1 < T ? suf[q + 1].wMin : Infinity) : 0) > C.wmax + 1e-9) continue;
          if (rr && q + 1 >= T) continue;
          if (!rr && w < C.wmin - 1e-9) continue;
        } else if (last) continue;
        const pArm = armMax; const pPier = pierMax; const pSpd = spdMin;
        if (x > 0) {
          for (let s = 0; s < K; s++) { S[s] += x * x0.v[s]; placedBoost[s] += x * x0.boost[s]; }
          cnt[x0.i] += x; ct[t] += x; placed += x;
          armMax = Math.max(armMax, x0.u.arm); pierMax = Math.max(pierMax, x0.u.pier);
          if (x0.u.affectsSpeed && x0.u.spd > 0) spdMin = Math.min(spdMin, x0.u.spd);
        }
        dfs(q + 1);
        if (x > 0) {
          for (let s = 0; s < K; s++) { S[s] -= x * x0.v[s]; placedBoost[s] -= x * x0.boost[s]; }
          cnt[x0.i] -= x; ct[t] -= x; placed -= x;
          armMax = pArm; pierMax = pPier; spdMin = pSpd;
        }
        if (aborted) { leaveOpen(nodeUb); return; }
      }
    };
    dfs(0);
  }

  // The seeds set the bar, so a seed's own template is pruned by it: put the best seed back if nothing beat it.
  if (seedBest && (!ranked.length || ranked[0].score < seedBest.score - 1e-9)) {
    ranked = [seedBest, ...ranked.filter((e) => e.archetype !== seedBest.archetype)].sort((a, b) => b.score - a.score);
  }
  const gap = aborted ? Math.max(0, openUb - (ranked[0]?.score ?? -Infinity)) : 0;
  return { ranked: ranked.slice(0, topN), pool, seedPool, nodes, leaves, aborted, gap };
}

function shareOk(cnt, n, C) {
  const armor = cnt.armor || 0; const mobile = cnt.mobile || 0;
  if (C.minArmorShare && armor / n < C.minArmorShare - 1e-9) return false;
  if (C.maxArmorShare && armor / n > C.maxArmorShare + 1e-9) return false;
  if (C.minMobileShare && mobile / n < C.minMobileShare - 1e-9) return false;
  if (C.maxMobileShare && mobile / n > C.maxMobileShare + 1e-9) return false;
  if (C.minArmorBattalions && armor < C.minArmorBattalions) return false;
  if (C.maxArmorBattalions && armor > C.maxArmorBattalions) return false;
  return true;
}

function archetypeOf(items, byId) {
  const cnt = new Map();
  for (const id of items) cnt.set(id, (cnt.get(id) || 0) + 1);
  let lead = null;
  for (const [id, n] of cnt) if (!lead || n > cnt.get(lead) || (n === cnt.get(lead) && id < lead)) lead = id;
  const cols = COLUMN_TYPES.filter((t) => items.some((id) => byId.get(id).cat === t));
  return `${cols.join('+')}:${lead}`;
}

const COL_LABEL = { infantry: 'Infantry', artillery: 'Artillery', mobile: 'Mobile', mobile_artillery: 'Mobile artillery', armor: 'Armor' };
export function archetypeLabel(arch, byId) {
  const [cols, lead] = arch.split(':');
  return `${cols.split('+').map((c) => COL_LABEL[c] || c).join(' + ')}, led by ${byId.get(lead)?.name || lead}`;
}

// ---------------------------------------------------------------- public entry point
function setup(game, params) {
  const C = { ...DEFAULT_CONSTRAINTS, ...(params.constraints || {}) };
  const opts = { ...DEFAULT_OPTS, ...(params.opts || {}) };
  const mods = params.mods || {};
  const weights = params.weights || {};
  return { C, opts, mods, weights };
}

// The answer is proven optimal to within this share: no template beats it by more than a 0.5% gain on every priority.
export const GAP_SHARE = 0.005;

/**
 * Find the best templates for a setup.
 * params: { techs, doctrine, exclude, weights, constraints, mods, opts, enemy, topN, coDesign (default true),
 *           sensitivity (default false), nodeLimit }
 */
export function search(game, params, onProgress = null) {
  const t0 = Date.now();
  const { C, opts, mods, weights } = setup(game, params);
  const topN = params.topN || 10;
  const setupBase = { techs: params.techs, doctrine: params.doctrine, exclude: params.exclude };

  const baseResolved = resolve(game, { ...setupBase, design: weights });
  const base0 = { units: [...baseResolved.byId.values()], designs: baseResolved.designs, columnSize: baseResolved.columnSize };
  if (!baseResolved.combat.length) return { ...base0, error: 'No battalions can be built with this research. Research infantry weapons or a tank chassis first.' };
  const enemy = enemyStats(params.enemy, baseResolved.byId, baseResolved.columnSize);
  if (params.enemy && params.enemy.id && params.enemy.id !== 'none' && !enemy) {
    return { ...base0, error: 'The opponent cannot be built with this research. Pick another opponent or enter its stats.' };
  }
  const terms = objectiveTerms(weights, C, enemy);
  if (!terms.length) return { ...base0, error: 'Set at least one priority above zero.' };
  const P = { C, opts, mods, terms, enemy };
  const tolerance = GAP_SHARE * terms.reduce((a, t) => a + t.w, 0);
  const nodeLimit = params.nodeLimit || DEFAULT_NODE_LIMIT;

  // ---- tank designs chosen together with the template (see design.js). These rounds only need a strong template
  // to measure the designs against, so they get a smaller budget; the final search below does the proving. ----
  let resolved = baseResolved;
  let designLog = [];
  let quick = null;
  if (params.coDesign !== false && Object.keys(baseResolved.designs).length) {
    let first = true;
    const out = coDesign(game, { ...setupBase, weights }, baseResolved, (res, seeds) => {
      const r = branchAndBound(res, P, { topN: 1, window: 0, nodeLimit: Math.min(nodeLimit, CODESIGN_NODE_LIMIT), seeds, tolerance });
      const e = r.ranked[0] || null;
      if (e && first && onProgress) {
        // show something useful straight away; the tank designs and the proof follow
        first = false;
        const st = evaluate(e.tpl, res.byId, mods, opts, res.columnSize);
        const tpl = { items: orderItems(e.tpl.items, res.byId), support: e.tpl.support, reg: e.tpl.reg };
        onProgress({ units: [...res.byId.values()], designs: res.designs, columnSize: res.columnSize, top: [{ ...tpl, key: templateKey(tpl), score: utility(st, terms, enemy), stats: st, archetype: e.archetype, archetypeLabel: archetypeLabel(e.archetype, res.byId) }], terms, enemy, proven: false, provisional: true, ms: Date.now() - t0 });
      }
      return e;
    }, P);
    resolved = out.resolved;
    designLog = out.log;
    quick = out.best;
  }
  const { byId, columnSize } = resolved;
  const base = { units: [...byId.values()], designs: resolved.designs, columnSize };

  // Final numbers come from evaluate(), the same function the page uses, so what is shown is what was scored.
  const fin = (e) => {
    const st = evaluate(e.tpl, byId, mods, opts, columnSize);
    const tpl = { items: orderItems(e.tpl.items, byId), support: e.tpl.support, reg: e.tpl.reg };
    const arch = e.archetype || archetypeOf(e.tpl.items, byId);
    return { ...tpl, key: templateKey(tpl), score: utility(st, terms, enemy), stats: st, archetype: arch, archetypeLabel: archetypeLabel(arch, byId) };
  };
  if (quick && onProgress) {
    const t = fin(quick);
    onProgress({ ...base, top: [t], terms, enemy, designLog, proven: false, provisional: true, ms: Date.now() - t0 });
  }

  // ---- the proof: exact search for the single best template ----
  const run = branchAndBound(resolved, P, { topN: 1, window: 0, nodeLimit, seeds: quick ? [quick.tpl] : [], tolerance });
  if (!run.ranked.length) {
    return { ...base, error: run.aborted ? 'The search ran out of room before finding a legal template. Narrow the combat width range.' : 'No template satisfies these limits. Widen the combat width range or relax the organization, armor, share or cost limits.', explored: run.leaves, nodes: run.nodes, ms: Date.now() - t0 };
  }

  // ---- every legal template the search completed or started from: the candidate pool ----
  const seen = new Set();
  const candidates = [];
  for (const e of [...run.ranked, ...run.pool, ...run.seedPool]) {
    const key = templateKey(e.tpl);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...e, key, archetype: e.archetype || archetypeOf(e.tpl.items, byId) });
  }
  candidates.sort((a, b) => b.score - a.score);

  // ---- ranked list: the proven winner, then the best template of each other archetype, then close variants ----
  const top = [fin(run.ranked[0])];
  const lineDist = (a, b) => {
    const m = new Map();
    for (const id of a) m.set(id, (m.get(id) || 0) + 1);
    for (const id of b) m.set(id, (m.get(id) || 0) - 1);
    let d = 0; for (const v of m.values()) d += Math.abs(v);
    return d;
  };
  const usedArch = new Set([top[0].archetype]);
  for (const e of candidates) {
    if (top.length >= topN) break;
    if (usedArch.has(e.archetype)) continue;
    usedArch.add(e.archetype);
    top.push(fin(e));
  }
  for (const e of candidates) {
    if (top.length >= topN) break;
    if (top.some((t) => t.key === e.key || lineDist(t.items, e.tpl.items) < 6)) continue;
    top.push(fin(e));
  }
  top.sort((a, b) => b.score - a.score);
  const ref = top[1]?.stats || null;
  top[0].explain = explain(top[0].stats, ref, terms, enemy);

  // ---- Pareto front of the candidates, over the scored stats ----
  const AX = ['width', 'sa', 'ha', 'brk', 'def', 'org', 'hp', 'arm', 'pier', 'spd', 'rel', 'ic', 'mp', 'sup'];
  const poolEntries = candidates.slice(0, POOL_OUT);
  for (const t of top) if (!poolEntries.some((e) => e.key === t.key)) poolEntries.push({ tpl: t, st: t.stats, score: t.score, key: t.key });
  // each entry as its per-stat score contributions; one entry dominates another if it is no worse on any of them
  const contrib = poolEntries.map((e) => {
    const m = enemy ? matchup(e.st, enemy) : null;
    return terms.map((t) => termScore(t, t.kind === 'matchup' ? m[t.key] : termValue(t, e.st, enemy)));
  });
  const geq = (a, b) => { let strict = false; for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - 1e-9) return false; if (a[i] > b[i] + 1e-9) strict = true; } return strict; };
  const frontIdx = [];
  for (let i = 0; i < poolEntries.length; i++) {
    if (frontIdx.some((f) => geq(contrib[f], contrib[i]))) continue;
    for (let q = frontIdx.length - 1; q >= 0; q--) if (geq(contrib[i], contrib[frontIdx[q]])) frontIdx.splice(q, 1);
    frontIdx.push(i);
  }
  const frontKeys = new Set(frontIdx.map((i) => poolEntries[i].key));
  const poolOut = []; const poolKeys = []; const poolScore = []; const poolFront = [];
  for (const e of poolEntries) {
    const o = {}; for (const k of AX) o[k] = e.st[k];
    if (enemy) { const m = matchup(e.st, enemy); o.mAtk = m.mAtk; o.mDef = m.mDef; }
    poolOut.push(o); poolKeys.push(e.key); poolScore.push(e.score); poolFront.push(frontKeys.has(e.key));
  }

  return {
    ...base, top, pool: poolOut, poolKeys, poolScore, poolFront, frontSize: frontKeys.size,
    terms, enemy, designLog, proven: !run.aborted || run.gap <= tolerance, gap: run.gap, tolerance, explored: run.leaves + run.seedPool.length, nodes: run.nodes,
    sensitivity: sensitivity(params.weights, P, candidates, top[0].key, byId),
    ms: Date.now() - t0,
  };
}

/**
 * How the winner changes when one priority moves by 1 or 2: every candidate the search found is re-scored with the
 * changed priority. A priority whose small change flips the winner marks a fragile pick.
 */
export function sensitivity(weights, P, candidates, winner, byId) {
  const rows = [];
  for (const term of P.terms) {
    const w0 = weights[term.key] || 0;
    const changes = [];
    for (const d of [-2, -1, 1, 2]) {
      const w1 = w0 + d * Math.sign(w0 || 1);
      if (w1 !== 0 && Math.sign(w1) !== Math.sign(w0)) continue;
      const terms = objectiveTerms({ ...weights, [term.key]: w1 }, P.C, P.enemy);
      if (!terms.length) continue;
      let bestE = null; let bestS = -Infinity;
      for (const e of candidates) { const sc = utility(e.st, terms, P.enemy); if (sc > bestS) { bestS = sc; bestE = e; } }
      if (!bestE) continue;
      changes.push({ delta: d, weight: w1, same: bestE.key === winner, key: bestE.key, items: orderItems(bestE.tpl.items, byId), support: bestE.tpl.support, reg: bestE.tpl.reg });
    }
    const flips = changes.filter((c) => !c.same).map((c) => Math.abs(c.delta));
    rows.push({ key: term.key, label: term.label, weight: w0, changes, fragile: flips.length ? Math.min(...flips) : null });
  }
  return { rows, candidates: candidates.length };
}

export { regFitsColumn };
