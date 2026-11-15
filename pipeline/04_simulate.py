"""
Step 4 — Slip curves and the default mission timeline for the web app.

For each demo site, picks representative points (best-lit, a good, a typical and a
poor one), then simulates a 14-day mission landing at 00:00 UTC on EVERY day of
2027 for each lander preset. The browser's slip slider reads these curves.

Outputs (web/public/data/):
  slip_<site>.json       per point, per preset: daily arrays of the mission metrics
  timeline_<site>.json   10-minute series for the default scenario (best point, 2027-02-14)

Usage:  python pipeline/04_simulate.py
"""
import sys
import json
import os
import time

import numpy as np

import geometry as g
import simulate as S

SITES = ["shackleton", "malapert", "leibnitz_beta", "haworth", "nobile_rim_2"]
YEAR0, NDAYS, MISSION_DAYS = "2027-01-01T00:00:00", 365, 14
DEFAULT_START = "2027-02-14T00:00:00"
WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
KEYS = ["sunlit_pct", "earth_pct", "both_pct", "link_pct", "longest_night_h", "longest_blackout_h",
        "energy_in_kwh", "min_soc", "hours_to_floor", "survives", "sunset_in_h", "earthset_in_h"]


def pick_points(d):
    sun = d["sun_pct"]
    order = np.argsort(sun)
    n = len(sun)
    return {"best": int(order[-1]), "good": int(order[int(0.95 * n)]),
            "typical": int(order[int(0.5 * n)]), "poor": int(order[int(0.2 * n)])}


def main():
    g.load_kernels()
    P = {k: v for k, v in S.presets().items() if not k.startswith("_")}
    et0 = g.utc_to_et(YEAR0)
    steps_day = int(86400 / S.STEP_S)
    ets_all = et0 + S.STEP_S * np.arange((NDAYS + MISSION_DAYS) * steps_day)
    dsn_all, _ = S.dsn_visible(ets_all)
    n_steps = MISSION_DAYS * steps_day
    for site in (sys.argv[1:] or SITES):
        t = time.time()
        d = np.load(os.path.join(g.HERE, "out", f"horizons_{site}.npz"))
        pts = pick_points(d)
        out = {"site": site, "start_utc": YEAR0, "n_days": NDAYS, "mission_days": MISSION_DAYS,
               "landing_time": "00:00 UTC each day", "presets": {k: v["label"] for k, v in P.items()},
               "points": {}}
        for label, k in pts.items():
            H = d["horizon"][k].astype(float)
            lat, lon = float(d["lat"][k]), float(d["lon"][k])
            entry = {"lat": lat, "lon": lon, "z_m": float(d["z"][k]), "sun_pct_2027": float(d["sun_pct"][k]),
                     "by_preset": {}}
            for pname, p in P.items():
                cols = {key: [] for key in KEYS}
                for day in range(NDAYS):
                    start = g.et_to_utc(et0 + day * 86400.0)
                    dsn = dsn_all[day * steps_day: day * steps_day + n_steps]
                    r = S.simulate(H, lat, lon, start, MISSION_DAYS, p, dsn_cache=dsn)
                    for key in KEYS:
                        v = r[key]
                        cols[key].append(round(v, 2) if isinstance(v, float) else v)
                entry["by_preset"][pname] = cols
            out["points"][label] = entry
        with open(os.path.join(WEB, f"slip_{site}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        # default-scenario timeline for the Mission Board
        k = pts["best"]
        r = S.simulate(d["horizon"][k].astype(float), float(d["lat"][k]), float(d["lon"][k]),
                       DEFAULT_START, MISSION_DAYS, P["medium_vertical"], keep_series=True)
        with open(os.path.join(WEB, f"timeline_{site}.json"), "w") as f:
            json.dump({"site": site, "point": "best", "start_utc": DEFAULT_START, "preset": "medium_vertical", **r},
                      f, separators=(",", ":"))
        surv = {pn: 100 * np.mean(out["points"]["best"]["by_preset"][pn]["survives"]) for pn in P}
        typ = {pn: 100 * np.mean(out["points"]["typical"]["by_preset"][pn]["survives"]) for pn in P}
        print(f"{site:14s} {time.time() - t:5.1f} s | landing days in 2027 that survive 14 d, best point: "
              + ", ".join(f"{k} {v:.0f}%" for k, v in surv.items())
              + " | typical point: " + ", ".join(f"{k} {v:.0f}%" for k, v in typ.items()))


if __name__ == "__main__":
    main()
