import React from 'react';
import { fmt } from '../lib/stats.js';
import { moduleIcon } from '../lib/icons.js';

const ROLE_LABEL = { armor: 'Standard armor', anti_tank: 'Tank destroyer', anti_air: 'Anti-air', artillery: 'Self-propelled artillery' };
const CHASSIS_ICON = {
  light_tank_chassis: 'basic_light_tank_chassis', medium_tank_chassis: 'basic_medium_tank_chassis',
  heavy_tank_chassis: 'basic_heavy_tank_chassis', super_heavy_tank_chassis: 'super_heavy_tank_chassis',
  modern_tank_chassis: 'main_battle_tank_chassis', amphibious_tank_chassis: 'amphibious_tank',
};
const SLOT_ABBR = {
  turret_type_slot: 'TUR', main_armament_slot: 'GUN', suspension_type_slot: 'SUS', armor_type_slot: 'ARM',
  engine_type_slot: 'ENG', radio_type_slot: 'RAD', fuel_type_slot: 'FUEL',
};

export function TdPanel({ title, rows }) {
  return (
    <div className="td-panel">
      <h4>{title}</h4>
      <dl>
        {rows.filter((r) => r && r[1] != null).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </div>
  );
}

/** A tank design laid out like the game's Tank Designer window. */
export default function TankCard({ game, d, title, badge }) {
  const chassisName = game.raw.designers[d.chassis]?.name || d.chassis.replaceAll('_', ' ');
  const icon = `/hoi4/technologies/${CHASSIS_ICON[d.chassis] || d.chassis}.png`;
  const slots = Object.entries(d.modules || {}).filter(([, id]) => id);
  const s = d.stats || {};
  return (
    <article className="td-card">
      <header className="td-titlebar">
        <span>{title || 'Tank Designer'}</span>
        <span className="td-role">{badge || ROLE_LABEL[d.role] || (d.role || '').replaceAll('_', ' ')}</span>
      </header>
      <div className="td-name-row"><h3>{chassisName}</h3></div>
      {slots.length > 0 && (
        <div className="td-slots" role="list">
          {slots.map(([slot, id]) => (
            <div className="td-slot" role="listitem" key={slot} title={game.raw.modules[id]?.name || id.replaceAll('_', ' ')}>
              {moduleIcon(id)
                ? <img className="td-slot-icon" src={moduleIcon(id)} alt="" />
                : <span className="td-slot-abbr">{SLOT_ABBR[slot] || slot.replace(/_slot(_\d)?$/, '').slice(0, 3).toUpperCase()}</span>}
              <span className="td-slot-name">{game.raw.modules[id]?.name || id.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
      <div className="td-body">
        <div className="td-blueprint">
          <img src={icon} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        </div>
        <div className="td-stats">
          <TdPanel title="Base" rows={[
            ['Max speed', s.spd != null ? `${fmt(s.spd, 'spd')} km/h` : null],
            ['Reliability', s.rel != null ? `${(s.rel * 100).toFixed(1)}%` : null],
            ['Production cost', s.ic != null ? `${fmt(s.ic, 'ic')} IC` : null],
          ]} />
          <TdPanel title="Combat" rows={[
            ['Soft attack', fmt(s.sa, 'sa')],
            ['Hard attack', fmt(s.ha, 'ha')],
            ['Piercing', fmt(s.pier, 'pier')],
            ['Armor', fmt(s.arm, 'arm')],
            ['Breakthrough', fmt(s.brk, 'brk')],
            ['Defense', fmt(s.def, 'def')],
            ['Hardness', `${((s.hard || 0) * 100).toFixed(0)}%`],
            s.air ? ['Air attack', fmt(s.air, 'air')] : null,
          ].filter(Boolean)} />
        </div>
      </div>
    </article>
  );
}
