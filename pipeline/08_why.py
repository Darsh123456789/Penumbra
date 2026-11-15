"""
Step 8 — "Why?": explain the change in sunlit_pct at each site's original (best-lit) point
between scenario A (landing 2027-02-14 00:00 UTC) and scenario B (2027-02-26 00:00 UTC),
14-day mission, mid-size generic preset, using one-at-a-time swaps.

Factors (each delta is in percentage points of the 14-day mission):
  Sun path      : sunlit_pct with B's Sun vectors and A's everything else, minus value_a.
  Earth path    : B's Earth vectors (and DSN times) with A's Sun. Sunlight cannot depend on
                  Earth, so its sunlit delta is measured (expected 0); the comms metric
                  link_pct is reported in `link_delta` and in `note`.
  Terrain horizon: value_b (real LOLA horizon) minus scenario B with a flat 0-deg horizon,
                  i.e. how many points of sunlight the terrain removes on the slipped date.
                  `delta_on_change` = (B-A with terrain) - (B-A with a flat horizon).
  Panel height  : scenario B with a 5 m panel (terrain.horizons(obs_h=5), new raycast)
                  minus value_b (2 m). Needs the LOLA maps in data/dem/.
Blocking ridge: the 1-deg azimuth bin in which the Sun was below the terrain horizon most
often during B; a raycast along that bin centre reports the terrain sample with the
highest elevation angle (distance and height above the observer's eye).

Outputs: web/public/data/why_<site>.json
Usage:   python pipeline/08_why.py [site ...]
"""
import json
import math
import os
import sys

import numpy as np

import geometry as g
import simulate as S

SITES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif", "haworth": "Haworth_final_adj_5mpp_surf.tif", "nobile_rim_2": "DM2_final_adj_5mpp_surf.tif"}
PRESET = "medium_vertical"
A_UTC, B_UTC, DAYS = "2027-02-14T00:00:00", "2027-02-26T00:00:00", 14
OBS_H = 2.0
WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
DEM_DIR = os.environ.get("PENUMBRA_DATA", os.path.join(os.path.dirname(g.HERE), "data", "dem"))


def ets_for(utc):
    return g.utc_to_et(utc) + S.STEP_S * np.arange(int(DAYS * 86400 / S.STEP_S))


def metrics(H, lat, lon, sun_ets, earth_ets, dsn, p):
    """Same physics as simulate.simulate(), but Sun and Earth directions may come from different epochs."""
    saz, sel, _, _ = S.sky(lat, lon, sun_ets)
    _, _, eaz, eel = S.sky(lat, lon, earth_ets)
    f_sun = np.clip((sel - S.horizon_at(H, saz) + S.SUN_R) / (2 * S.SUN_R), 0, 1)
    earth_up = eel - S.horizon_at(H, eaz) > p.get("earth_margin_deg", 1.0)
    link = earth_up & dsn
    return {"sunlit_pct": float(100 * (f_sun > 0.5).mean()), "link_pct": float(100 * link.mean()),
            "earth_pct": float(100 * earth_up.mean()), "saz": saz, "sel": sel, "hz": S.horizon_at(H, saz)}


def ridge_profile(near, far, x, y, az_deg, obs_h):
    """Raycast along one azimuth (same marching rule as terrain.raycast); return the max-angle sample."""
    import terrain as T
    z0 = float(T.ground_height(near, far, [x], [y])[0]) + obs_h
    P = np.array(T._cart(x, y, z0))
    U = P / np.linalg.norm(P)
    rho = math.hypot(x, y)
    nx, ny, ex, ey = x / rho, y / rho, y / rho, -x / rho
    A = math.radians(az_deg)
    dxm, dym = math.cos(A) * nx + math.sin(A) * ex, math.cos(A) * ny + math.sin(A) * ey
    best = (-90.0, None, None)
    dist = near.dx
    while dist < T.MAX_RANGE_M:
        sx, sy = x + dxm * dist, y + dym * dist
        h = float(T.ground_height(near, far, [sx], [sy])[0])
        if h > T.OUTSIDE:
            Q = np.array(T._cart(sx, sy, h))
            v = Q - P
            e = math.degrees(math.asin(float(v @ U) / float(np.linalg.norm(v))))
            if e > best[0]:
                best = (e, dist, h)
        dist += max(near.dx, 0.01 * dist)
    e, dist, h = best
    return {"elevation_deg": round(e, 3), "distance_km": round(dist / 1e3, 3),
            "height_above_observer_m": round(h - z0, 1), "sample_height_m": round(h, 1), "observer_eye_m": round(z0, 1)}


