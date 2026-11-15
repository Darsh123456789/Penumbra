# PROMPT — Task 2: in-browser lander editor (NEW FEATURE for the PENUMBRA web app)

You are the same chat that built PENUMBRA's AI stream earlier (SURVIVOR / HELIOS). **This is a new
feature, not more AI work.** The AI work is finished, merged and deployed. Do not change anything in `ai/`
or in the AI Lab tab.

Deadline: **code must be pushed by 23:10 IST tonight (Sun 15 Nov 2026)**. Freeze is at 23:15. Submission
closes at 23:59. If you can't finish everything, ship the smallest working version (section 4, "MVP"),
then add extras. A half-finished feature on `main` is worse than no feature.

**Before you start, ask me (Darsh) for any files you need.** You probably need none: everything is in the
repo. If your workspace has no clone, ask me to attach the repo or give you access.

---

## 1. Context you need

- Repo: `https://github.com/Darsh123456789/penumbra` (branch `main`).
- Live app: GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.
- Web app: `web/` (React + Vite + TypeScript, `base: './'`). Build with `cd web && npm ci && npx tsc -b && npm run build`.
- The browser engine `web/src/engine.ts` is a **line-for-line TypeScript port** of `pipeline/simulate.py`.
  Browser and Python have been checked to agree on 108/108 audited states and 365/365 landing days. **Do
  not change the physics.**
- Lander parameters live in the `Preset` interface and the `PRESETS` object in `engine.ts`. They mirror
  `pipeline/presets.json`:
  `label, panel_layout ('vertical_4' | 'tracking_mast' | 'horizontal_deck' | 'vertical_4_on_side'),
  panel_area_m2, panel_eff, charge_eff, battery_wh, load_w, heater_w, soc_floor`, plus optional
  `initial_soc` (default 1) and `earth_margin_deg` (default 1).
- `simulate(e, d, H, lat, lon, startIso, days, p: Preset, geoHorizonDeg = 0, lite = false)` takes the
  preset **as an object**, so a user-edited object works with no engine change.
- **New since you last saw it (Enhancement 1, being pushed by the main chat right now):**
  - `MissionBoard.tsx` has a **"Pick any spot" map** of all 9,216 grid points per site. The point selector
    has a new value, `point === 'custom'` with grid index `pk`.
  - For a custom point, the whole 2027 survival track is computed **live** by `survivalYear(...)` in
    `engine.ts`.
  - There is a **"Plan B for this spot on this date"** search (every landable point within 2 km, live
    sims).
  - `boardSelection` (exported from `MissionBoard.tsx`) is read by the Rim tab.
  - New data files `web/public/data/grid_<site>.json` (z_m, sun, earth, both, slope per point), from
    `pipeline/11_point_grid.py`.

  **Pull `main` first (`git pull origin main`) and build on that.** If you start before it lands (check
  `git log origin/main` for "Pick any point"), wait or rebase; do not fork an old `MissionBoard.tsx`.

## 2. What to build

A **"Your lander" editor** on the Mission Board. A planner types in their own hardware, and every number
on the board updates instantly:
- both main cards;
- the engineering readout, including the sequent-peak minimum battery;
- the timeline and panorama;
- CSV/JSON exports and the share link;
- the custom-point live year track;
- the Plan B spot search;
- the three compare cards for the other sites.

### UI (Mission Board, inside the existing first `<section className="panel">`)
- Keep the existing **Lander** `<select>`. Add a final option **"Custom (edit below)"**, plus a small
  **"Edit lander"** toggle button that opens an inline panel (not a modal).
- The panel has labelled numeric inputs plus a range slider for each field:

  | Field | Range | Step |
  | --- | --- | --- |
  | Battery capacity (Wh) | 200–20000 | 100 |
  | Panel area (m²) | 0.5–30 | 0.1 |
  | Cell efficiency | 0.10–0.35 | 0.01 |
  | Continuous load (W) | 20–1500 | 5 |
  | Survival heater when dark (W) | 0–500 | 5 |
  | Battery floor (%) | 5–50 | 1 |
  | Charge efficiency | 0.80–1.00 | 0.01 |

  It also has a **Panel layout** `<select>` with the four layouts and plain-English names:
  - "4 vertical panels (N/E/S/W)"
  - "Sun-tracking vertical mast"
  - "Horizontal deck"
  - "4 vertical panels, lander on its side"

  Check how `panelFactor` in `engine.ts` names them. Use exactly those keys.
- "Start from" buttons copy any of the three generic presets into the editor. A **Reset** button.
- **Validation:**
  - Clamp every value to its range.
  - Never pass NaN to `simulate`.
  - Show a small red note if load ≥ peak possible solar input (`panel_eff × 1361 × panel_area`), saying
    "this lander can never charge".
