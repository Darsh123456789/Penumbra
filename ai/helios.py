"""HELIOS — neural horizon field, one model per site.

(x, y) map metres -> real Fourier coefficients of the 360-bin horizon -> 360 bins via a fixed
inverse-DFT basis. Gaussian Fourier-feature encoding + MLP (PyTorch, CPU).
Loss: L1 on reconstructed elevations, x5 weight for bins whose TRUE elevation is in [-2, +8] deg.
Held-out test: whole 16x16-point tiles (5 of the 36 tiles = 13.9% of each site), never random points.

Usage: python ai/helios.py [steps]        -> ai/out/helios_<site>.pt, ai/out/helios_metrics.json
"""
import json
import os
import sys
import time

import numpy as np
import torch
from scipy.interpolate import griddata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

torch.set_num_threads(2)
N_HARM = 64                         # harmonics 0..63 -> 1 + 2*63 = 127 real coefficients
N_TEST_TILES = 5
SIGMA = float(os.environ.get("HELIOS_SIGMA", 0.5))   # chosen on validation tiles (see model card)
N_FREQ, WIDTH, DEPTH = 256, 256, 4


def basis(n_harm=N_HARM):
    az = (np.arange(360) + 0.5) * np.pi / 180      # bin k centred on k+0.5 deg (constant phase, harmless)
    rows = [np.ones(360)]
    for m in range(1, n_harm):
        rows += [np.cos(m * az), np.sin(m * az)]
    return np.array(rows)                           # (127, 360)


