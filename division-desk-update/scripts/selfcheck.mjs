// Sanity checks for the engine against the extracted data: node scripts/selfcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, techsUpTo, researchTech, unresearchTech, canResearch, resolve, collectModifiers } from '../src/lib/game.js';
import { evaluate } from '../src/lib/stats.js';
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
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
