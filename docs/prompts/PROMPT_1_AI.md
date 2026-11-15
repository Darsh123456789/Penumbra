# PROMPT 1 — AI models (HELIOS + SURVIVOR)

Attach to the chat: `Prompt 1 - pipeline outputs.zip` (holds files not in Git). Also read the project docs
`STATUS.md` and `INTERFACES.md`.

You are joining a NASA Space Apps Challenge 2026 team (challenge: "Lunar Landing Site Navigator"). The project is
PENUMBRA, a slip-proof lunar south-pole landing navigator. Hard deadline: **22:15 IST today (Sunday 15 Nov 2026)**.
Work fast and honestly: every number you report must be measured by code you ran. Never invent or estimate results.

**Repository:** https://github.com/Darsh123456789/penumbra (public). Clone it and read `README.md`,
`docs/validation.md` and especially `docs/INTERFACES.md`, which defines the exact JSON files you must produce. If you
can push, push to a new branch named `ai-track`. Only touch `ai/`, `docs/model_card.md`,
`web/public/data/ai_model_card.json` and `web/public/data/ai_search_<site>.json`. Never edit other files. If you
cannot push, deliver a zip containing exactly those paths.

## What already exists (do not redo)
- `pipeline/geometry.py`: SPICE helpers. Moon-fixed frame MOON_ME, sphere R = 1737.4 km, east-positive longitude,
  azimuth clockwise from north.
- `pipeline/terrain.py`: LOLA terrain + horizon raycaster.
- `pipeline/simulate.py`: the exact survival simulator. 10-minute steps; power from Sun visibility above the terrain
  horizon; battery; direct-to-Earth comms needing Earth above the horizon AND one NASA DSN station seeing the Moon
  above 10°.
- `pipeline/presets.json`: three generic landers.
- The attached zip holds files NOT in Git. Unzip them into `pipeline/out/`:
  - `ephemeris_hourly.npz`: keys `et`, `sun`, `earth`; hourly Sun/Earth vectors 2023–2032.
  - `horizons_shackleton.npz`, `horizons_malapert.npz`, `horizons_leibnitz_beta.npz`: each a 96×96 grid (9,216
    points) with keys `x`, `y` (map metres), `z`, `lat`, `lon`, `horizon` (9216×360 float16 degrees; bin k is
    centred on azimuth k+0.5°), `sun_pct`, `earth_pct`, `both_pct`.
- SPICE kernels are in `pipeline/kernels/`. Call `geometry.load_kernels()` before using `simulate.py`. Install with
  `pip install -r requirements.txt` (+ `torch`/`onnx` if you export).
- Raw DEMs are NOT available to you. Use the horizon grids as ground truth for HELIOS and `simulate.simulate()` as
  ground truth for SURVIVOR.

## Task 1 — HELIOS, a neural horizon field
- Input: map (x, y) of a point. Output: its 360° horizon profile, predicted as about 32 real Fourier coefficients and
  reconstructed to 360 bins. One model per site, or one shared model with a site embedding.
- Architecture: Fourier-feature or multiresolution hash-grid encoding + small MLP in PyTorch (CPU-friendly unless a
  GPU is available).
- Loss: L1 on reconstructed elevations, weighted ×5 for bins between −2° and +8°.
- Held-out test = spatial blocks: hold out whole 16×16-point tiles (~15% of each site), never random points.
- Measure on the test tiles: median and 99th-percentile absolute horizon error (deg); lit/unlit agreement (share of
  2027 hourly Sun positions where "Sun centre above horizon" agrees between HELIOS and the true horizon); speed-up vs
  the stored raycast (≈ 14 ms/point on 2 CPU cores).
- Gates: median < 0.05°, p99 < 0.3°, agreement > 99%. Report pass/fail honestly.

## Task 2 — SURVIVOR, a mission-survival surrogate with conformal error bars
- Labels: call `simulate.simulate(H, lat, lon, start_utc, 14, preset, dsn_cache=...)` for random grid points ×
  random 2027 landing days × the 3 presets. Precompute DSN visibility once per landing day (see
  `pipeline/04_simulate.py` for `dsn_visible` and daily slicing). Aim for 30k–100k runs (a few ms each);
  use multiprocessing.
- Features: downsampled horizon (36 bins or Fourier coefficients), lat, lon, sin/cos of landing day, Sun and Earth
  elevation/azimuth summary over the mission (from the ephemeris), preset parameters.
- Targets: `survives` (classification), `sunlit_pct`, `longest_blackout_h`, `hours_to_floor`.
- Model: ensemble of 5 MLPs or gradient-boosted models (scikit-learn / LightGBM fine).
- Held-out test = one whole site (e.g. train on shackleton + malapert, test on leibnitz_beta), plus a calibration
  split for split-conformal prediction at 90% coverage.
- Out-of-distribution flag: feature-space distance above the 99th percentile of training distances.
- Measure: coverage on the held-out site (gate 90% ± 2%), expected calibration error of P(survive) (gate < 0.03),
  AUROC, OOD recall on a deliberately shifted set, speed-up vs `simulate()`.

## Task 3 — Gate demonstration ("AI proposes, physics verifies"), per site
- Score every grid point × 30 landing days with SURVIVOR. Accept on AI alone only if the conformal interval is
  clearly on one side of 0.5 and in-distribution; send the top 20 plus every uncertain one to the exact simulator.
- Record `candidates_scored`, `sent_to_exact`, `accepted_by_ai`, and whether the top pick changed after verification.
- Write `ai_search_<site>.json` (top 10 candidates with tags) and `ai_model_card.json` exactly as in INTERFACES.md.

## Task 4 — Documentation
`docs/model_card.md`: data, splits, architecture, every metric with its gate and pass/fail, limitations, how the
physics fallback works. A failed gate is acceptable if reported.

## Time plan
HELIOS by 20:45 · SURVIVOR + conformal by 21:30 · gate demo + JSON + model card pushed by 22:15.
If short on time, ship SURVIVOR + gate demo first (matters most), then HELIOS. Finish with a short summary of the
measured numbers.
