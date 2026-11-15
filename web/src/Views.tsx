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
  useEffect(() => { setD(null); json(`dispersion_${cs}.json`).then(setD); }, [cs]);
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
            {cs === 'im2_replay' && <span style={{ color: 'var(--sun)' }}>No NASA 5 m map covers IM-2's site (27 checked), so this replay uses 80 m terrain. The crater Athena came to rest in is smaller than one pixel: the whole ellipse looks sunlit. PENUMBRA reports this resolution limit instead of tuning the model to match; sub-metre terrain (e.g. from ISRO's Chandrayaan-2 OHRC) would be needed. Tipping over was a separate guidance failure.</span>}
          </section>
        </aside>
      </div>
      <section className="panel">
        <h2>Battery: aim point vs worst point inside the ellipse</h2>
        <Lines t={d.battery.t_h} floor={0.2} series={[{ name: 'aim point', v: d.battery.target_soc, color: '#3BA776' }, { name: `worst point (${Math.round(Math.hypot(d.battery.worst_dx_m, d.battery.worst_dy_m))} m away)`, v: d.battery.worst_soc, color: '#E0663F' }]} />
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
  const maxAbs = why ? Math.max(1, ...why.factors.map((f: any) => Math.abs(f.delta))) : 1;
  return (<>
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div><h1>Plan B Finder</h1><p className="mute" style={{ margin: '6px 0 0' }}>When the launch slips, search nearby points and dates for the best alternative, every option checked by the exact simulator.</p></div>
        <label className="field">Site<select value={site} onChange={e => setSite(e.target.value)}>{SITES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
      </div>
      {pb === undefined ? <span className="mute">loading…</span> : pb === null ? <Pending what="Plan B search" /> : <>
        <h2>Slip {pb.slip_days} days ({pb.planned_utc.slice(0, 10)} → {pb.slipped_utc.slice(0, 10)}): original point {pb.original.survives ? 'still survives' : 'fails'}</h2>
        <span className="small mute">Searched {pb.search.candidates_checked.toLocaleString()} candidates within {pb.search.radius_m} m, slope under {pb.search.max_slope_deg}°, dates ±{pb.search.date_window_days} days · {PRESETS[pb.preset]?.label ?? pb.preset}</span>
        <div className="scroll"><table className="t" style={{ minWidth: 640 }}>
          <thead><tr><th>Option</th><th>Move</th><th>Date shift</th><th>Slope</th><th>Survives</th><th>Sunlit</th><th>Longest blackout</th><th>Lowest battery</th></tr></thead>
          <tbody>
            {pb.options.map((o: any) => <tr key={o.rank}><td><b>{o.label}</b> <span className="tag">physics-verified</span></td><td className="mono">{Math.round(o.distance_m)} m at {Math.round(o.bearing_deg)}°</td><td className="mono">{o.date_shift_days >= 0 ? '+' : ''}{o.date_shift_days} d</td><td className="mono">{o.slope_deg.toFixed(1)}°</td><td>{o.survives ? 'yes' : 'no'}</td><td className="mono">{pct(o.sunlit_pct, 0)}</td><td className="mono">{fmtH(o.longest_blackout_h)}</td><td className="mono">{pct(100 * o.min_soc, 0)}</td></tr>)}
            <tr><td className="mute">Original point</td><td>—</td><td>0 d</td><td>—</td><td>{pb.original.survives ? 'yes' : 'no'}</td><td className="mono">{pct(pb.original.sunlit_pct, 0)}</td><td className="mono">{fmtH(pb.original.longest_blackout_h)}</td><td>—</td></tr>
          </tbody></table></div>
      </>}
    </section>
    <section className="panel">
      <h2>Why? What changed between the two dates</h2>
      {why === undefined ? <span className="mute">loading…</span> : why === null ? <Pending what="Why? attribution" /> : <>
        <span className="mute">{why.metric.replace('_', ' ')}: {why.value_a.toFixed(1)} on {why.scenario_a_utc.slice(0, 10)} → {why.value_b.toFixed(1)} on {why.scenario_b_utc.slice(0, 10)}</span>
        {why.factors.map((f: any) => <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: '0 0 260px' }}>{f.name}</span>
          <div style={{ position: 'relative', flex: 1, height: 22, background: 'var(--panel2)', borderRadius: 4 }}>
            <div style={{ position: 'absolute', top: 3, bottom: 3, left: f.delta < 0 ? `${50 - 50 * Math.abs(f.delta) / maxAbs}%` : '50%', width: `${50 * Math.abs(f.delta) / maxAbs}%`, background: f.delta < 0 ? 'var(--bad)' : 'var(--good)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--line2)' }} /></div>
          <span className="mono" style={{ flex: '0 0 70px', textAlign: 'right' }}>{f.delta > 0 ? '+' : ''}{f.delta.toFixed(1)}</span></div>)}
        {why.blocking_ridge && <span className="small mute">Blocking terrain: azimuth {why.blocking_ridge.azimuth_deg.toFixed(0)}°, {why.blocking_ridge.distance_km.toFixed(1)} km away, {Math.round(why.blocking_ridge.height_above_observer_m)} m above the lander. {why.note}</span>}
      </>}
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
      {card('1 · Sun and Earth angles vs NASA/JPL Horizons', hz ? 'Pass' : '…', hz ? true : null, hz && <>
        <span className="big">{hmax!.toExponential(1)}°</span><span className="small mute">largest difference over {hz.results.length} site/body cases × {hz.results[0].n} epochs ({hz.window[0]} to {hz.window[1]})</span>
        <table className="t"><tbody>{hz.results.map((r: any) => <tr key={r.site + r.body}><td>{r.site}</td><td>{r.body}</td><td className="mono">{r.max_sep_deg.toExponential(1)}°</td></tr>)}</tbody></table></>)}
      {card('2 · Browser engine vs Python pipeline', eng ? (eng.match === eng.n ? 'Pass' : 'Check') : 'running…', eng ? eng.match === eng.n : null, eng ? <>
        <span className="big">{eng.match}/{eng.n}</span><span className="small mute">landing days in 2027 where the TypeScript simulator in this page agrees with the Python simulator on survival (Shackleton best point, mid-size lander) · max sunlit difference {eng.maxd.toFixed(2)} pts. Computed live just now.</span></> : <span className="mute">re-running 365 missions in your browser…</span>)}
      {card('3 · Sampling accuracy of the Sun/Earth table', meta ? 'Pass' : '…', meta ? true : null, meta && <span className="small mute">Hourly table + float32 vs exact SPICE at 2,000 random minutes: Sun max {meta.self_checks.SUN.max_deg.toExponential(1)}°, Earth max {meta.self_checks.EARTH.max_deg.toExponential(1)}°. Sun elevation at 89.45°S stays within {meta.self_checks.pole_sun_elev_range_deg.map((v: number) => v.toFixed(2)).join(' to ')}° (theory: ±2.09°).</span>)}
    </div>
    <div className="row">
      {card('4 · Real mission: Chandrayaan-3 at Shiv Shakti (69.373°S, 32.319°E)', 'Matches', true, <table className="t"><tbody>
        <tr><th>Event</th><th>PENUMBRA (flat horizon)</th><th>Reported by ISRO</th></tr>
        <tr><td>Sunrise</td><td className="mono">2023-08-21 10:30</td><td>Landing 23 Aug</td></tr>
        <tr><td>Sunset</td><td className="mono">2023-09-04 16:10</td><td>Put to sleep 2–4 Sep</td></tr>
        <tr><td>Next sunrise</td><td className="mono">2023-09-19 19:30</td><td>Wake-up expected ~22 Sep</td></tr>
        {val?.chandrayaan3?.terrain?.status === 'done' && <tr><td>With terrain</td><td className="mono" colSpan={2}>{val.chandrayaan3.terrain.sunset} / {val.chandrayaan3.terrain.next_sunrise}</td></tr>}</tbody></table>)}
      {card('5 · Long-term sunlight vs NASA PGDA 69', val?.pgda69?.status === 'done' ? `R² ${val.pgda69.r2.toFixed(2)}` : 'pending', val?.pgda69?.status === 'done' ? val.pgda69.r2 > 0.8 : null,
        val?.pgda69?.status === 'done' ? <><svg viewBox="0 0 300 160" role="img" aria-label="Scatter of PENUMBRA vs PGDA 69 sunlight" style={{ width: '100%' }}><rect width="300" height="160" fill="#0F131C" rx="6" /><line x1="10" y1="150" x2="290" y2="10" stroke="#5B6478" strokeDasharray="4 4" />{val.pgda69.points.map((p: number[], i: number) => <circle key={i} cx={10 + 2.8 * p[1]} cy={150 - 1.4 * p[0]} r="2.5" fill="#F5B841" />)}</svg>
          <span className="small mute">{val.pgda69.n_points} points · bias {val.pgda69.bias_pct.toFixed(1)} pts · RMSE {val.pgda69.rmse_pct.toFixed(1)} pts · {val.pgda69.notes}</span></> : <Pending what="PGDA 69 comparison" />)}
      {card('6 · Predicted shadows vs a real LRO photo', val?.shadow?.status === 'done' ? `IoU ${val.shadow.iou.toFixed(2)}` : val?.shadow?.status ?? 'pending', val?.shadow?.status === 'done' ? val.shadow.iou > 0.8 : null,
        val?.shadow && val.shadow.status !== 'not_available' ? <><img src={import.meta.env.BASE_URL + 'data/' + val.shadow.overlay_png} alt="Predicted shadow edge over an LRO image" style={{ width: '100%', borderRadius: 6 }} /><span className="small mute">{val.shadow.image_id} · {val.shadow.image_time_utc} · {val.shadow.notes}</span></> : <Pending what="Shadow overlay" />)}
    </div>
    <Provenance />
  </>);
}