- **Debounce** recomputation by about 250 ms while a slider is dragged. Each `simulate` call is cheap
  (about 2,000 steps). The live year track (365 sims) and the Plan B search must not be retriggered on
  every pixel.
- **Honesty labels:**
  - The board currently says "Lander (generic, editable in pipeline/presets.json)"; change it to
    "Lander (generic presets, or your own)".
  - When Custom is active, add a line: "Custom lander: computed live in your browser with the same
    engine as the Python pipeline; the pre-computed Python tracks below are replaced by live ones."

### Logic: the important part
1. Introduce one resolved lander object in `MissionBoard`:
   `const lander: Preset = preset === 'custom' ? custom : PRESETS[preset];`
   Replace **every** `PRESETS[preset]` use in `MissionBoard.tsx` with `lander`. Grep for it; there are
   about 10 (sims, readout, exports, `survivalYear`, `findAlternatives`, labels).
2. **Pre-computed Python data does not exist for a custom lander.** `slip_<site>.json` has
   `by_preset[preset]` only for the three presets. So when `preset === 'custom'`:
   - **Slip track for the selected point:** compute live with `survivalYear` (the custom-point code path
     already does this). Generalise the condition from `isCustom` to
     `isCustom || preset === 'custom'`, and include a stable hash of the custom params in `yearKey`.
   - **The "Longest survivable windows" buttons** must use that live track.
   - **The three compare cards** (other sites, best-lit point) currently read Python via
     `metric(o.key, 'best', day)`. For a custom lander, run `simulate` live for each one. Load each site's
     horizons with `loadHorizons(o.key)` and use the point from `slip_<o.key>.json` →
     `points.best.lat/lon/z_m` with `nearestIndex`. Memoise, so that is 3 extra sims per change.
   - The **"matches the Python pipeline"** sentence under the timeline must be **hidden** for custom (no
     Python reference exists). Same for any `py` fallback: never show a Python number labelled for a
     lander it wasn't computed for.
3. **Share link and URL:** encode the custom lander in the hash, e.g.
   `&lander=custom&L=b4000,a8,e0.28,l220,h80,f20,c0.95,p=vertical_4`. Parse it in `q0` on load, clamp
   it, and fall back to `medium_vertical` if it's malformed. The JSON export already includes `lander`.
   Make sure it now writes the resolved custom object.
4. **Persist** the last custom lander in `localStorage`, wrapped in try/catch (it can throw).
5. **Do not touch** `slip_*.json`, the Python pipeline, Trust, Dispersion, Plan B (Python) or AI Lab. The
   precomputed tabs stay labelled with their generic presets. Add one line to the Landing cloud and the
   Plan B tab headers: "computed for the generic presets; use the Mission Board for a custom lander".

## 3. Verification (required before pushing)

1. `npx tsc -b && npm run build`: zero errors.
2. **Equivalence check:**
   - With Custom selected and values copied from `medium_vertical` (via "Start from"), every card number
     must equal the `medium_vertical` numbers exactly.
   - The live year track must equal `slip_<site>.json → points.best.by_preset.medium_vertical.survives`
     on 365/365 days for the best point of all three sites.
   - Write this as a small node or Playwright script, or run it in the browser console, and paste the
     result in your final message.
3. **Physical sanity, stated in numbers:**
   - Double the battery → hours-to-floor rises or the mission survives.
   - Load 1500 W → fails fast, "never charges" note shown.
   - Panel area 30 m² → more days survive.
   - The sequent-peak battery shown must be independent of the fitted battery (it's a property of the
     power profile). Confirm it doesn't change when only `battery_wh` changes.
4. Test on a 390 px wide viewport: inputs must not overflow.
5. No console errors. Run `npx vite preview` and click through every tab.

## 4. MVP if time is short (in this order)
1. Custom option + editor + `lander` object wired through the main cards, readout, timeline and exports.
2. Live year track + windows for custom.
3. Live compare cards.
4. Share-link encoding, localStorage, debounce polish.

## 5. Git rules
- `git pull origin main` immediately before committing; the main chat is also pushing tonight. Expect to
  touch `MissionBoard.tsx`. If there's a conflict, keep both sides' features.
- Commit message:
  `Mission Board: in-browser lander editor (custom lander drives every card, track, compare and Plan B search)`
- Push to `main` by **23:10 IST**, then run `gh run list -R Darsh123456789/penumbra -L 1` and check the
  Pages deploy is green.
- Add one entry to `docs/STATUS.md`:
  - what was built;
  - the equivalence result (e.g. "custom = medium_vertical on 365/365 days × 3 sites");
  - any limitation.

## 6. When you're done, reply with
- what changed (files, about 5 bullets);
- the equivalence and sanity numbers;
- one sentence I can paste into the submission, e.g. "Planners can enter their own lander (battery, panel
  area and layout, load, heater, floor) and every result on the board is recomputed live in the browser
  with the same validated engine."

**Ask me for anything you need before starting.**
