/**
 * Game engine for Division Desk. Pure functions over the extractor output (src/data/game.json).
 * No imports of the JSON here so the same code runs in the page, the worker and Node tests.
 *
 *   buildGame(raw)                          index the raw data
 *   researchTech / unresearchTech           edit a set of researched techs, keeping the tree valid
 *   techsUpTo(game, year)                   a sensible "everything up to year N" set
 *   resolve(game, setup)                    the units this setup can build, with final per-battalion stats
 *
 * setup = {
 *   techs:    Set | string[]          researched tech ids
 *   doctrine: { grands: string[], slots: { [trackId]: string[] }, progress: { [subId]: number } }
 *   manual:   { sa, ha, def, brk, pier, org, hp, arm }   extra percent bonuses applied to division totals (see stats.js)
 *   design:   weights object          priorities used to pick tank modules (same keys as the priority sliders)
 *   exclude:  string[]                unit ids the player does not want in templates
 * }
 *
 * Stat model (from the game files):
 *   equipment stats   = sum over the equipment types a unit needs (best researched variant of each)
 *   attack/defense/breakthrough/piercing/armor/hardness/air/speed/supply
 *                     = equipment * (1 + unit value + tech and doctrine bonuses)       (bonuses add together)
 *   organization, hit points, recovery, recon, combat width = unit value + flat bonuses
 *   production cost   = sum(need * equipment cost)
 */

// stat keys whose modifiers are fractions of the equipment value, and stat keys whose modifiers are flat
export const FRAC_KEYS = ['sa', 'ha', 'def', 'brk', 'pier', 'air', 'arm', 'hard', 'spd', 'sup'];
export const FLAT_KEYS = ['org', 'hp', 'rec', 'recon', 'width'];
const COMBAT_EQ_KEYS = ['sa', 'ha', 'def', 'brk', 'pier', 'air', 'arm', 'hard'];

export const PERK_BY_UNIT = {
  engineer: 'engineer', armored_engineer: 'engineer',
  recon: 'recon', mot_recon: 'recon', armored_car_recon: 'recon', light_tank_recon: 'recon', helicopter_recon: 'recon',
  field_hospital: 'hospital', helicopter_field_hospital: 'hospital',
  logistics_company: 'logistics', helicopter_transport: 'logistics',
  maintenance_company: 'maintenance', armored_maintenance: 'maintenance',
  signal_company: 'signal', armored_signal: 'signal',
  military_police: 'police', motorized_military_police: 'police',
};
export const PERK_KEYS = ['recon', 'engineer', 'hospital', 'logistics', 'maintenance', 'signal', 'police'];

// HOI4 keeps infantry, artillery, mobile artillery and armor battalions in separate designer columns.
// The extracted `col` field describes the chassis family, so line artillery needs this finer grouping.
export const COLUMN_TYPES = ['infantry', 'artillery', 'mobile', 'mobile_artillery', 'armor'];
export function columnType(u) {
  if (u.col === 'armor') return 'armor';
  const cats = u.cats || [];
  const artillery = cats.includes('category_line_artillery');
  if (artillery && cats.includes('category_mobile_and_mobile_combat_sup')) return 'mobile_artillery';
  if (artillery) return 'artillery';
  return u.col === 'mobile' ? 'mobile' : 'infantry';
}

export const BASE_COLUMN_SIZE = 5;
export const MAX_COLUMNS = 5;
export const MAX_SUPPORT = 5;

const num = (v) => (typeof v === 'number' ? v : 0);

// ------------------------------------------------------------------ indexing
export function buildGame(raw) {
  const techs = new Map(Object.entries(raw.techs));
  const units = new Map(Object.entries(raw.units));
  const children = new Map();
  for (const t of techs.values()) for (const p of t.parents) { if (!children.has(p)) children.set(p, []); children.get(p).push(t.id); }
  const dependants = new Map();
  for (const t of techs.values()) for (const d of t.deps) { if (!dependants.has(d)) dependants.set(d, []); dependants.get(d).push(t.id); }

  const depth = new Map();
  const depthOf = (id, stack = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const t = techs.get(id);
    const ps = t ? t.parents.filter((p) => techs.has(p)) : [];
    const d = ps.length ? 1 + Math.max(...ps.map((p) => depthOf(p, stack))) : 0;
    depth.set(id, d);
    return d;
  };
  for (const id of techs.keys()) depthOf(id);

  // stable order used for URL encoding and display
  const techOrder = [...techs.keys()].sort();
  const techIndex = new Map(techOrder.map((id, i) => [id, i]));

  return {
    raw, techs, units, children, dependants, depth, techOrder, techIndex,
    grands: new Map(Object.entries(raw.grands)),
    subs: new Map(Object.entries(raw.subs)),
    tracks: raw.tracks,
    meta: raw.meta,
  };
}

