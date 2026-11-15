"""
Step 7 — Plan B: where and when to land instead after a launch slip.

Scenario: planned landing 2027-02-14 00:00 UTC, mid-size generic preset, 14-day mission;
the launch slips 12 days to 2027-02-26 00:00 UTC.

  * Original point = the site's best-lit grid point (argmax of 2027 sun_pct, Step 3).
    Its result on the slipped date is reported as "original".
  * Candidates = Step 3 grid points (96 x 96, ~162 m spacing) within 2 km of the original
    point whose local slope is < 8 deg. Slope comes from the 5 m PGDA 78 map over a 3x3
    window (15 m baseline, Horn's method) when the map is in data/dem/; otherwise from the
    96 x 96 grid heights (central differences, ~324 m baseline), and the JSON says which.
  * Landing dates = slipped date +-5 days, 00:00 UTC each day.
  * Ranking: survives first, then lowest longest_blackout_h, then highest sunlit_pct.
  * Top 3 -> options A, B, C (distance and bearing from the original point; bearing is
    clockwise from local north at the original point).

Outputs: web/public/data/planb_<site>.json
Usage:   python pipeline/07_planb.py [site ...]
"""
import json
import math
import os
import sys
import time

import numpy as np

import geometry as g
import simulate as S

SITES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif", "haworth": "Haworth_final_adj_5mpp_surf.tif", "nobile_rim_2": "DM2_final_adj_5mpp_surf.tif"}
PRESET = "medium_vertical"
PLANNED, SLIPPED, SLIP_DAYS, MISSION_DAYS = "2027-02-14T00:00:00", "2027-02-26T00:00:00", 12, 14
RADIUS_M, MAX_SLOPE, WINDOW = 2000.0, 8.0, 30
WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
DEM_DIR = os.environ.get("PENUMBRA_DATA", os.path.join(os.path.dirname(g.HERE), "data", "dem"))


def slopes_5m(fname, X, Y):
    """Horn 3x3 slope (deg) on the 5 m map at each (X, Y); None if the map is not available."""
    path = os.path.join(DEM_DIR, fname)
    if not os.path.exists(path):
        return None
    import rasterio
    with rasterio.open(path) as d:
        t = d.transform
        dx = t.a
        out = np.full(len(X), np.nan)
        for k, (x, y) in enumerate(zip(X, Y)):
            c = int(math.floor((x - t.c) / dx))
            r = int(math.floor((t.f - y) / dx))
            w = d.read(1, window=((r - 1, r + 2), (c - 1, c + 2))).astype(float)
            if w.shape != (3, 3) or not np.all(np.isfinite(w)):
                continue
            dzdx = ((w[0, 2] + 2 * w[1, 2] + w[2, 2]) - (w[0, 0] + 2 * w[1, 0] + w[2, 0])) / (8 * dx)
            dzdy = ((w[0, 0] + 2 * w[0, 1] + w[0, 2]) - (w[2, 0] + 2 * w[2, 1] + w[2, 2])) / (8 * dx)
            out[k] = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return out


def slopes_grid(d):
    n = int(round(math.sqrt(len(d["x"]))))
    Z = d["z"].reshape(n, n)
    xs, ys = d["x"].reshape(n, n)[0], d["y"].reshape(n, n)[:, 0]
    gy, gx = np.gradient(Z, ys, xs)
    return np.degrees(np.arctan(np.hypot(gx, gy))).ravel()


def bearing(x0, y0, x1, y1):
    rho = math.hypot(x0, y0)
    nx, ny = x0 / rho, y0 / rho          # local north in the map plane (away from the pole)
    ex, ey = y0 / rho, -x0 / rho         # local east
    dx, dy = x1 - x0, y1 - y0
    return math.degrees(math.atan2(dx * ex + dy * ey, dx * nx + dy * ny)) % 360.0


def rank_key(r):
    # survivors first: earliest landing, then shortest direct-to-Earth blackout, then most sunlight;
    # non-survivors (only shown if nothing survives): longest time before the battery floor
    if r["survives"]:
        return (0, r["shift"], r["longest_blackout_h"], -r["sunlit_pct"])
    return (1, -(r["hours_to_floor"] or 0.0), r["shift"], 0.0)


