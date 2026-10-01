import React from 'react';
import Section from '../components/Section.jsx';
import DoctrinePicker from '../components/DoctrinePicker.jsx';
import { doctrineIcon } from '../lib/icons.js';

const DOCTRINE_ICON = { new_mobile_warfare: 'mob_warfare_bg', superior_firepower: 'sup_firepower_bg', grand_battleplan: 'grand_battleplan_bg', mass_assault: 'mass_assault_bg' };

export default function DoctrineView({ game, doctrine, setDoctrine, recommendations, roleName }) {
  return (
    <div className="view-doctrine">
      <div className="view-head">
        <div>
          <p className="kicker">General staff</p>
          <h1>Doctrine</h1>
          <p className="lede">Doctrines change unit stats and, through some milestones, how many battalions a column holds. The designer uses whatever you set here.</p>
        </div>
      </div>
      <div className="two-col">
        <Section id="dc-recs" kicker={roleName ? `For ${roleName}` : 'Recommendations'} title="Recommended doctrines">
          {recommendations.length ? (
            <div className="doctrine-recs">
              {recommendations.map((r, i) => (
                <article key={r.doctrine.id} className={'doctrine-rec' + (i === 0 ? ' primary' : '')}>
                  <div className="rec-kicker">{i === 0 ? 'Primary recommendation' : 'Alternative'}</div>
                  <img className="doctrine-icon" src={DOCTRINE_ICON[r.doctrine.id] ? `/hoi4/icons/${DOCTRINE_ICON[r.doctrine.id]}.png` : doctrineIcon(r.doctrine.id) || '/hoi4/icons/grand_battleplan_bg.png'} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <strong>{r.doctrine.name}</strong>
                  <p>{r.why}</p>
                </article>
              ))}
            </div>
          ) : <p className="note">Pick a role in the designer to see doctrine guidance.</p>}
        </Section>
        <Section id="dc-setup" kicker="Grand doctrine and subdoctrines" title="Doctrine setup">
          <DoctrinePicker game={game} doctrine={doctrine} setDoctrine={setDoctrine} />
        </Section>
      </div>
    </div>
  );
}
