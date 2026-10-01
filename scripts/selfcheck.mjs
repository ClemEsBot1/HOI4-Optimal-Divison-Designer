// Sanity checks for the engine against the extracted data: node scripts/selfcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, techsUpTo, researchTech, unresearchTech, canResearch, resolve, collectModifiers, unlocks, designSearch, designStats } from '../src/lib/game.js';
import { assignRegimentalColumns, evaluate, planColumns, supportConflict, unitContribution } from '../src/lib/stats.js';
import { objectiveTerms, utility } from '../src/lib/score.js';
import { matchup } from '../src/lib/combat.js';
import { runGolden } from './golden.mjs';
import { defaultExclude, roleExclude, ROLES } from '../src/lib/presets.js';
import { search, DEFAULT_CONSTRAINTS } from '../src/lib/optimizer.js';
import { encodeState, decodeState } from '../src/lib/format.js';
import { metaTanks, roleTanks } from '../src/lib/tankRoles.js';
import { MIN_DESIGN_RELIABILITY } from '../src/lib/game.js';
import { SHIP_ROLES, bestShip, hullsFor, shipStats } from '../src/lib/naval.js';
import { PLANE_ROLES, bestPlane, framesFor, planeStats, hasPlaneData, FLOOR as PLANE_FLOOR } from '../src/lib/air.js';
import { emptyGrid, gridFromTemplate, templateFromGrid, placeBattalion, fillColumn, removeBattalion, setRegimental, setSupport, battalionChoices, regimentalChoices, supportChoices, slotContribution } from '../src/lib/grid.js';
import { THEATRES, frontageFit, fitTable, fittingWidths, battleFill } from '../src/lib/frontage.js';
import { FLEETS, fleetSlots, composeFleet, planDockyards, buildBalance, lineItems, fitScale, SCREENS_PER_SHIP, MAX_CARRIERS } from '../src/lib/fleet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = buildGame(JSON.parse(fs.readFileSync(path.join(here, '../src/data/game.json'), 'utf8')));
const naval = JSON.parse(fs.readFileSync(path.join(here, '../src/data/designers.json'), 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// tech tree editing
const leaf = [...game.techs.values()].filter((t) => !t.special && t.parents.length && t.year >= 1940)[0];
const s1 = researchTech(game, new Set(), leaf.id);
ok(s1.has(leaf.id) && s1.size >= 2, `researching ${leaf.id} pulls in prerequisites (${s1.size} techs)`);
ok(canResearch(game, s1, leaf.id) === (leaf.parents.length === 0 || leaf.parents.some((p) => s1.has(p))) || s1.has(leaf.id), 'tree stays valid');
const root = [...s1].find((id) => !game.techs.get(id).parents.length);
const s2 = unresearchTech(game, s1, root);
ok(!s2.has(leaf.id), 'removing a root removes its dependants');
const xorTech = [...game.techs.values()].find((t) => t.xor.length && !t.special);
if (xorTech) { const s = researchTech(game, researchTech(game, new Set(), xorTech.xor[0]), xorTech.id); ok(!s.has(xorTech.xor[0]), 'xor techs exclude each other'); }

// doctrine
const T = techsUpTo(game, 1945);
const g = [...game.grands.values()].find((x) => x.folder === 'land');
const track = g.tracks[0];
const sub = [...game.subs.values()].find((s) => s.tracks.includes(track));
const doctrine = { grands: [g.id], slots: { [track]: [sub.id] }, progress: {} };
const before = resolve(game, { techs: T });
const after = resolve(game, { techs: T, doctrine });
const changed = [...after.byId.values()].filter((u) => { const b = before.byId.get(u.id); return b && ['sa', 'ha', 'def', 'brk', 'org', 'hp', 'spd', 'width', 'rec'].some((k) => Math.abs(u[k] - b[k]) > 1e-9); });
ok(changed.length > 0, `doctrine ${g.name} / ${sub.name} changes ${changed.length} units`);
ok(collectModifiers(game, T, { grands: [], slots: {}, progress: {} }).columnBonus === 0, 'no column bonus without doctrine');

// share link round trip
const st = { r: 'line', w: { sa: 5 }, c: { wmin: 20 }, t: [...T], d: doctrine, m: {}, o: {}, ax: ['sa', 'def'] };
const back = decodeState(encodeState(st, game), game);
ok(back.t && back.t.size === T.size && [...T].every((x) => back.t.has(x)), 'share link keeps every researched tech');
{
  const withView = decodeState(encodeState({ ...st, v: 'equipment' }, game), game);
  ok(withView.v === 'equipment' && withView.t && withView.t.size === T.size, 'share link keeps the open view');
  // a link from before the data stamp moved out of `v` still restores its research
  const json = JSON.parse(Buffer.from(encodeState(st, game).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const legacy = Buffer.from(JSON.stringify({ ...json, ds: undefined, v: json.ds })).toString('base64');
  const old = decodeState(legacy, game);
  ok(old.t && old.t.size === T.size && old.v === undefined, 'an older share link still restores its research');
}

// search result matches a fresh evaluation
const r = search(game, { techs: [...T], weights: { sa: 5, def: 8, org: 6, ic: 4 }, constraints: { wmin: 20, wmax: 20 }, topN: 3 });
ok(!!r.top && r.top.length > 0, `search found ${r.top ? r.top.length : 0} designs (${r.explored} tried)`);
if (r.top) {
  const byId = new Map(r.units.map((u) => [u.id, u]));
  const t0 = r.top[0];
  const st0 = evaluate(t0, byId, {}, undefined, r.columnSize);
  ok(Math.abs(st0.sa - t0.stats.sa) < 1e-6 && st0.width === 20, 'top result re-evaluates to the same stats at width 20');
}
const orgPair = evaluate({ items: ['infantry', 'artillery_brigade'], support: [], reg: [] }, before.byId, {}, undefined, before.columnSize);
ok(orgPair && Math.abs(orgPair.org - 30) < 1e-9, 'organization averages line-battalion organization instead of summing it');
const threeLine = ['infantry', 'infantry', 'infantry'];
const oneSupport = evaluate({ items: threeLine, support: ['engineer'], reg: [] }, before.byId, {}, undefined, before.columnSize);
ok(oneSupport && oneSupport.valid, 'one support company keeps a template valid');
const dupSupport = evaluate({ items: threeLine, support: ['engineer', 'engineer'], reg: [] }, before.byId, {}, undefined, before.columnSize);
ok(dupSupport && !dupSupport.valid, 'the same support company cannot be taken twice');
const dupReg = evaluate({ items: threeLine, support: [], reg: ['fire_support', 'fire_support'] }, before.byId, {}, undefined, before.columnSize);
ok(dupReg && !dupReg.valid, 'the same regimental company cannot be taken twice');
// regimental support needs three battalions in a column
ok(!planColumns({ infantry: 2, mobile: 0, armor: 0 }, 5, 0, 1).ok, 'two battalions cannot take a regimental company');
ok(planColumns({ infantry: 3, mobile: 0, armor: 0 }, 5, 0, 1).ok, 'three battalions can take one');
const p6 = planColumns({ infantry: 6, mobile: 0, armor: 0 }, 5, 0, 2);
ok(p6.ok && p6.infantry === 2 && p6.sizes.infantry.join('-') === '3-3', 'six battalions spread over two columns take two companies');
ok(!planColumns({ infantry: 6, mobile: 0, armor: 0 }, 5, 0, 3).ok, 'six battalions cannot take three companies');
const p10 = planColumns({ infantry: 10, mobile: 0, armor: 0 }, 5);
ok(p10.infantry === 4 && p10.slots === 3 && p10.sizes.infantry.join('-') === '3-3-3-1', 'ten infantry battalions use four columns (3-3-3-1) to unlock three regimental slots');
const infantryTen = evaluate({ items: Array(10).fill('infantry'), support: [], reg: [] }, before.byId, {}, undefined, before.columnSize);
ok(infantryTen?.layout.sizes.infantry.join('-') === '3-3-3-1' && infantryTen.layout.slots === 3, '20-width ten-infantry evaluation preserves the 3-3-3-1 support layout');
const companyLayout = planColumns({ infantry: 10, mobile: 0, armor: 0 }, before.columnSize, 0, 1);
const companySlot = assignRegimentalColumns(['fire_support'], companyLayout, before.byId);
ok(companySlot.size === 1 && companySlot.values().next().value.battalions === 3, 'regimental company is assigned to a concrete eligible column');
const tenWithReg = evaluate({ items: Array(10).fill('infantry'), support: [], reg: ['fire_support'] }, before.byId, {}, undefined, before.columnSize);
ok(tenWithReg?.valid && Math.abs((tenWithReg.ic - infantryTen.ic) - 3 * before.byId.get('fire_support').ic) < 1e-6, 'regimental equipment and stats scale with the assigned regiment');
ok(!planColumns({ infantry: 9, mobile: 0, armor: 0 }, 5, 1, 0).ok, 'an SP company needs an armor column');
ok(planColumns({ infantry: 9, mobile: 0, armor: 3 }, 5, 1, 3).ok, 'nine infantry and three tanks take one SP and three other companies');

// special forces stay out by default
const ex = defaultExclude(game);
ok(['paratrooper', 'marine', 'amphibious_mechanized', 'mountaineers', 'ranger_battalion', 'cavalry'].every((id) => ex.includes(id)), 'special forces and cavalry are excluded by default');
const r2 = search(game, { techs: [...T], exclude: ex, weights: { sa: 5, def: 8, org: 6, hp: 5, ic: 4 }, constraints: { wmin: 20, wmax: 20 }, topN: 5 });
const used = new Set(r2.top.flatMap((t) => [...t.items, ...t.support, ...t.reg]));
ok(![...used].some((id) => ex.includes(id)), 'search results never use excluded units');
ok(r2.top.every((t) => { const c = { infantry: 0, mobile: 0, armor: 0 }; t.items.forEach((id) => c[r2.units.find((u) => u.id === id).cat]++); const p = planColumns(c, r2.columnSize, t.reg.filter((id) => r2.units.find((u) => u.id === id).tank).length, t.reg.filter((id) => !r2.units.find((u) => u.id === id).tank).length); return p.ok; }), 'every result respects the regimental rule');
const nonInfantry = [...game.units.values()].filter((u) => u.role === 'line' && u.id !== 'infantry').map((u) => u.id);
const r3 = search(game, { techs: [...T], exclude: nonInfantry, weights: { def: 1 }, constraints: { wmin: 20, wmax: 20 }, topN: 1 });
ok(r3.top?.[0]?.stats.layout.sizes.infantry.join('-') === '3-3-3-1', 'optimizer output for a 20-width pure-infantry template uses 3-3-3-1');
const armorRole = ROLES.find((x) => x.id === 'armor');
const ra = search(game, { techs: [...T], exclude: ex, weights: armorRole.weights, constraints: armorRole.constraints, topN: 2 });
ok(ra.top?.every((t) => { const n = t.items.length; return t.items.filter((id) => ra.units.find((u) => u.id === id).cat === 'armor').length / n > 0.5; }), 'armoured role keeps more than half its line battalions armoured');
ok(ra.top?.every((t) => t.stats.org >= armorRole.constraints.minOrg && t.stats.ic <= armorRole.constraints.maxIc && t.stats.width >= armorRole.constraints.wmin && t.stats.width <= armorRole.constraints.wmax && (t.stats.cnt.mobile / t.stats.n) >= armorRole.constraints.minMobileShare)
  && ra.top[0].stats.width >= 30 && ra.top[0].stats.width <= 36, 'armoured role picks a usable width, and keeps organization, cost and mechanized mix');
ok(ROLES.find((x) => x.id === 'line').constraints.wmax < armorRole.constraints.wmax, 'infantry role is narrower than armoured role');
const spaceRole = ROLES.find((x) => x.id === 'space_marines');
const rs = search(game, { techs: [...T], exclude: ex, weights: spaceRole.weights, constraints: spaceRole.constraints, topN: 2 });
ok(rs.top?.every((t) => { const n = t.items.length; const a = t.items.filter((id) => rs.units.find((u) => u.id === id).cat === 'armor').length; return a >= 1 && a <= 2 && a / n <= 0.5; }), 'space marine role uses a small armoured component');

// ---- the search is exact: compare with brute force on a small unit set ----
{
  const keep = new Set(['infantry', 'artillery_brigade', 'anti_tank_brigade', 'motorized', 'engineer', 'artillery', 'recon', 'mot_recon', 'fire_support', 'field_guns']);
  const exclude = [...game.units.keys()].filter((id) => !keep.has(id));
  const weights = { sa: 5, def: 8, org: 6, ic: 4, engineer: 3, regs: 2 };
  const constraints = { wmin: 14, wmax: 20, minOrg: 40 };
  const params = { techs: [...T], exclude, weights, constraints, topN: 3, coDesign: false };
  const res = resolve(game, { techs: T, exclude });
  // the search fills in the default constraints (per-frontage scoring), so score the brute force the same way
  const terms = objectiveTerms(weights, { ...DEFAULT_CONSTRAINTS, ...constraints }, null);
  const line = res.combat; const sups = res.support; const regs = res.regimental;
  const supSets = [[]];
  for (let i = 0; i < sups.length; i++) for (const set of supSets.slice()) if (set.length < 5 && set.every((j) => !supportConflict(sups[j], sups[i]))) supSets.push([...set, i]);
  const regLists = [[]];
  const perm = (cur) => { for (let j = 0; j < regs.length; j++) if (!cur.includes(j)) { const n = [...cur, j]; regLists.push(n); if (n.length < 5) perm(n); } };
  perm([]);
  let bruteBest = -Infinity; let bruteKey = null; let count = 0;
  const counts = new Array(line.length).fill(0);
  const rec = (i, width, n) => {
    if (i === line.length) {
      if (!n || width < constraints.wmin) return;
      const items = counts.flatMap((c, k) => Array(c).fill(line[k].id));
      for (const set of supSets) for (const rl of regLists) {
        const tpl = { items, support: set.map((j) => sups[j].id), reg: rl.map((j) => regs[j].id) };
        const st = evaluate(tpl, res.byId, {}, undefined, res.columnSize);
        if (!st || !st.valid || st.org < constraints.minOrg) continue;
        count++;
        const sc = utility(st, terms, null);
        if (sc > bruteBest) { bruteBest = sc; bruteKey = tpl; }
      }
      return;
    }
    for (let x = 0; width + x * line[i].width <= constraints.wmax && n + x <= 25; x++) { counts[i] = x; rec(i + 1, width + x * line[i].width, n + x); }
    counts[i] = 0;
  };
  rec(0, 0, 0);
  const rb = search(game, params);
  const gap = bruteBest - rb.top[0].score;
  ok(rb.proven && gap <= 0.005 * terms.reduce((a, t) => a + t.w, 0) + 1e-9, `branch and bound matches brute force over ${count.toLocaleString('en-GB')} templates (gap ${gap.toFixed(4)})`);
  const again = search(game, params);
  ok(again.top[0].key === rb.top[0].key, 'the same setup gives the same answer');
  ok(rb.top.every((t) => Math.abs(utility(evaluate(t, res.byId, {}, undefined, res.columnSize), terms, null) - t.score) < 1e-9), 'every listed score matches a fresh evaluation');
  ok(rb.sensitivity && rb.sensitivity.rows.length === terms.filter((t) => t.kind !== 'frontage' && t.kind !== 'meta').length, 'stability check covers every priority');
  ok(rb.top[0].explain && rb.top[0].explain.length === terms.length, 'the winner comes with a stat-by-stat explanation');
}

// ---- armor and piercing: 30% of the best battalion plus 70% of the average ----
{
  const tanks = before.combat.filter((u) => u.arm > 0).sort((a, b) => b.arm - a.arm);
  if (tanks.length >= 2) {
    const a = tanks[0]; const b = tanks[tanks.length - 1];
    const st = evaluate({ items: [a.id, b.id], support: [], reg: [] }, before.byId, {}, undefined, before.columnSize);
    ok(Math.abs(st.arm - (0.3 * a.arm + 0.7 * (a.arm + b.arm) / 2)) < 1e-9, 'division armor is 30% of the best plus 70% of the average');
  }
}

// ---- exhaustive tank design: matches brute force over every legal module combination ----
{
  const T36 = techsUpTo(game, 1936);
  const open = unlocks(game, T36);
  const linear = { sa: 0.3, ha: 0.2, brk: 0.4, def: 0.1, arm: 0.5, spd: 0.6, ic: -1, rel: 2 };
  const dirs = Object.fromEntries(Object.entries(linear).map(([k, v]) => [k, Math.sign(v)]));
  const d = designSearch(game, T36, 'light_tank_chassis', 'armor', open, { linear }, dirs);
  const chassis = game.raw.designers.light_tank_chassis;
  const variant = chassis.variants.filter((v) => !v.by.length || v.by.some((t) => T36.has(t))).sort((x, y) => y.year - x.year)[0];
  const slots = Object.keys(chassis.slots);
  const mods = Object.values(game.raw.modules).filter((m) => open.mods.has(m.id));
  const turret = slots.find((n) => /turret/.test(n)); const main = slots.find((n) => /main_armament/.test(n));
  const special = slots.filter((n) => /special/.test(n));
  const opts = (sn) => {
    const cats = new Set(chassis.slots[sn].cats);
    if (sn === main) for (const m of mods) if (chassis.slots[turret].cats.includes(m.cat) && m.allowsMain) m.allowsMain.forEach((c) => cats.add(c));
    const ids = mods.filter((m) => cats.has(m.cat) && !m.forbidArmor).map((m) => m.id);
    return chassis.slots[sn].required && ids.length ? ids : [...ids, null];
  };
  const limitsOk = (ids) => chassis.limits.every((l) => ids.filter((id) => id && (id === l.module || game.raw.modules[id].cat === l.category)).length < l.lt);
  const val = (st) => Object.entries(linear).reduce((a, [k, v]) => a + v * st[k], 0);
  let best = -Infinity; let n = 0;
  const core = slots.filter((s2) => !special.includes(s2));
  const specOpts = [...new Set(special.flatMap(opts))].filter(Boolean);
  const specSets = [[]];
  for (const id of specOpts) for (const set of specSets.slice()) if (set.length < special.length) specSets.push([...set, id]);
  const walk = (i, chosen) => {
    if (i === core.length) {
      for (const set of specSets) {
        const all = { ...chosen }; special.forEach((sn, k) => { all[sn] = set[k] || null; });
        if (!limitsOk(Object.values(all))) continue;
        n++; best = Math.max(best, val(designStats(game, chassis, variant, all, T36)));
      }
      return;
    }
    for (const id of opts(core[i])) {
      if (core[i] === main) {
        const t = game.raw.modules[chosen[turret]]; const m = game.raw.modules[id];
        if (!m || !(chassis.slots[main].cats.includes(m.cat) || (t && t.allowsMain && t.allowsMain.includes(m.cat)))) continue;
        if (t && t.forbidMainOnArmor.includes(m.cat)) continue;
      }
      walk(i + 1, { ...chosen, [core[i]]: id });
    }
  };
  walk(0, {});
  ok(d && Math.abs(d.score - best) < 1e-9, `exhaustive tank design matches brute force over ${n.toLocaleString('en-GB')} designs`);
}

// ---- matchup: more attack beats the same opponent faster ----
{
  const us = { sa: 300, ha: 40, def: 400, brk: 80, org: 50, arm: 0, pier: 40, hard: 0, width: 20 };
  const them = { sa: 250, ha: 30, def: 350, brk: 70, org: 50, arm: 0, pier: 30, hard: 0, width: 20 };
  const a = matchup(us, them); const b = matchup({ ...us, sa: 450 }, them);
  ok(b.mAtk > a.mAtk && b.mDef > a.mDef, 'more soft attack improves both matchups');
  const armored = matchup({ ...us, arm: 60 }, them);
  ok(armored.mAtk > a.mAtk, 'armor above the opponent\'s piercing halves the damage taken');
}

// ---- tank designs keep a usable reliability ----
{
  const T45 = techsUpTo(game, 1945);
  const meta = metaTanks(game, T45);
  const low = meta.flatMap((r) => r.options.filter((o) => o.stats.rel < MIN_DESIGN_RELIABILITY - 1e-9).map((o) => `${r.id}/${o.chassis}`));
  ok(!low.length, `every 1945 role design keeps ${MIN_DESIGN_RELIABILITY * 100}% reliability${low.length ? ` (not: ${low.join(', ')})` : ''}`);
}

// ---- ship designer: the search is exact (brute force on the smaller hulls) ----
{
  const FLOOR = { reliability: 0.05, naval_speed: 1, build_cost_ic: 50, naval_range: 100 };
  const scoreOf = (st, w) => Object.entries(w).reduce((x, [k, v]) => x + v * Math.log(Math.max(0, st[k] || 0) + (FLOOR[k] ?? 1)), 0);
  const brute = (role, year, minSpeed = 0) => {
    let best = -Infinity; let n = 0;
    for (const hull of hullsFor(naval, role, year)) {
      const names = Object.keys(hull.slots).filter((x) => hull.slots[x]);
      const opts = names.map((nm) => {
        const sl = hull.slots[nm];
        let mods = Object.values(naval.modules).filter((m) => sl.cats.includes(m.cat) && m.year <= year);
        if (role.batteryOk) mods = mods.filter((m) => !(/battery/.test(m.cat) && !role.batteryOk.test(m.id)));
        if (role.armor) mods = mods.filter((m) => m.cat !== 'ship_heavy_armor' || new RegExp(`armor_${role.armor}_`).test(m.id));
        const ids = mods.map((m) => m.id);
        if (!sl.required || !ids.length) ids.push(null);
        return ids;
      });
      const ch = new Array(names.length);
      const walk = (i) => {
        if (i === names.length) {
          n++;
          for (const l of hull.limits || []) {
            const c = ch.filter((id) => id && (id === l.module || naval.modules[id].cat === l.category)).length;
            if (l.op === '<' ? c >= l.count : l.op === '<=' ? c > l.count : false) return;
          }
          const cats = ch.filter(Boolean).map((id) => naval.modules[id].cat);
          if ((role.require || []).some((c) => !cats.includes(c))) return;
          if (role.needBattery && !ch.some((id) => id && role.needBattery.test(id))) return;
          const st = shipStats(naval, hull, Object.fromEntries(names.map((nm, k) => [nm, ch[k]])), year);
          if (role.type && st.type !== role.type) return;
          if (st.naval_speed < minSpeed - 1e-9) return;
          best = Math.max(best, scoreOf(st, role.weights));
          return;
        }
        for (const id of opts[i]) { ch[i] = id; walk(i + 1); }
      };
      walk(0);
    }
    return { best, n };
  };
  for (const [id, year] of [['dd_screen', 1936], ['dd_torpedo', 1936], ['ss_raider', 1944], ['cv', 1940]]) {
    const role = SHIP_ROLES.find((r) => r.id === id);
    const b = brute(role, year);
    const s = bestShip(naval, role, year);
    ok(s && !s.truncated && Math.abs(s.score - b.best) < 1e-9, `ship designer finds the exact best ${role.name.toLowerCase()} (${year}) among ${b.n.toLocaleString('en-GB')} designs`);
  }
  // a speed floor (a fleet sails at its slowest ship) keeps the search exact, and reports no design when none is fast enough
  for (const [id, year, knots] of [['dd_torpedo', 1936, 39], ['ss_raider', 1944, 24], ['cv', 1940, 36.5], ['dd_screen', 1936, 40]]) {
    const role = SHIP_ROLES.find((r) => r.id === id);
    const b = brute(role, year, knots);
    const s = bestShip(naval, role, year, { minStats: { naval_speed: knots } });
    ok(b.best === -Infinity ? s === null : s && !s.truncated && Math.abs(s.score - b.best) < 1e-9 && s.stats.naval_speed >= knots - 1e-9,
      `ship designer with a ${knots}-knot floor: ${b.best === -Infinity ? `no ${role.name.toLowerCase()} (${year}) is that fast` : `the exact best ${role.name.toLowerCase()} (${year}) at ${s?.stats.naval_speed.toFixed(1)} knots`}`);
  }
  const t0 = Date.now(); let trunc = 0;
  for (const role of SHIP_ROLES) if (bestShip(naval, role, 1944)?.truncated) trunc++;
  ok(!trunc, `every 1944 ship role is proven best (${Date.now() - t0} ms for ${SHIP_ROLES.length} roles)`);
}

// ---- ship designer on your own priorities ----
{
  const role = SHIP_ROLES.find((r) => r.id === 'dd_screen');
  const own = bestShip(naval, role, 1940, { weights: { torpedo_attack: 8, naval_speed: 2 } });
  ok(own && !own.truncated && own.stats.torpedo_attack > bestShip(naval, role, 1940).stats.torpedo_attack, 'custom ship priorities change the design (a screen hull asked for torpedoes carries more of them)');
}

// ---- aircraft designer: exact on a synthetic airframe (brute force), and on the real data when it is extracted ----
{
  const fixture = JSON.parse(fs.readFileSync(path.join(here, '../tests/plane-fixture.json'), 'utf8'));
  const scoreOf = (st, w) => Object.entries(w).reduce((x, [k, v]) => x + v * Math.log(Math.max(0, st[k] || 0) + (PLANE_FLOOR[k] ?? 1)), 0);
  const brute = (data, role, year) => {
    let best = -Infinity; let n = 0;
    for (const f of framesFor(data, role, year)) {
      const names = Object.keys(f.slots).filter((x) => f.slots[x]);
      const opts = names.map((nm) => {
        const sl = f.slots[nm];
        const ids = Object.values(data.modules).filter((m) => sl.cats.includes(m.cat) && m.year <= year).map((m) => m.id);
        if (!sl.required || !ids.length) ids.push(null);
        return ids;
      });
      const ch = new Array(names.length);
      const walk = (i) => {
        if (i === names.length) {
          for (const l of f.limits || []) {
            const c = ch.filter((id) => id && (id === l.module || data.modules[id].cat === l.category)).length;
            if (l.op === '<' ? c >= l.count : l.op === '<=' ? c > l.count : false) return;
          }
          const main = names.findIndex((x) => /main_weapon/.test(x));
          if (role.main && !(ch[main] && role.main.test(data.modules[ch[main]].cat))) return;
          const st = planeStats(data, f, Object.fromEntries(names.map((nm, k) => [nm, ch[k]])), year, role);
          if (!st.legal) return;
          n++;
          best = Math.max(best, scoreOf(st, role.weights));
          return;
        }
        for (const id of opts[i]) { ch[i] = id; walk(i + 1); }
      };
      walk(0);
    }
    return { best, n };
  };
  for (const [id, year] of [['fighter', 1936], ['fighter', 1940], ['interceptor', 1940], ['cas', 1940], ['naval_bomber', 1940]]) {
    const role = PLANE_ROLES.find((r) => r.id === id);
    const b = brute(fixture, role, year);
    const s = bestPlane(fixture, role, year);
    ok(s && !s.truncated && s.stats.legal && Math.abs(s.score - b.best) < 1e-9, `aircraft designer finds the exact best ${role.name.toLowerCase()} (${year}, test airframe) among ${b.n.toLocaleString('en-GB')} legal designs`);
  }
  const heavy = bestPlane(fixture, PLANE_ROLES.find((r) => r.id === 'fighter'), 1940);
  ok(heavy.stats.thrust >= heavy.stats.weight, 'the best fighter\'s engines carry its weight');
  if (hasPlaneData(naval)) {
    // the game's own airframes and modules (mission-dependent stats, excess thrust as agility), against brute force
    for (const id of ['fighter', 'interceptor', 'cas', 'naval_bomber', 'cv_naval', 'cv_cas']) {
      const role = PLANE_ROLES.find((r) => r.id === id);
      const b = brute(naval, role, 1936);
      const s = bestPlane(naval, role, 1936);
      ok(s && !s.truncated && s.stats.legal && Math.abs(s.score - b.best) < 1e-9, `aircraft designer finds the exact best ${role.name.toLowerCase()} (1936, game airframes) among ${b.n.toLocaleString('en-GB')} legal designs`);
    }
    const torp = bestPlane(naval, PLANE_ROLES.find((r) => r.id === 'naval_bomber'), 1940);
    ok(torp && /torpedo/.test(torp.modules.fixed_main_weapon_slot) && torp.stats.naval_strike_attack > 10, 'a naval bomber carries torpedoes and gets their naval attack on naval strikes');
    const fighterWithBombs = planeStats(naval, framesFor(naval, PLANE_ROLES[0], 1940).at(-1), { fixed_main_weapon_slot: 'light_mg_2x', engine_type_slot: 'engine_2_1x', fixed_auxiliary_weapon_slot_1: 'small_bomb_bay' }, 1940, PLANE_ROLES[0]);
    ok(!fighterWithBombs.air_ground_attack, 'a bomb bay adds no ground attack on air superiority missions');
    const t0 = Date.now(); let trunc = 0; let found = 0;
    for (const role of PLANE_ROLES) { const r = bestPlane(naval, role, 1944); if (r) found++; if (r?.truncated) trunc++; }
    ok(found && !trunc, `every 1944 aircraft role with an airframe is proven best (${found} roles, ${Date.now() - t0} ms)`);
  } else {
    console.log('note designers.json has no aircraft designer data yet; the aircraft tab shows the role guide');
  }
}

// ---- ranked alternatives for the Equipment view ----
{
  const role = SHIP_ROLES.find((r) => r.id === 'cl_light_attack');
  const one = bestShip(naval, role, 1942);
  const many = bestShip(naval, role, 1942, { keep: 30 });
  const sorted = many.ranked.every((d, i) => i === 0 || d.score <= many.ranked[i - 1].score + 1e-12);
  const keys = new Set(many.ranked.map((d) => JSON.stringify([d.hull, d.modules])));
  ok(Math.abs(many.score - one.score) < 1e-9 && many.ranked.length === 30 && sorted && keys.size === 30, 'ship search keeps 30 distinct ranked designs, the first being the proven best');
  const tanks = roleTanks(game, techsUpTo(game, 1942), 'mbt');
  const tankMeta = metaTanks(game, techsUpTo(game, 1942)).find((r) => r.id === 'mbt');
  ok(tanks.ranked.length > 1 && Math.abs(tanks.ranked[0].score - tankMeta.options[0].score) < 1e-9, `tank role ranking starts with the same best design (${tanks.ranked.length} designs)`);
}

// ---- theatre frontage ----
{
  const east = THEATRES.find((t) => t.id === 'eastern');
  const fits = fitTable(east, 6, 50).map((x) => x.fit);
  ok(fits.every((f) => f > 0 && f <= 1), 'frontage fit is a share between 0 and 1');
  ok(Math.abs(frontageFit(45, { mix: { plains: 1 } }) - 1) < 1e-9, 'a width that divides every plains frontage (90, 135, 180) fills them completely');
  ok(fittingWidths(east, 10, 40, 0.9).length > 0, 'the Eastern Front has well-fitting widths between 10 and 40');
  ok(Math.abs(battleFill(90, 30) - 1) < 1e-9 && Math.abs(battleFill(90, 40) - 80 / 90) < 1e-9, 'whole divisions fill a 90-wide plains battle: 30 exactly, 40 leaves 10 empty');
  ok(Math.abs(battleFill(80, 21) - (84 / 80) * (1 - 2 * 0.05)) < 1e-9, 'over-width costs 2% per 1% over (4 x 21 on 80 is 5% over, 10% weaker)');
  ok(battleFill(75, 45) < 0.61, 'no division joins once the over-width penalty would pass 33%');
}

// ---- terrain modifiers: battalions scale their own attack and defense, support companies boost the division ----
{
  const raw = JSON.parse(fs.readFileSync(path.join(here, '../src/data/game.json'), 'utf8'));
  raw.units.infantry.terrain = { forest: { attack: -0.2, defence: 0.1 } };
  raw.units.engineer.terrain = { forest: { attack: 0.1 } };
  const tg = buildGame(raw);
  const forest = { forest: 1 };
  const half = { forest: 1, plains: 1 };
  const flat = resolve(tg, { techs: T }).byId.get('infantry');
  const inForest = resolve(tg, { techs: T, terrain: forest }).byId.get('infantry');
  const mixed = resolve(tg, { techs: T, terrain: half }).byId.get('infantry');
  ok(Math.abs(inForest.sa / flat.sa - 0.8) < 1e-9 && Math.abs(inForest.def / flat.def - 1.1) < 1e-9, 'a forest-only theatre applies infantry\'s -20% attack and +10% defense');
  ok(Math.abs(mixed.sa / flat.sa - 0.9) < 1e-9, 'a half-forest theatre applies half of it');
  const tr = resolve(tg, { techs: T, terrain: forest });
  const tpl = { items: Array(6).fill('infantry'), support: [], reg: [] };
  const plain = evaluate(tpl, tr.byId, {}, undefined, tr.columnSize);
  const withEng = evaluate({ ...tpl, support: ['engineer'] }, tr.byId, {}, undefined, tr.columnSize);
  const engAlone = resolve(tg, { techs: T, terrain: forest }).byId.get('engineer');
  ok(Math.abs(withEng.sa - (plain.sa * 1.1 + engAlone.sa)) < 1e-6, 'engineers\' forest attack bonus lifts every battalion by 10%');
  const mtnUnit = game.units.get('mountaineers');
  ok((mtnUnit.terrain?.mountain?.attack || 0) > 0, 'the extracted data gives mountaineers an attack bonus in mountains');
  const tankAny = resolve(game, { techs: T, terrain: THEATRES.find((x) => x.id === 'any').mix }).byId.get('medium_armor');
  const tankJungle = resolve(game, { techs: T, terrain: THEATRES.find((x) => x.id === 'pacific').mix }).byId.get('medium_armor');
  ok(tankJungle.sa < tankAny.sa, 'medium tanks attack worse in the Pacific than on an average front');
  const none = resolve(game, { techs: T, terrain: forest }).byId.get('infantry');
  const noneFlat = resolve(game, { techs: T }).byId.get('infantry');
  ok(none.sa === noneFlat.sa, 'units without terrain modifiers (regular infantry) are unchanged by the theatre');
}

// ---- meta widths: raising the width limit does not make the division wider ----
{
  const line = ROLES.find((x) => x.id === 'line');
  const base = search(game, { techs: [...T], exclude: roleExclude(game, line), weights: line.weights, constraints: { ...line.constraints }, topN: 1, coDesign: false });
  const wide = search(game, { techs: [...T], exclude: roleExclude(game, line), weights: line.weights, constraints: { ...line.constraints, wmax: 40 }, topN: 1, coDesign: false });
  ok(base.top[0].stats.width === 20, `line infantry lands on its meta width 20 (got ${base.top[0].stats.width})`);
  ok(wide.top[0].stats.width === base.top[0].stats.width, `raising the width limit to 40 keeps it at ${base.top[0].stats.width} (got ${wide.top[0].stats.width})`);
  const mtn = ROLES.find((x) => x.id === 'mountaineers');
  const m = search(game, { techs: [...T], exclude: roleExclude(game, mtn), weights: mtn.weights, constraints: { ...mtn.constraints }, topN: 1, coDesign: false });
  ok(m.top[0].items.includes('mountaineers') && !m.top[0].items.includes('infantry'), 'the mountaineer role is led by mountaineers, not regular infantry');
  ok(Math.abs(m.top[0].stats.width - 25) < 1, `mountaineers land on about 25 width, a third of a mountain battle (got ${m.top[0].stats.width})`);
  // Special Forces' mountaineer subdoctrine cuts each mountaineer battalion's width: more battalions, same frontage
  const sfSub = game.subs.get('mountaineers_1');
  const sfGrand = [...game.grands.values()].find((x) => x.tracks.includes(sfSub.tracks[0]));
  const sfDoctrine = { grands: [sfGrand.id], slots: { [sfSub.tracks[0]]: [sfSub.id] }, progress: {} };
  const md = search(game, { techs: [...T], doctrine: sfDoctrine, exclude: roleExclude(game, mtn), weights: mtn.weights, constraints: { ...mtn.constraints }, topN: 1, coDesign: false });
  const nMtn = (t) => t.items.filter((x) => x === 'mountaineers').length;
  ok(Math.abs(md.top[0].stats.width - 25) < 1 && nMtn(md.top[0]) > nMtn(m.top[0]), `with narrower mountaineers the division keeps about 25 width and adds battalions (${nMtn(m.top[0])} -> ${nMtn(md.top[0])} at ${md.top[0].stats.width.toFixed(1)})`);
}

// ---- hover contribution: what one unit adds to the division ----
{
  const r = resolve(game, { techs: T });
  const by = r.byId;
  const art = r.combat.find((u) => u.cat === 'artillery');
  const sp = r.support.find((u) => u.battalionMult?.length);
  const tpl = { items: ['infantry', 'infantry', 'infantry', 'infantry', art.id], support: sp ? [sp.id] : [], reg: [] };
  const full = evaluate(tpl, by);
  const d = unitContribution(tpl, 'items', 4, by);
  const lessArt = evaluate({ ...tpl, items: tpl.items.slice(0, 4) }, by);
  ok(Math.abs(d.sa - (full.sa - lessArt.sa)) < 1e-9 && d.sa > 0, `artillery adds ${d.sa.toFixed(1)} soft attack`);
  ok(d.width === art.width, `artillery adds its own width (${d.width})`);
  if (sp) {
    const ds = unitContribution(tpl, 'support', 0, by);
    ok(ds.width === 0 && ds.ic > 0, `${sp.id} adds no width but costs ${ds.ic.toFixed(0)} production`);
  }
  const solo = unitContribution({ items: ['infantry'] }, 'items', 0, by);
  ok(Math.abs(solo.sa - evaluate({ items: ['infantry'] }, by).sa) < 1e-9, 'the only battalion contributes the whole division');
}

// ---- manual designer grid: slots edited like the game's designer ----
{
  const r = resolve(game, { techs: T });
  const by = r.byId;
  const size = r.columnSize;
  const inf = by.get('infantry');
  const art = r.combat.find((u) => u.cat === 'artillery');
  const fsc = by.get('fire_support');
  let g = emptyGrid(size);
  g = fillColumn(g, 0, inf);
  ok(g.columns[0].type === 'infantry' && g.columns[0].items.every((id) => id === 'infantry'), 'fill puts one battalion type in every slot of a column');
  ok(battalionChoices(g, 0, 1, r.combat).every((u) => u.cat === 'infantry'), 'a column with battalions only offers its own family');
  ok(battalionChoices(g, 1, 0, r.combat).length === r.combat.length, 'an empty column takes any battalion');
  g = placeBattalion(g, 1, 0, art);
  ok(g.columns[1].type === 'artillery', 'the first battalion sets the column family');
  ok(regimentalChoices(g, 1, r.regimental).length === 0, 'one battalion leaves the regimental slot locked');
  ok(regimentalChoices(g, 0, r.regimental).some((u) => u.id === 'fire_support'), 'a full infantry column offers regimental companies');
  g = setRegimental(g, 0, 'fire_support');
  ok(!regimentalChoices(g, 1, r.regimental).some((u) => u.id === 'fire_support'), 'a regimental company is used once');
  const tpl = templateFromGrid(g);
  const st = evaluate(tpl, by, {}, undefined, size);
  ok(st?.valid && st.layout.explicit && st.layout.sizes.infantry[0] === size && st.layout.sizes.artillery[0] === 1, 'the grid is evaluated with the columns as placed');
  const noReg = evaluate(templateFromGrid(setRegimental(g, 0, null)), by, {}, undefined, size);
  ok(Math.abs((st.ic - noReg.ic) - size * fsc.ic) < 1e-6, `a regimental company scales with the ${size} battalions in its own column`);
  let g2 = removeBattalion(removeBattalion(removeBattalion(g, 0, 0), 0, 1), 0, 2);
  ok(g2.columns[0].reg === null, 'dropping a column below three battalions clears its regimental company');
  g2 = placeBattalion(g, 1, 0, inf);
  ok(g2.columns[1].type === 'infantry', 'swapping a column\'s only battalion changes its family');
  const sp = r.support[0];
  g = setSupport(g, 3, sp.id);
  ok(g.support.length === 1 && g.support[0] === sp.id, 'support packs from the top');
  ok(!supportChoices(g, 1, r.support, by).some((u) => u.id === sp.id), 'a support company cannot be taken twice');
  ok(supportChoices(g, 0, r.support, by).some((u) => u.id === sp.id), 'a support slot can keep its own company');
  const back = gridFromTemplate(templateFromGrid(g), by, size);
  ok(JSON.stringify(back) === JSON.stringify(g), 'a grid round-trips through its template');
  const planned = gridFromTemplate({ items: Array(10).fill('infantry'), support: [], reg: ['fire_support'] }, by, size);
  ok(planned.columns.map((c) => c.items.filter(Boolean).length).join('-') === '3-3-3-1-0' && planned.columns[0].reg === 'fire_support', 'a flat template opens in the planned 3-3-3-1 layout');
  const bad = templateFromGrid(placeBattalion(emptyGrid(size), 0, 0, inf));
  bad.columns[0].items[1] = art.id;
  ok(!evaluate(bad, by, {}, undefined, size).valid, 'mixed families in one column are not valid');
  const d = slotContribution(g, { kind: 'line', ci: 1, si: 0 }, by, {}, undefined, size);
  ok(d && d.sa > 0 && d.width === art.width, 'a slot shows what its battalion adds');
}

// ---- fleets: screening rules per task force, and the dockyard plan is the fastest any split of dockyards reaches ----
{
  const bad = [];
  for (const fleet of FLEETS) {
    for (const buffer of [0, 0.5, 1, 3]) {
      let prev = null;
      for (let n = fleet.scale.min; n <= fleet.scale.max; n++) {
        const comp = composeFleet(fleet, { scale: n, buffer });
        const slots = fleetSlots(fleet);
        if (fleet.members) {
          if (comp.taskForces.length !== n || slots.some((m) => comp.counts[m.id] !== m.count * n)) bad.push(`${fleet.id} x${n}`);
        } else {
          for (const tf of comp.taskForces) {
            const of = (cls) => slots.filter((x) => x.cls === cls).reduce((a, x) => a + (tf.counts[x.id] || 0), 0);
            const big = tf.carriers + tf.capitals;
            if (of('carrier') !== tf.carriers || of('capital') !== tf.capitals || of('screen') !== tf.screens) bad.push(`${fleet.id} x${n} counts`);
            if (tf.screens < (SCREENS_PER_SHIP + buffer) * big - 1e-9 || tf.carriers > MAX_CARRIERS || (fleet.carriers && tf.capitals < tf.carriers)) bad.push(`${fleet.id} x${n} +${buffer}`);
          }
          const led = comp.taskForces.reduce((a, tf) => a + (fleet.carriers ? tf.carriers : tf.capitals), 0);
          if (led !== n) bad.push(`${fleet.id} x${n} scale`);
        }
        if (prev && slots.some((x) => comp.counts[x.id] < prev.counts[x.id])) bad.push(`${fleet.id} x${n} shrinks`);
        prev = comp;
      }
    }
  }
  ok(!bad.length, `every fleet at every size: 3+ screens per capital ship and carrier in each task force, at most ${MAX_CARRIERS} carriers and a capital ship per carrier, and scaling up never drops a ship${bad.length ? ` (${bad.slice(0, 4).join(', ')})` : ''}`);

  // brute force: every multiset of line sizes for each ship type and every share of its ships between those lines
  const split = (e, lines, output) => {
    let best = Infinity;
    const rec = (j, left, worst) => {
      if (j === lines.length - 1) { best = Math.min(best, Math.max(worst, (left * e.cost) / (lines[j] * output))); return; }
      for (let k = 0; k <= left; k++) rec(j + 1, left - k, Math.max(worst, (k * e.cost) / (lines[j] * output)));
    };
    rec(0, e.count, 0);
    return best;
  };
  const finishWith = (e, t, output) => {
    let best = Infinity;
    const rec = (left, size, lines) => {
      if (lines.length) best = Math.min(best, split(e, lines, output));
      for (let d = Math.min(size, left); d >= 1; d--) { lines.push(d); rec(left - d, d, lines); lines.pop(); }
    };
    rec(t, e.cap, []);
    return best;
  };
  const bruteDays = (items, D, output) => {
    const f = items.map((e) => Array.from({ length: D + 1 }, (_, t) => (t ? finishWith(e, t, output) : Infinity)));
    let best = Infinity;
    const rec = (i, left, worst) => {
      if (worst >= best) return;
      if (i === items.length) { best = worst; return; }
      for (let t = 1; t <= left - (items.length - i - 1); t++) rec(i + 1, left - t, Math.max(worst, f[i][t]));
    };
    rec(0, D, 0);
    return best;
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let cases = 0; const wrong = [];
  for (let c = 0; c < 60; c++) {
    const m = 1 + Math.floor(rnd() * 3);
    const items = Array.from({ length: m }, (_, i) => ({ id: `s${i}`, count: 1 + Math.floor(rnd() * 4), cost: 100 + Math.round(rnd() * 900), cap: 2 + Math.floor(rnd() * 3), cls: i ? 'screen' : 'capital' }));
    const D = m + Math.floor(rnd() * (9 - m));
    const plan = planDockyards(items, D, 2.5);
    const want = bruteDays(items, D, 2.5);
    const valid = plan.used <= D && plan.lines.every((l) => l.dockyards >= 1 && l.dockyards <= items.find((e) => e.id === l.id).cap)
      && items.every((e) => plan.lines.filter((l) => l.id === e.id).reduce((a, l) => a + l.ships, 0) === e.count)
      && Math.abs(plan.days - Math.max(...plan.lines.map((l) => l.ships * items.find((e) => e.id === l.id).cost / (l.dockyards * 2.5)))) < 1e-9;
    cases++;
    if (!valid || Math.abs(plan.days - want) > 1e-9) wrong.push(`${JSON.stringify(items.map((e) => [e.count, e.cost, e.cap]))} on ${D}: ${plan.days} vs ${want}`);
  }
  ok(!wrong.length, `dockyard plan finishes as early as the best split of dockyards into lines (brute force, ${cases} orders)${wrong.length ? `: ${wrong[0]}` : ''}`);
  ok(planDockyards([{ id: 'a', count: 2, cost: 100, cap: 5 }, { id: 'b', count: 1, cost: 100, cap: 5 }], 1).short === 2, 'fewer dockyards than ship types: each type needs a line');

  // balance while building: screens afloat per big ship at each launch, and when the fleet is fully screened for good
  const cls = { bb: 'capital', dd: 'screen' };
  const b1 = buildBalance({ lines: [{ id: 'bb', ships: 2, every: 10 }, { id: 'dd', ships: 7, every: 3 }] }, cls);
  const b2 = buildBalance({ lines: [{ id: 'bb', ships: 2, every: 10 }, { id: 'dd', ships: 7, every: 4 }] }, cls);
  ok(b1.ratio === 3 && b1.day === 10 && b1.from === 0 && b2.ratio === 2 && b2.day === 10 && b2.screens === 2 && b2.from === 24,
    'build balance: three screens per battleship at every launch, or the low point and the day the screens catch up');

  // a whole fleet with stand-in designs: valid lines, spare dockyards lift the low point, and the largest fleet that fits
  const fleet = FLEETS.find((f) => f.id === 'carrier');
  const stand = { cv: ['carrier', 10000], bc: ['battlecruiser', 12000], ca: ['heavy_cruiser', 8000], cl_aa: ['light_cruiser', 4000], cl: ['light_cruiser', 5000], dd: ['destroyer', 1000] };
  const designs = Object.fromEntries(Object.entries(stand).map(([id, [type, cost]]) => [id, { stats: { type, build_cost_ic: cost, naval_speed: 30 } }]));
  const comp = composeFleet(fleet, { scale: 4 });
  const plan = planDockyards(lineItems(fleet, comp, designs), 60);
  ok(plan.balance && plan.balance.ratio >= SCREENS_PER_SHIP && plan.lines.every((l) => l.dockyards <= (['cv', 'bc', 'ca'].includes(l.id) ? 5 : 10)),
    `carrier fleet on 60 dockyards: done in ${Math.round(plan.days)} days, capital lines at most 5 dockyards, screened at every launch (${plan.balance?.ratio.toFixed(1)} : 1 at worst)`);
  const days = 4 * 365;
  const n = fitScale(fleet, designs, { buffer: fleet.buffer, dockyards: 60, days });
  const at = (k) => planDockyards(lineItems(fleet, composeFleet(fleet, { scale: k }), designs), 60).days;
  ok(n > fleet.scale.min && at(n) <= days && (n === fleet.scale.max || at(n + 1) > days), `fit fleet: ${n} carriers is the largest strike force 60 dockyards finish in 4 years`);
}

// ---- golden numbers from in-game screenshots ----
fails += runGolden((m) => console.log(m));

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
