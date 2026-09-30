import raw from '../data/game.json';
import { buildGame } from './game.js';
import { search } from './optimizer.js';

const game = buildGame(raw);

// The search posts a provisional answer as soon as it has a strong template, then the proven one.
self.onmessage = (e) => {
  const { id, params } = e.data;
  try {
    const res = search(game, params, (partial) => self.postMessage({ id, res: partial, partial: true }));
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, res: { error: `The search failed: ${err.message}` } });
  }
};