// ------------------------------------------------------------------ tech tree editing
export function canResearch(game, set, id) {
  const t = game.techs.get(id);
  if (!t) return false;
  if (t.parents.length && !t.parents.some((p) => set.has(p))) return false;
  if (t.deps.some((d) => !set.has(d))) return false;
  if (t.xor.some((x) => set.has(x))) return false;
  return true;
}

/** Add a tech and, if needed, the shortest chain of prerequisites (earliest parent) that unlocks it. */
export function researchTech(game, current, id) {
  const set = new Set(current);
  const visit = (tid, guard) => {
    if (set.has(tid) || guard.has(tid)) return;
    guard.add(tid);
    const t = game.techs.get(tid);
    if (!t) return;
    for (const d of t.deps) visit(d, guard);
    if (t.parents.length && !t.parents.some((p) => set.has(p))) {
      const options = t.parents.filter((p) => game.techs.has(p)).sort((a, b) => (game.techs.get(a).year - game.techs.get(b).year) || (game.depth.get(a) - game.depth.get(b)));
      if (options.length) visit(options[0], guard);
    }
    for (const x of t.xor) if (set.has(x)) removeWithDependants(game, set, x);
    set.add(tid);
  };
  visit(id, new Set());
  return set;
}

function removeWithDependants(game, set, id) {
  set.delete(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tid of [...set]) {
      const t = game.techs.get(tid);
      if (!t) { set.delete(tid); continue; }
      const parentsOk = !t.parents.length || t.parents.some((p) => set.has(p));
      const depsOk = t.deps.every((d) => set.has(d));
      if (!parentsOk || !depsOk) { set.delete(tid); changed = true; }
    }
  }
}

export function unresearchTech(game, current, id) {
  const set = new Set(current);
  removeWithDependants(game, set, id);
  return set;
}

/** Every regular tech that starts in or before `year`. Special-project techs are only included when `withProjects` is set. */
export function techsUpTo(game, year, withProjects = false) {
  const set = new Set();
  const order = [...game.techs.values()].filter((t) => (withProjects || !t.special) && (t.year == null || t.year <= year))
    .sort((a, b) => (game.depth.get(a.id) - game.depth.get(b.id)) || (a.year - b.year) || (a.id < b.id ? -1 : 1));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const t of order) if (!set.has(t.id) && canResearch(game, set, t.id)) { set.add(t.id); progressed = true; }
  }
  return set;
}

// ------------------------------------------------------------------ availability
export function unlocks(game, techSet) {
  const eq = new Set(); const mods = new Set(); const units = new Set();
  for (const id of techSet) {
    const t = game.techs.get(id);
    if (!t) continue;
    t.unlocks.equipment.forEach((e) => eq.add(e));
    t.unlocks.modules.forEach((m) => mods.add(m));
    t.unlocks.units.forEach((u) => units.add(u));
  }
  return { eq, mods, units };
}

const variantOpen = (v, techSet) => !v.by.length || v.by.some((t) => techSet.has(t));

function bestVariant(variants, techSet) {
  let best = null;
  for (const v of variants) if (variantOpen(v, techSet) && (!best || v.year > best.year || (v.year === best.year && v.id > best.id))) best = v;
  return best;
}

// ------------------------------------------------------------------ modifiers
function addStats(map, target, stats) {
  const cur = map.get(target) || {};
  for (const [k, v] of Object.entries(stats)) if (typeof v === 'number') cur[k] = (cur[k] || 0) + v;
  map.set(target, cur);
}

export const EMPTY_DOCTRINE = { grands: [], slots: {}, progress: {} };

export function rewardCount(game, subId, doctrine) {
  const s = game.subs.get(subId);
  if (!s) return 0;
  const p = doctrine.progress ? doctrine.progress[subId] : undefined;
  return Math.max(0, Math.min(s.rewards.length, p === undefined ? s.rewards.length : p));
}

/** All unit-scoped modifiers in force, plus the extra column size some doctrine milestones give. */
export function collectModifiers(game, techSet, doctrine = EMPTY_DOCTRINE) {
  const mods = new Map();
  let columnBonus = 0;
  for (const id of techSet) {
    const t = game.techs.get(id);
    if (t) for (const m of t.mods) addStats(mods, m.target, m.stats);
  }
  for (const gid of doctrine.grands || []) {
    const g = game.grands.get(gid);
    if (!g) continue;
    for (const m of g.mods) addStats(mods, m.target, m.stats);
    columnBonus += num(g.extra.additional_brigade_column_size);
    for (const ms of g.milestones) {
      if (!ms.track) continue;
      const subIds = (doctrine.slots && doctrine.slots[ms.track]) || [];
      // a track milestone is earned once a subdoctrine on that track has all of its rewards
      const done = subIds.some((sid) => { const s = game.subs.get(sid); return s && rewardCount(game, sid, doctrine) >= s.rewards.length; });
      if (done) {
        for (const m of ms.mods) addStats(mods, m.target, m.stats);
        columnBonus += num(ms.extra.additional_brigade_column_size);
      }
    }
  }
  const seen = new Set();
  for (const subIds of Object.values(doctrine.slots || {})) {
    for (const sid of subIds) {
      if (!sid || seen.has(sid)) continue; // a subdoctrine slotted in two tracks still counts once
      seen.add(sid);
      const s = game.subs.get(sid);
      if (!s) continue;
      for (const m of s.mods) addStats(mods, m.target, m.stats);
      s.rewards.slice(0, rewardCount(game, sid, doctrine)).forEach((r) => {
        for (const m of r.mods) addStats(mods, m.target, m.stats);
        columnBonus += num(r.extra.additional_brigade_column_size);
      });
    }
  }
  return { mods, columnBonus };
}

