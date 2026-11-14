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
