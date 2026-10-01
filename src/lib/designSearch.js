/**
 * Exact module search shared by the ship and aircraft designers.
 *
 *   exactDesign(spec) -> { score, hull, hullName, modules, stats, ranked, evaluated, nodes, truncated } or null
 *
 * Stat model (both designers): stat = (hull + module additions + average of averaged stats) * (1 + module multipliers)
 *   * (1 + technology bonus for the design's type). The score is sum(weight * ln(stat + floor)); a negative weight
 * marks a stat the role wants low (cost, visibility).
 *
 * spec:
 *   modules                 id -> { id, cat, add, mul, avg }
 *   hulls                   hull variants: { id, name, stats, slots, limits }
 *   weights, floor          the objective
 *   slotOptions(hull, slotName, slot)   modules this slot may take (year and role filters already applied)
 *   typesOf(hull)           every type this hull can become; typeOf(hull, chosenIds) the type of one design
 *   bonusOf(type, hull)     technology bonuses for a type (on that hull), stat -> fraction
 *   interchangeable         slot names that are interchangeable when they take the same modules (default /custom/)
 *   stats(hull, modulesBySlot)          the design's final stats (what the score is taken from)
 *   accept(hull, chosenIds, type, stats?)  role requirements on a complete design
 *   atLeast                 [[a, b], ...]: a design is legal only when the summed additions of a reach those of b
 *                           (planes: thrust must cover weight); pruned slot by slot
 *   keep                    how many of the best designs to return (ranked, best first; default 1)
 *   budget, gap
 *
 * Options in a slot that another option of the same category beats on every scored stat are dropped first (it can
 * never lose to drop them). With `dropUseless`, in optional slots other than `keepSlot` (the slots that decide the
 * design's type), so are modules that leaving the slot empty beats (dead weight for the role) and modules an
 * option under no count limit beats whatever its category, interchangeable custom slots are filled in a fixed order, and a bound that relaxes the
 * score slot by slot rules out the rest without scoring them.
 */
const TANGENT_ROUNDS = 2;

/**
 * The smallest t >= 0 whose tangent to ln(x + F) passes at or above ln(F) at x = xLo < 0: tangents at t or beyond bound
 * ln(max(0, x) + F) from above on [xLo, inf).
 */
function tangentFloor(xLo, F) {
  const h = (t) => Math.log(1 + t / F) + (xLo - t) / (t + F);
  let lo = 0; let hi = Math.max(1, -xLo);
  while (h(hi) < 0) hi *= 2;
  for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (h(m) < 0) lo = m; else hi = m; }
  return hi;
}