function unitModifiers(mods, u) {
  const m = {};
  for (const t of [u.id, ...u.cats]) {
    const s = mods.get(t);
    if (s) for (const [k, v] of Object.entries(s)) m[k] = (m[k] || 0) + v;
  }
  return m;
}

// ------------------------------------------------------------------ tank designer
const DESIGN_SCALE = { sa: 30, ha: 25, pier: 100, def: 10, brk: 50, arm: 80, hard: 1, spd: 10, ic: 15, air: 20, rel: 1 };
const DESIGN_DIR = { sa: 1, ha: 1, pier: 1, def: 1, brk: 1, arm: 1, hard: 1, spd: 1, ic: -1, air: 1, rel: 1 };
const ROLE_OBJECTIVE = {
  anti_tank: { ha: 3, pier: 5, arm: 3, def: 1, spd: 1, ic: 2, rel: 2 },
  anti_air: { air: 6, arm: 1, def: 1, spd: 1, ic: 2, rel: 2 },
  artillery: { sa: 6, def: 1, arm: 1, spd: 1, ic: 2, rel: 2 },
};
const FALLBACK_OBJECTIVE = { sa: 2, ha: 3, brk: 3, def: 1, arm: 3, pier: 3, spd: 2, ic: 2, rel: 2 };

export function designObjective(role, weights) {
  if (role !== 'armor') return ROLE_OBJECTIVE[role] || FALLBACK_OBJECTIVE;
  const w = {};
  let any = 0;
  for (const k of Object.keys(DESIGN_SCALE)) { const v = weights && weights[k]; if (v) { w[k] = v; any += Math.abs(v); } }
  if (!any) return FALLBACK_OBJECTIVE;
  w.rel = 2; // tanks that keep breaking down are not worth their bonuses, whatever the priorities
  return w;
}

const designScore = (stats, obj) => {
  let s = 0;
  for (const k of Object.keys(obj)) s += obj[k] * DESIGN_DIR[k] * (stats[k] || 0) / DESIGN_SCALE[k];
  return s;
};

function moduleAllowed(m, role, designer) {
  if (role === 'armor') { if (m.forbidArmor) return false; return true; }
  if (m.allowEquipmentType.length && !m.allowEquipmentType.includes(role)) return false;
  return true;
}

function upgradeLevel(up, techSet) {
  // levels below the first requirement are free; each researched requirement opens the levels up to the next one
  const reqs = [...up.reqs].sort((a, b) => a.level - b.level);
  let cap = reqs.length ? reqs[0].level - 1 : up.max;
  for (let i = 0; i < reqs.length; i++) {
    if (techSet.has(reqs[i].tech)) cap = (i + 1 < reqs.length ? reqs[i + 1].level - 1 : up.max);
    else break;
  }
  return Math.min(up.max, cap);
}

export function designStats(game, chassis, variant, chosen, techSet) {
  const s = { sa: 0, ha: 0, def: 0, brk: 0, pier: 0, air: 0, arm: 0, hard: 0, spd: 0, ic: 0, rel: 0 };
  for (const k of Object.keys(s)) s[k] = num(variant.stats[k]);
  const mul = {};
  for (const slot of Object.keys(chosen)) {
    const m = chosen[slot] && game.raw.modules[chosen[slot]];
    if (!m) continue;
    for (const [k, v] of Object.entries(m.add)) if (k in s) s[k] += v;
    for (const [k, v] of Object.entries(m.mul)) mul[k] = (mul[k] || 0) + v;
  }
  // No Step Back engine / armor upgrade levels, at the highest level the researched techs allow
  for (const up of Object.values(game.raw.upgrades)) {
    const lvl = upgradeLevel(up, techSet);
    for (const [k, v] of Object.entries(up.add)) if (k in s) s[k] += v * lvl;
    s.rel += num(up.reliability) * lvl;
  }
  for (const k of Object.keys(s)) s[k] *= 1 + num(mul[k]);
  s.hard = Math.max(0, Math.min(1, s.hard));
  // Reliability is a 0-100% figure in the game's own designer (see Av. Reliability). Upgrade-level bonuses add
  // together with no synergy penalty here, which can push the raw total past 100% for a well-upgraded chassis;
  // clamp it the same way hardness is clamped so the UI never shows something like "139% reliable".
  s.rel = Math.max(0, Math.min(1, s.rel));
  return s;
}

