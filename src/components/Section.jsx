import React, { useEffect, useState } from 'react';
import { readStore, writeStore } from '../lib/storage.js';

const KEY = 'dd.collapsed';
const listeners = new Set();
let collapsed = readStore(KEY, {});
const setCollapsed = (id, value) => {
  collapsed = { ...collapsed, [id]: value };
  writeStore(KEY, collapsed);
  listeners.forEach((f) => f());
};
/** Collapse or expand every panel whose id starts with `prefix`. */
export function setAllCollapsed(ids, value) {
  collapsed = { ...collapsed };
  for (const id of ids) collapsed[id] = value;
  writeStore(KEY, collapsed);
  listeners.forEach((f) => f());
}

function useCollapsed(id, defaultOpen) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  const isCollapsed = id in collapsed ? collapsed[id] : !defaultOpen;
  return [!isCollapsed, (open) => setCollapsed(id, !open)];
}

/**
 * A panel with a header that folds it away. The open state is remembered per panel in this browser.
 * kicker: small stencilled line above the title. actions: controls shown on the right of the header.
 */
export default function Section({ id, title, kicker, actions, children, className = '', defaultOpen = true, tone }) {
  const [open, setOpen] = useCollapsed(id, defaultOpen);
  return (
    <section className={`panel ${className}${open ? '' : ' is-closed'}${tone ? ` tone-${tone}` : ''}`} id={id}>
      <header className="panel-head">
        <button type="button" className="panel-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true" />
          <span className="panel-titles">
            {kicker && <small className="kicker">{kicker}</small>}
            <h2>{title}</h2>
          </span>
        </button>
        {actions && open && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-fold" data-open={open}>
        <div className="panel-body" id={`${id}-body`} aria-hidden={!open}>
          {children}
        </div>
      </div>
    </section>
  );
}
