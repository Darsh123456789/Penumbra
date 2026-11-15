import { useEffect, useMemo, useRef, useState } from 'react';
import { json, optionalJson, loadDsn, loadEphem, loadHorizons, horizonAtIndex, nearestIndex, simulate, sky, horizonAt, utcToEt, PRESETS, fmtH } from './engine';
import { Heatmap, Lines } from './charts';
import { SITES, dayIso } from './MissionBoard';

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(d)}%`);
const Pending = ({ what }: { what: string }) => <div className="pending">{what} — results pending. This panel fills in automatically when the pipeline writes its file; nothing here is estimated.</div>;

// ------------------------------------------------------------------ Dispersion Cloud
const CASES = [['shackleton', 'Shackleton rim'], ['malapert', 'Malapert massif'], ['leibnitz_beta', 'Leibnitz beta / Mons Mouton'], ['im2_replay', 'IM-2 Athena replay (80 m terrain)']];
export function Dispersion() {
  const [cs, setCs] = useState('shackleton');
  const [d, setD] = useState<any>(null);
  const [pm, setPm] = useState<any>(null);
  useEffect(() => { setD(null); json(`dispersion_${cs}.json`).then(setD); }, [cs]);
  useEffect(() => { optionalJson('points_meta.json').then(setPm); }, []);
  const aimSlope = pm?.sites?.[cs]?.dispersion_aim?.slope_deg as number | undefined;
  const marks = d ? [{ x: 0, y: 0, label: `Aim · ${Math.round(100 * d.target_cell_p)}%`, kind: 'aim' as const },
    ...(d.safer_aim.distance_m > 0 ? [{ x: d.safer_aim.dx_m, y: d.safer_aim.dy_m, label: `Safer aim · ${Math.round(100 * d.safer_aim.expected_p)}%`, kind: 'safer' as const }] : []),
    ...Object.entries(d.marks || {}).map(([k, m]: any) => ({ x: m.dx_m, y: m.dy_m, label: k, kind: 'mark' as const }))] : [];
  return (<>
    <section className="panel">
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div><h1>The landing is a cloud, not a point</h1>
          <p className="mute" style={{ margin: '6px 0 0', maxWidth: 900, lineHeight: 1.5 }}>Thousands of possible touchdown points across the landing ellipse, each run on 10 versions of the terrain built from NASA's LOLA height-error maps. Each cell shows the chance a solar-powered lander keeps its battery above the survival floor for the whole mission.</p></div>
        <label className="field">Case<select value={cs} onChange={e => setCs(e.target.value)}>{CASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
    </section>
    {!d ? <span className="mute">loading…</span> : <>
      <div className="row">
        <section className="panel grow" style={{ flex: '2 1 520px' }}>
          <h2>Survival chance per {d.grid.cell_m} m cell</h2>
          <Heatmap p={d.p_cell} n={d.grid.n} cell={d.grid.cell_m} half={d.grid.half_box_m} radius={d.ellipse_radius_3sigma_m} marks={marks} />
          <div className="row small mute" style={{ gap: 10, alignItems: 'center' }}>
            {[['#B23A30', '0–20%'], ['#E0663F', '20–40%'], ['#F5B841', '40–60%'], ['#8FD0A8', '60–80%'], ['#3BA776', '80–100%']].map(([c, l]) => <span key={l}><span style={{ display: 'inline-block', width: 12, height: 12, background: c, borderRadius: 2, marginRight: 4, verticalAlign: -2 }} />{l}</span>)}
            <span>dashed circle = 3σ landing ellipse ({d.ellipse_radius_3sigma_m} m) · map grid: up = towards 0° longitude</span>
          </div>
        </section>
        <aside className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="panel">
            <span className="small mute">Mission survival across the cloud</span>
            <span className="big" style={{ fontSize: 52, color: d.p_survive > 0.8 ? 'var(--good)' : d.p_survive > 0.4 ? 'var(--sun)' : 'var(--bad)' }}>{pct(100 * d.p_survive, 1)}</span>
            <span className="mute" style={{ lineHeight: 1.5 }}>Landing exactly on the aim cell: {pct(100 * d.target_cell_p, 0)}. A tool that judges only the target point would report that number.</span>
            <div className="kv">
              <div><span>Lethal share of ellipse</span><span>{pct(100 * d.lethal_share_of_ellipse, 0)}</span></div>
              <div><span>Safer aim point</span><span>{d.safer_aim.distance_m > 0 ? `${Math.round(d.safer_aim.distance_m)} m → ${pct(100 * d.safer_aim.expected_p, 0)}` : 'aim is already best'}</span></div>
              <div><span>Worst point: battery floor</span><span>{fmtH(d.battery.worst_hours_to_floor, 'never')}</span></div>
              <div><span>Terrain versions × touchdowns</span><span>{d.n_variants} × {d.n_draws.toLocaleString()}</span></div>
            </div>
          </section>
          <section className="panel small mute" style={{ lineHeight: 1.6 }}>
            <span><b style={{ color: 'var(--ink)' }}>{d.label}</b></span>
            <span>Landing {d.landing_utc.slice(0, 16)} UTC · {d.mission_days}-day mission · {d.preset_label}</span>
            <span>Terrain: {d.terrain} · height errors: {d.terrain_error_map}</span>
            {aimSlope !== undefined && <span style={{ color: aimSlope < 8 ? 'var(--mute)' : 'var(--sun)' }}>Aim point slope on the 5 m map: {aimSlope.toFixed(1)}°{aimSlope < 8 ? ' (landable)' : ' — steeper than the 8° landing limit, so even a perfect touchdown here is not acceptable; the safer aim point is the real candidate.'}</span>}
            {cs === 'im2_replay' && <span style={{ color: 'var(--sun)' }}>No NASA 5 m map covers IM-2's site (27 checked), so this replay uses 80 m terrain. The crater Athena came to rest in is smaller than one pixel: the whole ellipse looks sunlit. PENUMBRA reports this resolution limit instead of tuning the model to match; sub-metre terrain (e.g. from ISRO's Chandrayaan-2 OHRC) would be needed. Tipping over was a separate guidance failure.</span>}
          </section>
        </aside>
      </div>
      <section className="panel">
        <h2>Battery: aim point vs worst point inside the ellipse</h2>
        <Lines t={d.battery.t_h} floor={0.2} series={[{ name: 'aim point', v: d.battery.target_soc, color: '#3BA776', lostAt: d.battery.target_hours_to_floor }, { name: `worst point (${Math.round(Math.hypot(d.battery.worst_dx_m, d.battery.worst_dy_m))} m away)`, v: d.battery.worst_soc, color: '#E0663F', lostAt: d.battery.worst_hours_to_floor }]} />
      </section>
    </>}
  </>);
}

// ------------------------------------------------------------------ Plan B + Why?
export function PlanB() {
  const [site, setSite] = useState('shackleton');
  const [pb, setPb] = useState<any>(undefined);
  const [why, setWhy] = useState<any>(undefined);
  useEffect(() => { setPb(undefined); setWhy(undefined); optionalJson(`planb_${site}.json`).then(setPb); optionalJson(`why_${site}.json`).then(setWhy); }, [site]);
  return (<>
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div><h1>Plan B Finder</h1><p className="mute" style={{ margin: '6px 0 0' }}>When the launch slips, search nearby points and dates for the best alternative, every option checked by the exact simulator.</p></div>
        <label className="field">Site<select value={site} onChange={e => setSite(e.target.value)}>{SITES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
      </div>
      {pb === undefined ? <span className="mute">loading…</span> : pb === null ? <Pending what="Plan B search" /> : <>
        <h2>Launch slips {pb.slip_days} days ({pb.planned_utc.slice(0, 10)} → {pb.slipped_utc.slice(0, 10)}): the original point {pb.original.survives ? 'still survives' : `fails — battery floor after ${fmtH(pb.original.hours_to_floor)}`}</h2>
        <div className="kv" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <div><span>Original point slope</span><span style={{ color: pb.original.slope_deg < pb.search.max_slope_deg ? 'var(--ink)' : 'var(--bad)' }}>{pb.original.slope_deg.toFixed(1)}° {pb.original.slope_deg < pb.search.max_slope_deg ? '' : '(too steep)'}</span></div>
          <div><span>Original point works again after</span><span>{pb.original.nearest_surviving_shift_days === null ? 'not within 30 d' : `+${pb.original.nearest_surviving_shift_days} d more`}</span></div>
          <div><span>Search (landable points × later dates)</span><span>{pb.search.grid_points_passing_slope} × {pb.search.date_window_days + 1} = {pb.search.candidates_checked.toLocaleString()}</span></div>
          <div><span>Combinations that survive 14 d</span><span>{pb.search.surviving_combinations.toLocaleString()}</span></div>
        </div>
        <span className="small mute">Candidates: grid points ({Math.round(pb.search.grid_spacing_m)} m spacing) within {pb.search.radius_m / 1000} km with slope under {pb.search.max_slope_deg}° ({pb.search.slope_source}); landing on the slipped date or up to {pb.search.date_window_days} days later (never earlier — the launch has slipped). Ranked: survives, then earliest landing, then shortest direct-to-Earth blackout. {PRESETS[pb.preset]?.label ?? pb.preset}, {pb.mission_days}-day mission.</span>
        <div className="scroll"><table className="t" style={{ minWidth: 720 }}>
          <thead><tr><th>Option</th><th>Move</th><th>Land</th><th>Slope</th><th>Outcome</th><th>Sunlit</th><th>Longest blackout</th><th>Lowest battery</th></tr></thead>
          <tbody>
            {pb.options.map((o: any) => <tr key={o.rank}><td><b>{o.label}</b> <span className="tag">physics-verified</span></td><td className="mono">{Math.round(o.distance_m)} m, bearing {Math.round(o.bearing_deg)}°</td><td className="mono">{o.landing_utc.slice(0, 10)} (+{o.date_shift_days} d)</td><td className="mono">{o.slope_deg.toFixed(1)}°</td><td style={{ color: o.survives ? 'var(--good)' : 'var(--bad)' }}>{o.survives ? 'survives' : `fails at ${fmtH(o.hours_to_floor)}`}</td><td className="mono">{pct(o.sunlit_pct, 0)}</td><td className="mono">{fmtH(o.longest_blackout_h)}</td><td className="mono">{pct(100 * o.min_soc, 0)}</td></tr>)}
            <tr><td className="mute">Original point, slipped date</td><td>—</td><td className="mono">{pb.slipped_utc.slice(0, 10)}</td><td className="mono">{pb.original.slope_deg.toFixed(1)}°</td><td style={{ color: pb.original.survives ? 'var(--good)' : 'var(--bad)' }}>{pb.original.survives ? 'survives' : `fails at ${fmtH(pb.original.hours_to_floor)}`}</td><td className="mono">{pct(pb.original.sunlit_pct, 0)}</td><td className="mono">{fmtH(pb.original.longest_blackout_h)}</td><td className="mono">{pct(100 * pb.original.min_soc, 0)}</td></tr>
          </tbody></table></div>
      </>}
    </section>
    <section className="panel">
      <h2>Why? What changed between the two dates</h2>
      {why === undefined ? <span className="mute">loading…</span> : why === null ? <Pending what="Why? attribution" /> : (() => {
        const sunF = why.factors.find((f: any) => f.name.startsWith('Sun'));
        const earthF = why.factors.find((f: any) => f.name.startsWith('Earth'));
        const terF = why.factors.find((f: any) => f.name.startsWith('Terrain'));
        const panF = why.factors.find((f: any) => f.name.startsWith('Panel'));
        const rows: [string, number, string][] = [
          ['Sun path (season and date)', sunF?.delta ?? 0, 'sunlit pts'],
          ['Earth path (libration): sunlight', earthF?.delta ?? 0, 'sunlit pts'],
          ['Earth path (libration): comms', earthF?.link_delta ?? 0, 'link pts'],
          ['Panel 5 m instead of 2 m (on new date)', panF?.delta ?? 0, 'sunlit pts']];
        const mx = Math.max(1, ...rows.map(r => Math.abs(r[1])));
        const br = why.blocking_ridge;
        return <>
          <span className="mute">At the original point, sunlit time changes {why.value_a.toFixed(1)}% → {why.value_b.toFixed(1)}% and direct-to-Earth link time {why.link_pct_a?.toFixed(1)}% → {why.link_pct_b?.toFixed(1)}% between {why.scenario_a_utc.slice(0, 10)} and {why.scenario_b_utc.slice(0, 10)}.</span>
          {rows.map(([name, v, unit]) => <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: '0 0 300px' }}>{name}</span>
            <div style={{ position: 'relative', flex: 1, height: 22, background: 'var(--panel2)', borderRadius: 4 }}>
              <div style={{ position: 'absolute', top: 3, bottom: 3, left: v < 0 ? `${50 - 50 * Math.abs(v) / mx}%` : '50%', width: `${50 * Math.abs(v) / mx}%`, background: v < 0 ? 'var(--bad)' : 'var(--good)', borderRadius: 3 }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--line2)' }} /></div>
            <span className="mono" style={{ flex: '0 0 150px', textAlign: 'right', whiteSpace: 'nowrap' }}>{v > 0 ? '+' : ''}{v.toFixed(1)} {unit}</span></div>)}
          {terF && <span className="small mute">Total effect of the real terrain on the new date: {terF.delta > 0 ? '+' : ''}{terF.delta.toFixed(1)} sunlit pts compared with a flat 0° horizon — the point sits high enough that its true horizon dips below level towards the Sun, so terrain here helps rather than hurts.</span>}
          {br?.status === 'done' && <span className="small mute">Main obstruction on the new date: azimuth {br.azimuth_deg.toFixed(1)}°, {br.distance_km.toFixed(2)} km away, horizon {br.elevation_deg.toFixed(2)}° — {br.height_above_observer_m > 0 ? `a ridge ${Math.round(br.height_above_observer_m)} m above the panel` : `the point's own downslope (${Math.round(br.height_above_observer_m)} m relative to the panel): the Sun was simply too low there, not hidden by a ridge`}.</span>}
          <span className="small mute">One-at-a-time swaps between the two dates; bars need not add up exactly.</span>
        </>; })()}
    </section>
  </>);
}

