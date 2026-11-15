"""
Step 5 — Dispersion Cloud: the landing is a cloud, not a point.

For each case:
  1. Lay a fine grid of cells around the aim point (covering the whole landing ellipse).
  2. Terrain uncertainty: build M terrain variants. Each adds spatially correlated
     noise to the DEM, scaled pixel by pixel by NASA's LOLA height-error map
     (PGDA 78 *_toterr.tif, or PGDA 90 *_ERR.tif for the 80 m map). Variant 0 is the
     nominal terrain.
  3. Raycast every cell's horizon in every variant and run the Step 4 survival
     simulator for the mission. P_cell = share of variants in which the mission survives.
  4. Monte Carlo landing: draw N touchdown points from a 2-D Gaussian whose 3-sigma
     radius is the landing-ellipse radius; each point takes its cell's survival in a
     random terrain variant. P(survive) = mean over draws.
  5. Safer aim point: for every candidate aim cell, the expected survival if the same
     ellipse were centred there (Gaussian-weighted P_cell); the best one is reported.

Cases: the three PGDA 78 sites (5 m terrain), plus the IM-2 replay on the PGDA 90
80 m map, because no 5 m map covers IM-2's landing site.

Outputs: web/public/data/dispersion_<case>.json and docs/figures/dispersion_<case>.png

Usage:  python pipeline/05_dispersion.py [case ...]
"""
import copy
import json
import os
import sys
import time

import numpy as np
import rasterio
from scipy.ndimage import gaussian_filter

import geometry as g
import simulate as S
import terrain as T

WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
FIG = os.path.join(os.path.dirname(g.HERE), "docs", "figures")
N_VARIANTS = 10          # 1 nominal + 9 perturbed terrains
N_DRAWS = 4000
CORR_PIX = 10            # noise correlation length in pixels (50 m on the 5 m maps)
RNG = np.random.default_rng(2026)

CASES = {
    # aim: "best" = best-lit grid point from Step 3, or explicit (lat, lon)
    "shackleton": dict(dem="Site04_final_adj_5mpp_surf.tif", err="Site04_final_adj_5mpp_toterr.tif",
                       aim="best", radius_m=400, half_box_m=520, cell_m=20, days=14, preset="medium_vertical",
                       start=None, label="Shackleton rim, best-lit point"),
    "malapert": dict(dem="Site23_final_adj_5mpp_surf.tif", err="Site23_final_adj_5mpp_toterr.tif",
                     aim="best", radius_m=400, half_box_m=520, cell_m=20, days=14, preset="medium_vertical",
                     start=None, label="Malapert massif, best-lit point"),
    "leibnitz_beta": dict(dem="Site20v2_final_adj_5mpp_surf.tif", err="Site20v2_final_adj_5mpp_toterr.tif",
                          aim="best", radius_m=400, half_box_m=520, cell_m=20, days=14, preset="medium_vertical",
                          start=None, label="Leibnitz beta / Mons Mouton, best-lit point"),
    "nobile_rim_2": dict(dem="DM2_final_adj_5mpp_surf.tif", err="DM2_final_adj_5mpp_toterr.tif",
                         aim="best", radius_m=400, half_box_m=520, cell_m=20, days=14, preset="medium_vertical",
                         start=None, label="Nobile Rim 2 (Artemis III candidate region), best-lit point"),
    "haworth": dict(dem="Haworth_final_adj_5mpp_surf.tif", err="Haworth_final_adj_5mpp_toterr.tif",
                    aim="best", radius_m=400, half_box_m=520, cell_m=20, days=14, preset="medium_vertical",
                    start=None, label="Haworth (Artemis III candidate region), best-lit point"),
    "im2_replay": dict(dem=None, err="LDEM_80S_80MPP_ADJ_ERR.tiff",
                       aim=(-84.78, 29.13), radius_m=400, half_box_m=640, cell_m=40, days=10,
                       preset="small_vertical", start="2025-03-06T17:31:00",
                       label="IM-2 Athena replay, intended site (LROC), 80 m terrain",
                       marks={"Reported rest point (approx.)": (-84.7906, 29.1957)}),
}


def variant(dem, err, k):
    """Terrain variant k: nominal (k=0) or nominal + correlated noise scaled by the error map."""
    if k == 0:
        return dem
    v = copy.copy(dem)
    w = RNG.standard_normal(dem.z.shape).astype(np.float32)
    w = gaussian_filter(w, CORR_PIX)
    w /= w.std()
    v.z = dem.z + w * err
    return v


def pick_start(site, preset, days):
    """First 2027 landing day from 14 Feb on where the aim point (best) survives with the preset."""
    d = json.load(open(os.path.join(WEB, f"slip_{site}.json")))
    surv = d["points"]["best"]["by_preset"][preset]["survives"]
    for day in list(range(44, 365)) + list(range(0, 44)):
        if surv[day]:
            return g.et_to_utc(g.utc_to_et("2027-01-01T00:00:00") + 86400 * day)
    return "2027-02-14T00:00:00"


