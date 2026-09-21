import React, { useMemo, useState } from 'react';
import { evaluate, fmt } from '../lib/stats.js';

const COMPARE = [
  ['width', 'Width'], ['sa', 'Soft attack'], ['ha', 'Hard attack'], ['brk', 'Breakthrough'],
  ['def', 'Defense'], ['org', 'Organization'], ['arm', 'Armor'], ['pier', 'Piercing'],
  ['spd', 'Speed'], ['ic', 'Production cost'], ['sup', 'Supply'],
];

function addOne(ids, id) { return id ? ids.concat(id) : ids; }
function removeOne(ids, id) {
  const i = ids.indexOf(id);
  return i < 0 ? ids : ids.slice(0, i).concat(ids.slice(i + 1));
}

export default function ManualDesigner({ units, columnSize, mods, opts, best }) {
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const line = useMemo(() => units.filter((u) => u.role === 'line'), [units]);
  const support = useMemo(() => units.filter((u) => u.role === 'div'), [units]);
  const reg = useMemo(() => units.filter((u) => u.role === 'reg'), [units]);
  const [items, setItems] = useState([]);
  const [divSupport, setDivSupport] = useState([]);
  const [regSupport, setRegSupport] = useState([]);
  const [unitChoice, setUnitChoice] = useState('');
  const [supportChoice, setSupportChoice] = useState('');
  const [regChoice, setRegChoice] = useState('');

  const stats = items.length ? evaluate({ items, support: divSupport, reg: regSupport }, byId, mods, opts, columnSize) : null;
  const names = (ids) => ids.map((id) => byId.get(id)?.name || id);
  const bestStats = best?.stats;
  const toggleSupport = (id) => setDivSupport((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 5 ? cur.concat(id) : cur);
  return (
    <section className="block wide-block manual">
      <div className="section-heading">
        <div>
          <h2>Design your own division</h2>
          <p className="note">Build a template from the researched units, then compare it directly with the current top result.</p>
        </div>
        <button type="button" className="ghost" onClick={() => { setItems([]); setDivSupport([]); setRegSupport([]); }}>Clear design</button>
      </div>
      <div className="manual-tools">
        <label>Line battalion
          <select value={unitChoice} onChange={(e) => { setUnitChoice(e.target.value); setItems((x) => addOne(x, e.target.value)); }}>
            <option value="">Add battalion…</option>
            {line.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.width} width)</option>)}
          </select>
        </label>
        <label>Regimental company
          <select value={regChoice} onChange={(e) => { const id = e.target.value; setRegChoice(id); if (id && !regSupport.includes(id)) setRegSupport((x) => x.concat(id)); }}>
            <option value="">Add regimental…</option>
            {reg.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label>Divisional support
          <select value={supportChoice} onChange={(e) => { const id = e.target.value; setSupportChoice(id); if (id) toggleSupport(id); }}>
            <option value="">Toggle support…</option>
            {support.map((u) => <option key={u.id} value={u.id}>{u.name}{divSupport.includes(u.id) ? ' ✓' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="manual-lists">
        <div><b>Line</b>{items.length ? <ul>{[...new Set(items)].map((id) => <li key={id}><button type="button" className="mini-remove" onClick={() => setItems((x) => removeOne(x, id))}>−</button> {items.filter((x) => x === id).length}× {byId.get(id)?.name}</li>)}</ul> : <p className="note">Add battalions above.</p>}</div>
        <div><b>Support</b>{divSupport.length ? <ul>{divSupport.map((id) => <li key={id}><button type="button" className="mini-remove" onClick={() => setDivSupport((x) => x.filter((y) => y !== id))}>−</button> {byId.get(id)?.name}</li>)}</ul> : <p className="note">No divisional support.</p>}</div>
        <div><b>Regimental</b>{regSupport.length ? <ul>{regSupport.map((id) => <li key={id}><button type="button" className="mini-remove" onClick={() => setRegSupport((x) => x.filter((y) => y !== id))}>−</button> {byId.get(id)?.name}</li>)}</ul> : <p className="note">No regimental support.</p>}</div>
      </div>
      {!stats && <p className="note">Add at least one line battalion to evaluate your design.</p>}
      {stats && <>
        {!stats.valid && <p className="error">This template is not valid under the current column or regimental-support rules.</p>}
        <div className="manual-compare">
          <div><h3>Your design</h3><p className="manual-summary">{names(items).join(', ')}</p></div>
          <div><h3>Best result</h3><p className="manual-summary">{best ? best.items.map((id) => byId.get(id)?.name || id).join(', ') : 'Run a search first.'}</p></div>
        </div>
        {bestStats && <div className="table-scroll"><table className="manual-table"><thead><tr><th>Stat</th><th>Your design</th><th>Best result</th><th>Difference</th></tr></thead><tbody>
          {COMPARE.map(([key, label]) => { const diff = stats[key] - bestStats[key]; return <tr key={key}><th>{label}</th><td>{fmt(stats[key], key)}</td><td>{fmt(bestStats[key], key)}</td><td className={diff >= 0 ? 'better' : 'worse'}>{diff >= 0 ? '+' : ''}{fmt(diff, key)}</td></tr>; })}
        </tbody></table></div>}
      </>}
    </section>
  );
}
