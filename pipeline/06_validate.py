"""
Step 6 — Validation summary for the web app's Trust page.

  (a) Copies the already-measured checks: NASA/JPL Horizons cross-check
      (web/public/data/validation_horizons.json), ephemeris-interpolation self-checks
      (ephem_meta.json) and the Chandrayaan-3 flat-horizon times (re-runs 01c).
  (b) PGDA 69 check: PENUMBRA's long-term average sunlight vs NASA's published average
      solar illumination (Mazarico et al. 2011; hourly over an 18.6-year lunar nodal cycle),
      85-90 S 60 m/px map AVGVISIB_85S_060M_201608.TIF, at PGDA 69 pixel centres sampled inside
      the three PGDA 78 site maps. PENUMBRA horizons are raycast fresh at each point at the
      surface (observer height 0 m, as for a surface illumination map; PGDA 69 states none)
      and the Sun is taken directly from SPICE (DE440) hourly over the same 18.6 years.
  (c) Shadow truth vs an LROC NAC image (needs an image in data/lroc/; otherwise not_available).
  (d) Chandrayaan-3 with terrain: needs a LOLA DEM covering 69.37 S (e.g. PGDA 90
      LDEM_60S_240MPP_ADJ.TIF in data/dem/); otherwise not_available.

Output: web/public/data/validation.json (+ pipeline/out/validation_pgda69.png)
Usage:  python pipeline/06_validate.py
"""
import json
import os
import re
import subprocess
import sys

import numpy as np

import geometry as g

ROOT = os.path.dirname(g.HERE)
WEB = os.path.join(ROOT, "web", "public", "data")
OUT = os.path.join(g.HERE, "out")
DEM_DIR = os.environ.get("PENUMBRA_DATA", os.path.join(ROOT, "data", "dem"))
PGDA69 = "AVGVISIB_85S_060M_201608.TIF"
LDEM60 = "LDEM_60S_240MPP_ADJ.TIF"
SITES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif"}
N_PER_SITE = 100
PGDA69_OBS_H = 0.0
CYCLE = ("2016-08-01T00:00:00", 18.6)   # start, years (one lunar nodal / nutation cycle)
SUN_R = 0.2666
CH3 = (-69.373, 32.319)
REPORTED = {"landing": "2023-08-23", "sleep": "2023-09-02 to 2023-09-04", "expected_wake": "2023-09-22"}


def part_a():
    vh = json.load(open(os.path.join(WEB, "validation_horizons.json")))
    res = vh["results"]
    horizons = {"max_sep_deg": max(r["max_sep_deg"] for r in res),
                "median_sep_deg": float(np.median([r["median_sep_deg"] for r in res])),
                "n_cases": len(res), "n_epochs": int(sum(r["n"] for r in res)),
                "median_note": "median of the 6 per-case median separations (Sun and Earth, 3 sites)"}
    meta = json.load(open(os.path.join(WEB, "ephem_meta.json")))["self_checks"]
    interp = {"sun_max_deg": meta["SUN"]["max_deg"], "earth_max_deg": meta["EARTH"]["max_deg"]}
    txt = subprocess.run([sys.executable, os.path.join(g.HERE, "01c_chandrayaan3_check.py")],
                         capture_output=True, text=True, check=True).stdout
    block = txt.split("Sun centre crossings")[1].split("Last of the solar disc")[0]
    ev = re.findall(r"(SUNRISE|SUNSET)\s+(\S+)", block)
    rises = [t for k, t in ev if k == "SUNRISE"]
    sets = [t for k, t in ev if k == "SUNSET"]
    flat = {"sunrise": rises[0], "sunset": sets[0], "next_sunrise": rises[1]}
    return horizons, interp, flat


def sun_vectors(et0, et1, step=3600.0):
    import spiceypy as sp
    ets = np.arange(et0, et1, step)
    out = np.empty((len(ets), 3))
    for s in range(0, len(ets), 20000):
        p, _ = sp.spkpos("SUN", list(ets[s:s + 20000]), g.FRAME, g.ABCORR, "MOON")
        out[s:s + 20000] = p
    return ets, out


