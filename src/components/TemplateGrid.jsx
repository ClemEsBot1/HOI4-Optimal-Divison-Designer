import React from 'react';

const COLS = [
  { id: 'infantry', label: 'Infantry' },
  { id: 'artillery', label: 'Artillery' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'mobile_artillery', label: 'Mobile artillery' },
  { id: 'armor', label: 'Armor' },
];
const MIN_FOR_REG = 3; // a column needs three battalions before it can take a regimental company

/** HOI4-style unit counter using the game's branch icon instead of NATO symbols. */
function Counter({ unit }) {
  const iconName = unit.cat === 'armor' ? 'category_all_armor' : unit.cat === 'artillery' || unit.cat === 'mobile_artillery' ? 'category_artillery' : 'category_all_infantry';
  return (
    <div className="counter" title={unit.name}>
      <img className="c-icon" src={`/hoi4/icons/${iconName}.png`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <span className="c-name">{unit.abbr || unit.name}</span>
    </div>
  );
}

/** Split ids over `n` columns as evenly as possible. */
function spread(ids, n) {
  const out = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => out[i % n].push(id));
  return out;
}

function Column({ label, ids, reg, byId, size }) {
  const slots = Array.from({ length: size }, (_, i) => ids[i]);
  const canReg = ids.length >= MIN_FOR_REG;
  return (
    <div className="tg-col">
      <h4>{label}</h4>
      {slots.map((id, i) => (id ? <Counter key={i} unit={byId.get(id)} /> : <div key={i} className="counter empty" aria-hidden="true" />))}
      <div className="tg-reg">
        {reg ? <Counter unit={byId.get(reg)} /> : <div className={'counter empty' + (canReg ? ' open' : '')} title={canReg ? 'Free regimental support slot' : 'Needs three battalions for regimental support'} aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * A division template laid out like the game's designer: columns of battalions, a regimental support slot under
 * each column that has three or more battalions, and divisional support below.
 */
export default function TemplateGrid({ items, support = [], reg = [], byId, columnSize = 5, layout }) {
  const columns = [];
  for (const c of COLS) {
    const ids = items.filter((id) => byId.get(id).cat === c.id);
    if (!ids.length) continue;
    const n = layout ? layout[c.id] : Math.ceil(ids.length / columnSize);
    for (const part of spread(ids, Math.max(1, n))) columns.push({ type: c.id, label: c.label, ids: part, reg: null });
  }
  // attach regimental companies: vehicle companies to armor columns, the rest to non-armor columns
  const tankRegs = reg.filter((id) => byId.get(id).tank);
  const footRegs = reg.filter((id) => !byId.get(id).tank);
  for (const c of columns) {
    if (c.ids.length < MIN_FOR_REG) continue;
    const pool = c.type === 'armor' ? tankRegs : footRegs;
    if (pool.length) c.reg = pool.shift();
  }
  return (
    <div className="tg" role="img" aria-label={`Template with ${items.length} battalions in ${columns.length} columns`}>
      <div className="tg-cols">
        {columns.map((c, i) => <Column key={i} label={c.label} ids={c.ids} reg={c.reg} byId={byId} size={columnSize} />)}
      </div>
      {columns.length > 0 && <p className="note tg-note">The bottom slot of each column is regimental support. It opens once a column has three battalions.</p>}
      {support.length > 0 && (
        <div className="tg-row">
          <h4>Divisional support</h4>
          <div className="tg-strip">{support.map((id, i) => <Counter key={i} unit={byId.get(id)} />)}</div>
        </div>
      )}
    </div>
  );
}
