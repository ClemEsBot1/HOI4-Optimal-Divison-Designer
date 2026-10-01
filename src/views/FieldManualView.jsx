import React from 'react';
import Section from '../components/Section.jsx';
import { GAP_SHARE } from '../lib/optimizer.js';
import { TERRAINS } from '../lib/frontage.js';
import naval from '../data/designers.json';
import { MIN_DESIGN_RELIABILITY } from '../lib/game.js';

export default function FieldManualView({ version, meta }) {
  return (
    <div className="view-manual">
      <div className="view-head">
        <div>
          <p className="kicker">Field manual FM-01</p>
          <h1>How it works</h1>
          <p className="lede">Where the numbers come from, how the search decides, and what it leaves out.</p>
        </div>
      </div>
      <div className="two-col">
        <Section id="fm-data" kicker="Section 1" title="Data">
          <p>
            Every unit, equipment, technology, doctrine and tank module comes from the game's own files
            ({version ? `version ${version}, ` : ''}extracted {meta.generatedAt.slice(0, 10)}). {meta.assumptions.join('. ')}.
            Run <code>npm run extract -- "&lt;HOI4 folder&gt;"</code> against a new install to update it.
          </p>
          <p>Ship hulls and modules come from {naval.meta.source} (version {naval.meta.gameVersion}); refresh them with <code>node scripts/extract-designers.mjs</code>.</p>
          <p>The 18-width infantry template from an in-game screenshot is reproduced exactly (soft attack 70, defense 227.7, breakthrough 36.5, organization 50.9, 910 infantry equipment); <code>npm run check</code> keeps it that way.</p>
        </Section>
        <Section id="fm-search" kicker="Section 2" title="The search">
          <ul className="rules">
            <li>The score is the sum of priority × ln(stat) (minus that for costs), so priorities trade percentage changes: priority 6 on soft attack and 3 on cost means +10% soft attack is worth −20% cost.</li>
            <li>Limits are hard: a template that breaks one is never a candidate.</li>
            <li>Branch and bound: for each battalion count the search branches over how many of each unit to take, then over support sets and regimental fills, and drops a branch only when an upper bound proves it cannot win by more than {(GAP_SHARE * 100).toFixed(1)}%. The same setup always gives the same answer.</li>
            <li>A provisional answer appears within seconds; the status bar says when the winner is proven. Very large searches stop at a node budget and say so.</li>
            <li>Tank designs are chosen with the template: each chassis and role gets an exhaustive module search valued by what each stat is worth to the winning division, repeated until nothing changes.</li>
            <li>Ranked alternatives are the best template of each other kind of division (column types used and lead battalion).</li>
          </ul>
        </Section>
        <Section id="fm-equipment" kicker="Section 3" title="Equipment designers">
          <ul className="rules">
            <li>Tanks: every chassis that can fill a role gets an exhaustive module search with that role's priorities. Stacked reliability penalties can push a design to 0%, which in game means constant breakdowns, so a recommended design keeps at least {MIN_DESIGN_RELIABILITY * 100}% reliability whenever any legal design can.</li>
            <li>Ships: a stat is (hull + modules + the average of averaged modules) × (1 + module multipliers) × (1 + naval technology for the ship type). Each role scores the sum of priority × ln(stat), so it trades percentages like the division search.</li>
            <li>The ship search is exact. At every step it bounds the best finish of the partial design: each maximized stat is replaced by its tangent at the best design so far, each minimized stat (cost, visibility) by its chord, and the product of added and multiplied amounts by its envelope. The bound then splits slot by slot, so each remaining slot can take its own best module, and whole branches are dropped without scoring them.</li>
          </ul>
        </Section>
        <Section id="fm-rules" kicker="Section 4" title="Rules as implemented">
          <ul className="rules">
            <li>Up to five columns; infantry, artillery, mobile, mobile artillery and armor use separate columns of five battalions (more with doctrine milestones).</li>
            <li>A column needs three battalions before it takes a regimental support company; battalion groups are planned to unlock regimental slots (ten infantry show as 3-3-3-1).</li>
            <li>Attack, defense, breakthrough, hit points, cost, manpower and supply are summed. Organization and recovery are averaged over battalions and support companies. Armor and piercing are 30% of the best line battalion plus 70% of the average; hardness and reliability are averaged. Speed is the slowest line battalion.</li>
            <li>Unit stats are the sum of the equipment each unit needs times one plus unit, technology and doctrine bonuses.</li>
            <li>Support companies can lift whole categories of battalions (recon companies lift artillery, for example). One company per type, up to five.</li>
            <li>The opponent matchup compares how fast each side breaks the other on the same frontage: attacks against hardness, defense or breakthrough blocking, and half damage when armor beats piercing. Terrain, entrenchment, planning and air are left out.</li>
          </ul>
        </Section>
        <Section id="fm-theatre" kicker="Section 5" title="Theatres and frontage">
          <p>A battle's combat width depends on the terrain, plus an extra amount for each extra attack direction. A division width that does not divide it evenly leaves part of the frontage empty. The theatre menu scores every width by how much of its frontage whole divisions fill, averaged over the theatre's terrain and one- and two-direction attacks, and can restrict the search to widths that fit well.</p>
          <div className="table-scroll">
            <table className="rank compact">
              <thead><tr><th scope="col">Terrain</th><th scope="col">Width</th><th scope="col">Per extra direction</th></tr></thead>
              <tbody>{TERRAINS.map((t) => <tr key={t.id}><td className="txt">{t.name}</td><td>{t.width}</td><td>+{t.extra}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="note">Values from the Barbarossa update; check them in game if a later patch has changed them. Going over the combat width, which the game allows with a penalty, is not modelled.</p>
        </Section>
        <Section id="fm-limits" kicker="Section 6" title="Known limits">
          <ul className="rules">
            <li>Not verified against the game: the exact regimental-company scaling for every stat, which column types each company can attach to, and whether doctrine supply bonuses are fractions of a unit's supply.</li>
            <li>Not modelled: national focus technologies, leaders, terrain modifiers on attack, entrenchment, the land cruiser, flame tanks, amphibious tank roles and hand-editing a tank design.</li>
            <li>Aircraft designs are a role guide until the aircraft designer files are extracted.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
