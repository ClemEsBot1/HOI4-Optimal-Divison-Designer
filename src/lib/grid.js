/**
 * The manual designer's grid: five battalion columns plus a divisional support column, edited slot by slot like
 * the game's division designer.
 *
 * A grid is { columns: [{ type: column family | null, items: (id|null)[columnSize], reg: id|null }] x5,
 *             support: id[] (up to five, packed from the top) }.
 * A column takes its family from its first battalion and keeps it until the column is empty again.
 */
import { assignRegimentalColumns, COLUMN_TYPES, evaluate, MAX_COLUMNS, MAX_SUPPORT, planColumns, regFitsColumn, REG_MIN_BATTALIONS, supportConflict, CONTRIBUTION_KEYS, DEFAULT_OPTS } from './stats.js';

export const GRID_COLUMNS = MAX_COLUMNS;

const emptyColumn = (size) => ({ type: null, items: Array(size).fill(null), reg: null });

export function emptyGrid(size = 5) {
  return { columns: Array.from({ length: GRID_COLUMNS }, () => emptyColumn(size)), support: [] };
}

const count = (col) => col.items.filter(Boolean).length;

/** Keep a column's family and regimental company consistent with what is left in it. */
function settle(col) {
  const n = count(col);
  const type = n ? col.type : null;
  const reg = col.reg && n >= REG_MIN_BATTALIONS ? col.reg : null;
  return { ...col, type, reg };
}

/** Normalise stored columns to five columns of `size` slots each. */
function normalise(columns, size) {
  const out = columns.slice(0, GRID_COLUMNS).map((c) => {
    const items = (c.items || []).slice(0, size);
    while (items.length < size) items.push(null);
    return settle({ type: c.type || null, items: items.map((id) => id || null), reg: c.reg || null });
  });
  while (out.length < GRID_COLUMNS) out.push(emptyColumn(size));
  return out;
}

/**
 * The grid for a template. A template that came out of the grid keeps its columns; any other (the search's best,
 * a saved template, a shared link) is laid out the way the search planned it.
 */
export function gridFromTemplate(tpl, byId, size = 5) {
  if (tpl.columns?.length) return { columns: normalise(tpl.columns, size), support: (tpl.support || []).slice() };
  const grid = emptyGrid(size);
  const items = (tpl.items || []).filter((id) => byId.has(id));
  const reg = (tpl.reg || []).filter((id) => byId.has(id));
  const cnt = Object.fromEntries(COLUMN_TYPES.map((t) => [t, 0]));
  for (const id of items) cnt[byId.get(id).cat]++;
  const armorRegs = reg.filter((id) => byId.get(id).tank).length;
  const layout = planColumns(cnt, size, armorRegs, reg.length - armorRegs);
  const assignments = assignRegimentalColumns(reg, layout, byId);
  let at = 0;
  for (const type of COLUMN_TYPES) {
    const ids = items.filter((id) => byId.get(id).cat === type);
    const sizes = layout.sizes?.[type]?.length ? layout.sizes[type] : [];
    let offset = 0;
    const parts = sizes.length ? sizes.map((n) => { const p = ids.slice(offset, offset + n); offset += n; return p; }) : [];
    // Anything the plan could not place (an over-full template) still shows, in extra columns of `size`.
    for (let rest = ids.slice(offset); rest.length; rest = rest.slice(size)) parts.push(rest.slice(0, size));
    parts.forEach((part, index) => {
      if (at >= GRID_COLUMNS) return;
      const col = grid.columns[at++];
      part.slice(0, size).forEach((id, i) => { col.items[i] = id; });
      col.type = type;
      col.reg = assignments.get(`${type}:${index}`)?.id || null;
    });
  }
  grid.support = (tpl.support || []).filter((id) => byId.has(id)).slice(0, MAX_SUPPORT);
  return grid;
}

