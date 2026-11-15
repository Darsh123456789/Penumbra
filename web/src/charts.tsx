import { useEffect, useRef, useState } from 'react';
import type { SimResult } from './engine';

export function Panorama({ H, res, height = 240, relay }: { H: Float64Array; res: SimResult; height?: number; relay?: { az: number[]; el: number[]; up: boolean[] } }) {
  const W = 1200, top = 18, bot = height - 30;
  const s = res.series;
  const els = [...Array.from(H), ...s.sun_el, ...s.earth_el];
  const lo = Math.floor(Math.min(-1, ...els) - 0.5), hi = Math.ceil(Math.max(4, ...els) + 1.5);
  const X = (az: number) => 40 + (az / 360) * (W - 60);
  const Y = (el: number) => top + (hi - el) / (hi - lo) * (bot - top);
  const ridge = Array.from(H).map((h, a) => `${X(a + 0.5).toFixed(1)},${Y(h).toFixed(1)}`).join(' ');
  const ticks = []; for (let e = Math.ceil(lo); e <= hi; e += Math.max(1, Math.round((hi - lo) / 6))) ticks.push(e);
  const step = 6; // every hour
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Horizon panorama with Sun and Earth paths" style={{ width: '100%', height: 'auto' }}>
      <rect x="0" y="0" width={W} height={height} fill="#0B0E14" rx="8" />
      {ticks.map(e => <g key={e}><line x1="40" x2={W - 20} y1={Y(e)} y2={Y(e)} stroke="#232A3B" strokeDasharray="4 4" /><text x="6" y={Y(e) + 4} fill="#9AA3B5" fontSize="11">{e}°</text></g>)}
      <polygon points={`${X(0)},${bot} ${ridge} ${X(360)},${bot}`} fill="#1A2030" stroke="#5B6478" strokeWidth="1.5" />
      {s.sun_az.map((az, i) => i % step === 0 ? <circle key={'s' + i} cx={X(az)} cy={Y(s.sun_el[i])} r="2.2" fill={s.f_sun[i] > 0.5 ? '#F5B841' : '#6b5420'} /> : null)}
      {s.earth_az.map((az, i) => i % step === 0 ? <circle key={'e' + i} cx={X(az)} cy={Y(s.earth_el[i])} r="2" fill={s.earth_up[i] ? '#5AA9FF' : '#2a4a70'} /> : null)}
      {relay && relay.az.map((az, i) => relay.el[i] <= hi && relay.el[i] >= lo ? <circle key={'r' + i} cx={X(az)} cy={Y(relay.el[i])} r="1.8" fill={relay.up[i] ? '#C08CFF' : '#4a3a66'} /> : null)}
      {relay && <text x="44" y="12" fill="#C08CFF" fontSize="11">Relay (what-if): {Math.round(100 * relay.el.filter(e => e > hi).length / Math.max(1, relay.el.length))}% of hours above the top of this chart (&gt; {hi}°)</text>}
      <circle cx={X(s.sun_az[0])} cy={Y(s.sun_el[0])} r="7" fill="#F5B841" />
      <text x={X(s.sun_az[0]) + 10} y={Y(s.sun_el[0]) - 8} fill="#F5B841" fontSize="12" fontWeight="600">Sun at landing {s.sun_el[0].toFixed(1)}°</text>
      <circle cx={X(s.earth_az[0])} cy={Y(s.earth_el[0])} r="6" fill="#5AA9FF" />
      <text x={X(s.earth_az[0]) + 10} y={Y(s.earth_el[0]) - 8} fill="#7DB8FF" fontSize="12" fontWeight="600">Earth {s.earth_el[0].toFixed(1)}°</text>
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270], ['N', 360]].map(([l, a]) => <text key={String(a)} x={X(a as number) - 4} y={height - 10} fill="#9AA3B5" fontSize="11">{l}</text>)}
      <text x={W - 20} y="12" fill="#9AA3B5" fontSize="11" textAnchor="end">bright dots = Sun / Earth visible · dim = behind terrain · hourly</text>
    </svg>);
}

