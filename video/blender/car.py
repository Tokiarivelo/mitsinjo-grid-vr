"""White estate car of the street photo (tour object `street-car-white`): lofted body, glass, 10-spoke rims.

Length along Y, nose at -Y (the app's « right » view is its profile). 4.72 × 1.84 × 1.43 m.
"""

import math
import os
import sys

import bpy  # noqa: I001 (bpy first: it makes bmesh importable)
import bmesh

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

C.reset()

PAINT = C.mat("paint", (0.80, 0.81, 0.82), rough=0.28, coat=1.0)
GLASS = C.mat("glass", (0.015, 0.018, 0.022), rough=0.05, metal=0.0, coat=1.0)
TRIM = C.mat("trim", (0.01, 0.01, 0.012), rough=0.25, coat=0.6)
RUBBER = C.mat("rubber", (0.02, 0.02, 0.02), rough=0.85)
RIM = C.mat("rim", (0.38, 0.39, 0.41), rough=0.28, metal=0.95)
CHROME = C.mat("chrome", (0.9, 0.9, 0.9), rough=0.08, metal=1.0)
LAMP = C.mat("lamp", (0.6, 0.65, 0.7), rough=0.05, metal=0.6, coat=1)
TAIL = C.mat("tail", (0.35, 0.0, 0.01), rough=0.15, coat=1, emission=((0.6, 0.0, 0.0), 0.4))
GAP = C.mat("gap", (0.02, 0.02, 0.02), rough=0.6)

L = 4.72
WB = 2.82
FRONT_AXLE = 0.95  # from the nose
REAR_AXLE = FRONT_AXLE + WB
WHEEL_R = 0.345


def lerp_keys(keys, t):
    """Piecewise smooth (cosine) interpolation through [(t, value)]."""
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            k = (1 - math.cos(math.pi * k)) / 2
            return v0 + (v1 - v0) * k
    return keys[-1][1] if t > keys[-1][0] else keys[0][1]


# profile keys along the length (t = distance from the nose / L)
BOTTOM = [(0, 0.30), (0.04, 0.22), (0.12, 0.18), (0.88, 0.18), (0.96, 0.27), (1, 0.42)]
BELT = [(0, 0.66), (0.03, 0.77), (0.10, 0.855), (0.27, 0.925), (0.6, 0.95), (0.9, 0.98), (0.985, 0.99), (1, 0.72)]
ROOF = [(0, 0.675), (0.03, 0.785), (0.10, 0.87), (0.27, 0.94), (0.47, 1.405), (0.56, 1.43), (0.88, 1.415),
        (0.955, 1.37), (0.99, 1.0), (1, 0.75)]
HALF = [(0, 0.70), (0.04, 0.84), (0.12, 0.91), (0.88, 0.915), (0.97, 0.86), (1, 0.78)]
ROOF_HALF = [(0, 0.40), (0.12, 0.62), (0.27, 0.80), (0.47, 0.66), (0.9, 0.64), (0.99, 0.60), (1, 0.5)]
G0, G1 = 0.28, 0.975  # greenhouse span


def section(t, n=40):
    """Right half of a cross-section, bottom centre → top centre: [(x, z, kind)]."""
    zb, zbelt, zroof = lerp_keys(BOTTOM, t), lerp_keys(BELT, t), lerp_keys(ROOF, t)
    w = lerp_keys(HALF, t)
    pts = []
    # lower body: superellipse quarter from bottom centre up to the shoulder
    m = n // 2
    for k in range(m + 1):
        a = -math.pi / 2 + (math.pi / 2) * k / m
        c, s = math.cos(a), math.sin(a)
        x = w * (abs(c) ** (2 / 5))
        zc = (zb + zbelt) / 2 + 0.02
        hz = (zbelt - zb) / 2
        z = zc + hz * math.copysign(abs(s) ** (2 / 3.2), s)
        pts.append((x, z, "body"))
    # shoulder → roof: one continuous form; over the hood and the deck its height shrinks to nothing
    rw = lerp_keys(ROOF_HALF, t)
    h = max(zroof - zbelt, 0.0)
    glassy = G0 <= t <= G1 and h > 0.12
    m2 = n - m
    for k in range(1, m2 + 1):
        f = k / m2
        if f < 0.65:
            g = f / 0.65
            x = w - 0.05 - (w - 0.05 - rw) * g
            z = zbelt + 0.01 + max(h - 0.05, 0.0) * g
            kind = "glass" if glassy and 0.06 < g < 0.96 else "body"
        else:
            g = (f - 0.65) / 0.35
            x = rw * math.cos(g * math.pi / 2) ** 0.35
            z = zbelt + 0.01 + max(h - 0.05, 0.0) + (0.05 if h > 0.05 else 0.025) * math.sin(g * math.pi / 2) ** 0.6
            kind = "roof" if glassy else "hood"
        pts.append((x, z, kind))
    pts[-1] = (0.0, pts[-1][1], pts[-1][2])
    return pts


