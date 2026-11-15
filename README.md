# PENUMBRA — slip-proof lunar landing navigator

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator**

## ▶ Open the live app: **https://darsh123456789.github.io/Penumbra/**

Nothing to install. It runs in any modern browser, on a laptop or a phone. All data is precomputed from NASA
sources and bundled with the site; the survival simulator also re-runs live in your browser.

## What to look at (5 minutes)

1. **Mission Board** — pick a site, a point and a lander, then drag the slip slider across 2027. Four cards, a 360°
   horizon from NASA LOLA terrain, a 14-day timeline (Sun, Earth, NASA DSN contact, battery) and an engineering
   readout (smallest battery that survives the date, darkness caused by terrain vs geometry) all update.
2. **Landing cloud** — the landing is a cloud, not a point: survival across a 400 m landing ellipse with 10 terrain
   versions built from NASA's LOLA height-error maps. Shackleton's best-lit spot survives 80% of the time if hit
   exactly, but only **11.6%** once landing error is included.
3. **Plan B + Why?** — after a 12-day launch slip: where and when to land instead (slope-checked, physics-verified),
   and what caused the change.
4. **Trust** — six independent checks: JPL Horizons (max 0.00003°), NASA PGDA 69 illumination (R² 0.86), a real LRO
   photo (95% of 233,000 cells agree), Chandrayaan-3's real timeline, browser vs Python simulator (365/365), and
   ephemeris sampling.
5. **AI Lab** — two models trained on PENUMBRA's own physics, reported against pre-set gates (pass or fail);
   "AI proposes, physics verifies".
6. **Stand on the rim** — a first-person view of the polar Sun over the real horizon, and a lunar day as sound.

## Key results

| Finding | Number |
| --- | --- |
| Best-lit points, sunlight over 2027 | Shackleton 79.9%, Malapert 80.3%, Mons Mouton area 74.5% |
| 2027 landing days on which a 14-day mission survives (best points) | 55–58%; the date matters more than battery size |
| Survival including a 400 m landing error | Shackleton 11.6%, Malapert 45.3%, Mons Mouton area 31.3% |
| Plan B after a 12-day slip | Shackleton: 162 m away, +6 d · Malapert: 1.1 km, +18 d · Mons Mouton area: 535 m, +17 d |
| Agreement with NASA/JPL Horizons | max 0.000027° |
| Agreement with NASA PGDA 69 long-term illumination | R² 0.859 over 300 points |
| Shadow check vs LROC NAC image M128378248LC | 95.2% of 233,496 cells agree (IoU 0.71) |

Full log: [docs/validation.md](docs/validation.md) · AI model card: [docs/model_card.md](docs/model_card.md) ·
Status: [docs/STATUS.md](docs/STATUS.md).

## Data (NASA first)

NASA LRO LOLA topography (PGDA 78 5 m site maps and height errors, PGDA 90 80 m south-pole map), NASA/JPL NAIF SPICE
(DE440 ephemeris, Moon frames), NASA/JPL Horizons, NASA PGDA 69 polar illumination, LROC NAC imagery, NASA Deep
Space Network station locations. Partner cross-checks: ISRO Chandrayaan-3 mission timeline; ESA Moonlight / Lunar
Pathfinder as the relay option. Lander presets are generic and editable, not models of real spacecraft.

## Repository layout

| Folder | Contents |
| --- | --- |
| `pipeline/` | Python pipeline: SPICE ephemeris, LOLA horizon raycaster, survival simulator, landing-uncertainty Monte Carlo, validation, Plan B, Why? |
| `ai/` | SURVIVOR and HELIOS training, conformal calibration, AI-assisted search |
| `web/` | React + Vite + TypeScript app (deployed to GitHub Pages on every push) |
| `docs/` | Validation log, model card, data contracts, figures |

## Reproduce (optional — judges do not need this)

```
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python pipeline/01_ephemeris.py                         # Sun/Earth table, 2023-2032
python pipeline/01b_horizons_check.py                   # needs internet (JPL Horizons)
# put the NASA LOLA GeoTIFFs listed in docs/STATUS.md into data/dem/, then:
python pipeline/03_horizons.py && python pipeline/04_simulate.py && python pipeline/05_dispersion.py
python pipeline/06_validate.py && python pipeline/07_planb.py && python pipeline/08_why.py
python pipeline/09_export_web.py && python pipeline/10_point_meta.py
cd web && npm install && npm run dev                     # local copy of the app
```

Conventions: MOON_ME frame (as LOLA), sphere R = 1737.4 km, planetocentric latitude, east-positive longitude,
azimuth clockwise from north, apparent directions (LT+S), no refraction (no atmosphere).
