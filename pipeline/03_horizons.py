"""
Step 3 — Horizon masks + first illumination maps for each demo site.

For every site in SITES: lays a regular grid of analysis points over the 5 m map,
raycasts 360-degree horizons at panel height, then uses the Step 1 ephemeris to
compute, for one year, the fraction of time the Sun is visible (partial disc
counted) and the fraction of time Earth is above the terrain.

Outputs (pipeline/out/ and web/public/data/):
  horizons_<site>.npz      grid coordinates, heights, horizons (float16) for Python
  horizons_<site>.bin      float16 horizons for the browser + horizons_<site>.json metadata
  illum_<site>.png         quick-look maps (sunlight %, Earth %)

Usage:  python pipeline/03_horizons.py [site ...]
"""
import json
import os
import sys
import time

import numpy as np

import geometry as g
import terrain as T

SITES = {
    # key: (PGDA 78 file, NASA name, grid points per side)
    "shackleton": ("Site04_final_adj_5mpp_surf.tif", "Shackleton rim (PGDA 78 Site04)", 96),
    "malapert": ("Site23_final_adj_5mpp_surf.tif", "Malapert massif (PGDA 78 Site23)", 96),
    "leibnitz_beta": ("Site20v2_final_adj_5mpp_surf.tif", "Leibnitz beta plateau, Mons Mouton (PGDA 78 Site20v2)", 96),
}
OBS_H = 2.0                    # m, solar panel height
YEAR = ("2027-01-01T00:00:00", "2028-01-01T00:00:00")
SUN_R, EARTH_R = 0.2666, 0.95  # apparent radii, degrees
OUT = os.path.join(g.HERE, "out")
WEB = os.path.join(os.path.dirname(g.HERE), "web", "public", "data")


def visible_fraction(el, hz, radius):
    return np.clip((el - hz + radius) / (2 * radius), 0.0, 1.0)


def illumination(lat, lon, H, ets, sun, earth):
    """Per-point fraction of time sunlit (partial disc) and with Earth's centre above terrain."""
    n = len(lat)
    sun_pct, earth_pct, both_pct = np.zeros(n), np.zeros(n), np.zeros(n)
    for s in range(0, n, 128):
        sl = slice(s, min(n, s + 128))
        la, lo = np.radians(lat[sl]), np.radians(lon[sl])
        S = g.R_MOON * np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], 1)
        E_ = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], 1)
        N_ = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], 1)
        U_ = S / g.R_MOON
        res = []
        for body in (sun, earth):
            v = body[None, :, :] - S[:, None, :]
            e = np.einsum("ntk,nk->nt", v, E_); nn = np.einsum("ntk,nk->nt", v, N_); u = np.einsum("ntk,nk->nt", v, U_)
            el = np.degrees(np.arctan2(u, np.hypot(e, nn)))
            az = np.degrees(np.arctan2(e, nn)) % 360.0
            b = az - 0.5                                   # bins are centred on a + 0.5 deg
            i0 = np.floor(b).astype(int) % 360; f = b - np.floor(b); i1 = (i0 + 1) % 360
            Hk = H[sl].astype(np.float64)
            rows = np.arange(Hk.shape[0])[:, None]
            hz = Hk[rows, i0] * (1 - f) + Hk[rows, i1] * f
            res.append((el, hz))
        fs = visible_fraction(*res[0], SUN_R)
        fe = (res[1][0] > res[1][1]).astype(float)
        sun_pct[sl] = 100 * fs.mean(1); earth_pct[sl] = 100 * fe.mean(1); both_pct[sl] = 100 * ((fs > 0.5) & (fe > 0)).mean(1)
    return sun_pct, earth_pct, both_pct


def quicklook(key, name, X, Y, Z, sun_pct, earth_pct, n):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.6), constrained_layout=True)
    ext = [X.min() / 1e3, X.max() / 1e3, Y.min() / 1e3, Y.max() / 1e3]
    for a, data, title, cmap in ((ax[0], Z, "Height (m)", "gray"), (ax[1], sun_pct, "Sunlit, % of 2027", "inferno"),
                                 (ax[2], earth_pct, "Earth above terrain, % of 2027", "Blues_r")):
        im = a.imshow(data.reshape(n, n), origin="lower", extent=ext, cmap=cmap)
        a.set_title(title); a.set_xlabel("x (km)"); a.set_ylabel("y (km)")
        fig.colorbar(im, ax=a, shrink=0.85)
    fig.suptitle(f"{name} — panel height {OBS_H:.0f} m, NASA LOLA terrain + JPL DE440")
    fig.savefig(os.path.join(OUT, f"illum_{key}.png"), dpi=110)
    plt.close(fig)


def run(key):
    fname, name, n = SITES[key]
    near, far = T.load(fname)
    b = near.bounds
    m = 300.0  # stay 300 m inside the map edge
    xs, ys = np.linspace(b.left + m, b.right - m, n), np.linspace(b.bottom + m, b.top - m, n)
    X, Y = [a.ravel() for a in np.meshgrid(xs, ys)]
    t = time.time()
    H = T.horizons(near, far, X, Y, OBS_H)
    Z = T.ground_height(near, far, X, Y)
    t_ray = time.time() - t
    lat, lon = T.xy_to_latlon(X, Y)

    d = np.load(os.path.join(OUT, "ephemeris_hourly.npz"))
    e0, e1 = g.utc_to_et(YEAR[0]), g.utc_to_et(YEAR[1])
    sel = (d["et"] >= e0) & (d["et"] < e1)
    sun_pct, earth_pct, both_pct = illumination(lat, lon, H, d["et"][sel], d["sun"][sel], d["earth"][sel])

    best = int(np.argmax(sun_pct))
    np.savez_compressed(os.path.join(OUT, f"horizons_{key}.npz"), x=X, y=Y, z=Z, lat=lat, lon=lon,
                        horizon=H.astype(np.float16), sun_pct=sun_pct, earth_pct=earth_pct, both_pct=both_pct)
    H.astype("<f2").tofile(os.path.join(WEB, f"horizons_{key}.bin"))
    meta = {"site": name, "dem": fname, "far_field": T.FAR_FILE, "grid_n": n, "observer_height_m": OBS_H,
            "x_m": [float(xs[0]), float(xs[-1])], "y_m": [float(ys[0]), float(ys[-1])],
            "azimuth_bins": "360 x 1 deg, bin k centred on k+0.5 deg, clockwise from local north",
            "layout": "little-endian float16, row-major [point, azimuth], points ordered y-major then x",
            "max_range_km": T.MAX_RANGE_M / 1e3,
            "best_sunlit_point": {"lat": float(lat[best]), "lon": float(lon[best]), "z_m": float(Z[best]),
                                  "sun_pct_2027": float(sun_pct[best]), "earth_pct_2027": float(earth_pct[best])}}
    with open(os.path.join(WEB, f"horizons_{key}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    quicklook(key, name, X, Y, Z, sun_pct, earth_pct, n)
    print(f"{key:14s} {len(X):5d} pts, raycast {t_ray:5.1f} s | sunlit 2027: median {np.median(sun_pct):4.1f}%, "
          f"best {sun_pct[best]:4.1f}% at {lat[best]:.3f}, {lon[best]:.2f}E (z={Z[best]:.0f} m), "
          f"Earth there {earth_pct[best]:4.1f}%")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True); os.makedirs(WEB, exist_ok=True)
    g.load_kernels()
    for k in (sys.argv[1:] or SITES):
        run(k)
