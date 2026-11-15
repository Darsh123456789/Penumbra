# PROMPT 2 — Validation, Plan B and "Why?"

Attach to the chat: `Prompt 2 - pipeline outputs.zip` plus these NASA LOLA terrain files from your laptop:
`Site04_final_adj_5mpp_surf.tif`, `Site23_final_adj_5mpp_surf.tif`, `Site20v2_final_adj_5mpp_surf.tif`,
`LDEM_80S_80MPP_ADJ.tiff` (and the PGDA 69 file from Task 1b if you can download it). Also read the project docs
`STATUS.md` and `INTERFACES.md`.

You are joining a NASA Space Apps Challenge 2026 team (challenge: "Lunar Landing Site Navigator"). The project is
PENUMBRA, a slip-proof lunar south-pole landing navigator. Hard deadline: **22:15 IST today (Sunday 15 Nov 2026)**.
Every number you report must be measured by code you ran. Never invent results. If something cannot be done, record
it as `not_available` with a reason.

**Repository:** https://github.com/Darsh123456789/penumbra (public). Clone it and read `README.md`,
`docs/validation.md` and especially `docs/INTERFACES.md`, which defines the exact JSON files you must produce. If you
can push, use a new branch named `validation-track`. Only add `pipeline/06_validate.py`, `pipeline/07_planb.py`,
`pipeline/08_why.py`, append to `docs/validation.md`, and write `web/public/data/validation.json`,
`planb_<site>.json`, `why_<site>.json` (+ `validation_shadow.png` if made). Never edit other files. If you cannot
push, deliver a zip containing exactly those paths.

## What already exists (do not redo)
- `pipeline/geometry.py`: SPICE helpers (MOON_ME, R = 1737.4 km, east-positive longitude, azimuth clockwise from
  north).
- `pipeline/terrain.py`: loads NASA LOLA DEMs (5 m PGDA 78 site maps + 80 m PGDA 90 map) from `data/dem/`, with
  `horizons()`, `ground_height()`, `latlon_to_xy()`, `xy_to_latlon()`.
- `pipeline/simulate.py`: the survival simulator. `03_horizons.py`, `04_simulate.py`, `05_dispersion.py` show every
  API in use.
- Setup: unzip the attached zip into `pipeline/out/` (`ephemeris_hourly.npz`, `horizons_<site>.npz`: 96×96 grid with
  `x`, `y`, `z`, `lat`, `lon`, `horizon` 9216×360 deg, `sun_pct`, `earth_pct`). Put the .tif/.tiff files in
  `data/dem/`. `pip install -r requirements.txt`; call `geometry.load_kernels()`.
- Site keys: `shackleton` (Site04), `malapert` (Site23), `leibnitz_beta` (Site20v2).

## Task 1 — `pipeline/06_validate.py` → `web/public/data/validation.json`
- (a) Copy existing measured checks: Horizons (`web/public/data/validation_horizons.json`; aggregate max/median
  separation, n_cases = 6, n_epochs = 726); interpolation (`ephem_meta.json` → `self_checks`); Chandrayaan-3
  flat-horizon times (rerun `pipeline/01c_chandrayaan3_check.py`).
- (b) PGDA 69 check: compare PENUMBRA's long-term sunlight % with NASA's average illumination
  (https://pgda.gsfc.nasa.gov/products/69, highest-resolution south-pole average-illumination map covering our three
  sites) at 200–400 grid points. If downloads are blocked, ask the user for the exact file. Check its projection
  matches `terrain.py`. Use the same multi-year period and observer height PGDA 69 uses (read its README); extend
  `illumination()` from `03_horizons.py`. Report R², bias, RMSE and scatter `points`.
- (c) Shadow-truth check (timebox 45 min): one LROC NAC image of Shackleton rim or Malapert with known acquisition
  time (LROC QuickMap / data.lroc.im-ldi.com, or ask the user). Render PENUMBRA's lit/shadow mask for that time on a
  ~200×200 crop (horizons per pixel ≈ 3 min), compute IoU against a thresholded image. If georeferencing fails, make
  a side-by-side PNG and set status `qualitative`.
- (d) Chandrayaan-3 with terrain: maps stop at 80°S, so `not_available` unless a LOLA DEM covering 69.37°S is
  obtained (e.g. a 60°S polar product).
- Append results to `docs/validation.md`.

## Task 2 — `pipeline/07_planb.py` → `planb_<site>.json`
Planned landing 2027-02-14 00:00 UTC, mid-size preset, 14 days; slip of 12 days to 2027-02-26. Original point =
best-lit point (argmax `sun_pct`); report its slipped result. Search grid points within 2 km with local slope < 8°
(from the 5 m DEM, 3×3 window, or from grid heights), dates = slipped date ±5 days. Rank: survives, then lowest
`longest_blackout_h`, then highest `sunlit_pct`. Top 3 as options A, B, C with distance, bearing, date shift.

## Task 3 — `pipeline/08_why.py` → `why_<site>.json`
Explain the change in `sunlit_pct` at the original point between 2027-02-14 and 2027-02-26 with one-at-a-time swaps
from A to B: (1) Sun path; (2) Earth path (affects comms: also compute `link_pct` deltas, mention in `note`);
(3) terrain horizon vs flat 0°; (4) panel height 2 m vs 5 m (`terrain.horizons(obs_h=5)`). Find the blocking ridge:
the azimuth bin where the Sun was below the horizon most often in B; raycast along it and report distance and height
of the highest-angle terrain sample.

## Time plan
Plan B + Why? by 20:45 (the app needs these first) · PGDA 69 by 21:30 · shadow overlay by 22:00 · push by 22:15.
Finish with a short summary of the measured numbers.
