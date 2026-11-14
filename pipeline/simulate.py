"""
Step 4 — Survival simulator (power, battery, direct-to-Earth comms).

Given one surface point (its 360-degree horizon at panel height), a landing time,
a mission length and a lander preset, steps through the mission every 10 minutes:

  Sun      : apparent az/el from the Step 1 ephemeris table; visible fraction of the
             solar disc above the terrain horizon (partial sunlight counted).
  Power    : P_in = eta * S * f_sun * sum over panels of A_i * max(0, cos(theta_i)),
             S = 1361 W/m^2. Panel layouts: four vertical faces, a single-axis
             tracking mast, or a horizontal deck.
  Battery  : state of charge integrates P_in*charge_eff - load - heater(dark);
             clipped to [0, capacity]. Mission fails if it drops below the floor.
  Comms    : direct-to-Earth link possible when Earth's centre is at least
             `earth_margin_deg` above the terrain horizon AND the Moon is above
             `dsn_mask_deg` at one of the three NASA Deep Space Network complexes.

DSN geometry: Earth's rotation is modelled with the Earth Rotation Angle about the
J2000 pole (precession and nutation ignored, < 0.4 deg in this decade). That is
ample for a 10-degree elevation mask.

Lander presets are GENERIC and editable (pipeline/presets.json); they are not
models of any real spacecraft.
"""
import json
import math
import os

import numpy as np
import spiceypy as sp

import geometry as g

HERE = os.path.dirname(os.path.abspath(__file__))
S0 = 1361.0
SUN_R = 0.2666
STEP_S = 600.0
DSN = {  # NASA Deep Space Network complexes: lat, east lon (deg)
    "Goldstone": (35.43, -116.89),
    "Madrid": (40.43, -4.25),
    "Canberra": (-35.40, 148.98),
}
R_EARTH = 6378.137

_EPH = None


def ephem():
    global _EPH
    if _EPH is None:
        d = np.load(os.path.join(HERE, "out", "ephemeris_hourly.npz"))
        _EPH = (d["et"], d["sun"], d["earth"])
    return _EPH


def presets():
    with open(os.path.join(HERE, "presets.json")) as f:
        return json.load(f)


def _interp(table, et0, step, ets):
    x = (ets - et0) / step
    i = np.clip(np.floor(x).astype(int), 0, len(table) - 2)
    f = (x - i)[:, None]
    return table[i] * (1 - f) + table[i + 1] * f


def sky(lat, lon, ets):
    """Apparent az/el of Sun and Earth from a site (flat-horizon angles), arrays over ets."""
    et_tab, sun, earth = ephem()
    step = et_tab[1] - et_tab[0]
    S = g.site_vector(lat, lon)
    M = g.enu_matrix(lat, lon)
    saz, sel = g.az_el(_interp(sun, et_tab[0], step, ets) - S, M)
    eaz, eel = g.az_el(_interp(earth, et_tab[0], step, ets) - S, M)
    return saz, sel, eaz, eel


def horizon_at(H, az):
    b = az - 0.5
    i0 = np.floor(b).astype(int) % 360
    f = b - np.floor(b)
    return H[i0] * (1 - f) + H[(i0 + 1) % 360] * f


def dsn_visible(ets, mask_deg=10.0):
    """Boolean array: Moon above mask at >= 1 DSN complex; plus per-station arrays."""
    moon, _ = sp.spkpos("MOON", list(ets), "J2000", "LT+S", "EARTH")
    moon = np.asarray(moon)
    jd_ut = np.array([sp.unitim(e, "TDB", "JDTDB") for e in ets]) - (69.184 / 86400.0)  # TDB -> UT1, ~2027
    era = 2 * np.pi * ((0.7790572732640 + 1.00273781191135448 * (jd_ut - 2451545.0)) % 1.0)
    any_vis = np.zeros(len(ets), bool)
    per = {}
    for name, (la, lo) in DSN.items():
        la_r = math.radians(la)
        ang = era + math.radians(lo)
        st = R_EARTH * np.stack([math.cos(la_r) * np.cos(ang), math.cos(la_r) * np.sin(ang),
                                 np.full_like(ang, math.sin(la_r))], 1)
        up = st / R_EARTH
        v = moon - st
        el = np.degrees(np.arcsin(np.sum(v * up, 1) / np.linalg.norm(v, axis=1)))
        per[name] = el > mask_deg
        any_vis |= per[name]
    return any_vis, per


