#!/usr/bin/env node
/**
 * Division Desk data extractor.
 *
 * Reads a Hearts of Iron IV install and writes src/data/game.json.
 *
 *   node scripts/extract.mjs "C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV" --version 1.17.x
 *
 * The argument is the game root (the folder that contains `common/` and `localisation/`).
 * For a partial copy, point --units/--technologies/--doctrines/--loc at the individual folders.
 *
 * Assumptions baked in (see README): every DLC is owned, vanilla only (no mods), English names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, first, all, bare, keys, isBlock, scalars } from './paradox.mjs';

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opt[args[i].slice(2)] = args[i + 1]; i++; } else positional.push(args[i]);
}
const root = positional[0];
const P = {
  units: opt.units || (root && path.join(root, 'common/units')),
  technologies: opt.technologies || (root && path.join(root, 'common/technologies')),
  doctrines: opt.doctrines || (root && path.join(root, 'common/doctrines')),
  loc: opt.loc || (root && path.join(root, 'localisation/english')),
};
for (const [k, v] of Object.entries(P)) {
  if (!v || !fs.existsSync(v)) { console.error(`Missing folder for ${k}: ${v}\nUsage: node scripts/extract.mjs <game root> [--version 1.x.y]`); process.exit(1); }
}
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = opt.out || path.join(here, '../src/data/game.json');

// ---------------------------------------------------------------- helpers
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const read = (f) => parse(fs.readFileSync(f, 'utf8'));
const round = (n) => (typeof n === 'number' ? Math.round(n * 10000) / 10000 : n);

// stat keys used by the app, and how game keys map onto them
const KEYMAP = {
  soft_attack: 'sa', hard_attack: 'ha', defense: 'def', defence: 'def', breakthrough: 'brk', max_organisation: 'org',
  max_strength: 'hp', default_morale: 'rec', manpower: 'mp', supply_consumption: 'sup', combat_width: 'width',
  ap_attack: 'pier', air_attack: 'air', armor_value: 'arm', hardness: 'hard', maximum_speed: 'spd', recon: 'recon',
  build_cost_ic: 'ic', reliability: 'rel',
};
const mapStats = (b) => {
  const o = {};
  for (const [k, v] of Object.entries(scalars(b))) if (KEYMAP[k] && typeof v === 'number') o[KEYMAP[k]] = round(v);
  return o;
};

const prettify = (id) => id.replace(/^(sp_|NSB_|tank_|tech_)/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------- localisation
const loc = {};
for (const f of walk(P.loc).filter((x) => x.endsWith('.yml'))) {
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s+([A-Za-z0-9_.'\-]+):\d*\s+"(.*)"\s*(#.*)?$/.exec(line);
    if (m) loc[m[1]] = m[2].replace(/§./g, '').replace(/\\n/g, ' ').replace(/\$[A-Za-z_]+\$/g, '').trim();
  }
}
const nameOf = (id, ...alts) => {
  for (const k of [id, ...alts]) if (k && loc[k]) return loc[k];
  return prettify(id);
};

// ---------------------------------------------------------------- DLC handling
// Assumption: every DLC is owned. has_dlc => true, NOT has_dlc => false.
function dlcOk(cond) {
  if (!isBlock(cond)) return true;
  for (const e of cond) {
    if (e.k === 'has_dlc') continue;
    if ((e.k === 'NOT' || e.k === 'not') && isBlock(e.v) && e.v.some((x) => x.k === 'has_dlc')) return false;
    if (e.k === 'always' && e.v === false) return false;
  }
  return true;
}
const dlcNames = (cond) => {
  const out = [];
  const rec = (b) => { if (!isBlock(b)) return; for (const e of b) { if (e.k === 'has_dlc' && typeof e.v === 'string') out.push(e.v); else if (isBlock(e.v) && e.k !== 'NOT' && e.k !== 'not') rec(e.v); } };
  rec(cond);
  return [...new Set(out)];
};

// ================================================================ 1. TECHNOLOGIES
const TECH_SKIP = /air|naval|MTG|bba_air/i;
const LAND_FOLDERS = new Set(['infantry_folder', 'support_folder', 'armour_folder', 'nsb_armour_folder', 'artillery_folder']);
const rawTechs = {};
for (const f of fs.readdirSync(P.technologies).filter((x) => x.endsWith('.txt') && !TECH_SKIP.test(x))) {
  const t = first(read(path.join(P.technologies, f)), 'technologies');
  if (!isBlock(t)) continue;
  for (const e of t) {
    if (!isBlock(e.v) || e.k.startsWith('@')) continue;
    rawTechs[e.k] = { id: e.k, file: f, b: e.v };
  }
}

// ================================================================ 2. UNITS (sub_units)
const NON_LAND_GROUPS = new Set(); // air/naval have no group or ship types; land groups listed below
const LAND_GROUPS = { infantry: 'infantry', combat_support: 'infantry', mobile: 'mobile', mobile_combat_support: 'mobile', armor: 'armor', armor_combat_support: 'armor', support: null };
const rawUnits = {};
for (const f of fs.readdirSync(P.units).filter((x) => x.endsWith('.txt'))) {
  const su = first(read(path.join(P.units, f)), 'sub_units');
  if (!isBlock(su)) continue;
  for (const e of su) if (isBlock(e.v)) rawUnits[e.k] = { id: e.k, b: e.v, file: f };
}

const numOf = (b, k, d) => (typeof first(b, k) === 'number' ? first(b, k) : d);

// ---- categories a unit belongs to
const units = {};
for (const u of Object.values(rawUnits)) {
  const g = first(u.b, 'group');
  if (!(g in LAND_GROUPS)) continue;
  if (/^hq_/.test(u.id) || u.id === 'fake_intel_unit') continue;
  const cats = bare(first(u.b, 'categories'));
  let role;
  if (g === 'support') role = cats.includes('category_regimental_support_battalions') ? 'reg' : 'div';
  else role = 'line';
  const need = {};
  for (const e of first(u.b, 'need') || []) if (typeof e.v === 'number') need[e.k] = e.v;
  const transport = first(u.b, 'transport');
  const bm = all(u.b, 'battalion_mult').map((b) => ({ category: first(b, 'category'), add: first(b, 'add') === true, stats: mapStats(b) })).filter((x) => x.category);
  const sameType = all(u.b, 'same_support_type');
  const supportType = (bare(first(u.b, 'type')) || []);
  // absolute values vs fractional modifiers: see engine notes. Store both in one object; the engine knows which is which.
  units[u.id] = {
    id: u.id,
    name: nameOf(u.id),
    abbr: first(u.b, 'abbreviation') || '',
    role,
    col: LAND_GROUPS[g] || null,
    group: g,
    cats,
    active: first(u.b, 'active') === true,
    special: first(u.b, 'special_forces') === true,
    base: {
      ...mapStats(u.b),
      width: numOf(u.b, 'combat_width', 0),
      hp: numOf(u.b, 'max_strength', 0),
      org: numOf(u.b, 'max_organisation', 0),
      rec: numOf(u.b, 'default_morale', 0),
      mp: numOf(u.b, 'manpower', 0),
      sup: numOf(u.b, 'supply_consumption', 0),
      recon: numOf(u.b, 'recon', 0),
      // sub-unit maximum_speed is in 10 km/h units and replaces the equipment speed when present
      spdOverride: typeof first(u.b, 'maximum_speed') === 'number' ? first(u.b, 'maximum_speed') * 10 : null,
    },
    need,
    transport: transport || null,
    essential: bare(first(u.b, 'essential')),
    sameType: sameType.filter((x) => typeof x === 'string'),
    types: supportType,
    battalionMult: bm,
    affectsSpeed: first(u.b, 'affects_speed') !== false && role === 'line',
  };
  // remove keys that belong to stat maps only via `base`
  delete units[u.id].base.spd;
  for (const k of ['ic', 'rel']) delete units[u.id].base[k];
}

// ================================================================ 3. EQUIPMENT
const EQ_SKIP_FILES = /plane|airframe|ship|missile|convoy|nuclear|floating|emplacement|helicopter_dummy|train|mothership|intercontinental|quad_engine|single_engine|twin_engine|sam_missile|repair|support_ships|plane_filters|tank_filters/i;
const rawEq = {};
const eqDir = path.join(P.units, 'equipment');
const designerFiles = new Set(['tank_chassis.txt']);
for (const f of fs.readdirSync(eqDir).filter((x) => x.endsWith('.txt') && !EQ_SKIP_FILES.test(x))) {
  const eq = first(read(path.join(eqDir, f)), 'equipments');
  if (!isBlock(eq)) continue;
  for (const e of eq) if (isBlock(e.v)) rawEq[e.k] = { id: e.k, b: e.v, file: f };
}

// Tank-based units are built from the tank designer: a chassis size plus a role (armor, anti_tank, anti_air, artillery).
const DESIGN_RE = /^(light|medium|heavy|modern|super_heavy)_tank_(?:(destroyer|aa|artillery|flame)_)?chassis$/;
const ROLE_OF = { undefined: 'armor', destroyer: 'anti_tank', aa: 'anti_air', artillery: 'artillery', flame: 'flame' };
for (const u of Object.values(units)) {
  for (const [arch, count] of Object.entries(u.need)) {
    const m = DESIGN_RE.exec(arch);
    if (m || arch === 'amphibious_tank_chassis') {
      const role = m ? ROLE_OF[m[2]] : 'armor';
      const chassis = m ? `${m[1]}_tank_chassis` : 'amphibious_tank_chassis';
      if (role === 'flame') { delete units[u.id]; break; }
      u.tank = { chassis, role, count };
      delete u.need[arch];
    }
  }
}

// archetypes needed by kept land units
const neededArch = new Set();
const neededChassis = new Set();
for (const u of Object.values(units)) {
  for (const k of Object.keys(u.need)) neededArch.add(k);
  if (u.tank) neededChassis.add(u.tank.chassis);
}

const EQ_STAT_KEYS = ['sa', 'ha', 'def', 'brk', 'pier', 'air', 'arm', 'hard', 'spd', 'ic', 'mp', 'rel'];
function eqStats(b) {
  const s = mapStats(b);
  const o = {};
  for (const k of EQ_STAT_KEYS) if (k in s) o[k] = s[k];
  return o;
}

const equipment = {}; // archetype -> { id, name, variants: [{ id, year, stats }] }  (fixed, non-designer)
const chassisArch = {}; // designer chassis archetypes
for (const eq of Object.values(rawEq)) {
  const a = first(eq.b, 'is_archetype') === true ? eq.id : null;
  if (!a) continue;
  const isDesigner = designerFiles.has(eq.file);
  if (isDesigner) { if (neededChassis.has(a)) chassisArch[a] = { eq }; continue; }
  if (!neededArch.has(a)) continue;
  equipment[a] = { id: a, name: nameOf(a), base: eqStats(eq.b), variants: [] };
}
for (const eq of Object.values(rawEq)) {
  const arch = first(eq.b, 'archetype');
  if (!arch) continue;
  if (equipment[arch] && !designerFiles.has(eq.file) && eq.file !== 'x_tank_chassis.txt') {
    equipment[arch].variants.push({ id: eq.id, year: numOf(eq.b, 'year', 1936), stats: { ...equipment[arch].base, ...eqStats(eq.b) } });
  }
}
// x_tank_chassis.txt holds the pre-designer fixed tank models. With the tank designer they are not used.

// ---- tank designer chassis
const designers = {};
for (const [arch, { eq }] of Object.entries(chassisArch)) {
  const slots = {};
  const ms = first(eq.b, 'module_slots');
  for (const s of ms || []) {
    if (!isBlock(s.v)) continue;
    slots[s.k] = { required: first(s.v, 'required') === true, cats: bare(first(s.v, 'allowed_module_categories')) };
  }
  const limits = all(eq.b, 'module_count_limit').map((l) => {
    const c = l.find((x) => x.k === 'count');
    return { module: first(l, 'module') || null, category: first(l, 'category') || null, lt: c ? c.v : null };
  }).filter((l) => l.lt != null);
  designers[arch] = { id: arch, name: nameOf(arch), slots, limits, base: eqStats(eq.b), variants: [] };
}
for (const eq of Object.values(rawEq)) {
  const arch = first(eq.b, 'archetype');
  if (arch && designers[arch] && designerFiles.has(eq.file)) {
    designers[arch].variants.push({ id: eq.id, year: numOf(eq.b, 'year', 1936), stats: { ...designers[arch].base, ...eqStats(eq.b) } });
  }
}

// ---- tank modules
const modules = {};
const modFile = path.join(eqDir, 'modules/00_tank_modules.txt');
if (fs.existsSync(modFile)) {
  for (const blk of read(modFile)) {
    if (blk.k !== 'equipment_modules' || !isBlock(blk.v)) continue;
    const limit = first(blk.v, 'limit');
    const dlc = dlcNames(limit);
    for (const e of blk.v) {
      if (!isBlock(e.v) || e.k === 'limit') continue;
      const acm = first(e.v, 'allowed_module_categories');
      const cat = first(e.v, 'category');
      if (!/^tank_/.test(cat || '') || /^NOR_/.test(e.k)) continue; // land cruiser (lc_*) and national modules are not modelled
      modules[e.k] = {
        id: e.k,
        name: nameOf(e.k),
        cat: first(e.v, 'category'),
        add: mapStats(first(e.v, 'add_stats') || []),
        mul: mapStats(first(e.v, 'multiply_stats') || []),
        allowEquipmentType: all(e.v, 'allow_equipment_type').filter((x) => typeof x === 'string'),
        // roles a module cannot be used in (plain 'armor' tanks cannot take AA guns, for example)
        forbidArmor: first(e.v, 'forbid_equipment_type_exact_match') === 'armor',
        // main-armament categories this turret can carry, and those it cannot carry on plain armor tanks
        allowsMain: (() => { const a = first(e.v, 'allowed_module_categories'); return a && first(a, 'main_armament_slot') ? bare(first(a, 'main_armament_slot')) : null; })(),
        forbidMainOnArmor: (() => { const f = first(e.v, 'forbid_equipment_type_exact_match_for_category'); return isBlock(f) ? f.filter((x) => x.v === 'armor').map((x) => x.k) : []; })(),
        parent: first(e.v, 'parent') || null,
        dlc,
      };
    }
  }
}
// upgrade levels for the NSB designer
const upgrades = {};
const upFile = path.join(eqDir, 'upgrades/land_upgrades.txt');
if (fs.existsSync(upFile)) {
  const up = first(read(upFile), 'upgrades');
  for (const e of up || []) {
    if (!isBlock(e.v) || !/^tank_nsb_/.test(e.k)) continue;
    const reqs = [];
    for (const r of first(e.v, 'level_requirements') || []) if (isBlock(r.v)) reqs.push({ level: Number(r.k), tech: first(r.v, 'has_tech') });
    upgrades[e.k] = { id: e.k, max: numOf(e.v, 'max_level', 20), add: mapStats(first(e.v, 'add_stats') || []), reliability: numOf(e.v, 'reliability', 0), reqs };
  }
}

// ================================================================ 4. TECH GRAPH
const unitIds = new Set(Object.keys(units));
const isUnitTarget = (k) => k.startsWith('category_') || unitIds.has(k);
const STAT_BLOCK_SKIP = new Set(['path', 'folder', 'categories', 'allow', 'allow_branch', 'ai_will_do', 'on_research_complete', 'on_research_complete_limit', 'ai_research_weights', 'enable_equipments', 'enable_subunits', 'enable_equipment_modules', 'enable_building', 'xor', 'XOR', 'dependencies', 'sub_technologies', 'special_project_specialization']);

const techs = {};
for (const t of Object.values(rawTechs)) {
  const b = t.b;
  const allow = first(b, 'allow');
  if (allow !== undefined && !dlcOk(allow) && !(isBlock(allow) && allow.some((x) => x.k === 'ROOT'))) continue; // national / disabled techs
  if (!dlcOk(first(b, 'allow_branch'))) continue;
  const folder = first(first(b, 'folder'), 'name') || null;
  const sp = first(b, 'is_special_project_tech') === true;
  const project = isBlock(allow) ? (() => { const r = allow.find((x) => x.k === 'ROOT'); const v = r && first(r.v, 'is_special_project_completed'); return typeof v === 'string' ? v.replace(/^sp:/, '') : null; })() : null;
  const mods = [];
  for (const e of b) {
    if (!e.k || !isBlock(e.v) || STAT_BLOCK_SKIP.has(e.k)) continue;
    if (!isUnitTarget(e.k)) continue;
    const stats = mapStats(e.v);
    if (Object.keys(stats).length) mods.push({ target: e.k, stats });
  }
  const parents = []; // filled below from path edges
  techs[t.id] = {
    id: t.id,
    name: nameOf(t.id),
    folder,
    file: t.file,
    year: numOf(b, 'start_year', 1936),
    x: (() => { const p = first(first(b, 'folder'), 'position'); return p ? { x: first(p, 'x'), y: first(p, 'y') } : null; })(),
    special: sp,
    project,
    dlc: dlcNames(first(b, 'allow_branch')),
    parents,
    deps: [],
    xor: [...bare(first(b, 'xor')), ...bare(first(b, 'XOR'))],
    subOf: null,
    subs: bare(first(b, 'sub_technologies')),
    unlocks: {
      units: bare(first(b, 'enable_subunits')),
      equipment: bare(first(b, 'enable_equipments')),
      modules: bare(first(b, 'enable_equipment_modules')),
    },
    mods,
    _leads: all(b, 'path').map((p) => first(p, 'leads_to_tech')).filter(Boolean),
    _deps: (() => { const d = first(b, 'dependencies'); return d ? keys(d) : []; })(),
  };
}
for (const t of Object.values(techs)) {
  for (const c of t._leads) if (techs[c]) techs[c].parents.push(t.id);
  for (const s of t.subs) if (techs[s]) { techs[s].subOf = t.id; if (!techs[s].parents.includes(t.id)) techs[s].parents.push(t.id); if (!techs[s].folder) techs[s].folder = t.folder; }
  t.deps = t._deps.filter((d) => techs[d]);
}

// relevance: keep techs that change a division stat, unlock a division-relevant unit / equipment / tank module, plus ancestors
const landEffect = (t) => t.mods.length
  || t.unlocks.units.some((u) => unitIds.has(u))
  || t.unlocks.equipment.some((e) => rawEq[e] && (neededArch.has(first(rawEq[e].b, 'archetype')) || neededArch.has(e)))
  || t.unlocks.modules.some((m) => modules[m]);
const keep = new Set();
for (const t of Object.values(techs)) {
  const inTree = LAND_FOLDERS.has(t.folder) || t.folder === 'electronics_folder' || t.special || (t.folder === null && t.unlocks.modules.some((m) => modules[m]));
  if (inTree && landEffect(t)) keep.add(t.id);
}
// tech_upgrades used by tank upgrade level requirements
for (const up of Object.values(upgrades)) for (const r of up.reqs) if (techs[r.tech]) keep.add(r.tech);
// ancestors
let grew = true;
while (grew) {
  grew = false;
  for (const id of [...keep]) for (const p of techs[id].parents.concat(techs[id].deps)) if (!keep.has(p) && techs[p]) { keep.add(p); grew = true; }
}
for (const id of Object.keys(techs)) if (!keep.has(id)) delete techs[id];
for (const t of Object.values(techs)) {
  t.parents = t.parents.filter((p) => techs[p]);
  t.deps = t.deps.filter((p) => techs[p]);
  t.xor = t.xor.filter((p) => techs[p]);
  t.subs = t.subs.filter((p) => techs[p]);
  delete t._leads; delete t._deps;
}

// ---- equipment / module / unit unlock maps
const eqUnlockedBy = {}; const modUnlockedBy = {}; const unitUnlockedBy = {};
for (const t of Object.values(techs)) {
  for (const e of t.unlocks.equipment) (eqUnlockedBy[e] ??= []).push(t.id);
  for (const m of t.unlocks.modules) (modUnlockedBy[m] ??= []).push(t.id);
  for (const u of t.unlocks.units) (unitUnlockedBy[u] ??= []).push(t.id);
}
for (const a of Object.values(equipment)) for (const v of a.variants) v.by = eqUnlockedBy[v.id] || [];
for (const d of Object.values(designers)) for (const v of d.variants) v.by = eqUnlockedBy[v.id] || [];
for (const m of Object.values(modules)) m.by = modUnlockedBy[m.id] || [];
for (const u of Object.values(units)) u.by = unitUnlockedBy[u.id] || [];

// drop units nobody can build (national-only) and units with no obtainable equipment
for (const u of Object.values(units)) {
  if (!u.active && u.by.length === 0) delete units[u.id];
}
// regimental SP support companies are unlocked together with their divisional brigade counterpart
for (const u of Object.values(units)) {
  if (u.by.length || !u.tank || u.role !== 'reg') continue;
  const size = u.tank.chassis.replace('_tank_chassis', '');
  const sib = { anti_tank: `${size}_tank_destroyer_brigade`, anti_air: `${size}_sp_anti_air_brigade`, artillery: `${size}_sp_artillery_brigade` }[u.tank.role];
  if (units[sib]) u.by = units[sib].by.slice();
}
// units that are enabled from the start but whose equipment is only granted by a special project are dropped
const onlyFree = (arch) => {
  const vs = (equipment[arch] && equipment[arch].variants) || (designers[arch] && designers[arch].variants) || [];
  return vs.length > 0 && vs.every((v) => v.by.length === 0);
};
for (const u of Object.values(units)) {
  if (u.active && (Object.keys(u.need).some(onlyFree) || (u.tank && onlyFree(u.tank.chassis)))) delete units[u.id];
}
// drop units that need an archetype we cannot supply
const supplied = (arch) => (equipment[arch] && equipment[arch].variants.length) || (designers[arch] && designers[arch].variants.length);
for (const u of Object.values(units)) {
  const needs = Object.keys(u.need);
  if (needs.some((n) => !supplied(n)) || (u.tank && !supplied(u.tank.chassis))) delete units[u.id];
}
for (const id of Object.keys(designers)) if (/^lc_|land_cruiser/.test(id)) delete designers[id];

// category membership
const categories = {};
for (const u of Object.values(units)) for (const c of u.cats) (categories[c] ??= []).push(u.id);

// ================================================================ 5. DOCTRINES
function collectMods(b, skip = []) {
  const out = [];
  const extra = {};
  for (const e of b || []) {
    if (!e.k) continue;
    if (isBlock(e.v)) {
      if (skip.includes(e.k)) continue;
      if (isUnitTarget(e.k)) { const s = mapStats(e.v); if (Object.keys(s).length) out.push({ target: e.k, stats: s }); }
      else if (e.k === 'modifiers' || e.k === 'modifier') { for (const [k, v] of Object.entries(scalars(e.v))) if (typeof v === 'number') extra[k] = v; }
    } else if (typeof e.v === 'number' && e.k === 'additional_brigade_column_size') extra[e.k] = e.v;
  }
  return { mods: out, extra };
}

const tracks = {};
for (const f of walk(path.join(P.doctrines, 'tracks')).filter((x) => x.endsWith('.txt'))) {
  for (const e of read(f)) if (isBlock(e.v)) tracks[e.k] = { id: e.k, name: nameOf(first(e.v, 'name') || e.k, `DOCTRINE_TRACK_${e.k.toUpperCase()}`) };
}
const grands = {};
for (const f of walk(path.join(P.doctrines, 'grand_doctrines')).filter((x) => x.endsWith('.txt'))) {
  for (const e of read(f)) {
    if (!isBlock(e.v)) continue;
    const folder = first(e.v, 'folder');
    if (folder !== 'land' && folder !== 'special_forces') continue;
    const own = collectMods(e.v, ['milestones', 'tracks', 'available', 'ai_will_do']);
    const ms = first(e.v, 'milestones') || [];
    const trackIds = bare(first(e.v, 'tracks'));
    const milestones = ms.filter((m) => isBlock(m.v)).map((m, i) => ({ track: trackIds[i] || null, ...collectMods(m.v, ['effect']) }));
    grands[e.k] = { id: e.k, name: nameOf(first(e.v, 'name') || e.k), folder, tracks: trackIds, mods: own.mods, extra: own.extra, milestones };
  }
}
const subs = {};
const subFiles = walk(path.join(P.doctrines, 'subdoctrines')).filter((x) => x.endsWith('.txt') && /land|special_forces/.test(x));
for (const f of subFiles) {
  for (const e of read(f)) {
    if (!isBlock(e.v)) continue;
    const trackVal = first(e.v, 'track');
    const trackList = isBlock(trackVal) ? bare(trackVal) : [trackVal];
    if (!trackList.filter(Boolean).length) continue;
    const own = collectMods(e.v, ['rewards', 'available', 'ai_will_do', 'effect', 'mastery']);
    const rewards = [];
    const rb = first(e.v, 'rewards') || [];
    for (const r of rb) {
      const inner = isBlock(r.v) ? r.v : null;
      if (!inner) continue;
      if (r.k) {
        const c = collectMods(inner, ['effect', 'mastery']);
        rewards.push({ id: r.k, name: nameOf(`${e.k}_${r.k}`, `${e.k}_${r.k}_name`, r.k), mods: c.mods, extra: c.extra });
      } else { // anonymous numbered reward block
        const c = collectMods(inner, ['effect', 'mastery']);
        rewards.push({ id: `r${rewards.length + 1}`, name: nameOf(`${e.k}_reward_${rewards.length + 1}`, `${e.k}_${rewards.length + 1}`), mods: c.mods, extra: c.extra });
      }
    }
    subs[e.k] = { id: e.k, name: nameOf(first(e.v, 'name') || e.k), tracks: trackList.filter(Boolean), xor: bare(first(e.v, 'xor')), mods: own.mods, extra: own.extra, rewards, dlc: [] };
  }
}

// ================================================================ 6. WRITE
// drop unit-scoped modifiers that can never apply, to keep the file small
const validTarget = (t) => t.startsWith('category_') || units[t];
for (const t of Object.values(techs)) t.mods = t.mods.filter((m) => validTarget(m.target));
const cleanMods = (o) => { o.mods = (o.mods || []).filter((m) => validTarget(m.target)); };
Object.values(grands).forEach((g) => { cleanMods(g); g.milestones.forEach(cleanMods); });
Object.values(subs).forEach((s) => { cleanMods(s); s.rewards.forEach(cleanMods); });

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    gameVersion: opt.version || 'unknown (pass --version when extracting)',
    assumptions: ['All DLC owned', 'Vanilla (no mods)', 'National (focus-only) techs excluded'],
    counts: { units: Object.keys(units).length, techs: Object.keys(techs).length, modules: Object.keys(modules).length, subdoctrines: Object.keys(subs).length },
  },
  units, equipment, designers, modules, upgrades, techs, categories, tracks, grands, subs,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`Wrote ${outFile}`);
console.log(out.meta.counts);
