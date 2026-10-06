#!/usr/bin/env node
/**
 * Ship (and aircraft) designer data for the Equipment section.
 *
 *   node scripts/extract-designers.mjs "<HOI4 install folder>" [--version 1.x.y] [--kinds plane|ship] [--source text]
 *
 * Reads every equipment archetype that has module slots outside the tank designer (ship hulls, and the aircraft
 * airframes of the By Blood Alone designer when the install has them), the modules they can take and the year the
 * technology that unlocks each one starts, and writes src/data/designers.json.
 *
 * The ships in the repository's file come from the public copy of the game files at
 * github.com/Killeritch/Hearts-of-Iron-IV (patch 1.7, Man the Guns rules); the aircraft designer (airframes, plane
 * modules with their mission-dependent stats, and THRUST_WEIGHT_AGILITY_FACTOR from the defines) from the 1.14.1 files
 * at github.com/cbrzeczysz/hoi4-history, added with --kinds plane. The Equipment section reads whatever is there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, first, all, bare, isBlock, scalars } from './paradox.mjs';

const args = process.argv.slice(2);
const opt = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opt[args[i].slice(2)] = args[i + 1]; i++; } else positional.push(args[i]);
}
const root = positional[0];
if (!root || !fs.existsSync(path.join(root, 'common/units/equipment'))) {
  console.error('Usage: node scripts/extract-designers.mjs <game root> [--version 1.x.y] [--source "description"]');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = opt.out || path.join(here, '../src/data/designers.json');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const read = (f) => parse(fs.readFileSync(f, 'utf8'));
const round = (n) => Math.round(n * 10000) / 10000;
const numbers = (b) => {
  const o = {};
  for (const [k, v] of Object.entries(scalars(b))) if (typeof v === 'number') o[k] = round(v);
  return o;
};

// ---------------------------------------------------------------- localisation (optional)
const loc = {};
for (const f of walk(path.join(root, 'localisation')).filter((f) => /english\.yml$/.test(f))) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_.]+):\d*\s*"(.*)"\s*$/.exec(line);
    if (m && !(m[1] in loc)) loc[m[1]] = m[2].replace(/§./g, '').replace(/\$[^$]*\$/g, '').trim();
  }
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const prettify = (id) => {
  const m = /^(.*?)_(\d)$/.exec(id);
  const base = (m ? m[1] : id).replace(/^ship_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return m ? `${base} ${ROMAN[Number(m[2])] || m[2]}` : base;
};
const nameOf = (id) => loc[id] || prettify(id);

// ---------------------------------------------------------------- technologies: start year of what they unlock
const unlockYear = {};
for (const f of walk(path.join(root, 'common/technologies')).filter((f) => f.endsWith('.txt'))) {
  let blk;
  try { blk = read(f); } catch { continue; }
  const techs = first(blk, 'technologies');
  if (!isBlock(techs)) continue;
  for (const t of techs) {
    if (!isBlock(t.v)) continue;
    const year = first(t.v, 'start_year');
    if (typeof year !== 'number') continue;
    for (const id of [...bare(first(t.v, 'enable_equipments')), ...bare(first(t.v, 'enable_equipment_modules'))]) {
      if (!(id in unlockYear) || year < unlockYear[id]) unlockYear[id] = year;
    }
  }
}

// tech bonuses to whole ship and plane types (destroyer, light_cruiser, fighter, cas, ...) by year
const typeMods = [];
const SHIP_TYPES = new Set(['destroyer', 'light_cruiser', 'heavy_cruiser', 'battle_cruiser', 'battleship', 'super_heavy_battleship', 'carrier', 'submarine']);
// plane types, and bonuses given to an airframe archetype itself (small_plane_airframe = { ... })
const PLANE_TYPES = new Set(['fighter', 'heavy_fighter', 'interceptor', 'cas', 'naval_bomber', 'tactical_bomber', 'strategic_bomber', 'scout_plane', 'maritime_patrol', 'transport_plane', 'suicide']);
const typeKey = (k) => SHIP_TYPES.has(k) || PLANE_TYPES.has(k) || /airframe$/.test(k);
for (const f of walk(path.join(root, 'common/technologies')).filter((f) => f.endsWith('.txt'))) {
  let blk;
  try { blk = read(f); } catch { continue; }
  const techs = first(blk, 'technologies');
  if (!isBlock(techs)) continue;
  for (const t of techs) {
    if (!isBlock(t.v)) continue;
    const year = first(t.v, 'start_year');
    if (typeof year !== 'number') continue;
    for (const e of t.v) if (typeKey(e.k) && isBlock(e.v)) {
      const stats = numbers(e.v);
      if (Object.keys(stats).length) typeMods.push({ tech: t.k, year, type: e.k, stats });
    }
  }
}

// ---------------------------------------------------------------- equipment with module slots
const eqDir = path.join(root, 'common/units/equipment');
const entries = [];
for (const f of walk(eqDir).filter((f) => f.endsWith('.txt') && !f.includes(`${path.sep}modules${path.sep}`))) {
  let blk;
  try { blk = read(f); } catch { continue; }
  const eqs = first(blk, 'equipments');
  if (!isBlock(eqs)) continue;
  for (const e of eqs) if (isBlock(e.v)) entries.push({ id: e.k, b: e.v, file: path.basename(f) });
}
const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
const kindOf = (b) => {
  const type = first(b, 'type');
  const types = Array.isArray(type) ? bare(type) : [type];
  if (types.some((t) => /ship|submarine|capital|screen|carrier/.test(String(t)))) return 'ship';
  if (types.some((t) => /fighter|bomber|cas|plane|air|transport|scout|patrol/.test(String(t)))) return 'plane';
  return null;
};

const slotsOf = (b, inherited) => {
  const ms = first(b, 'module_slots');
  if (ms === 'inherit') return { ...(inherited || {}) };
  if (!isBlock(ms)) return inherited ? { ...inherited } : null;
  const out = {};
  for (const s of ms) {
    if (s.v === 'inherit') { if (inherited && inherited[s.k]) out[s.k] = inherited[s.k]; continue; }
    if (typeof s.v === 'string') { out[s.k] = out[s.v] || (inherited && inherited[s.v]); continue; }
    if (isBlock(s.v)) out[s.k] = { required: first(s.v, 'required') === true, cats: bare(first(s.v, 'allowed_module_categories')) };
  }
  return out;
};
const limitsOf = (b) => all(b, 'module_count_limit').map((l) => {
  const c = l.find((x) => x.k === 'count');
  return { module: first(l, 'module') || null, category: first(l, 'category') || null, op: c ? c.op : '<', count: c ? c.v : 1 };
});
const STAT_SKIP = new Set(['year', 'priority', 'module_slots', 'is_archetype', 'is_buildable', 'manpower', 'air_map_icon_frame', 'interface_overview_category_index', 'lend_lease_cost']);

const designers = {};
for (const e of entries) {
  if (first(e.b, 'is_archetype') !== true || !first(e.b, 'module_slots')) continue;
  const kind = kindOf(e.b);
  if (!kind) continue;
  const base = numbers(e.b);
  for (const k of STAT_SKIP) delete base[k];
  designers[e.id] = {
    id: e.id, kind, name: nameOf(e.id), type: first(e.b, 'type'), alias: first(e.b, 'alias') || null,
    allowedTypes: bare(first(e.b, 'allowed_types')), typeOverride: first(e.b, 'type_override') || null,
    slots: slotsOf(e.b, null), limits: limitsOf(e.b), base, defaults: Object.fromEntries((first(e.b, 'default_modules') || []).filter((x) => typeof x.v === 'string').map((x) => [x.k, x.v])),
    variants: [],
  };
}
const kind = (d) => d.kind;
// variants in order of year so a parent is resolved before its children
for (const e of entries.filter((x) => first(x.b, 'archetype') && designers[first(x.b, 'archetype')]).sort((a, b) => (first(a.b, 'year') || 0) - (first(b.b, 'year') || 0))) {
  const d = designers[first(e.b, 'archetype')];
  const parentId = first(e.b, 'parent');
  const parent = parentId && d.variants.find((v) => v.id === parentId);
  const slots = slotsOf(e.b, parent ? parent.slots : d.slots) || d.slots;
  const stats = { ...(parent ? parent.stats : d.base), ...numbers(e.b) };
  for (const k of STAT_SKIP) delete stats[k];
  const year = unlockYear[e.id] ?? first(e.b, 'year') ?? 1936;
  // pre-designer fixed ships (destroyer_1, light_cruiser_2, ...) share the archetype but are not designs
  if (kind(d) === 'ship' && !/^ship_hull_/.test(e.id)) continue;
  // the same for planes: only airframes are designer frames (old fixed fighters and bombers are converted designs)
  if (kind(d) === 'plane' && !/airframe/.test(e.id)) continue;
  d.variants.push({
    id: e.id, name: nameOf(e.id), year, stats, slots, researched: e.id in unlockYear || year <= 1922,
    limits: [...d.limits, ...limitsOf(e.b)],
    defaults: { ...(parent ? parent.defaults : d.defaults), ...Object.fromEntries((first(e.b, 'default_modules') || []).filter((x) => typeof x.v === 'string').map((x) => [x.k, x.v])) },
  });
}
for (const id of Object.keys(designers)) if (!designers[id].variants.length) delete designers[id];

// ---------------------------------------------------------------- modules
const modules = {};
const SUFFIX_YEAR = { 0: 1922, 1: 1936, 2: 1939, 3: 1942, 4: 1944 };
for (const f of walk(path.join(eqDir, 'modules')).filter((f) => f.endsWith('.txt'))) {
  let blk;
  try { blk = read(f); } catch { continue; }
  for (const top of blk) {
    if (top.k !== 'equipment_modules' || !isBlock(top.v)) continue;
    for (const m of top.v) {
      if (!isBlock(m.v)) continue;
      const cat = first(m.v, 'category');
      if (!cat || /^tank_|^lc_/.test(cat)) continue;
      const suffix = /_(\d)$/.exec(m.k);
      modules[m.k] = {
        id: m.k, name: nameOf(m.k), cat,
        add: numbers(first(m.v, 'add_stats')), mul: numbers(first(m.v, 'multiply_stats')), avg: numbers(first(m.v, 'add_average_stats')),
        // plane modules (1.14+): stats that apply only on some missions, e.g. a torpedo's naval attack on naval strikes
        ...(all(m.v, 'mission_type_stats').length ? {
          missions: all(m.v, 'mission_type_stats').map((b) => ({
            on: bare(first(b, 'limit')), add: numbers(first(b, 'add_stats')), mul: numbers(first(b, 'multiply_stats')), avg: numbers(first(b, 'add_average_stats')),
          })),
        } : {}),
        ...(first(m.v, 'allow_mission_type') ? { allowMissions: bare(first(m.v, 'allow_mission_type')) } : {}),
        ...(first(m.v, 'add_equipment_type') ? { types: [first(m.v, 'add_equipment_type')].flatMap((t) => (isBlock(t) ? bare(t) : [t])) } : {}),
        year: unlockYear[m.k] ?? (suffix ? SUFFIX_YEAR[suffix[1]] ?? 1936 : 1936),
        researched: m.k in unlockYear,
      };
    }
  }
}
// keep only modules some designer slot can take
const usedCats = new Set(Object.values(designers).flatMap((d) => d.variants.flatMap((v) => Object.values(v.slots || {}).flatMap((s) => (s ? s.cats : [])))));
for (const id of Object.keys(modules)) if (!usedCats.has(modules[id].cat)) delete modules[id];

// ---------------------------------------------------------------- plane designer rules from the defines
const planeRules = {};
for (const f of walk(path.join(root, 'common/defines')).filter((f) => f.endsWith('.lua'))) {
  const m = /THRUST_WEIGHT_AGILITY_FACTOR\s*=\s*([\d.]+)/.exec(fs.readFileSync(f, 'utf8'));
  if (m) planeRules.thrustAgility = Number(m[1]);
}

// --kinds plane (or ship): replace only those designers and their modules in the existing file, keep the rest
const kinds = opt.kinds ? new Set(opt.kinds.split(',')) : null;
const source = opt.source || root;
let out = { meta: {}, designers, modules, typeMods };
if (kinds && fs.existsSync(outFile)) {
  const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const keep = Object.fromEntries(Object.entries(prev.designers).filter(([, d]) => !kinds.has(d.kind)));
  const catsOf = (ds) => new Set(Object.values(ds).flatMap((d) => d.variants.flatMap((v) => Object.values(v.slots || {}).flatMap((s) => (s ? s.cats : [])))));
  const keptCats = catsOf(keep);
  const fresh = Object.fromEntries(Object.entries(designers).filter(([, d]) => kinds.has(d.kind)));
  const freshCats = catsOf(fresh);
  const isShipType = (t) => SHIP_TYPES.has(t);
  out = {
    meta: { ...prev.meta, sources: { ...(prev.meta.sources || { ship: { version: prev.meta.gameVersion, source: prev.meta.source } }) } },
    designers: { ...keep, ...fresh },
    modules: {
      ...Object.fromEntries(Object.entries(prev.modules).filter(([, m]) => keptCats.has(m.cat))),
      ...Object.fromEntries(Object.entries(modules).filter(([, m]) => freshCats.has(m.cat))),
    },
    typeMods: [...(prev.typeMods || []).filter((m) => (kinds.has('ship') ? !isShipType(m.type) : isShipType(m.type))),
      ...typeMods.filter((m) => (kinds.has('ship') ? isShipType(m.type) : !isShipType(m.type)))],
    planeRules: kinds.has('plane') ? planeRules : prev.planeRules || {},
  };
  for (const k of kinds) out.meta.sources[k] = { version: opt.version || 'unknown', source };
} else {
  out.planeRules = planeRules;
  out.meta.sources = Object.fromEntries([...new Set(Object.values(designers).map((d) => d.kind))].map((k) => [k, { version: opt.version || 'unknown', source }]));
}
out.meta = {
  ...out.meta,
  generatedAt: new Date().toISOString(),
  gameVersion: kinds ? out.meta.gameVersion : opt.version || 'unknown',
  source: kinds ? out.meta.source : source,
  counts: { designers: Object.keys(out.designers).length, modules: Object.keys(out.modules).length, typeMods: out.typeMods.length },
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${outFile}: ${out.meta.counts.designers} designers (${Object.values(out.designers).map((d) => `${d.id}/${d.variants.length}`).join(', ')}), ${out.meta.counts.modules} modules, ${out.typeMods.length} type tech bonuses, plane rules ${JSON.stringify(out.planeRules)}`);
