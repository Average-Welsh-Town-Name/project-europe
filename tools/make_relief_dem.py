#!/usr/bin/env python3
"""
Shaded relief for the Hegemony map — from Doug's real DEM.

`topographyeurope.png` is a 1442×500 equirectangular topo/bathymetric map. Its
bounds were FITTED, not assumed: rasterising Natural Earth's coastline into the
frame and sliding the corners until the two agree (96.9%) gives

    lon −82.63 .. 69.45      lat 24.555 .. 77.5      sea level at grey 144

The chart itself is a stretched Mercator (fitted from 70 cities):

    x = 22.6926·lon + 649.782        y = −1107.4408·merc(lat) + 1748.683

So every output pixel walks: chart (x,y) → (lon,lat) → DEM pixel. Real Alps,
real Carpathians, real Norwegian coast — the synthetic ranges are retired.

The DEM is small for a 3420-wide plate, so cubic upsampling is re-detailed with
ridged noise whose amplitude follows the REAL local relief: rough where the DEM
is rough, calm on the plains. The noise adds texture, never geography.

Outputs the same four elevation bands the game already stacks for parallax.
"""
import json, math, os
import numpy as np
from PIL import Image
from scipy import ndimage

GEO = '/home/claude/geo'
OUT = '/home/claude/art/relief_europe.webp'

fit = json.load(open(f'{GEO}/topo_fit.json'))
LON0, LON1, LAT0, LAT1, SEA = fit['lon0'], fit['lon1'], fit['lat0'], fit['lat1'], fit['sea']

AX, BX = 22.6926, 649.782
AY, BY = -1107.4408, 1748.683
SVG_W, SVG_H = 1710.0, 1212.0
SS = 2
W, H = int(SVG_W * SS), int(SVG_H * SS)

dem = np.asarray(Image.open(f'{GEO}/topographyeurope.png').convert('L'), dtype=np.float32)
DH, DW = dem.shape
print(f'DEM {DW}x{DH}, sea at grey {SEA}, bounds lon {LON0:.2f}..{LON1:.2f} lat {LAT0:.2f}..{LAT1:.2f}')

# ---- THE COAST IS NOT THE DEM'S TO DECIDE ---------------------------------
# A single grey threshold cannot draw a coastline: the North Sea shelf and the
# Danish straits are so shallow that their bathymetry sits ABOVE any threshold
# that gets the deep coasts right — which is how England grew a land bridge to
# the Lowlands and Denmark lost its shape. So the coastline comes from Natural
# Earth's vectors, drawn through the chart's own projection (exactly as the
# synthetic relief did, and its Denmark was right), and the DEM's job is only
# the HEIGHTS on that land.
from PIL import ImageDraw

def merc_s(lat):
    lat = np.clip(lat, -84.0, 84.0)
    return np.log(np.tan(np.radians(45.0 + lat / 2.0)))

def project(lon_a, lat_a):
    return (AX * np.asarray(lon_a) + BX) * SS, (AY * merc_s(np.asarray(lat_a)) + BY) * SS

def ne_land_mask(w, h):
    feats = json.load(open(f'{GEO}/ne_50m_land.geojson'))['features']
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    for f in feats:
        g = f['geometry']
        polys = [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]
        for ring in polys:
            a = np.asarray(ring, dtype=float)
            px, py = project(a[:, 0], a[:, 1])
            if px.max() < 0 or px.min() > w or py.max() < 0 or py.min() > h: continue
            d.polygon(list(zip(px.tolist(), py.tolist())), fill=255)
    return np.asarray(img) > 127

# ---- chart pixel -> DEM pixel, exactly ------------------------------------
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
lon = (xs / SS - BX) / AX
m = (ys / SS - BY) / AY
lat = np.degrees(2.0 * np.arctan(np.exp(m)) - math.pi / 2.0)
du = (lon - LON0) / (LON1 - LON0) * (DW - 1)
dv = (LAT1 - lat) / (LAT1 - LAT0) * (DH - 1)
inside = (du >= 0) & (du <= DW - 1) & (dv >= 0) & (dv <= DH - 1)
grey = ndimage.map_coordinates(dem, [np.clip(dv, 0, DH - 1), np.clip(du, 0, DW - 1)],
                               order=3, mode='nearest').reshape(H, W)
grey = np.where(inside, grey, SEA - 20.0)      # off the DEM: open sea

