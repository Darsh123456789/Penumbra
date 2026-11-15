"""
Step 8 — Extra exports for the web app.

  dsn_visible.bin  : bitset, one bit per 10-minute step from 2023-01-01 00:00 UTC to 2033-01-01, set when the Moon is
                     above 10 deg at >= 1 NASA DSN complex (same model as simulate.dsn_visible).
  dsn_meta.json    : start, step, count
  sites.json       : site library with sources and an "approximate" flag

Usage:  python pipeline/09_export_web.py
"""
import json, os
import numpy as np
import geometry as g
import simulate as S

WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")
START, STOP = "2023-01-01T00:00:00", "2033-01-01T00:00:00"

g.load_kernels()
e0, e1 = g.utc_to_et(START), g.utc_to_et(STOP)
ets = np.arange(e0, e1, S.STEP_S)
vis = np.zeros(len(ets), bool)
for i in range(0, len(ets), 20000):
    vis[i:i + 20000], _ = S.dsn_visible(ets[i:i + 20000])
np.packbits(vis, bitorder="little").tofile(os.path.join(WEB, "dsn_visible.bin"))
json.dump({"start_utc": START, "start_et_tdb_s": e0, "step_s": S.STEP_S, "n": int(len(ets)), "mask_deg": 10.0,
           "bit_order": "little (bit i of byte i//8 is step i)", "share_visible": float(vis.mean())},
          open(os.path.join(WEB, "dsn_meta.json"), "w"), indent=2)
print(f"DSN bitset: {len(ets):,} steps, Moon visible from >=1 complex {100 * vis.mean():.1f}% of the time")

sites = [
    {"key": "shackleton", "name": "Shackleton rim", "dataset": "NASA LOLA PGDA 78 Site04 (5 m)", "detailed": True,
     "context": "Chang'e-7 is targeting the Shackleton rim area; Artemis interest", "approximate": False},
    {"key": "malapert", "name": "Malapert massif", "dataset": "NASA LOLA PGDA 78 Site23 (5 m)", "detailed": True,
     "context": "One of NASA's nine Artemis candidate regions", "approximate": False},
    {"key": "leibnitz_beta", "name": "Leibnitz beta / Mons Mouton", "dataset": "NASA LOLA PGDA 78 Site20v2 (5 m)",
     "detailed": True, "context": "Mons Mouton area: Artemis candidate region; IM-2 landed nearby", "approximate": False},
    {"key": "haworth", "name": "Haworth", "dataset": "NASA LOLA PGDA 78 Haworth (5 m)", "detailed": True,
     "context": "One of NASA's nine Artemis III candidate regions (NASA, Oct 2024)", "approximate": False},
    {"key": "nobile_rim_2", "name": "Nobile Rim 2", "dataset": "NASA LOLA PGDA 78 DM2 (5 m)", "detailed": True,
     "context": "One of NASA's nine Artemis III candidate regions (NASA, Oct 2024); PGDA 78 map DM2", "approximate": False},
    {"key": "im2_replay", "name": "IM-2 Athena (replay)", "lat": -84.78, "lon": 29.13,
     "dataset": "NASA LOLA PGDA 90 (80 m)", "detailed": False,
     "context": "Intended site per LROC; landed about 250 m away on 6 Mar 2025", "approximate": False},
    {"key": "chandrayaan3", "name": "Chandrayaan-3 Shiv Shakti", "lat": -69.373, "lon": 32.319,
     "dataset": "Flat horizon (outside 80-90 S maps)", "detailed": False,
     "context": "ISRO lander, 23 Aug 2023; validation case", "approximate": False},
]
d = np.load(os.path.join(g.HERE, "out", "horizons_shackleton.npz"))
for s in sites:
    if s["detailed"]:
        h = np.load(os.path.join(g.HERE, "out", f"horizons_{s['key']}.npz"))
        b = int(np.argmax(h["sun_pct"]))
        s.update(lat=float(h["lat"][b]), lon=float(h["lon"][b]), best_index=b, best_sun_pct_2027=float(h["sun_pct"][b]))
json.dump({"sites": sites}, open(os.path.join(WEB, "sites.json"), "w"), indent=2)
print("wrote sites.json")
