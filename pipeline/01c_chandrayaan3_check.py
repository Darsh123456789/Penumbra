"""
Step 1c — First real-mission check (flat horizon, before terrain is added).

Computes local sunrise/sunset at Chandrayaan-3's Shiv Shakti point
(69.373 S, 32.319 E) for August-October 2023, directly from SPICE.
Reported by ISRO and press: landing 23 Aug 2023; rover and lander put to
sleep 2-4 Sep ahead of nightfall; next sunrise expected around 22 Sep 2023.

A flat horizon is used here, so terrain will shift these times slightly;
Step 3 (horizons) repeats this check with LOLA terrain.

Usage:  python pipeline/01c_chandrayaan3_check.py
"""
import numpy as np
import geometry as g

LAT, LON = -69.373, 32.319
SUN_RADIUS_DEG = 0.2666  # apparent solar radius at 1 AU

g.load_kernels()
et0, et1 = g.utc_to_et("2023-08-15T00:00:00"), g.utc_to_et("2023-10-10T00:00:00")
ets = np.arange(et0, et1, 600.0)  # 10-minute steps
site = g.site_vector(LAT, LON)
M = g.enu_matrix(LAT, LON)
_, el = g.az_el(g.body_vectors(ets, "SUN") - site, M)
_, eel = g.az_el(g.body_vectors(ets, "EARTH") - site, M)

print("Chandrayaan-3, Shiv Shakti point, flat horizon")
print(f"Earth elevation over the period: {eel.min():.1f} to {eel.max():.1f} deg (always in view: {eel.min() > 0})")
print(f"Max Sun elevation: {el.max():.1f} deg")
for label, thresh in (("Sun centre", 0.0), ("Last of the solar disc", -SUN_RADIUS_DEG)):
    up = el > thresh
    edges = np.nonzero(np.diff(up.astype(int)))[0]
    print(f"\n{label} crossings (UTC):")
    for i in edges:
        kind = "SUNRISE" if up[i + 1] else "SUNSET "
        print(f"  {kind}  {g.et_to_utc(ets[i + 1])[:16]}")
