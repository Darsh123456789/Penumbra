// PENUMBRA browser engine: a TypeScript port of pipeline/geometry.py and pipeline/simulate.py.
// Conventions match the Python pipeline exactly (MOON_ME frame, sphere R = 1737.4 km, east-positive longitude,
// azimuth clockwise from local north, apparent directions, no refraction).

export const R_MOON = 1737.4;
const R_M = 1737400;
const S0 = 1361;
const SUN_R = 0.2666;
export const STEP_S = 600;
const BASE = import.meta.env.BASE_URL + 'data/';

export type V3 = [number, number, number];

// ---------- data loading ----------
const cache = new Map<string, Promise<any>>();
export function json<T = any>(name: string): Promise<T> {
  if (!cache.has(name)) cache.set(name, fetch(BASE + name).then(r => { if (!r.ok) throw new Error(name); return r.json(); }));
  return cache.get(name)!;
}
export function optionalJson<T = any>(name: string): Promise<T | null> {
  return json<T>(name).catch(() => null);
}
function bin(name: string): Promise<ArrayBuffer> {
  if (!cache.has(name)) cache.set(name, fetch(BASE + name).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }));
  return cache.get(name)!;
}

export interface Ephem { et0: number; step: number; n: number; sun: Float32Array; earth: Float32Array; meta: any }
let ephemP: Promise<Ephem> | null = null;
export function loadEphem(): Promise<Ephem> {
  if (!ephemP) ephemP = Promise.all([json('ephem_meta.json'), bin('ephem_sun.bin'), bin('ephem_earth.bin')])
    .then(([meta, s, e]) => ({ et0: meta.start_et_tdb_s, step: meta.step_s, n: meta.n, sun: new Float32Array(s), earth: new Float32Array(e), meta }));
  return ephemP;
}

export interface Dsn { et0: number; step: number; n: number; bits: Uint8Array }
let dsnP: Promise<Dsn> | null = null;
export function loadDsn(): Promise<Dsn> {
  if (!dsnP) dsnP = Promise.all([json('dsn_meta.json'), bin('dsn_visible.bin')])
    .then(([m, b]) => ({ et0: m.start_et_tdb_s, step: m.step_s, n: m.n, bits: new Uint8Array(b) }));
  return dsnP;
}
export function dsnAt(d: Dsn, et: number): boolean {
  const i = Math.round((et - d.et0) / d.step);
  if (i < 0 || i >= d.n) return false;
  return ((d.bits[i >> 3] >> (i & 7)) & 1) === 1;
}

export interface HorizonGrid { meta: any; n: number; data: Uint16Array; x0: number; x1: number; y0: number; y1: number }
const hz = new Map<string, Promise<HorizonGrid>>();
export function loadHorizons(site: string): Promise<HorizonGrid> {
  if (!hz.has(site)) hz.set(site, Promise.all([json(`horizons_${site}.json`), bin(`horizons_${site}.bin`)]).then(([meta, b]) => ({
    meta, n: meta.grid_n, data: new Uint16Array(b), x0: meta.x_m[0], x1: meta.x_m[1], y0: meta.y_m[0], y1: meta.y_m[1],
  })));
  return hz.get(site)!;
}

