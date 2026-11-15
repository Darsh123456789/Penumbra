// Relay what-if checks (run: bash web/scripts/relay_check.sh). Asserts: relay off is bit-identical to the pre-relay engine
// and matches the Python survival column (365/365); with the relay, longest blackout <= direct-only for every 2027 landing day.
import { readFileSync } from 'node:fs';
import * as N from './engine.ts';
import * as O from './engine_old.ts';
import { relayFn, relayPos, relayState, relayAbovePct, ET_EPOCH } from './relay.ts';
const D = process.argv[2];
const J = (f: string) => JSON.parse(readFileSync(D + f, 'utf8'));
const B = (f: string) => { const b = readFileSync(D + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const m = J('ephem_meta.json'); const e: any = { et0: m.start_et_tdb_s, step: m.step_s, n: m.n, sun: new Float32Array(B('ephem_sun.bin')), earth: new Float32Array(B('ephem_earth.bin')), meta: m };
const dm = J('dsn_meta.json'); const d: any = { et0: dm.start_et_tdb_s, step: dm.step_s, n: dm.n, bits: new Uint8Array(B('dsn_visible.bin')) };
const YEAR0 = Date.UTC(2027, 0, 1), dayIso = (k: number) => new Date(YEAR0 + k * 86400000).toISOString().slice(0, 19);
const P = N.PRESETS.medium_vertical;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const out: any = {};
for (const site of ['shackleton', 'malapert', 'leibnitz_beta']) {
  const hm = J(`horizons_${site}.json`); const g: any = { meta: hm, n: hm.grid_n, data: new Uint16Array(B(`horizons_${site}.bin`)), x0: hm.x_m[0], x1: hm.x_m[1], y0: hm.y_m[0], y1: hm.y_m[1] };
  const pt = J(`slip_${site}.json`).points.best; const k = N.nearestIndex(g, pt.lat, pt.lon), H = N.horizonAtIndex(g, k);
  let ident = 0, trust = 0, viol = 0; const red1: number[] = [], red2: number[] = [];
  const f1 = relayFn('one', e, d, H, pt.lat, pt.lon), f2 = relayFn('two', e, d, H, pt.lat, pt.lon);
  const feb: any = {};
  for (let day = 0; day < 365; day++) {
    const a = N.simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, P), b = O.simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, P);
    const { relay_only_pct, longest_blackout_no_relay_h, ...rest } = a as any;
    if (JSON.stringify(rest) === JSON.stringify(b) && relay_only_pct === 0 && longest_blackout_no_relay_h === a.longest_blackout_h) ident++;
    if (a.survives === pt.by_preset.medium_vertical.survives[day]) trust++;
    const r1 = N.simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, P, 0, f1), r2 = N.simulate(e, d, H, pt.lat, pt.lon, dayIso(day), 14, P, 0, f2);
    for (const r of [r1, r2]) { if (r.longest_blackout_h > r.longest_blackout_no_relay_h + 1e-9) viol++; if (r.longest_blackout_no_relay_h !== a.longest_blackout_h) viol++; if (r.link_pct < a.link_pct - 1e-9) viol++; }
    red1.push(a.longest_blackout_h - r1.longest_blackout_h); red2.push(a.longest_blackout_h - r2.longest_blackout_h);
    if (day === 44) feb.direct = a.longest_blackout_h, feb.one = r1.longest_blackout_h, feb.two = r2.longest_blackout_h, feb.link = [a.link_pct, r1.link_pct, r2.link_pct], feb.relay_only = [r1.relay_only_pct, r2.relay_only_pct],
      feb.above1 = relayAbovePct('one', e, d, H, pt.lat, pt.lon, N.utcToEt(dayIso(44)), 14);
  }
  const all = (red: number[]) => red;
  out[site] = { ident, trust, viol, median_reduction_h_one: med(red1), median_reduction_h_two: med(red2), max_direct: null, feb14: feb };
  console.log(site, JSON.stringify(out[site]));
}
// spot check: aposelene time and relay geometry from Shackleton best point
const pt = J('slip_shackleton.json').points.best;
const n = Math.sqrt(4902.8 / 11312.4 ** 3), Tp = 2 * Math.PI / n, tApo = ET_EPOCH + Tp / 2 + 44 * 86400 - ((44 * 86400) % Tp);
const r = relayPos(tApo), rr = Math.hypot(...r), lat = Math.asin(r[2] / rr) * 180 / Math.PI;
const S = N.siteVector(pt.lat, pt.lon), M = N.enu(pt.lat, pt.lon);
const [az, el] = N.azEl([r[0] - S[0], r[1] - S[1], r[2] - S[2]], M);
console.log('apolune spot check: |r|-R =', (rr - 1737.4).toFixed(0), 'km, sub-sat lat', lat.toFixed(2), 'site lat', pt.lat, 'relay el from site', el.toFixed(1), 'az', az.toFixed(1));
const rp = relayPos(ET_EPOCH); console.log('perilune at epoch alt', (Math.hypot(...rp) - 1737.4).toFixed(0), 'lat', (Math.asin(rp[2] / Math.hypot(...rp)) * 180 / Math.PI).toFixed(2));
import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
for (const s of Object.keys(out)) if (out[s].ident !== 365 || out[s].trust !== 365 || out[s].viol !== 0) { console.error('FAIL', s); process.exit(1); }
console.log('PASS');