def panel_factor(layout, saz, sel, heading_deg=0.0):
    """Sum over panels of (area share * cos incidence), for unit total area."""
    el = np.radians(sel)
    if layout == "vertical_4":           # four vertical faces, 1/4 of the area each
        tot = 0.0
        for k in range(4):
            tot = tot + 0.25 * np.maximum(0.0, np.cos(el) * np.cos(np.radians(saz - heading_deg - 90 * k)))
        return tot
    if layout == "tracking_mast":        # vertical panel that turns to face the Sun's azimuth
        return np.maximum(0.0, np.cos(el))
    if layout == "vertical_4_on_side":   # same box lying on its side: one face up, one down, two still vertical
        up = 0.25 * np.maximum(0.0, np.sin(el))
        side = 0.0
        for k in (0, 2):
            side = side + 0.25 * np.maximum(0.0, np.cos(el) * np.cos(np.radians(saz - heading_deg - 90 * k)))
        return up + side
    if layout == "horizontal_deck":
        return np.maximum(0.0, np.sin(el))
    raise ValueError(layout)


def longest_run(mask, step_h):
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best * step_h


def simulate(H, lat, lon, start_utc, days, preset, dsn_cache=None, keep_series=False):
    p = preset
    et0 = g.utc_to_et(start_utc)
    ets = et0 + STEP_S * np.arange(int(days * 86400 / STEP_S))
    saz, sel, eaz, eel = sky(lat, lon, ets)
    f_sun = np.clip((sel - horizon_at(H, saz) + SUN_R) / (2 * SUN_R), 0, 1)
    earth_up = eel - horizon_at(H, eaz) > p.get("earth_margin_deg", 1.0)
    if dsn_cache is None:
        dsn, _ = dsn_visible(ets, p.get("dsn_mask_deg", 10.0))
    else:
        dsn = dsn_cache
    link = earth_up & dsn

    p_in = p["panel_eff"] * S0 * p["panel_area_m2"] * f_sun * panel_factor(p["panel_layout"], saz, sel)
    dark = f_sun < 0.05
    load = p["load_w"] + np.where(dark, p["heater_w"], 0.0)
    cap = p["battery_wh"]
    soc = np.empty(len(ets))
    e = cap * p.get("initial_soc", 1.0)
    dt_h = STEP_S / 3600.0
    for i in range(len(ets)):
        e = min(cap, max(0.0, e + (p_in[i] * p["charge_eff"] - load[i]) * dt_h))
        soc[i] = e / cap
    below = soc < p["soc_floor"]
    t_floor = float(np.argmax(below) * dt_h) if below.any() else None
    res = {
        "sunlit_pct": float(100 * (f_sun > 0.5).mean()),
        "earth_pct": float(100 * earth_up.mean()),
        "both_pct": float(100 * ((f_sun > 0.5) & earth_up).mean()),
        "link_pct": float(100 * link.mean()),
        "longest_night_h": float(longest_run(f_sun < 0.5, dt_h)),
        "longest_blackout_h": float(longest_run(~link, dt_h)),
        "energy_in_kwh": float(p_in.sum() * dt_h / 1000),
        "min_soc": float(soc.min()),
        "hours_to_floor": t_floor,
        "survives": t_floor is None,
        "sunset_in_h": float(np.argmax(f_sun < 0.5) * dt_h) if (f_sun < 0.5).any() else None,
        "earthset_in_h": float(np.argmax(~earth_up) * dt_h) if (~earth_up).any() else None,
    }
    if keep_series:
        res["series"] = {"t_h": (np.arange(len(ets)) * dt_h).tolist(), "f_sun": f_sun.round(3).tolist(),
                         "earth_up": earth_up.astype(int).tolist(), "dsn": dsn.astype(int).tolist(),
                         "soc": soc.round(4).tolist(), "sun_el": sel.round(3).tolist(),
                         "sun_az": saz.round(2).tolist(), "earth_el": eel.round(3).tolist(),
                         "earth_az": eaz.round(2).tolist()}
    return res
