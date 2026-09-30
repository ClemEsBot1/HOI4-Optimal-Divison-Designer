// Golden tests: the engine must reproduce division stats read off in-game screenshots. node scripts/golden.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame, techsUpTo, researchTech, unresearchTech, resolve } from '../src/lib/game.js';
import { evaluate } from '../src/lib/stats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = buildGame(JSON.parse(fs.readFileSync(path.join(here, '../src/data/game.json'), 'utf8')));
const { cases } = JSON.parse(fs.readFileSync(path.join(here, '../tests/golden.json'), 'utf8'));

export function runGolden(log = console.log) {
  let fails = 0;
  for (const c of cases) {
    if (c.pending) { log(`skip ${c.name}: ${c.pending}`); continue; }
    let techs = techsUpTo(game, c.research.preset, c.research.preset >= 9999);
    for (const id of c.research.remove || []) techs = unresearchTech(game, techs, id);
    for (const id of c.research.add || []) techs = researchTech(game, techs, id);
    const r = resolve(game, { techs, doctrine: c.doctrine || undefined });
    const items = Object.entries(c.template.items).flatMap(([id, n]) => Array(n).fill(id));
    const missing = [...items, ...c.template.support, ...c.template.reg].filter((id) => !r.byId.has(id));
    if (missing.length) { log(`FAIL ${c.name}: not buildable with this research (${[...new Set(missing)].join(', ')})`); fails++; continue; }
    const st = evaluate({ items, support: c.template.support, reg: c.template.reg }, r.byId, {}, undefined, r.columnSize);
    const bad = [];
    for (const [k, want] of Object.entries(c.expect)) if (Math.abs(st[k] - want) > c.tolerance) bad.push(`${k} ${st[k].toFixed(2)} (game ${want})`);
    for (const [k, want] of Object.entries(c.equipment || {})) if (Math.abs((st.equipment[k] || 0) - want) > 0.5) bad.push(`${k} ${st.equipment[k] || 0} (game ${want})`);
    if (bad.length) { log(`FAIL ${c.name}: ${bad.join(', ')}`); fails++; } else log(`ok   ${c.name}`);
  }
  return fails;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fails = runGolden();
  console.log(fails ? `\n${fails} golden case(s) failed` : '\nAll golden cases match the game');
  process.exit(fails ? 1 : 0);
}
