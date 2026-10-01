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

/** Research-year presets. */
export function TechPresets({ game, techs, setTechs }) {
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
    </>
  );
}

/** Presets plus a full-screen tree editor (kept for embedding elsewhere). */
export default function TechPicker({ game, techs, setTechs }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TechPresets game={game} techs={techs} setTechs={setTechs} />
      <button type="button" className="ghost tp-open" onClick={() => setOpen(true)}>Edit the tech tree</button>
      {open && <TechTree game={game} techs={techs} setTechs={setTechs} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The technology tree. `inline` renders it in the page; otherwise it is a full-screen dialog. */
export function TechTree({ game, techs, setTechs, onClose, inline = false }) {
  const [tab, setTab] = useState(TABS[0].id);
  const [query, setQuery] = useState('');
  const [researchSummary, setResearchSummary] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (inline) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (closeRef.current) closeRef.current.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, inline]);

  const byTab = useMemo(() => {
    const m = new Map(TABS.map((t) => [t.id, []]));
    for (const t of game.techs.values()) {
      const key = m.has(t.folder) ? t.folder : '__other';
      m.get(key).push(t);
    }
    return m;
  }, [game]);

  const toggle = (id) => {
    setResearchSummary(null);
    setTechs((cur) => {
      const tech = game.techs.get(id);
      if (tech?.special && !cur.has(id)) return cur;
      return cur.has(id) ? unresearchTech(game, cur, id) : researchTech(game, cur, id);
    });
  };
  const tabTechs = byTab.get(tab) || [];
  const q = query.trim().toLowerCase();
  const matches = (t) => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  const matchingCount = tabTechs.filter(matches).length;

  const researchTab = () => {
    const candidates = tabTechs.filter(matches);
    const candidateIds = new Set(candidates.filter((t) => !t.special).map((t) => t.id));
    let next = new Set(techs);
    let queued = 0;
    let prerequisites = 0;
    let already = 0;
    let skippedSpecial = 0;
    let skippedExclusive = 0;

    for (const t of candidates) {
      if (t.special) {
        if (next.has(t.id)) already++;
        else skippedSpecial++;
        continue;
      }
      if (next.has(t.id)) { already++; continue; }
      // Avoid choosing one side of an XOR pair just because it appears first in the data.
      const conflictsWithCandidate = candidates.some((other) => candidateIds.has(other.id) && other.id !== t.id
        && (t.xor.includes(other.id) || other.xor.includes(t.id)));
      if (t.xor.some((id) => next.has(id)) || conflictsWithCandidate) { skippedExclusive++; continue; }
      const researched = researchTech(game, next, t.id);
      if (!researched.has(t.id) || [...next].some((id) => !researched.has(id)) || [...researched].some((id) => {
        const added = !next.has(id) ? game.techs.get(id) : null;
        return added?.special;
      })) {
        // Never silently replace an existing exclusive choice or remove its dependants during batch research.
        skippedExclusive++;
        continue;
      }
      queued++;
      for (const id of researched) if (!next.has(id) && id !== t.id) prerequisites++;
      next = researched;
    }

    setResearchSummary({ queued, prerequisites, already, skippedSpecial, skippedExclusive });
    setTechs(next);
  };
  const clearTab = () => {
    setResearchSummary(null);
    setTechs((cur) => {
      let s = cur;
      for (const t of tabTechs) if (s.has(t.id)) s = unresearchTech(game, s, t.id);
      return s;
    });
  };
  const clearEverything = () => {
    setResearchSummary(null);
    setTechs(new Set([...techs].filter((id) => game.techs.get(id)?.special)));
  };

  return (
    <div className={inline ? 'tp-inline' : 'tp-overlay'} role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-label="Technology tree">
      <div className="tp-panel">
        <header className="tp-head">
          <h2>{inline ? 'Tree' : 'Technology'}</h2>
          <input type="search" className="tp-search" placeholder="Find a technology" value={query} onChange={(e) => { setQuery(e.target.value); setResearchSummary(null); }} aria-label="Find a technology" />
          <button type="button" className="ghost" onClick={researchTab}>{q ? 'Research matching technologies' : 'Research all in this tab'}</button>
          <button type="button" className="ghost" onClick={clearTab}>Clear this tab</button>
          <button type="button" className="ghost" onClick={clearEverything}>Clear everything</button>
          {!inline && <button type="button" ref={closeRef} onClick={onClose}>Done</button>}
        </header>
        <div className="tp-tabs" role="tablist">
          {TABS.filter((t) => (byTab.get(t.id) || []).length).map((t) => {
            const list = byTab.get(t.id);
            const n = list.filter((x) => techs.has(x.id)).length;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setResearchSummary(null); }}>
                {t.label} <span className="tp-tabcount">{n}/{list.length}</span>
              </button>
            );
          })}
        </div>
        <p className="note tp-hint">Click a technology to research it together with anything it needs. Click a researched one to remove it and everything that depends on it. Techs marked “special project” come from the special projects system rather than normal research.</p>
        {researchSummary && <p className="note tp-research-status" role="status">
          Queued {researchSummary.queued} {researchSummary.queued === 1 ? 'technology' : 'technologies'}; added {researchSummary.prerequisites} {researchSummary.prerequisites === 1 ? 'prerequisite' : 'prerequisites'}.
          {researchSummary.already > 0 ? ` ${researchSummary.already} already researched.` : ''}
          {researchSummary.skippedSpecial > 0 ? ` ${researchSummary.skippedSpecial} special-project ${researchSummary.skippedSpecial === 1 ? 'technology was' : 'technologies were'} skipped.` : ''}
          {researchSummary.skippedExclusive > 0 ? ` ${researchSummary.skippedExclusive} mutually exclusive or conflicting ${researchSummary.skippedExclusive === 1 ? 'technology was' : 'technologies were'} skipped without replacing existing research.` : ''}
        </p>}
        <div className="tp-scroll">
          {q && matchingCount === 0
            ? <p className="note tp-no-matches" role="status">No technologies in this tab match “{query.trim()}”. Try another search or clear the search field.</p>
            : <>
              {q && <p className="note tp-match-count" role="status">{matchingCount} {matchingCount === 1 ? 'technology matches' : 'technologies match'} “{query.trim()}”. Other technologies are dimmed.</p>}
              <TreeGrid game={game} list={tabTechs} folder={tab} techs={techs} toggle={toggle} matches={matches} />
            </>}
        </div>
      </div>
    </div>
  );
}

