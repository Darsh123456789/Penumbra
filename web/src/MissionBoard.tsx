import { useEffect, useMemo, useState } from 'react';
import { utcToEt, siteVector, enu, json, optionalJson, loadGrid, gridXY, xyToLatLon, survivalYear, type PointGrid, loadDsn, loadEphem, loadHorizons, horizonAtIndex, nearestIndex, simulate, bareMoonDip, PRESETS, fmtH, type Dsn, type Ephem, type HorizonGrid, type Preset, type SimResult } from './engine';
import { FIELDS, LAYOUTS, shown, setField, fromPreset, encode, decode, loadStored, store, peakSolarW, neverCharges } from './lander';
import { Panorama, Timeline, SiteMap, type MapMode } from './charts';
import { relayFn, relayAbovePct, relayState, RELAY_LABEL, ELEMENT_NOTES, type RelayMode } from './relay';

export const SITES = [
  { key: 'shackleton', name: 'Shackleton rim' },
  { key: 'malapert', name: 'Malapert massif' },
  { key: 'leibnitz_beta', name: 'Leibnitz beta / Mons Mouton' },
  { key: 'haworth', name: 'Haworth (Artemis III region)' },
  { key: 'nobile_rim_2', name: 'Nobile Rim 2 (Artemis III region)' },
];
const POINTS = [['best', 'Best-lit point'], ['good', 'Top 5% point'], ['typical', 'Typical point'], ['poor', 'Poor point']];
const YEAR0 = Date.UTC(2027, 0, 1);
export const dayIso = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 19);
const dayLabel = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 10);
const PLANNED = 44; // 2027-02-14
// last Mission Board selection, read by the "Stand on the rim" view
export const boardSelection: { site: string; lat: number; lon: number; k: number | null; label: string } | { site: null } = { site: null } as any;
const ptLabel = (pt: string, k: number | null) => pt === 'custom' ? `Your point #${k}` : (POINTS.find(p => p[0] === pt)?.[1] ?? pt);

function riseSet(kind: 'Sun' | 'Earth', m: any) {
  const upKey = kind === 'Sun' ? 'sun_up_at_start' : 'earth_up_at_start';
  const setKey = kind === 'Sun' ? 'sunset_in_h' : 'earthset_in_h';
  const riseKey = kind === 'Sun' ? 'sunrise_in_h' : 'earthrise_in_h';
  const up = m[upKey] ?? (m[setKey] === null || m[setKey] > 0);
  if (up) return [`${kind === 'Sun' ? 'Sunset' : 'Earthset'} in`, fmtH(m[setKey], 'none in 14 d')];
  if (m[riseKey] !== undefined) return [`${kind} down · rises in`, fmtH(m[riseKey], 'not in 14 d')];
  return [`${kind} at landing`, 'below horizon'];
}

