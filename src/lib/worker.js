import raw from '../data/game.json';
import { buildGame } from './game.js';
import { search } from './optimizer.js';

const game = buildGame(raw);

self.onmessage = (e) => {
  const { id, params } = e.data;
  try {
    self.postMessage({ id, res: search(game, params) });
  } catch (err) {
    self.postMessage({ id, res: { error: `The search failed: ${err.message}` } });
  }
};