# --- loft the body ---------------------------------------------------------------------------
NS = 220
bm = bmesh.new()
rows = []
kinds = []
for i in range(NS + 1):
    t = i / NS
    y = -L / 2 + t * L
    sec = section(t)
    full = sec + [(-x, z, k) for x, z, k in reversed(sec[1:-1])]  # closed ring: right side up, left side down
    row = [bm.verts.new((x, y, z)) for x, z, k in full]
    rows.append(row)
    kinds.append([k for x, z, k in full])
mat_index = {"body": 0, "glass": 1, "trim": 2, "gap": 3}
faces = []
n = len(rows[0])
for i in range(NS):
    t = (i + 0.5) / NS
    for j in range(n):
        j1 = (j + 1) % n
        f = bm.faces.new((rows[i][j], rows[i][j1], rows[i + 1][j1], rows[i + 1][j]))
        kind = kinds[i][j] if kinds[i][j] == kinds[i][j1] else "body"
        idx = 0
        if kind == "glass" and G0 + 0.012 < t < G1 - 0.01:
            idx = 1
            # B and C pillars (black), windscreen and rear window stay glass
            if 0.545 < t < 0.575 or 0.775 < t < 0.80:
                idx = 2
        elif kind == "roof" and G0 + 0.01 < t < 0.47:
            idx = 1  # windscreen continues over the roof edge
        elif kind == "roof" and t > 0.955:
            idx = 1  # rear window
        # door shut lines on the body side
        if kind == "body" and (abs(t - 0.305) < 0.0025 or abs(t - 0.555) < 0.0025 or abs(t - 0.79) < 0.0025):
            idx = 3
        f.material_index = idx
        faces.append(f)
# end caps
for row, flip in ((rows[0], False), (rows[-1], True)):
    f = bm.faces.new(list(reversed(row)) if flip else row)
    f.material_index = 0
me = bpy.data.meshes.new("body")
bm.to_mesh(me)
bm.free()
body = C.link(bpy.data.objects.new("body", me))
for m in (PAINT, GLASS, TRIM, GAP):
    body.data.materials.append(m)
C.smooth(body)
sub = body.modifiers.new("sub", "SUBSURF")
sub.levels = 1
sub.render_levels = 2

# wheel arches cut out
for yc in (-L / 2 + FRONT_AXLE, -L / 2 + REAR_AXLE):
    cutter = C.cyl("arch_cut", WHEEL_R + 0.05, 2.4, (0, yc, WHEEL_R), rot=(0, math.pi / 2, 0), verts=64)
    cutter.display_type = "WIRE"
    b = body.modifiers.new("arch", "BOOLEAN")
    b.object = cutter
    b.operation = "DIFFERENCE"
    cutter.hide_render = True
    cutter.hide_viewport = True
    # arch liner (black)
    C.cyl("liner", WHEEL_R + 0.045, 1.70, (0, yc, WHEEL_R), rot=(0, math.pi / 2, 0), material=TRIM, verts=64).scale = (1, 1, 1)


# --- wheels ---------------------------------------------------------------------------------------
def wheel(x, yc, side):
    # tyre: lathe of a rounded profile around the X axis
    bm = bmesh.new()
    prof = []
    for k in range(17):
        a = math.pi * k / 16
        prof.append((0.122 * math.cos(a), WHEEL_R - 0.03 + 0.03 * math.sin(a)))
    prof = [(0.122, 0.235)] + prof + [(-0.122, 0.235)]
    nseg = 64
    ring = []
    for s in range(nseg):
        a = 2 * math.pi * s / nseg
        ring.append([bm.verts.new((px, math.cos(a) * r, math.sin(a) * r)) for px, r in prof])
    for s in range(nseg):
        r0, r1 = ring[s], ring[(s + 1) % nseg]
        for k in range(len(prof) - 1):
            bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
    me = bpy.data.meshes.new("tyre")
    bm.to_mesh(me)
    bm.free()
    tyre = C.link(bpy.data.objects.new("tyre", me))
    tyre.location = (x, yc, WHEEL_R)
    tyre.data.materials.append(RUBBER)
    C.smooth(tyre)
    # rim: barrel, 10 twisted spokes, hub, brake disc
    out = side * 0.10
    C.cyl("barrel", 0.235, 0.22, (x, yc, WHEEL_R), rot=(0, math.pi / 2, 0), material=RIM, verts=48)
    C.cyl("disc", 0.17, 0.03, (x - side * 0.02, yc, WHEEL_R), rot=(0, math.pi / 2, 0), material=CHROME, verts=40)
    for k in range(10):
        a = 2 * math.pi * k / 10
        r0, r1 = 0.06, 0.225
        pts = []
        for q in range(5):
            f = q / 4
            r = r0 + (r1 - r0) * f
            aa = a + 0.12 * f
            pts.append((x + out - side * 0.03 * f * f, yc + math.cos(aa) * r, WHEEL_R + math.sin(aa) * r, 1.4 - 0.5 * f))
        C.tube("spoke", pts, 0.016, RIM, res=6, bevel_res=2)
    C.cyl("hub", 0.065, 0.05, (x + out, yc, WHEEL_R), rot=(0, math.pi / 2, 0), material=RIM, verts=32, bevel=0.01)
    C.cyl("cap", 0.03, 0.055, (x + out + side * 0.005, yc, WHEEL_R), rot=(0, math.pi / 2, 0), material=CHROME, verts=24)


