# PROMPT — Task 5: add more NASA Artemis III candidate regions to PENUMBRA (new chat)

You are joining **PENUMBRA**, our NASA Space Apps Challenge 2026 entry for "Lunar Landing Site Navigator".
It is a validated tool that compares lunar south-pole landing sites and dates using:
- real NASA LOLA horizons;
- JPL SPICE DE440 Sun/Earth geometry;
- a lander power/battery/comms simulator;
- landing-dispersion Monte Carlo, Plan B, Why? attribution, and an AI Lab.

It currently covers 3 detailed sites: Shackleton rim, Malapert massif, and Leibnitz beta / Mons Mouton.
**Your job: add 2–3 more of NASA's Artemis III candidate regions and make every feature work for them.**

Deadline: **pushed by 23:10 IST tonight (Sun 15 Nov 2026)**. Freeze 23:15, submission 23:59. This is the
riskiest task tonight, so work in stages and **never push a partially integrated site**. If only one new
site is fully done, ship one.

## 0. First message: ask me (Darsh) for all the files you need

Your workspace **cannot download from pgda.gsfc.nasa.gov, NAIF, or most sites** (only GitHub and package
registries). I will download the files on my machine and attach them. Give me a numbered list with
**exact URLs**, file names and sizes if you can find them, and what each is for. Expect to ask for:

1. **The repo**: ask me to attach access to `https://github.com/Darsh123456789/penumbra`, or clone it if
   you can.
2. **New 5 m site maps** from NASA LOLA PGDA product 78, `https://pgda.gsfc.nasa.gov/products/78`. For
   each new site, both the surface `<Site>_final_adj_5mpp_surf.tif` and the height-error map
   `..._toterr.tif` (exact name per PGDA; check the product page with WebFetch).
   - The file-name list we already probed is in `pipeline/00_find_site_maps.py`
     (`Site01, Site06, Site07, Site11, Site42, Haworth, Shoemaker, DM1, DM2, SL2, SL3, NPA…NPD, LM1…LM8`, …).
   - **Use WebSearch/WebFetch to match NASA's Artemis III candidate regions** (NASA, Oct 2024: Peak near
     Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2,
     de Gerlache Rim 2, Slater Plain) to PGDA 78 maps. Pick the 2–3 with a 5 m map that we don't already
     have.
   - Good candidates: **Haworth**, **Nobile Rim 1/2**, **de Gerlache Rim 2**, **Peak near Cabeus B**.
     Cite NASA's page in the docs.
3. **SPICE kernels** (for `pipeline/geometry.py`): `naif0012.tls`, `de440s.bsp`,
   `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`. They're referenced by `pipeline/kernels/penumbra.tm`
   and may already be in the repo or in my uploads; ask if missing.
4. **The 80 m far-field map** `LDEM_80S_80MPP_ADJ.tiff` (NASA LOLA PGDA 90). It's large; ask me for it.
   You need it for the 200 km horizon rays beyond the 5 m map.

Don't start computing until you have the files. Meanwhile read the code.

## 1. Conventions you must keep (all validated; don't change them)
- MOON_ME frame, sphere R = 1737.4 km, east-positive longitude, azimuth clockwise from local north,
  apparent directions (LT+S), no refraction.
- South polar stereographic map (lat_0 = −90, lon_0 = 0) for grids. "Up" on maps = towards 0° longitude.
- Horizons:
  - `pipeline/terrain.py` raycaster (Numba, **no fastmath**; the OUTSIDE = −1e30 sentinel falls back
    from 5 m to 80 m);
  - 360 one-degree bins (bin k centred k+0.5°), rays to 200 km, observer 2 m;
  - **96 × 96 grid per site**, ordered y-major then x.
- Survival sim: 10-minute steps, partial solar disc (r 0.2666°), presets in `pipeline/presets.json`,
  battery floor 20 %, heater when f_sun < 0.05, DSN comms bitset, Earth margin 1°.
- Landable = Horn 3×3 slope on the 5 m map < 8°.

## 2. Pipeline: run every step for each new site
Find every hard-coded site list with `grep -rn "Site23\|malapert\|leibnitz_beta" pipeline ai web/src`.
Then add the new sites **everywhere** with keys like `haworth`, `nobile_rim_1`, `de_gerlache_rim_2`.

1. `00_find_site_maps.py`: confirm bounds and coverage. Place the files in `data/dem/`.
2. `03_horizons.py`:
   - Add each site to `SITES` (file, NASA name, 96).
   - Choose the grid window (`x_m`, `y_m` extents) inside the 5 m map, with margin for the 3×3 slope.
   - Runtime is about 10–20 min per site; run them in the background and log.
   - Outputs: `out/horizons_<site>.npz`, `web/public/data/horizons_<site>.bin/.json`, `illum_<site>.png`.
3. `04_simulate.py`: `slip_<site>.json` (4 reference points × 3 presets × 365 days) and
   `timeline_<site>.json`.
