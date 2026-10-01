import React, { useEffect, useRef, useState } from 'react';

/**
 * A command-bar menu: a labelled button showing the current value, and a panel that drops below it.
 * Closes on Escape, on a click outside, or when `children` calls the close function it is given.
 */
export default function Menu({ label, value, children, wide = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={'menu' + (open ? ' open' : '')} ref={ref}>
      <button type="button" className="menu-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{label}</b><span>{value}</span><i aria-hidden="true" />
      </button>
      <div className={'menu-panel' + (wide ? ' wide' : '')} role="menu" hidden={!open}>
        {open && children(() => setOpen(false))}
      </div>
    </div>
  );
}