export function Timeline({ res, relayOnly }: { res: SimResult; relayOnly?: boolean[] }) {
  const s = res.series, n = s.t_h.length, W = 1200, L = 150;
  const X = (i: number) => L + (i / n) * (W - L - 10);
  const rows: [string, boolean[], string][] = [
    ['Sun (≥ half disc)', s.f_sun.map(f => f > 0.5), '#F5B841'], ['Earth above terrain', s.earth_up, '#5AA9FF'],
    ['DSN sees the Moon', s.dsn, '#3D7ACC'], ['Direct-to-Earth link', s.link, '#7DB8FF'],
    ...(relayOnly ? [['Relay-only link (what-if)', relayOnly, '#C08CFF'] as [string, boolean[], string]] : []),
  ];
  const dy = relayOnly ? 34 : 0;
  const segs = (b: boolean[]) => { const out: [number, number][] = []; let st = -1; b.forEach((v, i) => { if (v && st < 0) st = i; if ((!v || i === n - 1) && st >= 0) { out.push([st, v ? i + 1 : i]); st = -1; } }); return out; };
  const socY = (v: number) => 170 + dy + (1 - v) * 60;
  return (
    <svg viewBox={`0 0 ${W} ${260 + dy}`} role="img" aria-label="Mission timeline: sunlight, Earth, DSN, link and battery" style={{ width: '100%', height: 'auto' }}>
      {rows.map(([l, b, c], r) => <g key={l}>
        <text x="0" y={22 + r * 34} fill="#9AA3B5" fontSize="12">{l}</text>
        <rect x={L} y={8 + r * 34} width={W - L - 10} height="20" fill="#0F131C" rx="4" />
        {segs(b).map(([a, z]) => <rect key={a} x={X(a)} y={8 + r * 34} width={Math.max(1, X(z) - X(a))} height="20" fill={c} />)}
      </g>)}
      <text x="0" y={200 + dy} fill="#9AA3B5" fontSize="12">Battery charge</text>
      <rect x={L} y={170 + dy} width={W - L - 10} height="60" fill="#0F131C" rx="4" />
      <line x1={L} x2={W - 10} y1={socY(0.2)} y2={socY(0.2)} stroke="#E0663F" strokeDasharray="4 4" />
      <polyline fill="none" stroke={res.survives ? '#3BA776' : '#E0663F'} strokeWidth="2" points={s.soc.filter((_, i) => i % 3 === 0).map((v, k) => `${X(k * 3).toFixed(1)},${socY(v).toFixed(1)}`).join(' ')} />
      {res.hours_to_floor !== null && (() => { const i0 = Math.round(res.hours_to_floor! / (s.t_h[1] || 1 / 6)); return <g>
        <rect x={X(i0)} y="4" width={Math.max(0, W - 10 - X(i0))} height={230 + dy} fill="#05070B" opacity="0.62" />
        <line x1={X(i0)} x2={X(i0)} y1="4" y2={234 + dy} stroke="#E0663F" strokeWidth="2" />
        <text x={X(i0) + (X(i0) > W - 420 ? -8 : 8)} y={162 + dy} fill="#FFB3AA" fontSize="12" fontWeight="600" textAnchor={X(i0) > W - 420 ? 'end' : 'start'}>Battery floor at {Math.round(res.hours_to_floor!)} h: mission lost (no recovery assumed after this)</text></g>; })()}
      {[0, 3.5, 7, 10.5, 14].map(d => <text key={d} x={X((d / 14) * n)} y={252 + dy} fill="#9AA3B5" fontSize="11" textAnchor={d === 0 ? 'start' : d === 14 ? 'end' : 'middle'}>day {d}</text>)}
    </svg>);
}

