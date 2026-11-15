"""SURVIVOR — mission-survival surrogate with split-conformal error bars and an OOD flag.

Split:  train sites = shackleton + malapert, split by grid point into
        fit (70%) / isotonic-calibration (10%) / conformal-calibration (20%);
        test = every run at leibnitz_beta (site never seen in training).
Model:  ensemble of 5 LightGBM models per target (different seeds + bagging).
        P(survive) = isotonic-calibrated ensemble mean.
Conformal: normalised split conformal, score = |y - yhat| / (ensemble_std + eps), 90% target.
OOD:    mean distance to 5 nearest training rows (standardised features) > 99th percentile of the
        same distance for the conformal-calibration rows.

Usage: python ai/survivor_train.py   -> ai/out/survivor.joblib, ai/out/survivor_metrics.json
"""
import json
import os
import sys
import time

import joblib
import lightgbm as lgb
import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score
from sklearn.neighbors import NearestNeighbors

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ALPHA = 0.10
GATE_LVL = 0.95      # chosen on the calibration split (0.97+ makes every survivor interval reach 1 -> nothing can be AI-accepted)
N_ENS = 5
REG_TARGETS = {"sunlit_pct": 1, "longest_blackout_h": 2, "hours_to_floor": 3}
EPS = {"survives": 0.02, "sunlit_pct": 0.5, "longest_blackout_h": 1.0, "hours_to_floor": 1.0}
CLIP = {"survives": (0, 1), "sunlit_pct": (0, 100), "longest_blackout_h": (0, 336), "hours_to_floor": (0, 336)}
TEST_SITE = 2


class Survivor:
    def __init__(self):
        self.clf, self.reg, self.q, self.iso = [], {}, {}, None

    def _ens(self, models, X, proba=False):
        P = np.stack([m.predict_proba(X)[:, 1] if proba else m.predict(X) for m in models])
        return P.mean(0), P.std(0)

    def predict(self, X):
        out = {}
        p_raw, s = self._ens(self.clf, X, proba=True)
        p = self.iso.predict(p_raw)
        w = s + EPS["survives"]
        out["survives"] = (p, np.clip(p - self.q["survives_neg"] * w, 0, 1), np.clip(p + self.q["survives_pos"] * w, 0, 1))
        # stricter class-conditional interval (level GATE_LVL, chosen on the calibration split), used by the AI-accept gate
        out["survives_gate"] = (p, np.clip(p - self.q["survives_neg_gate"] * w, 0, 1),
                             np.clip(p + self.q["survives_pos_gate"] * w, 0, 1))
        for t in REG_TARGETS:
            m, s = self._ens(self.reg[t], X)
            lo, hi = CLIP[t]
            w = self.q[t] * (s + EPS[t])
            out[t] = (np.clip(m, lo, hi), np.clip(m - w, lo, hi), np.clip(m + w, lo, hi))
        Z = (X - self.mu) / self.sd
        dist = self.nn.kneighbors(Z)[0].mean(1)
        out["ood"] = dist > self.ood_thr
        out["ood_dist"] = dist
        return out


def ece(p, y, bins=15):
    e, edges = 0.0, np.linspace(0, 1, bins + 1)
    for a, b in zip(edges[:-1], edges[1:]):
        m = (p >= a) & ((p < b) if b < 1 else (p <= b))
        if m.any():
            e += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(e)


