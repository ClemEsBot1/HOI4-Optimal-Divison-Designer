import React, { useMemo } from 'react';
import { AXIS_STATS, AXIS_LABEL, AXIS_DIR, fmt } from '../lib/stats.js';

const W = 640; const H = 340; const PAD = { l: 54, r: 14, t: 12, b: 40 };

/** Scatter of every feasible template the search kept, with the efficient frontier for the two chosen stats. */
export default function Pareto({ pool, poolKeys, axisX, axisY, setAxisX, setAxisY, topKeys, selectedKey, onPick }) {
  const view = useMemo(() => {
    const xs = pool.map((p) => p[axisX]); const ys = pool.map((p) => p[axisY]);
    const min = (a) => Math.min(...a); const max = (a) => Math.max(...a);
    const x0 = min(xs); const x1 = max(xs); const y0 = min(ys); const y1 = max(ys);
    const sx = (v) => PAD.l + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (v) => H - PAD.b - (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    const dx = AXIS_DIR[axisX]; const dy = AXIS_DIR[axisY];
    // a point is on the frontier if no other point is at least as good on both stats and better on one
    const order = pool.map((p, i) => i).sort((a, b) => (pool[b][axisX] * dx - pool[a][axisX] * dx) || (pool[b][axisY] * dy - pool[a][axisY] * dy));
    const front = []; let best = -Infinity;
    for (const i of order) { const v = pool[i][axisY] * dy; if (v > best) { best = v; front.push(i); } }
    front.sort((a, b) => pool[a][axisX] - pool[b][axisX]);
    return { x0, x1, y0, y1, sx, sy, front };
  }, [pool, axisX, axisY]);

  const topSet = useMemo(() => new Set(topKeys), [topKeys]);
  const ticks = (a, b) => [0, 1, 2, 3, 4].map((i) => a + ((b - a) * i) / 4);

  const onClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W; const py = ((e.clientY - r.top) / r.height) * H;
    let bi = -1; let bd = 14 * 14;
    pool.forEach((p, i) => { const d = (view.sx(p[axisX]) - px) ** 2 + (view.sy(p[axisY]) - py) ** 2; if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) onPick(poolKeys[bi]);
  };

  return (
    <div className="pareto">
      <div className="pareto-axes">
        <label>Across
          <select value={axisX} onChange={(e) => setAxisX(e.target.value)}>
            {AXIS_STATS.map((k) => <option key={k} value={k}>{AXIS_LABEL[k]}</option>)}
          </select>
        </label>
        <label>Up
          <select value={axisY} onChange={(e) => setAxisY(e.target.value)}>
            {AXIS_STATS.map((k) => <option key={k} value={k}>{AXIS_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pareto-svg" role="img" onClick={onClick}
        aria-label={`${pool.length} templates plotted by ${AXIS_LABEL[axisX]} and ${AXIS_LABEL[axisY]}. The line marks the best trade-offs.`}>
        {ticks(view.y0, view.y1).map((v, i) => (
          <g key={`y${i}`}><line x1={PAD.l} x2={W - PAD.r} y1={view.sy(v)} y2={view.sy(v)} className="p-grid" /><text x={PAD.l - 6} y={view.sy(v) + 4} textAnchor="end" className="p-tick">{fmt(v, axisY)}</text></g>
        ))}
        {ticks(view.x0, view.x1).map((v, i) => (
          <g key={`x${i}`}><line y1={PAD.t} y2={H - PAD.b} x1={view.sx(v)} x2={view.sx(v)} className="p-grid" /><text y={H - PAD.b + 16} x={view.sx(v)} textAnchor="middle" className="p-tick">{fmt(v, axisX)}</text></g>
        ))}
        <text x={(W + PAD.l) / 2} y={H - 6} textAnchor="middle" className="p-label">{AXIS_LABEL[axisX]}{AXIS_DIR[axisX] < 0 ? ' (lower is better)' : ''}</text>
        <text transform={`translate(12 ${(H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" className="p-label">{AXIS_LABEL[axisY]}{AXIS_DIR[axisY] < 0 ? ' (lower is better)' : ''}</text>
        {pool.map((p, i) => (poolKeys[i] === selectedKey || topSet.has(poolKeys[i]) ? null : <circle key={i} cx={view.sx(p[axisX])} cy={view.sy(p[axisY])} r="2.6" className="p-dot" />))}
        <polyline points={view.front.map((i) => `${view.sx(pool[i][axisX])},${view.sy(pool[i][axisY])}`).join(' ')} className="p-front" />
        {pool.map((p, i) => (topSet.has(poolKeys[i]) && poolKeys[i] !== selectedKey ? <circle key={`t${i}`} cx={view.sx(p[axisX])} cy={view.sy(p[axisY])} r="5" className="p-top" /> : null))}
        {pool.map((p, i) => (poolKeys[i] === selectedKey ? <circle key={`s${i}`} cx={view.sx(p[axisX])} cy={view.sy(p[axisY])} r="7" className="p-sel" /> : null))}
      </svg>
      <p className="note">Click a point to view that template. Filled rings are the ranked results, the line is the frontier: no template does better on both stats.</p>
    </div>
  );
}
