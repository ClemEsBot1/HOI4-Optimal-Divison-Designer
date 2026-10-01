import raw from '../data/game.json';
import naval from '../data/designers.json';
import { buildGame } from './game.js';
import { search } from './optimizer.js';
import { metaTanks, roleTanks } from './tankRoles.js';
import { SHIP_ROLES, bestShip } from './naval.js';
import { PLANE_ROLES, bestPlane } from './air.js';

const game = buildGame(raw);
const designCache = new Map();
const DESIGNERS = { ship: [SHIP_ROLES, bestShip], plane: [PLANE_ROLES, bestPlane] };

/**
 * One long-lived worker for every heavy job, so the game data is parsed once and resolved setups stay cached.
 *   { type: 'search', params }  the template search; posts a provisional answer, progress ticks, then the proof
 *   { type: 'tanks', techs }    the best tank design of every role and chassis
 *   { type: 'tankRole', techs, role, objective? }  one tank role in depth: ranked designs over every chassis
 *   { type: 'ship' | 'plane', role, year, weights? }  the best ship or aircraft design of one role, on the role's own
 *                               priorities or on the weights given; keep > 1 also returns the next best designs
 */
self.onmessage = (e) => {
  const { id, type = 'search' } = e.data;
  try {
    if (type === 'tanks') {
      self.postMessage({ id, res: metaTanks(game, e.data.techs) });
      return;
    }
    if (type === 'tankRole') {
      self.postMessage({ id, res: roleTanks(game, e.data.techs, e.data.role, e.data.objective) });
      return;
    }
    if (DESIGNERS[type]) {
      const { role: roleId, year, weights, keep = 1 } = e.data;
      const key = `${type}|${roleId}|${year}|${keep}|${weights ? JSON.stringify(weights) : ''}`;
      if (!designCache.has(key)) {
        const [roles, best] = DESIGNERS[type];
        const role = roles.find((r) => r.id === roleId);
        designCache.set(key, role ? best(naval, role, year, { keep, ...(weights ? { weights } : {}) }) : null);
      }
      self.postMessage({ id, res: designCache.get(key) });
      return;
    }
    const res = search(game, e.data.params,
      (partial) => self.postMessage({ id, res: partial, partial: true }),
      (tick) => self.postMessage({ id, tick }));
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, res: { error: `The search failed: ${err.message}` } });
  }
};
