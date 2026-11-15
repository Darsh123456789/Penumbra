"""Assemble web/public/data/ai_model_card.json from the measured metric files in ai/out/.
Nothing here is computed from assumptions: every number is copied from a metrics file written by
helios.py, survivor_train.py or gate_demo.py. Missing files -> status "not_run".

Usage: python ai/make_model_card.py
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI_OUT = os.path.join(ROOT, "ai", "out")
WEB = os.path.join(ROOT, "web", "public", "data")


def load(name):
    p = os.path.join(AI_OUT, name)
    return json.load(open(p)) if os.path.exists(p) else None


def gate(name, target, measured, unit, ok):
    return {"name": name, "target": target, "measured": round(float(measured), 4), "unit": unit, "pass": bool(ok)}


def helios_block(H):
    if not H:
        return {"status": "not_run"}
    med = max(m["test_median_deg"] for m in H)
    p99 = max(m["test_p99_deg"] for m in H)
    ag = min(m["agreement_pct"] for m in H)
    gates = [gate("Horizon error, held-out tiles (median, worst site)", "< 0.05 deg", med, "deg", med < 0.05),
             gate("Horizon error, held-out tiles (p99, worst site)", "< 0.3 deg", p99, "deg", p99 < 0.3),
             gate("Lit/unlit agreement, 2027 hourly Sun (worst site)", "> 99%", ag, "%", ag > 99)]
    sp = min(m["speedup_vs_raycast_14ms"] for m in H)
    return {"status": "passed" if all(g["pass"] for g in gates) else "failed",
            "architecture": f"Per-site Gaussian Fourier features (256 freq, sigma {H[0]['sigma']}) + 4x256 SiLU MLP -> "
                            "127 real Fourier coefficients (harmonics 0-63) -> 360 bins; weighted L1 (x5 in -2..+8 deg)",
            "train_points": sum(m["train_points"] for m in H), "test_points": sum(m["test_points"] for m in H),
            "test_split": "5 of 36 whole 16x16-point tiles per site held out (13.9%), never random points",
            "gates": gates, "speedup_vs_exact": round(sp, 1),
            "speedup_note": "vs the stored raycast cost of ~14 ms/point (2 CPU cores); HELIOS timed as batch inference on CPU",
            "per_site": [{k: m[k] for k in ["site", "test_median_deg", "test_p99_deg", "agreement_pct",
                                            "agreement_near_horizon_pct", "ms_per_point", "baseline_linear_interp"]}
                         for m in H],
            "fourier_floor_note": "Truncating the true horizons to 32 real coefficients alone gives a 0.055-0.071 deg "
                                  "median error, so 127 coefficients are used (truncation floor 0.011-0.015 deg)."}


def survivor_block(S):
    if not S:
        return {"status": "not_run"}
    cov = S["coverage_test_pct"]
    gates = [gate("Conformal coverage, held-out site: P(survive) 90% interval", "90% ± 2%", cov["survives"], "%",
                  abs(cov["survives"] - 90) <= 2),
             gate("Conformal coverage, held-out site: sunlit_pct", "90% ± 2%", cov["sunlit_pct"], "%",
                  abs(cov["sunlit_pct"] - 90) <= 2),
             gate("Conformal coverage, held-out site: longest_blackout_h", "90% ± 2%", cov["longest_blackout_h"], "%",
                  abs(cov["longest_blackout_h"] - 90) <= 2),
             gate("Conformal coverage, held-out site: hours_to_floor", "90% ± 2%", cov["hours_to_floor"], "%",
                  abs(cov["hours_to_floor"] - 90) <= 2),
             gate("Expected calibration error of P(survive), held-out site", "< 0.03", S["ece_test"], "", S["ece_test"] < 0.03)]
    info = [gate("AUROC, held-out site", "report", S["auroc_test"], "", True),
            gate("OOD recall, shifted set: battery x3 + panel x2", "report", S["ood_recall_shifted_test_pct"]["battery_x3_panel_x2"], "%", True),
            gate("OOD recall, shifted set: horizon +8 deg", "report", S["ood_recall_shifted_test_pct"]["horizon_plus_8deg"], "%", True),
            gate("OOD recall, shifted set: load x3", "report", S["ood_recall_shifted_test_pct"]["load_x3"], "%", True),
            gate("Accuracy of AI-accepted runs, held-out site", "report", S["ai_confident_accuracy_test_pct"], "%", True)]
    return {"status": "passed" if all(g["pass"] for g in gates) else "failed",
            "architecture": "5-model LightGBM ensemble per target (P(survive) isotonic-calibrated; sunlit_pct, "
                            "longest_blackout_h, hours_to_floor L1 regressors); normalised split conformal "
                            "(Mondrian for the 0/1 label); kNN OOD flag",
            "train_runs": S["train_runs"], "test_runs": S["test_runs"],
            "test_split": "train on shackleton + malapert (split by grid point: 70% fit / 10% isotonic / 20% conformal "
                          "calibration); test on every leibnitz_beta run (site never seen)",
            "gates": gates, "info_metrics": info,
            "speedup_vs_exact": round(S["speedup_end_to_end"], 2),
            "speedup_note": f"end-to-end incl. feature extraction ({S['ms_per_run_simulate']:.2f} ms simulate vs "
                            f"{S['ms_per_run_surrogate_model'] + S['ms_per_run_features']:.2f} ms surrogate); "
                            f"model only {S['speedup_model_only']:.1f}x",
            "ood_flag_rate_test_site_pct": round(S["ood_flag_rate_test_site_pct"], 2),
            "ai_accept_share_test_pct": round(S["ai_confident_share_test_pct"], 2)}


def main():
    H, S = load("helios_metrics.json"), load("survivor_metrics.json")
    gates = [g for g in (load(f"gate_{s}.json") for s in ["shackleton", "malapert", "leibnitz_beta"]) if g]
    keys = ["site", "candidates_scored", "sent_to_exact", "accepted_by_ai", "top_pick_changed_after_verification"]
    ga = {k: gates[0][k] for k in keys} if gates else {"site": "shackleton", "status": "not_run"}
    card = {"generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "helios": helios_block(H), "survivor": survivor_block(S), "gate_activity": ga,
            "gate_activity_all_sites": [{k: g[k] for k in keys} for g in gates]}
    with open(os.path.join(WEB, "ai_model_card.json"), "w") as f:
        json.dump(card, f, indent=1)
    print(json.dumps(card, indent=1))


if __name__ == "__main__":
    main()
