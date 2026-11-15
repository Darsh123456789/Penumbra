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

## Relay what-if (Task 3, browser feature) — done
- `web/src/relay.ts`: representative ELFO relay (assumption, labelled in the UI): periselene 1,750 km / aposelene
  17,400 km (NASA LCRNS reference ELFO, arXiv:2507.22145), a = 11,312 km, e = 0.692, period 30.0 h; i = 57.8°, Ω = 0,
  M0 = 0 assumed; ω = 90° (aposelene over the southern hemisphere). Two-body, rotated with the Moon's 27.32 d spin.
- `simulate(..., relay?)`: `link = (direct) || relay(et)`; new outputs `relay_only_pct`, `longest_blackout_no_relay_h`.
  Relay off: bit-identical to the old engine on 365 days × 3 best points; Trust survival check 365/365.
- Best points, 14 Feb 2027 landing, longest comms blackout direct → 1 relay → 2 relays: Shackleton 198 → 4.8 → 0.8 h,
  Malapert 174 → 4.5 → 0.8 h, Leibnitz beta 167 → 4.5 → 0.8 h. Median reduction over all 2027 landing days (1 relay):
  172 / 145 / 138 h. With the relay the blackout is never longer than direct-only (asserted, `web/scripts/relay_check.sh`).
- UI: Mission Board toggle (Off / 1 / 2 relays), card link bar + "was X%", readout rows, assumptions table; Why? line;
  Provenance sources. Not done: Timeline relay lane, Panorama relay track, Python twin (relay is browser-only).

## Lander editor (Task 2, 15 Nov evening) — on main
- Mission Board has a **"Your lander" editor**: a "Custom (edit below)" lander option plus an inline editor (battery, panel area,
  cell and charge efficiency, load, heater, floor, panel layout), "Start from" buttons for the 3 presets, and Reset. Values are clamped,
  recomputation is debounced 250 ms, and a red note appears when load ≥ peak solar input (this lander can never charge).
- One resolved `lander` object drives the main cards, readout (sequent-peak battery), timeline, panorama, CSV/JSON exports and share link
  (`&lander=custom&L=b4000,a8,e0.28,l220,h80,f20,c0.95,p=vertical_4`; malformed falls back to medium_vertical). It is stored in localStorage.
- Custom lander: the 2027 survival track and "longest windows" are computed live (365 sims, ~0.3–0.65 s in Node), the 3 compare cards
  are simulated live, and the Python-match sentence and Python fallbacks are hidden. Landing cloud and Plan B tabs say "computed for
  the generic presets".
- Engine: added the missing `vertical_4_on_side` branch to `panelFactor`, ported line-for-line from `pipeline/simulate.py`.
  Previously it returned 0. No other physics changed.
- **Equivalence:** custom = medium_vertical on **365/365 days × 3 sites** (live track vs `slip_<site>.json` best point), 120/120 card
  fields identical per site. In the headless browser, the board cards are identical before and after "Start from: Mid-size".
- Sanity (Shackleton best point, landing 2027-02-26): battery ×2 → hours-to-floor 129.7 → 140.3 h, and surviving days 206 → 222.
  The sequent-peak battery is 12,824 Wh both times (independent of the fitted battery). Load 1500 W → fails after 3.3 h; the
  "never charges" note appears only when load ≥ peak (e.g. 0.5 m² panels), not at 8 m² (peak 3,049 W).
  Panel area 30 m² → 206 days (no gain: failures are long nights, not lack of daytime power).
- Limitation: the "Pick any spot" map / Plan B spot search (Enhancement 1) was not on main when this was built, so the editor
  does not reach them yet; any code that uses the `lander` object will pick it up automatically.

## Data that is NOT in Git (must be attached to chats that need it)
- `pipeline/out/ephemeris_hourly.npz`, `pipeline/out/horizons_<site>.npz` — in "Prompt 1/2 - pipeline outputs.zip".
- NASA LOLA DEMs in `data/dem/`: `Site04/Site20v2/Site23_final_adj_5mpp_surf.tif` (+ `_toterr.tif`),
  `LDEM_80S_80MPP_ADJ.tiff` (+ `_ERR.tiff`) from https://pgda.gsfc.nasa.gov/products/78 and /90.

## Key documents in this project
`STATUS.md` (this file) · `INTERFACES.md` (exact output file formats) · `validation.md` (measured results log) ·
`README.md` (setup) · `PROMPT_1_AI.md` · `PROMPT_2_VALIDATION.md`.

## Enhancement 1 — Pick any spot (15 Nov 2026, 22:50 IST)
- `pipeline/11_point_grid.py` → `web/public/data/grid_<site>.json`: for all 9,216 horizon points per site, height, 2027 Sun / Earth / both % (step 3) and Horn 3×3 slope on the 5 m LOLA map (same method as Plan B). Landable (< 8°): Shackleton 1,076, Malapert 987, Leibnitz beta 2,121 points.
- Mission Board: clickable site map (colour by sunlight, Earth, both or slope; dim > 8°). A picked point drives both main cards, the engineering readout, panorama, timeline, CSV/JSON export (with grid index), the share link (`&pt=custom&k=`), and "Stand on the rim".
- The 2027 survival track for a picked point is computed live (365 × 14-day sims, about 1 s). Check: picking the best-lit grid index reproduces Python's survivable-day count exactly (206 / 211 / 204 of 365 at Shackleton / Malapert / Leibnitz beta, medium lander).
- "Plan B for this spot on this date": live re-simulation of every landable point within 2 km for the selected date and lander, ranked survivors-first then by distance.
- Not extended to a picked point: Landing cloud (needs 10 terrain variants × 4,000 draws, Python) and the Python Why? attribution. Those tabs stay on the reference points.