export function Heatmap({ p, n, cell, half, radius, marks }: { p: number[]; n: number; cell: number; half: number; radius: number; marks: { x: number; y: number; label: string; kind: 'aim' | 'safer' | 'mark' }[] }) {
  const S = 460, px = S / n, sc = (v: number) => (v + half + cell / 2) / (2 * half + cell) * S;
  const col = (v: number) => v >= 0.8 ? '#3BA776' : v >= 0.6 ? '#8FD0A8' : v >= 0.4 ? '#F5B841' : v >= 0.2 ? '#E0663F' : '#B23A30';
  return (
    <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Survival probability heatmap inside the landing ellipse" style={{ width: '100%', maxWidth: 560, height: 'auto' }}>
      {p.map((v, k) => <rect key={k} x={(k % n) * px} y={S - (Math.floor(k / n) + 1) * px} width={px + 0.3} height={px + 0.3} fill={col(v)} />)}
      <circle cx={sc(0)} cy={S - sc(0)} r={radius / (2 * half + cell) * S} fill="none" stroke="#E6E9F0" strokeWidth="2" strokeDasharray="6 5" />
      {marks.map(m => <g key={m.label}>
        {m.kind === 'aim' && <circle cx={sc(m.x)} cy={S - sc(m.y)} r="8" fill="none" stroke="#fff" strokeWidth="2.5" />}
        {m.kind === 'safer' && <path d={`M${sc(m.x)} ${S - sc(m.y) - 9}l8 14h-16z`} fill="#5AA9FF" stroke="#05070B" />}
        {m.kind === 'mark' && <rect x={sc(m.x) - 6} y={S - sc(m.y) - 6} width="12" height="12" transform={`rotate(45 ${sc(m.x)} ${S - sc(m.y)})`} fill="#fff" />}
        <text x={sc(m.x) + 12} y={S - sc(m.y) + 4} fill="#fff" fontSize="12" fontWeight="600" stroke="#05070B" strokeWidth="3" paintOrder="stroke">{m.label}</text>
      </g>)}
    </svg>);
}