# ---- grey -> metres --------------------------------------------------------
# Land runs SEA..max. Mont Blanc is the tallest thing on this chart, so the top
# of the land range is pinned near 4800m. Below SEA is bathymetry (kept only to
# find the coast; the sea stays transparent for the living water).
top = float(dem.max())
hgt = np.clip((grey - SEA) / max(1.0, (top - SEA)), 0, 1) ** 1.35 * 4800.0
land = ne_land_mask(W, H)                     # the real coastline, not a threshold
hgt = hgt * land                              # shallow shelf inside the coast: height ~0, which is true
land_soft = ndimage.gaussian_filter(land.astype(np.float32), 1.6)

# ---- re-detail the upsampled ground ---------------------------------------
rng = np.random.default_rng(20260819)
def value_noise(shape, cells):
    g = rng.random((cells, cells)).astype(np.float32)
    return ndimage.zoom(g, (shape[0] / cells, shape[1] / cells), order=3)[:shape[0], :shape[1]]
def ridged(shape, octaves, cells0):
    out = np.zeros(shape, dtype=np.float32); amp, cells, tot = 1.0, cells0, 0.0
    for _ in range(octaves):
        n = value_noise(shape, max(2, int(cells)))
        r = 1.0 - np.abs(n * 2.0 - 1.0)
        out += amp * r * r; tot += amp; amp *= 0.5; cells *= 2.0
    return out / tot

# where the REAL ground is rough — drives how much texture is allowed
gy, gx = np.gradient(ndimage.gaussian_filter(hgt, 4.0))
rough = np.hypot(gx, gy)
rough = np.clip(rough / max(1e-6, np.percentile(rough[land], 97)), 0, 1)
rough = ndimage.gaussian_filter(rough, 6.0)

fine = ridged((H, W), 5, 90)
hgt = hgt + (fine - 0.45) * 420.0 * rough
grain = ridged((H, W), 3, 380)
hgt = hgt + (grain - 0.5) * 90.0 * (0.2 + 0.8 * rough)
hgt = np.clip(hgt, 0, None) * land
print(f'height: max {hgt.max():.0f} m, mean on land {hgt[land].mean():.0f} m')

# ---- hillshade -------------------------------------------------------------
Z = 0.0065
gy, gx = np.gradient(hgt.astype(np.float32)); gx *= Z; gy *= Z
slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gy, gx)
az, alt = math.radians(315.0), math.radians(45.0)
shade = np.clip(np.sin(alt) * np.cos(slope) +
                np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
ao = 1.0 - 0.35 * np.clip(ndimage.gaussian_filter(hgt, 9) - hgt, 0, 600) / 600.0
shade = np.clip(shade * ao, 0, 1)

# ---- tint ------------------------------------------------------------------
stops = [(0,    (126, 158,  96)),
         (300,  (156, 168,  96)),
         (800,  (190, 172, 106)),
         (1500, (176, 132,  80)),
         (2400, (142, 104,  74)),
         (3200, (156, 146, 140)),
         (4000, (240, 242, 246))]
tint_h = np.clip(ndimage.gaussian_filter(hgt, 2.0), 0, stops[-1][0]) * land
rgb = np.zeros((H, W, 3), dtype=np.float32)
for (h0, c0), (h1, c1) in zip(stops, stops[1:]):
    msk = (tint_h >= h0) & (tint_h <= h1)
    if not msk.any(): continue
    t = ((tint_h[msk] - h0) / max(1e-6, (h1 - h0)))[:, None]
    rgb[msk] = np.asarray(c0, np.float32) * (1 - t) + np.asarray(c1, np.float32) * t
rgb *= (0.40 + 1.08 * shade)[:, :, None]
sea_c = np.asarray([123, 160, 194], np.float32)
land_a = np.clip((land_soft - 0.45) * 3.2, 0, 1)[:, :, None]
rgb = rgb * land_a + sea_c * (1 - land_a)
land_alpha = np.clip((land_soft - 0.45) * 3.2, 0, 1)

# ---- the four parallax bands ----------------------------------------------
BANDS = [('base', 0, 0), ('b1', 320, 1), ('b2', 950, 2), ('b3', 1900, 3)]
total = 0
for name, floor, lift in BANDS:
    if floor <= 0: a = land_alpha
    else:
        a = np.clip((tint_h - floor) / 260.0, 0, 1) * land_alpha
        a = ndimage.gaussian_filter(a.astype(np.float32), 1.5)
    rgba = np.dstack([np.clip(rgb, 0, 255), a * 255.0]).astype(np.uint8)
    path = OUT.replace('.webp', f'_{name}.webp')
    Image.fromarray(rgba, 'RGBA').save(path, quality=80, method=5)
    sz = os.path.getsize(path); total += sz
    print(f'  {name:5s} floor {floor:5d}m  {sz/1e6:.2f} MB')
print(f'{len(BANDS)} bands, {total/1e6:.2f} MB, {W}x{H}')