def run(site, P, dsn_by_day):
    t = time.time()
    d = np.load(os.path.join(g.HERE, "out", f"horizons_{site}.npz"))
    X, Y = d["x"], d["y"]
    k0 = int(np.argmax(d["sun_pct"]))
    x0, y0 = float(X[k0]), float(Y[k0])
    dist = np.hypot(X - x0, Y - y0)
    near = np.nonzero(dist <= RADIUS_M)[0]
    sl = slopes_5m(SITES[site], X[near], Y[near])
    slope_src = "PGDA 78 5 m map, 3x3 Horn window (15 m baseline)"
    if sl is None:
        sl = slopes_grid(d)[near]
        slope_src = "96x96 analysis-grid heights, central differences (~324 m baseline); 5 m map not in data/dem/"
    ok = near[np.isfinite(sl) & (sl < MAX_SLOPE)]
    slope_of = dict(zip(near.tolist(), sl.tolist()))

    def sim(k, day_shift):
        start = g.et_to_utc(g.utc_to_et(SLIPPED) + day_shift * 86400.0, 0).replace(" ", "T")
        return S.simulate(d["horizon"][k].astype(float), float(d["lat"][k]), float(d["lon"][k]),
                          start, MISSION_DAYS, P, dsn_cache=dsn_by_day[day_shift])

    orig = sim(k0, 0)
    rows = []
    for k in ok:
        for s in range(0, WINDOW + 1):  # after a slip you can only land on or after the new date
            r = sim(int(k), s)
            rows.append({"k": int(k), "shift": s, **{q: r[q] for q in ("survives", "sunlit_pct", "longest_blackout_h", "min_soc", "hours_to_floor")}})
    rows.sort(key=rank_key)
    options = []
    for i, r in enumerate(rows[:3]):
        k = r["k"]
        options.append({
            "rank": i + 1, "label": "ABC"[i], "lat": round(float(d["lat"][k]), 5), "lon": round(float(d["lon"][k]), 4),
            "dx_m": round(float(X[k] - x0), 1), "dy_m": round(float(Y[k] - y0), 1),
            "distance_m": round(float(dist[k]), 1), "bearing_deg": round(bearing(x0, y0, X[k], Y[k]), 1),
            "date_shift_days": r["shift"],
            "landing_utc": g.et_to_utc(g.utc_to_et(SLIPPED) + r["shift"] * 86400.0, 0).replace(" ", "T"),
            "slope_deg": round(float(slope_of[k]), 2), "survives": bool(r["survives"]),
            "sunlit_pct": round(r["sunlit_pct"], 2), "longest_blackout_h": round(r["longest_blackout_h"], 2),
            "min_soc": round(r["min_soc"], 4), "hours_to_floor": r["hours_to_floor"]})
    n_surv = sum(r["survives"] for r in rows)
    # context: first landing day (00:00 UTC) on or after the slipped date at which the ORIGINAL point survives (up to +30 d)
    nearest = None
    for a in range(0, 31):
        for s_ in (a,):
            st = g.et_to_utc(g.utc_to_et(SLIPPED) + s_ * 86400.0, 0)
            if S.simulate(d["horizon"][k0].astype(float), float(d["lat"][k0]), float(d["lon"][k0]), st,
                          MISSION_DAYS, P)["survives"]:
                nearest = s_
                break
        if nearest is not None:
            break
    out = {
        "site": site, "preset": PRESET, "mission_days": MISSION_DAYS,
        "planned_utc": PLANNED, "slipped_utc": SLIPPED, "slip_days": SLIP_DAYS,
        "search": {"radius_m": RADIUS_M, "max_slope_deg": MAX_SLOPE, "date_window_days": WINDOW,
                   "candidates_checked": len(rows), "grid_points_in_radius": int(len(near)),
                   "grid_points_passing_slope": int(len(ok)), "surviving_combinations": int(n_surv),
                   "slope_source": slope_src, "grid_spacing_m": round(float(np.diff(np.unique(X))[0]), 1)},
        "original": {"lat": round(float(d["lat"][k0]), 5), "lon": round(float(d["lon"][k0]), 4),
                     "slope_deg": round(float(slope_of[k0]), 2),
                     "survives": bool(orig["survives"]), "sunlit_pct": round(orig["sunlit_pct"], 2),
                     "longest_blackout_h": round(orig["longest_blackout_h"], 2), "min_soc": round(orig["min_soc"], 4),
                     "hours_to_floor": orig["hours_to_floor"],
                     "nearest_surviving_shift_days": nearest,
                     "nearest_surviving_note": "Delay after the slipped date (searched 0 to +30 d, 00:00 UTC) at which the original point survives 14 d; null if none."},
        "options": options,
    }
    with open(os.path.join(WEB, f"planb_{site}.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(f"{site:14s} {time.time() - t:5.1f} s | original on slipped date: survives={orig['survives']} "
          f"sunlit {orig['sunlit_pct']:.1f}% blackout {orig['longest_blackout_h']:.0f} h | {len(ok)} pts x {WINDOW + 1} days, "
          f"{n_surv} survive | A: {options[0]['distance_m']:.0f} m @ {options[0]['bearing_deg']:.0f} deg, "
          f"shift {options[0]['date_shift_days']:+d} d, blackout {options[0]['longest_blackout_h']:.0f} h")
    return out


def main():
    g.load_kernels()
    P = S.presets()[PRESET]
    steps = int(MISSION_DAYS * 86400 / S.STEP_S)
    e0 = g.utc_to_et(SLIPPED)
    dsn_by_day = {}
    for s in range(0, WINDOW + 1):
        ets = e0 + s * 86400.0 + S.STEP_S * np.arange(steps)
        dsn_by_day[s], _ = S.dsn_visible(ets, P.get("dsn_mask_deg", 10.0))
    for site in (sys.argv[1:] or SITES):
        run(site, P, dsn_by_day)


if __name__ == "__main__":
    main()
