# PENUMBRA — project status and overview (read this first)

PENUMBRA is a NASA Space Apps Challenge 2026 project for the "Lunar Landing Site Navigator" challenge: a
slip-proof lunar south-pole landing navigator. It treats a landing as a cloud of possible points and dates, simulates
whether a solar-powered lander survives (power, battery, direct-to-Earth comms through NASA's Deep Space Network),
finds a Plan B when the launch slips, and explains why results change. NASA data first; partner data as cross-checks.

- Repository: https://github.com/Darsh123456789/penumbra (public, branch `main`)
- Live app (GitHub Pages, redeploys on every push to main): https://darsh123456789.github.io/Penumbra/
- Submission deadline: Sunday 15 Nov 2026, 23:59 IST (local event). Internal code freeze 22:15 IST.

## Rules for every chat working on this project
1. Every number must be produced by code in the repo. Never invent or estimate results; write "—"/`not_available`.
2. Write only the files assigned to your stream (see `INTERFACES.md`), with the exact JSON shapes given there.
3. Push to your own branch (`ai-track` or `validation-track`), never directly to `main`; the main chat merges.
4. Conventions: Moon-fixed frame MOON_ME, sphere R = 1737.4 km, planetocentric latitude, EAST-positive longitude,
   azimuth clockwise from local north, apparent directions (LT+S), no refraction. Map x/y = NASA south polar
   stereographic metres (lat_0 = -90, lon_0 = 0).
5. Lander presets are generic and editable, never real spacecraft.

## Pipeline (Python, `pipeline/`) — status
| Step | Script | Status |
| --- | --- | --- |
| 1 Sun/Earth ephemeris table 2023–2032 (SPICE DE440) | `01_ephemeris.py` | Done |
| 1b Check vs NASA/JPL Horizons | `01b_horizons_check.py` | Done: max 0.000027° |
| 1c Chandrayaan-3 sunrise/sunset (flat horizon) | `01c_chandrayaan3_check.py` | Done: matches ISRO timeline |
| 2–3 LOLA terrain + horizon raycaster, 3 sites × 9,216 points, rays to 200 km | `terrain.py`, `03_horizons.py` | Done |
| 4 Survival simulator + 2027 slip curves | `simulate.py`, `04_simulate.py` | Done |
| 5 Landing-uncertainty Monte Carlo + IM-2 replay | `05_dispersion.py` | Done |
| 6 Validation extras (PGDA 69, shadow overlay, CH-3 terrain) | `06_validate.py` | Done (Stream B) |
| 7 Plan B search | `07_planb.py` | Done (forward-only, 30 d) |
| 8 Why? attribution | `08_why.py` | Done (Stream B) |
| AI: HELIOS + SURVIVOR + gate | `ai/` | Done (Stream A); gates reported honestly |
| Web exports (DSN bitset, sites) | `09_export_web.py` | Done |

## Web app (`web/`, React + Vite + TypeScript) — status
Six screens, live and complete: Mission Board (slip slider over 2027, 4 cards with slopes and rise/set times,
engineering readout, 360° horizon, 14-day timeline computed in the browser), Landing cloud (dispersion heatmaps +
IM-2 replay), Plan B + Why?, Trust (6 checks + data provenance), AI Lab (SURVIVOR, HELIOS, AI-assisted search for 3
sites), Stand on the rim (first-person view, your-city comparison, sonified lunar day).

## Measured results so far (details in `validation.md`)
- Horizons agreement: max 2.7e-5°. Hourly-table error: Sun 1.5e-5°, Earth 1.3e-4°.
- Browser TypeScript simulator vs Python: agrees on survival on 365/365 landing days, max sunlit difference 0.00 pts.
- Best-lit points, 2027 sunlight: Shackleton rim 79.9%, Malapert 80.3%, Leibnitz beta / Mons Mouton 74.5%.
  Shackleton crater interior 0% (known permanent shadow).
- Landing days in 2027 where a 14-day mission survives (best points): 55–58%; typical points 0%. Failed dates hit
  nights with median length 66–154 h, so the landing date matters far more than battery size.
- DSN: Moon above 10° at ≥1 complex 98.4% of the time (2023–2032).
- Dispersion (400 m 3σ ellipse, 10 terrain versions from LOLA error maps, 4,000 touchdowns):
  Shackleton P(survive) 11.6% vs 80% at the aim cell; Malapert 45.3% vs 100%; Leibnitz beta 31.3% vs 100%.
  Safer aim points 263–388 m away roughly double the odds.
- IM-2 replay: no NASA 5 m map covers the site (27 checked); on 80 m terrain the whole ellipse stays sunlit — the
  crater Athena came to rest in is smaller than one pixel. Reported as a data-resolution finding.
- Chandrayaan-3 (flat horizon): sunrise 21 Aug, sunset 4 Sep, next sunrise 19 Sep 2023 vs landing 23 Aug,
  sleep 2–4 Sep, expected wake ~22 Sep.

## Audit (main chat, 15 Nov evening) — merged on main
- Stream B merged (incl. shadow truth: LROC NAC M128378248LC, IoU 0.71 / 0.68 unshifted, 95.2% of 233k cells agree). PGDA 69: R² 0.859 (r 0.947, bias −2.9 pts, 300 points, 18.6 yr); Chandrayaan-3 with
  LOLA terrain: sunrise 21 Aug 15:00, sunset 4 Sep 06:10, next sunrise 20 Sep 00:00 UTC. Stream B's later ±6-day Plan B (with landing before the slipped date) was not merged; forward-only Plan B kept.
- Plan B corrected: forward-only dates (after a slip you cannot land earlier), 30-day window. Option A: Shackleton
  162 m +6 d; Malapert 1.1 km +18 d; Leibnitz beta 535 m +17 d (all survive, physics-verified).
- Landing slopes added (`points_meta.json`): Shackleton best-lit point 9.3° is too steep (> 8°).
- 108 Mission Board states tested headless: all render; browser simulator = Python on survival in 108/108.
- New outputs: rise times when landing in darkness, darkness by cause (terrain vs bare-Moon horizon), smallest
  survivable battery (sequent-peak), mission-loss marking after the battery floor.
- Stream A (AI) merged (see `docs/model_card.md`). SURVIVOR: 75,000 exact runs; on the unseen Leibnitz beta site
  AUROC 0.9975, calibration error 0.005, 99.81% correct when it accepts alone (81% of runs); conformal coverage gates
  fail on the unseen site (78–96% vs 90 ± 2%), so it is used only as a screener with physics verification.
  Gate demo: 276,480 candidates per site; 1.3% / 1.9% / 27% sent to the exact simulator; all 20 AI top picks survive
  exactly at every site; physics changed the #1 pick at 2 of 3 sites. HELIOS fails all gates (median 0.23–0.83° vs
  0.05°) and is not used. Main-chat audit added landing slopes to the AI top-10 lists: 8/10 (Shackleton), 8/10
  (Malapert), 7/10 (Leibnitz beta) are steeper than 8°, so Plan B (slope-filtered) is the landing recommendation.

## Data that is NOT in Git (must be attached to chats that need it)
- `pipeline/out/ephemeris_hourly.npz`, `pipeline/out/horizons_<site>.npz` — in "Prompt 1/2 - pipeline outputs.zip".
- NASA LOLA DEMs in `data/dem/`: `Site04/Site20v2/Site23_final_adj_5mpp_surf.tif` (+ `_toterr.tif`),
  `LDEM_80S_80MPP_ADJ.tiff` (+ `_ERR.tiff`) from https://pgda.gsfc.nasa.gov/products/78 and /90.

## Key documents in this project
`STATUS.md` (this file) · `INTERFACES.md` (exact output file formats) · `validation.md` (measured results log) ·
`README.md` (setup) · `PROMPT_1_AI.md` · `PROMPT_2_VALIDATION.md`.