def sunlit_fraction(lat, lon, H, sun):
    """Mean visible fraction of the solar disc (partial disc counted, as in 03_horizons.illumination)."""
    S = g.site_vector(lat, lon)
    M = g.enu_matrix(lat, lon)
    az, el = g.az_el(sun - S, M)
    b = az - 0.5
    i0 = np.floor(b).astype(int) % 360
    f = b - np.floor(b)
    hz = H[i0] * (1 - f) + H[(i0 + 1) % 360] * f
    return float(100 * np.clip((el - hz + SUN_R) / (2 * SUN_R), 0, 1).mean())


def part_b():
    path = os.path.join(DEM_DIR, PGDA69)
    far_ok = os.path.exists(os.path.join(DEM_DIR, "LDEM_80S_80MPP_ADJ.tiff"))
    missing = [f for f in [PGDA69] + list(SITES.values()) if not os.path.exists(os.path.join(DEM_DIR, f))]
    if missing or not far_ok:
        return {"status": "not_available", "n_points": 0, "r2": None, "bias_pct": None, "rmse_pct": None, "points": [],
                "notes": "missing in data/dem/: " + ", ".join(missing + ([] if far_ok else ["LDEM_80S_80MPP_ADJ.tiff"]))}
    import rasterio
    import terrain as T
    with rasterio.open(path) as d:
        crs = d.crs.to_wkt()
        A = d.read(1).astype(float)
        tr = d.transform
        nodata = d.nodata
        scale = d.scales[0] if d.scales else 1.0
        offset = d.offsets[0] if d.offsets else 0.0
    A = A * scale + offset
    if nodata is not None:
        A[A == nodata * scale + offset] = np.nan
    vmax = np.nanmax(A)
    to_pct = 100.0 if vmax <= 1.5 else (1.0 if vmax <= 100 + 1e-6 else np.nan)   # stored as a fraction (int16 x 4e-5)
    rng = np.random.default_rng(69)
    et0 = g.utc_to_et(CYCLE[0])
    ets, sun = sun_vectors(et0, et0 + CYCLE[1] * 365.25 * 86400.0)
    pts, rows = [], []
    for site, f in SITES.items():
        near, far = T.load(f)
        b = near.bounds
        # PGDA 69 pixel centres inside the 5 m map (300 m margin, like Step 3)
        cols = np.arange(int(np.ceil((b.left + 300 - tr.c) / tr.a)), int((b.right - 300 - tr.c) / tr.a))
        rws = np.arange(int(np.ceil((tr.f - (b.top - 300)) / -tr.e)), int((tr.f - (b.bottom + 300)) / -tr.e))
        cc, rr = np.meshgrid(cols, rws)
        cc, rr = cc.ravel(), rr.ravel()
        vals = A[rr, cc]
        keep = np.isfinite(vals)
        cc, rr = cc[keep], rr[keep]
        pick = rng.choice(len(cc), size=min(N_PER_SITE, len(cc)), replace=False)
        cc, rr = cc[pick], rr[pick]
        X = tr.c + (cc + 0.5) * tr.a
        Y = tr.f + (rr + 0.5) * tr.e
        H = T.horizons(near, far, X, Y, PGDA69_OBS_H)
        lat, lon = T.xy_to_latlon(X, Y)
        for k in range(len(X)):
            pen = sunlit_fraction(float(lat[k]), float(lon[k]), H[k].astype(float), sun)
            ref = float(A[rr[k], cc[k]] * to_pct)
            pts.append([round(pen, 2), round(ref, 2)])
            rows.append(site)
        print(f"  PGDA 69 {site}: {len(X)} points done")
    P = np.array(pts)
    pen, ref = P[:, 0], P[:, 1]
    resid = pen - ref
    r2 = 1 - np.sum(resid ** 2) / np.sum((ref - ref.mean()) ** 2)
    per_site = {}
    for s in SITES:
        m = np.array(rows) == s
        per_site[s] = {"n": int(m.sum()), "bias_pct": round(float(resid[m].mean()), 2),
                       "rmse_pct": round(float(np.sqrt((resid[m] ** 2).mean())), 2),
                       "pearson_r": round(float(np.corrcoef(pen[m], ref[m])[0, 1]), 3)}
    _plot(P, rows)
    return {"status": "done", "n_points": int(len(P)), "r2": round(float(r2), 3), "bias_pct": round(float(resid.mean()), 2),
            "rmse_pct": round(float(np.sqrt((resid ** 2).mean())), 2),
            "pearson_r": round(float(np.corrcoef(pen, ref)[0, 1]), 3), "per_site": per_site,
            "points": pts, "point_sites": rows,
            "notes": (f"PGDA 69 {PGDA69} (60 m/px, 85-90 S, hourly over 18.6 yr). PENUMBRA: fresh raycast at each PGDA 69 "
                      f"pixel centre, observer height {PGDA69_OBS_H:.0f} m (surface; PGDA 69 states no height), PGDA 78 5 m "
                      f"near field + PGDA 90 80 m far field to 200 km, Sun from SPICE DE440 hourly {CYCLE[0][:10]} + "
                      f"{CYCLE[1]} yr, partial solar disc counted. {N_PER_SITE} random pixels per site (seed 69). "
                      f"PGDA 69 values scaled by {to_pct:g} to percent (map max {vmax:g}). CRS checked: {crs[:80]}...")}


