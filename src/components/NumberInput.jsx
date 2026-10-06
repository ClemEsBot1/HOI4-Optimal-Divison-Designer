import React, { useEffect, useRef, useState } from 'react';

// Numeric field that lets the user type freely. The text box holds whatever is
// typed (blank, "1" on the way to "15", "0." on the way to "0.5") and only
// passes a value up while it is a valid number inside [min, max]. On blur or
// Enter the field snaps to the nearest allowed value, so clamping never fights
// the keystroke the user is making.
export default function NumberInput({ value, onChange, min, max, integer = false, fallback, allowEmpty = false, ...rest }) {
  const lo = min == null ? -Infinity : Number(min);
  const hi = max == null ? Infinity : Number(max);
  const shown = value == null || value === '' ? '' : String(value);
  const [text, setText] = useState(shown);
  const editing = useRef(false);

  // Follow outside changes (presets, reset, load) unless the field already
  // shows that number, e.g. "15." while the user is mid-typing.
  useEffect(() => {
    if (editing.current && text.trim() !== '' && Number(text) === Number(value)) return;
    if (editing.current && text.trim() === '' && shown === '') return;
    setText(shown);
  }, [shown]);

  const parse = (s) => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    setText(raw);
    const n = parse(raw);
    if (n == null) {
      if (allowEmpty && raw.trim() === '') onChange('');
      return;
    }
    if (n < lo || n > hi || (integer && !Number.isInteger(n))) return;
    if (n !== Number(value) || shown === '') onChange(n);
  };

  const commit = () => {
    editing.current = false;
    let n = parse(text);
    if (n == null) {
      if (allowEmpty) { setText(''); if (shown !== '') onChange(''); return; }
      const prev = parse(shown);
      n = prev ?? fallback ?? (Number.isFinite(lo) ? lo : 0);
    }
    if (integer) n = Math.round(n);
    n = Math.max(lo, Math.min(hi, n));
    setText(String(n));
    if (n !== Number(value) || shown === '') onChange(n);
  };

  return (
    <input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      min={min}
      max={max}
      {...rest}
      value={text}
      onFocus={(e) => { editing.current = true; rest.onFocus?.(e); }}
      onChange={handleChange}
      onBlur={(e) => { commit(); rest.onBlur?.(e); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); rest.onKeyDown?.(e); }}
    />
  );
}
