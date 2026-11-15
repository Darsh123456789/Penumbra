import { useEffect, useMemo, useState } from 'react';
import { json, loadDsn, loadEphem, loadHorizons, horizonAtIndex, nearestIndex, simulate, PRESETS, fmtH, type Dsn, type Ephem, type HorizonGrid, type SimResult } from './engine';
import { Panorama, Timeline } from './charts';

export const SITES = [
  { key: 'shackleton', name: 'Shackleton rim' },
  { key: 'malapert', name: 'Malapert massif' },
  { key: 'leibnitz_beta', name: 'Leibnitz beta / Mons Mouton' },
];
const POINTS = [['best', 'Best-lit point'], ['good', 'Top 5% point'], ['typical', 'Typical point'], ['poor', 'Poor point']];
const YEAR0 = Date.UTC(2027, 0, 1);
export const dayIso = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 19);
const dayLabel = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 10);
const PLANNED = 44; // 2027-02-14

function Card({ title, sub, m, warn }: { title: string; sub: string; m: any; warn?: boolean }) {
  if (!m) return <div className="card"><b>{title}</b><span className="mute">loading…</span></div>;
  const tone = m.survives ? 'var(--good)' : 'var(--bad)';
  const bars: [string, number, string][] = [['Sunlit', m.sunlit_pct, 'var(--sun)'], ['Earth in view', m.earth_pct, 'var(--earth)'], ['Both', m.both_pct, 'var(--ink)'], ['Direct-to-Earth link', m.link_pct, 'var(--earth2)']];
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
        <div><span style={{ color: 'var(--sun)' }}>Sunset in</span><span>{fmtH(m.sunset_in_h, 'none in 14 d')}</span></div>
        <div><span style={{ color: 'var(--earth2)' }}>Earthset in</span><span>{fmtH(m.earthset_in_h, 'none in 14 d')}</span></div>
      </div>
      {bars.map(([l, v, c]) => (
        <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span className="mute">{l}</span><span className="mono">{v.toFixed(0)}%</span></div>
          <div className="bar"><div style={{ width: `${v}%`, background: c }} /></div>
        </div>))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <span className="mute">Longest night / longest blackout</span><span className="mono">{fmtH(m.longest_night_h)} / {fmtH(m.longest_blackout_h)}</span></div>
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
  const [preset, setPreset] = useState(q0.get('lander') ?? 'medium_vertical');
  const [day, setDay] = useState(q0.has('day') ? Math.min(364, Math.max(0, +q0.get('day')!)) : PLANNED + 12);
  const [copied, setCopied] = useState(false);
  useEffect(() => { history.replaceState(null, '', `#board?site=${site}&pt=${point}&lander=${preset}&day=${day}`); }, [site, point, preset, day]);
  const [slip, setSlip] = useState<Record<string, any>>({});
  const [eng, setEng] = useState<{ e: Ephem; d: Dsn; g: HorizonGrid; site: string } | null>(null);

  useEffect(() => { Promise.all(SITES.map(s => json(`slip_${s.key}.json`))).then(a => setSlip(Object.fromEntries(a.map(x => [x.site, x])))); }, []);
  useEffect(() => { Promise.all([loadEphem(), loadDsn(), loadHorizons(site)]).then(([e, d, g]) => setEng({ e, d, g, site })); }, [site]);

  const metric = (s: string, pt: string, dd: number) => {
    const c = slip[s]?.points?.[pt]?.by_preset?.[preset]; if (!c) return null;
    const o: any = {}; for (const k of Object.keys(c)) o[k] = c[k][dd]; return o;
  };
  const pinfo = slip[site]?.points?.[point];
  const live: SimResult | null = useMemo(() => {
    if (!eng || !pinfo || eng.site !== site) return null;
    const k = nearestIndex(eng.g, pinfo.lat, pinfo.lon);
    return simulate(eng.e, eng.d, horizonAtIndex(eng.g, k), pinfo.lat, pinfo.lon, dayIso(day), 14, PRESETS[preset]);
  }, [eng, pinfo, day, preset]);
  const H = useMemo(() => (eng && pinfo && eng.site === site ? horizonAtIndex(eng.g, nearestIndex(eng.g, pinfo.lat, pinfo.lon)) : null), [eng, pinfo, site]);
  const survCol = slip[site]?.points?.[point]?.by_preset?.[preset]?.survives as boolean[] | undefined;
  const py = metric(site, point, day);
  const siteName = SITES.find(s => s.key === site)!.name;
  const others = SITES.filter(s => s.key !== site);

  return (<>
    <section className="panel">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">Site (NASA LOLA 5 m terrain)<select value={site} onChange={e => setSite(e.target.value)}>{SITES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
        <label className="field">Point on the site<select value={point} onChange={e => setPoint(e.target.value)}>{POINTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field">Lander (generic, editable in pipeline/presets.json)<select value={preset} onChange={e => setPreset(e.target.value)}>{Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
        {pinfo && <span className="mono small mute">{pinfo.lat.toFixed(3)}°, {pinfo.lon.toFixed(2)}°E · {Math.round(pinfo.z_m)} m · sunlit {pinfo.sun_pct_2027.toFixed(1)}% of 2027</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>Launch slipped? Drag to re-plan every card at once</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => { navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Link copied' : 'Copy share link'}</button>
          <button className="ghost" disabled={!live} onClick={() => live && pinfo && download(`penumbra_${site}_${point}_${dayLabel(day)}.csv`,
            'hour,sun_visible_fraction,sun_az_deg,sun_el_deg,earth_az_deg,earth_el_deg,earth_above_terrain,dsn_sees_moon,link,battery_soc\n' +
            live.series.t_h.map((t, i) => [t.toFixed(3), live.series.f_sun[i].toFixed(3), live.series.sun_az[i].toFixed(2), live.series.sun_el[i].toFixed(3), live.series.earth_az[i].toFixed(2), live.series.earth_el[i].toFixed(3), +live.series.earth_up[i], +live.series.dsn[i], +live.series.link[i], live.series.soc[i].toFixed(4)].join(',')).join('\n'), 'text/csv')}>Export timeline (CSV)</button>
          <button className="ghost" disabled={!live} onClick={() => live && pinfo && download(`penumbra_${site}_${point}_${dayLabel(day)}.json`, JSON.stringify({
            scenario: { site, point, lat: pinfo.lat, lon: pinfo.lon, landing_utc: dayIso(day), mission_days: 14, lander: PRESETS[preset] },
            result: Object.fromEntries(Object.entries(live).filter(([k]) => k !== 'series')),
            sources: 'NASA LRO LOLA (PGDA 78, 90), NASA/JPL NAIF SPICE DE440, DSN complexes; PENUMBRA pipeline', generated_utc: new Date().toISOString() }, null, 2), 'application/json')}>Export scenario (JSON)</button>
        </div>
        <span className="mute">Planned landing <b className="mono">{dayLabel(PLANNED)}</b> · now <b className="mono" style={{ color: 'var(--sun)' }}>{dayLabel(day)}</b> ({day - PLANNED >= 0 ? '+' : ''}{day - PLANNED} days)</span>
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }} aria-hidden="true">
        {(survCol ?? []).map((s, i) => <div key={i} style={{ flex: 1, background: s ? 'var(--good)' : 'var(--crit)', opacity: i === day ? 1 : 0.75 }} />)}
      </div>
      <input type="range" min={0} max={364} value={day} onChange={e => setDay(+e.target.value)} aria-label="Landing date in 2027" />
      <span className="small mute">Track: green = a 14-day mission survives if it lands that day (00:00 UTC), red = battery fails. {survCol && `${survCol.filter(Boolean).length} of 365 days survive for this point and lander.`}</span>
    </section>

    <section className="cards">
      <Card title={siteName} sub={`${dayLabel(PLANNED)} · planned`} m={metric(site, point, PLANNED)} />
      <Card title={siteName} sub={`${dayLabel(day)} · ${day - PLANNED >= 0 ? '+' : ''}${day - PLANNED} d`} m={py} warn={!!py && !py.survives} />
      {others.map(o => <Card key={o.key} title={o.name} sub={`${dayLabel(day)} · best-lit point`} m={metric(o.key, 'best', day)} />)}
    </section>

    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>360° horizon from {siteName} ({POINTS.find(p => p[0] === point)![1].toLowerCase()}), panel height 2 m</h2>
        <span className="small mute">Real LOLA horizon, no atmosphere so no refraction · Sun and Earth paths for the 14 days from {dayLabel(day)}</span>
      </div>
      {H && live ? <Panorama H={H} res={live} /> : <span className="mute">computing…</span>}
    </section>

    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2>First 14 days after landing on {dayLabel(day)}</h2>
        {live && py && <span className="small mute">Computed live in your browser · matches the Python pipeline: sunlit {live.sunlit_pct.toFixed(1)}% vs {py.sunlit_pct}%, survives {String(live.survives)} vs {String(py.survives)}</span>}
      </div>
      {live ? <Timeline res={live} /> : <span className="mute">computing…</span>}
    </section>
  </>);
}