export function Provenance() {
  const tiers: [string, string, string[][]][] = [
    ['NASA · primary', 'default', [['LRO LOLA topography: PGDA 78 (5 m sites + height errors), PGDA 90 (80 m, 80–90°S)', 'Horizons, slopes, terrain-error versions'], ['JPL NAIF SPICE (DE440, Moon PA/ME frames) + JPL Horizons', 'Sun and Earth geometry, libration, validation'], ['Deep Space Network complexes (Goldstone, Madrid, Canberra)', 'Direct-to-Earth contact windows'], ['LROC (IM-2 site location)', 'Replay target']]],
    ['Space agency partners', 'cross-check', [['ISRO Chandrayaan-3 mission timeline', 'Real-mission sunrise/sunset check'], ['ISRO Chandrayaan-2 OHRC (sub-metre)', 'Needed to resolve IM-2-scale hazards (identified gap)'], ['ESA Moonlight / Lunar Pathfinder', 'Relay option for the long Earth blackouts']]],
    ['Other open sources', 'context', [['Published landing targets (CLPS, CNSA, ISRO)', 'Site library, labelled approximate where needed'], ['Open-source: SpiceyPy, NumPy, Numba, rasterio, pyproj, SciPy, React, Vite', 'Software']]],
  ];
  return <section className="panel"><h2>Data provenance: NASA first, partners as cross-checks</h2>
    <div className="row">{tiers.map(([n, b, items]) => <div key={n} className="grow" style={{ background: 'var(--panel2)', border: b === 'default' ? '2px solid var(--sun)' : '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{n}</b><span className="badge" style={{ background: b === 'default' ? 'var(--sun)' : b === 'cross-check' ? 'var(--earth2)' : 'var(--mute)' }}>{b}</span></div>
      {items.map(([a, c]) => <div key={a} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><div style={{ fontWeight: 500 }}>{a}</div><div className="small mute">{c}</div></div>)}</div>)}</div></section>;
}

// ------------------------------------------------------------------ AI Lab
export function AILab() {
  const [mc, setMc] = useState<any>(undefined), [srch, setSrch] = useState<any>(undefined);
  useEffect(() => { optionalJson('ai_model_card.json').then(setMc); optionalJson('ai_search_shackleton.json').then(setSrch); }, []);
  const model = (k: string, title: string, role: string) => { const m = mc?.[k]; return <section className="panel grow">
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><h2>{title}</h2><span className="small mute">{role}</span></div>
      <span className="badge" style={{ background: !m ? 'var(--line2)' : m.status === 'passed' ? 'var(--good)' : m.status === 'failed' ? 'var(--sun)' : 'var(--line2)', color: !m || m.status === 'not_run' ? 'var(--ink)' : '#05070B' }}>{m ? m.status : 'pending'}</span></div>
    {!m ? <Pending what={title} /> : <>
      <span className="small mute">{m.architecture} · train {m.train_points ?? m.train_runs} / test {m.test_points ?? m.test_runs} · {m.test_split}</span>
      <table className="t"><thead><tr><th>Gate</th><th>Target</th><th>Measured</th><th></th></tr></thead><tbody>{m.gates.map((g: any) => <tr key={g.name}><td>{g.name}</td><td className="mono">{g.target}</td><td className="mono">{typeof g.measured === 'number' ? g.measured.toPrecision(3) : g.measured} {g.unit}</td><td>{g.pass ? '✓' : '✗'}</td></tr>)}</tbody></table>
      {m.speedup_vs_exact ? <span className="small mute">Speed-up vs exact physics: {Math.round(m.speedup_vs_exact).toLocaleString()}×</span> : null}</>}
  </section>; };
  return (<>
    <section className="panel"><h1>AI proposes, physics verifies</h1><p className="mute" style={{ margin: 0, lineHeight: 1.5 }}>Two models trained on labels from PENUMBRA's own physics engine. A model ships only if it passes its gates on terrain it never saw; anything uncertain is re-run by the exact simulator, and every result is tagged with how it was produced.</p></section>
    <div className="row">{model('helios', 'HELIOS', 'Neural horizon field: 360° horizon at any point')}{model('survivor', 'SURVIVOR', 'Mission-survival surrogate with conformal error bars')}</div>
    <section className="panel"><h2>Gate activity: last AI-assisted search</h2>
      {!mc?.gate_activity ? <Pending what="Gate activity" /> : <div className="kv" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <div><span>Candidates scored by AI</span><span>{mc.gate_activity.candidates_scored.toLocaleString()}</span></div>
        <div><span>Sent to exact re-run</span><span>{mc.gate_activity.sent_to_exact.toLocaleString()}</span></div>
        <div><span>Accepted on AI alone</span><span>{mc.gate_activity.accepted_by_ai.toLocaleString()}</span></div>
        <div><span>Top pick changed by physics?</span><span>{mc.gate_activity.top_pick_changed_after_verification ? 'yes' : 'no'}</span></div></div>}
      {srch && <div className="scroll"><table className="t" style={{ minWidth: 640 }}><thead><tr><th>#</th><th>Point</th><th>AI P(survive)</th><th>90% interval</th><th>Verified</th><th>Sunlit</th><th>Tag</th></tr></thead>
        <tbody>{srch.top.map((t: any) => <tr key={t.rank}><td>{t.rank}</td><td className="mono">{t.lat.toFixed(3)}, {t.lon.toFixed(2)}E</td><td className="mono">{(100 * t.ai_p_survive).toFixed(0)}%</td><td className="mono">{t.ai_interval.map((v: number) => (100 * v).toFixed(0)).join('–')}%</td><td>{t.verified_survives ? 'survives' : 'fails'}</td><td className="mono">{pct(t.verified_sunlit_pct, 0)}</td><td><span className="tag">{t.tag}</span></td></tr>)}</tbody></table></div>}
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
        <text x="12" y="22" fill="#F5B841" fontSize="13" fontWeight="600">Sun {now.sunEl.toFixed(2)}° · {view.vis ? 'visible above the ridge' : 'hidden behind terrain'}</text>
        <text x="12" y={Hh - 10} fill="#9AA3B5" fontSize="11">Looking towards the Sun (azimuth {now.sunAz.toFixed(0)}°), 120° wide view, real NASA LOLA horizon</text>
      </svg>}
      <div className="kv">
        <div><span>Your sky · noon, latitude {lat.toFixed(1)}°</span><span>{noon.toFixed(0)}°</span></div>
        <div><span>Lunar south pole, any time</span><span style={{ color: 'var(--sun)' }}>≤ 2.1°</span></div>
      </div>
      <label className="field">Your latitude (default: Bengaluru)<input type="number" step="0.1" value={lat} onChange={e => setLat(+e.target.value)} /></label>
      <p className="mute" style={{ margin: 0, lineHeight: 1.5 }}>At the pole the Sun circles along the horizon instead of rising overhead. A ridge a few hundred metres away can hide it for days, which is why landing a few hundred metres off target can end a mission.</p>
      <button className="primary" onClick={play}>Hear one lunar day (30 s): pitch = Sun height, silence = night</button>
    </section>
  </div>);
}
