"""
Step 1b — Independent check against NASA/JPL Horizons.

For a few lunar surface sites, asks the JPL Horizons API for the apparent,
airless azimuth/elevation of the Sun and Earth, and compares them with
PENUMBRA's own SPICE-based numbers at the same minutes.

Needs internet access to ssd.jpl.nasa.gov (run it on your own laptop).
Saves raw responses to pipeline/out/horizons/ and a summary to
web/public/data/validation_horizons.json.

Usage:  python pipeline/01b_horizons_check.py
"""
import json
import os
import re
import urllib.parse
import urllib.request

import numpy as np
import geometry as g

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
SITES = {  # name: (lat_deg, east_lon_deg); demo points, approximate
    "Shackleton rim (approx.)": (-89.45, 222.7),
    "Chandrayaan-3 Shiv Shakti": (-69.373, 32.319),
    "Malapert Massif (approx.)": (-86.0, 0.0),
}
BODIES = {"SUN": "10", "EARTH": "399"}
START, STOP, STEP = "2027-02-14 00:00", "2027-03-16 00:00", "6 h"
OUT = os.path.join(g.HERE, "out", "horizons")
SUMMARY = os.path.join(os.path.dirname(g.HERE), "web", "public", "data", "validation_horizons.json")


def query(code, lat, lon):
    params = {
        "format": "json", "COMMAND": f"'{code}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon:.4f},{lat:.4f},0'", "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'", "STEP_SIZE": f"'{STEP}'", "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'", "APPARENT": "'AIRLESS'", "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'MINUTES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())["result"]


def parse(text):
    centre = re.search(r"Center geodetic\s*:\s*(.+)", text)
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    times, az, el = [], [], []
    for line in body.strip().splitlines():
        cols = [c.strip() for c in line.split(",")]
        nums = [c for c in cols[1:] if re.fullmatch(r"-?\d+(\.\d+)?", c)]
        times.append(cols[0]); az.append(float(nums[-2])); el.append(float(nums[-1]))
    return (centre.group(1).strip() if centre else "?"), times, np.array(az), np.array(el)


def main():
    g.load_kernels()
    os.makedirs(OUT, exist_ok=True)
    results = []
    for site, (lat, lon) in SITES.items():
        S, M = g.site_vector(lat, lon), g.enu_matrix(lat, lon)
        for body, code in BODIES.items():
            text = query(code, lat, lon)
            with open(os.path.join(OUT, f"{site.split()[0]}_{body}.txt"), "w") as f:
                f.write(text)
            centre, times, haz, hel = parse(text)
            ets = np.array([g.utc_to_et(t.replace("A.D. ", "") + " UTC") for t in times])
            paz, pel = g.az_el(g.body_vectors(ets, body) - S, M)
            daz = (paz - haz + 180) % 360 - 180
            dang = np.degrees(np.arccos(np.clip(  # full angular separation of the two directions
                np.sin(np.radians(pel)) * np.sin(np.radians(hel)) +
                np.cos(np.radians(pel)) * np.cos(np.radians(hel)) * np.cos(np.radians(daz)), -1, 1)))
            r = {"site": site, "body": body, "horizons_site_echo": centre, "n": int(len(ets)),
                 "max_sep_deg": float(dang.max()), "median_sep_deg": float(np.median(dang)),
                 "max_abs_del_el_deg": float(np.abs(pel - hel).max())}
            results.append(r)
            print(f"{site:28s} {body:5s} n={r['n']:3d}  median {r['median_sep_deg']:.4f} deg  "
                  f"max {r['max_sep_deg']:.4f} deg   (Horizons site: {centre})")
    with open(SUMMARY, "w") as f:
        json.dump({"source": "NASA/JPL Horizons API", "window": [START, STOP, STEP], "results": results}, f, indent=2)
    print(f"\nWrote {SUMMARY}")


if __name__ == "__main__":
    main()
