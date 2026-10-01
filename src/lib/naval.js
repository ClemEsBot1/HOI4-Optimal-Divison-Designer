/**
 * Ship designs by role, from the ship designer data in src/data/designers.json.
 *
 *   shipStats(data, variant, modules, year)    final stats of one design
 *   bestShip(data, roleId, year)               exhaustive search for the best design of a role
 *
 * Stat model (Man the Guns ship designer):
 *   stat = (hull + sum of module additions + average of the modules' averaged stats) * (1 + module multipliers)
 *          * (1 + bonuses from researched technologies for the ship type)
 * The ship type (destroyer, light or heavy cruiser, battleship, battlecruiser, carrier, submarine) follows from the
 * hull and, for cruisers and capitals, from the main battery or armor fitted.
 */

const LOWER_IS_BETTER = new Set(['build_cost_ic', 'surface_visibility', 'sub_visibility', 'fuel_consumption']);

export const SHIP_STATS = [
  ['lg_attack', 'Light attack'], ['lg_armor_piercing', 'Light piercing'], ['hg_attack', 'Heavy attack'], ['hg_armor_piercing', 'Heavy piercing'],
  ['torpedo_attack', 'Torpedo attack'], ['sub_attack', 'Anti-submarine attack'], ['anti_air_attack', 'Anti-air attack'],
  ['armor_value', 'Armor'], ['max_strength', 'Hit points'], ['naval_speed', 'Speed (kn)'], ['reliability', 'Reliability'],
  ['naval_range', 'Range (km)'], ['surface_detection', 'Surface detection'], ['sub_detection', 'Sub detection'],
  ['surface_visibility', 'Surface visibility'], ['sub_visibility', 'Sub visibility'], ['mines_planting', 'Mine laying'],
  ['mines_sweeping', 'Mine sweeping'], ['carrier_size', 'Air wings (deck)'], ['build_cost_ic', 'Production cost'],
];

// guns a light cruiser can carry without becoming a heavy cruiser
const LIGHT_GUNS = /^(ship_light_battery|dp_light_battery|ship_light_medium_battery)/;

/**
 * Roles: which hull, what the design is scored on (weight * ln(stat + floor), costs and visibility negative) and
 * what it must carry. Weights follow the common competitive use of each role.
 */
