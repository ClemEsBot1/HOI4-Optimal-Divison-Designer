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
 *   minStats                stat -> least final value a legal design must have (a fleet's speed floor); pruned slot by
 *                           slot with the most the remaining slots could still give the stat
 *   keep                    how many of the best designs to return (ranked, best first; default 1)
 *   budget, gap
 *
 * Options in a slot that another option of the same category beats on every scored stat are dropped first (it can
 * never lose to drop them), interchangeable custom slots are filled in a fixed order, and a bound that relaxes the
 * score slot by slot rules out the rest without scoring them.
 */
export function exactDesign(spec) {
  const { modules, hulls, floor = {}, budget = 6e5, gap = 0 } = spec;
  const atLeast = spec.atLeast || [];
  // a stat with a minimum is tracked like a scored one with weight 0, so no option that raises it is dropped
  const minStats = spec.minStats || {};
  const weights = { ...Object.fromEntries(Object.keys(minStats).map((k) => [k, 0])), ...spec.weights };
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
        ...Object.keys(minStats).flatMap((k) => [m.add[k] || 0, m.mul[k] || 0, m.avg[k] || 0]),
      ];
      const kept = mods.filter((m) => !mods.some((o) => o !== m && o.cat === m.cat && !(limited.has(o.id) && !limited.has(m.id)) && (() => {
        const x = vec(o); const y = vec(m); let strict = false;
        for (let i = 0; i < x.length; i++) { if (x[i] < y[i] - 1e-12) return false; if (x[i] > y[i] + 1e-12) strict = true; }
        return strict || (x.every((v, i) => Math.abs(v - y[i]) < 1e-12) && o.id < m.id && limited.has(o.id) === limited.has(m.id));
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
     */
    const relax = (i) => {
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
        if (isRel[q] || MLo <= 0 || xLo < 0 || tLo[q] <= 0) {
          // outside what the linearization covers: the stat's best value over the box
          C += w > 0 ? w * Math.log(Math.max(0, xHi) + F) : w * Math.log(Math.max(0, xLo) + F);
          continue;
        }
        let c; let c0;
        if (w > 0) {
          const x0 = Math.min(xHi, Math.max(xLo, bestX[q])) + F;
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
    // the most a stat with a minimum can still reach: the best corner of what the remaining slots can add, average
    // and multiply, times the technology bonus of any type the hull can become
    const minQ = Object.entries(minStats).map(([k, v]) => [keys.indexOf(k), v]);
    const reachable = (q, i) => {
      const S = suf[q]; const remL = S.vL[i]; const remU = S.vU[i];
      let vLo; let vHi;
      if (pAvgN[q] > 0) {
        const cur = pAvgSum[q] / pAvgN[q];
        vLo = remL == null ? cur : Math.min(cur, remL); vHi = remU == null ? cur : Math.max(cur, remU);
      } else {
        vLo = remL == null ? 0 : Math.min(0, remL); vHi = remU == null ? 0 : Math.max(0, remU);
      }
      const A0 = B[q] + pAdd[q]; const M0 = 1 + pMul[q];
      let hi = -Infinity;
      for (const A of [A0 + S.aL[i] + vLo, A0 + S.aU[i] + vHi]) {
        for (const M of [M0 + S.mL[i], M0 + S.mU[i]]) for (const t of [tLo[q], tHi[q]]) hi = Math.max(hi, A * M * t);
      }
      return isRel[q] ? Math.min(1, hi) : hi;
    };
    const chosen = new Array(nS).fill(null);
    const order = Array.from({ length: nS }, (_, j) => options[j].map((_, o) => o));
    let hullNodes = 0; let stop = false;
    const rec = (i) => {
      nodes++;
      if (++hullNodes > budget) { stop = true; truncated = true; return; }
      for (let c = 0; c < nC; c++) if (pNet[c] + netHi[c][i] < -1e-9) return;
      for (const [q, v] of minQ) if (reachable(q, i) < v - 1e-9) return;
      if (i === nS) {
        const type = spec.typeOf(hull, chosen);
        if (!spec.accept(hull, chosen, type)) return;
        evaluated++;
        if (top.length >= keep && leafScore(type) <= bar() + 1e-12) return;
        const mods = Object.fromEntries(slotNames.map((n, k) => [n, chosen[k]]));
        const st = spec.stats(hull, mods);
        if (minQ.some(([q, v]) => (st[keys[q]] || 0) < v - 1e-9)) return;
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
        C = relax(i);
        maxAt[nS] = 0;
        for (let j = nS - 1; j >= i; j--) {
          const vals = valAt[j]; let mx = -Infinity;
          for (let o = 0; o < vals.length; o++) {
            const a = optAdd[j][o]; const m = optMul[j][o]; let x = 0;
            for (let q = 0; q < nK; q++) x += ca[q] * a[q] + cm[q] * m[q];
            vals[o] = x; if (x > mx) mx = x;
          }
          maxAt[j] = maxAt[j + 1] + mx;
        }
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