def fit(X, Y, tr, iso, cal, seed=0):
    M = Survivor()
    prm = dict(n_estimators=600, learning_rate=0.05, num_leaves=63, subsample=0.8, subsample_freq=1,
               colsample_bytree=0.8, min_child_samples=20, verbose=-1, n_jobs=2)
    for k in range(N_ENS):
        M.clf.append(lgb.LGBMClassifier(random_state=seed + k, **prm).fit(X[tr], Y[tr, 0]))
    for t, j in REG_TARGETS.items():
        M.reg[t] = [lgb.LGBMRegressor(random_state=seed + k, objective="l1", **prm).fit(X[tr], Y[tr, j])
                    for k in range(N_ENS)]
    p_raw, _ = M._ens(M.clf, X[iso], proba=True)
    M.iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(p_raw, Y[iso, 0])
    # conformal quantiles on the calibration split
    p_raw, s = M._ens(M.clf, X[cal], proba=True)
    # Mondrian (class-conditional) split conformal for the 0/1 label: 90% coverage within each class.
    pc, yc = M.iso.predict(p_raw), Y[cal, 0]
    sc = np.abs(yc - pc) / (s + EPS["survives"])
    for name, m in (("survives_neg", yc == 0), ("survives_pos", yc == 1)):
        n = int(m.sum())
        M.q[name] = float(np.quantile(sc[m], min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n), method="higher"))
        M.q[name + "_gate"] = float(np.quantile(sc[m], min(1.0, np.ceil((n + 1) * GATE_LVL) / n), method="higher"))
    n = cal.sum()
    lvl = min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n)
    for t, j in REG_TARGETS.items():
        m, s = M._ens(M.reg[t], X[cal])
        M.q[t] = float(np.quantile(np.abs(Y[cal, j] - m) / (s + EPS[t]), lvl, method="higher"))
    # OOD reference
    M.mu, M.sd = X[tr].mean(0), X[tr].std(0) + 1e-6
    rng = np.random.default_rng(seed)
    ref = rng.choice(np.where(tr)[0], min(20000, tr.sum()), replace=False)
    M.nn = NearestNeighbors(n_neighbors=5).fit((X[ref] - M.mu) / M.sd)
    M.ood_thr = float(np.percentile(M.nn.kneighbors((X[cal] - M.mu) / M.sd)[0].mean(1), 99))
    return M


def shifted(X, kind):
    Xs = X.copy()
    fi = {n: i for i, n in enumerate(C.FEATURE_NAMES)}
    if kind == "battery_x3_panel_x2":
        Xs[:, fi["p_battery_wh"]] *= 3
        Xs[:, fi["p_peak_w"]] *= 2
        Xs[:, fi["c_dark_need_ratio"]] /= 3
        Xs[:, fi["c_energy_ratio"]] = Xs[:, fi["c_energy_ratio"]] * 2 / 3
    elif kind == "horizon_plus_8deg":
        for k in range(36):
            Xs[:, fi[f"h36_{k * 10 + 5}"]] += 8.0
    elif kind == "load_x3":
        Xs[:, fi["p_load_w"]] *= 3
        Xs[:, fi["p_heater_w"]] *= 3
    return Xs


