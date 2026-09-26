import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canResearch, researchTech, unresearchTech } from '../lib/game.js';
import { describeTech } from '../lib/describe.js';
import { TECH_PRESETS, techPreset, sameSet } from '../lib/presets.js';
import './TechPicker.css';

const TABS = [
  { id: 'infantry_folder', label: 'Infantry' },
  { id: 'support_folder', label: 'Support' },
  { id: 'artillery_folder', label: 'Artillery' },
  { id: 'armour_folder', label: 'Tank chassis' },
  { id: 'nsb_armour_folder', label: 'Tank upgrades' },
  { id: 'electronics_folder', label: 'Electronics' },
  { id: '__other', label: 'Other' },
];

/** Presets in the sidebar plus a full-screen tree editor. */
export default function TechPicker({ game, techs, setTechs }) {
  const [open, setOpen] = useState(false);
  const preset = useMemo(() => TECH_PRESETS.find((p) => sameSet(techs, techPreset(game, p.year))), [game, techs]);
  return (
    <>
      <div className="seg" role="group" aria-label="Technology presets">
        {TECH_PRESETS.map((p) => (
          <button key={p.year} type="button" className={preset && preset.year === p.year ? 'on' : ''}
            aria-pressed={!!preset && preset.year === p.year} onClick={() => setTechs(techPreset(game, p.year))}>{p.label}</button>
        ))}
      </div>
      <p className="note tp-count">{techs.size} of {game.techs.size} technologies researched{preset ? '' : ' (custom)'}.</p>
      <button type="button" className="ghost tp-open" onClick={() => setOpen(true)}>Edit the tech tree</button>
      {open && <TreeDialog game={game} techs={techs} setTechs={setTechs} onClose={() => setOpen(false)} />}
    </>
  );
}

function TreeDialog({ game, techs, setTechs, onClose }) {
  const [tab, setTab] = useState(TABS[0].id);
  const [query, setQuery] = useState('');
  const closeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (closeRef.current) closeRef.current.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const byTab = useMemo(() => {
    const m = new Map(TABS.map((t) => [t.id, []]));
    for (const t of game.techs.values()) {
      const key = m.has(t.folder) ? t.folder : '__other';
      m.get(key).push(t);
    }
    return m;
  }, [game]);

  const toggle = (id) => setTechs((cur) => (cur.has(id) ? unresearchTech(game, cur, id) : researchTech(game, cur, id)));
  const tabTechs = byTab.get(tab) || [];
  const q = query.trim().toLowerCase();
  const matches = (t) => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);

  const researchTab = () => setTechs((cur) => {
    let s = cur;
    for (const t of tabTechs.filter((x) => !x.special && matches(x))) if (!s.has(t.id) && !t.xor.some((x) => s.has(x))) s = researchTech(game, s, t.id);
    return s;
  });
  const clearTab = () => setTechs((cur) => {
    let s = cur;
    for (const t of tabTechs) if (s.has(t.id)) s = unresearchTech(game, s, t.id);
    return s;
  });

  return (
    <div className="tp-overlay" role="dialog" aria-modal="true" aria-label="Technology tree">
      <div className="tp-panel">
        <header className="tp-head">
          <h2>Technology</h2>
          <input type="search" className="tp-search" placeholder="Find a technology" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a technology" />
          <button type="button" className="ghost" onClick={researchTab}>Research all in this tab</button>
          <button type="button" className="ghost" onClick={clearTab}>Clear this tab</button>
          <button type="button" className="ghost" onClick={() => setTechs(new Set())}>Clear everything</button>
          <button type="button" ref={closeRef} onClick={onClose}>Done</button>
        </header>
        <div className="tp-tabs" role="tablist">
          {TABS.filter((t) => (byTab.get(t.id) || []).length).map((t) => {
            const list = byTab.get(t.id);
            const n = list.filter((x) => techs.has(x.id)).length;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label} <span className="tp-tabcount">{n}/{list.length}</span>
              </button>
            );
          })}
        </div>
        <p className="note tp-hint">Click a technology to research it together with anything it needs. Click a researched one to remove it and everything that depends on it. Techs marked “special project” come from the special projects system rather than normal research.</p>
        <div className="tp-scroll">
          <TreeGrid game={game} list={tabTechs} folder={tab} techs={techs} toggle={toggle} matches={matches} />
        </div>
      </div>
    </div>
  );
}

