/**
 * Stat metadata and division evaluation.
 *
 * A template is { items: string[]  line battalion ids,
 *                 support: string[] divisional support company ids (one of each type, up to 5),
 *                 reg: string[]     regimental support company ids (up to one per column) }.
 * Columns are derived: infantry, artillery, mobile, mobile-artillery and armor each use their own column family, with at most `columnSize` battalions per column.
 * A division has at most 5 columns. A column needs at least 3 battalions before it can take a regimental support
 * company, so the layout (how many columns each type is spread over) is planned to make the regimental companies fit.
 *
 * `byId` maps unit id to a resolved unit (see resolve() in game.js).
 */

// dir: +1 = higher is better, -1 = lower is better. signed: weight may be negative (prefer a lower value).
export const STATS = [
  { key: 'sa', label: 'Soft attack', group: 'Offense', dir: 1, dp: 1 },
  { key: 'ha', label: 'Hard attack', group: 'Offense', dir: 1, dp: 1 },
  { key: 'brk', label: 'Breakthrough', group: 'Offense', dir: 1, dp: 1 },
  { key: 'air', label: 'Air attack', group: 'Offense', dir: 1, dp: 1 },
  { key: 'pier', label: 'Piercing', group: 'Offense', dir: 1, dp: 1 },
  { key: 'def', label: 'Defense', group: 'Staying power', dir: 1, dp: 1 },
  { key: 'org', label: 'Organization', group: 'Staying power', dir: 1, dp: 1 },
  { key: 'rec', label: 'Recovery rate', group: 'Staying power', dir: 1, dp: 2 },
  { key: 'hp', label: 'Hit points', group: 'Staying power', dir: 1, dp: 1 },
  { key: 'arm', label: 'Armor', group: 'Staying power', dir: 1, dp: 1 },
  { key: 'hard', label: 'Hardness %', group: 'Staying power', dir: 1, dp: 0, signed: true },
  { key: 'rel', label: 'Reliability %', group: 'Staying power', dir: 1, dp: 1 },
  { key: 'spd', label: 'Speed (km/h)', group: 'Mobility', dir: 1, dp: 1 },
  { key: 'ic', label: 'Production cost', group: 'Cost', dir: -1, dp: 0 },
  { key: 'mp', label: 'Manpower', group: 'Cost', dir: -1, dp: 0 },
  { key: 'sup', label: 'Supply use', group: 'Cost', dir: -1, dp: 2 },
  { key: 'trucks', label: 'Trucks needed', group: 'Cost', dir: -1, dp: 0 },
  { key: 'recon', label: 'Recon', group: 'Utility', dir: 1, dp: 1 },
  { key: 'regs', label: 'Regimental companies', group: 'Utility', dir: 1, dp: 0, count: true },
  { key: 'engineer', label: 'Engineer company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'hospital', label: 'Field hospital', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'logistics', label: 'Logistics company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'maintenance', label: 'Maintenance company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'signal', label: 'Signal company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'police', label: 'Military police', group: 'Utility', dir: 1, dp: 0, perk: true },
  // Only scored when an opponent is set (see combat.js): how fast this division breaks the opponent compared with
  // how fast the opponent breaks it, when attacking and when defending.
  { key: 'mAtk', label: 'Attacking the opponent', group: 'Matchup', dir: 1, dp: 2, matchup: true },
  { key: 'mDef', label: 'Holding against the opponent', group: 'Matchup', dir: 1, dp: 2, matchup: true },
];

export const STAT_KEYS = STATS.map((s) => s.key);
export const STAT_INDEX = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i]));
export const STAT_BY_KEY = Object.fromEntries(STATS.map((s) => [s.key, s]));

// stats that can be chosen as chart axes
export const AXIS_STATS = ['sa', 'ha', 'brk', 'def', 'org', 'hp', 'arm', 'pier', 'spd', 'rel', 'ic', 'mp', 'sup', 'width'];
export const AXIS_LABEL = { ...Object.fromEntries(STATS.map((s) => [s.key, s.label])), width: 'Combat width' };
export const AXIS_DIR = { ...Object.fromEntries(STATS.map((s) => [s.key, s.dir])), width: -1 };

