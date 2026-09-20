/** Display helpers and share-link encoding. */

export function countBy(ids) {
  const m = new Map();
  for (const id of ids) m.set(id, (m.get(id) || 0) + 1);
  return m;
}

export const shortName = (u) => u.abbr || u.name;

/** "9 Infantry, 1 Artillery" style summaries for the results table. */
export function describeTemplate(tpl, byId) {
  const combat = [...countBy(tpl.items)].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${n} ${byId.get(id).name}`).join(', ');
  const names = (ids) => [...countBy(ids)].map(([id, n]) => (n > 1 ? `${n} ${byId.get(id).name}` : byId.get(id).name)).join(', ');
  return { combat, support: names(tpl.support || []), reg: names(tpl.reg || []) };
}

// ---- share link: everything in the URL hash, techs packed as a bitset over the sorted tech list ----
const b64 = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const urlSafe = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unUrlSafe = (s) => { let t = s.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return t; };

/** Changes whenever the tech list changes, so a link made for older data is not misread. */
export function dataStamp(game) {
  let h = 5381;
  for (const id of game.techOrder) for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function encodeState(state, game) {
  try {
    const bits = new Uint8Array(Math.ceil(game.techOrder.length / 8));
    for (const id of state.t) { const i = game.techIndex.get(id); if (i != null) bits[i >> 3] |= 1 << (i & 7); }
    const json = JSON.stringify({ ...state, t: b64(bits), v: dataStamp(game) });
    return urlSafe(btoa(unescape(encodeURIComponent(json))));
  } catch { return ''; }
}

export function decodeState(str, game) {
  const s = JSON.parse(decodeURIComponent(escape(atob(unUrlSafe(str)))));
  let techs = null;
  if (s.v === dataStamp(game) && typeof s.t === 'string') {
    const bits = unb64(s.t);
    techs = new Set();
    game.techOrder.forEach((id, i) => { if (bits[i >> 3] & (1 << (i & 7))) techs.add(id); });
  }
  return { ...s, t: techs };
}