for side in (-1, 1):
    for yc in (-L / 2 + FRONT_AXLE, -L / 2 + REAR_AXLE):
        wheel(side * 0.785, yc, side)

# --- lamps, grille, mirrors, handles, rails ---------------------------------------------------
for s in (-1, 1):
    # headlight: a thin sweeping lens on the front corner
    C.tube("headlight", [(s * 0.40, -L / 2 + 0.06, 0.66), (s * 0.62, -L / 2 + 0.10, 0.68), (s * 0.80, -L / 2 + 0.22, 0.70)],
           0.045, LAMP, res=12)
    C.tube("drl", [(s * 0.42, -L / 2 + 0.04, 0.635), (s * 0.63, -L / 2 + 0.085, 0.65), (s * 0.80, -L / 2 + 0.20, 0.665)],
           0.008, CHROME)
    # tail light wrapping the rear corner
    C.tube("taillight", [(s * 0.50, L / 2 - 0.015, 0.93), (s * 0.74, L / 2 - 0.05, 0.93), (s * 0.86, L / 2 - 0.20, 0.925)],
           0.04, TAIL, res=12)
    # mirror
    C.box("mirror", (0.16, 0.10, 0.11), (s * 0.97, -L / 2 + 1.47, 1.0), PAINT, bevel=0.035, segs=4)
    C.box("mirror_cap", (0.04, 0.10, 0.10), (s * 0.90, -L / 2 + 1.47, 0.99), TRIM, bevel=0.02)
    # door handles
    for yh in (-L / 2 + 2.05, -L / 2 + 2.95):
        C.box("handle", (0.03, 0.17, 0.035), (s * 0.925, yh, 0.93), CHROME, bevel=0.012)
    # roof rail
    C.tube("roof_rail", [(s * 0.62, -L / 2 + 2.30, 1.43), (s * 0.63, -L / 2 + 3.4, 1.45), (s * 0.60, -L / 2 + 4.4, 1.42)],
           0.018, TRIM)
    # side skirt
    C.tube("skirt", [(s * 0.90, -L / 2 + 1.33, 0.22), (s * 0.91, -L / 2 + 3.4, 0.22)], 0.03, TRIM)
# singleframe grille + intakes
C.box("grille", (0.78, 0.06, 0.30), (0, -L / 2 + 0.035, 0.47), TRIM, bevel=0.04, segs=3)
for k in range(6):
    C.box("grille_bar", (0.74, 0.07, 0.008), (0, -L / 2 + 0.03, 0.36 + k * 0.04), CHROME)
C.box("rings", (0.30, 0.02, 0.06), (0, -L / 2 + 0.002, 0.57), CHROME, bevel=0.02)
for s in (-1, 1):
    C.box("intake", (0.25, 0.06, 0.08), (s * 0.60, -L / 2 + 0.07, 0.34), TRIM, bevel=0.025)
C.box("rear_diffuser", (1.4, 0.06, 0.12), (0, L / 2 - 0.02, 0.32), TRIM, bevel=0.03)
C.box("plate", (0.52, 0.02, 0.11), (0, L / 2 - 0.005, 0.62), CHROME, bevel=0.01)
C.box("plate_f", (0.52, 0.02, 0.11), (0, -L / 2 - 0.005, 0.40), CHROME, bevel=0.01)

C.finish(C.out_dir_arg("/tmp/claude-0/prepared/street-car-white"), "street-car-white",
         views=("front", "right", "back", "left", "top", "bottom"), hero_dir=(1.4, -1.0, 0.45), samples=48)
