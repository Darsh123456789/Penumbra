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