export const SHIP_ROLES = [
  { id: 'dd_screen', group: 'Destroyers', name: 'Screen destroyer', hull: 'ship_hull_light',
    blurb: 'Cheap, fast screens that keep the battle line\'s screening ratio up. Spend nothing that does not help them survive.',
    weights: { naval_speed: 6, max_strength: 3, anti_air_attack: 1, sub_attack: 1, build_cost_ic: -8 } },
  { id: 'dd_asw', group: 'Destroyers', name: 'Anti-submarine destroyer', hull: 'ship_hull_light',
    blurb: 'Convoy escort and submarine hunter: depth charges and sonar first, then speed.',
    weights: { sub_attack: 8, sub_detection: 6, naval_speed: 2, build_cost_ic: -4 }, require: ['ship_depth_charge', 'ship_sonar'] },
  { id: 'dd_torpedo', group: 'Destroyers', name: 'Torpedo destroyer', hull: 'ship_hull_light',
    blurb: 'Hits capital ships with torpedoes from the screen line. Low visibility helps it close in.',
    weights: { torpedo_attack: 8, naval_speed: 3, surface_visibility: -2, build_cost_ic: -3 }, require: ['ship_torpedo'] },
  { id: 'dd_aa', group: 'Destroyers', name: 'Anti-air destroyer', hull: 'ship_hull_light',
    blurb: 'Protects the fleet from naval bombers; fleet anti-air stacks with every ship in the task force.',
    weights: { anti_air_attack: 8, naval_speed: 2, max_strength: 1, build_cost_ic: -3 }, require: ['ship_anti_air'] },
  { id: 'dd_minelayer', group: 'Destroyers', name: 'Minelayer', hull: 'ship_hull_light',
    blurb: 'Lays defensive minefields in your own sea zones.',
    weights: { mines_planting: 8, naval_speed: 2, build_cost_ic: -3 }, require: ['ship_mine_layer'] },
  { id: 'dd_minesweeper', group: 'Destroyers', name: 'Minesweeper', hull: 'ship_hull_light',
    blurb: 'Clears enemy minefields ahead of invasions and convoy routes.',
    weights: { mines_sweeping: 8, naval_speed: 1, build_cost_ic: -3 }, require: ['ship_mine_warfare'] },

  { id: 'cl_light_attack', group: 'Cruisers', name: 'Light attack cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'The usual backbone of a surface fleet: every slot that can take a light battery takes one, with armor and fire control.',
    weights: { lg_attack: 8, lg_armor_piercing: 4, armor_value: 3, max_strength: 3, naval_speed: 3, anti_air_attack: 1, build_cost_ic: -5 } },
  { id: 'cl_aa', group: 'Cruisers', name: 'Anti-air cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'A light cruiser built around anti-air guns to cover carriers and the battle line.',
    weights: { anti_air_attack: 8, lg_attack: 2, naval_speed: 2, max_strength: 1, build_cost_ic: -3 }, require: ['ship_anti_air'] },
  { id: 'cl_torpedo', group: 'Cruisers', name: 'Torpedo cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'Light cruiser hull with torpedo tubes in the custom slots.',
    weights: { torpedo_attack: 8, lg_attack: 2, naval_speed: 3, build_cost_ic: -3 }, require: ['ship_torpedo'] },
  { id: 'ca_heavy_attack', group: 'Cruisers', name: 'Heavy cruiser', hull: 'ship_hull_cruiser', needBattery: /^ship_medium_battery_/, type: 'heavy_cruiser',
    blurb: 'Heavy cruiser batteries give heavy attack and piercing, which makes it a capital ship in combat.',
    weights: { hg_attack: 8, hg_armor_piercing: 4, armor_value: 4, max_strength: 3, naval_speed: 2, lg_attack: 1, build_cost_ic: -4 } },
  { id: 'cl_minelayer', group: 'Cruisers', name: 'Minelaying cruiser', hull: 'ship_hull_cruiser', batteryOk: LIGHT_GUNS, type: 'light_cruiser',
    blurb: 'Lays more mines per ship than a destroyer and survives better while doing it.',
    weights: { mines_planting: 8, naval_speed: 2, build_cost_ic: -3 }, require: ['ship_mine_layer'] },

  { id: 'bb', group: 'Capital ships', name: 'Battleship', hull: 'ship_hull_heavy', armor: 'bb', type: 'battleship',
    blurb: 'Heavy batteries, the thickest armor and the most hit points: the core of the battle line.',
    weights: { hg_attack: 8, hg_armor_piercing: 3, armor_value: 6, max_strength: 5, naval_speed: 1, anti_air_attack: 1, build_cost_ic: -4 } },
  { id: 'bc', group: 'Capital ships', name: 'Battlecruiser', hull: 'ship_hull_heavy', armor: 'bc', type: 'battle_cruiser',
    blurb: 'Battleship guns on a faster, lighter hull: keeps up with carriers and cruisers.',
    weights: { hg_attack: 7, naval_speed: 6, armor_value: 3, max_strength: 3, build_cost_ic: -4 } },
  { id: 'shbb', group: 'Capital ships', name: 'Super-heavy battleship', hull: 'ship_hull_heavy', superHeavy: true,
    blurb: 'The largest guns and armor in the game, at a price only a major industry can pay.',
    weights: { hg_attack: 8, hg_armor_piercing: 3, armor_value: 6, max_strength: 5, anti_air_attack: 1, build_cost_ic: -3 } },

  { id: 'cv', group: 'Carriers', name: 'Fleet carrier', hull: 'ship_hull_carrier', standardOnly: true,
    blurb: 'As many air wings as the hull takes, with anti-air and speed. Its planes do the fighting.',
    weights: { carrier_size: 10, anti_air_attack: 2, naval_speed: 3, max_strength: 2, build_cost_ic: -3 } },
  { id: 'cv_armored', group: 'Carriers', name: 'Armored carrier', hull: 'ship_hull_carrier', standardOnly: true,
    blurb: 'Gives up some deck space for an armored deck, so it survives bombing.',
    weights: { carrier_size: 6, max_strength: 4, armor_value: 3, anti_air_attack: 2, build_cost_ic: -3 }, require: ['ship_carrier_armor'] },

  { id: 'ss_raider', group: 'Submarines', name: 'Convoy raider', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'Torpedoes and low visibility for sinking convoys; range lets it reach the shipping lanes.',
    weights: { torpedo_attack: 6, sub_visibility: -8, naval_range: 3, naval_speed: 2, build_cost_ic: -5 } },
  { id: 'ss_minelayer', group: 'Submarines', name: 'Minelaying submarine', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'Lays mines in enemy waters where surface minelayers could not survive.',
    weights: { mines_planting: 8, sub_visibility: -4, naval_range: 2, build_cost_ic: -3 }, require: ['ship_mine_layer_sub'] },
  { id: 'ss_cruiser', group: 'Submarines', name: 'Long-range submarine', hull: 'ship_hull_submarine', standardOnly: true,
    blurb: 'For distant oceans: range first, then torpedoes and stealth.',
    weights: { naval_range: 6, torpedo_attack: 3, sub_visibility: -4, build_cost_ic: -3 } },
];

