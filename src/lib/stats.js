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
  { key: 'spd', label: 'Speed (km/h)', group: 'Mobility', dir: 1, dp: 1 },
  { key: 'ic', label: 'Production cost', group: 'Cost', dir: -1, dp: 0 },
  { key: 'mp', label: 'Manpower', group: 'Cost', dir: -1, dp: 0 },
  { key: 'sup', label: 'Supply use', group: 'Cost', dir: -1, dp: 2 },
  { key: 'trucks', label: 'Trucks needed', group: 'Cost', dir: -1, dp: 0 },
  { key: 'recon', label: 'Recon', group: 'Utility', dir: 1, dp: 1 },
  { key: 'engineer', label: 'Engineer company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'hospital', label: 'Field hospital', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'logistics', label: 'Logistics company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'maintenance', label: 'Maintenance company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'signal', label: 'Signal company', group: 'Utility', dir: 1, dp: 0, perk: true },
  { key: 'police', label: 'Military police', group: 'Utility', dir: 1, dp: 0, perk: true },
];

export const STAT_KEYS = STATS.map((s) => s.key);
export const STAT_INDEX = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i]));
export const STAT_BY_KEY = Object.fromEntries(STATS.map((s) => [s.key, s]));

// stats that can be chosen as chart axes
export const AXIS_STATS = ['sa', 'ha', 'brk', 'def', 'org', 'hp', 'arm', 'pier', 'spd', 'ic', 'mp', 'width'];
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
export const MAX_SUPPORT = 5;

// Column families mirror the game's designer: artillery is not an infantry column.
export const COLUMN_TYPES = ['infantry', 'artillery', 'mobile', 'mobile_artillery', 'armor'];
export function columnsNeeded(counts, size = 5) {
  return COLUMN_TYPES.reduce((n, t) => n + Math.ceil((counts[t] || 0) / size), 0);
}

export const REG_MIN_BATTALIONS = 3;
const COL_TYPES = COLUMN_TYPES;

/**
 * Decide how many columns each type is spread over. Every type needs enough columns to hold its battalions.
 * Spare columns (up to five in all) can be used to spread battalions out so more columns reach three battalions,
 * which is what unlocks a regimental support slot. Vehicle (SP) regimental companies need an armor column,
 * the rest need an infantry or mobile column. Returns { ok, infantry, mobile, armor, slots } where slots is the
 * number of regimental companies the layout can take.
 */
export function planColumns(cnt, size, armorRegs = 0, otherRegs = 0) {
  const min = Object.fromEntries(COL_TYPES.map((t) => [t, Math.ceil((cnt[t] || 0) / size)]));
  const base = COL_TYPES.reduce((n, t) => n + min[t], 0);
  if (base > MAX_COLUMNS) return { ok: false, ...min, slots: 0 };
  const spare = MAX_COLUMNS - base;
  const room = (t) => Math.max(0, (cnt[t] || 0) - min[t]); // a column cannot be empty
  let best = null;
  const visit = (index, left, cols) => {
    if (index === COL_TYPES.length) {
      const elig = (t) => Math.min(cols[t], Math.floor((cnt[t] || 0) / REG_MIN_BATTALIONS));
      const armorSlots = elig('armor');
      const otherSlots = COL_TYPES.filter((t) => t !== 'armor').reduce((n, t) => n + elig(t), 0);
      const candidate = { ...cols, slots: armorSlots + otherSlots };
      if (!best || candidate.slots > best.slots) best = candidate;
      if (armorRegs <= armorSlots && otherRegs <= otherSlots) best = { ...candidate, ok: true };
      return;
    }
    const t = COL_TYPES[index];
    for (let extra = 0; extra <= Math.min(left, room(t)); extra++) {
      visit(index + 1, left - extra, { ...cols, [t]: min[t] + extra });
      if (best?.ok) return;
    }
  };
  visit(0, spare, {});
  return best ? { ...best, ok: !!best.ok || (armorRegs === 0 && otherRegs === 0) } : { ok: false, ...min, slots: 0 };
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

  // support companies can lift the stats of whole categories of battalions (e.g. recon boosts artillery)
  const boost = new Map();
  for (const c of comps) {
    for (const bm of c.battalionMult) {
      const cur = boost.get(bm.category) || {};
      for (const [k, v] of Object.entries(bm.stats)) cur[k] = (cur[k] || 0) + v;
      boost.set(bm.category, cur);
    }
  }

  let sa = 0, ha = 0, air = 0, def = 0, brk = 0, hp = 0, ic = 0, mp = 0, sup = 0, trucks = 0, width = 0, recon = 0;
  let orgSum = 0, recSum = 0, hardSum = 0, armSum = 0, pierSum = 0;
  let spd = Infinity;
  const cnt = Object.fromEntries(COLUMN_TYPES.map((t) => [t, 0]));
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
    orgSum += u.org; recSum += u.rec; hardSum += u.hard; armSum += u.arm; pierSum += bpier;
    if (u.affectsSpeed && u.spd > 0 && u.spd < spd) spd = u.spd;
    cnt[u.cat]++;
  }
  const perks = { engineer: 0, hospital: 0, logistics: 0, maintenance: 0, signal: 0, police: 0 };
  let avgN = n;
  for (const u of comps) {
    sa += u.sa; ha += u.ha; air += u.air; def += u.def; brk += u.brk; hp += u.hp;
    ic += u.ic; mp += u.mp; sup += u.sup; trucks += u.trucks; recon += u.recon;
    // support piercing, armor and hardness are not added to the combat averages
    if (opts.supportDilutesOrg) { orgSum += u.org; recSum += u.rec; avgN++; }
    for (const k in u.perks) if (k in perks) perks[k] += u.perks[k];
  }
  const m = (k) => 1 + (mods[k] || 0) / 100;
  const armorRegs = reg.filter((id) => byId.get(id).tank).length;
  const layout = planColumns(cnt, columnSize, armorRegs, reg.length - armorRegs);
  const cols = COLUMN_TYPES.reduce((sum, type) => sum + (layout[type] || 0), 0);
  return {
    sa: sa * m('sa'),
    ha: ha * m('ha'),
    air,
    def: def * m('def'),
    brk: brk * m('brk'),
    pier: (pierSum / n) * m('pier'),
    // HOI4 organization is the arithmetic average across all line battalions and support companies.
    org: (orgSum / avgN) * m('org'),
    rec: recSum / avgN,
    hp: hp * m('hp'),
    arm: (armSum / n) * m('arm'),
    hard: hardSum / n,
    spd: spd === Infinity ? 0 : spd,
    ic, mp, sup, trucks, recon,
    ...perks,
    width,
    n,
    cols,
    cnt,
    layout,
    valid: layout.ok && support.length <= MAX_SUPPORT,
  };
}

export function fmt(value, key) {
  if (value == null || Number.isNaN(value)) return '–';
  const dp = STAT_BY_KEY[key]?.dp ?? (key === 'width' ? 0 : 1);
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