// ------------------------------------------------------------------ Trust tab
export function Trust() {
  const [hz, setHz] = useState<any>(null), [meta, setMeta] = useState<any>(null), [val, setVal] = useState<any>(undefined);
  const [eng, setEng] = useState<{ n: number; match: number; maxd: number } | null>(null);
  useEffect(() => {
    json('validation_horizons.json').then(setHz); json('ephem_meta.json').then(setMeta); optionalJson('validation.json').then(setVal);
    // live check: browser engine vs Python pipeline on 365 landing days at Shackleton's best point
    Promise.all([loadEphem(), loadDsn(), loadHorizons('shackleton'), json('slip_shackleton.json')]).then(([e, d, g, sl]) => {
      const pt = sl.points.best, k = nearestIndex(g, pt.lat, pt.lon), H = horizonAtIndex(g, k), py = pt.by_preset.medium_vertical;
      let match = 0, maxd = 0; const N = 365;
      for (let day = 0; day < N; day += 1) {
        const r = simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, PRESETS.medium_vertical);
        if (r.survives === py.survives[day]) match++;
        maxd = Math.max(maxd, Math.abs(r.sunlit_pct - py.sunlit_pct[day]));
      }
      setEng({ n: N, match, maxd });
    });
  }, []);
  const hmax = hz ? Math.max(...hz.results.map((r: any) => r.max_sep_deg)) : null;
  const card = (title: string, status: string, ok: boolean | null, body: any) => <section className="panel grow">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{title}</b><span className="badge" style={{ background: ok === null ? 'var(--line2)' : ok ? 'var(--good)' : 'var(--sun)', color: ok === null ? 'var(--ink)' : '#05070B' }}>{status}</span></div>{body}</section>;
  return (<>
    <section className="panel"><h1>Every number is checked against an independent source</h1><p className="mute" style={{ margin: 0 }}>Measured by the scripts in the repository (docs/validation.md). Checks that are not finished say so.</p></section>
    <div className="row">
      {card('1 · Sun and Earth angles vs NASA/JPL Horizons', hz ? (hmax! < 0.01 ? 'Pass (< 0.01°)' : 'Check') : '…', hz ? hmax! < 0.01 : null, hz && <>
        <span className="big">{hmax!.toExponential(1)}°</span><span className="small mute">largest difference over {hz.results.length} site/body cases × {hz.results[0].n} epochs ({hz.window[0]} to {hz.window[1]})</span>
        <table className="t"><tbody>{hz.results.map((r: any) => <tr key={r.site + r.body}><td>{r.site}</td><td>{r.body}</td><td className="mono">{r.max_sep_deg.toExponential(1)}°</td></tr>)}</tbody></table></>)}
      {card('2 · Browser engine vs Python pipeline', eng ? (eng.match === eng.n ? 'Pass' : 'Check') : 'running…', eng ? eng.match === eng.n : null, eng ? <>
        <span className="big">{eng.match}/{eng.n}</span><span className="small mute">landing days in 2027 where the TypeScript simulator in this page agrees with the Python simulator on survival (Shackleton best point, mid-size lander) · max sunlit difference {eng.maxd.toFixed(2)} pts. Computed live just now.</span></> : <span className="mute">re-running 365 missions in your browser…</span>)}
      {card('3 · Sampling accuracy of the Sun/Earth table', meta ? 'Pass' : '…', meta ? true : null, meta && <span className="small mute">Hourly table + float32 vs exact SPICE at 2,000 random minutes: Sun max {meta.self_checks.SUN.max_deg.toExponential(1)}°, Earth max {meta.self_checks.EARTH.max_deg.toExponential(1)}°. Sun elevation at 89.45°S stays within {meta.self_checks.pole_sun_elev_range_deg.map((v: number) => v.toFixed(2)).join(' to ')}° (theory: ±2.09°).</span>)}
    </div>
    <div className="row">
      {card('4 · Real mission: Chandrayaan-3 at Shiv Shakti (69.373°S, 32.319°E)', val?.chandrayaan3 ? 'Consistent' : '…', val?.chandrayaan3 ? true : null, val?.chandrayaan3 && <table className="t"><tbody>
        <tr><th>Event (UTC)</th><th>Flat horizon</th><th>LOLA terrain</th><th>Reported by ISRO</th></tr>
        <tr><td>Sunrise</td><td className="mono">{val.chandrayaan3.flat.sunrise.replace('T', ' ')}</td><td className="mono">{val.chandrayaan3.terrain?.status === 'done' ? val.chandrayaan3.terrain.sunrise.replace('T', ' ') : '—'}</td><td>Landing {val.chandrayaan3.reported.landing}</td></tr>
        <tr><td>Sunset</td><td className="mono">{val.chandrayaan3.flat.sunset.replace('T', ' ')}</td><td className="mono">{val.chandrayaan3.terrain?.status === 'done' ? val.chandrayaan3.terrain.sunset.replace('T', ' ') : '—'}</td><td>Sleep {val.chandrayaan3.reported.sleep}</td></tr>
        <tr><td>Next sunrise</td><td className="mono">{val.chandrayaan3.flat.next_sunrise.replace('T', ' ')}</td><td className="mono">{val.chandrayaan3.terrain?.status === 'done' ? val.chandrayaan3.terrain.next_sunrise.replace('T', ' ') : '—'}</td><td>Wake expected ~{val.chandrayaan3.reported.expected_wake}</td></tr>
        {val.chandrayaan3.terrain?.dem && <tr><td colSpan={4} className="small mute">Terrain: {val.chandrayaan3.terrain.dem}, {val.chandrayaan3.terrain.observer_height_m} m observer, {val.chandrayaan3.terrain.sun_criterion.toLowerCase()}. Sleep came just before sunset; the waking attempt came 2 days after terrain sunrise, as the panels needed the Sun higher.</td></tr>}
        </tbody></table>)}
      {card('5 · Long-term sunlight vs NASA PGDA 69', val?.pgda69?.status === 'done' ? `R² ${val.pgda69.r2.toFixed(2)}` : 'pending', val?.pgda69?.status === 'done' ? val.pgda69.r2 > 0.8 : null,
        val?.pgda69?.status === 'done' ? <><svg viewBox="0 0 330 200" role="img" aria-label="Scatter of PENUMBRA vs PGDA 69 sunlight" style={{ width: '100%' }}><rect x="34" y="6" width="280" height="164" fill="#0F131C" rx="4" /><line x1="34" y1="170" x2="314" y2="6" stroke="#5B6478" strokeDasharray="4 4" />
            {val.pgda69.points.map((p: number[], i: number) => <circle key={i} cx={34 + 2.8 * p[1]} cy={170 - 1.64 * p[0]} r="2.3" fill={['#F5B841', '#5AA9FF', '#3BA776'][['shackleton', 'malapert', 'leibnitz_beta'].indexOf(val.pgda69.point_sites?.[i])] ?? '#F5B841'} opacity="0.85" />)}
            {[0, 50, 100].map(v => <g key={v}><text x="28" y={174 - 1.64 * v} fill="#9AA3B5" fontSize="10" textAnchor="end">{v}</text><text x={34 + 2.8 * v} y="184" fill="#9AA3B5" fontSize="10" textAnchor="middle">{v}</text></g>)}
            <text x="174" y="198" fill="#9AA3B5" fontSize="10" textAnchor="middle">NASA PGDA 69 average illumination (%)</text><text x="10" y="90" fill="#9AA3B5" fontSize="10" transform="rotate(-90 10 90)" textAnchor="middle">PENUMBRA (%)</text></svg>
          <span className="small mute">{val.pgda69.n_points} points · Pearson r {val.pgda69.pearson_r?.toFixed(3)} · bias {val.pgda69.bias_pct.toFixed(1)} pts · RMSE {val.pgda69.rmse_pct.toFixed(1)} pts. By site (bias / RMSE): {Object.entries(val.pgda69.per_site ?? {}).map(([k, v]: any) => `${k.replace('_', ' ')} ${v.bias_pct.toFixed(1)} / ${v.rmse_pct.toFixed(1)}`).join(' · ')}. 18.6-year comparison (a full lunar nodal cycle).</span><span className="small"><span style={{ color: '#F5B841' }}>● Shackleton</span> · <span style={{ color: '#5AA9FF' }}>● Malapert</span> · <span style={{ color: '#3BA776' }}>● Leibnitz beta</span> · dashed line = perfect agreement</span></> : <Pending what="PGDA 69 comparison" />)}
      {card('6 · Predicted shadows vs a real LRO photo', val?.shadow?.status === 'done' ? `IoU ${val.shadow.iou.toFixed(2)} · ${Math.round(100 * val.shadow.pixel_agreement)}% cells agree` : val?.shadow?.status ?? 'pending', val?.shadow?.status === 'done' ? val.shadow.pixel_agreement > 0.9 : null,
        val?.shadow?.status === 'not_available' ? <div className="pending">Not available yet: {val.shadow.notes}</div> : val?.shadow?.status === 'done' ? <>
          <img src={import.meta.env.BASE_URL + 'data/' + val.shadow.overlay_png} alt="LROC NAC image, PENUMBRA's predicted lit and shadowed areas at the same moment, and their overlap" style={{ width: '100%', borderRadius: 6, background: '#fff' }} />
          <div className="kv">
            <div><span>Overlap of lit areas (IoU)</span><span>{val.shadow.iou.toFixed(2)} ({val.shadow.iou_nominal.toFixed(2)} unshifted)</span></div>
            <div><span>Cells classified the same</span><span>{(100 * val.shadow.pixel_agreement).toFixed(1)}% of {val.shadow.n_cells.toLocaleString()}</span></div>
            <div><span>Lit share: model / image</span><span>{val.shadow.lit_pct_model.toFixed(1)}% / {val.shadow.lit_pct_image.toFixed(1)}%</span></div>
            <div><span>Inside the 5 m Site04 map</span><span>{val.shadow.inside_site04_5m_map.model_lit_pct.toFixed(1)}% vs {val.shadow.inside_site04_5m_map.image_lit_pct.toFixed(2)}% lit</span></div>
          </div>
          <span className="small mute">LROC NAC {val.shadow.image_id}, {val.shadow.image_time_utc.slice(0, 19).replace('T', ' ')} UTC, Sun {val.shadow.sun_elev_flat_deg[0].toFixed(2)}° to {val.shadow.sun_elev_flat_deg[1].toFixed(2)}° above a flat horizon. The terminator and the shadowed crater floors are reproduced along the 51 km strip; most disagreement is dim, low-angle ground the model calls lit but that falls under the single brightness threshold. Limits: georeferenced from the product's corner coordinates (±300 m), so the best of a ±300 m shift search is reported beside the unshifted value; not orthorectified; the sunlit part of this strip lies on the 80 m map, so this mainly tests the far-field terrain.</span></> : <Pending what="Shadow overlay" />)}
    </div>
    <Provenance />
  </>);
}

export function Provenance() {
  const tiers: [string, string, string[][]][] = [
    ['NASA · primary', 'default', [['LRO LOLA topography: PGDA 78 (5 m sites + height errors), PGDA 90 (80 m, 80–90°S)', 'Horizons, slopes, terrain-error versions'], ['JPL NAIF SPICE (DE440, Moon PA/ME frames) + JPL Horizons', 'Sun and Earth geometry, libration, validation'], ['Deep Space Network complexes (Goldstone, Madrid, Canberra)', 'Direct-to-Earth contact windows'], ['LRO Camera (LROC): NAC image M128378248LC; IM-2 site location', 'Shadow-truth check (IoU 0.71, 95% cells agree); replay target']]],
    ['Space agency partners', 'cross-check', [['ISRO Chandrayaan-3 mission timeline', 'Real-mission sunrise/sunset check (flat and LOLA terrain)'], ['ISRO Chandrayaan-2 OHRC (sub-metre)', 'Needed to resolve IM-2-scale hazards (identified gap)'], ['ESA Moonlight / Lunar Pathfinder', 'Relay option for the long Earth blackouts']]],
    ['Other open sources', 'context', [['Published landing targets (CLPS, CNSA, ISRO)', 'Site library, labelled approximate where needed'], ['Open-source: SpiceyPy, NumPy, Numba, rasterio, pyproj, SciPy, React, Vite', 'Software']]],
  ];
  return <section className="panel"><h2>Data provenance: NASA first, partners as cross-checks</h2>
    <div className="row">{tiers.map(([n, b, items]) => <div key={n} className="grow" style={{ background: 'var(--panel2)', border: b === 'default' ? '2px solid var(--sun)' : '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{n}</b><span className="badge" style={{ background: b === 'default' ? 'var(--sun)' : b === 'cross-check' ? 'var(--earth2)' : 'var(--mute)' }}>{b}</span></div>
      {items.map(([a, c]) => <div key={a} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><div style={{ fontWeight: 500 }}>{a}</div><div className="small mute">{c}</div></div>)}</div>)}</div></section>;
}

// ------------------------------------------------------------------ AI Lab
const AI_SITES = [['shackleton', 'Shackleton rim'], ['malapert', 'Malapert massif'], ['leibnitz_beta', 'Leibnitz beta / Mons Mouton (unseen in training)']];
export function AILab() {
  const [mc, setMc] = useState<any>(undefined), [site, setSite] = useState('shackleton'), [srch, setSrch] = useState<any>(undefined);
  useEffect(() => { optionalJson('ai_model_card.json').then(setMc); }, []);
  useEffect(() => { setSrch(undefined); optionalJson(`ai_search_${site}.json`).then(setSrch); }, [site]);
  const num = (v: any, d = 3) => typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(d)) : String(v);
  const badge = (m: any) => <span className="badge" style={{ background: !m ? 'var(--line2)' : m.status === 'passed' ? 'var(--good)' : 'var(--sun)', color: !m ? 'var(--ink)' : '#05070B' }}>{!m ? 'pending' : m.status === 'passed' ? 'all gates passed' : `${m.gates.filter((g: any) => !g.pass).length} of ${m.gates.length} gates failed`}</span>;
  const gates = (m: any) => <table className="t"><thead><tr><th>Gate (held-out data)</th><th>Target</th><th>Measured</th><th></th></tr></thead>
    <tbody>{m.gates.map((g: any) => <tr key={g.name}><td>{g.name}</td><td className="mono">{g.target}</td><td className="mono">{num(g.measured)} {g.unit}</td><td style={{ color: g.pass ? 'var(--good)' : 'var(--bad)' }}>{g.pass ? 'pass' : 'fail'}</td></tr>)}</tbody></table>;
  if (mc === undefined) return <span className="mute">loading…</span>;
  if (mc === null) return <Pending what="AI models" />;
  const sv = mc.survivor, he = mc.helios;
  const acc = sv.info_metrics?.find((m: any) => m.name.startsWith('Accuracy of AI-accepted'));
  const auroc = sv.info_metrics?.find((m: any) => m.name.startsWith('AUROC'));
  const steep = srch?.top?.filter((t: any) => t.landable === false).length ?? 0;
  return (<>
    <section className="panel"><h1>AI proposes, physics verifies</h1>
      <p className="mute" style={{ margin: 0, lineHeight: 1.6 }}>Two models were trained on labels from PENUMBRA's own physics engine and tested on data they never saw. Both are reported against pre-set gates, pass or fail. <b style={{ color: 'var(--ink)' }}>What the app uses:</b> SURVIVOR screens hundreds of thousands of site–date candidates; every candidate it is unsure about, and every top pick, is re-run by the exact simulator, and only exact numbers are shown as results. HELIOS missed its accuracy gates, so it is not used anywhere: all horizons come from the LOLA raycaster.</p>
    </section>
    <div className="row">
      <section className="panel grow">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><h2>SURVIVOR</h2><span className="small mute">Mission-survival surrogate with conformal error bars · used as a screener</span></div>{badge(sv)}</div>
        <span className="small mute">{sv.architecture} · {sv.train_runs.toLocaleString()} training runs from the exact simulator · test: {sv.test_split}</span>
        <div className="kv" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {auroc && <div><span>AUROC, unseen site</span><span>{auroc.measured.toFixed(4)}</span></div>}
          {acc && <div><span>Correct when AI accepts alone</span><span>{acc.measured.toFixed(2)}%</span></div>}
          <div><span>Accepted without re-run (unseen site)</span><span>{sv.ai_accept_share_test_pct?.toFixed(1)}%</span></div>
          <div><span>Flagged as unfamiliar (unseen site)</span><span>{sv.ood_flag_rate_test_site_pct?.toFixed(1)}%</span></div>
        </div>
        {gates(sv)}
        <span className="small mute">Why gates fail: the error bars are calibrated on Shackleton and Malapert, and a new site breaks that calibration (coverage 78–96% instead of 90 ± 2%). The survival classifier itself is accurate, so it is used only to decide which candidates need the exact simulator. Speed-up over the exact simulator: {sv.speedup_vs_exact}× end to end (the simulator is already fast at about 2 ms per 14-day mission), {sv.speedup_note?.match(/model only ([0-9.]+x)/)?.[1] ?? '—'} for the model alone.</span>
      </section>
      <section className="panel grow">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><h2>HELIOS</h2><span className="small mute">Neural horizon field · not used in results</span></div>{badge(he)}</div>
        <span className="small mute">{he.architecture} · test: {he.test_split}</span>
        {gates(he)}
        <div className="scroll"><table className="t"><thead><tr><th>Site (held-out tiles)</th><th>Median err</th><th>p99 err</th><th>Lit/unlit agree</th><th>Plain interpolation</th></tr></thead>
          <tbody>{he.per_site.map((r: any) => <tr key={r.site}><td>{r.site.replace('_', ' ')}</td><td className="mono">{r.test_median_deg.toFixed(2)}°</td><td className="mono">{r.test_p99_deg.toFixed(1)}°</td><td className="mono">{r.agreement_pct.toFixed(1)}%</td><td className="mono">{r.baseline_linear_interp.median_deg.toFixed(2)}° / {r.baseline_linear_interp.agreement_pct.toFixed(1)}%</td></tr>)}</tbody></table></div>
        <span className="small mute">HELIOS is about 3,300× faster than raycasting but cannot infer terrain it has not seen inside a held-out 2.6 km tile, and beats plain interpolation only at Shackleton. Speed without accuracy is not useful, so PENUMBRA keeps the exact raycast horizons.</span>
      </section>
    </div>
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div><h2>AI-assisted search: every grid point × 30 landing days (14 Feb – 15 Mar 2027)</h2><span className="small mute">Accepted on AI alone only if in-distribution and the 0.95 conformal interval is clear of 0.5; the top 20 and every uncertain or unfamiliar candidate are re-run exactly.</span></div>
        <label className="field">Site<select value={site} onChange={e => setSite(e.target.value)}>{AI_SITES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      {mc.gate_activity_all_sites && <div className="scroll"><table className="t" style={{ minWidth: 640 }}><thead><tr><th>Site</th><th>Candidates scored</th><th>Sent to exact simulator</th><th>Accepted on AI alone</th><th>Top pick changed by physics?</th></tr></thead>
        <tbody>{mc.gate_activity_all_sites.map((g: any) => <tr key={g.site} style={{ background: g.site === site ? 'rgba(245,184,65,0.08)' : undefined }}><td>{g.site.replace('_', ' ')}</td><td className="mono">{g.candidates_scored.toLocaleString()}</td><td className="mono">{g.sent_to_exact.toLocaleString()} ({(100 * g.sent_to_exact / g.candidates_scored).toFixed(1)}%)</td><td className="mono">{g.accepted_by_ai.toLocaleString()}</td><td>{g.top_pick_changed_after_verification ? 'yes' : 'no'}</td></tr>)}</tbody></table></div>}
      {srch === undefined ? <span className="mute">loading…</span> : srch === null ? <Pending what="AI search" /> : <>
        <div className="scroll"><table className="t" style={{ minWidth: 820 }}><thead><tr><th>#</th><th>Point</th><th>Land</th><th>AI P(survive) · interval</th><th>AI sunlit → exact</th><th>Exact outcome</th><th>Slope</th><th>Tag</th></tr></thead>
          <tbody>{srch.top.map((t: any) => <tr key={t.rank}><td>{t.rank}</td><td className="mono">{t.lat.toFixed(3)}°, {t.lon.toFixed(2)}°E</td><td className="mono">{t.landing_utc.slice(0, 10)}</td><td className="mono">{(100 * t.ai_p_survive).toFixed(0)}% · {t.ai_interval.map((v: number) => (100 * v).toFixed(0)).join('–')}%</td>
            <td className="mono">{t.ai_sunlit_pct?.toFixed(1)}% → {pct(t.verified_sunlit_pct, 1)}</td><td style={{ color: t.verified_survives ? 'var(--good)' : 'var(--bad)' }}>{t.verified_survives ? 'survives' : 'fails'}</td>
            <td className="mono" style={{ color: t.landable === false ? 'var(--bad)' : 'var(--ink)' }}>{t.slope_deg !== undefined ? `${t.slope_deg.toFixed(1)}°${t.landable ? '' : ' too steep'}` : '—'}</td><td><span className="tag">{t.tag}</span></td></tr>)}</tbody></table></div>
        <span className="small mute">The AI under-predicts sunlight at the very top of the range, so the exact re-run decides the order among survivors. The AI search ranks by sunlight only; the 5 m LOLA slope check shows {steep} of these 10 are steeper than the 8° landing limit — the Plan B Finder, which filters by slope first, is the source for landing recommendations.</span>
      </>}
    </section>
  </>);
}

// ------------------------------------------------------------------ Stand on the rim (public lens)
export function Rim() {
  const [site, setSite] = useState('shackleton');
  const [date, setDate] = useState('2027-02-14T06:00');
  const [lat, setLat] = useState(12.97);
  const [st, setSt] = useState<any>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    Promise.all([loadEphem(), loadDsn(), loadHorizons(site), json('sites.json')]).then(([e, d, g, s]) => {
      const info = s.sites.find((x: any) => x.key === site);
      const k = nearestIndex(g, info.lat, info.lon);
      setSt({ e, d, H: horizonAtIndex(g, k), info });
    });
  }, [site]);
  const now = useMemo(() => st ? sky(st.e, st.info.lat, st.info.lon, utcToEt(date + ':00')) : null, [st, date]);
  const doy = (() => { const t = new Date(date + ':00Z'); return Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 0)) / 86400000); })();
  const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (doy - 81));
  const noon = 90 - Math.abs(lat - decl);
  const play = () => {
    if (!st) return;
    const ctx = audio.current ?? new AudioContext(); audio.current = ctx;
    const r = simulate(st.e, st.d, st.H, st.info.lat, st.info.lon, date.slice(0, 10) + 'T00:00:00', 29.5, PRESETS.medium_vertical);
    const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = 'sine'; osc.connect(gain); gain.connect(ctx.destination);
    const T = 30, n = r.series.f_sun.length, t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < n; i += 6) {
      const t = t0 + (i / n) * T, f = r.series.f_sun[i], el = r.series.sun_el[i];
      osc.frequency.setValueAtTime(220 + 140 * Math.max(0, el + 1), t);
      gain.gain.setValueAtTime(f > 0.05 ? 0.15 * f : 0, t);
    }
    osc.start(t0); osc.stop(t0 + T);
  };
  const W = 390, Hh = 300;
  const view = now && st ? (() => {
    const c = now.sunAz, X = (az: number) => W / 2 + (((az - c + 540) % 360) - 180) * (W / 120);
    const lo = -2, hi = 10, Y = (e: number) => 40 + (hi - e) / (hi - lo) * (Hh - 80);
    const pts: string[] = []; for (let a = -60; a <= 60; a += 0.5) { const az = (c + a + 360) % 360; pts.push(`${X(az).toFixed(1)},${Y(horizonAt(st.H, az)).toFixed(1)}`); }
    const vis = now.sunEl > horizonAt(st.H, now.sunAz);
    return { X, Y, pts: pts.join(' '), vis };
  })() : null;
  return (<div className="row">
    <section className="panel" style={{ flex: '0 1 430px' }}>
      <span className="small mute">PENUMBRA · Public lens</span>
      <h1>You are standing on {SITES.find(s => s.key === site)!.name}</h1>
      <div className="row"><label className="field">Site<select value={site} onChange={e => setSite(e.target.value)}>{SITES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
        <label className="field">Date and time (UTC)<input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} style={{ background: 'var(--panel2)', color: 'var(--ink)', border: '1px solid var(--line2)', borderRadius: 8, padding: 9 }} /></label></div>
      {view && now && <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="First-person view towards the Sun over the real horizon" style={{ width: '100%', background: '#05070B', borderRadius: 10 }}>
        {[[40, 40], [120, 70], [300, 30], [350, 110], [210, 55], [80, 140], [260, 120], [170, 22]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1" fill="#E6E9F0" />)}
        <circle cx={view.X(now.sunAz)} cy={view.Y(now.sunEl)} r="14" fill="#FFF3D6" />
        <polygon points={`0,${Hh} ${view.pts} ${W},${Hh}`} fill="#1A2030" stroke="#3A4459" />
        <text x="12" y="22" fill="#F5B841" fontSize="13" fontWeight="600">Sun {now.sunEl.toFixed(2)}° · terrain horizon there {horizonAt(st.H, now.sunAz).toFixed(2)}° · {view.vis ? 'Sun visible' : 'Sun hidden by terrain'}</text>
        <text x="12" y={Hh - 10} fill="#9AA3B5" fontSize="11">Looking towards the Sun (azimuth {now.sunAz.toFixed(0)}°), 120° wide view, real NASA LOLA horizon</text>
      </svg>}
      <div className="kv">
        <div><span>Your sky · noon, latitude {lat.toFixed(1)}°</span><span>{noon.toFixed(0)}°</span></div>
        <div><span>This site ({st ? `${st.info.lat.toFixed(2)}°` : '—'}), any time</span><span style={{ color: 'var(--sun)' }}>≤ {st ? (90 - Math.abs(st.info.lat) + 1.54).toFixed(1) : '—'}°</span></div>
      </div>
      <label className="field">Your latitude (default: Bengaluru)<input type="number" step="0.1" value={lat} onChange={e => setLat(+e.target.value)} /></label>
      <p className="mute" style={{ margin: 0, lineHeight: 1.5 }}>At the pole the Sun circles along the horizon instead of rising overhead. A ridge a few hundred metres away can hide it for days, which is why landing a few hundred metres off target can end a mission.</p>
      <button className="primary" onClick={play}>Hear one lunar day (30 s): pitch = Sun height, silence = night</button>
    </section>
  </div>);
}
