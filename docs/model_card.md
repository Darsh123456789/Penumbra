# PENUMBRA AI stream: model card (HELIOS, SURVIVOR, gate)

Every number below was measured by code in `ai/` on 15 Nov 2026 and is copied from `ai/out/*.json`
(`helios_metrics.json`, `survivor_metrics.json`, `gate_<site>.json`). The web summary is
`web/public/data/ai_model_card.json`; the searches are `web/public/data/ai_search_<site>.json`.
**Rule of the stream: AI proposes, physics verifies.** No AI number replaces a physics number in the app
unless it passed the gate described in §2.

Reproduce (2 CPU cores, about 35 min in total):
```
python ai/survivor_data.py 25000   # 75,000 exact simulate() runs  -> ai/out/survivor_runs.npz
python ai/survivor_train.py        # SURVIVOR + conformal + OOD    -> ai/out/survivor.joblib, survivor_metrics.json
python ai/gate_demo.py             # AI search + exact verification -> web/public/data/ai_search_<site>.json
python ai/helios.py 4000           # HELIOS, 3 sites               -> ai/out/helios_<site>.pt, helios_metrics.json
python ai/make_model_card.py       #                                -> web/public/data/ai_model_card.json
```

---

## 1. SURVIVOR: mission-survival surrogate

**Status: FAILED (3 of 5 gates fail).** It ranks and classifies very well on a site it never saw
(AUROC 0.997, ECE 0.005). But the 90% conformal intervals do not hit 90% ± 2% on the held-out site for three of the four targets.

### Data
* Labels come from the exact simulator `pipeline/simulate.simulate(H, lat, lon, start, 14, preset, dsn_cache=…)`.
  DSN visibility is computed once for every 10-minute step of 2027 + 14 days and sliced per landing day,
  as in `pipeline/04_simulate.py`.
* 25,000 (site, grid point, landing day) draws × 3 presets = **75,000 exact runs** (543 s wall on 2 cores,
  2.13 ms per simulate() call). Landing days are uniform over 2027 at 00:00 UTC.
* Point sampling: half are uniform over the 96×96 grid and half come from the best-lit 10% of the grid. Uniform sampling
  alone gave 1.1% survivors in a pilot run. Even so, only **2.8%** of runs survive, which is consistent with Step 4:
  typical points survive on 0% of 2027 landing days.
* Features (69): the horizon averaged into 36 × 10° bins; lat, sin/cos lon, sin/cos day-of-year;
  Sun/Earth elevation summaries over the mission from the hourly ephemeris (mean/min/max/std, Earth azimuth
  spread, DSN fraction); coarse-horizon physics features (hourly lit / Earth-up / link fractions, longest dark
  and no-link runs, first sunset, lit share in the first 48 h); and preset terms (peak panel power, battery,
  load, heater, floor, tracking flag, coarse energy ratio, longest-dark-run energy need ÷ usable battery).
* Targets: `survives`, `sunlit_pct`, `longest_blackout_h`, `hours_to_floor` (set to 336 h if the
  battery never reaches the floor).

### Splits
* **Test = the whole leibnitz_beta site** (24,615 runs, never seen in training).
* Shackleton + Malapert are split **by grid point**: 70% fit (35,082 runs), 10% isotonic calibration (5,052),
  20% conformal calibration (10,251).

### Model
* An ensemble of 5 LightGBM models per target (600 trees, 63 leaves, bagging 0.8, different seeds). P(survive) is the ensemble
  mean after isotonic calibration. The regressors use an L1 objective.
* **Conformal**: normalised split conformal, score = |y − ŷ| / (ensemble std + ε).
  For the 0/1 survival label it is Mondrian (class-conditional), so it targets 90% within failures and within survivors separately.
* **OOD flag**: the mean distance to the 5 nearest training rows in standardised feature space is above the 99th
  percentile of the same distance for the calibration rows (threshold 3.88).

### Measured results (held-out site leibnitz_beta)

| Metric | Gate | Measured | Pass |
| --- | --- | --- | --- |
| Conformal coverage, P(survive) 90% interval | 90% ± 2% | 95.56% | **FAIL** (over-covers) |
| Conformal coverage, sunlit_pct | 90% ± 2% | 89.64% | pass |
| Conformal coverage, longest_blackout_h | 90% ± 2% | 78.33% | **FAIL** |
| Conformal coverage, hours_to_floor | 90% ± 2% | 87.04% | **FAIL** |
| Expected calibration error of P(survive) (15 bins) | < 0.03 | 0.0049 | pass |
| AUROC of P(survive) | report | 0.9975 | — |
| Accuracy (p > 0.5), Brier | report | 99.62%, 0.0036 | — |
| MAE sunlit_pct / longest_blackout_h / hours_to_floor | report | 0.68 pts / 1.98 h / 3.29 h | — |
| OOD recall, shifted set: battery ×3 & panel ×2 | report | 100.0% | — |
| OOD recall, shifted set: horizon +8° | report | 99.86% | — |
| OOD recall, shifted set: load & heater ×3 | report | 100.0% | — |
| OOD flag rate on the unshifted held-out site | report | 18.2% (calibration split: 1.0%) | — |
| Speed-up vs simulate(), end to end incl. features | report | **3.1×** (0.69 ms vs 2.13 ms per run) | — |
| Speed-up, model only | report | 5.2× | — |

