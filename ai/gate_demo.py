"""Gate demonstration — "AI proposes, physics verifies".

For each site: score every grid point x 30 landing days (00:00 UTC, 2027-02-14 .. 2027-03-15) for the
medium_vertical preset with SURVIVOR. A candidate is accepted on AI alone only if it is in-distribution
AND its conformal P(survive) interval lies entirely above or below 0.5. The AI top 20 plus every
uncertain / OOD candidate are re-run with the exact simulator (simulate.simulate).

Ranking key: survives (exact if verified, else AI p > 0.5), then sunlit_pct (exact if verified, else AI),
then P(survive). Top 10 is reported as 10 distinct grid points (each at its best landing day).

Usage: python ai/gate_demo.py   -> web/public/data/ai_search_<site>.json, ai/out/gate_<site>.json
"""
import json
import os
import sys
import time
from multiprocessing import Pool

import joblib
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from survivor_train import Survivor  # noqa: E402,F401  (needed to unpickle)

PRESET = "medium_vertical"
DAY0, NWIN = 44, 30                       # 2027-02-14 + 30 landing days
_W = {}


def _init(s):
    C.g.load_kernels()
    _W["d"] = C.site(s)
    _W["dsn"] = C.dsn_all()
    _W["p"] = C.presets()[PRESET]


def feats_point(k):
    d = _W["d"]
    H = d["horizon"][k].astype(float)
    lat, lon = float(d["lat"][k]), float(d["lon"][k])
    et0 = C.g.utc_to_et(C.YEAR0) + DAY0 * 86400.0
    ets = et0 + 3600.0 * np.arange((NWIN + C.MISSION_DAYS) * 24)
    saz, sel, eaz, eel = C.S.sky(lat, lon, ets)
    rows = []
    for j in range(NWIN):
        day = DAY0 + j
        sl = slice(24 * j, 24 * j + C.MISSION_DAYS * 24)
        dsn10 = _W["dsn"][day * C.STEPS_DAY: (day + C.MISSION_DAYS) * C.STEPS_DAY]
        sky, h36, inter = C.sky_features(H, lat, lon, day, dsn10, sky_cache=(saz[sl], sel[sl], eaz[sl], eel[sl]))
        rows.append(np.concatenate([C.base_features(h36, lat, lon, day), sky, C.preset_features(_W["p"], inter)]))
    return np.array(rows, np.float32)


def exact(args):
    k, day = args
    d = _W["d"]
    dsn10 = _W["dsn"][day * C.STEPS_DAY: (day + C.MISSION_DAYS) * C.STEPS_DAY]
    r = C.S.simulate(d["horizon"][k].astype(float), float(d["lat"][k]), float(d["lon"][k]), C.day_utc(day),
                     C.MISSION_DAYS, _W["p"], dsn_cache=dsn10)
    return bool(r["survives"]), r["sunlit_pct"], r["longest_blackout_h"]


def rank_order(surv, sun, p):
    return np.lexsort((-p, -sun, -surv.astype(float)))