def run(site, p):
    d = np.load(os.path.join(g.HERE, "out", f"horizons_{site}.npz"))
    k = int(np.argmax(d["sun_pct"]))
    H = d["horizon"][k].astype(float)
    lat, lon, x, y = float(d["lat"][k]), float(d["lon"][k]), float(d["x"][k]), float(d["y"][k])
    eA, eB = ets_for(A_UTC), ets_for(B_UTC)
    dA, _ = S.dsn_visible(eA, p["dsn_mask_deg"])
    dB, _ = S.dsn_visible(eB, p["dsn_mask_deg"])
    flat = np.zeros(360)

    A = metrics(H, lat, lon, eA, eA, dA, p)
    B = metrics(H, lat, lon, eB, eB, dB, p)
    # consistency with the shared simulator
    simA = S.simulate(H, lat, lon, A_UTC, DAYS, p, dsn_cache=dA)
    assert abs(simA["sunlit_pct"] - A["sunlit_pct"]) < 1e-9 and abs(simA["link_pct"] - A["link_pct"]) < 1e-9

    sun_sw = metrics(H, lat, lon, eB, eA, dA, p)          # B's Sun, A's Earth/DSN/terrain/height
    earth_sw = metrics(H, lat, lon, eA, eB, dB, p)        # B's Earth (+ its DSN times), A's Sun
    A_flat = metrics(flat, lat, lon, eA, eA, dA, p)
    B_flat = metrics(flat, lat, lon, eB, eB, dB, p)

    factors = [
        {"name": "Sun path (season and date)", "delta": round(sun_sw["sunlit_pct"] - A["sunlit_pct"], 2),
         "how": "B's Sun vectors with A's Earth, DSN, terrain and 2 m panel, minus value_a"},
        {"name": "Earth path (libration)", "delta": round(earth_sw["sunlit_pct"] - A["sunlit_pct"], 2),
         "link_delta": round(earth_sw["link_pct"] - A["link_pct"], 2),
         "how": "B's Earth vectors and DSN times with A's Sun; delta = sunlit change, link_delta = link_pct change"},
        {"name": "Terrain horizon", "delta": round(B["sunlit_pct"] - B_flat["sunlit_pct"], 2),
         "delta_on_change": round((B["sunlit_pct"] - A["sunlit_pct"]) - (B_flat["sunlit_pct"] - A_flat["sunlit_pct"]), 2),
         "flat_a": round(A_flat["sunlit_pct"], 2), "flat_b": round(B_flat["sunlit_pct"], 2),
         "how": "value_b with the real LOLA horizon minus scenario B with a flat 0-deg horizon"},
    ]

    # blocking ridge: azimuth bin with the most Sun-below-terrain steps in B
    blocked = B["sel"] < B["hz"]
    bins = np.floor(B["saz"][blocked]).astype(int) % 360
    counts = np.bincount(bins, minlength=360)
    # The Sun crosses each 1-deg bin in ~12 ten-minute steps, so many bins tie; among the tied bins take the one
    # with the highest terrain horizon (the actual ridge rather than open sky the Sun was simply too low for).
    tied = np.nonzero(counts == counts.max())[0]
    az_bin = int(tied[np.argmax(H[tied])])
    ridge = {"azimuth_deg": az_bin + 0.5, "blocked_steps": int(counts[az_bin]), "blocked_steps_total": int(blocked.sum()),
             "tied_bins": int(len(tied)), "tie_break": "highest terrain horizon among bins with the most blocked steps",
             "horizon_elev_deg_grid": round(float(H[az_bin]), 3)}

    near_file = os.path.join(DEM_DIR, SITES[site])
    far_file = os.path.join(DEM_DIR, "LDEM_80S_80MPP_ADJ.tiff")
    if os.path.exists(near_file) and os.path.exists(far_file):
        import terrain as T
        near, far = T.load(SITES[site])
        H2 = T.horizons(near, far, [x], [y], obs_h=OBS_H)[0].astype(float)
        H5 = T.horizons(near, far, [x], [y], obs_h=5.0)[0].astype(float)
        B2 = metrics(H2, lat, lon, eB, eB, dB, p)
        B5 = metrics(H5, lat, lon, eB, eB, dB, p)
        factors.append({"name": "Panel height", "delta": round(B5["sunlit_pct"] - B2["sunlit_pct"], 2),
                        "b_2m": round(B2["sunlit_pct"], 2), "b_5m": round(B5["sunlit_pct"], 2),
                        "raycast_check_max_abs_deg_vs_grid": round(float(np.max(np.abs(H2 - H))), 3),
                        "how": "scenario B, 5 m vs 2 m panel, both raycast fresh with terrain.horizons()"})
        prof = ridge_profile(near, far, x, y, ridge["azimuth_deg"], OBS_H)
        ridge.update({"distance_km": prof["distance_km"], "height_above_observer_m": prof["height_above_observer_m"],
                      "elevation_deg": prof["elevation_deg"], "sample_height_m": prof["sample_height_m"],
                      "observer_eye_m": prof["observer_eye_m"], "status": "done"})
    else:
        factors.append({"name": "Panel height", "delta": None, "status": "not_available",
                        "reason": "needs the LOLA _surf 5 m map and LDEM_80S_80MPP_ADJ.tiff in data/dem/ to raycast at 5 m"})
        ridge.update({"distance_km": None, "height_above_observer_m": None, "status": "not_available",
                      "reason": "raycast needs the LOLA maps in data/dem/"})

    out = {"site": site, "metric": "sunlit_pct", "scenario_a_utc": A_UTC, "scenario_b_utc": B_UTC,
           "preset": PRESET, "mission_days": DAYS, "point": {"lat": round(lat, 5), "lon": round(lon, 4)},
           "value_a": round(A["sunlit_pct"], 2), "value_b": round(B["sunlit_pct"], 2),
           "link_pct_a": round(A["link_pct"], 2), "link_pct_b": round(B["link_pct"], 2),
           "factors": factors, "blocking_ridge": ridge,
           "note": (f"One-at-a-time attribution; bars need not add up exactly. Comms factor: swapping in B's Earth path "
                    f"(and DSN station times) changes link_pct by {earth_sw['link_pct'] - A['link_pct']:+.1f} points "
                    f"(A {A['link_pct']:.1f}% -> B {B['link_pct']:.1f}%); Earth's path cannot change sunlight "
                    f"(measured sunlit delta {earth_sw['sunlit_pct'] - A['sunlit_pct']:+.1f}). Terrain and panel-height "
                    f"bars are measured on the slipped date B.")}
    with open(os.path.join(WEB, f"why_{site}.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(site, json.dumps({"a": out["value_a"], "b": out["value_b"], "factors": [(f_["name"], f_["delta"]) for f_ in factors],
                            "ridge": ridge}))


def main():
    g.load_kernels()
    p = S.presets()[PRESET]
    for site in (sys.argv[1:] or SITES):
        run(site, p)


if __name__ == "__main__":
    main()
