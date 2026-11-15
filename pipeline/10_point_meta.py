"""
Step 10 — Landing-slope metadata for every point the web app shows.

Horn 3x3 slope on the NASA LOLA PGDA 78 5 m map (same method as 07_planb.py) at the four
representative points per site (slip_<site>.json) and at each dispersion aim point.
Writes web/public/data/points_meta.json.

Usage:  python pipeline/10_point_meta.py
"""
import importlib, json, os
import numpy as np
import terrain as T

planb = importlib.import_module("07_planb")
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "data")
FILES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif"}
LIMIT = 8.0
out = {"slope_source": "PGDA 78 5 m map, 3x3 Horn window (15 m baseline)", "landing_slope_limit_deg": LIMIT, "sites": {}}
for site, f in FILES.items():
    slip = json.load(open(os.path.join(WEB, f"slip_{site}.json")))
    disp = json.load(open(os.path.join(WEB, f"dispersion_{site}.json")))
    labels = list(slip["points"]) + ["dispersion_aim"]
    lats = [slip["points"][k]["lat"] for k in slip["points"]] + [disp["aim"]["lat"]]
    lons = [slip["points"][k]["lon"] for k in slip["points"]] + [disp["aim"]["lon"]]
    X, Y = T.latlon_to_xy(np.array(lats), np.array(lons))
    sl = planb.slopes_5m(f, X, Y)
    out["sites"][site] = {lab: {"slope_deg": round(float(s), 2), "landable": bool(s < LIMIT)} for lab, s in zip(labels, sl)}
    print(site, {k: v["slope_deg"] for k, v in out["sites"][site].items()})
json.dump(out, open(os.path.join(WEB, "points_meta.json"), "w"), indent=1)