// percent bonuses the player can type in for anything the data does not model (leaders, national spirits, ideas)
export const MOD_KEYS = [
  { key: 'sa', label: 'Soft attack' },
  { key: 'ha', label: 'Hard attack' },
  { key: 'def', label: 'Defense' },
  { key: 'brk', label: 'Breakthrough' },
  { key: 'org', label: 'Organization' },
  { key: 'hp', label: 'Hit points' },
  { key: 'arm', label: 'Armor' },
  { key: 'pier', label: 'Piercing' },
];

export const DEFAULT_OPTS = {
  supportDilutesOrg: true, // support companies enter the org / recovery average (unverified, see the data notes)
};

export const MAX_COLUMNS = 5;
export const ARMOR_MAX_SHARE = 0.3;
export const MAX_SUPPORT = 5;

// Column families mirror the game's designer: artillery is not an infantry column.
export const COLUMN_TYPES = ['infantry', 'artillery', 'mobile', 'mobile_artillery', 'armor'];
export function columnsNeeded(counts, size = 5) {
  return COLUMN_TYPES.reduce((n, t) => n + Math.ceil((counts[t] || 0) / size), 0);
}

export const REG_MIN_BATTALIONS = 3;
const COL_TYPES = COLUMN_TYPES;

/**
 * Plan actual column sizes, spreading battalions to unlock every possible regimental slot. Vehicle regimental
 * companies need armor columns; other companies need non-armor columns. Returns per-type column counts and
 * `sizes`, the battalion count in each displayed column.
 */
export function planColumns(cnt, size, armorRegs = 0, otherRegs = 0) {
  const min = Object.fromEntries(COL_TYPES.map((t) => [t, Math.ceil((cnt[t] || 0) / size)]));
  const base = COL_TYPES.reduce((n, t) => n + min[t], 0);
  if (base > MAX_COLUMNS) return { ok: false, ...min, slots: 0, armorSlots: 0, otherSlots: 0, sizes: {} };

  const target = Object.fromEntries(COL_TYPES.map((t) => {
    const count = cnt[t] || 0;
    const regimentColumns = size >= REG_MIN_BATTALIONS ? Math.ceil(count / REG_MIN_BATTALIONS) : 0;
    return [t, Math.min(count, Math.max(min[t], regimentColumns))];
  }));
  const room = (t) => Math.max(0, target[t] - min[t]);
  const columnSizes = (t, columns) => {
    const count = cnt[t] || 0;
    if (!columns) return [];
    const sizes = Array(columns).fill(0);
    const eligible = size >= REG_MIN_BATTALIONS
      ? Math.min(columns, Math.floor(count / REG_MIN_BATTALIONS))
      : 0;
    for (let i = 0; i < eligible; i++) sizes[i] = REG_MIN_BATTALIONS;
    let remaining = count - eligible * REG_MIN_BATTALIONS;
    // Keep leftovers in their own column when there is room: ten battalions across four columns = 3-3-3-1.
    for (let i = eligible; i < columns && remaining > 0; i++) {
      const placed = Math.min(size, remaining);
      sizes[i] = placed;
      remaining -= placed;
    }
    // If the five-column cap forces fewer columns, fill eligible columns up to their capacity.
    for (let i = 0; i < eligible && remaining > 0; i++) {
      const placed = Math.min(size - sizes[i], remaining);
      sizes[i] += placed;
      remaining -= placed;
    }
    return sizes;
  };

  let best = null;
  const visit = (index, left, cols) => {
    if (index === COL_TYPES.length) {
      const elig = (t) => size >= REG_MIN_BATTALIONS
        ? Math.min(cols[t], Math.floor((cnt[t] || 0) / REG_MIN_BATTALIONS))
        : 0;
      const armorSlots = elig('armor');
      const otherSlots = COL_TYPES.filter((t) => t !== 'armor').reduce((n, t) => n + elig(t), 0);
      const columnCount = COL_TYPES.reduce((n, t) => n + cols[t], 0);
      const candidate = {
        ...cols,
        slots: armorSlots + otherSlots,
        armorSlots,
        otherSlots,
        sizes: Object.fromEntries(COL_TYPES.map((t) => [t, columnSizes(t, cols[t])])),
        ok: armorRegs <= armorSlots && otherRegs <= otherSlots,
      };
      const bestColumnCount = best && COL_TYPES.reduce((n, t) => n + best[t], 0);
      if (!best
        || Number(candidate.ok) > Number(best.ok)
        || (candidate.ok === best.ok && candidate.slots > best.slots)
        || (candidate.ok === best.ok && candidate.slots === best.slots && columnCount > bestColumnCount)) {
        best = candidate;
      }
      return;
    }
    const t = COL_TYPES[index];
    for (let extra = 0; extra <= Math.min(left, room(t)); extra++) {
      visit(index + 1, left - extra, { ...cols, [t]: min[t] + extra });
    }
  };
  visit(0, MAX_COLUMNS - base, {});
  return best || { ok: false, ...min, slots: 0, armorSlots: 0, otherSlots: 0, sizes: {} };
}