def _plot(P, rows):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5, 5), constrained_layout=True)
    for s, c in zip(SITES, ("#d55e00", "#0072b2", "#009e73")):
        m = np.array(rows) == s
        ax.scatter(P[m, 1], P[m, 0], s=10, c=c, label=s)
    ax.plot([0, 100], [0, 100], "k--", lw=0.8)
    ax.set_xlabel("NASA PGDA 69 average illumination (%)"); ax.set_ylabel("PENUMBRA (%)")
    ax.legend(); ax.set_title("Long-term sunlight, 18.6 yr")
    fig.savefig(os.path.join(OUT, "validation_pgda69.png"), dpi=110)
    plt.close(fig)


def part_c():
    return {"status": "not_available", "image_id": "", "image_time_utc": "", "iou": None, "overlay_png": "",
            "notes": "No LROC NAC image could be obtained: this build environment has no access to the LROC archive "
                     "(data.lroc.im-ldi.com / QuickMap), and no image was supplied in data/lroc/."}


def part_d():
    path = os.path.join(DEM_DIR, LDEM60)
    if not os.path.exists(path):
        return {"status": "not_available", "sunrise": "", "sunset": "", "next_sunrise": "",
                "reason": "PENUMBRA's 5 m and 80 m maps stop at 80 S; a LOLA DEM covering 69.37 S "
                          f"(PGDA 90 {LDEM60}) was not available in data/dem/."}
    import terrain as T
    dem = T.DEM(path)
    x, y = T.latlon_to_xy(*CH3)
    H = T.horizons(dem, dem, [float(x)], [float(y)], obs_h=2.0)[0].astype(float)
    et0, et1 = g.utc_to_et("2023-08-15T00:00:00"), g.utc_to_et("2023-10-10T00:00:00")
    ets = np.arange(et0, et1, 600.0)
    S = g.site_vector(*CH3)
    M = g.enu_matrix(*CH3)
    az, el = g.az_el(g.body_vectors(ets, "SUN") - S, M)
    b = az - 0.5
    i0 = np.floor(b).astype(int) % 360
    f = b - np.floor(b)
    hz = H[i0] * (1 - f) + H[(i0 + 1) % 360] * f
    up = el > hz
    edges = np.nonzero(np.diff(up.astype(int)))[0]
    rises = [g.et_to_utc(ets[i + 1])[:16] for i in edges if up[i + 1]]
    sets = [g.et_to_utc(ets[i + 1])[:16] for i in edges if not up[i + 1]]
    return {"status": "done", "sunrise": rises[0], "sunset": sets[0], "next_sunrise": rises[1],
            "dem": LDEM60, "observer_height_m": 2.0, "sun_criterion": "Sun centre above the terrain horizon",
            "horizon_max_deg": round(float(H.max()), 2)}


def main():
    g.load_kernels()
    horizons, interp, flat = part_a()
    print("(a)", horizons, interp, flat)
    pg = part_b()
    print("(b)", {k: v for k, v in pg.items() if k not in ("points", "point_sites")})
    shadow = part_c()
    terr = part_d()
    print("(d)", terr)
    out = {"generated_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "horizons": horizons, "interpolation": interp, "pgda69": pg, "shadow": shadow,
           "chandrayaan3": {"flat": flat, "terrain": terr, "reported": REPORTED}}
    with open(os.path.join(WEB, "validation.json"), "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
