"""
Step 11 — Per-point grid for "pick any point" in the web app.

For every one of the 96 x 96 = 9,216 horizon points per site, writes the values the browser needs
to analyse that exact spot: height above datum, 2027 Sun / Earth / both percentages (from step 3,
same numbers as the illumination maps) and the Horn 3x3 landing slope on the 5 m LOLA map
(same method as 07_planb.py / 10_point_meta.py). Point order matches horizons_<site>.bin
(y-major, then x), so index k in this file is index k in the horizon file.

Writes web/public/data/grid_<site>.json

Usage:  python pipeline/11_point_grid.py
"""
import importlib, json, os
import numpy as np

planb = importlib.import_module("07_planb")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
WEB = os.path.join(HERE, "..", "web", "public", "data")
FILES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif"}
LIMIT = 8.0

for site, f in FILES.items():
    d = np.load(os.path.join(OUT, f"horizons_{site}.npz"))
    n = int(round(np.sqrt(len(d["x"]))))
    sl = planb.slopes_5m(f, d["x"], d["y"])
    if sl is None:
        raise SystemExit(f"5 m map {f} not found")
    r1 = lambda a: [None if not np.isfinite(v) else round(float(v), 1) for v in a]
    out = {
        "site": site, "grid_n": n, "order": "y-major then x, same as horizons_<site>.bin",
        "fields": {"z_m": "height above 1737.4 km datum (m)", "sun": "% of 2027 with Sun centre above terrain",
                   "earth": "% of 2027 with Earth above terrain", "both": "% of 2027 with both",
                   "slope": "Horn 3x3 slope on 5 m LOLA map (deg), null where the 5 m map has no data"},
        "landing_slope_limit_deg": LIMIT,
        "z_m": r1(d["z"]), "sun": r1(d["sun_pct"]), "earth": r1(d["earth_pct"]),
        "both": r1(d["both_pct"]), "slope": r1(sl),
    }
    json.dump(out, open(os.path.join(WEB, f"grid_{site}.json"), "w"), separators=(",", ":"))
    ok = np.isfinite(sl)
    print(f"{site}: n={n}, slope ok {ok.sum()}/{len(sl)}, landable {(sl[ok] < LIMIT).sum()}, "
          f"max sun {np.nanmax(d['sun_pct']):.1f}%")
