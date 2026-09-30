/**
 * Tank designs chosen together with the template.
 *
 * A tank battalion's value depends on the division around it (armor matters more next to infantry, cost matters more
 * when the whole division is cheap), so designs are tuned against the division rather than against a fixed per-role
 * objective:
 *
 *   1. Find the best template with the current designs (exact search).
 *   2. For every chassis and role, measure what each design stat is worth to the division: the change in the
 *      winning template's score per unit of soft attack, armor, cost and so on (or, for a design the winner does
 *      not use, the change in the score of the winner plus one battalion of it).
 *   3. Run the exhaustive module search (designSearch) with those values as the objective. Keep the new design only
 *      if the division's exact score improves with it.
 *   4. If any design changed, rebuild the units and search again. Stop when nothing changes (or after ROUNDS).
 *
 * Each round re-measures the values around the new designs, so the designs and the template settle together.
 */
import { resolve, designSearch } from './game.js';
import { evaluate } from './stats.js';
import { utility } from './score.js';

const ROUNDS = 3;
const KEYS = ['sa', 'ha', 'def', 'brk', 'pier', 'air', 'arm', 'hard', 'spd', 'ic', 'rel'];

function directions(P) {
  // stats the division score can depend on; the rest are left out of the design search
  const dirs = Object.fromEntries(KEYS.map((k) => [k, 1]));
  dirs.ic = -1;
  // hardness helps against soft-attack-heavy opponents and when it is itself a priority
  const hardTerm = P.terms.find((t) => t.key === 'hard');
  const hasMatchup = P.terms.some((t) => t.kind === 'matchup') && P.enemy;
  const fromMatchup = hasMatchup ? (P.enemy.sa >= P.enemy.ha ? 1 : -1) : 0;
  const fromTerm = hardTerm ? hardTerm.dir : 0;
  dirs.hard = fromTerm && fromMatchup && fromTerm !== fromMatchup ? 0 : (fromTerm || fromMatchup || 1);
  return dirs;
}

const sameModules = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

export function coDesign(game, setup, baseResolved, runBest, P) {
  let resolved = baseResolved;
  let best = runBest(resolved, []);
  const log = [];
  const dirs = directions(P, baseResolved);
  for (let round = 0; round < ROUNDS && best; round++) {
    const tpl = best.tpl;
    const next = {};
    let changed = 0;
    for (const [key, d] of Object.entries(resolved.designs)) {
      if (!d) continue;
      const users = [...resolved.byId.values()].filter((u) => u.tank && `${u.tank.chassis}|${u.tank.role}` === key).map((u) => u.id);
      const used = users.some((id) => tpl.items.includes(id) || tpl.support.includes(id) || tpl.reg.includes(id));
      const lineUser = users.find((id) => resolved.byId.get(id).role === 'line');
      const probe = used ? tpl : lineUser ? { ...tpl, items: [...tpl.items, lineUser] } : null;
      next[key] = { modules: d.modules, tuned: d.tuned };
      if (!probe) continue;
      const byId = new Map(resolved.byId);
      const value = (stats) => {
        for (const id of users) byId.set(id, resolved.withDesign(id, stats));
        const st = evaluate(probe, byId, P.mods, P.opts, resolved.columnSize);
        return st ? utility(st, P.terms, P.enemy) : -Infinity;
      };
      const current = value(d.stats);
      // what one unit of each design stat is worth to the division, measured around the current design
      const linear = {};
      for (const k of KEYS) {
        if (!dirs[k]) continue;
        const step = Math.max(1e-3, Math.abs(d.stats[k]) * 0.01);
        const hiV = value({ ...d.stats, [k]: d.stats[k] + step });
        const loV = value({ ...d.stats, [k]: Math.max(0, d.stats[k] - step) });
        const g = (hiV - loV) / (d.stats[k] + step - Math.max(0, d.stats[k] - step));
        if (Number.isFinite(g)) linear[k] = g;
      }
      const r = designSearch(game, resolved.techSet, d.chassis, d.role, resolved.open, { linear }, Object.fromEntries(KEYS.map((k) => [k, linear[k] ? Math.sign(linear[k]) : 0])));
      if (r && !sameModules(r.modules, d.modules) && value(r.stats) > current + 1e-9) {
        next[key] = { modules: r.modules, tuned: true };
        changed++;
      } else if (used) {
        next[key].tuned = true;
      }
    }
    log.push({ round: round + 1, changed, score: best.score });
    if (!changed) break;
    resolved = resolve(game, { techs: setup.techs, doctrine: setup.doctrine, exclude: setup.exclude, design: setup.weights, designs: next });
    best = runBest(resolved, [best.tpl]) || best;
  }
  return { resolved, best, log };
}
