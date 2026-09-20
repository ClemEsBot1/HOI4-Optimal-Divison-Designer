// Minimal Paradox script parser (enough for HOI4 common/ files).
// A block is an array of entries { k, op, v }. v is a scalar (string | number | boolean) or a block.
// Bare values (e.g. lists of ids) have k === null.

export function parse(text, vars = {}) {
  const src = text.replace(/^\uFEFF/, '');
  const toks = tokenize(src);
  let i = 0;
  const scope = { ...vars };

  const resolve = (t) => {
    if (typeof t !== 'string') return t;
    if (t[0] === '@' && t in scope) return scope[t];
    return t;
  };
  const coerce = (t) => {
    if (typeof t !== 'string') return t;
    const r = resolve(t);
    if (typeof r !== 'string') return r;
    if (r === 'yes') return true;
    if (r === 'no') return false;
    if (/^-?\d+(\.\d+)?$/.test(r)) return Number(r);
    if (/^-?\.\d+$/.test(r)) return Number(r);
    return r;
  };

  function block() {
    const out = [];
    while (i < toks.length) {
      const t = toks[i];
      if (t.type === 'close') { i++; return out; }
      if (t.type === 'open') { i++; out.push({ k: null, op: null, v: block() }); continue; }
      const key = t.value;
      const nxt = toks[i + 1];
      if (nxt && nxt.type === 'op') {
        const op = nxt.value;
        const val = toks[i + 2];
        if (!val) { i += 2; continue; }
        if (val.type === 'open') {
          i += 3;
          out.push({ k: key, op, v: block() });
        } else {
          i += 3;
          const v = coerce(val.value);
          if (key[0] === '@' && key.length > 1) scope[key] = v; // scripted variable definition
          out.push({ k: key, op, v });
        }
      } else {
        i++;
        out.push({ k: null, op: null, v: coerce(key) });
      }
    }
    return out;
  }
  return block();
}

function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '#') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '{') { toks.push({ type: 'open' }); i++; continue; }
    if (c === '}') { toks.push({ type: 'close' }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') j++;
      toks.push({ type: 'word', value: s.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (c === '=' || c === '<' || c === '>' || c === '?' || c === '!') {
      let j = i + 1;
      if (s[j] === '=') j++;
      toks.push({ type: 'op', value: s.slice(i, j) });
      i = j; continue;
    }
    // word
    let j = i;
    while (j < n && !' \t\r\n{}="#<>'.includes(s[j])) j++;
    if (j === i) { i++; continue; }
    // scripted math like @[a*b] is kept as an opaque word
    if (s[i] === '@' && s[i + 1] === '[') {
      let k = i; while (k < n && s[k] !== ']') k++;
      toks.push({ type: 'word', value: s.slice(i, k + 1) }); i = k + 1; continue;
    }
    toks.push({ type: 'word', value: s.slice(i, j) });
    i = j;
  }
  return toks;
}

// ---- helpers ----
export const isBlock = (v) => Array.isArray(v);
export const first = (b, k) => { if (!isBlock(b)) return undefined; const e = b.find((x) => x.k === k); return e ? e.v : undefined; };
export const all = (b, k) => (isBlock(b) ? b.filter((x) => x.k === k).map((x) => x.v) : []);
export const bare = (b) => (isBlock(b) ? b.filter((x) => x.k === null && !isBlock(x.v)).map((x) => x.v) : []);
export const keys = (b) => (isBlock(b) ? b.filter((x) => x.k !== null).map((x) => x.k) : []);
export const num = (b, k, d = 0) => { const v = first(b, k); return typeof v === 'number' ? v : d; };
// flatten the immediate scalar numeric properties of a block into an object (last wins)
export function scalars(b) {
  const o = {};
  if (!isBlock(b)) return o;
  for (const e of b) if (e.k !== null && !isBlock(e.v)) o[e.k] = e.v;
  return o;
}
