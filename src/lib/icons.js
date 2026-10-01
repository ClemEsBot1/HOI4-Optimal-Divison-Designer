// Game icons under public/hoi4, looked up by game id. Returns null when the game has no icon for an id, so callers
// can fall back or render nothing instead of a broken image. src/data/icons.json lists what is on disk.
import ICONS from '../data/icons.json';

const SETS = Object.fromEntries(Object.entries(ICONS).map(([dir, ids]) => [dir, new Set(ids)]));

export function iconUrl(dir, id) {
  return id && SETS[dir]?.has(id) ? `/hoi4/${dir}/${id}.png` : null;
}

export const unitIcon = (id) => iconUrl('units', id);
export const equipmentIcon = (id) => iconUrl('equipment', id);
export const moduleIcon = (id) => iconUrl('modules', id);
export const doctrineIcon = (id) => iconUrl('doctrines', id);

/** Ship hull variants (ship_hull_light_2, ...) share their family's icon. */
export function hullIcon(id) {
  const fam = id && ICONS.hulls.find((h) => id === h || id.startsWith(`${h}_`));
  return iconUrl('hulls', fam);
}

/** Airframes by size: an archetype id (small_plane_airframe_1, medium_plane_cas_airframe) or a label ("Small airframe"). */
export function airframeIcon(idOrLabel) {
  const size = /^(small|medium|large)/i.exec(idOrLabel || '')?.[1]?.toLowerCase();
  return size ? iconUrl('airframes', `${size}_airframe`) : null;
}

/** onError handler for game icons: hide the image rather than show a broken one. */
export const hideBroken = (e) => { e.currentTarget.style.display = 'none'; };
