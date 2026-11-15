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
  (c) Shadow truth: PENUMBRA lit/shadow mask vs LROC NAC M128378248LC (data/lroc/) over the whole image strip
      in 20 m cells, IoU + overlay PNG (web/public/data/validation_shadow.png).
  (d) Chandrayaan-3 with terrain: needs a LOLA DEM covering 69.37 S (e.g. PGDA 90
      LDEM_60S_240MPP_ADJ.TIF in data/dem/); otherwise not_available.

Output: web/public/data/validation.json, validation_shadow.png (+ pipeline/out/validation_pgda69.png)
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


# ---------------------------------------------------------------- (c) shadow truth vs LROC NAC
LROC_DIR = os.path.join(ROOT, "data", "lroc")
NAC = {  # LROC NAC CDR M128378248LC; corner coordinates and times from its LROC product page / PDS label
    "id": "M128378248LC", "start": "2010-05-13T08:23:02.536", "stop": "2010-05-13T08:23:34.124",
    "lines": 52224, "samples": 2532, "scale": 3.05185094759972e-05, "offset_bytes": 2 * 2532,
    "corners": {"UL": (-89.30, 296.84), "UR": (-89.32, 302.63), "LL": (-88.93, 153.79), "LR": (-88.95, 149.87)},
    "incidence_center_deg": 90.93, "emission_deg": 1.69,
}
SHIFT_MAX_M = 300.0
CELL_M = 20.0


def _sun_horizon_kernel():
    import math
    from numba import njit, prange
    import terrain as T
    _height, _cart = T._height, T._cart

    @njit(parallel=True, cache=False)
    def run(px, py, az, obs_h, nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, max_range):
        out = np.full(px.shape[0], -90.0)
        for k in prange(px.shape[0]):
            x, y = px[k], py[k]
            z0 = _height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, x, y) + obs_h
            P = _cart(x, y, z0)
            pr = math.sqrt(P[0] ** 2 + P[1] ** 2 + P[2] ** 2)
            U0, U1, U2 = P[0] / pr, P[1] / pr, P[2] / pr
            rho = math.sqrt(x * x + y * y)
            nxm, nym, exm, eym = x / rho, y / rho, y / rho, -x / rho
            A = az[k]
            dxm = math.cos(A) * nxm + math.sin(A) * exm
            dym = math.cos(A) * nym + math.sin(A) * eym
            best = -90.0
            d = ndx
            while d < max_range:
                h = _height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, x + dxm * d, y + dym * d)
                if h > -1.0e29:
                    Q = _cart(x + dxm * d, y + dym * d, h)
                    vx, vy, vz = Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]
                    e = math.degrees(math.asin((vx * U0 + vy * U1 + vz * U2) / math.sqrt(vx * vx + vy * vy + vz * vz)))
                    if e > best:
                        best = e
                d += max(ndx, 0.01 * d)
            out[k] = best
        return out
    return run


def _otsu(v):
    h, edges = np.histogram(v, 512)
    c = 0.5 * (edges[1:] + edges[:-1])
    w = np.cumsum(h); m = np.cumsum(h * c)
    wb, wf = w[:-1], w[-1] - w[:-1]
    ok = (wb > 0) & (wf > 0)
    between = np.zeros_like(wb, dtype=float)
    between[ok] = (m[-1] * wb[ok] / w[-1] - m[:-1][ok]) ** 2 / (wb[ok] * wf[ok])
    return float(c[:-1][np.argmax(between)])