const FLOOR = { reliability: 0.05, naval_speed: 1, build_cost_ic: 50, naval_range: 100 };

const STANDARD_HULL = /^ship_hull_(light|cruiser|heavy|carrier|submarine)_\d$/;

/** Hull variants a role can use in a year: the standard line, plus the super-heavy hull for that role. */
export function hullsFor(data, role, year) {
  const d = data.designers[role.hull];
  if (!d) return [];
  return d.variants.filter((v) => {
    if (v.year > year) return false;
    if (role.superHeavy) return /super_heavy/.test(v.id);
    if (/super_heavy/.test(v.id)) return false;
    return STANDARD_HULL.test(v.id);
  });
}

function shipType(hull, modules, data) {
  const cats = Object.values(modules).filter(Boolean).map((id) => data.modules[id]?.cat);
  if (hull.startsWith('ship_hull_light')) return 'destroyer';
  if (hull.startsWith('ship_hull_cruiser')) return Object.values(modules).some((id) => /^ship_medium_battery_/.test(id || '')) ? 'heavy_cruiser' : 'light_cruiser';
  if (/super_heavy/.test(hull)) return 'super_heavy_battleship';
  if (hull.startsWith('ship_hull_heavy')) return Object.values(modules).some((id) => /armor_bc/.test(id || '')) ? 'battle_cruiser' : 'battleship';
  if (hull.startsWith('ship_hull_carrier')) return 'carrier';
  if (hull.startsWith('ship_hull_submarine')) return 'submarine';
  return null;
}