const DESIGN_KEYS = ['sa', 'ha', 'def', 'brk', 'pier', 'air', 'arm', 'hard', 'spd', 'ic', 'rel'];

/** The modules each slot of a chassis can take for a role, and the rules that tie them together. */
function designSpace(game, chassisId, role, open) {
  const chassis = game.raw.designers[chassisId];
  const slotNames = Object.keys(chassis.slots);
  const mods = Object.values(game.raw.modules).filter((m) => open.mods.has(m.id));
  const turretSlot = slotNames.find((n) => /turret_type/.test(n));
  const mainSlot = slotNames.find((n) => /main_armament/.test(n));
  // a turret adds the main-armament categories it can carry to what the chassis slot itself allows
  const turretCats = new Set();
  for (const m of mods) if (turretSlot && chassis.slots[turretSlot].cats.includes(m.cat) && m.allowsMain) m.allowsMain.forEach((c) => turretCats.add(c));
  const candidates = {};
  for (const sn of slotNames) {
    const slot = chassis.slots[sn];
    candidates[sn] = mods.filter((m) => (slot.cats.includes(m.cat) || (sn === mainSlot && turretCats.has(m.cat))) && moduleAllowed(m, role, chassis));
  }
  const validMain = (turretId, main) => {
    if (!main) return false;
    const t = turretId && game.raw.modules[turretId];
    const m = game.raw.modules[main];
    const slot = chassis.slots[mainSlot];
    if (!slot.cats.includes(m.cat) && !(t && t.allowsMain && t.allowsMain.includes(m.cat))) return false;
    if (role === 'armor' && t && t.forbidMainOnArmor.includes(m.cat)) return false;
    return true;
  };
  const limitCount = (ids) => {
    for (const lim of chassis.limits) {
      let n = 0;
      for (const id of ids) {
        const m = id && game.raw.modules[id];
        if (m && ((lim.module && m.id === lim.module) || (lim.category && m.cat === lim.category))) n++;
      }
      if (n >= lim.lt) return false;
    }
    return true;
  };
  return { chassis, slotNames, candidates, turretSlot, mainSlot, validMain, limitCount };
}

/** Drop items whose oriented vector is no better than another's everywhere (keeps the first of equal ones). */
function paretoKeep(items, vec) {
  const vs = items.map(vec);
  const sums = vs.map((v) => v.reduce((x, y) => x + y, 0));
  const order = items.map((_, i) => i).sort((a, b) => sums[b] - sums[a]);
  // the kept vectors, packed, so the dominance test runs over one typed array
  const D = vs.length ? vs[0].length : 0;
  const kept = new Float64Array(items.length * D);
  const keep = [];
  let first = 0; // the dimension that last told two vectors apart is the likeliest to do it again: test it first
  for (const i of order) {
    const v = vs[i];
    let dominated = false;
    for (let q = 0, off = 0; q < keep.length; q++, off += D) {
      let ge = true;
      for (let e = 0, d = first; e < D; e++, d = d + 1 === D ? 0 : d + 1) if (kept[off + d] < v[d] - 1e-12) { ge = false; first = d; break; }
      if (ge) { dominated = true; break; }
    }
    if (!dominated) { kept.set(v, keep.length * D); keep.push(i); }
  }
  return keep.map((i) => items[i]);
}

/**
 * Exhaustive module search for one chassis and role. `score` is either a function of the design stats or
 * { linear: { key: coefficient } } for a weighted sum (much faster). A function must be monotone in each design stat in the
 * direction `dirs[key]` gives: +1 more is better, -1 less is better, 0 the score ignores it, 'both' unknown.
 *
 * It is exhaustive in the sense that matters: a module (or a set of special modules) is only set aside when another
 * option for the same slot is at least as good on every stat the score depends on, which can never lose. Every
 * remaining combination is then scored, except those an upper bound proves cannot win.
 * A design stat is (chassis + upgrades + module additions) * (1 + module multipliers), so more of a good addition
 * or multiplier is always at least as good. Special modules are a set (no module twice): the special slots are
 * interchangeable.
 */
