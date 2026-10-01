import raw from '../data/game.json';
import naval from '../data/designers.json';
import { buildGame } from './game.js';
import { search } from './optimizer.js';
import { metaTanks } from './tankRoles.js';
import { SHIP_ROLES, bestShip } from './naval.js';

const game = buildGame(raw);
const shipCache = new Map();

/**
 * One long-lived worker for every heavy job, so the game data is parsed once and resolved setups stay cached.
 *   { type: 'search', params }  the template search; posts a provisional answer, progress ticks, then the proof
 *   { type: 'tanks', techs }    the best tank design of every role and chassis
 *   { type: 'ship', role, year } the best ship design of one role
 */
self.onmessage = (e) => {
  const { id, type = 'search' } = e.data;
  try {
    if (type === 'tanks') {
      self.postMessage({ id, res: metaTanks(game, e.data.techs) });
      return;
    }
    if (type === 'ship') {
      const key = `${e.data.role}|${e.data.year}`;
      if (!shipCache.has(key)) {
        const role = SHIP_ROLES.find((r) => r.id === e.data.role);
        shipCache.set(key, role ? bestShip(naval, role, e.data.year) : null);
      }
      self.postMessage({ id, res: shipCache.get(key) });
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