def main():
    d = np.load(os.path.join(C.AI_OUT, "survivor_runs.npz"))
    X, Y, T, meta = d["X"], d["Y"], d["T"], d["meta"]
    site = meta[:, 0]
    test = site == TEST_SITE
    rng = np.random.default_rng(7)
    gid = site * 10000 + meta[:, 1]
    ug = np.unique(gid[~test])
    u = rng.random(len(ug))
    grp = dict(zip(ug, u))
    r = np.array([grp.get(gg, -1.0) for gg in gid])
    tr = (~test) & (r < 0.7)
    iso = (~test) & (r >= 0.7) & (r < 0.8)
    cal = (~test) & (r >= 0.8)
    t0 = time.time()
    M = fit(X, Y, tr, iso, cal)
    t_fit = time.time() - t0
    out = M.predict(X[test])
    # timing: surrogate per run (batch), best of 3, + feature time measured during generation
    tt = []
    for _ in range(3):
        t1 = time.perf_counter(); M.predict(X[test][:5000]); tt.append(time.perf_counter() - t1)
    ms_model = 1000 * min(tt) / 5000
    ms_feat = 1000 * T[:, 0].mean()
    ms_sim = 1000 * T[:, 1].mean()
    yt = Y[test]
    p, lo, hi = out["survives"]
    met = {"train_runs": int(tr.sum()), "isotonic_runs": int(iso.sum()), "calibration_runs": int(cal.sum()),
           "test_runs": int(test.sum()), "fit_s": round(t_fit, 1),
           "test_survive_rate": float(yt[:, 0].mean()), "train_survive_rate": float(Y[tr, 0].mean()),
           "conformal_q": M.q, "ood_threshold": M.ood_thr}
    cov = {"survives": float(100 * ((yt[:, 0] >= lo) & (yt[:, 0] <= hi)).mean())}
    cov_cal = {}
    mae = {}
    width = {"survives": float(np.mean(hi - lo))}
    oc = M.predict(X[cal])
    cov_cal["survives"] = float(100 * ((Y[cal, 0] >= oc["survives"][1]) & (Y[cal, 0] <= oc["survives"][2])).mean())
    for t, j in REG_TARGETS.items():
        m, l, h = out[t]
        cov[t] = float(100 * ((yt[:, j] >= l) & (yt[:, j] <= h)).mean())
        width[t] = float(np.mean(h - l))
        mae[t] = float(np.mean(np.abs(m - yt[:, j])))
        cov_cal[t] = float(100 * ((Y[cal, j] >= oc[t][1]) & (Y[cal, j] <= oc[t][2])).mean())
    ind = ~out["ood"]
    cov_ind = {"survives": float(100 * ((yt[ind, 0] >= lo[ind]) & (yt[ind, 0] <= hi[ind])).mean())}
    inn = (yt[:, 0] >= lo) & (yt[:, 0] <= hi)
    cov_cls = {"failures": float(100 * inn[yt[:, 0] == 0].mean()), "survivors": float(100 * inn[yt[:, 0] == 1].mean())}
    for t, j in REG_TARGETS.items():
        m_, l_, h_ = out[t]
        cov_ind[t] = float(100 * ((yt[ind, j] >= l_[ind]) & (yt[ind, j] <= h_[ind])).mean())
    met.update({
        "coverage_test_pct": cov, "coverage_test_in_distribution_pct": cov_ind, "coverage_calibration_pct": cov_cal,
        "coverage_test_by_class_pct": cov_cls,
        "mean_interval_width": width, "mae_test": mae,
        "ece_test": ece(p, yt[:, 0]), "ece_calibration": ece(oc["survives"][0], Y[cal, 0]),
        "auroc_test": float(roc_auc_score(yt[:, 0], p)),
        "accuracy_test_pct": float(100 * ((p > 0.5) == (yt[:, 0] > 0.5)).mean()),
        "brier_test": float(np.mean((p - yt[:, 0]) ** 2)),
        "ood_flag_rate_test_site_pct": float(100 * out["ood"].mean()),
        "ood_flag_rate_calibration_pct": float(100 * oc["ood"].mean()),
        "ms_per_run_simulate": ms_sim, "ms_per_run_surrogate_model": ms_model, "ms_per_run_features": ms_feat,
        "speedup_model_only": ms_sim / ms_model, "speedup_end_to_end": ms_sim / (ms_model + ms_feat),
    })
    # confident-accept accuracy (what the gate relies on)
    _, log, hig = out["survives_gate"]
    met["coverage_test_gate_interval_pct"] = float(100 * ((yt[:, 0] >= log) & (yt[:, 0] <= hig)).mean())
    met["mean_interval_width"]["survives_gate"] = float(np.mean(hig - log))
    conf = (ind) & ((log > 0.5) | (hig < 0.5))
    met["ai_confident_share_test_pct"] = float(100 * conf.mean())
    met["ai_confident_accuracy_test_pct"] = float(100 * ((p[conf] > 0.5) == (yt[conf, 0] > 0.5)).mean()) if conf.any() else None
    # OOD recall on deliberately shifted sets (built from held-out-site rows)
    rec = {}
    for kind in ["battery_x3_panel_x2", "horizon_plus_8deg", "load_x3"]:
        rec[kind] = float(100 * M.predict(shifted(X[test], kind))["ood"].mean())
    rec_tr = {kind: float(100 * M.predict(shifted(X[cal], kind))["ood"].mean())
              for kind in ["battery_x3_panel_x2", "horizon_plus_8deg", "load_x3"]}
    met["ood_recall_shifted_test_pct"] = rec
    met["ood_recall_shifted_calibration_pct"] = rec_tr
    joblib.dump(M, os.path.join(C.AI_OUT, "survivor.joblib"))
    with open(os.path.join(C.AI_OUT, "survivor_metrics.json"), "w") as f:
        json.dump(met, f, indent=1)
    print(json.dumps(met, indent=1))


if __name__ == "__main__":
    main()
