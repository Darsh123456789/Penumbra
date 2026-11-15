# PENUMBRA validation log

All numbers below were measured by the pipeline scripts in this repo.

## 1. Ephemeris table (Step 1, `pipeline/01_ephemeris.py`)
| Check | Result |
| --- | --- |
| Hourly table + float32 vs direct SPICE, Sun (2,000 random minutes, seen from 89.45 S) | max 1.5e-5 deg |
| Same, Earth (includes site parallax) | max 1.3e-4 deg |
| Sun elevation range at 89.45 S, 2026-2032, flat horizon | -2.13 to +2.11 deg (expected about +-(1.54 + 0.55) deg) |

## 2. NASA/JPL Horizons cross-check (Step 1b, `pipeline/01b_horizons_check.py`)
Apparent airless azimuth/elevation, 14 Feb - 16 Mar 2027, 6 h steps, 121 epochs per case.
Horizons echoed every site back with east-positive longitude, matching PENUMBRA's convention.

| Site | Sun max separation | Earth max separation |
| --- | --- | --- |
| Shackleton rim (approx.) | 8.5e-7 deg | 2.7e-5 deg |
| Chandrayaan-3 Shiv Shakti | 1.2e-6 deg | 2.5e-5 deg |
| Malapert Massif (approx.) | 8.5e-7 deg | 2.7e-5 deg |

## 3. Chandrayaan-3, flat horizon (Step 1c)
| Event | PENUMBRA (UTC) | Reported |
| --- | --- | --- |
| Sunrise | 2023-08-21 10:30 | Landing 23 Aug 2023 |
| Sunset | 2023-09-04 16:10 | Rover and lander put to sleep 2-4 Sep |
| Next sunrise | 2023-09-19 19:30 | ISRO expected wake-up around 22 Sep |

## 4. Terrain horizons (Step 3, `pipeline/03_horizons.py`)
NASA LOLA PGDA 78 5 m site maps + PGDA 90 80 m 80-90 S map, rays to 200 km, panel height 2 m, 1-year illumination (2027).

| Site | Best-lit point | Sunlit 2027 | Earth in view there |
| --- | --- | --- | --- |
| Shackleton rim (Site04) | 89.780 S, 203.86 E, z = 1737 m | 79.9% | 49.6% |
| Malapert massif (Site23) | 85.996 S, 2.04 E, z = 5165 m | 80.3% | 58.6% |
| Leibnitz beta / Mons Mouton (Site20v2) | 85.413 S, 31.70 E, z = 6452 m | 74.5% | 61.1% |

Sanity: Shackleton's interior is 0% sunlit (a known permanently shadowed region); its rim reaches about 80%,
in the range NASA studies report for the best rim points.

Bug found and fixed: a compiler speed flag removed the check that switches rays from the 5 m map to the
80 m map, so distant terrain was ignored. After the fix the crater interior went from about 25% to 0% sunlit.

Figures: `docs/figures/illum_*.png`.

## 5. Survival simulator (Step 4, `pipeline/simulate.py`, `pipeline/04_simulate.py`)
10-minute steps, 14-day missions, generic presets in `pipeline/presets.json` (not real spacecraft).

DSN model check (14-28 Feb 2027): Moon above 10 deg at Goldstone 44.7%, Madrid 42.8%, Canberra 39.9% of the time;
at least one complex 98.8%. Each station sees the Moon roughly 10 h a day, as expected.

Default scenario, Shackleton best point, landing 2027-02-14, mid-size preset: 97.4% sunlit, Earth in view 41.1%,
longest direct-to-Earth blackout 198 h, survives.

Slip curves, landing on each day of 2027 (best-lit point of each site):

| Site | Landing days that survive 14 days (small / mid-size / tracking mast) | Typical point |
| --- | --- | --- |
| Shackleton rim | 55% / 56% / 56% | 0% |
| Malapert massif | 57% / 58% / 58% | 0% |
| Leibnitz beta / Mons Mouton | 55% / 56% / 56% | 0% |

Finding: failed dates hit nights with a median length of 66-154 h, which no battery in these presets can bridge,
so the landing date matters far more than battery size; even the best-lit points survive on only ~55-58% of days.

