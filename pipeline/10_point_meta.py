"""
Step 10 — Landing-slope metadata for every point the web app shows.

Horn 3x3 slope on the NASA LOLA PGDA 78 5 m map (same method as 07_planb.py) at the four
representative points per site (slip_<site>.json) and at each dispersion aim point.
Writes web/public/data/points_meta.json, and adds slope_deg / landable to each entry of
web/public/data/ai_search_<site>.json (the AI search itself does not filter by slope).

Usage:  python pipeline/10_point_meta.py
"""
import importlib, json, os, sys
import numpy as np
import terrain as T

planb = importlib.import_module("07_planb")
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "data")
FILES = {"shackleton": "Site04_final_adj_5mpp_surf.tif", "malapert": "Site23_final_adj_5mpp_surf.tif",
         "leibnitz_beta": "Site20v2_final_adj_5mpp_surf.tif", "haworth": "Haworth_final_adj_5mpp_surf.tif", "nobile_rim_2": "DM2_final_adj_5mpp_surf.tif"}
LIMIT = 8.0
if sys.argv[1:]:  # update only the given sites, keep the others
    FILES = {k: v for k, v in FILES.items() if k in sys.argv[1:]}
_prev = os.path.join(WEB, "points_meta.json")
out = {"slope_source": "PGDA 78 5 m map, 3x3 Horn window (15 m baseline)", "landing_slope_limit_deg": LIMIT, "sites": json.load(open(_prev))["sites"] if os.path.exists(_prev) else {}}
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

# annotate the AI search top lists (additive fields; the AI's own numbers are untouched)
for site, f in FILES.items():
    path = os.path.join(WEB, f"ai_search_{site}.json")
    if not os.path.exists(path):
        continue
    d = json.load(open(path))
    X = np.array([t["x_m"] for t in d["top"]]); Y = np.array([t["y_m"] for t in d["top"]])
    for t, s in zip(d["top"], planb.slopes_5m(f, X, Y)):
        t["slope_deg"] = round(float(s), 2); t["landable"] = bool(s < LIMIT)
    d["slope_note"] = f"slope_deg added by pipeline/10_point_meta.py ({out['slope_source']}); landable = slope < {LIMIT} deg"
    json.dump(d, open(path, "w"), indent=1)
    print(f"ai_search_{site}: slopes", [t["slope_deg"] for t in d["top"]])
