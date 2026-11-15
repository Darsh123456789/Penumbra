// PENUMBRA relay what-if: a representative lunar relay in an elliptical lunar frozen orbit (ELFO).
//
// ASSUMPTION, NOT AN OPERATIONAL EPHEMERIS. "Representative elliptical lunar frozen orbit (ELFO) in the style of
// ESA Lunar Pathfinder." ESA/SSTL state that Lunar Pathfinder flies an ELFO focused on the south pole but publish no
// elements we could find, so the size and shape come from the NASA LCRNS reference ELFO (periselene 1,750 km,
// aposelene 17,400 km altitude, ~30 h period; arXiv:2507.22145, Table II and Sec. D). Inclination, node and phase
// are assumed (marked below).
//
// Model: two-body Kepler orbit about the Moon (mu = 4902.800 km^3/s^2). Elements are defined at the epoch in a
// frame aligned with MOON_ME at that instant and held fixed in inertial space (no J2, no Earth perturbation; a frozen
// orbit is designed to keep e and omega nearly constant). Positions are rotated into MOON_ME by the Moon's sidereal
// rotation (27.321661 d) about the MOON_ME z axis; libration and pole precession are ignored. Good to ~1 deg in
// elevation over a 14-day mission, not to metres.
import { R_MOON, azEl, dsnAt, horizonAt, siteVector, enu, interp, type Dsn, type Ephem, type V3 } from './engine';

export const MU_MOON = 4902.800;              // km^3/s^2
export const ET_EPOCH = 852033600;            // 2027-01-01T00:00:00 TDB in ET seconds past J2000
const SIDEREAL_S = 27.321661 * 86400;

export interface Elements { a_km: number; e: number; i_deg: number; raan_deg: number; argp_deg: number; m0_deg: number }
const HP = 1750, HA = 17400;                  // periselene / aposelene altitudes (km), LCRNS reference ELFO
export const ELFO: Elements = {
  a_km: R_MOON + (HP + HA) / 2,               // 11,312.4 km (paper: ~11,316 km)
  e: (HA - HP) / (2 * R_MOON + HP + HA),      // 0.6918 (paper: ~0.692)
  i_deg: 57.8,                                // ASSUMED: within the 56-63 deg ELFO family
  raan_deg: 0,                                // ASSUMED
  argp_deg: 90,                               // periselene at the northernmost point, so aposelene is far south
  m0_deg: 0,                                  // ASSUMED: at periselene at the epoch
};
export const ELEMENT_NOTES: [string, string, string][] = [
  ['Periselene altitude', `${HP} km`, 'LCRNS reference ELFO (cited)'],
  ['Aposelene altitude', `${HA} km`, 'LCRNS reference ELFO (cited)'],
  ['Semi-major axis a', `${ELFO.a_km.toFixed(1)} km`, 'derived from the two altitudes'],
  ['Eccentricity e', ELFO.e.toFixed(4), 'derived'],
  ['Period', `${(2 * Math.PI * Math.sqrt(ELFO.a_km ** 3 / MU_MOON) / 3600).toFixed(1)} h`, 'derived (paper: ~30 h)'],
  ['Inclination i', `${ELFO.i_deg}°`, 'assumed (ELFO family)'],
  ['Argument of periselene ω', `${ELFO.argp_deg}°`, 'assumed: puts aposelene over the southern hemisphere'],
  ['Ascending node Ω', `${ELFO.raan_deg}°`, 'assumed'],
  ['Mean anomaly at epoch M0', `${ELFO.m0_deg}° (2nd relay: 180°)`, 'assumed'],
  ['Epoch', '2027-01-01T00:00:00 TDB', ''],
];

export const RELAY_SOURCES: [string, string][] = [
  ['ESA: Lunar Pathfinder will focus coverage on the Moon’s south pole (frozen elliptical orbit)', 'https://www.esa.int/ESA_Multimedia/Images/2021/03/Lunar_Pathfinder_will_focus_coverage_on_the_Moon_s_south_pole'],
  ['SSTL: Lunar Pathfinder, Elliptical Lunar Frozen Orbit, launch 2027', 'https://sstl.co.uk/what-we-do/lunar-mission-services'],
  ['LCRNS reference ELFO (1,750 × 17,400 km, ~30 h): arXiv:2507.22145, Sec. D', 'https://arxiv.org/pdf/2507.22145'],
  ['NASA GSFC: LCRNS Reference Constellation 3.1 white paper (ELFOs with apolune over the south pole)', 'https://ntrs.nasa.gov/citations/20250002698'],
  ['NASA LCRNS / LunaNet relay constellation design (AAS 25-758)', 'https://ntrs.nasa.gov/api/citations/20250006883/downloads/AAS_25_758_LDN_design_v7.pdf'],
];