function Card({ title, sub, m, warn, slope, rm }: { title: string; sub: string; m: any; warn?: boolean; slope?: number; rm?: SimResult | null }) {
  if (!m) return <div className="card"><b>{title}</b><span className="mute">loading…</span></div>;
  const tone = m.survives ? 'var(--good)' : 'var(--bad)';
  const bars: [string, number, string][] = [['Sunlit', m.sunlit_pct, 'var(--sun)'], ['Earth in view', m.earth_pct, 'var(--earth)'], ['Both', m.both_pct, 'var(--ink)'], rm ? ['Link (Earth direct + relay)', rm.link_pct, 'var(--earth2)'] : ['Direct-to-Earth link', m.link_pct, 'var(--earth2)']];
  return (
    <article className={'card' + (warn ? ' warn' : '')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div><div style={{ fontWeight: 600 }}>{title}</div><div className="mono small mute">{sub}</div></div>
        <span className="badge" style={{ background: tone }}>{m.survives ? 'Survives 14 d' : 'Battery fails'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="big" style={{ color: tone }}>{m.survives ? 'Alive' : fmtH(m.hours_to_floor)}</span>
        <span className="mute small">{m.survives ? `lowest battery ${Math.round(100 * m.min_soc)}%` : 'until battery floor'}</span>
      </div>
      <div className="kv">
        {(() => { const [l, v] = riseSet('Sun', m); return <div><span style={{ color: 'var(--sun)' }}>{l}</span><span>{v}</span></div>; })()}
        {(() => { const [l, v] = riseSet('Earth', m); return <div><span style={{ color: 'var(--earth2)' }}>{l}</span><span>{v}</span></div>; })()}
      </div>
      {bars.map(([l, v, c]) => (
        <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span className="mute">{l}</span><span className="mono">{v.toFixed(0)}%</span></div>
          <div className="bar"><div style={{ width: `${v}%`, background: c }} /></div>
          {rm && l.startsWith('Link') && <span className="small mute">was {m.link_pct.toFixed(0)}% direct only (relay is a what-if)</span>}
        </div>))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <span className="mute">Longest night / longest blackout</span><span className="mono">{fmtH(m.longest_night_h)} / {fmtH(rm ? rm.longest_blackout_h : m.longest_blackout_h, '0h')}{rm && <span className="mute"> (direct only {fmtH(m.longest_blackout_h, '0h')})</span>}</span></div>
      {slope !== undefined && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span className="mute">Local slope (5 m LOLA)</span>
        <span className="mono" style={{ color: slope < 8 ? 'var(--ink)' : 'var(--bad)' }}>{slope.toFixed(1)}° {slope < 8 ? '· landable' : '· above 8° limit'}</span></div>}
    </article>);
}

const q0 = new URLSearchParams(location.hash.split('?')[1] ?? '');

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function MissionBoard() {
  const [site, setSite] = useState(q0.get('site') ?? 'shackleton');
  const [point, setPoint] = useState(q0.get('pt') ?? 'best');
  const qL = q0.get('lander') === 'custom' ? decode(q0.get('L')) : null;   // malformed -> null -> medium_vertical
  const [preset, setPreset] = useState(() => { const l = q0.get('lander') ?? 'medium_vertical'; return l === 'custom' ? (qL ? 'custom' : 'medium_vertical') : (PRESETS[l] ? l : 'medium_vertical'); });
  const [draft, setDraft] = useState<Preset>(() => qL ?? loadStored() ?? fromPreset('medium_vertical'));
  const [custom, setCustom] = useState<Preset>(draft);           // debounced copy that drives every simulation
  useEffect(() => { const t = setTimeout(() => { setCustom(draft); store(draft); }, 250); return () => clearTimeout(t); }, [draft]);
  const [editOpen, setEditOpen] = useState(preset === 'custom');
  const isCL = preset === 'custom';
  const lander: Preset = isCL ? custom : PRESETS[preset];
  const lkey = isCL ? encode(custom) : preset;
  const edit = (p: Preset) => { setDraft(p); setPreset('custom'); };
  const [day, setDay] = useState(q0.has('day') ? Math.min(364, Math.max(0, +q0.get('day')!)) : PLANNED + 12);
  const [pk, setPk] = useState<number | null>(q0.has('k') ? Math.min(9215, Math.max(0, Math.round(+q0.get('k')!))) : null);
  const [copied, setCopied] = useState(false);
  const [grid, setGrid] = useState<PointGrid | null>(null);
  const [mode, setMode] = useState<MapMode>('sun');
  const [landableOnly, setLandableOnly] = useState(false);
  const [year, setYear] = useState<{ key: string; v: boolean[] } | null>(null);
  const [alts, setAlts] = useState<{ key: string; busy: boolean; list: any[]; n: number } | null>(null);
  const isCustom = point === 'custom' && pk !== null;
  useEffect(() => { history.replaceState(null, '', `#board?site=${site}&pt=${point}${isCustom ? `&k=${pk}` : ''}&lander=${preset}&day=${day}`); }, [site, point, pk, preset, day]);
  useEffect(() => { setGrid(null); loadGrid(site).then(setGrid).catch(() => setGrid(null)); }, [site]);
  const pickPoint = (k: number) => { setPk(k); setPoint('custom'); };
  const [relay, setRelay] = useState<RelayMode>('off');
  useEffect(() => { history.replaceState(null, '', `#board?site=${site}&pt=${point}${isCustom ? `&k=${pk}` : ''}&lander=${preset}${isCL ? `&L=${encode(custom)}` : ''}&day=${day}`); }, [site, point, pk, preset, day, isCL, custom]);
  const [slip, setSlip] = useState<Record<string, any>>({});
  const [eng, setEng] = useState<{ e: Ephem; d: Dsn; g: HorizonGrid; site: string } | null>(null);
  const [meta, setMeta] = useState<any>(null);
  useEffect(() => { json('points_meta.json').then(setMeta).catch(() => setMeta(null)); }, []);

  useEffect(() => { Promise.all(SITES.map(s => optionalJson(`slip_${s.key}.json`))).then(a => setSlip(Object.fromEntries(a.filter(Boolean).map((x: any) => [x.site, x])))); }, []);
  useEffect(() => { Promise.all([loadEphem(), loadDsn(), loadHorizons(site)]).then(([e, d, g]) => setEng({ e, d, g, site })); }, [site]);

  const metric = (s: string, pt: string, dd: number) => {
    const c = slip[s]?.points?.[pt]?.by_preset?.[preset]; if (!c) return null;
    const o: any = {}; for (const k of Object.keys(c)) o[k] = c[k][dd]; return o;
  };
  const pinfo = useMemo(() => {
    if (point !== 'custom') return slip[site]?.points?.[point];
    if (!eng || eng.site !== site || !grid || pk === null) return undefined;
    const [x, y] = gridXY(eng.g, pk), [lat, lon] = xyToLatLon(x, y);
    return { lat, lon, z_m: grid.z_m[pk], sun_pct_2027: grid.sun[pk] };
  }, [point, slip, site, eng, grid, pk]);
  const idx = useMemo(() => (eng && pinfo && eng.site === site ? (isCustom ? pk! : nearestIndex(eng.g, pinfo.lat, pinfo.lon)) : null), [eng, pinfo, site, isCustom, pk]);
  const live: SimResult | null = useMemo(() => {
    if (!eng || !pinfo || idx === null) return null;
    return simulate(eng.e, eng.d, horizonAtIndex(eng.g, idx), pinfo.lat, pinfo.lon, dayIso(day), 14, lander, bareMoonDip(pinfo.z_m + 2));
  }, [eng, pinfo, idx, day, lander]);
  const livePlanned: SimResult | null = useMemo(() => {
    if (!eng || !pinfo || idx === null) return null;
    return simulate(eng.e, eng.d, horizonAtIndex(eng.g, idx), pinfo.lat, pinfo.lon, dayIso(PLANNED), 14, lander, bareMoonDip(pinfo.z_m + 2));
  }, [eng, pinfo, idx, lander]);
  // custom point: the whole 2027 survival track is computed live (365 landing days x 14-day missions)
  const yearKey = `${site}|${idx}|${lkey}`;
  useEffect(() => {
    if (!(isCustom || isCL) || !eng || !pinfo || idx === null) return;
    let stop = false;
    survivalYear(eng.e, eng.d, horizonAtIndex(eng.g, idx), pinfo.lat, pinfo.lon, lander, bareMoonDip(pinfo.z_m + 2), () => stop)
      .then(v => { if (v && !stop) setYear({ key: yearKey, v }); });
    return () => { stop = true; };
  }, [isCustom, isCL, eng, idx, yearKey]);
  const findAlternatives = async () => {
    if (!eng || !grid || !pinfo || idx === null) return;
    const key = `${site}|${idx}|${lkey}|${day}`, [x0, y0] = gridXY(eng.g, idx);
    const cand: { k: number; dist: number }[] = [];
    for (let k = 0; k < grid.n * grid.n; k++) {
      const sl = grid.slope[k]; if (sl === null || sl >= grid.landing_slope_limit_deg) continue;
      const [x, y] = gridXY(eng.g, k), dist = Math.hypot(x - x0, y - y0); if (dist <= 2000) cand.push({ k, dist });
    }
    setAlts({ key, busy: true, list: [], n: cand.length });
    const res: any[] = [];
    for (let c = 0; c < cand.length; c++) {
      if (c % 20 === 0) await new Promise(r => setTimeout(r, 0));
      const { k, dist } = cand[c], [x, y] = gridXY(eng.g, k), [lat, lon] = xyToLatLon(x, y);
      const r = simulate(eng.e, eng.d, horizonAtIndex(eng.g, k), lat, lon, dayIso(day), 14, lander, bareMoonDip(grid.z_m[k] + 2), undefined, true);
      res.push({ k, dist, survives: r.survives, hours_to_floor: r.hours_to_floor, slope: grid.slope[k], sun2027: grid.sun[k], min_soc: r.min_soc });
    }
    res.sort((a, b) => (+b.survives - +a.survives) || (a.survives ? a.dist - b.dist : (b.hours_to_floor ?? 0) - (a.hours_to_floor ?? 0)));
    setAlts({ key, busy: false, list: res, n: cand.length });
  };
    // relay what-if: separate runs, so the relay-off results above stay exactly as they were
  const relayRuns = useMemo(() => {
    if (relay === 'off' || !eng || !pinfo || idx === null) return null;
    const H0 = horizonAtIndex(eng.g, idx), P = lander, dip = bareMoonDip(pinfo.z_m + 2);
    const f = relayFn(relay, eng.e, eng.d, H0, pinfo.lat, pinfo.lon, P.earth_margin_deg ?? 1);
    return { now: simulate(eng.e, eng.d, H0, pinfo.lat, pinfo.lon, dayIso(day), 14, P, dip, f),
      planned: simulate(eng.e, eng.d, H0, pinfo.lat, pinfo.lon, dayIso(PLANNED), 14, P, dip, f),
      above: relayAbovePct(relay, eng.e, eng.d, H0, pinfo.lat, pinfo.lon, utcToEt(dayIso(day)), 14, P.earth_margin_deg ?? 1) ,
      track: (() => {   // hourly sky track of the relay(s) for the Panorama
        const S = siteVector(pinfo.lat, pinfo.lon), M = enu(pinfo.lat, pinfo.lon), et0 = utcToEt(dayIso(day)), t = { az: [] as number[], el: [] as number[], up: [] as boolean[] };
        for (const ph of relay === 'two' ? [0, 180] : [0]) for (let h = 0; h < 14 * 24; h++) { const r = relayState(eng.e, eng.d, H0, S, M, et0 + h * 3600, ph, P.earth_margin_deg ?? 1); t.az.push(r.az); t.el.push(r.el); t.up.push(r.aboveHorizon); }
        return t; })() };
  }, [relay, eng, pinfo, idx, day, lander]);
  const slopeOf = (s: string, pt: string) => (pt === 'custom' ? (s === site && grid && pk !== null ? grid.slope[pk] ?? undefined : undefined) : meta?.sites?.[s]?.[pt]?.slope_deg as number | undefined);
  const windows = useMemo(() => {
    const col = (isCustom || isCL) ? (year?.key === yearKey ? year.v : undefined) : slip[site]?.points?.[point]?.by_preset?.[preset]?.survives as boolean[] | undefined; if (!col) return [];
    const out: { start: number; len: number }[] = []; let st = -1;
    col.forEach((v, i) => { if (v && st < 0) st = i; if ((!v || i === col.length - 1) && st >= 0) { out.push({ start: st, len: (v ? i + 1 : i) - st }); st = -1; } });
    return out.sort((a, b) => b.len - a.len).slice(0, 4);
  }, [slip, site, point, preset, isCustom, isCL, year, yearKey]);
  const H = useMemo(() => (eng && idx !== null ? horizonAtIndex(eng.g, idx) : null), [eng, idx]);
  const survCol = (isCustom || isCL) ? (year?.key === yearKey ? year.v : undefined) : slip[site]?.points?.[point]?.by_preset?.[preset]?.survives as boolean[] | undefined;
  useEffect(() => { if (pinfo) Object.assign(boardSelection, { site, lat: pinfo.lat, lon: pinfo.lon, k: idx, label: ptLabel(point, pk) }); }, [site, pinfo, idx, point, pk]);
  const marks = useMemo(() => (eng && eng.site === site && slip[site] ? POINTS.map(([k, l]) => ({ k: nearestIndex(eng.g, slip[site].points[k].lat, slip[site].points[k].lon), label: l.replace(' point', '') })) : []), [eng, site, slip]);
  const mapVals = grid ? (mode === 'earth' ? grid.earth : mode === 'both' ? grid.both : mode === 'slope' ? grid.slope : grid.sun) : [];
  const py = isCL ? null : metric(site, point, day);   // never show a Python number for a lander it wasn't computed for
  const siteName = SITES.find(s => s.key === site)!.name;
  const others = SITES.filter(s => s.key !== site);
  // Custom lander: compare cards (other sites, best-lit point) are simulated live, 3 sims per change.
  const [grids, setGrids] = useState<Record<string, HorizonGrid>>({});
  useEffect(() => { if (!isCL) return; SITES.forEach(s => loadHorizons(s.key).then(g => setGrids(o => (o[s.key] ? o : { ...o, [s.key]: g })))); }, [isCL]);
  const otherLive = useMemo(() => {
    const out: Record<string, SimResult> = {};
    if (!isCL || !eng) return out;
    for (const o of SITES) {
      const g = grids[o.key], b = slip[o.key]?.points?.best; if (!g || !b || o.key === site) continue;
      out[o.key] = simulate(eng.e, eng.d, horizonAtIndex(g, nearestIndex(g, b.lat, b.lon)), b.lat, b.lon, dayIso(day), 14, custom, bareMoonDip(b.z_m + 2));
    }
    return out;
  }, [isCL, eng, grids, slip, day, custom, site]);
  const peak = peakSolarW(draft);

  return (<>
    <section className="panel">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">Site (NASA LOLA 5 m terrain)<select value={site} onChange={e => { setSite(e.target.value); if (point === 'custom') { setPoint('best'); setPk(null); } setAlts(null); }}>{SITES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
        <label className="field">Point on the site<select value={point} onChange={e => setPoint(e.target.value)}>{POINTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{pk !== null && <option value="custom">{`Your point #${pk} (picked on the map)`}</option>}</select></label>
        <label className="field">Lander (generic presets, or your own)<select value={preset} onChange={e => { setPreset(e.target.value); if (e.target.value === 'custom') setEditOpen(true); }}>{Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}<option value="custom">Custom (edit below)</option></select></label>
        <button className="ghost" aria-expanded={editOpen} onClick={() => setEditOpen(v => !v)}>{editOpen ? 'Close lander editor' : 'Edit lander'}</button>
        <label className="field">Add a south-pole relay (what-if)<select value={relay} onChange={e => setRelay(e.target.value as RelayMode)}>{(Object.keys(RELAY_LABEL) as RelayMode[]).map(k => <option key={k} value={k}>{RELAY_LABEL[k]}</option>)}</select></label>
        {pinfo && <span className="mono small mute">{pinfo.lat.toFixed(3)}°, {pinfo.lon.toFixed(2)}°E · {Math.round(pinfo.z_m)} m above datum · sunlit {pinfo.sun_pct_2027.toFixed(1)}% of 2027
          {slopeOf(site, point) !== undefined && <> · slope <b style={{ color: slopeOf(site, point)! < 8 ? 'var(--ink)' : 'var(--bad)' }}>{slopeOf(site, point)!.toFixed(1)}°{slopeOf(site, point)! < 8 ? '' : ' (too steep: over 8°)'}</b></>}</span>}
      </div>
      {editOpen && <div className="lander-editor">
        <div className="row small" style={{ gap: 8, alignItems: 'center' }}><span className="mute">Start from:</span>
          {Object.entries(PRESETS).map(([k, p]) => <button key={k} className="ghost" style={{ minHeight: 34, padding: '6px 10px' }} onClick={() => edit(fromPreset(k))}>{p.label.replace(' (generic)', '')}</button>)}
          <button className="ghost" style={{ minHeight: 34, padding: '6px 10px' }} onClick={() => edit(fromPreset('medium_vertical'))}>Reset</button></div>
        <div className="lander-grid">
          {FIELDS.map(f => <label key={f.key} className="field">{f.label}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <input key={shown(draft, f)} type="number" min={f.min} max={f.max} step={f.step} defaultValue={shown(draft, f)} style={{ width: 84, flex: 'none' }}
                onBlur={e => edit(setField(draft, f, parseFloat(e.target.value)))} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={f.label} />
              <input type="range" min={f.min} max={f.max} step={f.step} value={shown(draft, f)} style={{ flex: 1, minWidth: 0 }}
                onChange={e => edit(setField(draft, f, parseFloat(e.target.value)))} aria-label={f.label + ' slider'} />
            </div></label>)}
          <label className="field">Panel layout<select value={draft.panel_layout} onChange={e => edit({ ...draft, panel_layout: e.target.value })}>{LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <span className="small mute">Peak possible solar input (Sun face-on to a panel): {draft.panel_eff.toFixed(2)} × 1361 W/m² × {draft.panel_area_m2.toFixed(1)} m² = {Math.round(peak)} W vs load {draft.load_w} W.</span>
        {neverCharges(draft) && <span className="small" style={{ color: 'var(--bad)' }}>Load ≥ peak possible solar input: this lander can never charge.</span>}
      </div>}
      {isCL && <span className="small" style={{ color: 'var(--sun)' }}>Custom lander: computed live in your browser with the same engine as the Python pipeline; the pre-computed Python tracks below are replaced by live ones.</span>}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>Launch slipped? Drag to re-plan every card at once</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => { navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Link copied' : 'Copy share link'}</button>
          <button className="ghost" disabled={!live} onClick={() => live && pinfo && download(`penumbra_${site}_${isCustom ? 'pt' + pk : point}_${dayLabel(day)}.csv`,
            'hour,sun_visible_fraction,sun_az_deg,sun_el_deg,earth_az_deg,earth_el_deg,earth_above_terrain,dsn_sees_moon,link,battery_soc\n' +
            live.series.t_h.map((t, i) => [t.toFixed(3), live.series.f_sun[i].toFixed(3), live.series.sun_az[i].toFixed(2), live.series.sun_el[i].toFixed(3), live.series.earth_az[i].toFixed(2), live.series.earth_el[i].toFixed(3), +live.series.earth_up[i], +live.series.dsn[i], +live.series.link[i], live.series.soc[i].toFixed(4)].join(',')).join('\n'), 'text/csv')}>Export timeline (CSV)</button>
          <button className="ghost" disabled={!live} onClick={() => live && pinfo && download(`penumbra_${site}_${isCustom ? 'pt' + pk : point}_${dayLabel(day)}.json`, JSON.stringify({
            scenario: { site, point, grid_index: idx, lat: pinfo.lat, lon: pinfo.lon, landing_utc: dayIso(day), mission_days: 14, lander },
            result: Object.fromEntries(Object.entries(live).filter(([k]) => k !== 'series')),
            sources: 'NASA LRO LOLA (PGDA 78, 90), NASA/JPL NAIF SPICE DE440, DSN complexes; PENUMBRA pipeline', generated_utc: new Date().toISOString() }, null, 2), 'application/json')}>Export scenario (JSON)</button>
        </div>
        <span className="mute">Planned landing <b className="mono">{dayLabel(PLANNED)}</b> · now <b className="mono" style={{ color: 'var(--sun)' }}>{dayLabel(day)}</b> ({day - PLANNED >= 0 ? '+' : ''}{day - PLANNED} days)</span>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }} aria-hidden="true">
        {(survCol ?? []).map((s, i) => <div key={i} style={{ flex: 1, background: s ? 'var(--good)' : 'var(--crit)', opacity: i === day ? 1 : 0.75 }} />)}
      </div>
      <input type="range" min={0} max={364} value={day} onChange={e => setDay(+e.target.value)} aria-label="Landing date in 2027" />
      <span className="small mute">Track: green = a 14-day mission survives if it lands that day (00:00 UTC), red = battery fails. {survCol ? `${survCol.filter(Boolean).length} of 365 days survive for this point and lander${isCustom || isCL ? ' (all 365 computed live in your browser)' : ''}.` : (isCustom || isCL) ? 'Computing all 365 landing days live…' : ''}</span>
      {windows.length > 0 && <div className="row small" style={{ gap: 8, alignItems: 'center' }}><span className="mute">Longest survivable landing windows in 2027:</span>
        {windows.map(w => <button key={w.start} className="ghost" style={{ minHeight: 34, padding: '6px 10px' }} onClick={() => setDay(w.start)}>{dayLabel(w.start).slice(5)} → {dayLabel(w.start + w.len - 1).slice(5)} · {w.len} d</button>)}</div>}
    </section>

    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>Pick any spot: all 9,216 analysed points on {siteName}</h2>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <label className="field">Colour by<select value={mode} onChange={e => setMode(e.target.value as MapMode)}>
            <option value="sun">Sunlight, % of 2027</option><option value="earth">Earth in view, % of 2027</option><option value="both">Sun and Earth together</option><option value="slope">Landing slope (5 m LOLA)</option></select></label>
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={landableOnly} onChange={e => setLandableOnly(e.target.checked)} />Dim slopes over 8°</label>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        {grid && eng && eng.site === site ? <SiteMap n={grid.n} vals={mapVals} slope={grid.slope} mode={mode} landableOnly={landableOnly} limit={grid.landing_slope_limit_deg} sel={idx} marks={marks} onPick={pickPoint} /> : <span className="mute">loading map…</span>}
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="small mute">{eng ? `${((eng.g.x1 - eng.g.x0) / 1000).toFixed(1)} × ${((eng.g.y1 - eng.g.y0) / 1000).toFixed(1)} km, one point every ${Math.round((eng.g.x1 - eng.g.x0) / (eng.g.n - 1))} m. ` : ''}Polar stereographic, up = towards 0° longitude. Each point has its own 360° LOLA horizon ray-cast to 200 km; click one and every card, the slip track, the horizon panorama, the timeline, exports, the share link and “Stand on the rim” switch to that exact spot. Diamonds are the four reference points.</span>
          {mode === 'slope' ? <span className="small"><b style={{ color: 'var(--good)' }}>■</b> under 8° (landable) <b style={{ color: 'var(--sun)' }}>■</b> 8–15° <b style={{ color: 'var(--bad)' }}>■</b> over 15°</span>
            : <span className="small mute">Dark = rarely {mode === 'earth' ? 'sees Earth' : 'lit'}, bright = {mode === 'earth' ? 'Earth often above the horizon' : 'lit most of 2027'}{grid ? ` (max on this map ${Math.max(...mapVals.map(v => v ?? 0)).toFixed(1)}%)` : ''}.</span>}
          {grid && <span className="small mute">{grid.slope.filter(v => v !== null && v < grid.landing_slope_limit_deg).length.toLocaleString()} of {(grid.n * grid.n).toLocaleString()} points here are under the 8° landing limit.</span>}
          <div className="card" style={{ gap: 8 }}>
            <b>Plan B for this spot on {dayLabel(day)}</b>
            <span className="small mute">Re-simulates every landable point (slope under 8°) within 2 km of the selected point for this exact landing date and lander, then ranks survivors by distance.</span>
            <button className="primary" disabled={!eng || !grid || alts?.busy} onClick={findAlternatives}>{alts?.busy ? `Simulating ${alts.n} points…` : 'Find nearby spots that survive this date'}</button>
            {alts && !alts.busy && alts.key === `${site}|${idx}|${preset}|${day}` && (() => { const ok = alts.list.filter(a => a.survives); return <>
              <span className="small">{ok.length} of {alts.n} landable points within 2 km survive a {dayLabel(day)} landing{ok.length === 0 && alts.list[0] ? `; the longest-lasting fails after ${fmtH(alts.list[0].hours_to_floor)}` : ''}.</span>
              {alts.list.slice(0, 5).map(a => <button key={a.k} className="ghost" style={{ justifyContent: 'space-between', display: 'flex', minHeight: 34, padding: '6px 10px' }} onClick={() => pickPoint(a.k)}>
                <span className="mono small">#{a.k} · {Math.round(a.dist)} m away · {a.slope.toFixed(1)}°</span><span className="small" style={{ color: a.survives ? 'var(--good)' : 'var(--bad)' }}>{a.survives ? `survives, low ${Math.round(100 * a.min_soc)}%` : `fails ${fmtH(a.hours_to_floor)}`}</span></button>)}</>; })()}
            {alts && !alts.busy && alts.key !== `${site}|${idx}|${preset}|${day}` && <span className="small mute">Point, lander or date changed; run again.</span>}
          </div>
        </div>
      </div>
    </section>

    <section className="cards">
      <Card title={isCustom ? `${siteName} · #${pk}` : siteName} sub={`${dayLabel(PLANNED)} · planned`} m={livePlanned ?? metric(site, point, PLANNED)} slope={slopeOf(site, point)} rm={relayRuns?.planned} />
      <Card title={isCustom ? `${siteName} · #${pk}` : siteName} sub={`${dayLabel(day)} · ${day - PLANNED >= 0 ? '+' : ''}${day - PLANNED} d`} m={live ?? py} warn={!!(live ?? py) && !(live ?? py).survives} slope={slopeOf(site, point)} rm={relayRuns?.now} />
      {others.map(o => <Card key={o.key} title={o.name} sub={`${dayLabel(day)} · best-lit point`} m={isCL ? otherLive[o.key] ?? null : metric(o.key, 'best', day)} slope={slopeOf(o.key, 'best')} />)}
    </section>

    {live && <section className="panel">
      <h2>Engineering readout for {dayLabel(day)} · {lander.label}</h2>
      <div className="kv" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <div><span>Smallest battery that survives this date (sequent-peak)</span><span style={{ color: live.battery_needed_wh <= lander.battery_wh ? 'var(--good)' : 'var(--bad)' }}>{(live.battery_needed_wh / 1000).toFixed(1)} kWh vs {(lander.battery_wh / 1000).toFixed(1)} kWh fitted ({(live.battery_needed_wh / lander.battery_wh).toFixed(1)}×)</span></div>
        <div><span>Darkness: hidden by terrain / below a bare Moon's horizon</span><span>{fmtH(live.dark_terrain_h, '0h')} / {fmtH(live.dark_below_horizontal_h, '0h')}</span></div>
        <div><span>Earth out of view: blocked by terrain / below a bare Moon's horizon</span><span>{fmtH(live.earth_terrain_h, '0h')} / {fmtH(live.earth_below_horizontal_h, '0h')}</span></div>
        {relayRuns && <>
          <div><span>Longest comms blackout: direct only → with relay (what-if)</span><span style={{ color: 'var(--good)' }}>{fmtH(relayRuns.now.longest_blackout_no_relay_h, '0h')} → {fmtH(relayRuns.now.longest_blackout_h, '0h')}</span></div>
          <div><span>Time the relay alone carries the link</span><span>{relayRuns.now.relay_only_pct.toFixed(1)}% of 14 d</span></div>
          <div><span>Relay above the local terrain horizon (+1°)</span><span>{relayRuns.above.toFixed(1)}% of 14 d</span></div>
        </>}
        <div><span>Energy collected vs consumed (14 d)</span><span>{live.energy_in_kwh.toFixed(0)} / {live.load_kwh.toFixed(0)} kWh</span></div>
        <div><span>Sun elevation range vs bare-Moon horizon here</span><span>{live.sun_el_min.toFixed(2)}° to {live.sun_el_max.toFixed(2)}° · horizon {bareMoonDip(pinfo.z_m + 2).toFixed(2)}°</span></div>
        <div><span>Change vs planned date (sunlit / link)</span><span>{livePlanned ? `${(live.sunlit_pct - livePlanned.sunlit_pct >= 0 ? '+' : '')}${(live.sunlit_pct - livePlanned.sunlit_pct).toFixed(1)} / ${(live.link_pct - livePlanned.link_pct >= 0 ? '+' : '')}${(live.link_pct - livePlanned.link_pct).toFixed(1)} pts` : '—'}</span></div>
      </div>
      {relayRuns && <details className="small mute"><summary>Relay what-if assumptions: representative elliptical lunar frozen orbit (ELFO) in the style of ESA Lunar Pathfinder; not an operational ephemeris</summary>
        <table className="t"><tbody>{ELEMENT_NOTES.map(([k, v, src]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td><td>{src}</td></tr>)}</tbody></table>
        <span>Two-body Kepler orbit, held fixed in inertial space and turned with the Moon's 27.32-day rotation (no J2 or Earth perturbations, libration ignored; ~1° accuracy). A relay link needs the relay at least 1° above the LOLA horizon, a clear line from relay to Earth, and a DSN station seeing the Moon. Browser-only; not validated against the Python pipeline. Sources: Provenance panel on the Trust tab.</span></details>}
      <span className="small mute">Sequent-peak sizing: the largest drawdown of cumulative net energy (solar input × charge efficiency − load − heater) over the mission, divided by the usable fraction above the {Math.round(100 * lander.soc_floor)}% floor. A smooth, bare Moon seen from {Math.round(pinfo.z_m + 2)} m above the datum would put the horizon {Math.abs(bareMoonDip(pinfo.z_m + 2)).toFixed(2)}° below level; darkness with the Sun above that line is caused by real terrain{(live.dark_terrain_h + live.dark_below_horizontal_h) > 0 ? ` — ${Math.round(100 * live.dark_terrain_h / (live.dark_terrain_h + live.dark_below_horizontal_h))}% of this mission's darkness` : ''}.</span>
    </section>}

    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>360° horizon from {siteName} ({ptLabel(point, pk).toLowerCase()}), panel height 2 m</h2>
        <span className="small mute">Real LOLA horizon, no atmosphere so no refraction · Sun and Earth paths for the 14 days from {dayLabel(day)}</span>
      </div>
      {H && live ? <Panorama H={H} res={live} relay={relayRuns?.track} /> : <span className="mute">computing…</span>}
    </section>

    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>First 14 days after landing on {dayLabel(day)}</h2>
        {live && py && <span className="small mute">Computed live in your browser · matches the Python pipeline: sunlit {live.sunlit_pct.toFixed(1)}% vs {py.sunlit_pct}%, survives {String(live.survives)} vs {String(py.survives)}</span>}
      </div>
      {live ? <Timeline res={live} relayOnly={relayRuns ? relayRuns.now.series.link.map((v, i) => v && !live.series.link[i]) : undefined} /> : <span className="mute">computing…</span>}
    </section>
  </>);
}
