import React, { useState } from 'react';
import { assignRegimentalColumns, unitContribution, STAT_BY_KEY, fmt } from '../lib/stats.js';
import { unitIcon, hideBroken } from '../lib/icons.js';

const COLS = [
  { id: 'infantry', label: 'Infantry' },
  { id: 'artillery', label: 'Artillery' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'mobile_artillery', label: 'Mobile artillery' },
  { id: 'armor', label: 'Armor' },
];
const MIN_FOR_REG = 3; // a column needs three battalions before it can take a regimental company
const TEMPLATE_COLUMNS = 5; // the game's designer always shows five battalion columns

const TIP_LABEL = { width: 'Combat width', spd: 'Speed (km/h)', ic: 'Production cost' };
const LIST_LABEL = { items: 'Battalion', support: 'Divisional support', reg: 'Regimental support' };

/** Rows for the hover card: every stat this unit moves by a visible amount, signed and coloured by whether it helps. */
function ContributionTip({ unit, ctx, list, index }) {
  const delta = unitContribution(ctx.tpl, list, index, ctx.byId, ctx.mods, ctx.opts, ctx.columnSize);
  const rows = delta ? Object.entries(delta).filter(([k, v]) => {
    const dp = STAT_BY_KEY[k]?.dp ?? 0;
    return Math.abs(v) >= 0.5 / 10 ** dp;
  }) : [];
  return (
    <div className="c-tip" role="tooltip">
      <b>{unit.name}</b>
      <small>{LIST_LABEL[list]} · adds to the division</small>
      {rows.length ? (
        <dl>
          {rows.map(([k, v]) => {
            const dir = k === 'width' ? -1 : STAT_BY_KEY[k].dir;
            return (
              <React.Fragment key={k}>
                <dt>{TIP_LABEL[k] || STAT_BY_KEY[k].label}</dt>
                <dd className={v * dir > 0 ? 'up' : 'down'}>{v > 0 ? '+' : '\u2212'}{fmt(Math.abs(v), k)}</dd>
              </React.Fragment>
            );
          })}
        </dl>
      ) : <small>No measurable change.</small>}
    </div>
  );
}

/** HOI4-style unit counter using the game's own unit icon (branch icon as fallback). Hover or focus shows what it adds. */
function Counter({ unit, ctx, list, index }) {
  const [open, setOpen] = useState(false);
  const branch = unit.cat === 'armor' ? 'category_all_armor' : unit.cat === 'artillery' || unit.cat === 'mobile_artillery' ? 'category_artillery' : 'category_all_infantry';
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <div className="counter" tabIndex={0} aria-label={unit.name} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <img className="c-icon" src={unitIcon(unit.id) || `/hoi4/icons/${branch}.png`} alt="" onError={hideBroken} />
      <span className="c-name">{unit.abbr || unit.name}</span>
      {open && <ContributionTip unit={unit} ctx={ctx} list={list} index={index} />}
    </div>
  );
}

/** Split ids into planned column sizes. */
function splitBySizes(ids, sizes) {
  let offset = 0;
  return sizes.map((size) => {
    const part = ids.slice(offset, offset + size);
    offset += size;
    return part;
  });
}

/** Split ids over `n` columns as evenly as possible when no planned sizes are available. */
function spread(ids, n) {
  const out = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => out[i % n].push(id));
  return out;
}

function Column({ label, ids, reg, byId, size, ctx }) {
  const slots = Array.from({ length: size }, (_, i) => ids[i]);
  const canReg = ids.length >= MIN_FOR_REG;
  return (
    <div className="tg-col">
      <h4>{label || '\u00a0'}</h4>
      {slots.map((id, i) => (id ? <Counter key={i} unit={byId.get(id)} ctx={ctx} list="items" index={ctx.tpl.items.indexOf(id)} /> : <div key={i} className="counter empty" aria-hidden="true" />))}
      <div className="tg-reg">
        {reg ? <Counter unit={byId.get(reg)} ctx={ctx} list="reg" index={ctx.tpl.reg.indexOf(reg)} /> : <div className={'counter empty' + (canReg ? ' open' : '')} title={canReg ? 'Free regimental support slot' : 'Needs three battalions for regimental support'} aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * A division template laid out like the game's designer: columns of battalions, a regimental support slot under
 * each column that has three or more battalions, and divisional support below.
 */
export default function TemplateGrid({ items, support = [], reg = [], byId, columnSize = 5, layout, mods, opts }) {
  const ctx = { tpl: { items, support, reg }, byId, mods, opts, columnSize };
  const columns = [];
  for (const c of COLS) {
    const ids = items.filter((id) => byId.get(id).cat === c.id);
    if (!ids.length) continue;
    const n = layout ? layout[c.id] : Math.ceil(ids.length / columnSize);
    const sizes = layout?.sizes?.[c.id];
    const parts = sizes?.length === n
      ? splitBySizes(ids, sizes)
      : spread(ids, Math.max(1, n));
    for (let i = 0; i < parts.length; i++) columns.push({ type: c.id, index: i, label: c.label, ids: parts[i], reg: null });
  }
  const assignments = assignRegimentalColumns(reg, layout, byId);
  for (const c of columns) c.reg = assignments.get(`${c.type}:${c.index}`)?.id || null;
  const shown = [...columns];
  while (shown.length < TEMPLATE_COLUMNS) shown.push({ label: '', ids: [], reg: null });
  return (
    <div className="tg" role="group" aria-label={`Template with ${items.length} battalions in ${columns.length} columns`}>
      <div className="tg-cols">
        {shown.map((c, i) => <Column key={i} label={c.label} ids={c.ids} reg={c.reg} byId={byId} size={columnSize} ctx={ctx} />)}
      </div>
      {columns.length > 0 && <p className="note tg-note">The bottom slot of each column is regimental support. It opens once a column has three battalions.</p>}
      {support.length > 0 && (
        <div className="tg-row">
          <h4>Divisional support</h4>
          <div className="tg-strip">{support.map((id, i) => <Counter key={i} unit={byId.get(id)} ctx={ctx} list="support" index={i} />)}</div>
        </div>
      )}
    </div>
  );
}
