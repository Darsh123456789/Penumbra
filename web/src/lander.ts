// Custom-lander helpers: field ranges, clamping, URL/localStorage encoding, and a live 2027 survival track.
// No physics here: every number comes from engine.simulate, the line-for-line port of pipeline/simulate.py.
import { simulate, bareMoonDip, PRESETS, type Dsn, type Ephem, type Preset } from './engine';

export interface Field { key: keyof Preset; code: string; label: string; min: number; max: number; step: number; pct?: boolean }
export const FIELDS: Field[] = [
  { key: 'battery_wh', code: 'b', label: 'Battery capacity (Wh)', min: 200, max: 20000, step: 100 },
  { key: 'panel_area_m2', code: 'a', label: 'Panel area (m²)', min: 0.5, max: 30, step: 0.1 },
  { key: 'panel_eff', code: 'e', label: 'Cell efficiency', min: 0.10, max: 0.35, step: 0.01 },
  { key: 'load_w', code: 'l', label: 'Continuous load (W)', min: 20, max: 1500, step: 5 },
  { key: 'heater_w', code: 'h', label: 'Survival heater when dark (W)', min: 0, max: 500, step: 5 },
  { key: 'soc_floor', code: 'f', label: 'Battery floor (%)', min: 5, max: 50, step: 1, pct: true },
  { key: 'charge_eff', code: 'c', label: 'Charge efficiency', min: 0.80, max: 1.00, step: 0.01 },
];
export const LAYOUTS: [string, string][] = [
  ['vertical_4', '4 vertical panels (N/E/S/W)'],
  ['tracking_mast', 'Sun-tracking vertical mast'],
  ['horizontal_deck', 'Horizontal deck'],
  ['vertical_4_on_side', '4 vertical panels, lander on its side'],
];
export const CUSTOM_LABEL = 'Custom lander (your own)';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// display value (floor in %) <-> preset value (floor as fraction)
export const shown = (p: Preset, f: Field) => (f.pct ? Math.round(100 * (p[f.key] as number)) : (p[f.key] as number));
export function setField(p: Preset, f: Field, displayValue: number): Preset {
  const v = Number.isFinite(displayValue) ? clamp(displayValue, f.min, f.max) : (shown(p, f) as number);
  return { ...p, [f.key]: f.pct ? v / 100 : v };
}
export function sanitize(p: Partial<Preset> | null | undefined): Preset {
  let out: Preset = { ...PRESETS.medium_vertical, label: CUSTOM_LABEL };
  if (!p) return out;
  for (const f of FIELDS) {
    const raw = Number(p[f.key]);
    if (Number.isFinite(raw)) out = setField(out, f, f.pct ? raw * 100 : raw);
  }
  if (LAYOUTS.some(([k]) => k === p.panel_layout)) out.panel_layout = p.panel_layout!;
  return out;
}
export function fromPreset(key: string): Preset { return sanitize({ ...PRESETS[key] }); }

export function encode(p: Preset): string {
  return FIELDS.map(f => `${f.code}${+shown(p, f).toFixed(3)}`).join(',') + `,p=${p.panel_layout}`;
}
export function decode(s: string | null): Preset | null {
  if (!s) return null;
  const o: any = {};
  for (const tok of s.split(',')) {
    if (tok.startsWith('p=')) { o.panel_layout = tok.slice(2); continue; }
    const f = FIELDS.find(x => x.code === tok[0]); const v = Number(tok.slice(1));
    if (!f || !Number.isFinite(v)) return null;
    o[f.key] = f.pct ? v / 100 : v;
  }
  if (!LAYOUTS.some(([k]) => k === o.panel_layout) || FIELDS.some(f => o[f.key] === undefined)) return null;
  return sanitize(o);
}
const LS = 'penumbra.customLander';
export function loadStored(): Preset | null { try { return decode(localStorage.getItem(LS)); } catch { return null; } }
export function store(p: Preset) { try { localStorage.setItem(LS, encode(p)); } catch { /* storage unavailable */ } }

export const peakSolarW = (p: Preset) => p.panel_eff * 1361 * p.panel_area_m2;
export const neverCharges = (p: Preset) => p.load_w >= peakSolarW(p);

const YEAR0 = Date.UTC(2027, 0, 1);
const iso = (d: number) => new Date(YEAR0 + d * 86400000).toISOString().slice(0, 19);
/** 14-day survival for a landing at 00:00 UTC on each day of 2027, computed live (365 simulate calls). */
export function survivalYearLive(e: Ephem, d: Dsn, H: Float64Array, lat: number, lon: number, z_m: number, p: Preset): boolean[] {
  const out: boolean[] = [];
  for (let day = 0; day < 365; day++) out.push(simulate(e, d, H, lat, lon, iso(day), 14, p, bareMoonDip(z_m + 2)).survives);
  return out;
}