/** Do two support companies exclude each other? (same id, or they share a "same support type" tag) */
export function supportConflict(a, b) {
  return a.id === b.id || a.sameType.some((t) => b.sameType.includes(t));
}

/** Regimental support companies attach to a column. Assumption: SP vehicles go with armor columns, foot/towed companies with the rest. */
export function regFitsColumn(u, col) {
  if (u.tank) return col === 'armor';
  return col !== 'armor';
}

/** Assign each regimental company to one eligible compatible column, in template order. */
export function assignRegimentalColumns(reg, layout, byId) {
  const slots = COLUMN_TYPES.flatMap((type) => (layout?.sizes?.[type] || []).flatMap((battalions, index) => (
    battalions >= REG_MIN_BATTALIONS ? [{ type, index, battalions, key: `${type}:${index}` }] : []
  )));
  const used = new Set();
  const assignments = new Map();
  for (const id of reg) {
    const unit = byId.get(id);
    if (!unit) continue;
    const slot = slots.find((candidate) => !used.has(candidate.key) && regFitsColumn(unit, candidate.type));
    if (slot) {
      used.add(slot.key);
      assignments.set(slot.key, { id, ...slot });
    }
  }
  return assignments;
}

/**
 * Evaluate a template. Returns null for an empty template, otherwise an object keyed by STAT_KEYS
 * plus `width`, `n`, `cols`, `valid`.
 */
