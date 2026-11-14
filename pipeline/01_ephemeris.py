"""
Step 1 — Ephemeris table.

Builds hourly Sun and Earth position vectors in the Moon-fixed MOON_ME frame
(observer = Moon centre, aberration 'LT+S') for 2026-01-01 to 2033-01-01, and
exports them as compact float32 binaries for the browser plus an .npz for Python.

Because these vectors are the same for every site, the browser only needs this
one table: for a site S the direction to the Sun or Earth is (body - S).

Also runs self-checks:
  1. Interpolation + float32 error vs direct SPICE at 2,000 random minutes,
     measured as the angular error seen from a polar site (worst case for Earth parallax).
  2. Sanity ranges at the south pole (Sun elevation must stay within about +-1.6 deg).

Usage:  python pipeline/01_ephemeris.py
"""
import json
import os
import time

import numpy as np
import spiceypy as sp

import geometry as g

START_UTC = "2026-01-01T00:00:00"
STOP_UTC = "2033-01-01T00:00:00"
STEP_S = 3600.0
OUT_DIR = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
NPZ_PATH = os.path.join(g.HERE, "out", "ephemeris_hourly.npz")


def build_table():
    et0, et1 = g.utc_to_et(START_UTC), g.utc_to_et(STOP_UTC)
    n = int(round((et1 - et0) / STEP_S)) + 1
    ets = et0 + STEP_S * np.arange(n)
    t = time.time()
    sun = np.vstack([g.body_vectors(ets[i:i + 5000], "SUN") for i in range(0, n, 5000)])
    earth = np.vstack([g.body_vectors(ets[i:i + 5000], "EARTH") for i in range(0, n, 5000)])
    print(f"Computed {n:,} hourly epochs in {time.time() - t:.1f} s")
    return et0, ets, sun, earth


def interp(table, et0, et):
    x = (et - et0) / STEP_S
    i = np.clip(np.floor(x).astype(int), 0, len(table) - 2)
    f = (x - i)[:, None]
    return table[i] * (1 - f) + table[i + 1] * f


def angle_deg(a, b):
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return np.degrees(np.arccos(np.clip(np.sum(a * b, axis=1), -1, 1)))


def self_checks(et0, ets, sun, earth):
    rng = np.random.default_rng(42)
    test = rng.uniform(ets[0], ets[-1], 2000)
    test = np.round(test / 60.0) * 60.0  # whole minutes
    site = g.site_vector(-89.45, 222.7)  # near Shackleton rim (approximate demo point)
    report = {}
    for name, tab in (("SUN", sun), ("EARTH", earth)):
        exact = g.body_vectors(test, name) - site
        approx = interp(tab.astype(np.float32).astype(np.float64), et0, test) - site
        err = angle_deg(exact, approx)
        report[name] = {"max_deg": float(err.max()), "median_deg": float(np.median(err))}
        print(f"  {name:5s} interpolation+float32 error from a polar site: "
              f"median {np.median(err):.2e} deg, max {err.max():.2e} deg")

    M = g.enu_matrix(-89.45, 222.7)
    _, sun_el = g.az_el(sun - site, M)
    _, earth_el = g.az_el(earth - site, M)
    report["pole_sun_elev_range_deg"] = [float(sun_el.min()), float(sun_el.max())]
    report["pole_earth_elev_range_deg"] = [float(earth_el.min()), float(earth_el.max())]
    print(f"  Sun elevation at 89.45S over 2026-2032 (flat horizon): "
          f"{sun_el.min():+.2f} to {sun_el.max():+.2f} deg")
    print(f"  Earth elevation at 89.45S over 2026-2032 (flat horizon): "
          f"{earth_el.min():+.2f} to {earth_el.max():+.2f} deg")
    assert sun_el.max() < 2.5 and sun_el.min() > -2.5, "Sun elevation at the pole out of range: frame bug?"
    return report


def export(et0, ets, sun, earth, report):
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(NPZ_PATH), exist_ok=True)
    np.savez_compressed(NPZ_PATH, et=ets, sun=sun, earth=earth)
    sun.astype("<f4").tofile(os.path.join(OUT_DIR, "ephem_sun.bin"))
    earth.astype("<f4").tofile(os.path.join(OUT_DIR, "ephem_earth.bin"))
    meta = {
        "description": "Apparent Sun and Earth position vectors (km) relative to the Moon centre",
        "frame": g.FRAME, "abcorr": g.ABCORR, "observer": "MOON", "units": "km",
        "layout": "little-endian float32, N rows x 3 (x, y, z)",
        "start_utc": START_UTC, "start_et_tdb_s": et0, "step_s": STEP_S, "n": int(len(ets)),
        "moon_radius_km": g.R_MOON,
        "kernels": ["naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"],
        "source": "NASA/JPL NAIF SPICE (DE440)",
        "self_checks": report,
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(OUT_DIR, "ephem_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote ephem_sun.bin, ephem_earth.bin, ephem_meta.json to {OUT_DIR}")


if __name__ == "__main__":
    g.load_kernels()
    et0, ets, sun, earth = build_table()
    print("Self-checks:")
    rep = self_checks(et0, ets, sun, earth)
    export(et0, ets, sun, earth, rep)
