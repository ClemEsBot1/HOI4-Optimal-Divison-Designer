/**
 * Theatres and how well a division width fills their frontage.
 *
 * Every province's terrain sets a battle's combat width, plus an extra amount for each additional direction the attack
 * comes from. Divisions that do not divide that width leave part of it empty, and going over it is allowed only with
 * a penalty: -2% combat effectiveness per 1% over, until the penalty reaches 33% and no more divisions can join
 * (COMBAT_OVER_WIDTH_PENALTY and COMBAT_OVER_WIDTH_PENALTY_MAX in the game's defines). The fit of a width is the
 * combat power whole divisions of that width put into the battle, as a share of a frontage filled exactly: the best
 * number of divisions to commit, averaged over the theatre's terrain and over one-, two- and three-direction attacks.
 *
 * The terrain widths are the values introduced with the Barbarossa update. They live in this one table because
 * Paradox has changed them before.
 */

export const OVER_WIDTH_PENALTY = 2; // per unit of overshoot (2% per 1% over)
export const OVER_WIDTH_PENALTY_MAX = 0.33;

export const TERRAINS = [
  { id: 'plains', name: 'Plains', width: 90, extra: 45 },
  { id: 'desert', name: 'Desert', width: 90, extra: 45 },
  { id: 'forest', name: 'Forest', width: 84, extra: 42 },
  { id: 'jungle', name: 'Jungle', width: 84, extra: 42 },
  { id: 'hills', name: 'Hills', width: 80, extra: 40 },
  { id: 'marsh', name: 'Marsh', width: 78, extra: 26 },
  { id: 'mountain', name: 'Mountain', width: 75, extra: 25 },
  { id: 'urban', name: 'Urban', width: 96, extra: 32 },
];

// how often a battle has one, two or three attack directions
const DIRECTIONS = [[0, 0.5], [1, 0.35], [2, 0.15]];

const EVEN_MIX = Object.fromEntries(TERRAINS.map((t) => [t.id, 1]));

export const THEATRES = [
  { id: 'any', name: 'Any front', blurb: 'Every terrain counts the same.', mix: EVEN_MIX },
  { id: 'western', name: 'Western Europe', blurb: 'France, the Low Countries and Germany: open country, woods and towns.', mix: { plains: 40, forest: 25, hills: 20, urban: 10, marsh: 5 } },
  { id: 'eastern', name: 'Eastern Front', blurb: 'Poland to the Volga: steppe, forest and the Pripyat marshes.', mix: { plains: 50, forest: 30, marsh: 15, urban: 5 } },
  { id: 'africa', name: 'North Africa', blurb: 'Libya and Egypt: desert with a few ridges.', mix: { desert: 80, hills: 10, plains: 10 } },
  { id: 'mediterranean', name: 'Italy and the Balkans', blurb: 'Mountain spines and hill country with narrow plains.', mix: { hills: 40, mountain: 40, plains: 20 } },
  { id: 'pacific', name: 'Pacific and Burma', blurb: 'Jungle islands and river valleys.', mix: { jungle: 70, hills: 15, marsh: 15 } },
  { id: 'china', name: 'China', blurb: 'River plains, hills and mountain borders.', mix: { plains: 35, hills: 35, mountain: 20, marsh: 10 } },
];

/** Combat power whole divisions of this width bring to one battle of this frontage, relative to filling it exactly. */
export function battleFill(frontage, width) {
  if (!(width > 0)) return 0;
  const maxOver = OVER_WIDTH_PENALTY_MAX / OVER_WIDTH_PENALTY;
  let best = 0;
  for (let k = 1; k * width <= frontage * (1 + maxOver) + 1e-9; k++) {
    const share = (k * width) / frontage;
    const over = Math.max(0, share - 1);
    best = Math.max(best, share * (1 - OVER_WIDTH_PENALTY * over));
  }
  return best;
}

/** Fit of a width in a theatre (or a terrain mix), 0..1. Every terrain counts the same without one. */
export function frontageFit(width, theatre, terrains = TERRAINS) {
  if (!width) return null;
  const mix = (theatre && theatre.mix) || EVEN_MIX;
  let sum = 0; let total = 0;
  for (const t of terrains) {
    const p = mix[t.id] || 0;
    if (!p) continue;
    for (const [d, q] of DIRECTIONS) { sum += p * q * battleFill(t.width + d * t.extra, width); total += p * q; }
  }
  return total ? sum / total : null;
}

/** Fit of every whole width from `from` to `to`. */
export function fitTable(theatre, from = 6, to = 50, terrains = TERRAINS) {
  const out = [];
  for (let w = from; w <= to; w++) out.push({ width: w, fit: frontageFit(w, theatre, terrains) });
  return out;
}

/** Whole widths in [wmin, wmax] that fill at least `min` of the frontage. */
export function fittingWidths(theatre, wmin, wmax, min = 0.9, terrains = TERRAINS) {
  return fitTable(theatre, Math.max(1, Math.ceil(wmin)), Math.floor(wmax), terrains).filter((x) => x.fit != null && x.fit >= min).map((x) => x.width);
}
