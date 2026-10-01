/**
 * Theatres and how well a division width fills their frontage.
 *
 * Every province's terrain sets a combat width for a battle, plus an extra amount for each additional direction the
 * attack comes from. Divisions that do not divide that width evenly leave part of the frontage empty. The fit of a
 * width is the share of the frontage that whole divisions fill, averaged over the theatre's terrain and over
 * one- and two-direction attacks.
 *
 * The terrain widths are the values introduced with the Barbarossa update. They live in this one table because
 * Paradox has changed them before. Going over the combat width (allowed with a penalty) is not modelled.
 */

export const TERRAINS = [
  { id: 'plains', name: 'Plains', width: 70, extra: 35 },
  { id: 'forest', name: 'Forest', width: 60, extra: 30 },
  { id: 'hills', name: 'Hills', width: 70, extra: 35 },
  { id: 'mountain', name: 'Mountain', width: 50, extra: 25 },
  { id: 'desert', name: 'Desert', width: 75, extra: 25 },
  { id: 'jungle', name: 'Jungle', width: 60, extra: 30 },
  { id: 'marsh', name: 'Marsh', width: 50, extra: 25 },
  { id: 'urban', name: 'Urban', width: 96, extra: 32 },
];

export const THEATRES = [
  { id: 'any', name: 'Any front', blurb: 'No particular theatre: every width is judged equally.', mix: null },
  { id: 'western', name: 'Western Europe', blurb: 'France, the Low Countries and Germany: open country, woods and towns.', mix: { plains: 40, forest: 25, hills: 20, urban: 10, marsh: 5 } },
  { id: 'eastern', name: 'Eastern Front', blurb: 'Poland to the Volga: steppe, forest and the Pripyat marshes.', mix: { plains: 50, forest: 30, marsh: 15, urban: 5 } },
  { id: 'africa', name: 'North Africa', blurb: 'Libya and Egypt: desert with a few ridges.', mix: { desert: 80, hills: 10, plains: 10 } },
  { id: 'mediterranean', name: 'Italy and the Balkans', blurb: 'Mountain spines and hill country with narrow plains.', mix: { hills: 40, mountain: 40, plains: 20 } },
  { id: 'pacific', name: 'Pacific and Burma', blurb: 'Jungle islands and river valleys.', mix: { jungle: 70, hills: 15, marsh: 15 } },
  { id: 'china', name: 'China', blurb: 'River plains, hills and mountain borders.', mix: { plains: 35, hills: 35, mountain: 20, marsh: 10 } },
];

const fill = (frontage, width) => (width > 0 ? (Math.floor(frontage / width) * width) / frontage : 0);

/** Share of the frontage whole divisions of this width fill, 0..1. */
export function frontageFit(width, theatre, terrains = TERRAINS) {
  if (!theatre || !theatre.mix || !width) return null;
  let sum = 0; let total = 0;
  for (const t of terrains) {
    const p = theatre.mix[t.id] || 0;
    if (!p) continue;
    sum += p * (fill(t.width, width) + fill(t.width + t.extra, width)) / 2;
    total += p;
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