function TreeGrid({ game, list, folder, techs, toggle, matches }) {
  const positioned = list.filter((t) => t.x && !t.subOf);
  const loose = list.filter((t) => (!t.x && !t.subOf));

  // Some techs (most visibly the four Special Forces branches in the Infantry tab: paratroopers, marines,
  // mountaineers, rangers) come out of the extractor sharing the exact same cell, because the source file
  // carries more than one folder/position block for them and only the first was kept. Real placement has each
  // on its own row. Rather than guess the game's true layout, deterministically spread same-cell techs onto
  // free rows below their shared column, in stable (id) order, so nothing silently overlaps.
  const posOf = useMemo(() => {
    const map = new Map();
    const taken = new Set(positioned.map((t) => `${t.x.x},${t.x.y}`));
    const groups = new Map();
    for (const t of [...positioned].sort((a, b) => a.id.localeCompare(b.id))) {
      const key = `${t.x.x},${t.x.y}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const group of groups.values()) {
      const { x, y: y0 } = group[0].x;
      map.set(group[0].id, { x, y: y0 });
      let y = y0;
      for (let i = 1; i < group.length; i++) {
        do { y += 2; } while (taken.has(`${x},${y}`));
        taken.add(`${x},${y}`);
        map.set(group[i].id, { x, y });
      }
    }
    return map;
  }, [positioned]);

  const layout = useMemo(() => {
    if (!positioned.length) return null;
    const pts = positioned.map((t) => posOf.get(t.id));
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    return { minX, minY, cols: Math.max(...pts.map((p) => p.x)) - minX + 1, rows: Math.max(...pts.map((p) => p.y)) - minY + 1 };
  }, [positioned, posOf]);

  const positionedIds = new Set(positioned.map((t) => t.id));
  const edges = positioned.flatMap((t) => t.parents
    .map((p) => game.techs.get(p))
    .filter((p) => p && positionedIds.has(p.id))
    .map((p) => ({ from: p, to: t })));
  const rows = layout ? layout.rows : 0;
  const rowYears = layout
    ? [...new Set(positioned.map((t) => posOf.get(t.id).y))].map((y) => ({
        row: y - layout.minY + 1,
        year: Math.min(...positioned.filter((t) => posOf.get(t.id).y === y).map((t) => t.year || 0).filter(Boolean)),
      }))
    : [];
  return (
    <>
      {layout && (
        <div className={`tp-tree-wrap tp-folder-${folder}`} style={{ '--tp-cols': layout.cols, '--tp-rows': rows }}>
          <div className="tp-years tp-years-left" aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={{ top: `${(x.row - 1) * 6 + 1.4}rem` }}>{x.year}</span>)}</div>
          <div className="tp-years tp-years-right" aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={{ top: `${(x.row - 1) * 6 + 1.4}rem` }}>{x.year}</span>)}</div>
          <svg className="tp-lines" viewBox={`0 0 ${layout.cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
            {edges.map(({ from, to }) => {
              const fp = posOf.get(from.id); const tp = posOf.get(to.id);
              return <path key={`${from.id}-${to.id}`} d={`M ${fp.x - layout.minX + .5} ${fp.y - layout.minY + .5} H ${tp.x - layout.minX + .5} V ${tp.y - layout.minY + .5}`} />;
            })}
          </svg>
          <div className="tp-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 5.2rem)`, gridTemplateRows: `repeat(${rows}, 6rem)`, paddingTop: '1.5rem' }}>
            {positioned.map((t) => {
              const p = posOf.get(t.id);
              return (
                <div key={t.id} className="tp-cell" style={{ gridColumn: p.x - layout.minX + 1, gridRow: p.y - layout.minY + 1 }}>
                  <TechCard game={game} tech={t} techs={techs} toggle={toggle} dim={!matches(t)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {loose.length > 0 && (
        <div className="tp-loose">
          {loose.map((t) => <TechCard key={t.id} game={game} tech={t} techs={techs} toggle={toggle} dim={!matches(t)} />)}
        </div>
      )}
    </>
  );
}

function TechCard({ game, tech, techs, toggle, dim }) {
  const on = techs.has(tech.id);
  const [iconFailed, setIconFailed] = useState(false);
  const fallback = tech.folder === 'artillery_folder' ? 'artillery1' : tech.folder === 'support_folder' ? 'support_weapons' : tech.folder === 'armour_folder' || tech.folder === 'nsb_armour_folder' ? 'basic_medium_tank' : tech.folder === 'electronics_folder' ? 'radio' : 'infantry_weapons';
  const icon = `/hoi4/technologies/${tech.id}.png`;
  const fallbackIcon = `/hoi4/technologies/${fallback}.png`;
  const open = canResearch(game, techs, tech.id);
  const blocked = !on && tech.xor.some((x) => techs.has(x));
  const lines = useMemo(() => describeTech(game, tech), [game, tech]);
  const subs = tech.subs.map((s) => game.techs.get(s)).filter(Boolean);
  const state = on ? 'on' : blocked ? 'blocked' : open ? 'open' : 'locked';
  const parents = tech.parents.map((p) => game.techs.get(p)?.name).filter(Boolean);
  const title = [
    tech.name,
    tech.special ? 'Special project' : `Year ${tech.year}`,
    parents.length ? `Needs: ${parents.join(' or ')}` : 'No prerequisites',
    tech.xor.length ? `Excludes: ${tech.xor.map((x) => game.techs.get(x)?.name).filter(Boolean).join(', ')}` : '',
    ...lines,
  ].filter(Boolean).join('\n');
  return (
    <div className={`tp-card ${state}${dim ? ' dim' : ''}`}>
      <button type="button" className="tp-main" aria-label={title} aria-pressed={on} onClick={() => toggle(tech.id)} title={title} disabled={blocked}>
        {!iconFailed && <img className="tp-icon" src={icon} alt="" onError={(e) => { if (e.currentTarget.src.endsWith(fallbackIcon)) setIconFailed(true); else e.currentTarget.src = fallbackIcon; }} />}
      </button>
      <div className="tp-tooltip" role="tooltip"><strong>{tech.name}</strong><small>{tech.special ? 'Special project' : tech.year}</small>{lines.length > 0 && <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
      {subs.length > 0 && (
        <div className="tp-subs">
          {subs.map((s) => (
            <button key={s.id} type="button" className={'tp-sub' + (techs.has(s.id) ? ' on' : '')} aria-label={s.name} aria-pressed={techs.has(s.id)}
              onClick={() => toggle(s.id)} title={[s.name, ...describeTech(game, s)].join('\n')}>{s.name.slice(0, 2)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
