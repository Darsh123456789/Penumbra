"""
Step 0 — Which NASA PGDA 78 5 m map covers which landing site?

PGDA product 78 lists its south-pole site maps without coordinates. This script
reads ONLY the header of each GeoTIFF over the internet (a few KB each, no full
download), prints its extent, and says which map contains each target point.

Needs internet. Run on your laptop:   python pipeline/00_find_site_maps.py
"""
import math
import rasterio

BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/{s}/{s}_final_adj_5mpp_surf.tif"
SITES = ["Site01", "Site04", "Site06", "Site07", "Site11", "Site20", "Site20v2", "Site23", "Site42",
         "Haworth", "Shoemaker", "DM1", "DM2", "SL2", "SL3", "NPA", "NPB", "NPC", "NPD",
         "LM1", "LM2", "LM3", "LM4", "LM5", "LM6", "LM7", "LM8"]
TARGETS = {  # (lat, east lon) in degrees
    "IM-2 intended (LROC)": (-84.78, 29.13),
    "IM-2 actual (approx.)": (-84.7906, 29.1957),
    "Mons Mouton summit area": (-84.6, 31.0),
    "Chandrayaan-3 (69.37S, outside all 5 m maps)": (-69.373, 32.319),
}
R = 1737400.0


def to_xy(lat, lon):
    """South polar stereographic (lat_0 = -90, lon_0 = 0, sphere R), metres."""
    rho = 2 * R * math.tan(math.radians(90 + lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def main():
    pts = {k: to_xy(*v) for k, v in TARGETS.items()}
    print(f"{'map':10s} {'x range (km)':>20s} {'y range (km)':>20s}  contains")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3"):
        for s in SITES:
            url = "/vsicurl/" + BASE.format(s=s)
            try:
                with rasterio.open(url) as d:
                    b = d.bounds
            except Exception as e:  # missing or renamed map
                print(f"{s:10s} could not open ({type(e).__name__})")
                continue
            hits = [k for k, (x, y) in pts.items() if b.left <= x <= b.right and b.bottom <= y <= b.top]
            print(f"{s:10s} {b.left/1e3:9.1f} {b.right/1e3:9.1f} {b.bottom/1e3:9.1f} {b.top/1e3:9.1f}  "
                  f"{', '.join(hits) if hits else '-'}")


if __name__ == "__main__":
    main()
