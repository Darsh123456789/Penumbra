# PENUMBRA — data contracts between the three work streams

The web app (`web/`) reads ONLY files in `web/public/data/`. Each work stream writes its own files there with the
exact names and JSON shapes below. If a file is missing, the app shows "—" / "pending", never invented values.
All numbers must be produced by code in this repo. Times are UTC ISO strings. Percentages are 0–100. Coordinates:
planetocentric latitude, EAST-positive longitude, degrees; map x/y = NASA south polar stereographic metres
(lat_0 = -90, lon_0 = 0, sphere R = 1737.4 km), see `pipeline/terrain.py`.

Site keys: `shackleton` (PGDA 78 Site04), `malapert` (Site23), `leibnitz_beta` (Site20v2, Mons Mouton area).

## Already produced (Steps 1–5)
`ephem_sun.bin`, `ephem_earth.bin`, `ephem_meta.json`, `horizons_<site>.bin/.json`, `slip_<site>.json`,
`timeline_<site>.json`, `dispersion_<site|im2_replay>.json`, `validation_horizons.json`.

## Stream A — AI (branch `ai-track`; only touch `ai/`, `docs/model_card.md`, the files below)

`web/public/data/ai_model_card.json`
```json
{
  "generated_utc": "2026-11-15T20:00:00Z",
  "helios": {
    "status": "passed | failed | not_run",
    "architecture": "short text",
    "train_points": 0, "test_points": 0, "test_split": "how the held-out set was chosen",
    "gates": [{"name": "Horizon error, held-out tiles (median)", "target": "< 0.05 deg", "measured": 0.0, "unit": "deg", "pass": true}],
    "speedup_vs_exact": 0.0
  },
  "survivor": {
    "status": "passed | failed | not_run",
    "architecture": "short text", "train_runs": 0, "test_runs": 0, "test_split": "text",
    "gates": [{"name": "Conformal coverage, held-out site", "target": "90% ± 2%", "measured": 0.0, "unit": "%", "pass": true}],
    "speedup_vs_exact": 0.0
  },
  "gate_activity": {"site": "shackleton", "candidates_scored": 0, "sent_to_exact": 0, "accepted_by_ai": 0,
                    "top_pick_changed_after_verification": false}
}
```

`web/public/data/ai_search_<site>.json` (one per site that was searched)
```json
{
  "site": "shackleton", "landing_utc": "2027-02-14T00:00:00", "preset": "medium_vertical", "mission_days": 14,
  "candidates_scored": 0, "sent_to_exact": 0,
  "top": [{"rank": 1, "lat": -89.78, "lon": 203.9, "x_m": 0.0, "y_m": 0.0,
           "ai_p_survive": 0.0, "ai_interval": [0.0, 1.0], "ood": false,
           "verified_survives": true, "verified_sunlit_pct": 0.0, "tag": "physics-verified | AI, within bounds"}]
}
```

## Stream B — validation, Plan B, Why? (branch `validation-track`; only touch `pipeline/06_*.py`, `pipeline/07_*.py`, `pipeline/08_*.py`, `docs/validation.md` (append only), the files below)

`web/public/data/validation.json`
```json
{
  "horizons": {"max_sep_deg": 0.0, "median_sep_deg": 0.0, "n_cases": 6, "n_epochs": 726},
  "interpolation": {"sun_max_deg": 0.0, "earth_max_deg": 0.0},
  "pgda69": {"status": "done | not_available", "n_points": 0, "r2": 0.0, "bias_pct": 0.0, "rmse_pct": 0.0,
             "points": [[0.0, 0.0]], "notes": "observer height / period used"},
  "shadow": {"status": "done | qualitative | not_available", "image_id": "", "image_time_utc": "", "iou": 0.0,
             "overlay_png": "validation_shadow.png", "notes": ""},
  "chandrayaan3": {"flat": {"sunrise": "", "sunset": "", "next_sunrise": ""},
                   "terrain": {"status": "done | not_available", "sunrise": "", "sunset": "", "next_sunrise": ""},
                   "reported": {"landing": "2023-08-23", "sleep": "2023-09-02 to 2023-09-04", "expected_wake": "2023-09-22"}}
}
```
(`points` = [penumbra_pct, pgda69_pct] pairs for the scatter plot; overlay PNG goes in `web/public/data/`.)

`web/public/data/planb_<site>.json`
```json
{
  "site": "shackleton", "preset": "medium_vertical", "mission_days": 14,
  "planned_utc": "2027-02-14T00:00:00", "slipped_utc": "2027-02-26T00:00:00", "slip_days": 12,
  "search": {"radius_m": 2000, "max_slope_deg": 8, "date_window_days": 5, "candidates_checked": 0},
  "original": {"lat": 0.0, "lon": 0.0, "survives": false, "sunlit_pct": 0.0, "longest_blackout_h": 0.0},
  "options": [{"rank": 1, "label": "A", "lat": 0.0, "lon": 0.0, "dx_m": 0.0, "dy_m": 0.0, "distance_m": 0.0,
               "bearing_deg": 0.0, "date_shift_days": 0, "slope_deg": 0.0, "survives": true,
               "sunlit_pct": 0.0, "longest_blackout_h": 0.0, "min_soc": 0.0}]
}
```

`web/public/data/why_<site>.json`
```json
{
  "site": "shackleton", "metric": "sunlit_pct", "scenario_a_utc": "2027-02-14T00:00:00", "scenario_b_utc": "2027-02-26T00:00:00",
  "value_a": 0.0, "value_b": 0.0,
  "factors": [{"name": "Sun path (season and date)", "delta": 0.0},
              {"name": "Earth path (libration)", "delta": 0.0},
              {"name": "Terrain horizon", "delta": 0.0},
              {"name": "Panel height", "delta": 0.0}],
  "blocking_ridge": {"azimuth_deg": 0.0, "distance_km": 0.0, "height_above_observer_m": 0.0},
  "note": "One-at-a-time attribution; bars need not add up exactly."
}
```
