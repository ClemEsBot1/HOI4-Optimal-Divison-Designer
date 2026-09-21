import React from 'react';
import { defaultExclude } from '../lib/presets.js';

const isArtillery = (u) => (u.cats || []).includes('category_line_artillery');
const GROUPS = [
  { id: 'infantry', label: 'Infantry columns', pick: (u) => u.role === 'line' && u.col === 'infantry' && !isArtillery(u) },
  { id: 'artillery', label: 'Artillery columns', pick: (u) => u.role === 'line' && u.col === 'infantry' && isArtillery(u) },
  { id: 'mobile', label: 'Mobile columns', pick: (u) => u.role === 'line' && u.col === 'mobile' && !isArtillery(u) },
  { id: 'mobile_artillery', label: 'Mobile artillery columns', pick: (u) => u.role === 'line' && u.col === 'mobile' && isArtillery(u) },
  { id: 'armor', label: 'Armor columns', pick: (u) => u.role === 'line' && u.col === 'armor' },
  { id: 'reg', label: 'Regimental support', pick: (u) => u.role === 'reg' },
  { id: 'div', label: 'Divisional support', pick: (u) => u.role === 'div' },
];

/** Choose which unit types templates may use. Units you have not researched never appear whatever you choose here. */
export default function UnitPool({ game, exclude, setExclude }) {
  const off = new Set(exclude);
  const toggle = (id) => setExclude((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id)));
  const units = [...game.units.values()];
  return (
    <div className="up">
      <p className="note">Special forces (marines, paratroopers, mountaineers, rangers, amtracs) and cavalry are off by default because they only make sense in particular situations. Switch on anything you want the search to consider.</p>
      <div className="seg">
        <button type="button" className="ghost" onClick={() => setExclude(defaultExclude(game))}>Standard</button>
        <button type="button" className="ghost" onClick={() => setExclude([])}>Allow everything</button>
      </div>
      {GROUPS.map((g) => {
        const list = units.filter(g.pick).sort((a, b) => (a.name < b.name ? -1 : 1));
        if (!list.length) return null;
        return (
          <details key={g.id} className="group">
            <summary>{g.label} <span className="tp-tabcount">{list.filter((u) => !off.has(u.id)).length}/{list.length}</span></summary>
            <ul className="up-list">
              {list.map((u) => (
                <li key={u.id}>
                  <label className="check">
                    <input type="checkbox" checked={!off.has(u.id)} onChange={() => toggle(u.id)} />
                    {u.name}{u.special ? ' (special forces)' : ''}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
