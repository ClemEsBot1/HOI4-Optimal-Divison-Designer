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
  return s;
}

/** Pick modules for one chassis and role by coordinate ascent on the weighted score. */
export function autoDesign(game, techSet, chassisId, role, objective, open) {
  const chassis = game.raw.designers[chassisId];
  if (!chassis) return null;
  const variant = bestVariant(chassis.variants, techSet);
  if (!variant) return null;
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
  const withinLimits = (chosen) => {
    for (const lim of chassis.limits) {
      let n = 0;
      for (const id of Object.values(chosen)) {
        const m = id && game.raw.modules[id];
        if (!m) continue;
        if ((lim.module && m.id === lim.module) || (lim.category && m.cat === lim.category)) n++;
      }
      if (n >= lim.lt) return false;
    }
    return true;
  };
  const score = (chosen) => {
    if (!withinLimits(chosen)) return -Infinity;
    return designScore(designStats(game, chassis, variant, chosen, techSet), objective);
  };
  const chosen = {};
  // required slots: start with the cheapest option so the design is always valid
  for (const sn of slotNames) {
    const c = candidates[sn];
    chosen[sn] = null;
    if (chassis.slots[sn].required && c.length) chosen[sn] = sn === mainSlot ? null : c[0].id;
  }
  if (mainSlot) {
    const ok = candidates[mainSlot].find((m) => validMain(chosen[turretSlot], m.id));
    chosen[mainSlot] = ok ? ok.id : null;
  }
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const sn of slotNames) {
      const slot = chassis.slots[sn];
      const options = candidates[sn].map((m) => m.id);
      if (!slot.required) options.push(null);
      let best = chosen[sn]; let bestScore = score(chosen);
      for (const opt of options) {
        const trial = { ...chosen, [sn]: opt };
        if (sn === turretSlot && mainSlot) {
          // switching turret can invalidate the gun: keep the best gun that still fits
          let g = null; let gs = -Infinity;
          for (const m of candidates[mainSlot]) {
            if (!validMain(opt, m.id)) continue;
            const sc = score({ ...trial, [mainSlot]: m.id });
            if (sc > gs) { gs = sc; g = m.id; }
          }
          trial[mainSlot] = g;
        } else if (sn === mainSlot && opt && !validMain(chosen[turretSlot], opt)) continue;
        const sc = score(trial);
        if (sc > bestScore + 1e-9) { bestScore = sc; best = opt; if (sn === turretSlot && mainSlot) chosen[mainSlot] = trial[mainSlot]; }
      }
      if (best !== chosen[sn]) { chosen[sn] = best; improved = true; }
    }
    if (!improved) break;
  }
  const stats = designStats(game, chassis, variant, chosen, techSet);
  return { chassis: chassisId, role, variant: variant.id, modules: chosen, stats, score: score(chosen) };
}

// ------------------------------------------------------------------ unit resolution
function unitOpen(game, u, techSet, open, tiers, chassisBest) {
  if (!u.active && !u.by.some((t) => techSet.has(t))) return false;
  const gate = u.essential.length ? u.essential : Object.keys(u.need).filter((a) => a !== 'support_equipment');
  for (const a of gate) if (u.need[a] !== undefined && !tiers.get(a)) return false;
  if (u.tank && !chassisBest.get(u.tank.chassis)) return false;
  return true;
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
    if (!(key in designs)) designs[key] = autoDesign(game, techSet, chassis, role, designObjective(role, setup.design), open);
    return designs[key];
  };

  const excluded = new Set(setup.exclude || []);
  const out = [];
  for (const u of game.units.values()) {
    if (excluded.has(u.id)) continue;
    if (!unitOpen(game, u, techSet, open, tiers, chassisBest)) continue;
    const eq = { sa: 0, ha: 0, def: 0, brk: 0, pier: 0, air: 0, arm: 0, hard: 0 };
    let ic = 0;
    const speeds = [];
    let transportSpd = null;
    for (const [arch, count] of Object.entries(u.need)) {
      const v = tiers.get(arch);
      if (!v) continue;
      for (const k of COMBAT_EQ_KEYS) eq[k] += num(v.stats[k]);
      ic += count * num(v.stats.ic);
      if (u.transport === arch) transportSpd = v.stats.spd;
      // equipment that only carries the men (rifles, support kit) does not set the speed of a vehicle unit
      if (v.stats.spd && arch !== 'support_equipment') speeds.push({ arch, spd: v.stats.spd });
    }
    let design = null;
    if (u.tank) {
      design = designFor(u.tank.chassis, u.tank.role);
      if (!design) continue;
      for (const k of COMBAT_EQ_KEYS) eq[k] += num(design.stats[k]);
      ic += u.tank.count * num(design.stats.ic);
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
    const trucks = num(u.need.motorized_equipment) + num(u.need.motorbike_equipment);
    const cat = u.col; // infantry | mobile | armor for line units
    out.push({
      id: u.id, name: u.name, abbr: u.abbr, role: u.role, cat, group: u.group, cats: u.cats, special: u.special,
      sameType: [u.id, ...u.sameType],
      // per-battalion stats
      sa: eq.sa * (1 + F('sa')),
      ha: eq.ha * (1 + F('ha')),
      def: eq.def * (1 + F('def')),
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
      affectsSpeed: u.affectsSpeed,
      perks: PERK_BY_UNIT[u.id] ? { [PERK_BY_UNIT[u.id]]: 1 } : {},
      battalionMult: u.battalionMult.filter((b) => Object.keys(b.stats).length && !b.add),
      tank: u.tank || null,
      design: design ? { chassis: design.chassis, role: design.role, variant: design.variant, modules: design.modules } : null,
    });
  }
  return {
    combat: out.filter((u) => u.role === 'line'),
    support: out.filter((u) => u.role === 'div'),
    regimental: out.filter((u) => u.role === 'reg'),
    byId: new Map(out.map((u) => [u.id, u])),
    columnSize: BASE_COLUMN_SIZE + columnBonus,
    designs,
  };
}
