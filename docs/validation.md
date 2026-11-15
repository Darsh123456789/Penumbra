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
not_available: missing in data/dem/: AVGVISIB_85S_060M_201608.TIF, Site04_final_adj_5mpp_surf.tif, Site23_final_adj_5mpp_surf.tif, Site20v2_final_adj_5mpp_surf.tif, LDEM_80S_80MPP_ADJ.tiff

### 8c. Shadow truth vs LROC NAC
not_available: No LROC NAC image could be obtained: this build environment has no access to the LROC archive (data.lroc.im-ldi.com / QuickMap), and no image was supplied in data/lroc/.

### 8d. Chandrayaan-3 with terrain
not_available: PENUMBRA's 5 m and 80 m maps stop at 80 S; a LOLA DEM covering 69.37 S (PGDA 90 LDEM_60S_240MPP_ADJ.TIF) was not available in data/dem/.

### 8e. Plan B after a 12-day slip (2027-02-14 → 2027-02-26, mid-size preset, 14 days)
Search: grid points within 2 km of the best-lit point with slope < 8°, landing on the slipped date ±5 days; ranked by survives, then shortest direct-to-Earth blackout, then most sunlight.

| Site | Original on slipped date | Candidates (points × days) | Surviving | Option A | Original point survives if shifted |
| --- | --- | --- | --- | --- | --- |
| Shackleton rim | fails (85.1% sunlit, battery floor at 130 h) | 28 × 11 = 308 | 0 | 162 m at 66°, +5 d: fails, 24.0% sunlit, blackout 86.0 h | +6 d |
| Malapert massif | fails (54.6% sunlit, battery floor at 197 h) | 156 × 11 = 1716 | 0 | 1635 m at 291°, +5 d: fails, 18.9% sunlit, blackout 0.8 h | -6 d |
| Leibnitz beta / Mons Mouton | fails (24.9% sunlit, battery floor at 65 h) | 98 × 11 = 1078 | 0 | 378 m at 13°, +5 d: fails, 24.6% sunlit, blackout 0.8 h | -12 d |

Slope source: 96x96 analysis-grid heights, central differences (~324 m baseline); 5 m map not in data/dem/.

### 8f. Why? (sunlit % at the best-lit point, A = 2027-02-14, B = 2027-02-26)

| Site | A | B | Sun path | Earth path (sunlit / link) | Terrain (B real − B flat) | Panel 5 m vs 2 m (B) | Blocking ridge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shackleton rim | 97.4 | 85.1 | -12.2 | +0.0 / -2.3 | +85.1 | n/a | az 31.5° (raycast n/a) |
| Malapert massif | 100.0 | 54.6 | -45.4 | +0.0 / -1.1 | +41.6 | n/a | az 131.5° (raycast n/a) |
| Leibnitz beta / Mons Mouton | 100.0 | 24.9 | -75.0 | +0.0 / -0.5 | +24.9 | n/a | az 100.5° (raycast n/a) |

One-at-a-time swaps; bars need not add up. Earth's path cannot change sunlight (measured 0), only the comms metric link_pct. The terrain bar is large and positive because a flat 0° horizon hides most or all of the Sun on these dates: the best-lit points sit high enough that their real horizon dips below 0° in the Sun's direction.