## 6. Dispersion Cloud — landing uncertainty (Step 5, `pipeline/05_dispersion.py`)
Grid of cells around the aim point (20 m cells on 5 m terrain), 10 terrain versions (nominal + 9 with correlated
noise scaled by NASA's LOLA per-pixel height-error maps, 50 m correlation length), 14-day mission from 2027-02-14,
mid-size generic preset, 3-sigma landing radius 400 m, 4,000 Monte Carlo touchdowns.

| Site (aim = best-lit point) | Aim cell survives | P(survive) over the landing cloud | Lethal share of ellipse | Safer aim point |
| --- | --- | --- | --- | --- |
| Shackleton rim | 80% | **11.6%** | 93% | 263 m away -> 24% |
| Malapert massif | 100% | **45.3%** | 75% | 388 m away -> 67% |
| Leibnitz beta / Mons Mouton | 100% | **31.3%** | 82% | 382 m away -> 57% |

Finding: judging a site by its best point overstates survival by a factor of 2-7 once landing accuracy is included.
The best-lit spots are narrow crests; a 400 m landing error mostly lands on shadowed slopes, where the generic
mid-size lander's battery reaches its floor in about 13 hours. Figures: `docs/figures/dispersion_*.png`.

## 7. IM-2 Athena replay (80 m terrain)
No NASA 5 m map (PGDA 78, 27 maps checked with `pipeline/00_find_site_maps.py`) covers IM-2's site
(intended -84.78, 29.13 E per LROC), so the replay uses the PGDA 90 80 m map and its error map.

* Landing 2025-03-06 17:31 UTC, 10-day mission, small generic preset: the intended site and the reported
  (approximate) rest point are both sunlit for the whole mission (Sun 2.5-5.4 deg above a flat horizon), and the
  whole 400 m ellipse survives on 80 m terrain.
* A generic box lander tipped on its side loses 20-40% of mean power; depending on heading it reaches the
  battery floor after 37 h to never.

Interpretation: the crater Athena came to rest in is smaller than one 80 m pixel, so the shadow hazard that ended
the mission is invisible in the best public map of that spot, and a generic lander model cannot reproduce the
real ~13 h outcome. This is a data-resolution finding: sub-metre terrain (e.g. ISRO Chandrayaan-2 OHRC-derived
DEMs) would be needed to resolve it. PENUMBRA reports this limit rather than tuning the model to match.

## 8. Stream B — validation extras, Plan B, Why? (`pipeline/06_validate.py`, `07_planb.py`, `08_why.py`)

### 8a. Copied checks (`validation.json`)
Horizons: max separation 2.7e-05 deg, median 9.1e-06 deg (6 cases, 726 epochs). Interpolation: Sun max 1.5e-05 deg, Earth max 1.3e-04 deg. Chandrayaan-3 flat horizon (re-run): sunrise 2023-08-21T10:30, sunset 2023-09-04T16:10, next sunrise 2023-09-19T19:30 UTC.

### 8b. NASA PGDA 69 average illumination
300 PGDA 69 pixels (60 m/px map, 100 random per site map): **R² = 0.859**, bias -2.9 points, RMSE 5.6 points, Pearson r 0.947.

| Site | n | Bias (PENUMBRA − PGDA 69) | RMSE | r |
| --- | --- | --- | --- | --- |
| Shackleton rim | 100 | -1.7 | 6.5 | 0.905 |
| Malapert massif | 100 | -3.8 | 5.7 | 0.940 |
| Leibnitz beta / Mons Mouton | 100 | -3.1 | 4.5 | 0.972 |

Method: PGDA 69 AVGVISIB_85S_060M_201608.TIF (60 m/px, 85-90 S, hourly over 18.6 yr). PENUMBRA: fresh raycast at each PGDA 69 pixel centre, observer height 0 m (surface; PGDA 69 states no height), PGDA 78 5 m near field + PGDA 90 80 m far field to 200 km, Sun from SPICE DE440 hourly 2016-08-01 + 18.6 yr, partial solar disc counted. 100 random pixels per site (seed 69). PGDA 69 values scaled by 100 to percent (map max 0.88444). CRS checked: PROJCS["Moon2000_spole",GEOGCS["GCS_Moon",DATUM["D_Moon_2000",SPHEROID["Moon_200...
Scatter: `pipeline/out/validation_pgda69.png`; points in `validation.json`.

### 8c. Shadow truth vs LROC NAC
LROC NAC M128378248LC, 2010-05-13T08:23:02 UTC (Sun -1.558 to -0.313 deg above a flat horizon along the strip): **IoU of the lit areas = 0.71** (0.68 with no registration shift), cell-by-cell agreement 95.2% over 233,496 cells of 20 m. Lit share: PENUMBRA 16.5%, image 11.9%.
Inside the 5 m Site04 map (85,802 cells) both say dark: model 0.0% lit, image 0.01% lit.

The terminator (where shadow gives way to sunlight) is reproduced along the whole strip. The shadowed crater interiors in the lit zone are matched too. Most disagreement is dim ground (orange in the figure) that PENUMBRA calls lit but whose I/F falls below the single Otsu threshold.

Method: LROC NAC M128378248LC (CDR, I/F), 2010-05-13T08:23:02.536 to 08:23:34.124 UTC, emission 1.69 deg, incidence 90.93 deg at image centre; whole 51 km strip analysed in 20 m cells. Georeferenced by an affine fit to the four corner coordinates on the LROC product page (fit residual 22 m); the corners are given to 0.01 deg (up to ~300 m), so a +-300 m translation search (30/10/5 m steps) was run: iou uses the best shift (-260, -10 m in map x, y), iou_nominal uses none. Not orthorectified (no ISIS/LRO SPICE here). Model: cell lit if more than half the solar disc clears the terrain along the Sun azimuth, ray from the surface, PGDA 78 Site04 5 m where available (only the first part of the strip), otherwise PGDA 90 80 m, to 200 km; Sun from DE440 at each line's exposure time. Image lit = cell-mean I/F above the Otsu threshold. The sunlit part of this image lies outside the 5 m map, so the IoU mostly tests the 80 m map. Figure: `web/public/data/validation_shadow.png`.

### 8d. Chandrayaan-3 with terrain
LOLA LDEM_60S_240MPP_ADJ.TIF, 2 m observer, Sun centre above terrain: sunrise 2023-08-21T15:00, sunset 2023-09-04T06:10, next sunrise 2023-09-20T00:00 UTC (max horizon 2.45 deg). Reported: landing 23 Aug, sleep 2-4 Sep, expected wake ~22 Sep 2023.

### 8e. Plan B after a 12-day slip (2027-02-14 → 2027-02-26, mid-size preset, 14 days) — first version, superseded by 8g
Kept for the record. This first search (and a later ±6-day variant on the `validation-track` branch, which found a Malapert option 6 days *before* the slipped date) allowed landing earlier than the new date, which a launch slip makes impossible. The live app and `planb_*.json` use the forward-only search in 8g.

Search: grid points within 2 km of the best-lit point with slope < 8°, landing on the slipped date ±5 days; ranked by survives, then shortest direct-to-Earth blackout, then most sunlight.

| Site | Original on slipped date | Candidates (points × days) | Surviving | Option A | Original point survives if shifted |
| --- | --- | --- | --- | --- | --- |
| Shackleton rim | fails (85.1% sunlit, battery floor at 130 h) | 25 × 11 = 275 | 0 | 162 m at 66°, +5 d: fails, 24.0% sunlit, blackout 86.0 h | +6 d |
| Malapert massif | fails (54.6% sunlit, battery floor at 197 h) | 118 × 11 = 1298 | 0 | 1252 m at 299°, +5 d: fails, 16.1% sunlit, blackout 0.8 h | -6 d |
| Leibnitz beta / Mons Mouton | fails (24.9% sunlit, battery floor at 65 h) | 78 × 11 = 858 | 0 | 378 m at 13°, +5 d: fails, 24.6% sunlit, blackout 0.8 h | -12 d |

Slope source: PGDA 78 5 m map, 3x3 Horn window (15 m baseline).

### 8f. Why? (sunlit % at the best-lit point, A = 2027-02-14, B = 2027-02-26)

| Site | A | B | Sun path | Earth path (sunlit / link) | Terrain (B real − B flat) | Panel 5 m vs 2 m (B) | Blocking ridge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shackleton rim | 97.4 | 85.1 | -12.2 | +0.0 / -2.3 | +85.1 | +0.6 | az 31.5°, 9.894 km, +208 m |
| Malapert massif | 100.0 | 54.6 | -45.4 | +0.0 / -1.1 | +41.6 | +0.0 | az 131.5°, 0.225 km, -9 m |
| Leibnitz beta / Mons Mouton | 100.0 | 24.9 | -75.0 | +0.0 / -0.5 | +24.9 | +1.4 | az 100.5°, 0.36 km, -6 m |

One-at-a-time swaps; bars need not add up. Earth's path cannot change sunlight (measured 0), only the comms metric link_pct. The terrain bar is large and positive because a flat 0° horizon hides most or all of the Sun on these dates: the best-lit points sit high enough that their real horizon dips below 0° in the Sun's direction.
Blocking ridge: at Shackleton the blocker is a real ridge 9.9 km away, 208 m above the panel (horizon 1.04°). At Malapert and Leibnitz beta the highest-angle sample along that azimuth is the point's own downslope, 0.2-0.4 km away and below the panel (horizon -2.25° and -0.93°): there the Sun was simply too low, not hidden by a ridge. Ridge-raycast elevations match the stored grid horizons to 0.002°.
Note: on the 5 m map the Shackleton best-lit point itself has a 9.3° slope, above the 8° landing limit.

### 8g. Plan B revision (main chat audit)
The first Plan B search allowed landing up to 5 days EARLIER than the slipped date, which is impossible after a
launch slip, and ranked non-surviving options by blackout length (every one failed ~11 h after landing). Revised
(`07_planb.py`): landing on the slipped date or up to 30 days later only; survivors ranked by earliest landing, then
shortest direct-to-Earth blackout, then most sunlight; non-survivors by time to the battery floor.

| Site | Original point (slipped date) | Survivable combinations | Option A |
| --- | --- | --- | --- |
| Shackleton rim | fails (slope 9.3°, above 8°) | 2 of 775 | 162 m at 336°, land +6 d, survives, 91% sunlit |
| Malapert massif | fails; original point works again at +18 d | 28 of 3,658 | 1,095 m, land +18 d, survives, 99.8% sunlit |
| Leibnitz beta / Mons Mouton | fails; original point works again at +18 d | 8 of 2,418 | 535 m at 328°, land +17 d, survives, 98.8% sunlit |

Landing slopes at the points the app shows (`pipeline/10_point_meta.py`, 5 m LOLA, Horn 3x3): best-lit points
9.3° (Shackleton, too steep), 3.4° (Malapert), 6.3° (Leibnitz beta); "top 5%" and "typical" points 14-32° except
Leibnitz beta's top-5% point (5.0°).

### 8h. Browser engine audit
Headless test of 108 Mission Board states (3 sites x 4 points x 3 landers x 3 dates): all render, and the in-browser
TypeScript simulator agrees with the Python pipeline on survival in all 108. The Trust tab re-runs 365 landing days
live (365/365 agreement). New derived outputs: sunrise/Earthrise times when landing in darkness; darkness split into
terrain-caused vs below a bare Moon's horizon (dip from the point's height); smallest battery that survives a date
(sequent-peak drawdown of cumulative net energy / usable fraction above the floor).

## 9. AI stream (Stream A) — merged; full details in `docs/model_card.md`
SURVIVOR (5-model LightGBM ensembles, 75,000 exact simulator runs, test = the whole unseen Leibnitz beta site):
AUROC 0.9975, ECE 0.0049, accuracy of AI-accepted runs 99.81% (81.1% accepted); conformal coverage on the unseen site
95.6% / 89.6% / 78.3% / 87.0% (P(survive) / sunlit / blackout / hours to floor) against a 90 ± 2% gate: 3 of 5 gates
fail, so SURVIVOR is a screener whose top picks and uncertain candidates are always re-run exactly. Speed-up 3.1×
end to end (5.2× model only). HELIOS: median horizon error 0.23 / 0.64 / 0.83° on held-out tiles against 0.05°;
all gates fail; not used anywhere. Gate demo (276,480 candidates per site, 14 Feb – 15 Mar 2027): 3,672 / 5,223 /
74,656 sent to the exact simulator; all AI top-20 picks survive in the exact re-run; physics changed the #1 pick at
Shackleton and Malapert. Main-chat audit: 5 m LOLA slopes added to the AI top-10 lists
(`pipeline/10_point_meta.py`); 8 / 8 / 7 of 10 are steeper than 8°, because the AI search ranks by sunlight only.
