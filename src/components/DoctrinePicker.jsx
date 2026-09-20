import React from 'react';
import { rewardCount } from '../lib/game.js';
import { describeReward, describeMods } from '../lib/describe.js';
import './TechPicker.css';

const FOLDERS = [
  { id: 'land', label: 'Land doctrine' },
  { id: 'special_forces', label: 'Special forces doctrine' },
];

/** Pick a grand doctrine per folder, then a subdoctrine per track and how many of its rewards are unlocked. */
export default function DoctrinePicker({ game, doctrine, setDoctrine }) {
  const slotCount = doctrine.slotCount || 1;
  const grandIn = (folder) => doctrine.grands.find((g) => game.grands.get(g)?.folder === folder) || '';

  const setGrand = (folder, gid) => setDoctrine((d) => {
    const oldId = d.grands.find((g) => game.grands.get(g)?.folder === folder);
    const slots = { ...d.slots };
    if (oldId) for (const t of game.grands.get(oldId).tracks) delete slots[t];
    const grands = d.grands.filter((g) => g !== oldId).concat(gid ? [gid] : []);
    return { ...d, grands, slots };
  });

  const setSlot = (track, i, subId) => setDoctrine((d) => {
    const cur = (d.slots[track] || []).slice();
    cur[i] = subId || undefined;
    return { ...d, slots: { ...d.slots, [track]: cur.filter(Boolean) } };
  });

  const setProgress = (subId, n) => setDoctrine((d) => ({ ...d, progress: { ...d.progress, [subId]: n } }));

  return (
    <div className="dp">
      <p className="note">Each grand doctrine has tracks. Slot a subdoctrine into a track and choose how many of its rewards you have unlocked. Finishing every reward on a track also earns that track's milestone.</p>
      <label className="dp-field">Subdoctrines per track
        <select value={slotCount} onChange={(e) => setDoctrine((d) => ({ ...d, slotCount: Number(e.target.value) }))}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {FOLDERS.map((f) => {
        const gid = grandIn(f.id);
        const grand = gid && game.grands.get(gid);
        const options = [...game.grands.values()].filter((g) => g.folder === f.id);
        if (!options.length) return null;
        return (
          <fieldset key={f.id} className="dp-folder">
            <legend>{f.label}</legend>
            <select value={gid} onChange={(e) => setGrand(f.id, e.target.value)} aria-label={f.label}>
              <option value="">None</option>
              {options.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {grand && grand.mods.length > 0 && <p className="note">{describeMods(game, grand.mods).join('; ')}</p>}
            {grand && grand.tracks.map((track) => (
              <TrackSlots key={track} game={game} doctrine={doctrine} track={track} grand={grand}
                slotCount={slotCount} setSlot={setSlot} setProgress={setProgress} />
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

function TrackSlots({ game, doctrine, track, grand, slotCount, setSlot, setProgress }) {
  const chosen = doctrine.slots[track] || [];
  const options = [...game.subs.values()].filter((s) => s.tracks.includes(track));
  const milestone = grand.milestones.find((m) => m.track === track);
  const complete = chosen.some((sid) => { const s = game.subs.get(sid); return s && rewardCount(game, sid, doctrine) >= s.rewards.length; });
  const trackName = game.tracks[track]?.name || track.replace(/_/g, ' ');
  return (
    <div className="dp-track">
      <h4>{trackName}</h4>
      {Array.from({ length: slotCount }, (_, i) => {
        const sid = chosen[i] || '';
        const sub = sid && game.subs.get(sid);
        const n = sub ? rewardCount(game, sid, doctrine) : 0;
        return (
          <div key={i} className="dp-slot">
            <select value={sid} onChange={(e) => setSlot(track, i, e.target.value)} aria-label={`${trackName} subdoctrine ${i + 1}`}>
              <option value="">Empty</option>
              {options.filter((o) => o.id === sid || !chosen.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {sub && (
              <>
                <label className="dp-progress">Rewards unlocked
                  <select value={n} onChange={(e) => setProgress(sid, Number(e.target.value))}>
                    {Array.from({ length: sub.rewards.length + 1 }, (_, k) => <option key={k} value={k}>{k === sub.rewards.length ? `All ${k}` : k}</option>)}
                  </select>
                </label>
                {sub.mods.length > 0 && <p className="note">{describeMods(game, sub.mods).join('; ')}</p>}
                <ol className="dp-rewards">
                  {sub.rewards.map((r, k) => {
                    const lines = describeReward(game, r);
                    return (
                      <li key={r.id} className={k < n ? 'on' : ''}>
                        <span>{r.name}</span>
                        {lines.length > 0 && <small>{lines.join('; ')}</small>}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
        );
      })}
      {milestone && (milestone.mods.length > 0 || milestone.extra.additional_brigade_column_size) && (
        <p className={'note dp-milestone' + (complete ? ' on' : '')}>
          Track milestone{complete ? ' (earned)' : ''}: {[...describeMods(game, milestone.mods), milestone.extra.additional_brigade_column_size ? `columns hold ${5 + milestone.extra.additional_brigade_column_size} battalions` : ''].filter(Boolean).join('; ')}
        </p>
      )}
    </div>
  );
}