def split_tiles(seed):
    rng = np.random.default_rng(seed)
    tiles = rng.choice(36, N_TEST_TILES, replace=False)
    ii, jj = np.divmod(np.arange(9216), 96)          # row (y), col (x)
    tile = (ii // 16) * 6 + (jj // 16)
    return np.isin(tile, tiles), sorted(tiles.tolist())


class Field(torch.nn.Module):
    def __init__(self, n_out, sigma):
        super().__init__()
        g = torch.Generator().manual_seed(0)
        self.register_buffer("B", torch.randn(2, N_FREQ, generator=g) * sigma)
        layers, d = [], 2 * N_FREQ + 2
        for _ in range(DEPTH):
            layers += [torch.nn.Linear(d, WIDTH), torch.nn.SiLU()]
            d = WIDTH
        layers += [torch.nn.Linear(d, n_out)]
        self.mlp = torch.nn.Sequential(*layers)

    def forward(self, xy):
        p = 2 * np.pi * xy @ self.B
        return self.mlp(torch.cat([xy, torch.sin(p), torch.cos(p)], 1))


def agreement(H_true, H_pred, lat, lon, ets):
    """Share of 2027 hourly Sun positions where 'Sun centre above horizon' agrees."""
    agree = total = 0
    n_lit = n_lit_agree = 0
    for k in range(len(H_true)):
        saz, sel, _, _ = C.S.sky(float(lat[k]), float(lon[k]), ets)
        a = sel > C.S.horizon_at(H_true[k], saz)
        b = sel > C.S.horizon_at(H_pred[k], saz)
        agree += (a == b).sum(); total += len(a)
        near = np.abs(sel - C.S.horizon_at(H_true[k], saz)) < 2.0
        n_lit += near.sum(); n_lit_agree += (a == b)[near].sum()
    return 100 * agree / total, 100 * n_lit_agree / max(n_lit, 1)


def run_site(s, steps, seed):
    d = C.site(s)
    H = d["horizon"].astype(np.float32)
    x, y = d["x"], d["y"]
    xy = np.stack([(x - x.mean()) / (x.max() - x.min()) * 2, (y - y.mean()) / (y.max() - y.min()) * 2], 1)
    test, tiles = split_tiles(seed)
    tr = ~test
    if os.environ.get("HELIOS_VAL"):          # model selection: 5 validation tiles from the TRAINING area only
        rng = np.random.default_rng(seed + 100)
        cand = [t for t in range(36) if t not in tiles]
        vt = rng.choice(cand, N_TEST_TILES, replace=False)
        ii, jj = np.divmod(np.arange(9216), 96)
        val = np.isin((ii // 16) * 6 + (jj // 16), vt)
        test, tr, tiles = val, tr & ~val, sorted(vt.tolist())
    Bm = basis()
    coef = np.linalg.lstsq(Bm.T, H.T, rcond=None)[0].T            # (9216, 127) exact projection
    mu, sd = coef[tr].mean(0), coef[tr].std(0) + 1e-3
    Bt = torch.tensor(Bm, dtype=torch.float32)
    X = torch.tensor(xy, dtype=torch.float32)
    Ht = torch.tensor(H)
    W = torch.where((Ht >= -2) & (Ht <= 8), 5.0, 1.0)
    mu_t, sd_t = torch.tensor(mu, dtype=torch.float32), torch.tensor(sd, dtype=torch.float32)
    torch.manual_seed(seed)
    model = Field(Bm.shape[0], SIGMA)
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.05)
    idx = torch.tensor(np.where(tr)[0])
    t0 = time.time()
    for it in range(steps):
        b = idx[torch.randint(len(idx), (2048,))]
        pred = (model(X[b]) * sd_t + mu_t) @ Bt
        loss = (W[b] * (pred - Ht[b]).abs()).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    t_train = time.time() - t0
    model.eval()
    with torch.no_grad():
        Hp = ((model(X) * sd_t + mu_t) @ Bt).numpy()
        # timing: batch inference over the whole grid, best of 5
        tt = []
        for _ in range(5):
            t1 = time.perf_counter(); (model(X) * sd_t + mu_t) @ Bt; tt.append(time.perf_counter() - t1)
    ms_per_pt = 1000 * min(tt) / len(X)
    err = np.abs(Hp[test] - H[test])
    err_tr = np.abs(Hp[tr] - H[tr])
    # baseline: linear interpolation of the stored horizons from surrounding training points
    lin = griddata(np.stack([x[tr], y[tr]], 1), H[tr], np.stack([x[test], y[test]], 1), method="linear")
    nn = griddata(np.stack([x[tr], y[tr]], 1), H[tr], np.stack([x[test], y[test]], 1), method="nearest")
    lin = np.where(np.isnan(lin), nn, lin)
    err_lin = np.abs(lin - H[test])
    et0 = C.g.utc_to_et(C.YEAR0)
    ets = et0 + 3600.0 * np.arange(365 * 24)
    ag, ag_near = agreement(H[test].astype(float), Hp[test].astype(float), d["lat"][test], d["lon"][test], ets)
    ag_lin, _ = agreement(H[test].astype(float), lin.astype(float), d["lat"][test], d["lon"][test], ets)
    torch.save({"state": model.state_dict(), "mu": mu, "sd": sd, "sigma": SIGMA,
                "x_mean": float(x.mean()), "y_mean": float(y.mean()),
                "x_span": float(x.max() - x.min()), "y_span": float(y.max() - y.min())},
               os.path.join(C.AI_OUT, f"helios_{s}.pt"))
    m = {"site": s, "test_tiles": tiles, "train_points": int(tr.sum()), "test_points": int(test.sum()),
         "train_s": round(t_train, 1), "steps": steps, "sigma": SIGMA,
         "test_median_deg": float(np.median(err)), "test_p99_deg": float(np.percentile(err, 99)),
         "train_median_deg": float(np.median(err_tr)), "train_p99_deg": float(np.percentile(err_tr, 99)),
         "agreement_pct": float(ag), "agreement_near_horizon_pct": float(ag_near),
         "ms_per_point": ms_per_pt, "speedup_vs_raycast_14ms": 14.0 / ms_per_pt,
         "baseline_linear_interp": {"median_deg": float(np.median(err_lin)),
                                    "p99_deg": float(np.percentile(err_lin, 99)), "agreement_pct": float(ag_lin)}}
    print(json.dumps(m), flush=True)
    return m


def main():
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 4000
    sites = sys.argv[2].split(",") if len(sys.argv) > 2 else C.SITES
    C.g.load_kernels()
    os.makedirs(C.AI_OUT, exist_ok=True)
    res = [run_site(s, steps, seed=11 + i) for i, s in enumerate(sites)]
    fn = os.path.join(C.AI_OUT, os.environ.get("HELIOS_OUT", "helios_metrics.json"))
    with open(fn, "w") as f:
        json.dump(res, f, indent=1)


if __name__ == "__main__":
    main()