/** Relay position (km) in MOON_ME at ET seconds. */
export function relayPos(et: number, el: Elements = ELFO, dM_deg = 0): V3 {
  const d2r = Math.PI / 180, n = Math.sqrt(MU_MOON / el.a_km ** 3);
  let M = (el.m0_deg + dM_deg) * d2r + n * (et - ET_EPOCH);
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = el.e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) { const dE = (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-12) break; }
  const xp = el.a_km * (Math.cos(E) - el.e), yp = el.a_km * Math.sqrt(1 - el.e ** 2) * Math.sin(E);
  const O = el.raan_deg * d2r, w = el.argp_deg * d2r, i = el.i_deg * d2r;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  const x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  const th = -2 * Math.PI * (et - ET_EPOCH) / SIDEREAL_S;   // inertial -> body-fixed: rotate by -(spin angle)
  const c = Math.cos(th), s = Math.sin(th);
  return [c * x - s * y, s * x + c * y, z];
}

/** True if the straight line from p to q misses the Moon's sphere. */
function clearOfMoon(p: V3, q: V3): boolean {
  const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = Math.max(0, Math.min(1, -(p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / dd));
  const c = [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]];
  return c[0] * c[0] + c[1] * c[1] + c[2] * c[2] > R_MOON * R_MOON;
}

export interface RelayState { az: number; el: number; aboveHorizon: boolean; seesEarth: boolean; dsn: boolean; link: boolean }

/** One relay's geometry from a site: above the LOLA horizon + margin, clear line to Earth, and a DSN station. */
export function relayState(e: Ephem, d: Dsn, H: Float64Array, S: V3, M: [V3, V3, V3], et: number, dM_deg = 0, marginDeg = 1): RelayState {
  const r = relayPos(et, ELFO, dM_deg);
  const [az, el] = azEl([r[0] - S[0], r[1] - S[1], r[2] - S[2]], M);
  const aboveHorizon = el - horizonAt(H, az) >= marginDeg;
  const seesEarth = clearOfMoon(r, interp(e.earth, e, et));
  const dsn = dsnAt(d, et);
  return { az, el, aboveHorizon, seesEarth, dsn, link: aboveHorizon && seesEarth && dsn };
}

export type RelayMode = 'off' | 'one' | 'two';
export const RELAY_LABEL: Record<RelayMode, string> = {
  off: 'Off',
  one: '1 relay (Pathfinder-style ELFO)',
  two: '2 relays (LunaNet-style what-if, 180° apart)',
};

/** Link predicate for simulate(): any relay in the chosen constellation gives a link. */
export function relayFn(mode: RelayMode, e: Ephem, d: Dsn, H: Float64Array, lat: number, lon: number, marginDeg = 1): ((et: number) => boolean) | undefined {
  if (mode === 'off') return undefined;
  const S = siteVector(lat, lon), M = enu(lat, lon), phases = mode === 'two' ? [0, 180] : [0];
  return (et: number) => phases.some(ph => relayState(e, d, H, S, M, et, ph, marginDeg).link);
}

/** Share of a mission (10-minute steps) with at least one relay above the local terrain horizon + margin. */
export function relayAbovePct(mode: RelayMode, e: Ephem, d: Dsn, H: Float64Array, lat: number, lon: number, et0: number, days: number, marginDeg = 1): number {
  if (mode === 'off') return 0;
  const S = siteVector(lat, lon), M = enu(lat, lon), phases = mode === 'two' ? [0, 180] : [0];
  const n = Math.round(days * 86400 / 600);
  let k = 0;
  for (let i = 0; i < n; i++) if (phases.some(ph => relayState(e, d, H, S, M, et0 + i * 600, ph, marginDeg).aboveHorizon)) k++;
  return 100 * k / n;
}