def part_c():
    img_path = os.path.join(LROC_DIR, NAC["id"] + ".IMG")
    if not os.path.exists(img_path) or not os.path.exists(os.path.join(DEM_DIR, SITES["shackleton"])):
        return {"status": "not_available", "image_id": "", "image_time_utc": "", "iou": None, "overlay_png": "",
                "notes": "No LROC NAC image in data/lroc/ (or Site04 map missing)."}
    import time as _t
    import terrain as T
    from scipy.ndimage import uniform_filter, map_coordinates
    near, far = T.load(SITES["shackleton"])
    # affine (line, sample) -> map (x, y) from the four corner coordinates (least squares; residual reported)
    L, Sm = NAC["lines"] - 1, NAC["samples"] - 1
    ls = {"UL": (0, 0), "UR": (0, Sm), "LL": (L, 0), "LR": (L, Sm)}
    G = np.array([[ls[k][0], ls[k][1], 1.0] for k in ls])
    XY = np.array([T.latlon_to_xy(*NAC["corners"][k]) for k in ls], float)
    coef, *_ = np.linalg.lstsq(G, XY, rcond=None)
    corner_resid = float(np.max(np.linalg.norm(G @ coef - XY, axis=1)))
    Ainv = np.linalg.inv(coef[:2].T)
    mpl_, mps_ = np.linalg.norm(coef[0]), np.linalg.norm(coef[1])
    # analysis cells: a regular grid in image space, ~CELL_M on the ground, 150 m inside the strip edges
    li = np.arange(150 / mpl_, L - 150 / mpl_, CELL_M / mpl_)
    si = np.arange(150 / mps_, Sm - 150 / mps_, CELL_M / mps_)
    LI, SI = [a_.ravel() for a_ in np.meshgrid(li, si, indexing="ij")]
    X, Y = (np.stack([LI, SI, np.ones_like(LI)], 1) @ coef).T
    lat, lon = T.xy_to_latlon(X, Y)
    b_ = near.bounds
    in5 = (X > b_.left + 300) & (X < b_.right - 300) & (Y > b_.bottom + 300) & (Y < b_.top - 300)
    # Sun direction for every cell at the time its image line was exposed
    et0, et1 = g.utc_to_et(NAC["start"]), g.utc_to_et(NAC["stop"])
    t = et0 + (et1 - et0) * LI / L
    sv = g.body_vectors(np.array([et0, et1]), "SUN")
    sun = sv[0] + np.outer((t - et0) / (et1 - et0), sv[1] - sv[0])
    la, lo = np.radians(lat), np.radians(lon)
    S = g.R_MOON * np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], 1)
    v = sun - S
    E_ = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], 1)
    N_ = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], 1)
    e, n, u = (v * E_).sum(1), (v * N_).sum(1), (v * S / g.R_MOON).sum(1)
    sel = np.degrees(np.arctan2(u, np.hypot(e, n)))
    saz = np.arctan2(e, n)
    run = _sun_horizon_kernel()
    nz, nx0, ny0, ndx = near.params(); fz, fx0, fy0, fdx = far.params()
    _t0 = _t.time()
    hz = run(X, Y, saz, 0.0, nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, T.MAX_RANGE_M)
    lit_model = np.clip((sel - hz + SUN_R) / (2 * SUN_R), 0, 1) > 0.5
    print(f"  shadow: {len(X)} cells raycast in {_t.time() - _t0:.0f} s, model lit {100 * lit_model.mean():.1f}%")
    # image: I/F averaged over one cell (box of CELL_M on the ground), sampled at each cell centre (+ shifts)
    raw = np.memmap(img_path, dtype="<i2", mode="r", offset=NAC["offset_bytes"], shape=(NAC["lines"], NAC["samples"]))
    sub = np.asarray(raw, dtype=np.float32)
    valid = (sub > -32000).astype(np.float32)
    sub = np.where(sub > -32000, sub, 0) * np.float32(NAC["scale"])
    box = (int(round(CELL_M / mpl_)), int(round(CELL_M / mps_)))
    num, den = uniform_filter(sub, box), uniform_filter(valid, box)
    img_nn = np.where(den > 0.99, num / np.maximum(den, 1e-6), -1).astype(np.float32)
    del sub, valid, num, den

    def sample(dx, dy, m=slice(None)):
        qs = (np.stack([X[m] + dx, Y[m] + dy], 1) - coef[2]) @ Ainv.T
        return map_coordinates(img_nn, [qs[:, 0], qs[:, 1]], order=1, mode="nearest")

    iof0 = sample(0, 0)
    thr = _otsu(iof0[iof0 >= 0])

    def score(iof, m=slice(None)):
        ok = iof >= 0
        a_, bb = lit_model[m][ok], iof[ok] > thr
        return float((a_ & bb).sum() / max(1, (a_ | bb).sum())), float((a_ == bb).mean())

    iou0, acc0 = score(iof0)
    cx = cy = 0.0
    for step, span in ((30.0, SHIFT_MAX_M), (10.0, 30.0), (5.0, 10.0)):
        cand = [(cx + i, cy + j) for i in np.arange(-span, span + 1, step) for j in np.arange(-span, span + 1, step)
                if abs(cx + i) <= SHIFT_MAX_M and abs(cy + j) <= SHIFT_MAX_M]
        cx, cy = max(cand, key=lambda c: score(sample(*c))[0])
    iofb = sample(cx, cy)
    rb = score(iofb)
    best = (rb[0], rb[1], float(cx), float(cy)) if rb[0] > iou0 else (iou0, acc0, 0.0, 0.0)
    if best[2] == 0.0 and best[3] == 0.0:
        iofb = iof0
    obs = (iofb > thr) & (iofb >= 0)
    ok = iofb >= 0
    site04 = {"n_cells": int((in5 & ok).sum()),
              "model_lit_pct": round(float(100 * lit_model[in5 & ok].mean()), 2),
              "image_lit_pct": round(float(100 * obs[in5 & ok].mean()), 2),
              "pixel_agreement": round(float((lit_model == obs)[in5 & ok].mean()), 3)}
    _shadow_png(LI, SI, li, si, lit_model, iofb, thr, best)
    return {"status": "done", "image_id": NAC["id"], "image_time_utc": NAC["start"], "iou": round(best[0], 3),
            "overlay_png": "validation_shadow.png",
            "iou_nominal": round(iou0, 3), "pixel_agreement": round(best[1], 3), "pixel_agreement_nominal": round(acc0, 3),
            "registration_shift_m": [best[2], best[3]], "cell_m": CELL_M, "n_cells": int(ok.sum()),
            "lit_pct_model": round(float(100 * lit_model[ok].mean()), 2), "lit_pct_image": round(float(100 * obs[ok].mean()), 2),
            "otsu_threshold_iof": round(thr, 5),
            "sun_elev_flat_deg": [round(float(sel.min()), 3), round(float(sel.max()), 3)],
            "inside_site04_5m_map": site04,
            "notes": (f"LROC NAC {NAC['id']} (CDR, I/F), {NAC['start']} to {NAC['stop'][11:]} UTC, emission "
                      f"{NAC['emission_deg']} deg, incidence {NAC['incidence_center_deg']} deg at image centre; whole 51 km "
                      f"strip analysed in {CELL_M:.0f} m cells. Georeferenced by an affine fit to the four corner coordinates "
                      f"on the LROC product page (fit residual {corner_resid:.0f} m); the corners are given to 0.01 deg (up "
                      f"to ~300 m), so a +-{SHIFT_MAX_M:.0f} m translation search (30/10/5 m steps) was run: iou uses the best "
                      f"shift ({best[2]:+.0f}, {best[3]:+.0f} m in map x, y), iou_nominal uses none. Not orthorectified "
                      f"(no ISIS/LRO SPICE here). Model: cell lit if more than half the solar disc clears the terrain along "
                      f"the Sun azimuth, ray from the surface, PGDA 78 Site04 5 m where available (only the first part of "
                      f"the strip), otherwise PGDA 90 80 m, to 200 km; Sun from DE440 at each line's exposure time. Image lit "
                      f"= cell-mean I/F above the Otsu threshold. The sunlit part of this image lies outside the 5 m map, so "
                      f"the IoU mostly tests the 80 m map.")}