export function evaluate(tpl, byId, mods = {}, opts = DEFAULT_OPTS, columnSize = 5) {
  const { items, support = [], reg = [] } = tpl;
  const n = items.length;
  if (n === 0) return null;

  const line = items.map((id) => byId.get(id));
  const comps = [...support, ...reg].map((id) => byId.get(id));
  // Shared links and hand-built templates can contain stale unit ids after the game data changes.
  // Treat those templates as invalid instead of crashing the search or the results panel.
  if (line.some((u) => !u) || comps.some((u) => !u)) return null;

  const cnt = Object.fromEntries(COLUMN_TYPES.map((t) => [t, 0]));
  for (const u of line) cnt[u.cat]++;
  const armorRegs = reg.filter((id) => byId.get(id).tank).length;
  const layout = planColumns(cnt, columnSize, armorRegs, reg.length - armorRegs);
  const regAssignments = assignRegimentalColumns(reg, layout, byId);

  // Support companies lift whole categories; regimental bonuses scale with the battalion count in their column.
  const boost = new Map();
  const addBoost = (company, multiplier = 1) => {
    for (const bm of company.battalionMult) {
      const cur = boost.get(bm.category) || {};
      for (const [k, v] of Object.entries(bm.stats)) cur[k] = (cur[k] || 0) + v * multiplier;
      boost.set(bm.category, cur);
    }
  };
  for (const id of support) addBoost(byId.get(id));
  for (const assignment of regAssignments.values()) addBoost(byId.get(assignment.id), assignment.battalions);

  let sa = 0, ha = 0, air = 0, def = 0, brk = 0, hp = 0, ic = 0, mp = 0, sup = 0, trucks = 0, width = 0, recon = 0;
  let orgSum = 0, recSum = 0, hardSum = 0, armSum = 0, pierSum = 0, relSum = 0;
  let armMax = 0, pierMax = 0;
  let spd = Infinity;
  const equipment = {};
  const addEquipment = (u, multiplier = 1) => {
    for (const [k, v] of Object.entries(u.equipment || {})) equipment[k] = (equipment[k] || 0) + v * multiplier;
  };
  for (const u of line) {
    let bsa = u.sa, bha = u.ha, bdef = u.def, bbrk = u.brk, bpier = u.pier, bair = u.air;
    if (boost.size) {
      let fsa = 0, fha = 0, fdef = 0, fbrk = 0, fpier = 0, fair = 0;
      for (const c of u.cats) {
        const b = boost.get(c);
        if (b) { fsa += b.sa || 0; fha += b.ha || 0; fdef += b.def || 0; fbrk += b.brk || 0; fpier += b.pier || 0; fair += b.air || 0; }
      }
      bsa *= 1 + fsa; bha *= 1 + fha; bdef *= 1 + fdef; bbrk *= 1 + fbrk; bpier *= 1 + fpier; bair *= 1 + fair;
    }
    sa += bsa; ha += bha; air += bair; def += bdef; brk += bbrk; hp += u.hp;
    ic += u.ic; mp += u.mp; sup += u.sup; trucks += u.trucks; width += u.width;
    orgSum += u.org; recSum += u.rec; hardSum += u.hard; armSum += u.arm; pierSum += bpier; relSum += u.rel ?? 1;
    if (u.arm > armMax) armMax = u.arm;
    if (bpier > pierMax) pierMax = bpier;
    addEquipment(u);
    if (u.affectsSpeed && u.spd > 0 && u.spd < spd) spd = u.spd;
  }
  const perks = { engineer: 0, hospital: 0, logistics: 0, maintenance: 0, signal: 0, police: 0 };
  let avgN = n;
  const addCompanyStats = (u, multiplier = 1) => {
    sa += u.sa * multiplier; ha += u.ha * multiplier; air += u.air * multiplier;
    def += u.def * multiplier; brk += u.brk * multiplier; hp += u.hp * multiplier;
    ic += u.ic * multiplier; mp += u.mp * multiplier; sup += u.sup * multiplier;
    trucks += u.trucks * multiplier; recon += u.recon * multiplier;
    // A regimental company represents equipment/stats for each battalion in its regiment.
    if (opts.supportDilutesOrg) {
      orgSum += u.org * multiplier; recSum += u.rec * multiplier; avgN += multiplier;
    }
    for (const k in u.perks) if (k in perks) perks[k] += u.perks[k] * multiplier;
    addEquipment(u, multiplier);
  };
  for (const id of support) addCompanyStats(byId.get(id));
  for (const assignment of regAssignments.values()) addCompanyStats(byId.get(assignment.id), assignment.battalions);
  const m = (k) => 1 + (mods[k] || 0) / 100;
  const cols = COLUMN_TYPES.reduce((sum, type) => sum + (layout[type] || 0), 0);
  // Apply the same support rules the search enforces, so a template built by hand (or read from a link) is
  // never reported as valid when the game would reject it: at most five companies, no two of a kind, and no
  // two companies that share a support type.
  let supportOk = support.length <= MAX_SUPPORT;
  for (let i = 0; supportOk && i < support.length; i++) {
    for (let j = i + 1; j < support.length; j++) {
      if (supportConflict(byId.get(support[i]), byId.get(support[j]))) { supportOk = false; break; }
    }
  }
  const regOk = new Set(reg).size === reg.length && regAssignments.size === reg.length;
  return {
    sa: sa * m('sa'),
    ha: ha * m('ha'),
    air,
    def: def * m('def'),
    brk: brk * m('brk'),
    // HOI4 takes 30% of the best battalion's piercing and armor plus 70% of the average.
    pier: (ARMOR_MAX_SHARE * pierMax + (1 - ARMOR_MAX_SHARE) * (pierSum / n)) * m('pier'),
    // HOI4 organization is the arithmetic average across all line battalions and support companies.
    org: (orgSum / avgN) * m('org'),
    rec: recSum / avgN,
    hp: hp * m('hp'),
    arm: (ARMOR_MAX_SHARE * armMax + (1 - ARMOR_MAX_SHARE) * (armSum / n)) * m('arm'),
    hard: hardSum / n,
    rel: (relSum / n) * 100,
    spd: spd === Infinity ? 0 : spd,
    ic, mp, sup, trucks, recon,
    ...perks,
    width,
    n,
    cols,
    cnt,
    layout,
    regCount: regAssignments.size,
    regs: regAssignments.size,
    equipment,
    valid: layout.ok && supportOk && regOk,
  };
}

export function fmt(value, key) {
  if (value == null || Number.isNaN(value)) return '–';
  const dp = STAT_BY_KEY[key]?.dp ?? (key === 'width' ? 0 : 1);
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
