"""
PENUMBRA shared geometry helpers.

Conventions (used everywhere in the pipeline and mirrored in the web engine):
  * Body-fixed frame: MOON_ME (mean Earth / polar axis), the frame of LOLA topography.
  * The Moon is treated as a sphere of radius R_MOON for site positions; terrain heights
    are added to this radius in later steps.
  * Latitude is planetocentric, longitude is EAST-positive, both in degrees.
  * Local frame at a site: East-North-Up (ENU). Azimuth is measured from local north,
    clockwise towards east (0 = N, 90 = E). Elevation is above the local horizontal plane.
  * Sun/Earth vectors come from SPICE with aberration correction 'LT+S' (apparent
    direction), observer = Moon centre. The direction from a site is (body - site).
    There is no atmosphere, so no refraction is ever applied.
"""
import os
import numpy as np
import spiceypy as sp

R_MOON = 1737.4  # km, IAU / LOLA reference radius
HERE = os.path.dirname(os.path.abspath(__file__))
KERNEL_DIR = os.path.join(HERE, "kernels")
FRAME = "MOON_ME"
ABCORR = "LT+S"


def load_kernels():
    """Load the meta-kernel (relative paths inside it resolve from KERNEL_DIR)."""
    cwd = os.getcwd()
    try:
        os.chdir(KERNEL_DIR)
        sp.kclear()
        sp.furnsh("penumbra.tm")
    finally:
        os.chdir(cwd)


def site_vector(lat_deg, lon_deg, alt_km=0.0):
    """Moon-fixed Cartesian position (km) of a site on the reference sphere + altitude."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    r = R_MOON + alt_km
    return np.array([r * np.cos(lat) * np.cos(lon),
                     r * np.cos(lat) * np.sin(lon),
                     r * np.sin(lat)])


def enu_matrix(lat_deg, lon_deg):
    """3x3 matrix whose rows are the local East, North, Up unit vectors in MOON_ME."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return np.vstack([east, north, up])


def az_el(vec_from_site, M):
    """Azimuth/elevation in degrees for one or many vectors (N,3) seen from a site."""
    v = np.atleast_2d(vec_from_site) @ M.T          # -> (E, N, U)
    rng = np.linalg.norm(v, axis=1)
    el = np.degrees(np.arcsin(np.clip(v[:, 2] / rng, -1, 1)))
    az = np.degrees(np.arctan2(v[:, 0], v[:, 1])) % 360.0
    return az, el


def body_vectors(ets, body):
    """Apparent body position (km) relative to the Moon centre in MOON_ME, shape (N,3)."""
    pos, _ = sp.spkpos(body, list(np.atleast_1d(ets)), FRAME, ABCORR, "MOON")
    return np.asarray(pos)


def utc_to_et(utc):
    return sp.str2et(utc)


def et_to_utc(et, prec=0):
    return sp.et2utc(et, "ISOC", prec)
