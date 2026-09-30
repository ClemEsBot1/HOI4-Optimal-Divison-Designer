/**
 * A small land-combat model, so "best" can mean "best against this opponent" rather than "biggest numbers".
 *
 * It follows the game's combat rules closely enough to rank templates, not to predict battles:
 *   - Attacks per hour are soft attack against the target's softness plus hard attack against its hardness.
 *   - The target blocks with defense when it defends and with breakthrough when it attacks. Blocked attacks hit
 *     10% of the time, unblocked ones 40% of the time.
 *   - When the target's armor is above the attacker's piercing, the attacker does half damage.
 *   - Both sides fill the same frontage, so a narrow division fields more copies of itself.
 * The result is how long it takes the opponent to lose its organization compared with how long it takes us:
 * above 1 we break them first. Terrain, entrenchment, planning, air support and combat width penalties are ignored.
 */
import { evaluate } from './stats.js';

export const FRONTAGE = 40;
const BLOCKED_HIT = 0.1;
const UNBLOCKED_HIT = 0.4;
const ARMOR_DAMAGE = 0.5;

// Opponents built from the player's own research, so the matchup moves with the tech year. Each entry lists fallbacks
// in case a unit is not researched yet.
export const OPPONENTS = [
  {
    id: 'infantry', name: 'Infantry line (20 width)', blurb: '7 infantry and 2 artillery with engineers and support artillery.',
    items: [['infantry', 7], [['artillery_brigade'], 2]], support: ['engineer', 'artillery'],
  },
  {
    id: 'armor', name: 'Medium tank division (40 width)', blurb: '10 medium tanks and 8 mechanized (or motorized) with engineers and recon.',
    items: [[['medium_armor', 'light_armor'], 10], [['mechanized', 'motorized'], 8]], support: ['engineer', 'recon', 'maintenance_company'],
  },
  {
    id: 'heavy', name: 'Heavy tank spearhead (30 width)', blurb: '6 heavy tanks and 6 mechanized (or motorized) with engineers.',
    items: [[['heavy_armor', 'medium_armor'], 6], [['mechanized', 'motorized'], 6]], support: ['engineer'],
  },
];

export const ENEMY_KEYS = ['width', 'sa', 'ha', 'def', 'brk', 'org', 'arm', 'pier', 'hard'];

/** Build the opponent's stats from a preset (using our resolved units) or take custom numbers. */
export function enemyStats(enemy, byId, columnSize) {
  if (!enemy || !enemy.id || enemy.id === 'none') return null;
  if (enemy.id === 'custom') {
    const s = {};
    for (const k of ENEMY_KEYS) s[k] = Math.max(0, Number(enemy[k]) || 0);
    if (!s.width || !s.org) return null;
    return s;
  }
  const preset = OPPONENTS.find((o) => o.id === enemy.id);
  if (!preset) return null;
  const items = [];
  for (const [ids, n] of preset.items) {
    const id = (Array.isArray(ids) ? ids : [ids]).find((x) => byId.has(x));
    if (!id) return null;
    for (let i = 0; i < n; i++) items.push(id);
  }
  const support = preset.support.filter((id) => byId.has(id));
  const st = evaluate({ items, support, reg: [] }, byId, {}, undefined, columnSize);
  return st && st.valid ? st : null;
}

const hits = (attacks, blocks) => BLOCKED_HIT * Math.min(attacks, blocks) + UNBLOCKED_HIT * Math.max(0, attacks - blocks);

/** Hours for `target` to lose its organization under fire from `attacker`. */
function breakHours(attacker, target, targetBlocks) {
  const aScale = FRONTAGE / Math.max(1, attacker.width);
  const tScale = FRONTAGE / Math.max(1, target.width);
  const h = Math.max(0, Math.min(100, target.hard)) / 100;
  const attacks = (attacker.sa * (1 - h) + attacker.ha * h) * aScale;
  const damage = hits(attacks, targetBlocks * tScale) * (attacker.pier >= target.arm ? 1 : ARMOR_DAMAGE);
  const pool = target.org * tScale;
  return damage > 0 ? pool / damage : Infinity;
}

/**
 * mAtk: we attack, they defend. mDef: they attack, we defend. Both are (hours until we break) / (hours until they
 * break), so 2 means they collapse twice as fast as we do.
 */
export function matchup(us, them) {
  if (!them || !us) return { mAtk: 0, mDef: 0 };
  const ratio = (ours, theirs) => {
    if (!Number.isFinite(ours) && !Number.isFinite(theirs)) return 1;
    if (!Number.isFinite(ours)) return 100;
    if (!Number.isFinite(theirs) || theirs <= 0) return 0;
    return Math.min(100, ours / theirs);
  };
  // attacking: they block our attacks with defense, we block theirs with breakthrough
  const mAtk = ratio(breakHours(them, us, us.brk), breakHours(us, them, them.def));
  // defending: we block with defense, they block with breakthrough
  const mDef = ratio(breakHours(them, us, us.def), breakHours(us, them, them.brk));
  return { mAtk, mDef };
}