On the calibration split (same sites as training), coverage is 98.3% / 90.0% / 90.0% / 90.1%. The miss on the
held-out site therefore comes from the site shift, which breaks the exchangeability that conformal coverage relies on.
Notes:
* **The P(survive) 90% interval has zero width.** The calibrated model is exactly right (p = 0 or 1, matching
  the label) for over 90% of calibration rows in each class, so the 90% conformal quantile is 0 for both classes.
  This is honest but useless for deciding. Coverage by class on the test site: failures 95.7%, survivors 91.0%.
* For that reason the accept gate in §2 uses a **stricter class-conditional interval at level 0.95**, chosen on the
  calibration split. At 0.97 or above, every survivor's interval reaches 1 and nothing can be accepted by the AI.
  The test site was not used to choose it. With this interval: coverage 95.7%, mean width 0.26, 81.1% of test
  runs are AI-accepted (in-distribution and the interval excludes 0.5), and **99.81%** of those are correctly classified.
* The 3.1× speed-up is small because simulate() is already vectorised and fast (2.1 ms). Feature extraction
  (0.28 ms) and a 20-model ensemble (0.41 ms) eat most of the gain. A smaller ensemble would be faster, but it was not measured.

---

## 2. Gate demonstration: AI proposes, physics verifies

For each site, SURVIVOR scores **every grid point × 30 landing days** (00:00 UTC, 2027-02-14 to 2027-03-15) for the
`medium_vertical` preset: 276,480 candidates per site.

* A candidate is **accepted on AI alone** only if it is in-distribution AND its 0.95 class-conditional
  conformal interval on P(survive) lies entirely above or entirely below 0.5.
* **The exact simulator re-runs** the AI's top 20 plus every uncertain or OOD candidate.
* Final ranking: survives (exact if verified, else AI p > 0.5), then sunlit_pct (exact if verified, else AI), then
  P(survive). The JSON top 10 lists 10 distinct grid points, each at its best landing day. Each entry carries its own
  `landing_utc`, and the top-level `landing_utc` is the window start.

| Site | Scored | Sent to exact | Accepted by AI | OOD | AI label = exact on the sent set | AI top 20 survive (exact) | Top pick changed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shackleton | 276,480 | 3,672 | 272,808 | 3,616 | 99.51% | 20/20 | **yes** |
| malapert | 276,480 | 5,223 | 271,257 | 4,851 | 98.66% | 20/20 | **yes** |
| leibnitz_beta (unseen) | 276,480 | 74,656 | 201,824 | 74,291 | 99.92% | 20/20 | no |

Why the top pick changed: every AI top-20 candidate survived, but the AI under-predicts `sunlit_pct` at the
very top of the range. For example, Shackleton's AI #1 had an AI sunlit of 95.0% against an exact 97.1%, and the exact re-run found a
neighbouring candidate at 99.9%. So the ranking among survivors is decided by physics, not by AI. At Leibnitz β,
the site SURVIVOR never saw, the OOD flag sent 27% of candidates to the exact simulator automatically.

**Physics fallback in the app:** any candidate tagged `physics-verified` shows exact simulator numbers. A candidate tagged
`AI, within bounds` was not re-simulated: it was in-distribution and its interval was clear of 0.5. In all three
published top-10 lists, every entry is `physics-verified`.

---

## 3. HELIOS: neural horizon field

HELIOS_SECTION

---

## 4. Limitations
* SURVIVOR is trained on three south-pole sites, 2027 landing days, 00:00 UTC landings, 14-day missions and the 3
  generic presets. Anything else is outside its training data. The OOD flag catches gross shifts (100% / 99.9% / 100% recall
  on the three shifted sets) but flags 18% of a genuinely new site. That is acceptable, because flagged candidates go to physics.
* Conformal coverage is guaranteed only under exchangeability, and a new site is not exchangeable with the training sites.
  The measured held-out-site coverage (78–96%) is the number to trust, not the nominal 90%.
* `longest_blackout_h` intervals are the weakest (78% coverage). Do not quote AI blackout intervals without verification.
* Survival in `simulate.py` depends on the battery only. Comms (`longest_blackout_h`) is reported but does not decide survival.
* HELIOS models one site each and cannot extrapolate beyond the 96×96 grid.
