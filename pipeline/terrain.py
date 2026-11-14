"""
Step 2 — Terrain: load NASA LOLA DEMs and raycast horizons.

Both DEM layers share NASA's south polar stereographic grid
(lat_0 = -90, lon_0 = 0, sphere R = 1737.4 km, MOON_ME frame), so no reprojection
is needed:
  * near field: PGDA 78 site map, 5 m/pixel (used wherever a ray sample lies inside it)
  * far field : PGDA 90 80-90 S map, 80 m/pixel (everything else, out to MAX_RANGE)

Heights are metres above the 1737.4 km reference sphere.

Horizon method (after Mazarico et al. 2011): from an observer at height h above the
terrain, march outwards along 360 azimuths and keep the largest elevation angle of
any terrain sample. Elevation angles are computed exactly in 3-D Moon-fixed
Cartesian coordinates, so lunar curvature is included with no approximation.
"""
import math
import os

import numpy as np
import rasterio
from numba import njit, prange

R_M = 1737400.0
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("PENUMBRA_DATA", os.path.join(os.path.dirname(HERE), "data", "dem"))
FAR_FILE = "LDEM_80S_80MPP_ADJ.tiff"
MAX_RANGE_M = 200_000.0
N_AZ = 360


class DEM:
    """A pixel-registered GeoTIFF grid in metres."""

    def __init__(self, path):
        with rasterio.open(path) as d:
            self.z = d.read(1).astype(np.float32)
            t = d.transform
            self.x0, self.y0, self.dx = t.c, t.f, t.a        # outer corner of the top-left pixel
            self.bounds = d.bounds
            self.name = os.path.basename(path)
        self.z[~np.isfinite(self.z)] = np.nan

    def params(self):
        return self.z, self.x0, self.y0, self.dx


def load(site_file):
    near = DEM(os.path.join(DATA, site_file))
    far = DEM(os.path.join(DATA, FAR_FILE))
    return near, far


# ---------------------------------------------------------------- numba kernels

OUTSIDE = -1.0e30  # sentinel for "sample is outside this map" (NaN checks are unsafe under fastmath)


@njit(cache=True)
def _bilinear(z, x0, y0, dx, x, y):
    c = (x - x0) / dx - 0.5
    r = (y0 - y) / dx - 0.5
    i, j = int(math.floor(r)), int(math.floor(c))
    if i < 0 or j < 0 or i >= z.shape[0] - 1 or j >= z.shape[1] - 1:
        return OUTSIDE
    fr, fc = r - i, c - j
    return (z[i, j] * (1 - fr) * (1 - fc) + z[i, j + 1] * (1 - fr) * fc
            + z[i + 1, j] * fr * (1 - fc) + z[i + 1, j + 1] * fr * fc)


@njit(cache=True)
def _height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, x, y):
    h = _bilinear(nz, nx0, ny0, ndx, x, y)
    if h <= OUTSIDE:  # outside the near-field map -> use the far-field map
        h = _bilinear(fz, fx0, fy0, fdx, x, y)
    return h


@njit(cache=True, fastmath=True)
def _cart(x, y, z_m):
    """Stereographic (x, y) + height -> Moon-fixed Cartesian, metres."""
    rho = math.sqrt(x * x + y * y)
    c = 2.0 * math.atan(rho / (2.0 * R_M))           # colatitude from the south pole
    lat = -(math.pi / 2 - c)
    lon = math.atan2(x, y)
    r = R_M + z_m
    return (r * math.cos(lat) * math.cos(lon), r * math.cos(lat) * math.sin(lon), r * math.sin(lat))


@njit(parallel=True, cache=True)
def raycast(px, py, obs_h, nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, max_range):
    """Horizon elevation (deg) for each observer and each 1-degree azimuth bin.

    Azimuth is clockwise from local north (towards east). In this projection local
    north at (x, y) points away from the pole, along (x, y)/rho, and local east is
    (y, -x)/rho; the projection is conformal, so map directions equal local azimuths.
    """
    n = px.shape[0]
    out = np.full((n, N_AZ), -90.0, dtype=np.float32)
    for k in prange(n):
        x, y = px[k], py[k]
        z0 = _height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, x, y) + obs_h
        P = _cart(x, y, z0)
        pr = math.sqrt(P[0] ** 2 + P[1] ** 2 + P[2] ** 2)
        U = (P[0] / pr, P[1] / pr, P[2] / pr)
        rho = math.sqrt(x * x + y * y)
        nxm, nym = x / rho, y / rho                    # local north in map plane
        exm, eym = y / rho, -x / rho                   # local east in map plane
        for a in range(N_AZ):
            A = math.radians(a + 0.5)
            dxm = math.cos(A) * nxm + math.sin(A) * exm
            dym = math.cos(A) * nym + math.sin(A) * eym
            best = -90.0
            d = ndx
            while d < max_range:
                sx, sy = x + dxm * d, y + dym * d
                h = _height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, sx, sy)
                if h > OUTSIDE:
                    Q = _cart(sx, sy, h)
                    vx, vy, vz = Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]
                    vr = math.sqrt(vx * vx + vy * vy + vz * vz)
                    e = math.degrees(math.asin((vx * U[0] + vy * U[1] + vz * U[2]) / vr))
                    if e > best:
                        best = e
                # 5 m steps close in, then 1% of range (about 0.6 deg of arc resolution)
                d += max(ndx, 0.01 * d) if d < 500.0 else max(0.01 * d, ndx)
            out[k, a] = best
    return out


def horizons(near, far, xs, ys, obs_h=2.0, max_range=MAX_RANGE_M):
    nz, nx0, ny0, ndx = near.params()
    fz, fx0, fy0, fdx = far.params()
    return raycast(np.asarray(xs, np.float64), np.asarray(ys, np.float64), float(obs_h),
                   nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, float(max_range))


def ground_height(near, far, xs, ys):
    nz, nx0, ny0, ndx = near.params()
    fz, fx0, fy0, fdx = far.params()
    return np.array([_height(nz, nx0, ny0, ndx, fz, fx0, fy0, fdx, float(x), float(y)) for x, y in zip(xs, ys)])


def xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = -(90.0 - np.degrees(2 * np.arctan(rho / (2 * R_M))))
    lon = np.degrees(np.arctan2(x, y)) % 360.0
    return lat, lon


def latlon_to_xy(lat, lon):
    rho = 2 * R_M * np.tan(np.radians(90.0 + np.asarray(lat)) / 2)
    return rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))