/** The template a grid describes, with its columns so evaluate() uses the layout as placed. */
export function templateFromGrid(grid) {
  const columns = grid.columns.map((c) => ({ type: c.type, items: c.items.slice(), reg: c.reg }));
  return {
    items: columns.flatMap((c) => c.items.filter(Boolean)),
    support: grid.support.slice(),
    reg: columns.map((c) => c.reg).filter(Boolean),
    columns,
  };
}

const withColumn = (grid, ci, f) => ({ ...grid, columns: grid.columns.map((c, i) => (i === ci ? settle(f(c)) : c)) });

/** Put a battalion in a slot (replacing whatever was there). */
export function placeBattalion(grid, ci, si, unit) {
  return withColumn(grid, ci, (c) => {
    const items = c.items.slice();
    items[si] = unit.id;
    // Swapping a column's only battalion for another family changes the column, so its company has to go.
    return { ...c, items, type: unit.cat, reg: c.type === unit.cat ? c.reg : null };
  });
}

/** Fill every empty slot of a column with one battalion type. */
export function fillColumn(grid, ci, unit) {
  return withColumn(grid, ci, (c) => ({ ...c, type: unit.cat, items: c.items.map((id) => id || unit.id), reg: c.type === unit.cat ? c.reg : null }));
}

export function removeBattalion(grid, ci, si) {
  return withColumn(grid, ci, (c) => ({ ...c, items: c.items.map((id, i) => (i === si ? null : id)) }));
}

export function setRegimental(grid, ci, id) {
  return withColumn(grid, ci, (c) => ({ ...c, reg: id || null }));
}

/** Put a support company in support slot `si`; an empty slot appends, since support packs from the top. */
export function setSupport(grid, si, id) {
  const support = grid.support.slice();
  if (!id) support.splice(si, 1);
  else if (si < support.length) support[si] = id;
  else if (support.length < MAX_SUPPORT) support.push(id);
  return { ...grid, support };
}

/** Battalions a slot can take: any line battalion in an empty column (or a column's only battalion), else its family. */
export function battalionChoices(grid, ci, si, line) {
  const col = grid.columns[ci];
  const others = col.items.filter((id, i) => id && i !== si).length;
  const order = (u) => COLUMN_TYPES.indexOf(u.cat);
  const fits = others ? line.filter((u) => u.cat === col.type) : line;
  return fits.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

/** Regimental companies a column can take: ones that fit its family and are not already in another column. */
export function regimentalChoices(grid, ci, reg) {
  const col = grid.columns[ci];
  if (!col.type || count(col) < REG_MIN_BATTALIONS) return [];
  const taken = new Set(grid.columns.map((c, i) => (i === ci ? null : c.reg)).filter(Boolean));
  return reg.filter((u) => regFitsColumn(u, col.type) && !taken.has(u.id));
}

/** Support companies slot `si` can take: none that clash with the companies in the other slots. */
export function supportChoices(grid, si, support, byId) {
  const others = grid.support.filter((_, i) => i !== si).map((id) => byId.get(id)).filter(Boolean);
  return support.filter((u) => !others.some((o) => supportConflict(o, u)));
}

/**
 * What the unit in one slot adds to the division: stats with it minus stats without it.
 * `where` is { kind: 'line', ci, si } | { kind: 'reg', ci } | { kind: 'support', si }.
 */
export function slotContribution(grid, where, byId, mods = {}, opts = DEFAULT_OPTS, size = 5) {
  const without = where.kind === 'line' ? removeBattalion(grid, where.ci, where.si)
    : where.kind === 'reg' ? setRegimental(grid, where.ci, null)
      : setSupport(grid, where.si, null);
  const a = evaluate(templateFromGrid(grid), byId, mods, opts, size);
  if (!a) return null;
  const b = evaluate(templateFromGrid(without), byId, mods, opts, size);
  return Object.fromEntries(CONTRIBUTION_KEYS.map((k) => [k, a[k] - (b ? b[k] : 0)]));
}
