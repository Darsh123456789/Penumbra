# PENUMBRA — slip-proof lunar landing navigator

NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator

## Pipeline status

| Step | Script | Status |
| --- | --- | --- |
| 1. Ephemeris table (Sun, Earth in MOON_ME, hourly 2026–2032) | `pipeline/01_ephemeris.py` | Done |
| 0. Find which PGDA 78 map covers a site | `pipeline/00_find_site_maps.py` | Run on a laptop with internet |
| 1b. Check vs NASA/JPL Horizons | `pipeline/01b_horizons_check.py` | Done: max 0.00003 deg |
| 1c. Chandrayaan-3 sunrise/sunset check (flat horizon) | `pipeline/01c_chandrayaan3_check.py` | Done |
| 2. Terrain loading + raycaster (LOLA PGDA 78 + 90) | `pipeline/terrain.py` | Done |
| 3. Horizons + 1-year illumination maps, 3 sites | `pipeline/03_horizons.py` | Done |
| 4. Survival simulator + 2027 slip curves + default timelines | `pipeline/simulate.py`, `pipeline/04_simulate.py` | Done |
| 5. Landing-uncertainty Monte Carlo + IM-2 replay | `pipeline/05_dispersion.py` | Done |
| 6. Web app (Mission Board, panorama, dispersion, Trust) | `web/` | Next |

## Setup

```
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python pipeline/01_ephemeris.py
python pipeline/01c_chandrayaan3_check.py
python pipeline/01b_horizons_check.py
# put the DEMs listed in docs/validation.md into data/dem/, then:
python pipeline/03_horizons.py
python pipeline/04_simulate.py
python pipeline/05_dispersion.py   # ~30 min on 2 CPU cores
```

Results and checks: [docs/validation.md](docs/validation.md).

## SPICE kernels (pipeline/kernels/)

NASA/JPL NAIF generic kernels: `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`,
`moon_de440_250416.tf`, loaded through `penumbra.tm`. Original source:
https://naif.jpl.nasa.gov/naif/data_generic.html

## Conventions

MOON_ME frame (same as LOLA); sphere R = 1737.4 km; latitude planetocentric, longitude east-positive;
azimuth from north through east; apparent directions (LT+S); no refraction (no atmosphere).

## Data sources

NASA/JPL NAIF SPICE (DE440); NASA LRO LOLA (PGDA products 78 and 90); NASA/JPL Horizons.
Partner-agency data (ISRO, JAXA, ESA) is listed in `docs/` when used.
