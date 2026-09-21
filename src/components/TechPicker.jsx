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
  const layout = useMemo(() => {
    if (!positioned.length) return null;
    const xs = positioned.map((t) => t.x.x);
    const minX = Math.min(...xs);
    const ys = [...new Set(positioned.map((t) => t.x.y))].sort((a, b) => a - b);
    return { minX, cols: Math.max(...xs) - minX + 1, rowOf: new Map(ys.map((y, i) => [y, i + 1])) };
  }, [positioned]);

  const positionedIds = new Set(positioned.map((t) => t.id));
  const edges = positioned.flatMap((t) => t.parents
    .map((p) => game.techs.get(p))
    .filter((p) => p && positionedIds.has(p.id))
    .map((p) => ({ from: p, to: t })));
  const rows = layout ? layout.rowOf.size : 0;
  const rowYears = layout ? [...layout.rowOf.entries()].map(([y, row]) => ({ row, year: Math.min(...positioned.filter((t) => t.x.y === y).map((t) => t.year || 0).filter(Boolean)) })) : [];
  return (
    <>
      {layout && (
        <div className={`tp-tree-wrap tp-folder-${folder}`} style={{ '--tp-cols': layout.cols, '--tp-rows': rows }}>
          <div className="tp-years tp-years-left" aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={{ top: `${(x.row - 1) * 5.5 + 1.4}rem` }}>{x.year}</span>)}</div>
          <div className="tp-years tp-years-right" aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={{ top: `${(x.row - 1) * 5.5 + 1.4}rem` }}>{x.year}</span>)}</div>
          <svg className="tp-lines" viewBox={`0 0 ${layout.cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
            {edges.map(({ from, to }) => (
              <path key={`${from.id}-${to.id}`} d={`M ${from.x.x - layout.minX + .5} ${layout.rowOf.get(from.x.y) - .5} H ${to.x.x - layout.minX + .5} V ${layout.rowOf.get(to.x.y) - .5}`} />
            ))}
          </svg>
          <div className="tp-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 4.6rem)`, gridTemplateRows: `repeat(${rows}, 5.5rem)` }}>
            {positioned.map((t) => (
              <div key={t.id} className="tp-cell" style={{ gridColumn: t.x.x - layout.minX + 1, gridRow: layout.rowOf.get(t.x.y) }}>
                <TechCard game={game} tech={t} techs={techs} toggle={toggle} dim={!matches(t)} />
              </div>
            ))}
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

const TECH_ICON = {
  gwtank_chassis: 'gwtank', basic_light_tank_chassis: 'basic_light_tank', improved_light_tank_chassis: 'improved_light_tank',
  basic_medium_tank_chassis: 'basic_medium_tank', improved_medium_tank_chassis: 'improved_medium_tank', advanced_medium_tank_chassis: 'advanced_medium_tank',
  main_battle_tank_chassis: 'main_battle_tank', basic_heavy_tank_chassis: 'basic_heavy_tank', improved_heavy_tank_chassis: 'improved_heavy_tank',
  advanced_heavy_tank_chassis: 'advanced_heavy_tank', super_heavy_tank_chassis: 'super_heavy_tank',
  armor_tech_1: 'nsb_armor_tech_1', armor_tech_2: 'nsb_armor_tech_2', armor_tech_3: 'nsb_armor_tech_3', armor_tech_4: 'nsb_armor_tech_4',
  engine_tech_1: 'nsb_engine_tech_1', engine_tech_2: 'nsb_engine_tech_2', engine_tech_3: 'nsb_engine_tech_3', engine_tech_4: 'nsb_engine_tech_4',
  infantry_weapons1: 'infantry1', improved_infantry_weapons: 'infantry_weapons', improved_infantry_weapons_2: 'infantry_weapons2',
  advanced_infantry_weapons: 'infantry3', advanced_infantry_weapons2: 'infantry3',
  tech_engineers: 'engineers', tech_engineers2: 'engineers2', tech_engineers3: 'engineers3', tech_engineers4: 'engineers4',
  tech_recon: 'recon', tech_recon2: 'recon2', tech_recon3: 'recon3', tech_recon4: 'recon4',
  tech_trucks: 'motorized_equipment_0', tech_support: 'support_equipment_1',
};

function TechCard({ game, tech, techs, toggle, dim }) {
  const on = techs.has(tech.id);
  const [iconFailed, setIconFailed] = useState(false);
  const icon = `/hoi4/technologies/${TECH_ICON[tech.id] || tech.id}.png`;
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
        {!iconFailed && <img className="tp-icon" src={icon} alt="" onError={() => setIconFailed(true)} />}
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