export function typeBonuses(data, type, year) {
  const out = {};
  for (const m of data.typeMods || []) {
    if (m.year > year || m.type !== type) continue;
    for (const [k, v] of Object.entries(m.stats)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

export function shipStats(data, variant, modules, year) {
  const s = { ...variant.stats };
  const mul = {}; const avg = {};
  for (const id of Object.values(modules)) {
    const m = id && data.modules[id];
    if (!m) continue;
    for (const [k, v] of Object.entries(m.add)) s[k] = (s[k] || 0) + v;
    for (const [k, v] of Object.entries(m.mul)) mul[k] = (mul[k] || 0) + v;
    for (const [k, v] of Object.entries(m.avg)) (avg[k] ||= []).push(v);
  }
  for (const [k, vs] of Object.entries(avg)) s[k] = (s[k] || 0) + vs.reduce((a, b) => a + b, 0) / vs.length;
  for (const [k, v] of Object.entries(mul)) s[k] = (s[k] || 0) * (1 + v);
  const type = shipType(variant.id, modules, data);
  for (const [k, v] of Object.entries(typeBonuses(data, type, year))) if (k in s) s[k] *= 1 + v;
  if (s.reliability != null) s.reliability = Math.max(0, Math.min(1, s.reliability));
  s.type = type;
  return s;
}

const scoreOf = (s, weights) => {
  let x = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = Math.max(0, s[k] || 0) + (FLOOR[k] ?? 1);
    x += w * Math.log(v);
  }
  return x;
};

/**
 * Exhaustive search for one role. Options in a slot that another option of the same slot beats on every scored
 * stat are dropped first (it can never lose to drop them), interchangeable custom slots are filled in a fixed order,
 * and every remaining combination is scored.
 */
export function bestShip(data, role, year, { budget = 6e5 } = {}) {
  const hulls = hullsFor(data, role, year);
  let best = null; let evaluated = 0; let truncated = false; let nodes = 0;
  const keys = Object.keys(role.weights);
  // proven to within a 0.5% gain on every scored stat, like the division search
  const tol = 0.005 * keys.reduce((a, k) => a + Math.abs(role.weights[k]), 0);
  const dirOf = (k) => (role.weights[k] < 0 ? -1 : 1);
  const modsBy = (cats) => Object.values(data.modules).filter((m) => cats.includes(m.cat) && m.year <= year);
  const allowed = (m) => !(role.batteryOk && /battery/.test(m.cat) && !role.batteryOk.test(m.id));
  for (const hull of [...hulls].sort((x, y) => y.year - x.year)) {
    const names0 = Object.keys(hull.slots).filter((n) => hull.slots[n]);
    const optionsOf = (n) => {
      const slot = hull.slots[n];
      let mods = modsBy(slot.cats).filter(allowed);
      if (role.armor) mods = mods.filter((m) => m.cat !== 'ship_heavy_armor' || new RegExp(`armor_${role.armor}_`).test(m.id));
      // drop modules another module of the same category beats on every stat the role scores
      const vec = (m) => keys.flatMap((k) => { const d = dirOf(k); return [d * (m.add[k] || 0), d * (m.mul[k] || 0), d * (m.avg[k] || 0)]; });
      const kept = mods.filter((m) => !mods.some((o) => o !== m && o.cat === m.cat && (() => {
        const x = vec(o); const y = vec(m); let strict = false;
        for (let i = 0; i < x.length; i++) { if (x[i] < y[i] - 1e-12) return false; if (x[i] > y[i] + 1e-12) strict = true; }
        return strict || (x.every((v, i) => Math.abs(v - y[i]) < 1e-12) && o.id < m.id);
      })()));
      const ids = kept.map((m) => m.id);
      if (!slot.required || !ids.length) ids.push(null);
      // most promising first, so a strong design is found early and prunes the rest
      const alone = (id) => scoreOf(shipStats(data, hull, id ? { [n]: id } : {}, year), role.weights);
      const val = new Map(ids.map((id) => [id, alone(id)]));
      return ids.sort((x, y) => val.get(y) - val.get(x));
    };
    // fixed slots first (they carry the main battery and armor), then the interchangeable custom slots
    const slotNames = [...names0.filter((n) => !/custom/.test(n)), ...names0.filter((n) => /custom/.test(n))];
    const options = slotNames.map(optionsOf);
    const sig = options.map((o, i) => (/custom/.test(slotNames[i]) ? o.join(',') : null));
    const limitsOk = (chosen, upto) => (hull.limits || []).every((l) => {
      let n = 0;
      for (let i = 0; i < upto; i++) { const id = chosen[i]; if (id && (id === l.module || data.modules[id].cat === l.category)) n++; }
      return l.op === '<' ? n < l.count : l.op === '<=' ? n <= l.count : true;
    });

    // per remaining slots: most and least each module can add / multiply, and the best averaged value
    const range = slotNames.map((n, i) => Object.fromEntries(keys.map((k) => {
      const ms = options[i].map((id) => (id ? data.modules[id] : { add: {}, mul: {}, avg: {} }));
      const adds = ms.map((m) => m.add[k] || 0); const muls = ms.map((m) => m.mul[k] || 0);
      const avgs = ms.filter((m) => k in m.avg).map((m) => m.avg[k]);
      return [k, { addHi: Math.max(...adds), addLo: Math.min(...adds), mulHi: Math.max(...muls), mulLo: Math.min(...muls), avgHi: avgs.length ? Math.max(...avgs) : null, avgLo: avgs.length ? Math.min(...avgs) : null }];
    })));
    // technology bonuses for any type this hull could become
    const types = hull.id.startsWith('ship_hull_cruiser') ? ['light_cruiser', 'heavy_cruiser'] : hull.id.startsWith('ship_hull_heavy') && !/super/.test(hull.id) ? ['battleship', 'battle_cruiser'] : [shipType(hull.id, {}, data)];
    const tb = types.map((t) => typeBonuses(data, t, year));
    const typeHi = Object.fromEntries(keys.map((k) => [k, Math.max(...tb.map((b) => b[k] || 0))]));
    const typeLo = Object.fromEntries(keys.map((k) => [k, Math.min(...tb.map((b) => b[k] || 0))]));

    const nS = slotNames.length; const nK = keys.length;
    // suffix sums of the per-slot ranges, so the bound costs one pass over the scored stats
    const suf = keys.map((k) => {
      const up = dirOf(k) > 0;
      const add = new Float64Array(nS + 1); const mul = new Float64Array(nS + 1); const avg = new Array(nS + 1).fill(null);
      for (let j = nS - 1; j >= 0; j--) {
        const r = range[j][k];
        add[j] = add[j + 1] + (up ? r.addHi : r.addLo); mul[j] = mul[j + 1] + (up ? r.mulHi : r.mulLo);
        const c = up ? r.avgHi : r.avgLo; const n = avg[j + 1];
        avg[j] = c == null ? n : n == null ? c : up ? Math.max(c, n) : Math.min(c, n);
      }
      return { up, add, mul, avg };
    });
    const pAdd = new Float64Array(nK); const pMul = new Float64Array(nK); const pAvgSum = new Float64Array(nK); const pAvgN = new Float64Array(nK);
    const modVec = new Map();
    for (const ids of options) for (const id of ids) if (id && !modVec.has(id)) {
      const m = data.modules[id];
      modVec.set(id, keys.map((k) => [m.add[k] || 0, m.mul[k] || 0, k in m.avg ? m.avg[k] : null]));
    }
    const apply = (id, sign) => {
      if (!id) return;
      const v = modVec.get(id);
      for (let q = 0; q < nK; q++) { pAdd[q] += sign * v[q][0]; pMul[q] += sign * v[q][1]; if (v[q][2] != null) { pAvgSum[q] += sign * v[q][2]; pAvgN[q] += sign; } }
    };
    const stB = {};
    const bound = (i) => {
      for (let q = 0; q < nK; q++) {
        const k = keys[q]; const S = suf[q];
        const cur = pAvgN[q] > 0 ? pAvgSum[q] / pAvgN[q] : null; const rem = S.avg[i];
        const av = cur == null ? rem : rem == null ? cur : S.up ? Math.max(cur, rem) : Math.min(cur, rem);
        let v = ((hull.stats[k] || 0) + pAdd[q] + S.add[i] + (av || 0)) * (1 + pMul[q] + S.mul[i]) * (1 + (S.up ? typeHi[k] : typeLo[k]));
        if (k === 'reliability') v = Math.max(0, Math.min(1, v));
        stB[k] = v;
      }
      return scoreOf(stB, role.weights);
    };
    const chosen = new Array(slotNames.length).fill(null);
    const rec = (i) => {
      if (++nodes > budget) { truncated = true; return; }
      if (i === slotNames.length) {
        const cats = chosen.filter(Boolean).map((id) => data.modules[id].cat);
        if ((role.require || []).some((c) => !cats.includes(c))) return;
        if (role.needBattery && !chosen.some((id) => id && role.needBattery.test(id))) return;
        const mods = Object.fromEntries(slotNames.map((n, k) => [n, chosen[k]]));
        const st = shipStats(data, hull, mods, year);
        if (role.type && st.type !== role.type) return;
        evaluated++;
        const sc = scoreOf(st, role.weights);
        if (!best || sc > best.score + 1e-12) best = { score: sc, hull: hull.id, hullName: hull.name, modules: mods, stats: st };
        return;
      }
      if (best && bound(i) <= best.score + tol) return;
      let prevIdx = Infinity;
      for (let j = i - 1; j >= 0; j--) if (sig[j] && sig[j] === sig[i]) { prevIdx = options[j].indexOf(chosen[j]); break; }
      for (let k = 0; k < options[i].length; k++) {
        if (sig[i] && k > prevIdx) continue;
        chosen[i] = options[i][k];
        if (!limitsOk(chosen, i + 1)) continue;
        apply(chosen[i], 1);
        rec(i + 1);
        apply(chosen[i], -1);
        if (truncated) break;
      }
      chosen[i] = null;
    };
    rec(0);
  }
  return best ? { ...best, role: role.id, evaluated, nodes, truncated } : null;
}

export const isLowerBetter = (k) => LOWER_IS_BETTER.has(k);