export function designSearch(game, techSet, chassisId, role, open, score, dirs = {}, opts = {}) {
  const minRel = opts.minRel || 0;
  // a reliability floor needs reliability in the dominance test, or a pruned module could have been the feasible one
  if (minRel > 0 && !dirs.rel) dirs = { ...dirs, rel: 1 };
  const chassis = game.raw.designers[chassisId];
  if (!chassis) return null;
  const variant = bestVariant(chassis.variants, techSet);
  if (!variant) return null;
  const sp = designSpace(game, chassisId, role, open);
  const { slotNames, candidates, turretSlot, mainSlot, validMain, limitCount } = sp;
  const R = DESIGN_KEYS.filter((k) => dirs[k]);
  const both = R.filter((k) => dirs[k] === 'both');

  const base = {};
  for (const k of DESIGN_KEYS) base[k] = num(variant.stats[k]);
  for (const up of Object.values(game.raw.upgrades)) {
    const lvl = upgradeLevel(up, techSet);
    for (const [k, v] of Object.entries(up.add)) if (k in base) base[k] += v * lvl;
    base.rel += num(up.reliability) * lvl;
  }
  const add = (ids, k) => { let x = 0; for (const id of ids) if (id) x += num(game.raw.modules[id].add[k]); return x; };
  const mul = (ids, k) => { let x = 0; for (const id of ids) if (id) x += num(game.raw.modules[id].mul[k]); return x; };
  // oriented (addition, multiplier) vector over the stats that matter; 'both' stats must match exactly
  const raw = new Map(); // module id -> its additions and multipliers over R
  const rawOf = (id) => {
    let x = raw.get(id);
    if (!x) { const m = game.raw.modules[id]; x = { a: R.map((k) => num(m.add[k])), m: R.map((k) => num(m.mul[k])) }; raw.set(id, x); }
    return x;
  };
  const oriented = (ids) => {
    const xs = [];
    for (const id of ids) if (id) xs.push(rawOf(id));
    const v = [];
    for (let i = 0; i < R.length; i++) {
      const k = R[i];
      let a = 0; let m = 0;
      for (const x of xs) { a += x.a[i]; m += x.m[i]; }
      if (dirs[k] === 'both') v.push(a, -a, m, -m);
      else v.push(dirs[k] * a, dirs[k] * m);
    }
    return v;
  };

  // ---- core slots: prune dominated options within each slot, then dominated whole cores ----
  const specialSlots = slotNames.filter((n) => /special/.test(n));
  const coreSlots = slotNames.filter((n) => !specialSlots.includes(n));
  const limitKey = (id) => (id ? chassis.limits.filter((l) => l.module === id || (l.category && l.category === game.raw.modules[id].cat)).map((l) => l.module || l.category).join(',') : '');
  const pruneSlot = (sn) => {
    const ids = candidates[sn].map((m) => m.id);
    if (!chassis.slots[sn].required || !ids.length) ids.push(null);
    // options that play differently with the rest of the design (turret -> guns, gun category, limits) are kept apart
    const cls = (id) => {
      if (!id) return 'none';
      const m = game.raw.modules[id];
      if (sn === turretSlot) return `t:${(m.allowsMain || []).join(',')}|${m.forbidMainOnArmor.join(',')}|${limitKey(id)}`;
      if (sn === mainSlot) return `m:${m.cat}|${limitKey(id)}`;
      return `o:${limitKey(id)}`;
    };
    const groups = new Map();
    for (const id of ids) { const c = cls(id); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(id); }
    return [...groups.values()].flatMap((g) => paretoKeep(g, (id) => oriented([id])));
  };
  const slotOptions = Object.fromEntries(coreSlots.map((sn) => [sn, pruneSlot(sn)]));
  const cores = [];
  const order = [...coreSlots].sort((a, b) => (a === turretSlot ? -1 : b === turretSlot ? 1 : a === mainSlot ? -1 : b === mainSlot ? 1 : 0));
  const pick = {};
  const walk = (i) => {
    if (i === order.length) { const ids = order.map((sn) => pick[sn]); if (limitCount(ids)) cores.push({ ...pick }); return; }
    const sn = order[i];
    for (const id of slotOptions[sn]) {
      if (sn === mainSlot && !validMain(pick[turretSlot], id)) continue;
      pick[sn] = id;
      walk(i + 1);
    }
    delete pick[sn];
  };
  walk(0);
  const coreFront = paretoKeep(cores, (c) => oriented(Object.values(c)));

  // ---- special modules: every legal set, dominated sets dropped ----
  const specialOptions = [...new Set(specialSlots.flatMap((n) => candidates[n].map((m) => m.id)))]
    .filter((id) => paretoKeep([id, null], (x) => oriented([x])).includes(id) || both.length);
  const sets = [];
  const cur = [];
  const rec = (start) => {
    sets.push(cur.slice());
    if (cur.length === specialSlots.length) return;
    for (let i = start; i < specialOptions.length; i++) {
      cur.push(specialOptions[i]);
      if (limitCount(cur)) rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  const setFront = paretoKeep(sets, (ids) => oriented(ids));

  // ---- combine, best-bound first ----
  const sums = (ids) => {
    const A = {}; const M = {};
    for (const k of DESIGN_KEYS) { A[k] = add(ids, k); M[k] = mul(ids, k); }
    return { A, M };
  };
  const setSums = setFront.map((ids) => ({ ids, ...sums(ids) }));
  const setRange = {};
  for (const k of DESIGN_KEYS) {
    const as = setSums.map((x) => x.A[k]); const ms = setSums.map((x) => x.M[k]);
    setRange[k] = { a: [Math.min(0, ...as), Math.max(0, ...as)], m: [Math.min(0, ...ms), Math.max(0, ...ms)] };
  }
  const bound = (A, M) => {
    const lo = {}; const hi = {};
    for (const k of DESIGN_KEYS) {
      const a0 = A[k] + setRange[k].a[0]; const a1 = A[k] + setRange[k].a[1];
      const m0 = M[k] + setRange[k].m[0]; const m1 = M[k] + setRange[k].m[1];
      const c = [(base[k] + a0) * (1 + m0), (base[k] + a0) * (1 + m1), (base[k] + a1) * (1 + m0), (base[k] + a1) * (1 + m1)];
      lo[k] = Math.min(...c); hi[k] = Math.max(...c);
      if (k === 'hard' || k === 'rel') { lo[k] = Math.max(0, Math.min(1, lo[k])); hi[k] = Math.max(0, Math.min(1, hi[k])); }
    }
    let b = -Infinity;
    for (let mask = 0; mask < (1 << both.length); mask++) {
      const st = {};
      for (const k of DESIGN_KEYS) st[k] = dirs[k] === -1 ? lo[k] : hi[k];
      both.forEach((k, i) => { st[k] = mask & (1 << i) ? hi[k] : lo[k]; });
      b = Math.max(b, typeof score === 'function' ? score(st) : DESIGN_KEYS.reduce((x, k) => x + (score.linear[k] || 0) * st[k], 0));
    }
    return b;
  };
  const coreSums = coreFront.map((c) => { const x = sums(Object.values(c)); return { c, ...x, ub: bound(x.A, x.M) }; }).sort((x, y) => y.ub - x.ub);
  // Limits only ever name special modules in the game files; check across core and specials only if that changes.
  const coreInLimits = coreFront.some((c) => Object.values(c).some((id) => limitKey(id)));
  const nK = DESIGN_KEYS.length;
  const setA = setSums.map((x) => Float64Array.from(DESIGN_KEYS, (k) => x.A[k]));
  const setM = setSums.map((x) => Float64Array.from(DESIGN_KEYS, (k) => x.M[k]));
  const baseV = Float64Array.from(DESIGN_KEYS, (k) => base[k]);
  const iHard = DESIGN_KEYS.indexOf('hard'); const iRel = DESIGN_KEYS.indexOf('rel');
  const linear = score.linear ? Float64Array.from(DESIGN_KEYS, (k) => score.linear[k] || 0) : null;
  const st = {};
  let bestScore = -Infinity; let bestChosen = null; let evaluated = 0;
  for (const core of coreSums) {
    if (core.ub <= bestScore + 1e-12) break;
    const cA = Float64Array.from(DESIGN_KEYS, (k) => core.A[k]);
    const cM = Float64Array.from(DESIGN_KEYS, (k) => core.M[k]);
    const coreIds = coreInLimits ? Object.values(core.c) : null;
    for (let q = 0; q < setSums.length; q++) {
      if (coreIds && !limitCount([...coreIds, ...setSums[q].ids])) continue;
      const sa = setA[q]; const sm = setM[q];
      if (minRel > 0 && (baseV[iRel] + cA[iRel] + sa[iRel]) * (1 + cM[iRel] + sm[iRel]) < minRel - 1e-9) continue;
      let sc = 0;
      if (linear) {
        for (let k = 0; k < nK; k++) {
          const g = linear[k];
          if (!g) continue;
          let v = (baseV[k] + cA[k] + sa[k]) * (1 + cM[k] + sm[k]);
          if (k === iHard || k === iRel) v = v < 0 ? 0 : v > 1 ? 1 : v;
          sc += g * v;
        }
      } else {
        for (let k = 0; k < nK; k++) st[DESIGN_KEYS[k]] = (baseV[k] + cA[k] + sa[k]) * (1 + cM[k] + sm[k]);
        st.hard = Math.max(0, Math.min(1, st.hard));
        st.rel = Math.max(0, Math.min(1, st.rel));
        sc = score(st);
      }
      evaluated++;
      if (sc > bestScore + 1e-12) {
        bestScore = sc;
        bestChosen = { ...core.c };
        specialSlots.forEach((sn, i) => { bestChosen[sn] = setSums[q].ids[i] || null; });
      }
    }
  }
  if (!bestChosen) return null;
  const stats = designStats(game, chassis, variant, bestChosen, techSet);
  return { chassis: chassisId, role, variant: variant.id, modules: bestChosen, stats, score: bestScore, evaluated, minRel, candidates: { cores: cores.length, coreFront: coreFront.length, sets: sets.length, setFront: setFront.length } };
}

/** Pick modules for one chassis and role for a fixed per-role objective (used before the division is known). */
export function autoDesign(game, techSet, chassisId, role, objective, open) {
  const dirs = {};
  for (const k of DESIGN_KEYS) dirs[k] = objective[k] ? Math.sign(objective[k] * (DESIGN_DIR[k] || 1)) : 0;
  // designScore is linear in the design stats, which lets the search use its fast path
  const linear = {};
  for (const k of DESIGN_KEYS) linear[k] = objective[k] ? objective[k] * (DESIGN_DIR[k] || 1) / DESIGN_SCALE[k] : 0;
  return reliableDesign((opts) => designSearch(game, techSet, chassisId, role, open, { linear }, dirs, opts));
}

/**
 * Lowest reliability a recommended design may have. The tank designer lets stacked reliability penalties push a design
 * to 0%, which a clamped score treats as free; in game it means constant breakdowns (attrition equipment losses and
 * accidents are scaled by reliability).
 */
export const MIN_DESIGN_RELIABILITY = 0.6;

/** Run a design search with the reliability floor, and without it only if no legal design reaches the floor. */
export function reliableDesign(run) {
  return run({ minRel: MIN_DESIGN_RELIABILITY }) || run({});
}

// ------------------------------------------------------------------ unit resolution
function unitOpen(game, u, techSet, open, tiers, chassisBest) {
  if (!u.active && !u.by.some((t) => techSet.has(t))) return false;
  const gate = u.essential.length ? u.essential : Object.keys(u.need).filter((a) => a !== 'support_equipment');
  for (const a of gate) if (u.need[a] !== undefined && !tiers.get(a)) return false;
  if (u.tank && !chassisBest.get(u.tank.chassis)) return false;
  return true;
}

/**
 * A unit's terrain modifiers averaged over a theatre's terrain mix ({ plains: 40, forest: 25, ... }): the share of
 * attack and defense it gains or loses there, as fractions. Without a mix, or without modifiers, both are 0.
 */
export function terrainFactor(u, mix) {
  if (!mix || !u.terrain) return { attack: 0, defence: 0 };
  let a = 0; let d = 0; let total = 0;
  for (const [t, p] of Object.entries(mix)) {
    if (!(p > 0)) continue;
    const m = u.terrain[t];
    total += p;
    if (m) { a += p * num(m.attack); d += p * num(m.defence); }
  }
  return total ? { attack: a / total, defence: d / total } : { attack: 0, defence: 0 };
}

export function resolve(game, setup) {
  const techSet = setup.techs instanceof Set ? setup.techs : new Set(setup.techs);
  const open = unlocks(game, techSet);
  const tiers = new Map();
  for (const [arch, eq] of Object.entries(game.raw.equipment)) {
    const b = bestVariant(eq.variants, techSet);
    if (b) tiers.set(arch, b);
  }
  const chassisBest = new Map();
  for (const [cid, d] of Object.entries(game.raw.designers)) { const b = bestVariant(d.variants, techSet); if (b) chassisBest.set(cid, b); }

  const { mods, columnBonus } = collectModifiers(game, techSet, setup.doctrine || EMPTY_DOCTRINE);
  const designs = {};
  const designFor = (chassis, role) => {
    const key = `${chassis}|${role}`;
    if (!(key in designs)) {
      const fixed = setup.designs && setup.designs[key];
      const variant = fixed && game.raw.designers[chassis] && bestVariant(game.raw.designers[chassis].variants, techSet);
      designs[key] = fixed && variant
        ? { chassis, role, variant: variant.id, modules: fixed.modules, stats: designStats(game, game.raw.designers[chassis], variant, fixed.modules, techSet), tuned: !!fixed.tuned }
        : autoDesign(game, techSet, chassis, role, designObjective(role, setup.design), open);
    }
    return designs[key];
  };

  const excluded = new Set(setup.exclude || []);
  const build = (u, design) => {
    const eq = { sa: 0, ha: 0, def: 0, brk: 0, pier: 0, air: 0, arm: 0, hard: 0 };
    let ic = 0;
    let relSum = 0; let relN = 0;
    const equipment = {};
    const speeds = [];
    let transportSpd = null;
    for (const [arch, count] of Object.entries(u.need)) {
      const v = tiers.get(arch);
      if (!v) continue;
      for (const k of COMBAT_EQ_KEYS) eq[k] += num(v.stats[k]);
      ic += count * num(v.stats.ic);
      equipment[arch] = (equipment[arch] || 0) + count;
      if (v.stats.rel != null) { relSum += count * num(v.stats.rel); relN += count; }
      if (u.transport === arch) transportSpd = v.stats.spd;
      // equipment that only carries the men (rifles, support kit) does not set the speed of a vehicle unit
      if (v.stats.spd && arch !== 'support_equipment') speeds.push({ arch, spd: v.stats.spd });
    }
    if (u.tank) {
      for (const k of COMBAT_EQ_KEYS) eq[k] += num(design.stats[k]);
      ic += u.tank.count * num(design.stats.ic);
      const tankKey = `tank:${u.tank.chassis}|${u.tank.role}`;
      equipment[tankKey] = (equipment[tankKey] || 0) + u.tank.count;
      relSum += u.tank.count * num(design.stats.rel); relN += u.tank.count;
    }
    let baseSpd = 4;
    if (u.base.spdOverride != null) baseSpd = u.base.spdOverride;
    else if (transportSpd != null) baseSpd = transportSpd;
    else {
      const vehicle = speeds.filter((x) => x.arch !== 'infantry_equipment').map((x) => x.spd);
      const foot = speeds.filter((x) => x.arch === 'infantry_equipment').map((x) => x.spd);
      if (design) vehicle.push(design.stats.spd);
      if (vehicle.length) baseSpd = Math.min(...vehicle); else if (foot.length) baseSpd = Math.min(...foot);
    }

    const m = unitModifiers(mods, u);
    const F = (k) => num(u.base[k]) + num(m[k]);
    // Terrain: a battalion's own modifiers scale its attacks and defense; a support company's apply to every
    // battalion in the division (engineers, say), so they become a boost on all land battalions.
    const tf = terrainFactor(u, setup.terrain);
    const own = u.role === 'line' ? tf : { attack: 0, defence: 0 };
    const terrainBoost = u.role !== 'line' && (tf.attack || tf.defence)
      ? [{ category: 'category_army', stats: { ...(tf.attack ? { sa: tf.attack, ha: tf.attack } : {}), ...(tf.defence ? { def: tf.defence } : {}) } }]
      : [];
    const trucks = num(u.need.motorized_equipment) + num(u.need.motorbike_equipment);
    const cat = columnType(u); // separate infantry, artillery, mobile artillery and armor columns
    return {
      id: u.id, name: u.name, abbr: u.abbr, role: u.role, cat, group: u.group, cats: u.cats, special: u.special,
      sameType: [u.id, ...u.sameType],
      // per-battalion stats
      sa: eq.sa * (1 + F('sa')) * (1 + own.attack),
      ha: eq.ha * (1 + F('ha')) * (1 + own.attack),
      def: eq.def * (1 + F('def')) * (1 + own.defence),
      brk: eq.brk * (1 + F('brk')),
      pier: eq.pier * (1 + F('pier')),
      air: eq.air * (1 + F('air')),
      arm: eq.arm * (1 + F('arm')),
      hard: eq.hard * (1 + F('hard')) * 100,
      spd: baseSpd * (1 + num(m.spd)),
      org: num(u.base.org) + num(m.org),
      hp: num(u.base.hp) + num(m.hp),
      rec: num(u.base.rec) + num(m.rec),
      recon: num(u.base.recon) + num(m.recon),
      width: Math.max(0, num(u.base.width) + num(m.width)),
      mp: num(u.base.mp),
      sup: Math.max(0, num(u.base.sup) * (1 + num(m.sup))),
      ic, trucks,
      // equipment reliability, averaged over every piece of equipment the unit fields
      rel: relN ? relSum / relN : 1,
      equipment,
      affectsSpeed: u.affectsSpeed,
      perks: PERK_BY_UNIT[u.id] ? { [PERK_BY_UNIT[u.id]]: 1 } : {},
      battalionMult: [...u.battalionMult.filter((b) => Object.keys(b.stats).length && !b.add), ...terrainBoost],
      tank: u.tank || null,
      design: design ? { chassis: design.chassis, role: design.role, variant: design.variant, modules: design.modules } : null,
    };
  };
  const out = [];
  for (const u of game.units.values()) {
    if (excluded.has(u.id)) continue;
    if (!unitOpen(game, u, techSet, open, tiers, chassisBest)) continue;
    let design = null;
    if (u.tank) {
      design = designFor(u.tank.chassis, u.tank.role);
      if (!design) continue;
    }
    out.push(build(u, design));
  }
  // Rebuild one unit with other design stats (used to tune tank designs against a division). Not serializable, so
  // it is left out of anything posted from the worker.
  const withDesign = (id, designStatsValue, modules) => {
    const u = game.units.get(id);
    const d = designs[`${u.tank.chassis}|${u.tank.role}`];
    return build(u, { ...d, stats: designStatsValue, modules: modules || d.modules });
  };
  return {
    combat: out.filter((u) => u.role === 'line'),
    support: out.filter((u) => u.role === 'div'),
    regimental: out.filter((u) => u.role === 'reg'),
    byId: new Map(out.map((u) => [u.id, u])),
    columnSize: BASE_COLUMN_SIZE + columnBonus,
    designs,
    techSet,
    open,
    withDesign,
  };
}

// ------------------------------------------------------------------ cache
// Resolving a setup runs the exhaustive tank designer for every chassis, which takes a moment on late research.
// The search worker stays alive between searches, so remember the last few setups.
const resolveCache = new Map();
export function resolveCached(game, setup) {
  const techs = setup.techs instanceof Set ? [...setup.techs] : (setup.techs || []);
  const key = JSON.stringify([techs.slice().sort(), setup.doctrine || null, (setup.exclude || []).slice().sort(), setup.design || null, setup.designs || null, setup.terrain || null]);
  const hit = resolveCache.get(key);
  if (hit && hit.game === game) { resolveCache.delete(key); resolveCache.set(key, hit); return hit.value; }
  const value = resolve(game, setup);
  resolveCache.set(key, { game, value });
  while (resolveCache.size > 12) resolveCache.delete(resolveCache.keys().next().value);
  return value;
}