// float16 -> float32
function f16(h: number): number {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
export function horizonAtIndex(g: HorizonGrid, k: number): Float64Array {
  const out = new Float64Array(360);
  for (let a = 0; a < 360; a++) out[a] = f16(g.data[k * 360 + a]);
  return out;
}
export function nearestIndex(g: HorizonGrid, lat: number, lon: number): number {
  const [x, y] = latlonToXY(lat, lon);
  const dx = (g.x1 - g.x0) / (g.n - 1), dy = (g.y1 - g.y0) / (g.n - 1);
  const i = Math.min(g.n - 1, Math.max(0, Math.round((x - g.x0) / dx)));
  const j = Math.min(g.n - 1, Math.max(0, Math.round((y - g.y0) / dy)));
  return j * g.n + i;
}

// ---------- geometry ----------
export function latlonToXY(lat: number, lon: number): [number, number] {
  const rho = 2 * R_M * Math.tan(((90 + lat) * Math.PI / 180) / 2);
  return [rho * Math.sin(lon * Math.PI / 180), rho * Math.cos(lon * Math.PI / 180)];
}
export function xyToLatLon(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y);
  return [2 * Math.atan(rho / (2 * R_M)) * 180 / Math.PI - 90, ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360];
}
export function gridXY(g: HorizonGrid, k: number): [number, number] {
  const i = k % g.n, j = Math.floor(k / g.n);
  return [g.x0 + i * (g.x1 - g.x0) / (g.n - 1), g.y0 + j * (g.y1 - g.y0) / (g.n - 1)];
}
export interface PointGrid { n: number; z_m: number[]; sun: number[]; earth: number[]; both: number[]; slope: (number | null)[]; landing_slope_limit_deg: number }
export const loadGrid = (site: string) => json<any>(`grid_${site}.json`).then(g => ({ ...g, n: g.n ?? g.grid_n }) as PointGrid);
// 365 landing days in 2027, each a 14-day mission; yields to the browser between chunks.
export async function survivalYear(e: Ephem, d: Dsn, H: Float64Array, lat: number, lon: number, p: Preset, dip: number, cancelled: () => boolean): Promise<boolean[] | null> {
  const out: boolean[] = [];
  for (let day = 0; day < 365; day++) {
    if (day % 15 === 0) { await new Promise(r => setTimeout(r, 0)); if (cancelled()) return null; }
    const iso = new Date(Date.UTC(2027, 0, 1) + day * 86400000).toISOString().slice(0, 19);
    out.push(simulate(e, d, H, lat, lon, iso, 14, p, dip, undefined, true).survives);
  }
  return out;
}
export function siteVector(lat: number, lon: number): V3 {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return [R_MOON * Math.cos(la) * Math.cos(lo), R_MOON * Math.cos(la) * Math.sin(lo), R_MOON * Math.sin(la)];
}
export function enu(lat: number, lon: number): [V3, V3, V3] {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return [[-Math.sin(lo), Math.cos(lo), 0],
          [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
          [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]];
}
export function interp(tab: Float32Array, e: Ephem, et: number): V3 {
  const x = (et - e.et0) / e.step;
  const i = Math.min(e.n - 2, Math.max(0, Math.floor(x)));
  const f = x - i;
  return [tab[3 * i] * (1 - f) + tab[3 * i + 3] * f, tab[3 * i + 1] * (1 - f) + tab[3 * i + 4] * f, tab[3 * i + 2] * (1 - f) + tab[3 * i + 5] * f];
}
export function azEl(v: V3, M: [V3, V3, V3]): [number, number] {
  const e = v[0] * M[0][0] + v[1] * M[0][1] + v[2] * M[0][2];
  const n = v[0] * M[1][0] + v[1] * M[1][1] + v[2] * M[1][2];
  const u = v[0] * M[2][0] + v[1] * M[2][1] + v[2] * M[2][2];
  const az = ((Math.atan2(e, n) * 180 / Math.PI) % 360 + 360) % 360;
  const el = Math.atan2(u, Math.hypot(e, n)) * 180 / Math.PI;
  return [az, el];
}
export function horizonAt(H: Float64Array, az: number): number {
  const b = az - 0.5, i0 = ((Math.floor(b) % 360) + 360) % 360, f = b - Math.floor(b);
  return H[i0] * (1 - f) + H[(i0 + 1) % 360] * f;
}

// UTC <-> ephemeris time (TDB seconds past J2000). TDB - UTC = 32.184 s + 37 leap seconds (valid 2017 onwards).
const J2000_UTC_MS = Date.UTC(2000, 0, 1, 11, 58, 55, 816);
export function utcToEt(iso: string): number {
  const ms = Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
  return (ms - J2000_UTC_MS) / 1000 + 5; // +5 = (37 - 32) leap seconds added since 2000
}
export function etToDate(et: number): Date { return new Date(J2000_UTC_MS + (et - 5) * 1000); }

export interface SkySample { et: number; sunAz: number; sunEl: number; earthAz: number; earthEl: number }
export function sky(e: Ephem, lat: number, lon: number, et: number): SkySample {
  const S = siteVector(lat, lon), M = enu(lat, lon);
  const s = interp(e.sun, e, et), q = interp(e.earth, e, et);
  const [sa, se] = azEl([s[0] - S[0], s[1] - S[1], s[2] - S[2]], M);
  const [ea, ee] = azEl([q[0] - S[0], q[1] - S[1], q[2] - S[2]], M);
  return { et, sunAz: sa, sunEl: se, earthAz: ea, earthEl: ee };
}

// ---------- survival simulator (mirror of pipeline/simulate.py) ----------
export interface Preset { label: string; panel_layout: string; panel_area_m2: number; panel_eff: number; charge_eff: number;
  battery_wh: number; load_w: number; heater_w: number; soc_floor: number; initial_soc?: number; earth_margin_deg?: number }

function panelFactor(layout: string, az: number, el: number): number {
  const c = Math.cos(el * Math.PI / 180);
  if (layout === 'vertical_4') { let t = 0; for (let k = 0; k < 4; k++) t += 0.25 * Math.max(0, c * Math.cos((az - 90 * k) * Math.PI / 180)); return t; }
  if (layout === 'tracking_mast') return Math.max(0, c);
  if (layout === 'horizontal_deck') return Math.max(0, Math.sin(el * Math.PI / 180));
  if (layout === 'vertical_4_on_side') { // same box on its side: one face up, two still vertical (pipeline/simulate.py)
    let t = 0.25 * Math.max(0, Math.sin(el * Math.PI / 180));
    for (const k of [0, 2]) t += 0.25 * Math.max(0, c * Math.cos((az - 90 * k) * Math.PI / 180));
    return t;
  }
  return 0;
}

export interface SimResult { sunlit_pct: number; earth_pct: number; both_pct: number; link_pct: number; longest_night_h: number;
  longest_blackout_h: number; energy_in_kwh: number; min_soc: number; hours_to_floor: number | null; survives: boolean;
  sunset_in_h: number | null; earthset_in_h: number | null;
  sun_up_at_start: boolean; earth_up_at_start: boolean; sunrise_in_h: number | null; earthrise_in_h: number | null;
  dark_terrain_h: number; dark_below_horizontal_h: number; earth_terrain_h: number; earth_below_horizontal_h: number;
  sun_el_min: number; sun_el_max: number; load_kwh: number; battery_needed_wh: number;
  relay_only_pct: number; longest_blackout_no_relay_h: number;
  series: { t_h: number[]; f_sun: number[]; earth_up: boolean[]; dsn: boolean[]; link: boolean[]; soc: number[]; sun_az: number[]; sun_el: number[]; earth_az: number[]; earth_el: number[] } }

// geoHorizonDeg: horizon of a bare, smooth Moon for an observer at this height (negative: the dip). Darkness with the
// Sun above it but below the LOLA horizon is caused by terrain; below it, by the Moon's curvature alone.
export function bareMoonDip(heightAboveDatumM: number): number { return -Math.acos(R_M / (R_M + Math.max(0, heightAboveDatumM))) * 180 / Math.PI; }
export function simulate(e: Ephem, d: Dsn, H: Float64Array, lat: number, lon: number, startIso: string, days: number, p: Preset, geoHorizonDeg = 0, relay?: (et: number) => boolean, lite = false): SimResult {
  const et0 = utcToEt(startIso), n = Math.round(days * 86400 / STEP_S), dt = STEP_S / 3600;
  const S = siteVector(lat, lon), M = enu(lat, lon);
  const ser = { t_h: [] as number[], f_sun: [] as number[], earth_up: [] as boolean[], dsn: [] as boolean[], link: [] as boolean[], soc: [] as number[],
    sun_az: [] as number[], sun_el: [] as number[], earth_az: [] as number[], earth_el: [] as number[] };
  let energy = p.battery_wh * (p.initial_soc ?? 1), minSoc = 1, tFloor: number | null = null, ein = 0;
  let lit = 0, eup = 0, both = 0, lk = 0, night = 0, nightMax = 0, bo = 0, boMax = 0;
  let rOnly = 0, bo0 = 0, bo0Max = 0; // relay what-if: relay-only link steps; blackout counted on the direct link alone
  let sunset: number | null = null, earthset: number | null = null, sunrise: number | null = null, earthrise: number | null = null;
  let dTer = 0, dHor = 0, eTer = 0, eHor = 0, elMin = 90, elMax = -90, loadE = 0;
  let cum = 0, peak = 0, drawdown = 0; // sequent-peak: smallest battery that never drops below the floor
  let sunUp0 = false, earthUp0 = false;
  for (let i = 0; i < n; i++) {
    const et = et0 + i * STEP_S;
    const s = interp(e.sun, e, et), q = interp(e.earth, e, et);
    const [sa, se] = azEl([s[0] - S[0], s[1] - S[1], s[2] - S[2]], M);
    const [ea, ee] = azEl([q[0] - S[0], q[1] - S[1], q[2] - S[2]], M);
    const f = Math.min(1, Math.max(0, (se - horizonAt(H, sa) + SUN_R) / (2 * SUN_R)));
    const up = ee - horizonAt(H, ea) > (p.earth_margin_deg ?? 1);
    const ds = dsnAt(d, et), direct = up && ds, link = direct || (relay ? relay(et) : false);
    if (link && !direct) rOnly++;
    bo0 = !direct ? bo0 + 1 : 0; bo0Max = Math.max(bo0Max, bo0);
    const pin = p.panel_eff * S0 * p.panel_area_m2 * f * panelFactor(p.panel_layout, sa, se);
    ein += pin * dt;
    const load = p.load_w + (f < 0.05 ? p.heater_w : 0);
    loadE += load * dt;
    cum += (pin * p.charge_eff - load) * dt; peak = Math.max(peak, cum); drawdown = Math.max(drawdown, peak - cum);
    if (i === 0) { sunUp0 = f > 0.5; earthUp0 = up; }
    if (f < 0.5) { if (se > geoHorizonDeg) dTer++; else dHor++; }
    if (!up) { if (ee > geoHorizonDeg) eTer++; else eHor++; }
    elMin = Math.min(elMin, se); elMax = Math.max(elMax, se);
    if (sunrise === null && !sunUp0 && f > 0.5) sunrise = i * dt;
    if (earthrise === null && !earthUp0 && up) earthrise = i * dt;
    energy = Math.min(p.battery_wh, Math.max(0, energy + (pin * p.charge_eff - load) * dt));
    const soc = energy / p.battery_wh;
    minSoc = Math.min(minSoc, soc);
    if (tFloor === null && soc < p.soc_floor) { tFloor = i * dt; if (lite) break; }
    if (f > 0.5) lit++; if (up) eup++; if (f > 0.5 && up) both++; if (link) lk++;
    night = f < 0.5 ? night + 1 : 0; nightMax = Math.max(nightMax, night);
    bo = !link ? bo + 1 : 0; boMax = Math.max(boMax, bo);
    if (sunset === null && sunUp0 && f < 0.5) sunset = i * dt;
    if (earthset === null && earthUp0 && !up) earthset = i * dt;
    if (!lite) {
    ser.t_h.push(i * dt); ser.f_sun.push(f); ser.earth_up.push(up); ser.dsn.push(ds); ser.link.push(link); ser.soc.push(soc);
    ser.sun_az.push(sa); ser.sun_el.push(se); ser.earth_az.push(ea); ser.earth_el.push(ee);
    }
  }
  return { sunlit_pct: 100 * lit / n, earth_pct: 100 * eup / n, both_pct: 100 * both / n, link_pct: 100 * lk / n,
    longest_night_h: nightMax * dt, longest_blackout_h: boMax * dt, energy_in_kwh: ein / 1000, min_soc: minSoc,
    hours_to_floor: tFloor, survives: tFloor === null, sunset_in_h: sunset, earthset_in_h: earthset,
    sun_up_at_start: sunUp0, earth_up_at_start: earthUp0, sunrise_in_h: sunrise, earthrise_in_h: earthrise,
    dark_terrain_h: dTer * dt, dark_below_horizontal_h: dHor * dt, earth_terrain_h: eTer * dt, earth_below_horizontal_h: eHor * dt,
    sun_el_min: elMin, sun_el_max: elMax, load_kwh: loadE / 1000,
    battery_needed_wh: drawdown / (1 - p.soc_floor), relay_only_pct: 100 * rOnly / n, longest_blackout_no_relay_h: bo0Max * dt, series: ser };
}

export const PRESETS: Record<string, Preset> = {
  small_vertical: { label: 'Small solar lander, 4 vertical panels (generic)', panel_layout: 'vertical_4', panel_area_m2: 4, panel_eff: 0.28, charge_eff: 0.95, battery_wh: 1500, load_w: 120, heater_w: 40, soc_floor: 0.2 },
  medium_vertical: { label: 'Mid-size solar lander, 4 vertical panels (generic)', panel_layout: 'vertical_4', panel_area_m2: 8, panel_eff: 0.28, charge_eff: 0.95, battery_wh: 4000, load_w: 220, heater_w: 80, soc_floor: 0.2 },
  tracking_mast: { label: 'Lander with Sun-tracking vertical mast array (generic)', panel_layout: 'tracking_mast', panel_area_m2: 3, panel_eff: 0.30, charge_eff: 0.95, battery_wh: 2500, load_w: 150, heater_w: 60, soc_floor: 0.2 },
};

export function fmtH(h: number | null | undefined, never = 'not in window'): string {
  if (h === null || h === undefined) return never;
  const d = Math.floor(h / 24), r = Math.round(h - 24 * d);
  return d > 0 ? `${d}d ${String(r).padStart(2, '0')}h` : `${Math.round(h)}h`;
}
