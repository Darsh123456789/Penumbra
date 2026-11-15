# PROMPT — Task 3: lunar relay "what-if" (NEW FEATURE for the PENUMBRA web app)

You are the same chat that did PENUMBRA's validation, Plan B and Why? stream (Stream B). **This is a new
feature.** Your earlier work is merged and deployed; don't redo it.

Deadline: **pushed by 23:10 IST tonight (Sun 15 Nov 2026)**. Freeze 23:15, submission 23:59. If time runs
short, ship the MVP in section 5 and stop. Nothing half-working goes to `main`.

**Before you start, ask me (Darsh) for any files you need**, e.g. kernels if you want SPICE in Python, or
anything you can't fetch. Most of what you need is in the repo.

---

## 1. Why this feature

Our headline comms finding:
- Direct-to-Earth links from the south pole drop out for days. The longest blackout across the 14-day
  missions reaches about **198 h**.
- That's caused by Earth dipping below the real LOLA horizon plus DSN gaps.

Both NASA and ESA are answering this with relays:
- **ESA's Moonlight / Lunar Pathfinder** (built by SSTL; an elliptical lunar frozen orbit with apolune
  over the south pole).
- **NASA's LunaNet / LCRNS** (Lunar Communications Relay and Navigation Systems).

A toggle that answers "how much of this blackout would a south-pole relay remove, at *this* exact spot
and date?" turns a finding into a design input. It also brings ESA, a partner agency, into the data story.

## 2. Ground rules (honesty first; judges check this)
- The relay orbit is an **assumption**, stated as such in the UI:
  - "Representative elliptical lunar frozen orbit (ELFO) in the style of ESA Lunar Pathfinder; not an
    operational ephemeris."
  - Show every orbital element used.
  - Cite the public sources you used for them (ESA / SSTL pages, a peer-reviewed ELFO paper). Use
    WebSearch/WebFetch. **Never invent a number and present it as ESA's.** If a value isn't public, say
    "assumed" next to it.
- Default **off**. With the relay off, every existing number must be bit-identical to now: same
  Python/browser agreement, same Trust results.
- The physics core (`simulate`) gains an optional relay input. Don't change any other behaviour.

## 3. Context
- Repo `https://github.com/Darsh123456789/penumbra`, `main`. `web/` is React + Vite + TS. Build with
  `cd web && npm ci && npx tsc -b && npm run build`.
- `web/src/engine.ts`:
  - `simulate(e, d, H, lat, lon, startIso, days, p, geoHorizonDeg = 0, lite = false)`.
  - The link today is `link = up && ds`, where `up` = Earth more than `earth_margin_deg` above the LOLA
    horizon and `ds` = a DSN complex sees the Moon (`dsn_visible.bin` bitset, 10-minute steps,
    2023–2033).
  - Outputs include `link_pct` and `longest_blackout_h`. The series has `link`.
  - Frames: MOON_ME, east-positive longitude, azimuth clockwise from north. `siteVector`, `enu`, `azEl`
    and `horizonAt(H, az)` are all exported. Sun/Earth vectors come from the ephemeris table via
    `interp`.
- `pipeline/simulate.py` is the Python twin. `pipeline/08_why.py` is your Why? attribution, and its bars
  include "Earth comms".
- **New since you last saw it (Enhancement 1, being pushed by the main chat now):**
  - "Pick any spot" map on the Mission Board (all 9,216 grid points per site, `point === 'custom'`, grid
    index `pk`).
  - Live 2027 survival track for custom points (`survivalYear` in `engine.ts`).
  - "Plan B for this spot on this date" live search.
  - `grid_<site>.json` data files.
  - `boardSelection` shared with the Rim tab.

  **`git pull origin main` first** and wait for the commit "Pick any point" if it isn't there yet.
- **Another chat is adding a lander editor right now** (`preset === 'custom'`, `lander` object in
  `MissionBoard.tsx`). Keep your `MissionBoard.tsx` edits small and local (a toggle plus extra readout
  rows) so the merge is easy. Put your logic in a **new file `web/src/relay.ts`**.

## 4. What to build

### 4a. Relay geometry: `web/src/relay.ts`
- Keplerian orbit about the Moon:
  - elements `a, e, i, Ω, ω, M0 at epoch` (epoch 2027-01-01T00:00:00 TDB, in ET seconds);
  - μ_Moon = 4902.800 km³/s².
- Frame: a Moon-centred frame. For a what-if, MOON_ME with the orbit's node regressing is acceptable
  **if you say so**. Better, if you can: propagate in an inertial frame and rotate by the Moon's
  rotation, ~27.3217 d sidereal, about the MOON_ME z-axis. State the approximation either way.
  Precision needed is ~1° in elevation, not metres.
