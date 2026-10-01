// Times one role's search with the app's default setup (1945 research, no doctrine, any front):
//   node scripts/bench.mjs [role id, default armor]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, EMPTY_DOCTRINE } from '../src/lib/game.js';
import { DEFAULT_OPTS } from '../src/lib/stats.js';
import { ROLES, roleExclude, defaultTech, ZERO_WEIGHTS } from '../src/lib/presets.js';
import { search, DEFAULT_CONSTRAINTS } from '../src/lib/optimizer.js';
import { THEATRES } from '../src/lib/frontage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = buildGame(JSON.parse(fs.readFileSync(path.join(here, '../src/data/game.json'), 'utf8')));
const role = ROLES.find((r) => r.id === (process.argv[2] || 'armor'));
if (!role) { console.log(`Unknown role. Pick one of: ${ROLES.map((r) => r.id).join(', ')}`); process.exit(1); }
const params = {
  techs: [...defaultTech(game)], doctrine: { ...EMPTY_DOCTRINE, slotCount: 1 }, exclude: roleExclude(game, role),
  weights: { ...ZERO_WEIGHTS, ...role.weights }, constraints: { ...DEFAULT_CONSTRAINTS, ...role.constraints, frontMix: THEATRES[0].mix },
  mods: {}, opts: { ...DEFAULT_OPTS }, enemy: null, topN: 10,
};
const t0 = Date.now();
const shown = [];
const r = search(game, params, () => shown.push(Date.now() - t0));
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(`${role.name}: provisional answers at ${shown.map(s).join(', ') || '-'}, finished at ${s(Date.now() - t0)}`);
console.log(`${r.proven ? 'proven' : `not proven (gap ${r.gap.toFixed(2)})`} after ${r.nodes} nodes, score ${r.top[0].score.toFixed(4)}`);
console.log(r.top[0].key);
