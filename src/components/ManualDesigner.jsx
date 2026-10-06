import React, { useEffect, useMemo, useState } from 'react';
import { evaluate, fmt, STAT_BY_KEY, REG_MIN_BATTALIONS, MAX_SUPPORT } from '../lib/stats.js';
import { unitIcon, hideBroken } from '../lib/icons.js';
import {
  gridFromTemplate, templateFromGrid, placeBattalion, fillColumn, removeBattalion, setRegimental, setSupport,
  battalionChoices, regimentalChoices, supportChoices, slotContribution,
} from '../lib/grid.js';
import { DeltaTip } from './TemplateGrid.jsx';

const COLUMN_LABEL = { infantry: 'Infantry', artillery: 'Artillery', mobile: 'Mobile', mobile_artillery: 'Mobile artillery', armor: 'Armor' };
const KIND_LABEL = { line: 'Battalion', reg: 'Regimental support', support: 'Divisional support' };

const COMPARE = [
  ['width', 'Width'], ['sa', 'Soft attack'], ['ha', 'Hard attack'], ['brk', 'Breakthrough'],
  ['def', 'Defense'], ['org', 'Organization'], ['arm', 'Armor'], ['pier', 'Piercing'],
  ['spd', 'Speed'], ['ic', 'Production cost'], ['sup', 'Supply'],
];
const LIVE = [['width', 'Width'], ['org', 'Org'], ['sa', 'Soft atk'], ['ha', 'Hard atk'], ['def', 'Defense'], ['brk', 'Breakthr.'], ['hp', 'HP'], ['spd', 'Speed'], ['ic', 'Cost']];

const sameSlot = (a, b) => a && b && a.kind === b.kind && a.ci === b.ci && a.si === b.si;
const branchIcon = (u) => `/hoi4/icons/${u.cat === 'armor' ? 'category_all_armor' : u.cat === 'artillery' || u.cat === 'mobile_artillery' ? 'category_artillery' : 'category_all_infantry'}.png`;

/**
 * One slot of the template. Click opens the picker for it; right-click, Delete or Backspace empties it. Filled slots
 * show what their unit adds to the division on hover or focus.
 */
