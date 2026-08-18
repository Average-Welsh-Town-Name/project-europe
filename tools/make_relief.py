#!/usr/bin/env python3
"""
Shaded relief for the Hegemony map, in the map's OWN projection.

The map turned out to be a Mercator — a stretched one. Fitting 70 cities whose
real latitude and longitude are known gives

    x = 22.6926 * lon               + 649.782
    y = -1107.4408 * mercator(lat)  + 1748.683

with a mean error of about 8px across a 1710-unit-wide chart. The two scales are
not equal (1300 vs 1107 per radian), so it is a Mercator stretched 17% in
longitude — which is why a bought raster would never have lined up, and why this
one is drawn through that exact transform instead.

The relief itself is built from Natural Earth's public-domain vectors: 222 named
mountain-range polygons for WHERE the high ground is, and named elevation points
for HOW high. Each range becomes a mound whose height is its tallest peak, and
ridged fractal noise breaks the mounds into something that reads as rock rather
than as a blob. Everything is masked to real coastline.

Output: art/relief_europe.jpg
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

GEO = '/home/claude/geo'
OUT = '/home/claude/art/relief_europe.webp'

# ---- the map's projection -------------------------------------------------
AX, BX = 22.6926, 649.782
AY, BY = -1107.4408, 1748.683
SVG_W, SVG_H = 1710.0, 1212.0
SS = 2                      # render at twice the chart's own units
W, H = int(SVG_W * SS), int(SVG_H * SS)

def merc(lat):
    lat = np.clip(lat, -84.0, 84.0)
    return np.log(np.tan(np.radians(45.0 + lat / 2.0)))

def project(lon, lat):
    return (AX * np.asarray(lon) + BX) * SS, (AY * merc(np.asarray(lat)) + BY) * SS

def bounds_lonlat():
    lon0, lon1 = (0 - BX) / AX, (SVG_W - BX) / AX
    def inv_y(y):
        m = (y - BY) / AY
        return math.degrees(2 * math.atan(math.exp(m)) - math.pi / 2)
    return lon0, lon1, inv_y(SVG_H), inv_y(0)

LON0, LON1, LAT0, LAT1 = bounds_lonlat()
print(f'chart covers lon {LON0:.1f}..{LON1:.1f}, lat {LAT0:.1f}..{LAT1:.1f}')

def load(name):
    with open(f'{GEO}/{name}.geojson') as f:
        return json.load(f)['features']

def rings(geom):
    """Every outer ring of a (Multi)Polygon, as lon/lat arrays."""
    t, c = geom['type'], geom['coordinates']
    if t == 'Polygon':
        yield np.asarray(c[0], dtype=float)
    elif t == 'MultiPolygon':
        for poly in c:
            yield np.asarray(poly[0], dtype=float)

def lines(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'LineString':
        yield np.asarray(c, dtype=float)
    elif t == 'MultiLineString':
        for ln in c:
            yield np.asarray(ln, dtype=float)

def draw_rings(size, feats, scale=1.0):
    """Rasterise polygon rings into a boolean mask at `scale` of full size."""
    w, h = int(size[0] * scale), int(size[1] * scale)
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    n = 0
    for f in feats:
        for ring in rings(f['geometry']):
            if ring.size == 0:
                continue
            px, py = project(ring[:, 0], ring[:, 1])
            px, py = px * scale, py * scale
            if px.max() < 0 or px.min() > w or py.max() < 0 or py.min() > h:
                continue
            d.polygon(list(zip(px.tolist(), py.tolist())), fill=255)
            n += 1
    return np.asarray(img) > 127, n

# ---------------------------------------------------------------------------
# 1. LAND
# ---------------------------------------------------------------------------
land_f = load('ne_50m_land')
LOW = 0.5                                   # the height field is built at half res
land_lo, nland = draw_rings((W, H), land_f, LOW)
print(f'land rings drawn: {nland}, land pixels: {land_lo.mean()*100:.1f}%')

# ---------------------------------------------------------------------------
# 2. WHERE THE HIGH GROUND IS  — real ranges, real peaks
# ---------------------------------------------------------------------------
regions = load('ne_10m_geography_regions_polys')
ranges = [f for f in regions if str(f['properties'].get('FEATURECLA')) == 'Range/mtn']
# Plateaux and uplands are not mountains, but they are not the North Sea either —
# the Meseta, the Massif Central, the Volga and Central Russian uplands all read
# as flat green without them.
plateaux = [f for f in regions if str(f['properties'].get('FEATURECLA')) in ('Plateau', 'Foothills')]
peaks = load('ne_10m_elev')

# peak lon/lat/elevation, only the ones on our chart
pts = []
for f in peaks:
    g = f['geometry']
    if g['type'] != 'Point':
        continue
    lon, lat = g['coordinates'][0], g['coordinates'][1]
    if not (LON0 - 5 < lon < LON1 + 5 and LAT0 - 5 < lat < LAT1 + 5):
        continue
    p = f['properties']
    el = p.get('elevation') or p.get('ELEVATION') or 0
    try:
        el = float(el)
    except Exception:
        el = 0.0
    pts.append((lon, lat, el, p.get('name') or p.get('NAME') or ''))
print(f'elevation points on chart: {len(pts)}')

hi = np.zeros((int(H * LOW), int(W * LOW)), dtype=np.float32)
used = 0
for f in ranges:
    name = f['properties'].get('NAME') or ''
    ring_list = [r for r in rings(f['geometry']) if r.size]
    if not ring_list:
        continue
    all_lon = np.concatenate([r[:, 0] for r in ring_list])
    all_lat = np.concatenate([r[:, 1] for r in ring_list])
    if all_lon.max() < LON0 - 3 or all_lon.min() > LON1 + 3: continue
    if all_lat.max() < LAT0 - 3 or all_lat.min() > LAT1 + 3: continue

    # the tallest named peak inside this range's bounding box sets its height
    lo_lon, hi_lon = all_lon.min(), all_lon.max()
    lo_lat, hi_lat = all_lat.min(), all_lat.max()
    inside = [e for (lo, la, e, nm) in pts if lo_lon <= lo <= hi_lon and lo_lat <= la <= hi_lat]
    peak_m = max(inside) if inside else 0.0
    if peak_m <= 0:
        peak_m = 1400.0                        # an unnamed range is still a range
    peak_m = min(peak_m, 5800.0)

    mask, _ = draw_rings((W, H), [f], LOW)
    if not mask.any():
        continue
    # A mound, not a plateau: distance from the range's edge, normalised, so the
    # spine stands up and the foothills fall away.
    d = ndimage.distance_transform_edt(mask).astype(np.float32)
    if d.max() <= 0:
        continue
    d /= d.max()
    # A range is not its tallest peak from end to end — the summit ridge runs
    # well below the one summit everybody names.
    mound = np.sqrt(d) * float(peak_m) * 0.62
    np.maximum(hi, mound, out=hi)              # ranges overlap; take the taller
    used += 1
print(f'ranges raised: {used}')

up = 0
for f in plateaux:
    ring_list = [r for r in rings(f['geometry']) if r.size]
    if not ring_list: continue
    all_lon = np.concatenate([r[:, 0] for r in ring_list])
    all_lat = np.concatenate([r[:, 1] for r in ring_list])
    if all_lon.max() < LON0 - 3 or all_lon.min() > LON1 + 3: continue
    if all_lat.max() < LAT0 - 3 or all_lat.min() > LAT1 + 3: continue
    mask, _ = draw_rings((W, H), [f], LOW)
    if not mask.any(): continue
    d = ndimage.distance_transform_edt(mask).astype(np.float32)
    if d.max() <= 0: continue
    d = np.clip(d / max(1.0, d.max() * 0.45), 0, 1)      # a table, not a dome
    np.maximum(hi, d * 430.0, out=hi)
    up += 1
print(f'uplands raised: {up}')

# Broad blur FIRST: a range polygon traced tight round its foot makes a sausage.
# Spreading it turns the sausages into massifs with shoulders, which is what the
# ridged noise below then carves back into ridges and valleys.
hi = ndimage.gaussian_filter(hi, 5.0)
hi *= 1.35                                   # the blur costs height; give it back

# ---------------------------------------------------------------------------
# 3. TEXTURE — ridged fractal noise so it reads as rock, not as pudding
# ---------------------------------------------------------------------------
rng = np.random.default_rng(20260818)

def value_noise(shape, cells):
    g = rng.random((cells, cells)).astype(np.float32)
    return ndimage.zoom(g, (shape[0] / cells, shape[1] / cells), order=3)[:shape[0], :shape[1]]

def ridged(shape, octaves=6, cells0=6):
    out = np.zeros(shape, dtype=np.float32)
    amp, cells = 1.0, cells0
    for _ in range(octaves):
        n = value_noise(shape, max(2, int(cells)))
        out += amp * (1.0 - np.abs(n * 2.0 - 1.0))
        amp *= 0.52
        cells *= 2.1
    out -= out.min(); out /= max(1e-6, out.max())
    return out

small = hi.shape

def warped_ridged(shape, octaves, cells0, warp=0.0):
    """Ridged multifractal. The domain is warped by a slower noise field first,
    so the ridges MEANDER instead of running in straight combed lines — that
    wander is most of what separates rock from corduroy."""
    if warp > 0:
        wx = (value_noise(shape, 7) - 0.5) * warp
        wy = (value_noise(shape, 7) - 0.5) * warp
        yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
        coords = np.stack([np.clip(yy + wy, 0, shape[0] - 1),
                           np.clip(xx + wx, 0, shape[1] - 1)])
    out = np.zeros(shape, dtype=np.float32)
    amp, cells, tot = 1.0, cells0, 0.0
    for _ in range(octaves):
        n = value_noise(shape, max(2, int(cells)))
        r = 1.0 - np.abs(n * 2.0 - 1.0)
        out += amp * (r * r)                 # squared: sharper crests
        tot += amp
        amp *= 0.5
        cells *= 2.0
    out /= tot
    if warp > 0:
        out = ndimage.map_coordinates(out, coords, order=1, mode='nearest')
    return out

# The carving. Amplitude follows the square root of the base uplift, so the Alps
# get torn up and the Baltic plain barely stirs — and it is ADDED, not
# multiplied: multiplying only wobbles a blob, it never makes a ridge.
# Measured against a FIXED reference height, never against the tallest thing on
# the chart. Normalising by the maximum meant one 5,000m summit pushed every
# other range's texture down to nothing — which is exactly why the Massif Central
# and the Carpathians came out as smooth brown pudding.
REF = 2200.0
base_n = np.clip(hi / REF, 0, 1)
relief = warped_ridged(small, 7, 5, warp=26.0)
hi = hi + (relief - 0.45) * 1500.0 * np.power(base_n, 0.5)

# gentle rolling ground everywhere on land, so plains are not glassy
plains = warped_ridged(small, 5, 22, warp=10.0)
hi += plains * 190.0
hi = np.clip(hi, 0, None) * land_lo
hi = ndimage.gaussian_filter(hi, 0.8)

# up to full resolution, then the fine grain that only shows when you lean in
hi_full = ndimage.zoom(hi, (H / hi.shape[0], W / hi.shape[1]), order=1)[:H, :W]
land_full = ndimage.zoom(land_lo.astype(np.float32), (H / land_lo.shape[0], W / land_lo.shape[1]), order=1)[:H, :W]
# The smooth surface is kept: the COLOUR comes from real elevation, and only the
# SHADING comes from the carved one. Tinting the carved surface put snow on every
# ridge of every range, which is why the Alps arrived as a white worm.
tint_h = np.clip(hi_full.copy(), 0, 4000.0)
base_full = np.clip(hi_full / REF, 0, 1)
fine = warped_ridged((H, W), 4, 110, warp=6.0)
hi_full = hi_full + (fine - 0.45) * 620.0 * np.power(base_full, 0.6)
grain = warped_ridged((H, W), 3, 420)
hi_full = hi_full + (grain - 0.5) * 150.0 * (0.3 + 0.7 * base_full)
hi_full = np.clip(hi_full, 0, None) * (land_full > 0.5)
print(f'height field: max {hi_full.max():.0f} m, mean on land {hi_full[land_full>0.5].mean():.0f} m')

# ---------------------------------------------------------------------------
# 4. HILLSHADE  (light from the north-west, as every relief map has had it)
# ---------------------------------------------------------------------------
# Vertical exaggeration. A pixel here is roughly 1.5km of ground, so TRUE relief
# would shade at a fraction of a degree and be invisible. Every relief map ever
# printed exaggerates; this one by about ten times.
Z = 0.0065
gy, gx = np.gradient(hi_full.astype(np.float32))
gx *= Z; gy *= Z
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gy, gx)
az, alt = math.radians(315.0), math.radians(45.0)
shade = (np.sin(alt) * np.cos(slope) +
         np.cos(alt) * np.sin(slope) * np.cos(az - aspect))
shade = np.clip(shade, 0, 1)
# a touch of ambient occlusion in the valleys, which is what gives depth
ao = 1.0 - 0.35 * np.clip(ndimage.gaussian_filter(hi_full, 9) - hi_full, 0, 600) / 600.0
shade = np.clip(shade * ao, 0, 1)

# ---------------------------------------------------------------------------
# 5. HYPSOMETRIC TINT — muted, so the political colours still read on top
# ---------------------------------------------------------------------------
# Warmer and more saturated than a survey map would be. It is seen through the
# province colours, and a muted palette under a translucent political layer just
# reads as grey.
stops = [(0,    (126, 158,  96)),   # lowland green, with some life in it
         (300,  (156, 168,  96)),
         (800,  (190, 172, 106)),   # dry upland
         (1500, (176, 132,  80)),   # brown
         (2400, (142, 104,  74)),
         (3200, (156, 146, 140)),   # bare rock
         (4000, (240, 242, 246))]   # snow, and only where there really is snow
hgt = np.clip(tint_h * (land_full > 0.5), 0, stops[-1][0])
rgb = np.zeros((H, W, 3), dtype=np.float32)
for (h0, c0), (h1, c1) in zip(stops, stops[1:]):
    m = (hgt >= h0) & (hgt <= h1)
    if not m.any():
        continue
    t = ((hgt[m] - h0) / max(1e-6, (h1 - h0)))[:, None]
    rgb[m] = np.asarray(c0, np.float32) * (1 - t) + np.asarray(c1, np.float32) * t

rgb *= (0.40 + 1.08 * shade)[:, :, None]      # more bite in the shading
sea = np.asarray([123, 160, 194], np.float32)
land_a = np.clip((land_full - 0.5) * 2.4, 0, 1)[:, :, None]
# THE SEA IS LEFT OUT. The chart is drawn over a living WebGL surface, and an
# opaque rectangle of painted sea underneath it would hide that surface across
# the whole screen. So the relief carries an alpha channel and stops at the
# coast — WebP, because it is the one format that does lossy colour AND alpha
# without becoming a ten-megabyte download.
rgb = rgb * land_a + sea * (1 - land_a)      # bleed the coast colour outward so
                                             # the edge does not fringe when scaled
land_alpha = np.clip((land_full - 0.45) * 3.2, 0, 1)

# ---------------------------------------------------------------------------
# 6. DEPTH — the same ground, cut into layers by height
# ---------------------------------------------------------------------------
# A shaded picture on a tipped plane is still a picture: hillshading tells you
# where the light is, but nothing on it ever stands in front of anything else.
# What actually reads as depth is PARALLAX — near things sliding against far
# things as the view moves.
#
# So the relief is cut into stacked bands by elevation. Each band holds
# everything above its own floor, drawn over the band below. Tip the world and
# each band is lifted a little further up the screen than the one under it; the
# lift opens a gap along each band's lower edge, and what shows through the gap
# is the band beneath — which is exactly a mountain face. Four flat images and
# one translate each, all composited, no geometry anywhere.
BANDS = [
    ('base', 0,    0),        # (name, floor in metres, how far it is lifted)
    ('b1',   320,  1),
    ('b2',   950,  2),
    ('b3',   1900, 3),
]
import os
total = 0
for name, floor, lift in BANDS:
    if floor <= 0:
        a = land_alpha
    else:
        # A soft edge, or every band ends in a staircase of jpeg-ish crunch
        a = np.clip((tint_h - floor) / 260.0, 0, 1) * land_alpha
        a = ndimage.gaussian_filter(a.astype(np.float32), 1.5)
    if a.max() < 0.02:
        continue
    rgba = np.dstack([np.clip(rgb, 0, 255), a * 255.0]).astype(np.uint8)
    path = OUT.replace('.webp', f'_{name}.webp')
    Image.fromarray(rgba, 'RGBA').save(path, quality=80, method=5)
    sz = os.path.getsize(path)
    total += sz
    print(f'  {name:5s} floor {floor:5d}m  lift {lift}  {sz/1e6:.2f} MB')
print(f'wrote {len(BANDS)} bands, {total/1e6:.2f} MB total, {W}x{H}')