def run_site(s, M):
    t0 = time.time()
    with Pool(2, initializer=_init, initargs=(s,)) as pool:
        X = np.concatenate(pool.map(feats_point, range(9216), chunksize=64))
        t_feat = time.time() - t0
        pt = np.repeat(np.arange(9216), NWIN)
        day = np.tile(DAY0 + np.arange(NWIN), 9216)
        t1 = time.time()
        o = M.predict(X)
        t_pred = time.time() - t1
        p, lo, hi = o["survives_gate"]   # 95% class-conditional conformal interval
        sun_ai = o["sunlit_pct"][0]
        ood = o["ood"]
        confident = (~ood) & ((lo > 0.5) | (hi < 0.5))
        ai_order = rank_order(p > 0.5, sun_ai, p)
        top20 = ai_order[:20]
        send = np.zeros(len(X), bool)
        send[top20] = True
        send |= ~confident
        idx = np.where(send)[0]
        t2 = time.time()
        res = pool.map(exact, [(int(pt[i]), int(day[i])) for i in idx], chunksize=64)
        t_exact = time.time() - t2
    v_surv = np.full(len(X), -1, int)
    v_sun = np.full(len(X), np.nan)
    v_surv[idx] = [int(r[0]) for r in res]
    v_sun[idx] = [r[1] for r in res]
    # agreement of AI-accepted-but-verified (the top-20 that were confident) is informative
    fin_surv = np.where(v_surv >= 0, v_surv == 1, p > 0.5)
    fin_sun = np.where(np.isnan(v_sun), sun_ai, v_sun)
    fin_order = rank_order(fin_surv, fin_sun, p)
    ai_top, fin_top = int(ai_order[0]), int(fin_order[0])
    # among sent-to-exact candidates: how often did AI label (p>0.5) match exact?
    sent_match = float(100 * np.mean((p[idx] > 0.5) == (v_surv[idx] == 1)))
    top20_ok = int(np.sum(v_surv[top20] == 1))
    # top 10 distinct points
    d = C.site(s)
    seen, top = set(), []
    for i in fin_order:
        k = int(pt[i])
        if k in seen:
            continue
        seen.add(k)
        verified = v_surv[i] >= 0
        top.append({"rank": len(top) + 1, "lat": round(float(d["lat"][k]), 5), "lon": round(float(d["lon"][k]), 5),
                    "x_m": round(float(d["x"][k]), 1), "y_m": round(float(d["y"][k]), 1),
                    "landing_utc": C.day_utc(int(day[i])),
                    "ai_p_survive": round(float(p[i]), 4), "ai_interval": [round(float(lo[i]), 4), round(float(hi[i]), 4)],
                    "ai_sunlit_pct": round(float(sun_ai[i]), 2), "ood": bool(ood[i]),
                    "verified_survives": bool(v_surv[i] == 1) if verified else None,
                    "verified_sunlit_pct": round(float(v_sun[i]), 2) if verified else None,
                    "tag": "physics-verified" if verified else "AI, within bounds"})
        if len(top) == 10:
            break
    out = {"site": s, "landing_utc": C.day_utc(DAY0), "preset": PRESET, "mission_days": C.MISSION_DAYS,
           "landing_window_days": NWIN, "candidate": "grid point x landing day (00:00 UTC)",
           "candidates_scored": int(len(X)), "sent_to_exact": int(send.sum()),
           "accepted_by_ai": int(len(X) - send.sum()), "ood_candidates": int(ood.sum()),
           "top_pick_changed_after_verification": bool(ai_top != fin_top), "top": top}
    stats = {"site": s, "feature_s": round(t_feat, 1), "predict_s": round(t_pred, 1), "exact_s": round(t_exact, 1),
             "ai_label_matches_exact_on_sent_pct": sent_match, "top20_verified_survive": top20_ok,
             "ai_top": {"point": int(pt[ai_top]), "day": C.day_utc(int(day[ai_top])), "p": float(p[ai_top]),
                        "ai_sunlit": float(sun_ai[ai_top]), "exact_survives": int(v_surv[ai_top]),
                        "exact_sunlit": float(v_sun[ai_top])},
             "final_top": {"point": int(pt[fin_top]), "day": C.day_utc(int(day[fin_top]))},
             **{k: out[k] for k in ["candidates_scored", "sent_to_exact", "accepted_by_ai", "ood_candidates",
                                    "top_pick_changed_after_verification"]}}
    with open(os.path.join(C.WEB, f"ai_search_{s}.json"), "w") as f:
        json.dump(out, f, indent=1)
    with open(os.path.join(C.AI_OUT, f"gate_{s}.json"), "w") as f:
        json.dump(stats, f, indent=1)
    print(json.dumps(stats), flush=True)
    return stats


def main():
    C.g.load_kernels()
    M = joblib.load(os.path.join(C.AI_OUT, "survivor.joblib"))
    sites = sys.argv[1].split(",") if len(sys.argv) > 1 else C.SITES
    for s in sites:
        run_site(s, M)


if __name__ == "__main__":
    main()