export function exactDesign(spec) {
  const { modules, hulls, weights, floor = {}, budget = 6e5, gap = 0 } = spec;
  const atLeast = spec.atLeast || [];
  const keys = Object.keys(weights);
  let best = null; let evaluated = 0; let truncated = false; let nodes = 0;
  // the `keep` best designs found so far, best first; the search proves each of them against everything it rules out
  const keep = Math.max(1, spec.keep || 1);
  const top = [];
  const bar = () => (top.length >= keep ? top[keep - 1].score : -Infinity);
  let bestX = null; // the incumbent's scored stats, where the relaxation takes its tangents
  // gap 0.005 would accept a design within a 0.5% gain on every scored stat of the best; 0 proves the exact best
  const tol = gap * keys.reduce((a, k) => a + Math.abs(weights[k]), 0);
  const dirOf = (k) => (weights[k] < 0 ? -1 : 1);
  const scoreOf = (s) => {
    let x = 0;
    for (const k of keys) x += weights[k] * Math.log(Math.max(0, s[k] || 0) + (floor[k] ?? 1));
    return x;
  };
  const EMPTY = { add: {}, mul: {}, avg: {} };
  const modOf = (id) => (id ? modules[id] : EMPTY);

  for (const hull of hulls) {
    const names0 = Object.keys(hull.slots || {}).filter((n) => hull.slots[n]);
    const limits = hull.limits || [];
    // a module named in a count limit is not interchangeable with one that is not, so it is never used to drop another
    const limited = new Set(limits.filter((l) => l.module).map((l) => l.module));
    const optionsOf = (n) => {
      const slot = hull.slots[n];
      const mods = spec.slotOptions(hull, n, slot);
      const vec = (m) => [
        ...keys.flatMap((k) => { const d = dirOf(k); return [d * (m.add[k] || 0), d * (m.mul[k] || 0), d * (m.avg[k] || 0)]; }),
        ...atLeast.flatMap(([a, b]) => [m.add[a] || 0, -(m.add[b] || 0), m.mul[a] || 0, -(m.mul[b] || 0)]),
      ];
      const beats = (x, y) => { let strict = false; for (let i = 0; i < x.length; i++) { if (x[i] < y[i] - 1e-12) return false; if (x[i] > y[i] + 1e-12) strict = true; } return strict; };
      const free = (o) => !limited.has(o.id) && !limits.some((l) => l.category === o.cat);
      const optional = !slot.required && spec.dropUseless && !(spec.keepSlot && spec.keepSlot.test(n));
      const zero = optional ? vec(EMPTY) : null;
      const kept = mods.filter((m) => !(zero && beats(zero, vec(m))) && !mods.some((o) => o !== m && !(limited.has(o.id) && !limited.has(m.id)) && (o.cat === m.cat || (optional && free(o))) && (() => {
        const x = vec(o); const y = vec(m);
        return beats(x, y) || (o.cat === m.cat && x.every((v, i) => Math.abs(v - y[i]) < 1e-12) && o.id < m.id && limited.has(o.id) === limited.has(m.id));
      })()));
      const ids = kept.map((m) => m.id);
      if (!slot.required || !ids.length) ids.push(null);
      // most promising first, so a strong design is found early and prunes the rest
      const alone = (id) => scoreOf(spec.stats(hull, id ? { [n]: id } : {}));
      const val = new Map(ids.map((id) => [id, alone(id)]));
      return ids.sort((x, y) => val.get(y) - val.get(x));
    };
    // fixed slots first (they carry the main weapon, battery and armor), then the interchangeable ones
    const custom = (n) => (spec.interchangeable || /custom/).test(n);
    const slotNames = [...names0.filter((n) => !custom(n)), ...names0.filter(custom)];
    const options = slotNames.map(optionsOf);
    const sig = options.map((o, i) => (custom(slotNames[i]) ? o.join(',') : null));
    const limitsOk = (chosen, upto) => limits.every((l) => {
      let n = 0;
      for (let i = 0; i < upto; i++) { const id = chosen[i]; if (id && (id === l.module || modules[id].cat === l.category)) n++; }
      return l.op === '<' ? n < l.count : l.op === '<=' ? n <= l.count : true;
    });

    // per remaining slots: most and least each module can add / multiply, and the best averaged value
    const range = slotNames.map((n, i) => Object.fromEntries(keys.map((k) => {
      const ms = options[i].map(modOf);
      const adds = ms.map((m) => m.add[k] || 0); const muls = ms.map((m) => m.mul[k] || 0);
      const avgs = ms.filter((m) => k in m.avg).map((m) => m.avg[k]);
      return [k, { addHi: Math.max(...adds), addLo: Math.min(...adds), mulHi: Math.max(...muls), mulLo: Math.min(...muls), avgHi: avgs.length ? Math.max(...avgs) : null, avgLo: avgs.length ? Math.min(...avgs) : null }];
    })));
    // technology bonuses for any type this hull could become
    const types = spec.typesOf(hull);
    const tb = types.map((t) => spec.bonusOf(t, hull));
    const tbBy = Object.fromEntries(types.map((t, i) => [t, tb[i]]));
    const typeHi = Object.fromEntries(keys.map((k) => [k, tb.length ? Math.max(...tb.map((b) => b[k] || 0)) : 0]));
    const typeLo = Object.fromEntries(keys.map((k) => [k, tb.length ? Math.min(...tb.map((b) => b[k] || 0)) : 0]));

    const nS = slotNames.length; const nK = keys.length;
    const W = keys.map((k) => weights[k]);
    const FL = keys.map((k) => floor[k] ?? 1);
    const B = keys.map((k) => hull.stats[k] || 0);
    const isRel = keys.map((k) => k === 'reliability');
    const tLo = keys.map((k) => 1 + typeLo[k]); const tHi = keys.map((k) => 1 + typeHi[k]);
    // suffix sums over the remaining slots: least and most they can add or multiply, and their averaged values
    const suf = keys.map((k) => {
      const aL = new Float64Array(nS + 1); const aU = new Float64Array(nS + 1); const mL = new Float64Array(nS + 1); const mU = new Float64Array(nS + 1);
      const vL = new Array(nS + 1).fill(null); const vU = new Array(nS + 1).fill(null);
      for (let j = nS - 1; j >= 0; j--) {
        const r = range[j][k];
        aL[j] = aL[j + 1] + r.addLo; aU[j] = aU[j + 1] + r.addHi; mL[j] = mL[j + 1] + r.mulLo; mU[j] = mU[j + 1] + r.mulHi;
        vL[j] = r.avgLo == null ? vL[j + 1] : vL[j + 1] == null ? r.avgLo : Math.min(r.avgLo, vL[j + 1]);
        vU[j] = r.avgHi == null ? vU[j + 1] : vU[j + 1] == null ? r.avgHi : Math.max(r.avgHi, vU[j + 1]);
      }
      return { aL, aU, mL, mU, vL, vU };
    });
    // legality margins (a - b) per option, and the most the remaining slots can still add to each
    const nC = atLeast.length;
    const optNet = options.map((ids) => ids.map((id) => Float64Array.from(atLeast, ([a, b]) => (modOf(id).add[a] || 0) - (modOf(id).add[b] || 0))));
    const netHi = atLeast.map((_, c) => {
      const s = new Float64Array(nS + 1);
      for (let j = nS - 1; j >= 0; j--) s[j] = s[j + 1] + Math.max(...optNet[j].map((v) => v[c]));
      return s;
    });
    const pNet = Float64Array.from(atLeast, ([a, b]) => (hull.stats[a] || 0) - (hull.stats[b] || 0));

    const optAdd = options.map((ids) => ids.map((id) => Float64Array.from(keys, (k) => modOf(id).add[k] || 0)));
    const optMul = options.map((ids) => ids.map((id) => Float64Array.from(keys, (k) => modOf(id).mul[k] || 0)));
    const optAvg = options.map((ids) => ids.map((id) => keys.map((k) => (id && k in modules[id].avg ? modules[id].avg[k] : null))));
    const pAdd = new Float64Array(nK); const pMul = new Float64Array(nK); const pAvgSum = new Float64Array(nK); const pAvgN = new Float64Array(nK);
    const apply = (j, o, sign) => {
      const a = optAdd[j][o]; const m = optMul[j][o]; const v = optAvg[j][o];
      for (let q = 0; q < nK; q++) { pAdd[q] += sign * a[q]; pMul[q] += sign * m[q]; if (v[q] != null) { pAvgSum[q] += sign * v[q]; pAvgN[q] += sign; } }
      const t = optNet[j][o];
      for (let c = 0; c < nC; c++) pNet[c] += sign * t[c];
    };
    const ca = new Float64Array(nK); const cm = new Float64Array(nK);
    const corners = new Float64Array(8);
    /*
     * Upper bound on every completion of the current partial design that is separable over the remaining slots. For
     * each scored stat x = T (A + a)(M + m), where a and m are what the remaining slots add and multiply:
     *  - a stat the role maximizes: ln is concave, so its tangent (taken at the incumbent) lies above it;
     *  - a stat it minimizes: -ln is convex, so the chord across the stat's possible range lies above it;
     *  - the product a·m is bounded by its McCormick envelope over the remaining slots' ranges.
     * What is left is a constant plus a linear function of each remaining slot's module, so each slot can take its own
     * best module. Returns the constant and fills ca / cm with the weight of each stat's added and multiplied amount.
     * `tp` holds the points the tangents are taken at: any point gives a valid bound; the incumbent's stats, then those
     * of the relaxation's own best completion, are tried.
     */
    const relax = (i, tp) => {
      let C = 0;
      for (let q = 0; q < nK; q++) {
        const w = W[q]; const F = FL[q]; const S = suf[q];
        const aRL = S.aL[i]; const aRU = S.aU[i]; const mRL = S.mL[i]; const mRU = S.mU[i];
        const remL = S.vL[i]; const remU = S.vU[i];
        let vLo; let vHi;
        if (pAvgN[q] > 0) {
          const cur = pAvgSum[q] / pAvgN[q];
          vLo = remL == null ? cur : Math.min(cur, remL); vHi = remU == null ? cur : Math.max(cur, remU);
        } else {
          vLo = remL == null ? 0 : Math.min(0, remL); vHi = remU == null ? 0 : Math.max(0, remU);
        }
        const A0 = B[q] + pAdd[q]; const M0 = 1 + pMul[q];
        const ALo = A0 + aRL + vLo; const AHi = A0 + aRU + vHi; const MLo = M0 + mRL; const MHi = M0 + mRU;
        corners[0] = ALo * MLo * tLo[q]; corners[1] = ALo * MLo * tHi[q]; corners[2] = ALo * MHi * tLo[q]; corners[3] = ALo * MHi * tHi[q];
        corners[4] = AHi * MLo * tLo[q]; corners[5] = AHi * MLo * tHi[q]; corners[6] = AHi * MHi * tLo[q]; corners[7] = AHi * MHi * tHi[q];
        let xLo = corners[0]; let xHi = corners[0];
        for (let c = 1; c < 8; c++) { if (corners[c] < xLo) xLo = corners[c]; if (corners[c] > xHi) xHi = corners[c]; }
        ca[q] = 0; cm[q] = 0;
        if (isRel[q]) { xLo = Math.max(0, Math.min(1, xLo)); xHi = Math.max(0, Math.min(1, xHi)); }
        // a maximized stat that may end below zero (agility, defense) scores ln(F) there: it keeps a linear bound
        const negOk = xLo < 0 && w > 0 && tLo[q] === tHi[q] && tLo[q] > 0;
        if (isRel[q] || MLo <= 0 || (xLo < 0 && !negOk) || tLo[q] <= 0) {
          // outside what the linearization covers: the stat's best value over the box
          C += w > 0 ? w * Math.log(Math.max(0, xHi) + F) : w * Math.log(Math.max(0, xLo) + F);
          continue;
        }
        let c; let c0;
        if (w > 0) {
          let x0 = Math.min(xHi, Math.max(xLo, tp[q])) + F;
          // below zero the score is flat at ln(F): only tangents at or past t*, whose line still reaches ln(F) at xLo,
          // lie above it there
          if (negOk) x0 = Math.max(x0, tangentFloor(xLo, F) + F);
          c = w / x0; c0 = w * Math.log(x0) + c * (F - x0);
        } else {
          const fL = w * Math.log(xLo + F); const fH = w * Math.log(xHi + F);
          c = xHi - xLo > 1e-9 ? (fH - fL) / (xHi - xLo) : 0; c0 = fL - c * xLo;
        }
        if (c === 0) { C += c0; continue; }
        const up = c > 0; const T = up ? tHi[q] : tLo[q]; const A = A0 + (up ? vHi : vLo); const aX = up ? aRU : aRL;
        C += c0 + c * T * (A * M0 - aX * mRL);
        ca[q] = c * T * (M0 + mRL); cm[q] = c * T * (A + aX);
      }
      return C;
    };
    const valAt = Array.from({ length: nS }, (_, j) => new Float64Array(options[j].length));
    const rawAt = Array.from({ length: nS }, (_, j) => new Float64Array(options[j].length));
    const lamAt = new Float64Array(nS + 1);
    const argAt = new Int32Array(nS + 1);
    // runs of interchangeable slots (same options), which the bound fills as a whole under the count limits
    const groupOf = new Array(nS).fill(null);
    for (let j = 0; j < nS;) {
      let e = j; while (sig[j] && e + 1 < nS && sig[e + 1] === sig[j]) e++;
      if (e > j) { const g = { start: j, end: e }; for (let k = j; k <= e; k++) groupOf[k] = g; }
      j = e + 1;
    }
    const limitIdx = options.map((ids) => ids.map((id) => limits.map((l, li) => (id && (id === l.module || modules[id].cat === l.category) ? li : -1)).filter((x) => x >= 0)));
    const capsBefore = (upto) => limits.map((l) => {
      let n = 0;
      for (let k = 0; k < upto; k++) { const id = chosen[k]; if (id && (id === l.module || modules[id].cat === l.category)) n++; }
      return Math.max(0, (l.op === '<' ? l.count - 1 : l.op === '<=' ? l.count : Infinity) - n);
    });
    // the r largest values a run of slots can take, best first (prefix sums): each option as often as its own
    // tightest limit allows (limits shared between options are relaxed, so this stays an upper bound)
    const topValues = (g, vals, caps, r) => {
      const opt = Array.from(vals.keys()).sort((x, y) => vals[y] - vals[x]);
      const out = new Float64Array(r); const picks = new Int32Array(r); let n = 0; let sum = 0;
      for (const o of opt) {
        if (n >= r) break;
        let cap = r;
        for (const li of limitIdx[g.end][o]) cap = Math.min(cap, caps[li]);
        for (let t = 0; t < cap && n < r; t++) { sum += vals[o]; picks[n] = o; out[n++] = sum; }
      }
      while (n < r) { sum += vals[opt[0]]; picks[n] = opt[0]; out[n++] = sum; }
      g.picks = picks;
      return out;
    };
    const maxAt = new Float64Array(nS + 1);
    const leafScore = (type) => {
      const tbt = tbBy[type] || spec.bonusOf(type, hull);
      let sc = 0;
      for (let q = 0; q < nK; q++) {
        let v = (B[q] + pAdd[q] + (pAvgN[q] > 0 ? pAvgSum[q] / pAvgN[q] : 0)) * (1 + pMul[q]);
        const t = tbt[keys[q]]; if (t) v *= 1 + t;
        if (isRel[q]) v = Math.max(0, Math.min(1, v));
        sc += W[q] * Math.log(Math.max(0, v) + FL[q]);
      }
      return sc;
    };
    const chosen = new Array(nS).fill(null);
    const order = Array.from({ length: nS }, (_, j) => options[j].map((_, o) => o));
    let hullNodes = 0; let stop = false;
    const rec = (i) => {
      nodes++;
      if (++hullNodes > budget) { stop = true; truncated = true; return; }
      for (let c = 0; c < nC; c++) if (pNet[c] + netHi[c][i] < -1e-9) return;
      if (i === nS) {
        const type = spec.typeOf(hull, chosen);
        if (!spec.accept(hull, chosen, type)) return;
        evaluated++;
        if (top.length >= keep && leafScore(type) <= bar() + 1e-12) return;
        const mods = Object.fromEntries(slotNames.map((n, k) => [n, chosen[k]]));
        const st = spec.stats(hull, mods);
        if (spec.acceptStats && !spec.acceptStats(st)) return;
        const sc = scoreOf(st);
        if (top.length < keep || sc > bar() + 1e-12) {
          const d = { score: sc, hull: hull.id, hullName: hull.name, modules: mods, stats: st };
          let at = top.length;
          while (at > 0 && top[at - 1].score < sc) at--;
          top.splice(at, 0, d);
          if (top.length > keep) top.pop();
          if (at === 0) { best = d; bestX = keys.map((k) => Math.max(0, st[k] || 0)); }
        }
        return;
      }
      let idx = order[i];
      let C = 0;
      if (best) {
        const caps = capsBefore(i);
        // fills valAt / maxAt for the slots from i on, for tangent points tp and multiplier lam; returns the bound
        const fill = (lam) => {
          maxAt[nS] = nC === 1 ? lam * pNet[0] : 0;
          for (let j = nS - 1; j >= i; j--) {
            const raw = rawAt[j]; const vals = valAt[j]; const net = optNet[j];
            for (let o = 0; o < vals.length; o++) vals[o] = raw[o] + (nC === 1 ? lam * net[o][0] : 0);
          }
          for (let j = nS - 1; j >= i;) {
            const g = groupOf[j];
            if (!g) { let mx = -Infinity; let at = 0; const v = valAt[j]; for (let o = 0; o < v.length; o++) if (v[o] > mx) { mx = v[o]; at = o; } argAt[j] = at; maxAt[j] = maxAt[j + 1] + mx; j--; continue; }
            // interchangeable slots: the best r modules among them, each at most as often as the count limits allow
            const from = Math.max(g.start, i); const top = topValues(g, valAt[g.end], caps, g.end - from + 1);
            for (let k = g.end; k >= from; k--) { maxAt[k] = maxAt[g.end + 1] + top[g.end - k]; argAt[k] = g.picks[k - from]; }
            j = from - 1;
          }
          return C + maxAt[i];
        };
        const bound = (tp) => {
          C = relax(i, tp);
          for (let j = nS - 1; j >= i; j--) {
            const vals = rawAt[j];
            for (let o = 0; o < vals.length; o++) {
              const a = optAdd[j][o]; const m = optMul[j][o]; let x = 0;
              for (let q = 0; q < nK; q++) x += ca[q] * a[q] + cm[q] * m[q];
              vals[o] = x;
            }
          }
          // Lagrangian relaxation of the legality constraint (one `atLeast` pair): for any lam >= 0, adding
          // lam * (margin) cannot lower the score of a legal design, and lets each slot weigh what a module adds
          // against the thrust it uses. A few multipliers around the last good one are tried; the lowest is kept.
          let b = fill(0); let lam = 0;
          if (nC === 1) {
            const l0 = lamAt[i] || 0.05;
            for (const f of [0.5, 1, 2]) { const x = fill(l0 * f); if (x < b) { b = x; lam = l0 * f; } }
            if (lam) lamAt[i] = lam;
          }
          return [b, lam];
        };
        // the relaxation's own best completion: its stats are the next tangent points
        const completion = () => {
          const out = new Array(nK);
          for (let q = 0; q < nK; q++) {
            let a = B[q] + pAdd[q]; let m = 1 + pMul[q];
            for (let j = i; j < nS; j++) { a += optAdd[j][argAt[j]][q]; m += optMul[j][argAt[j]][q]; }
            out[q] = Math.max(0, a * m);
          }
          return out;
        };
        let tp = bestX; let [b, lam] = bound(tp); let bestTp = tp; let bestLam = lam; let iters = 0;
        fill(lam);
        while (b > bar() + tol && iters++ < TANGENT_ROUNDS) {
          const next = completion();
          tp = tp.map((v, q) => (v + next[q]) / 2);
          const [b2, lam2] = bound(tp);
          if (b2 < b) { b = b2; bestTp = tp; bestLam = lam2; }
        }
        if (bestTp !== tp || iters) { bound(bestTp); fill(bestLam); }
        if (C + maxAt[i] <= bar() + tol) return;
        // best-first: the module the relaxation likes most is tried first
        const vals = valAt[i];
        idx = order[i].slice().sort((x, y) => vals[y] - vals[x]);
      }
      let prevIdx = Infinity;
      for (let j = i - 1; j >= 0; j--) if (sig[j] && sig[j] === sig[i]) { prevIdx = options[j].indexOf(chosen[j]); break; }
      const childVal = best ? valAt[i].slice() : null;
      const rest = best ? C + maxAt[i + 1] : 0;
      for (const k of idx) {
        if (sig[i] && k > prevIdx) continue;
        if (childVal && best && rest + childVal[k] <= bar() + tol) continue;
        chosen[i] = options[i][k];
        if (!limitsOk(chosen, i + 1)) continue;
        apply(i, k, 1);
        rec(i + 1);
        apply(i, k, -1);
        if (stop) break;
      }
      chosen[i] = null;
    };
    rec(0);
  }
  return best ? { ...best, ranked: top, evaluated, nodes, truncated } : null;
}

/** Stats of one design under the shared stat model (before any designer-specific rule). */
export function moduleStats(modules, hullStats, chosen) {
  const s = { ...hullStats };
  const mul = {}; const avg = {};
  for (const id of Object.values(chosen)) {
    const m = id && modules[id];
    if (!m) continue;
    for (const [k, v] of Object.entries(m.add)) s[k] = (s[k] || 0) + v;
    for (const [k, v] of Object.entries(m.mul)) mul[k] = (mul[k] || 0) + v;
    for (const [k, v] of Object.entries(m.avg)) (avg[k] ||= []).push(v);
  }
  for (const [k, vs] of Object.entries(avg)) s[k] = (s[k] || 0) + vs.reduce((a, b) => a + b, 0) / vs.length;
  for (const [k, v] of Object.entries(mul)) s[k] = (s[k] || 0) * (1 + v);
  return s;
}
