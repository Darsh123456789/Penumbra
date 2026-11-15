"""SURVIVOR label generation: exact simulate.simulate() runs for random grid points x random
2027 landing days (00:00 UTC) x the 3 presets. Multiprocessing over (site, point, day) pairs.

Usage: python ai/survivor_data.py [n_pairs]      -> ai/out/survivor_runs.npz
"""
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

TARGETS = ["survives", "sunlit_pct", "longest_blackout_h", "hours_to_floor", "min_soc", "link_pct"]
_W = {}


def _init():
    C.g.load_kernels()
    _W["dsn"] = C.dsn_all()
    _W["sites"] = {s: C.site(s) for s in C.SITES}
    _W["P"] = C.presets()


def run_pair(args):
    si, k, day = args
    s = C.SITES[si]
    d = _W["sites"][s]
    H = d["horizon"][k].astype(float)
    lat, lon = float(d["lat"][k]), float(d["lon"][k])
    dsn10 = _W["dsn"][day * C.STEPS_DAY: (day + C.MISSION_DAYS) * C.STEPS_DAY]
    t0 = time.perf_counter()
    sky, h36, inter = C.sky_features(H, lat, lon, day, dsn10)
    base = C.base_features(h36, lat, lon, day)
    t_feat = time.perf_counter() - t0
    X, Y, T = [], [], []
    start = C.day_utc(day)
    for pname in C.PRESET_NAMES:
        p = _W["P"][pname]
        t1 = time.perf_counter()
        pfe = C.preset_features(p, inter)
        t_feat_p = time.perf_counter() - t1
        t1 = time.perf_counter()
        r = C.S.simulate(H, lat, lon, start, C.MISSION_DAYS, p, dsn_cache=dsn10)
        t_sim = time.perf_counter() - t1
        X.append(np.concatenate([base, sky, pfe]))
        htf = r["hours_to_floor"] if r["hours_to_floor"] is not None else C.MISSION_DAYS * 24.0
        Y.append([float(r["survives"]), r["sunlit_pct"], r["longest_blackout_h"], htf, r["min_soc"], r["link_pct"]])
        T.append([t_feat / 3 + t_feat_p, t_sim])
    return si, k, day, np.array(X), np.array(Y), np.array(T)


def main():
    n_pairs = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
    rng = np.random.default_rng(2027)
    # half the points uniform over the grid, half from the best-lit 10% (uniform sampling gives ~1% survivors)
    top = {si: np.argsort(C.site(s)["sun_pct"])[-922:] for si, s in enumerate(C.SITES)}
    jobs = []
    for i in range(n_pairs):
        si = int(rng.integers(3))
        k = int(rng.integers(9216)) if i % 2 == 0 else int(rng.choice(top[si]))
        jobs.append((si, k, int(rng.integers(C.NDAYS))))
    t = time.time()
    with Pool(2, initializer=_init) as pool:
        res = pool.map(run_pair, jobs, chunksize=200)
    meta = np.array([[r[0], r[1], r[2], pi] for r in res for pi in range(3)], np.int32)
    X = np.concatenate([r[3] for r in res]).astype(np.float32)
    Y = np.concatenate([r[4] for r in res])
    T = np.concatenate([r[5] for r in res])
    os.makedirs(C.AI_OUT, exist_ok=True)
    np.savez_compressed(os.path.join(C.AI_OUT, "survivor_runs.npz"), X=X, Y=Y, T=T, meta=meta,
                        feature_names=np.array(C.FEATURE_NAMES), target_names=np.array(TARGETS))
    print(f"{len(X)} runs in {time.time() - t:.0f} s wall | mean sim {1000 * T[:, 1].mean():.2f} ms, "
          f"mean features {1000 * T[:, 0].mean():.2f} ms | survive rate {Y[:, 0].mean():.3f}")


if __name__ == "__main__":
    main()
