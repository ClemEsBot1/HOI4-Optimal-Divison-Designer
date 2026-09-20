import React from 'react';

const COLS = [
  { id: 'infantry', label: 'Infantry' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'armor', label: 'Armor' },
];

/** NATO-style unit counter: frame, a symbol for the branch, and the unit's short name. */
function Counter({ unit }) {
  const cats = unit.cats || [];
  const has = (c) => cats.includes(c);
  const armored = unit.cat === 'armor' || has('category_tanks') || has('category_all_armor');
  const artillery = has('category_artillery') || has('category_rocket_artillery');
  const infantry = has('category_all_infantry') || has('category_light_infantry');
  const mech = has('category_mobile') || has('category_mechanized') || unit.cat === 'mobile';
  return (
    <div className="counter" title={unit.name}>
      <svg viewBox="0 0 56 38" aria-hidden="true">
        <rect x="1.5" y="1.5" width="53" height="35" rx="1" className="c-frame" />
        {armored && <ellipse cx="28" cy="19" rx="15" ry="8" className="c-sym" />}
        {infantry && !armored && <path d="M1.5 1.5 L54.5 36.5 M54.5 1.5 L1.5 36.5" className="c-sym" />}
        {mech && !armored && !infantry && <ellipse cx="28" cy="19" rx="8" ry="5" className="c-sym" />}
        {artillery && <circle cx="28" cy="19" r="3.4" className="c-fill" />}
      </svg>
      <span className="c-name">{unit.abbr || unit.name}</span>
    </div>
  );
}

function Column({ label, ids, byId, size }) {
  const slots = Array.from({ length: size }, (_, i) => ids[i]);
  return (
    <div className="tg-col">
      <h4>{label}</h4>
      {slots.map((id, i) => (id ? <Counter key={i} unit={byId.get(id)} /> : <div key={i} className="counter empty" aria-hidden="true" />))}
    </div>
  );
}

/** A division template laid out like the game's designer: columns of battalions, then regimental and divisional support. */
export default function TemplateGrid({ items, support = [], reg = [], byId, columnSize = 5 }) {
  const grouped = COLS.map((c) => ({ ...c, ids: items.filter((id) => byId.get(id).cat === c.id) }));
  const columns = [];
  for (const g of grouped) {
    for (let i = 0; i < g.ids.length; i += columnSize) columns.push({ label: g.label, ids: g.ids.slice(i, i + columnSize) });
  }
  return (
    <div className="tg" role="img" aria-label={`Template with ${items.length} battalions in ${columns.length} columns`}>
      <div className="tg-cols">
        {columns.map((c, i) => <Column key={i} label={c.label} ids={c.ids} byId={byId} size={columnSize} />)}
      </div>
      {reg.length > 0 && (
        <div className="tg-row">
          <h4>Regimental support</h4>
          <div className="tg-strip">{reg.map((id, i) => <Counter key={i} unit={byId.get(id)} />)}</div>
        </div>
      )}
      {support.length > 0 && (
        <div className="tg-row">
          <h4>Divisional support</h4>
          <div className="tg-strip">{support.map((id, i) => <Counter key={i} unit={byId.get(id)} />)}</div>
        </div>
      )}
    </div>
  );
}