def _shadow_png(LI, SI, li, si, lit_model, iof, thr, best):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    nl, ns = len(li), len(si)
    img = np.where(iof >= 0, iof, np.nan).reshape(nl, ns)
    mod = lit_model.reshape(nl, ns).astype(float)
    obs = iof > thr
    ag = np.zeros(len(iof)); ag[lit_model & obs] = 3; ag[lit_model & ~obs] = 2; ag[~lit_model & obs] = 1
    ag[iof < 0] = np.nan
    ag = ag.reshape(nl, ns)
    rows = np.nonzero((mod > 0).any(1) | (np.nan_to_num(img) > thr).any(1))[0]
    r0, r1 = max(0, rows.min() - 20), min(nl, rows.max() + 20)
    km = lambda i: i * NAC["lines"] / nl * 0.97 / 1e3
    ext = [0, ns * CELL_M / 1e3, km(r1), km(r0)]
    fig, ax = plt.subplots(1, 3, figsize=(11, 11), constrained_layout=True, sharey=True)
    ax[0].imshow(img[r0:r1], cmap="gray", vmin=0, vmax=np.nanpercentile(img, 99.5), extent=ext, aspect="auto")
    ax[0].set_title(f"LROC NAC {NAC['id']}\n(I/F, {CELL_M:.0f} m cells)")
    ax[1].imshow(mod[r0:r1], cmap="gray", vmin=0, vmax=1, extent=ext, aspect="auto", interpolation="nearest")
    ax[1].set_title("PENUMBRA lit / shadow\nsame time, LOLA terrain")
    cm = ListedColormap(["#1a1a1a", "#56b4e9", "#d55e00", "#f0e442"])
    ax[2].imshow(ag[r0:r1], cmap=cm, vmin=-0.5, vmax=3.5, extent=ext, aspect="auto", interpolation="nearest")
    ax[2].set_title(f"IoU {best[0]:.2f}  yellow: both lit\nblue: image only, orange: model only")
    ax[0].set_ylabel("Distance along image strip (km)")
    for a_ in ax:
        a_.set_xlabel("Across strip (km)")
    fig.suptitle(f"Shadow truth, {NAC['start'][:19]} UTC (shift {best[2]:+.0f}, {best[3]:+.0f} m)")
    fig.savefig(os.path.join(WEB, "validation_shadow.png"), dpi=90)
    plt.close(fig)


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
    print("(c)", shadow)
    terr = part_d()
    print("(d)", terr)
    out = {"generated_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "horizons": horizons, "interpolation": interp, "pgda69": pg, "shadow": shadow,
           "chandrayaan3": {"flat": flat, "terrain": terr, "reported": REPORTED}}
    with open(os.path.join(WEB, "validation.json"), "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