- Default ELFO: research the representative Lunar Pathfinder / ELFO values (semi-major axis, high
  eccentricity, inclination near 56–63° in the frozen-orbit family, argument of periapsis ≈ 90° so that
  **apolune sits over the south pole**, period on the order of a day). Use cited numbers. Mark any guess.
- `relayVisible(et, lat, lon, H)`: the relay's elevation from the site ≥ the LOLA horizon at its
  azimuth + 1° (same margin convention as Earth), **and** the relay can see Earth (the Moon doesn't block
  the relay→Earth line, using the Earth vector from the ephemeris), **and** `dsnAt(d, et)` (the relay
  still needs a DSN station; it is near the Moon, so the existing bitset applies).
- Option: a **2-satellite constellation** (second satellite phased 180° in M) as a "LunaNet-style"
  what-if. Label it as such.

### 4b. Engine hook (minimal)
- Add an optional last parameter to `simulate`: `relay?: (et: number) => boolean`.
- `link = (up && ds) || (relay ? relay(et) : false)`.
- Add result fields: `relay_only_pct` (time when only the relay gives a link) and
  `longest_blackout_no_relay_h` (so the UI can show before/after from one run).
- **Without `relay`, nothing changes.** Prove it: run the Trust live check (365/365 days) with the relay
  off and confirm it still passes.

### 4c. UI
- **Mission Board:**
  - Toggle "Add a south-pole relay (what-if)" with options Off / 1 relay (Pathfinder-style ELFO) /
    2 relays.
  - When on: both main cards' "Direct-to-Earth link" bar becomes "Link (Earth direct + relay)". Show the
    direct-only value as a thin second bar or a small "was X%" note.
  - Engineering readout rows: "Longest comms blackout: direct only → with relay"; "Time the relay alone
    carries the link"; "Relay above the local terrain horizon (% of mission)".
  - Timeline: if the Timeline component has a link lane, add a relay lane, or tint relay-only link time
    differently.
  - It must work for **custom map points** (Enhancement 1) and for whatever lander is selected (the
    Task 2 `lander` object, if merged).
- **Panorama:** optionally draw the relay's sky track for the 14 days (it's a curve like the Sun/Earth
  paths). This is optional and comes last.
- **Why?** (`Views.tsx` → `PlanB`/Why section): add one sentence or row: "With a Pathfinder-style relay,
  the Earth-comms penalty at this point falls from X to Y h". Compute it live with the engine. Don't
  re-run the Python Why? pipeline.
- **Provenance panel:** add the ESA Lunar Pathfinder / Moonlight and NASA LCRNS/LunaNet sources you
  cited, marked "partner data: assumption for what-if".

### 4d. Python twin (only if time allows)
Mirror `relay_visible` in `pipeline/relay.py` and compare 1,000 random (site, time) states against the
browser. Report agreement in `docs/validation.md` §10 "Relay what-if". If there's no time, say the relay
is browser-only and unvalidated against Python. Never claim validation you didn't do.

## 5. MVP order
1. `relay.ts` with cited default ELFO + `simulate` hook (relay off = identical).
2. Toggle + before/after blackout numbers in the readout and cards.
3. Timeline lane / Panorama track / Why? line / Provenance.
4. Python twin check.

## 6. Verification before pushing
- `npx tsc -b && npm run build`: no errors. No console errors in `vite preview`, all tabs, at 390 px.
- Relay off: Trust browser-vs-Python still 365/365.
- Relay on, sanity in numbers:
  - Longest blackout with relay ≤ without, for every landing day of 2027 at the 3 best points. Assert it
    in a script.
  - The relay should be above the horizon mostly around apolune.
  - Report the median blackout reduction per site.
- Spot-check one time by hand: the relay's elevation from the site vs its sub-satellite latitude makes
  sense (near apolune over the south pole, elevation from an ~86–89°S site should be high).

## 7. Git
- `git pull origin main` right before committing. Resolve conflicts keeping everyone's features.
- Commit: `Relay what-if: Pathfinder-style ELFO relay option (cited, labelled assumption) in board, readout, Why?`
- Push by **23:10 IST**. Check `gh run list -R Darsh123456789/penumbra -L 1`.
- Add a `docs/STATUS.md` entry with the numbers.

## 8. Reply to me with
- files changed;
- the orbit elements and their sources;
- the before/after blackout numbers per site;
- a one-sentence submission line, e.g. "A what-if relay in an ESA Lunar Pathfinder-style frozen orbit
  cuts the longest comms blackout at Malapert's best point from X h to Y h for a 14 Feb 2027 landing."

**Ask me for anything you need before starting.**