function Slot({ unit, where, sel, onPick, onClear, tip, locked, lockedTitle }) {
  const [open, setOpen] = useState(false);
  const active = sameSlot(where, sel);
  const label = unit ? `${unit.name}: click to change, right-click to remove` : locked ? lockedTitle : `Empty ${KIND_LABEL[where.kind].toLowerCase()} slot: click to add`;
  return (
    <button
      type="button"
      className={'counter slot' + (unit ? '' : ' empty') + (active ? ' active' : '') + (locked ? ' locked' : '')}
      aria-label={label}
      aria-pressed={active}
      title={unit ? undefined : label}
      onClick={() => onPick(where)}
      onContextMenu={(e) => { if (unit) { e.preventDefault(); onClear(where); } }}
      onKeyDown={(e) => { if (unit && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onClear(where); } }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    >
      {unit && <>
        <img className="c-icon" src={unitIcon(unit.id) || branchIcon(unit)} alt="" onError={hideBroken} />
        <span className="c-name">{unit.abbr || unit.name}</span>
        {open && !active && <DeltaTip unit={unit} kind={KIND_LABEL[where.kind]} delta={tip(where)} hint="Click to change · right-click to remove" />}
      </>}
    </button>
  );
}

/** The list of units the selected slot can take, like the game's unit picker. */
function Picker({ sel, grid, byId, line, reg, support, onChoose, onFill, onClear, onClose }) {
  const current = sel.kind === 'line' ? grid.columns[sel.ci].items[sel.si] : sel.kind === 'reg' ? grid.columns[sel.ci].reg : grid.support[sel.si];
  const col = sel.kind === 'support' ? null : grid.columns[sel.ci];
  const choices = sel.kind === 'line' ? battalionChoices(grid, sel.ci, sel.si, line)
    : sel.kind === 'reg' ? regimentalChoices(grid, sel.ci, reg)
      : supportChoices(grid, sel.si, support, byId);
  const filled = col ? col.items.filter(Boolean).length : 0;
  const title = sel.kind === 'support' ? 'Divisional support' : sel.kind === 'reg' ? `Regimental support · column ${sel.ci + 1}` : `Battalion · column ${sel.ci + 1}`;
  let note = null;
  if (sel.kind === 'line' && col.type && filled > (current ? 1 : 0)) note = `This column holds ${COLUMN_LABEL[col.type].toLowerCase()} battalions.`;
  if (sel.kind === 'reg' && filled < REG_MIN_BATTALIONS) note = `Needs ${REG_MIN_BATTALIONS} battalions in the column first.`;
  if (sel.kind === 'support' && !current && grid.support.length >= MAX_SUPPORT) note = 'All support slots are full.';
  return (
    <div className="dz-picker" role="dialog" aria-label={title}>
      <div className="dz-picker-head">
        <b>{title}</b>
        <button type="button" className="ghost small" onClick={onClose} aria-label="Close picker">✕</button>
      </div>
      {note && <p className="note">{note}</p>}
      {current && <button type="button" className="ghost small dz-remove" onClick={() => onClear(sel)}>Remove {byId.get(current)?.name}</button>}
      {choices.length ? (
        <ul className="dz-choices">
          {choices.map((u) => (
            <li key={u.id}>
              <button type="button" className={'dz-choice' + (u.id === current ? ' on' : '')} onClick={() => onChoose(u)}>
                <img src={unitIcon(u.id) || branchIcon(u)} alt="" onError={hideBroken} />
                <span><b>{u.name}</b><small>{sel.kind === 'line' ? `${fmt(u.width, 'width')} width · ` : ''}SA {fmt(u.sa, 'sa')} · Def {fmt(u.def, 'def')} · Org {fmt(u.org, 'org')}</small></span>
              </button>
              {sel.kind === 'line' && filled < col.items.length && (
                <button type="button" className="ghost small dz-fill" title={`Fill every empty slot in this column with ${u.name}`} onClick={() => onFill(u)}>Fill</button>
              )}
            </li>
          ))}
        </ul>
      ) : !note && <p className="note">No researched units fit here.</p>}
    </div>
  );
}

/**
 * Build a template by hand on the game's grid and compare it with the search's best. The design can be controlled
 * from outside (`design`, `setDesign`) so it survives switching views.
 */
export default function ManualDesigner({ units, columnSize, mods, opts, best, design, setDesign, onSave }) {
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const line = useMemo(() => units.filter((u) => u.role === 'line'), [units]);
  const support = useMemo(() => units.filter((u) => u.role === 'div'), [units]);
  const reg = useMemo(() => units.filter((u) => u.role === 'reg'), [units]);
  const [local, setLocal] = useState({ items: [], support: [], reg: [] });
  const cur = design || local;
  const write = setDesign || setLocal;
  const [sel, setSel] = useState(null);
  const grid = useMemo(() => gridFromTemplate(cur, byId, columnSize), [cur, byId, columnSize]);
  const edit = (f) => write(templateFromGrid(f(grid)));

  // A new search can drop units the player just un-researched. Keep the design to the units that still exist
  // so the grid does not end up with nameless counters.
  useEffect(() => {
    const alive = (id) => !id || byId.has(id);
    const dead = cur.items.some((id) => !alive(id)) || cur.support.some((id) => !alive(id)) || cur.reg.some((id) => !alive(id))
      || (cur.columns || []).some((c) => !alive(c.reg) || c.items.some((id) => !alive(id)));
    if (!dead) return;
    const keep = (id) => (alive(id) ? id : null);
    const has = (id) => byId.has(id);
    const clean = cur.columns
      ? { ...cur, support: cur.support.filter(has), columns: cur.columns.map((c) => ({ ...c, items: c.items.map(keep), reg: keep(c.reg) })) }
      : { items: cur.items.filter(has), support: cur.support.filter(has), reg: cur.reg.filter(has) };
    write(templateFromGrid(gridFromTemplate(clean, byId, columnSize)));
  }, [byId]);

  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const tpl = templateFromGrid(grid);
  const stats = tpl.items.length ? evaluate(tpl, byId, mods, opts, columnSize) : null;
  const bestStats = best?.stats;
  const tip = (where) => slotContribution(grid, where, byId, mods, opts, columnSize);

  const clear = (where) => {
    edit((g) => (where.kind === 'line' ? removeBattalion(g, where.ci, where.si) : where.kind === 'reg' ? setRegimental(g, where.ci, null) : setSupport(g, where.si, null)));
    if (sameSlot(where, sel)) setSel(null);
  };
  const choose = (u) => {
    if (sel.kind === 'line') {
      edit((g) => placeBattalion(g, sel.ci, sel.si, u));
      // Move on to the next empty slot in the column, as clicking down a column in the game does.
      const next = grid.columns[sel.ci].items.findIndex((id, i) => i > sel.si && !id);
      setSel(next >= 0 ? { kind: 'line', ci: sel.ci, si: next } : null);
    } else if (sel.kind === 'reg') {
      edit((g) => setRegimental(g, sel.ci, u.id));
      setSel(null);
    } else {
      edit((g) => setSupport(g, sel.si, u.id));
      setSel(null);
    }
  };
  const fill = (u) => { edit((g) => fillColumn(g, sel.ci, u)); setSel(null); };
  const pick = (where) => setSel((s) => (sameSlot(s, where) ? null : where));
  const slotProps = { sel, onPick: pick, onClear: clear, tip };

  return (
    <div className="manual">
      <div className="section-heading">
        <p className="note">Click a slot to add or change a unit, right-click to remove it. Each column takes one family of battalions; the bottom slot is its regimental company.</p>
        <div className="seg">
          {best && <button type="button" className="ghost" onClick={() => { setSel(null); write({ items: best.items.slice(), support: best.support.slice(), reg: (best.reg || []).slice() }); }}>Start from the best result</button>}
          {onSave && tpl.items.length > 0 && <button type="button" className="ghost" onClick={() => onSave(tpl)}>Save design</button>}
          <button type="button" className="ghost" onClick={() => { setSel(null); write({ items: [], support: [], reg: [] }); }}>Clear design</button>
        </div>
      </div>
      <div className="dz">
        <div className="tg-cols dz-grid" role="group" aria-label="Division template">
          <div className="tg-col dz-support">
            <h4>Support</h4>
            {Array.from({ length: MAX_SUPPORT }, (_, si) => (
              <Slot key={si} unit={byId.get(grid.support[si])} where={{ kind: 'support', si }} {...slotProps} />
            ))}
          </div>
          {grid.columns.map((col, ci) => {
            const n = col.items.filter(Boolean).length;
            const locked = n < REG_MIN_BATTALIONS;
            return (
              <div key={ci} className="tg-col">
                <h4>{col.type ? COLUMN_LABEL[col.type] : ' '}</h4>
                {col.items.map((id, si) => <Slot key={si} unit={byId.get(id)} where={{ kind: 'line', ci, si }} {...slotProps} />)}
                <div className="tg-reg">
                  <Slot unit={byId.get(col.reg)} where={{ kind: 'reg', ci }} locked={locked && !col.reg} lockedTitle={`Regimental support opens at ${REG_MIN_BATTALIONS} battalions`} {...slotProps} />
                </div>
              </div>
            );
          })}
        </div>
        {sel && <Picker sel={sel} grid={grid} byId={byId} line={line} reg={reg} support={support} onChoose={choose} onFill={fill} onClear={clear} onClose={() => setSel(null)} />}
      </div>
      {stats ? (
        <div className="dz-live" aria-live="polite">
          {LIVE.map(([k, label]) => <div key={k}><span>{label}</span><b>{fmt(stats[k], k)}</b></div>)}
        </div>
      ) : <p className="note">Click an empty slot to add your first battalion.</p>}
      {stats && <>
        {!stats.valid && <p className="error">This template is not valid under the current column, support-company or regimental-support rules.</p>}
        {bestStats && <div className="table-scroll"><table className="manual-table"><thead><tr><th>Stat</th><th>Your design</th><th>Best result</th><th>Difference</th></tr></thead><tbody>
          {COMPARE.map(([key, label]) => {
            // The difference only reads as good or bad against the stat's own direction (cheaper cost is better).
            const diff = stats[key] - bestStats[key];
            const dir = STAT_BY_KEY[key]?.dir ?? 1;
            const judge = Math.abs(diff) < 1e-9 ? '' : (diff > 0) === (dir > 0) ? 'better' : 'worse';
            return <tr key={key}><th>{label}</th><td>{fmt(stats[key], key)}</td><td>{fmt(bestStats[key], key)}</td><td className={judge}>{diff > 0 ? '+' : ''}{fmt(diff, key)}</td></tr>;
          })}
        </tbody></table></div>}
      </>}
    </div>
  );
}