def run(key):
    c = CASES[key]
    t0 = time.time()
    far = T.DEM(os.path.join(T.DATA, T.FAR_FILE))
    near = T.DEM(os.path.join(T.DATA, c["dem"])) if c["dem"] else far
    with rasterio.open(os.path.join(T.DATA, c["err"])) as d:
        err = d.read(1).astype(np.float32)
    err[~np.isfinite(err)] = np.nanmedian(err)

    if c["aim"] == "best":
        h = np.load(os.path.join(g.HERE, "out", f"horizons_{key}.npz"))
        b = int(np.argmax(h["sun_pct"]))
        ax, ay = float(h["x"][b]), float(h["y"][b])
    else:
        ax, ay = [float(v) for v in T.latlon_to_xy(*c["aim"])]
    start = c["start"] or pick_start(key, c["preset"], c["days"])
    preset = S.presets()[c["preset"]]

    off = np.arange(-c["half_box_m"], c["half_box_m"] + 1e-6, c["cell_m"])
    n = len(off)
    GX, GY = [a.ravel() for a in np.meshgrid(ax + off, ay + off)]
    lat, lon = T.xy_to_latlon(GX, GY)
    ets = g.utc_to_et(start) + S.STEP_S * np.arange(int(c["days"] * 86400 / S.STEP_S))
    dsn, _ = S.dsn_visible(ets)

    surv = np.zeros((N_VARIANTS, len(GX)), bool)
    sun = np.zeros((N_VARIANTS, len(GX)))
    hours = np.zeros((N_VARIANTS, len(GX)))
    for k in range(N_VARIANTS):
        nv = variant(near, err, k)
        H = T.horizons(nv, far if c["dem"] else nv, GX, GY, 2.0)
        for i in range(len(GX)):
            r = S.simulate(H[i].astype(float), lat[i], lon[i], start, c["days"], preset, dsn_cache=dsn)
            surv[k, i] = r["survives"]
            sun[k, i] = r["sunlit_pct"]
            hours[k, i] = r["hours_to_floor"] if r["hours_to_floor"] is not None else c["days"] * 24
        print(f"  {key}: variant {k + 1}/{N_VARIANTS} done ({time.time() - t0:.0f} s)")
    P_cell = surv.mean(0)

    # Monte Carlo landing around the aim point
    sigma = c["radius_m"] / 3.0
    dx, dy = RNG.normal(0, sigma, N_DRAWS), RNG.normal(0, sigma, N_DRAWS)
    ci = np.clip(np.round((dx + c["half_box_m"]) / c["cell_m"]).astype(int), 0, n - 1)
    cj = np.clip(np.round((dy + c["half_box_m"]) / c["cell_m"]).astype(int), 0, n - 1)
    kv = RNG.integers(0, N_VARIANTS, N_DRAWS)
    p_survive = float(surv[kv, cj * n + ci].mean())
    target_idx = (n // 2) * n + n // 2
    inside = (off[None, :] ** 2 + off[:, None] ** 2).ravel() <= c["radius_m"] ** 2
    lethal_share = float((P_cell[inside] < 0.5).mean())

    # safer aim point: Gaussian-weighted survival for each candidate centre
    Pg = P_cell.reshape(n, n)
    expected = gaussian_filter(Pg, sigma / c["cell_m"], mode="nearest")
    margin = int(np.ceil(c["radius_m"] / c["cell_m"] / 3))
    sub = expected[margin:n - margin, margin:n - margin]
    bj, bi = np.unravel_index(np.argmax(sub), sub.shape)
    bj, bi = bj + margin, bi + margin
    if sub.max() - expected[n // 2, n // 2] < 0.005:   # no real improvement: keep the original aim
        bi = bj = n // 2
    better = {"dx_m": float(off[bi]), "dy_m": float(off[bj]), "expected_p": float(expected[bj, bi]),
              "distance_m": float(np.hypot(off[bi], off[bj]))}

    # battery series: target vs worst cell inside the ellipse (nominal terrain)
    Hn = T.horizons(near, far if c["dem"] else near, GX[[target_idx]], GY[[target_idx]], 2.0)
    tgt = S.simulate(Hn[0].astype(float), lat[target_idx], lon[target_idx], start, c["days"], preset,
                     dsn_cache=dsn, keep_series=True)
    worst_idx = int(np.flatnonzero(inside)[np.argmin(hours[0][inside])])
    Hw = T.horizons(near, far if c["dem"] else near, GX[[worst_idx]], GY[[worst_idx]], 2.0)
    wst = S.simulate(Hw[0].astype(float), lat[worst_idx], lon[worst_idx], start, c["days"], preset,
                     dsn_cache=dsn, keep_series=True)

    marks = {}
    for name, (mla, mlo) in c.get("marks", {}).items():
        mx, my = T.latlon_to_xy(mla, mlo)
        mi = int(round((mx - ax + c["half_box_m"]) / c["cell_m"])); mj = int(round((my - ay + c["half_box_m"]) / c["cell_m"]))
        inbox = 0 <= mi < n and 0 <= mj < n
        marks[name] = {"lat": mla, "lon": mlo, "dx_m": float(mx - ax), "dy_m": float(my - ay),
                       "p_cell": float(Pg[mj, mi]) if inbox else None,
                       "sunlit_pct_nominal": float(sun[0].reshape(n, n)[mj, mi]) if inbox else None,
                       "hours_to_floor_nominal": float(hours[0].reshape(n, n)[mj, mi]) if inbox else None}

    lat0, lon0 = T.xy_to_latlon(ax, ay)
    out = {"case": key, "label": c["label"], "aim": {"lat": float(lat0), "lon": float(lon0), "x_m": ax, "y_m": ay},
           "landing_utc": start, "mission_days": c["days"], "preset": c["preset"],
           "preset_label": preset["label"], "ellipse_radius_3sigma_m": c["radius_m"],
           "terrain": c["dem"] or T.FAR_FILE, "terrain_error_map": c["err"], "n_variants": N_VARIANTS,
           "n_draws": N_DRAWS, "grid": {"n": n, "cell_m": c["cell_m"], "half_box_m": c["half_box_m"]},
           "p_survive": p_survive, "target_cell_p": float(P_cell[target_idx]), "lethal_share_of_ellipse": lethal_share,
           "safer_aim": better, "marks": marks,
           "p_cell": np.round(P_cell, 3).tolist(), "sunlit_pct_nominal": np.round(sun[0], 1).tolist(),
           "battery": {"t_h": tgt["series"]["t_h"][::3], "target_soc": tgt["series"]["soc"][::3],
                       "worst_soc": wst["series"]["soc"][::3], "worst_dx_m": float(GX[worst_idx] - ax),
                       "worst_dy_m": float(GY[worst_idx] - ay), "worst_hours_to_floor": wst["hours_to_floor"],
                       "target_hours_to_floor": tgt["hours_to_floor"]},
           "runtime_s": round(time.time() - t0, 1)}
    with open(os.path.join(WEB, f"dispersion_{key}.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    figure(key, out, Pg, off)
    print(f"{key:14s} landing {start[:16]} | P(survive) {100 * p_survive:5.1f}% | target cell {100 * P_cell[target_idx]:5.1f}% | "
          f"lethal share of ellipse {100 * lethal_share:4.1f}% | safer aim {better['distance_m']:.0f} m away "
          f"-> {100 * better['expected_p']:.1f}% | {out['runtime_s']:.0f} s")
    for name, m in marks.items():
        print(f"    {name}: cell survival {m['p_cell']}, sunlit {m['sunlit_pct_nominal']}%, "
              f"hours to battery floor {m['hours_to_floor_nominal']}")


def figure(key, out, Pg, off):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(12, 5), constrained_layout=True)
    e = [off[0], off[-1], off[0], off[-1]]
    im = ax[0].imshow(Pg * 100, origin="lower", extent=e, cmap="RdYlGn", vmin=0, vmax=100)
    t = np.linspace(0, 2 * np.pi, 200)
    r = out["ellipse_radius_3sigma_m"]
    ax[0].plot(r * np.cos(t), r * np.sin(t), "w--", lw=1.5)
    ax[0].plot(0, 0, "wo", ms=9, mfc="none", mew=2)
    ax[0].plot(out["safer_aim"]["dx_m"], out["safer_aim"]["dy_m"], "c^", ms=9)
    for name, m in out["marks"].items():
        ax[0].plot(m["dx_m"], m["dy_m"], "wD", ms=8)
        ax[0].annotate(name, (m["dx_m"], m["dy_m"]), color="w", fontsize=8, xytext=(6, -12), textcoords="offset points")
    ax[0].set_title(f"Survival chance per cell (%) — P(survive) = {100 * out['p_survive']:.0f}%")
    ax[0].set_xlabel("east-ish offset in map x (m)"); ax[0].set_ylabel("map y offset (m)")
    fig.colorbar(im, ax=ax[0], shrink=0.85)
    b = out["battery"]
    ax[1].plot(b["t_h"], np.array(b["target_soc"]) * 100, label="aim point")
    ax[1].plot(b["t_h"], np.array(b["worst_soc"]) * 100, label="worst point in ellipse")
    ax[1].axhline(20, color="r", ls=":", label="survival floor")
    ax[1].set_xlabel("hours after landing"); ax[1].set_ylabel("battery state of charge (%)"); ax[1].legend()
    ax[1].set_title("Battery: aim point vs worst point")
    fig.suptitle(f"{out['label']} — landing {out['landing_utc'][:16]} UTC, {out['mission_days']} days, "
                 f"3σ ellipse {r} m, {out['n_variants']} terrain variants")
    fig.savefig(os.path.join(FIG, f"dispersion_{key}.png"), dpi=105)
    plt.close(fig)


if __name__ == "__main__":
    g.load_kernels()
    os.makedirs(FIG, exist_ok=True)
    for k in (sys.argv[1:] or CASES):
        run(k)