function TreeGrid({ game, list, folder, techs, toggle, matches }) {
  const positioned = list.filter((t) => t.x && !t.subOf);
  const loose = list.filter((t) => (!t.x && !t.subOf));
  const hasMatchingSub = (tech) => tech.subs.some((id) => {
    const sub = game.techs.get(id);
    return sub && matches(sub);
  });

  // Preserve each branch's lane when the extracted data assigns multiple technologies to one cell.
  const posOf = useMemo(() => {
    const map = new Map();
    const laneOf = new Map();
    const taken = new Set(positioned.map((t) => `${t.x.x},${t.x.y}`));
    const groups = new Map();
    for (const t of positioned) {
      const key = `${t.x.x},${t.x.y}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const orderedGroups = [...groups.values()].sort((a, b) =>
      (a[0].x.y - b[0].x.y) || (a[0].x.x - b[0].x.x));

    for (const group of orderedGroups) {
      const ranked = group.map((t) => {
        const parentLanes = t.parents.map((id) => laneOf.get(id)).filter(Number.isFinite);
        return { tech: t, parentLane: parentLanes.length ? Math.min(...parentLanes) : null };
      }).sort((a, b) => {
        if (a.parentLane !== null && b.parentLane !== null) return (a.parentLane - b.parentLane) || a.tech.id.localeCompare(b.tech.id);
        if (a.parentLane !== null) return -1;
        if (b.parentLane !== null) return 1;
        return a.tech.id.localeCompare(b.tech.id);
      });
      const { x, y: y0 } = group[0].x;
      let y = y0;
      for (let i = 0; i < ranked.length; i++) {
        const { tech, parentLane } = ranked[i];
        if (i > 0) do { y += 2; } while (taken.has(`${x},${y}`));
        if (i > 0) taken.add(`${x},${y}`);
        map.set(tech.id, { x, y });
        laneOf.set(tech.id, parentLane ?? i);
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
  const yearsStyle = { height: `${rows * 6 + 1.5}rem` };
  const yearStyle = (row) => ({ top: `${(row - 1) * 6 + 4.85}rem` });
  return (
    <>
      {layout && (
        <div className={`tp-tree-wrap tp-folder-${folder}`} style={{ '--tp-cols': layout.cols, '--tp-rows': rows }}>
          <div className="tp-years tp-years-left" style={yearsStyle} aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={yearStyle(x.row)}>{x.year}</span>)}</div>
          <div className="tp-years tp-years-right" style={yearsStyle} aria-hidden="true">{rowYears.map((x) => <span key={x.row} style={yearStyle(x.row)}>{x.year}</span>)}</div>
          <div className="tp-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 5.2rem)`, gridTemplateRows: `repeat(${rows}, 6rem)`, paddingTop: '1.5rem' }}>
            <svg className="tp-lines" style={{ '--tp-cols': layout.cols, '--tp-rows': rows }} viewBox={`0 0 ${layout.cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
              {edges.map(({ from, to }) => {
                const fp = posOf.get(from.id); const tp = posOf.get(to.id);
                const x1 = fp.x - layout.minX + .5; const y1 = fp.y - layout.minY + .5;
                const x2 = tp.x - layout.minX + .5; const y2 = tp.y - layout.minY + .5;
                return <path key={`${from.id}-${to.id}`} d={`M ${x1} ${y1} H ${x2} V ${y2}`} />;
              })}
            </svg>
            {positioned.map((t) => {
              const p = posOf.get(t.id);
              // Bottom rows open their tooltip upwards so it stays inside the tree instead of being cut off.
              const tipUp = rows - (p.y - layout.minY) <= 3;
              return (
                <div key={t.id} className={'tp-cell' + (tipUp ? ' tip-up' : '')} style={{ gridColumn: p.x - layout.minX + 1, gridRow: p.y - layout.minY + 1 }}>
                  <TechCard game={game} tech={t} techs={techs} toggle={toggle} dim={!matches(t) && !hasMatchingSub(t)} matches={matches} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {loose.length > 0 && (
        <div className={'tp-loose' + (layout ? ' tip-up' : '')}>
          {loose.map((t) => <TechCard key={t.id} game={game} tech={t} techs={techs} toggle={toggle} dim={!matches(t) && !hasMatchingSub(t)} matches={matches} />)}
        </div>
      )}
    </>
  );
}

function TechCard({ game, tech, techs, toggle, dim, matches }) {
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
    tech.special ? 'Special project — unlock through the special projects system' : `Year ${tech.year}`,
    parents.length ? `Needs: ${parents.join(' or ')}` : 'No prerequisites',
    tech.xor.length ? `Excludes: ${tech.xor.map((x) => game.techs.get(x)?.name).filter(Boolean).join(', ')}` : '',
    ...lines,
  ].filter(Boolean).join('\n');
  return (
    <div className={`tp-card ${state}${dim ? ' dim' : ''}`}>
      <button type="button" className="tp-main" aria-label={title} aria-pressed={on} onClick={() => toggle(tech.id)} title={title} disabled={blocked || (tech.special && !on)}>
        {!iconFailed && <img className="tp-icon" src={icon} alt="" onError={(e) => { if (e.currentTarget.src.endsWith(fallbackIcon)) setIconFailed(true); else e.currentTarget.src = fallbackIcon; }} />}
      </button>
      <span className="tp-label" title={tech.name}>{tech.name}</span>
      <div className="tp-tooltip" role="tooltip"><strong>{tech.name}</strong><small>{tech.special ? 'Unlock through the special projects system' : tech.year}</small>{lines.length > 0 && <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
      {subs.length > 0 && (
        <div className="tp-subs">
          {subs.map((s) => (
            <button key={s.id} type="button" className={'tp-sub' + (techs.has(s.id) ? ' on' : '') + (matches(s) ? '' : ' dim')} aria-label={s.name} aria-pressed={techs.has(s.id)}
              onClick={() => toggle(s.id)} title={[s.name, s.special ? 'Unlock through the special projects system' : '', ...describeTech(game, s)].filter(Boolean).join('\n')} disabled={s.special && !techs.has(s.id)}>{s.name.slice(0, 2)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
