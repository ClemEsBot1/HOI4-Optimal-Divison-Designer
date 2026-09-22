// Sanity checks for the engine against the extracted data: node scripts/selfcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, techsUpTo, researchTech, unresearchTech, canResearch, resolve, collectModifiers } from '../src/lib/game.js';
import { evaluate, planColumns } from '../src/lib/stats.js';
import { defaultExclude, ROLES } from '../src/lib/presets.js';
import { search } from '../src/lib/optimizer.js';
import { encodeState, decodeState } from '../src/lib/format.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = buildGame(JSON.parse(fs.readFileSync(path.join(here, '../src/data/game.json'), 'utf8')));
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

// search result matches a fresh evaluation
const r = search(game, { techs: [...T], weights: { sa: 5, def: 8, org: 6, ic: 4 }, constraints: { wmin: 20, wmax: 20 }, ms: 800, topN: 3 });
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
ok(p6.ok && p6.infantry === 2, 'six battalions spread over two columns take two companies');
ok(!planColumns({ infantry: 6, mobile: 0, armor: 0 }, 5, 0, 3).ok, 'six battalions cannot take three companies');
ok(!planColumns({ infantry: 9, mobile: 0, armor: 0 }, 5, 1, 0).ok, 'an SP company needs an armor column');
ok(planColumns({ infantry: 9, mobile: 0, armor: 3 }, 5, 1, 3).ok, 'nine infantry and three tanks take one SP and three other companies');

// special forces stay out by default
const ex = defaultExclude(game);
ok(['paratrooper', 'marine', 'amphibious_mechanized', 'mountaineers', 'ranger_battalion', 'cavalry'].every((id) => ex.includes(id)), 'special forces and cavalry are excluded by default');
const r2 = search(game, { techs: [...T], exclude: ex, weights: { sa: 5, def: 8, org: 6, hp: 5, ic: 4 }, constraints: { wmin: 20, wmax: 20 }, ms: 800, topN: 5 });
const used = new Set(r2.top.flatMap((t) => [...t.items, ...t.support, ...t.reg]));
ok(![...used].some((id) => ex.includes(id)), 'search results never use excluded units');
ok(r2.top.every((t) => { const c = { infantry: 0, mobile: 0, armor: 0 }; t.items.forEach((id) => c[r2.units.find((u) => u.id === id).cat]++); const p = planColumns(c, r2.columnSize, t.reg.filter((id) => r2.units.find((u) => u.id === id).tank).length, t.reg.filter((id) => !r2.units.find((u) => u.id === id).tank).length); return p.ok; }), 'every result respects the regimental rule');
const armorRole = ROLES.find((x) => x.id === 'armor');
const ra = search(game, { techs: [...T], exclude: ex, weights: armorRole.weights, constraints: armorRole.constraints, ms: 500, topN: 2 });
ok(ra.top?.every((t) => { const n = t.items.length; return t.items.filter((id) => ra.units.find((u) => u.id === id).cat === 'armor').length / n > 0.5; }), 'armoured role keeps more than half its line battalions armoured');
ok(ra.top?.every((t) => t.stats.org >= armorRole.constraints.minOrg && t.stats.ic <= armorRole.constraints.maxIc && t.stats.width >= 30 && t.stats.width <= 36 && (t.stats.cnt.mobile / t.stats.n) >= armorRole.constraints.minMobileShare), 'armoured role uses a usable width, organization, cost and mechanized mix');
ok(ROLES.find((x) => x.id === 'line').constraints.wmax < armorRole.constraints.wmax, 'infantry role is narrower than armoured role');
const spaceRole = ROLES.find((x) => x.id === 'space_marines');
const rs = search(game, { techs: [...T], exclude: ex, weights: spaceRole.weights, constraints: spaceRole.constraints, ms: 500, topN: 2 });
ok(rs.top?.every((t) => { const n = t.items.length; const a = t.items.filter((id) => rs.units.find((u) => u.id === id).cat === 'armor').length; return a >= 1 && a <= 2 && a / n <= 0.5; }), 'space marine role uses a small armoured component');
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
