/**
 * Template search.
 *
 * The space (up to 25 line battalions of ~40 types, five support companies, five regimental companies) is far too
 * large to enumerate, so this runs seeded hill climbing from many random and hand-built starting points, keeps every
 * feasible template it evaluates, and returns the best ones that differ meaningfully from each other.
 */
import { resolve, MAX_COLUMNS, MAX_SUPPORT } from './game.js';
import { evaluate, columnsNeeded, planColumns, supportConflict, regFitsColumn, STATS, DEFAULT_OPTS, COLUMN_TYPES } from './stats.js';

export const DEFAULT_CONSTRAINTS = { wmin: 0, wmax: 45, minOrg: 0, minArm: 0, maxIc: 0, perWidth: false };

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

// ---- deterministic random numbers so the same setup gives the same answer ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADDITIVE = new Set(['sa', 'ha', 'brk', 'air', 'def', 'hp', 'ic', 'mp', 'sup', 'trucks', 'recon']);

export function search(game, params) {
  const t0 = Date.now();
  const budget = params.ms || 2500;
  const C = { ...DEFAULT_CONSTRAINTS, ...(params.constraints || {}) };
  const opts = { ...DEFAULT_OPTS, ...(params.opts || {}) };
  const mods = params.mods || {};
  const weights = params.weights || {};
  const topN = params.topN || 10;

  const resolved = resolve(game, { techs: params.techs, doctrine: params.doctrine, design: weights, exclude: params.exclude });
  const { byId, columnSize } = resolved;
  const base = { units: [...byId.values()], designs: resolved.designs, columnSize };
  const lineByCol = Object.fromEntries(COLUMN_TYPES.map((c) => [c, []]));
  for (const u of resolved.combat) lineByCol[u.cat].push(u);
  const cols = Object.keys(lineByCol).filter((c) => lineByCol[c].length);
  if (!cols.length) return { ...base, error: 'No battalions can be built with this research. Research infantry weapons or a tank chassis first.' };
  const active = STATS.filter((s) => weights[s.key]);
  if (!active.length) return { ...base, error: 'Set at least one priority above zero.' };

  const R = rng(0x9e3779b1);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];

  const divSupport = resolved.support;
  const regSupport = resolved.regimental;

  // ---------- validity ----------
  const supportOk = (tpl) => {
    if (tpl.support.length > MAX_SUPPORT) return false;
    for (let i = 0; i < tpl.support.length; i++) for (let j = i + 1; j < tpl.support.length; j++) {
      if (supportConflict(byId.get(tpl.support[i]), byId.get(tpl.support[j]))) return false;
    }
    // Companies are unique support slots; don't let a hill-climb create duplicate regimental companies.
    if (new Set(tpl.reg).size !== tpl.reg.length) return false;
    const counts = countOf(tpl.items);
    const armorRegs = tpl.reg.filter((id) => byId.get(id).tank).length;
    const otherRegs = tpl.reg.length - armorRegs;
    return planColumns(counts, columnSize, armorRegs, otherRegs).ok;
  };

  let explored = 0;
  const pool = new Map(); // key -> { key, tpl, stats, score }

  // ---------- scoring ----------
  // Every stat is scored by its percentage change: weight * ln(1 + value / s), so +10% attack counts the same on
  // a 100-attack division as on a 1000-attack one and cost, attack and organization can share one scale.
  const PERK_VALUE = 0.3;
  let scale = {};
  const valueOf = (st, key) => {
    const v = st[key] || 0;
    return C.perWidth && ADDITIVE.has(key) && st.width > 0 ? v / st.width : v;
  };
  const rawScore = (st) => {
    let s = 0;
    for (const a of active) {
      if (a.perk) { s += weights[a.key] * PERK_VALUE * (st[a.key] > 0 ? 1 : 0); continue; }
      s += weights[a.key] * a.dir * Math.log1p(Math.max(0, valueOf(st, a.key)) / scale[a.key]);
    }
    // Very low organization is not a practical division even when its attack looks attractive.
    // The role target is a soft lower bound: it rewards usable formations without making every role identical.
    if (C.orgTarget && st.org < C.orgTarget) {
      const gap = (C.orgTarget - st.org) / C.orgTarget;
      s -= 6 * gap * gap;
    }
    return s;
  };
  const violation = (st) => {
    let v = 0;
    if (st.width < C.wmin) v += C.wmin - st.width;
    if (st.width > C.wmax) v += st.width - C.wmax;
    if (C.minOrg && st.org < C.minOrg) v += C.minOrg - st.org;
    if (C.minArm && st.arm < C.minArm) v += C.minArm - st.arm;
    if (C.maxIc && st.ic > C.maxIc) v += (st.ic - C.maxIc) / 50;
    const armorShare = st.n ? (st.cnt.armor || 0) / st.n : 0;
    if (C.minArmorShare && armorShare < C.minArmorShare) v += (C.minArmorShare - armorShare) * 20;
    if (C.maxArmorShare && armorShare > C.maxArmorShare) v += (armorShare - C.maxArmorShare) * 20;
    if (C.minArmorBattalions && (st.cnt.armor || 0) < C.minArmorBattalions) v += C.minArmorBattalions - (st.cnt.armor || 0);
    if (C.maxArmorBattalions && (st.cnt.armor || 0) > C.maxArmorBattalions) v += (st.cnt.armor || 0) - C.maxArmorBattalions;
    return v;
  };
  const PENALTY = 500;

  const evalTpl = (tpl) => {
    const st = evaluate(tpl, byId, mods, opts, columnSize);
    if (!st || !st.valid || !supportOk(tpl)) return null;
    explored++;
    const viol = violation(st);
    const score = rawScore(st);
    const total = score - PENALTY * viol;
    if (viol === 0) {
      const key = templateKey(tpl);
      if (!pool.has(key)) pool.set(key, { key, tpl: { items: tpl.items.slice(), support: tpl.support.slice(), reg: tpl.reg.slice() }, stats: st, score });
    }
    return { st, score, total, viol };
  };

  // ---------- template construction ----------
  const colOf = (id) => byId.get(id).cat;
  const countOf = (items) => { const c = Object.fromEntries(COLUMN_TYPES.map((t) => [t, 0])); for (const id of items) c[colOf(id)]++; return c; };
  const canAdd = (items, id) => {
    const c = countOf(items); c[colOf(id)]++;
    return columnsNeeded(c, columnSize) <= MAX_COLUMNS;
  };
  const widthOf = (items) => items.reduce((a, id) => a + byId.get(id).width, 0);

  const randomTemplate = () => {
    const r = R();
    const nCols = r < 0.55 ? 1 : r < 0.9 ? 2 : 3;
    const chosen = [];
    const pool2 = cols.slice();
    while (chosen.length < nCols && pool2.length) chosen.push(pool2.splice(Math.floor(R() * pool2.length), 1)[0]);
    const target = C.wmin + R() * Math.max(0, C.wmax - C.wmin);
    const items = [];
    let guard = 0;
    while (widthOf(items) < target && guard++ < 60) {
      const col = pick(chosen);
      const u = pick(lineByCol[col]);
      if (widthOf(items) + u.width > C.wmax + 0.001 && items.length) continue;
      if (canAdd(items, u.id)) items.push(u.id);
    }
    const support = [];
    const nSup = Math.floor(R() * (MAX_SUPPORT + 1));
    for (let i = 0; i < nSup && divSupport.length; i++) {
      const u = pick(divSupport);
      if (support.every((id) => !supportConflict(byId.get(id), u))) support.push(u.id);
    }
    const reg = [];
    // a column needs three battalions before it can take a regimental company
    const nReg = Math.floor(R() * (Math.min(MAX_COLUMNS, Math.floor(items.length / 3)) + 1));
    for (let i = 0; i < nReg && regSupport.length; i++) reg.push(pick(regSupport).id);
    return { items, support, reg };
  };

  // hand-built seeds: a full division of one unit type, in each column type
  const seeds = [];
  for (const col of cols) for (const u of lineByCol[col]) {
    const items = [];
    while (widthOf(items) + u.width <= C.wmax + 0.001 && canAdd(items, u.id) && items.length < 25) items.push(u.id);
    if (items.length) seeds.push({ items, support: [], reg: [] });
  }

  // ---------- neighbourhood ----------
  const neighbours = (tpl) => {
    const out = [];
    const distinct = [...new Set(tpl.items)];
    const allLine = resolved.combat;
    for (const a of distinct) {
      const i = tpl.items.indexOf(a);
      const without = tpl.items.slice(0, i).concat(tpl.items.slice(i + 1));
      out.push({ ...tpl, items: without });
      for (const b of allLine) if (b.id !== a) out.push({ ...tpl, items: without.concat(b.id) });
    }
    for (const b of allLine) out.push({ ...tpl, items: tpl.items.concat(b.id) });
    // support companies
    for (let i = 0; i < tpl.support.length; i++) {
      const without = tpl.support.slice(0, i).concat(tpl.support.slice(i + 1));
      out.push({ ...tpl, support: without });
      for (const b of divSupport) if (!tpl.support.includes(b.id)) out.push({ ...tpl, support: without.concat(b.id) });
    }
    for (const b of divSupport) if (!tpl.support.includes(b.id)) out.push({ ...tpl, support: tpl.support.concat(b.id) });
    // regimental support
    for (let i = 0; i < tpl.reg.length; i++) {
      const without = tpl.reg.slice(0, i).concat(tpl.reg.slice(i + 1));
      out.push({ ...tpl, reg: without });
      for (const b of regSupport) if (b.id !== tpl.reg[i]) out.push({ ...tpl, reg: without.concat(b.id) });
    }
    for (const b of regSupport) out.push({ ...tpl, reg: tpl.reg.concat(b.id) });
    return out;
  };

  const climb = (start) => {
    let cur = start;
    let curEval = evalTpl(cur);
    if (!curEval) { cur = { ...cur, reg: [] }; curEval = evalTpl(cur); }
    if (!curEval) return;
    for (let step = 0; step < 80 && Date.now() - t0 < budget; step++) {
      let best = null; let bestEval = null;
      for (const n of neighbours(cur)) {
        const e = evalTpl(n);
        if (e && (!bestEval || e.total > bestEval.total)) { best = n; bestEval = e; }
      }
      if (!bestEval || bestEval.total <= curEval.total + 1e-9) break;
      cur = best; curEval = bestEval;
    }
  };

  // ---------- calibrate score scale from a random sample ----------
  const sample = [];
  for (let i = 0; i < 400 && sample.length < 200; i++) {
    const t = randomTemplate();
    const st = t.items.length && evaluate(t, byId, mods, opts, columnSize);
    if (st && st.valid) sample.push(st);
  }
  for (const a of active) {
    if (a.perk) continue;
    const vals = sample.map((st) => Math.max(0, valueOf(st, a.key))).filter((v) => v > 0).sort((x, y) => x - y);
    const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    const mean = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
    scale[a.key] = 0.05 * (med > 0 ? med : mean > 0 ? mean : 1);
  }

  // ---------- run ----------
  for (const s of seeds) { if (Date.now() - t0 > budget) break; climb(s); }
  let guard = 0;
  while (Date.now() - t0 < budget && guard++ < 400) climb(randomTemplate());

  if (!pool.size) {
    return { ...base, error: 'No template satisfies these limits. Widen the combat width range or relax the organization, armor or cost limits.', explored, ms: Date.now() - t0 };
  }

  // ---------- pick distinct winners ----------
  const all = [...pool.values()].sort((a, b) => b.score - a.score);
  const sig = (t) => { const m = new Map(); for (const id of t.items) m.set(id, (m.get(id) || 0) + 1); for (const id of t.support) m.set('s:' + id, 1); for (const id of t.reg) m.set('r:' + id, (m.get('r:' + id) || 0) + 1); return m; };
  const dist = (a, b) => { let d = 0; for (const [k, v] of a) d += Math.abs(v - (b.get(k) || 0)); for (const [k, v] of b) if (!a.has(k)) d += v; return d; };
  const top = [];
  const sigs = [];
  const lineSig = (t) => { const m = new Map(); for (const id of t.items) m.set(id, (m.get(id) || 0) + 1); return m; };
  const lineSigs = [];
  // first pass: winners whose battalion mix differs by at least four battalions; second pass fills up with support-only variants
  for (const e of all) {
    const ls = lineSig(e.tpl);
    if (lineSigs.every((o) => dist(ls, o) >= 6)) { top.push(e); lineSigs.push(ls); sigs.push(sig(e.tpl)); if (top.length >= topN) break; }
  }
  if (top.length < topN) {
    for (const e of all) {
      if (top.includes(e)) continue;
      const s = sig(e.tpl);
      if (sigs.every((o) => dist(s, o) >= 3)) { top.push(e); sigs.push(s); if (top.length >= topN) break; }
    }
  }
  const fin = (e) => ({ items: orderItems(e.tpl.items, byId), support: e.tpl.support, reg: e.tpl.reg, key: e.key, score: e.score, stats: e.stats });

  // ---------- sample for the trade-off chart ----------
  const AX = ['width', 'sa', 'ha', 'brk', 'def', 'org', 'hp', 'arm', 'pier', 'spd', 'ic', 'mp'];
  const stride = Math.max(1, Math.floor(all.length / 1500));
  const poolOut = []; const poolKeys = [];
  for (let i = 0; i < all.length; i += stride) {
    const o = {}; for (const k of AX) o[k] = all[i].stats[k];
    poolOut.push(o); poolKeys.push(all[i].key);
  }
  for (const e of top) if (!poolKeys.includes(e.key)) { const o = {}; for (const k of AX) o[k] = e.stats[k]; poolOut.push(o); poolKeys.push(e.key); }

  return { ...base, top: top.map(fin), pool: poolOut, poolKeys, explored, ms: Date.now() - t0 };
}

export { regFitsColumn };
