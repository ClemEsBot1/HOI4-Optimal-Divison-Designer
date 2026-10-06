#!/usr/bin/env node
/**
 * Adds the terrain modifiers of every land sub-unit to src/data/game.json, without re-extracting anything else.
 *
 *   node scripts/extract-terrain.mjs "<game root>/common/units" [--source "1.14.1"]
 *
 * The full extractor (extract.mjs) reads the same blocks; this is for a partial copy of the game files, such as a
 * mirror of common/units from an older version. Units missing from the copy keep whatever they had.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, first, isBlock } from './paradox.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
if (!dir || !fs.existsSync(dir)) { console.error('Usage: node scripts/extract-terrain.mjs <common/units folder> [--source <version>]'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '../src/data/game.json');
const game = JSON.parse(fs.readFileSync(file, 'utf8'));

const TERRAIN_IDS = ['plains', 'desert', 'forest', 'jungle', 'hills', 'marsh', 'mountain', 'urban', 'river', 'amphibious'];
const round = (n) => Math.round(n * 10000) / 10000;
const found = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  const su = first(parse(fs.readFileSync(path.join(dir, f), 'utf8')), 'sub_units');
  if (!isBlock(su)) continue;
  for (const e of su) {
    if (!isBlock(e.v)) continue;
    const terrain = {};
    for (const t of TERRAIN_IDS) {
      const tb = first(e.v, t);
      if (!isBlock(tb)) continue;
      const m = {};
      for (const k of ['attack', 'defence', 'movement']) if (typeof first(tb, k) === 'number' && first(tb, k)) m[k] = round(first(tb, k));
      if (Object.keys(m).length) terrain[t] = m;
    }
    found[e.k] = terrain;
  }
}
let set = 0; const missing = [];
for (const u of Object.values(game.units)) {
  if (!(u.id in found)) { missing.push(u.id); continue; }
  if (Object.keys(found[u.id]).length) { u.terrain = found[u.id]; set++; } else delete u.terrain;
}
if (source) game.meta.terrainSource = source;
fs.writeFileSync(file, JSON.stringify(game));
console.log(`terrain modifiers on ${set} units; ${Object.values(game.units).length - missing.length} matched; not in this copy: ${missing.join(', ') || 'none'}`);
