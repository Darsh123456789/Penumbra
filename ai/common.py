"""Shared helpers for the PENUMBRA AI stream (HELIOS + SURVIVOR).

Everything here reads the Step 1-3 products in pipeline/out/ and calls the exact
pipeline code (pipeline/geometry.py, pipeline/simulate.py); nothing is re-derived.
"""
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPE = os.path.join(ROOT, "pipeline")
OUT = os.path.join(PIPE, "out")
AI_OUT = os.path.join(ROOT, "ai", "out")
WEB = os.path.join(ROOT, "web", "public", "data")
sys.path.insert(0, PIPE)

import geometry as g  # noqa: E402
import simulate as S  # noqa: E402

SITES = ["shackleton", "malapert", "leibnitz_beta"]
YEAR0 = "2027-01-01T00:00:00"
NDAYS = 365
MISSION_DAYS = 14
STEPS_DAY = int(86400 / S.STEP_S)          # 144 ten-minute steps per day
PRESET_NAMES = ["small_vertical", "medium_vertical", "tracking_mast"]
LAYOUTS = ["vertical_4", "tracking_mast"]


def site(name):
    return np.load(os.path.join(OUT, f"horizons_{name}.npz"))


def presets():
    P = S.presets()
    return {k: P[k] for k in PRESET_NAMES}


_DSN = None


def dsn_all(extra_days=0):
    """DSN visibility (10-minute steps) for every 2027 landing day + mission, computed once."""
    global _DSN
    if _DSN is None:
        et0 = g.utc_to_et(YEAR0)
        ets = et0 + S.STEP_S * np.arange((NDAYS + MISSION_DAYS + extra_days) * STEPS_DAY)
        _DSN, _ = S.dsn_visible(ets)
    return _DSN


def day_utc(day):
    return g.et_to_utc(g.utc_to_et(YEAR0) + day * 86400.0)


def longest_run(mask):
    """Longest run of True (vectorised), in samples."""
    m = np.concatenate([[0], mask.astype(np.int8), [0]])
    d = np.diff(m)
    s, e = np.where(d == 1)[0], np.where(d == -1)[0]
    return int((e - s).max()) if len(s) else 0


def coarse_h(H360, az):
    """Horizon downsampled to 36 x 10-degree bins (means), interpolated at az (deg)."""
    h36 = H360.reshape(36, 10).mean(1)
    b = az / 10.0 - 0.5
    i0 = np.floor(b).astype(int) % 36
    f = b - np.floor(b)
    return h36[i0] * (1 - f) + h36[(i0 + 1) % 36] * f, h36


SKY_FEATS = ["sun_el_mean", "sun_el_min", "sun_el_max", "sun_el_std", "earth_el_mean", "earth_el_min",
             "earth_el_max", "earth_az_spread", "dsn_frac",
             "c_lit_frac", "c_earth_frac", "c_link_frac", "c_longest_dark_h", "c_longest_nolink_h",
             "c_first_sunset_h", "c_lit_first48_frac"]
PRESET_FEATS = ["p_peak_w", "p_battery_wh", "p_load_w", "p_heater_w", "p_floor", "p_tracking",
                "c_energy_ratio", "c_dark_need_ratio"]


def sky_features(H360, lat, lon, day, dsn10, sky_cache=None):
    """Mission sky summary (hourly samples from the ephemeris) + coarse-horizon physics features.

    Returns (feature vector without preset terms, intermediate arrays for preset terms).
    """
    if sky_cache is None:
        et0 = g.utc_to_et(YEAR0) + day * 86400.0
        ets = et0 + 3600.0 * np.arange(MISSION_DAYS * 24)
        saz, sel, eaz, eel = S.sky(lat, lon, ets)
    else:
        saz, sel, eaz, eel = sky_cache
    hs, h36 = coarse_h(H360, saz)
    he, _ = coarse_h(H360, eaz)
    lit = sel > hs
    eup = eel - he > 1.0
    dsn = dsn10[::6][: len(sel)]
    link = eup & dsn
    ea = np.radians(eaz)
    spread = 1.0 - np.hypot(np.cos(ea).mean(), np.sin(ea).mean())
    first_sunset = float(np.argmax(~lit)) if (~lit).any() else float(len(lit))
    f = [sel.mean(), sel.min(), sel.max(), sel.std(), eel.mean(), eel.min(), eel.max(), spread, dsn.mean(),
         lit.mean(), eup.mean(), link.mean(), longest_run(~lit), longest_run(~link), first_sunset,
         lit[:48].mean()]
    return np.array(f, np.float32), h36.astype(np.float32), (saz, sel, lit)


def preset_features(p, inter):
    saz, sel, lit = inter
    pf = S.panel_factor(p["panel_layout"], saz, sel)
    peak = p["panel_eff"] * S.S0 * p["panel_area_m2"]
    e_in = (peak * pf * lit).sum() * p["charge_eff"]                       # Wh, hourly samples
    e_out = p["load_w"] * len(lit) + p["heater_w"] * (~lit).sum()
    usable = p["battery_wh"] * (1 - p["soc_floor"])
    dark_need = longest_run(~lit) * (p["load_w"] + p["heater_w"]) / usable
    return np.array([peak, p["battery_wh"], p["load_w"], p["heater_w"], p["soc_floor"],
                     float(p["panel_layout"] == "tracking_mast"), (e_in - e_out) / usable, dark_need], np.float32)


def base_features(h36, lat, lon, day):
    doy = 2 * np.pi * day / 365.25
    return np.concatenate([h36, [lat, np.sin(np.radians(lon)), np.cos(np.radians(lon)), np.sin(doy), np.cos(doy)]]
                          ).astype(np.float32)


FEATURE_NAMES = ([f"h36_{k * 10 + 5}" for k in range(36)] + ["lat", "sin_lon", "cos_lon", "sin_doy", "cos_doy"]
                 + SKY_FEATS + PRESET_FEATS)