export function Lines({ t, series, floor, height = 200 }: { t: number[]; series: { name: string; v: number[]; color: string; lostAt?: number | null }[]; floor?: number; height?: number }) {
  const W = 900, L = 44, tmax = t[t.length - 1] || 1;
  const X = (x: number) => L + (x / tmax) * (W - L - 10), Y = (v: number) => 10 + (1 - v) * (height - 40);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Battery state of charge over time" style={{ width: '100%', height: 'auto' }}>
      <rect x={L} y="10" width={W - L - 10} height={height - 40} fill="#0F131C" />
      {[0, 0.5, 1].map(v => <text key={v} x={L - 6} y={Y(v) + 4} fill="#9AA3B5" fontSize="11" textAnchor="end">{v * 100}%</text>)}
      {floor !== undefined && <line x1={L} x2={W - 10} y1={Y(floor)} y2={Y(floor)} stroke="#E0663F" strokeDasharray="5 5" />}
      {series.map(s => { const cut = s.lostAt === null || s.lostAt === undefined ? t.length : t.findIndex(x => x >= s.lostAt!) + 1; return <g key={s.name}>
        <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={s.v.slice(0, cut).map((v, i) => `${X(t[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} />
        {cut < t.length && <><polyline fill="none" stroke={s.color} strokeWidth="1.2" strokeDasharray="3 5" opacity="0.45" points={s.v.slice(cut - 1).map((v, i) => `${X(t[i + cut - 1]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} />
          <text x={X(t[cut - 1]) + 8} y={Y(0) - 8} fill={s.color} fontSize="12" fontWeight="600">mission lost at {Math.round(s.lostAt!)} h · dashed = what the battery would do if the lander revived</text></>}
      </g>; })}
      {series.map((s, i) => <text key={s.name} x={W - 14} y={24 + 16 * i} fill={s.color} fontSize="12" fontWeight="600" textAnchor="end">{s.name}</text>)}
      <text x={L} y={height - 8} fill="#9AA3B5" fontSize="11">0 h</text><text x={W - 10} y={height - 8} fill="#9AA3B5" fontSize="11" textAnchor="end">{Math.round(tmax)} h</text>
    </svg>);
}

// Site map: every one of the 96 x 96 horizon points, coloured by a 2027 metric; click to analyse that exact spot.
export type MapMode = 'sun' | 'earth' | 'both' | 'slope';
const ramp = (stops: [number, number, number][], t: number) => {
  t = Math.min(1, Math.max(0, t)); const k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1))), f = t * (stops.length - 1) - k;
  return stops[k].map((a, i) => Math.round(a + (stops[k + 1][i] - a) * f)) as [number, number, number];
};
const SUNR: [number, number, number][] = [[12, 15, 22], [60, 40, 30], [178, 90, 40], [245, 184, 65], [255, 243, 214]];
const EARR: [number, number, number][] = [[12, 15, 22], [25, 55, 95], [60, 120, 200], [140, 200, 255]];
export function SiteMap({ n, vals, slope, mode, landableOnly, limit, sel, marks, onPick }: {
  n: number; vals: (number | null)[]; slope: (number | null)[]; mode: MapMode; landableOnly: boolean; limit: number;
  sel: number | null; marks: { k: number; label: string }[]; onPick: (k: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
    const vmax = mode === 'slope' ? 30 : Math.max(1, ...vals.map(v => v ?? 0));
    for (let k = 0; k < n * n; k++) {
      const i = k % n, j = Math.floor(k / n), row = n - 1 - j, o = 4 * (row * n + i), v = vals[k] ?? 0, s = slope[k];
      let rgb: [number, number, number];
      if (mode === 'slope') rgb = s === null ? [40, 40, 40] : s < limit ? [59, 167, 118] : s < 15 ? [245, 184, 65] : [178, 58, 48];
      else rgb = ramp(mode === 'earth' ? EARR : SUNR, v / vmax);
      if (landableOnly && mode !== 'slope' && (s === null || s >= limit)) rgb = rgb.map(a => Math.round(a * 0.22 + 10)) as [number, number, number];
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [n, vals, slope, mode, landableOnly, limit]);
  const pos = (k: number) => ({ x: (k % n) + 0.5, y: n - 1 - Math.floor(k / n) + 0.5 });
  const kAt = (ev: React.MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor((ev.clientX - r.left) / r.width * n)));
    const row = Math.min(n - 1, Math.max(0, Math.floor((ev.clientY - r.top) / r.height * n)));
    return (n - 1 - row) * n + i;
  };
  const h = hover ?? sel;
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520, width: '100%' }}>
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', cursor: 'crosshair', borderRadius: 8, overflow: 'hidden' }}
      onClick={ev => onPick(kAt(ev))} onMouseMove={ev => setHover(kAt(ev))} onMouseLeave={() => setHover(null)}
      role="img" aria-label="Site map; click a point to analyse it">
      <canvas ref={ref} width={n} height={n} style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
      <svg viewBox={`0 0 ${n} ${n}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {marks.map(m => { const p = pos(m.k); return <g key={m.label}><rect x={p.x - 1.2} y={p.y - 1.2} width="2.4" height="2.4" transform={`rotate(45 ${p.x} ${p.y})`} fill="#fff" stroke="#05070B" strokeWidth="0.4" />
          <text x={p.x + 2} y={p.y + 1} fill="#fff" fontSize="3" fontWeight="600" stroke="#05070B" strokeWidth="0.6" paintOrder="stroke">{m.label}</text></g>; })}
        {sel !== null && (() => { const p = pos(sel); return <g><circle cx={p.x} cy={p.y} r="2.2" fill="none" stroke="#5AA9FF" strokeWidth="0.7" /><line x1={p.x - 4} x2={p.x + 4} y1={p.y} y2={p.y} stroke="#5AA9FF" strokeWidth="0.35" /><line y1={p.y - 4} y2={p.y + 4} x1={p.x} x2={p.x} stroke="#5AA9FF" strokeWidth="0.35" /></g>; })()}
      </svg>
    </div>
    <span className="mono small mute" style={{ minHeight: 18 }}>{h !== null ? `point #${h}${mode === 'slope' ? '' : ` · ${({ sun: 'sunlit', earth: 'Earth in view', both: 'Sun + Earth' } as Record<string, string>)[mode]} ${(vals[h] ?? 0).toFixed(1)}% of 2027`} · slope ${slope[h] ?? '—'}°${(slope[h] ?? 99) < limit ? ' (landable)' : ' (too steep)'}` : 'hover to inspect, click to analyse'}</span>
  </div>);
}