4. `05_dispersion.py`: `dispersion_<site>.json` (10 terrain variants from `toterr`, 4,000 draws,
   400 m 3σ, safer aim).
5. `07_planb.py`: `planb_<site>.json` (forward-only, 30-day window, 2 km radius, slope < 8°).
6. `08_why.py`: `why_<site>.json`.
7. `09_export_web.py`: **`sites.json`**. Add the new sites with:
   - `dataset` ("NASA LOLA PGDA 78 <Site> (5 m)");
   - `context` (e.g. "One of NASA's nine Artemis III candidate regions", cite NASA);
   - `detailed: true`, `best_index`, `best_sun_pct_2027`.
8. `10_point_meta.py`: add to `FILES` → slopes in `points_meta.json` (and the AI search slopes if there's
   an AI file for the site).
9. `11_point_grid.py` (**new tonight**, Enhancement 1): add to `FILES` → `grid_<site>.json`. This powers
   the "Pick any spot" map: all 9,216 points with z, sun, earth, both, slope.
10. AI (`ai/`): **do not retrain.** Run the existing SURVIVOR search/gate demo on the new sites if the
    scripts accept a site (`ai/gate_demo.py`, outputs `ai_search_<site>.json`). The new sites are
    **unseen in training**; label them that way, as Leibnitz beta already is. If that isn't quick, leave
    AI Lab at 3 sites and say so.
11. `06_validate.py`: if any validation is per-site (e.g. PGDA 69 comparison), extend it if data exists.
    Otherwise state that the new sites rely on the same validated code path.

## 3. Web: make every tab work for the new sites
- `web/src/MissionBoard.tsx`:
  - `export const SITES = [...]` is **hard-coded**. Either append the new sites, or (better) build it
    from `sites.json` (`detailed: true`).
  - Check everything that loops over `SITES`: compare cards (with 5–6 sites, show the other sites in a
    scrollable row or let the user pick 3), slip loading `Promise.all(SITES.map(...slip_...))`, and the
    pick-any-spot map (`loadGrid`).
- `web/src/Views.tsx`:
  - Dispersion, PlanB, Why, Rim use `SITES` (verify each loads `dispersion_/planb_/why_<site>.json`).
  - AI Lab uses its own `AI_SITES`; extend it only if you produced `ai_search_<site>.json`.
  - Trust: add a sentence on what is validated for the new sites.
  - Provenance: add the new PGDA 78 files and the NASA Artemis III regions page.
- Make sure nothing crashes if a file for a site is missing (use `optionalJson`).
- Mobile 390 px: site selectors must still fit.

## 4. Verification (required)
- `cd web && npm ci && npx tsc -b && npm run build`: zero errors. `npx vite preview`, then click every
  tab × every new site. No console errors.
- Browser vs Python: for each new site's best point, the browser live sim must match `slip_<site>.json`
  on 365/365 days (`survives`) and within 0.5 pts on `sunlit_pct`. The Trust tab does this for
  Shackleton; reuse that logic in a script.
- Physical sanity, as numbers in your reply:
  - Best-point % sunlit in 2027 (should be roughly 60–85 % for good rim/ridge sites).
  - % landable points.
  - Dispersion P(survive).
  - Plan B option A shift and distance.
  - Compare with the existing three: Shackleton 79.9 % / Malapert 80.3 % / Leibnitz 74.5 % best-lit;
    P(survive) 11.6 % / 45.3 % / 31.3 %.
- Open each new `illum_<site>.png` and check it looks like terrain (ridges lit, craters dark), not noise
  or a constant.

## 5. Git rules
- Two other chats are editing `MissionBoard.tsx` / `engine.ts` tonight: a lander editor and a relay
  what-if. **`git pull origin main` right before each commit**, and keep their features when resolving
  conflicts.
- Large data: check `web/public/data` sizes. Each site adds about 6.6 MB of horizons + 0.25 MB grid +
  slip/timeline JSON. Keep `/data/` (DEMs) **out of git** (`.gitignore` already has `/data/`).
- Commit per stage, e.g.:
  - `Sites: add Haworth (PGDA 78) — horizons, slip, dispersion, Plan B, Why, grid`
  - `Web: new Artemis sites in every tab`
- Push by **23:10 IST**, then `gh run list -R Darsh123456789/penumbra -L 1` (Pages deploy green).
- Add a `docs/STATUS.md` entry and a `docs/validation.md` line for the new sites.

## 6. Reply to me with
- which NASA Artemis III regions you added and the PGDA 78 maps used (with links);
- the per-site numbers from section 4;
- what (if anything) is missing for them (e.g. AI search);
- one submission sentence, e.g. "PENUMBRA now covers six south-pole sites including N of NASA's nine
  Artemis III candidate regions, each with 9,216 ray-cast horizon points from NASA LOLA 5 m terrain."

**Start by sending me the file list (section 0).**
