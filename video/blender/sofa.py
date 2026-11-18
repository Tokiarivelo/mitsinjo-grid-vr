"""Baroque tufted sofa of the hall photo (tour object `hall-sofa`): pale blue velvet, carved silver frame.

Front faces -Y. Width 2.0 m, seat 0.47 m, crest 1.08 m.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

C.reset()

VELVET = C.mat("velvet", (0.045, 0.10, 0.16), rough=0.8, sheen=0.25, sheen_tint=(0.7, 0.85, 1.0, 1),
               bump=(180, 0.08))
BUTTON = C.mat("button", (0.06, 0.12, 0.19), rough=0.6, sheen=0.6)
SILVER = C.mat("silver", (0.80, 0.81, 0.83), rough=0.32, metal=0.95, bump=(60, 0.15))

HALF = 0.86  # half width of the upholstered back


def crest(x):
    """Top edge of the back: a baroque camelback, high in the middle, dipping before the arms."""
    u = abs(x / HALF)
    return 0.86 + 0.11 * math.exp(-(u / 0.33) ** 2) + 0.035 * math.exp(-((u - 0.78) / 0.12) ** 2) - 0.12 * max(0.0, u - 0.86) / 0.14


# --- Back: tufted panel ---------------------------------------------------------------
Z0 = 0.50
buttons = []
rows = [0.30, 0.55, 0.80]
for r, v in enumerate(rows):
    n = 7 if r % 2 == 0 else 6
    for k in range(n):
        u = (k + 0.5) / n if r % 2 else k / (n - 1)
        u = 0.08 + 0.84 * u
        buttons.append((u, v))


def back_point(u, v):
    x = -HALF + 2 * HALF * u
    z = Z0 + v * (crest(x) - Z0)
    y = 0.20 + (z - Z0) * 0.16  # reclined
    y -= 0.05 * math.sin(math.pi * u) ** 0.6 * math.sin(math.pi * v) ** 0.7  # pillowy towards the front
    # tufting: buttons pull the fabric in, creases run between them (diamond)
    d = 0.0
    for bu, bv in buttons:
        du, dv = (u - bu) * 1.7, v - bv
        d += 0.05 * math.exp(-(du * du + dv * dv) / (2 * 0.03 ** 2))
    for i, (au, av) in enumerate(buttons):
        for bu, bv in buttons[i + 1:]:
            if abs(bv - av) < 0.3 and 0 < abs(bv - av) and abs(bu - au) < 0.11:
                # distance to segment a-b in (u*1.7, v) space
                ax, ay, bx, by, px, py = au * 1.7, av, bu * 1.7, bv, u * 1.7, v
                t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
                qx, qy = ax + t * (bx - ax), ay + t * (by - ay)
                dd = (px - qx) ** 2 + (py - qy) ** 2
                d += 0.02 * math.exp(-dd / (2 * 0.011 ** 2))
    y += min(d, 0.055)
    return (x, y, z)


back = C.grid_obj("back", 150, 70, back_point, VELVET)
sol = back.modifiers.new("solid", "SOLIDIFY")
sol.thickness = 0.09
sol.offset = 1  # grows backwards (+Y)
for bu, bv in buttons:
    p = back_point(bu, bv)
    C.sphere("button", 0.013, (p[0], p[1] - 0.004, p[2]), (1, 0.6, 1), BUTTON, seg=12)

# --- Seat cushion (domed) ---------------------------------------------------------------
def seat_top(u, v):
    x = -0.84 + 1.68 * u
    y = -0.40 + 0.62 * v
    z = 0.47 + 0.035 * math.sin(math.pi * u) ** 0.5 * math.sin(math.pi * v) ** 0.7
    return (x, y, z)


seat = C.box("seat", (1.70, 0.62, 0.14), (0, -0.09, 0.40), VELVET, bevel=0.05, segs=4)
crown = C.grid_obj("seat_crown", 60, 24, seat_top, VELVET)
crown.modifiers.new("solid", "SOLIDIFY").thickness = 0.03
# front welt (piping) along the cushion edge
C.tube("welt", [(-0.84, -0.405, 0.47), (0, -0.425, 0.475), (0.84, -0.405, 0.47)], 0.012, VELVET)

# --- Arms: rolled pads on carved supports --------------------------------------------
for s in (-1, 1):
    x = s * 0.93
    # inner arm upholstery
    C.box(f"arm_side_{s}", (0.10, 0.58, 0.20), (x - s * 0.02, -0.10, 0.57), VELVET, bevel=0.04, segs=3)
    # rolled pad
    pad = C.cyl(f"arm_pad_{s}", 0.095, 0.58, (x + s * 0.03, -0.10, 0.70), rot=(math.pi / 2, 0, 0), material=VELVET, verts=48,
                bevel=0.03)
    pad.scale = (1.2, 1, 1)
    # upholstered scroll face at the front of the arm, with its silver trim
    C.sphere(f"arm_face_{s}", 0.1, (x + s * 0.03, -0.39, 0.70), (1.2, 0.35, 1.0), VELVET)
    # silver arm scroll at the front of the pad
    C.tube(f"arm_scroll_{s}", [(x + s * 0.03 + p[0], p[1], p[2], p[3]) for p in C.spiral(0.0, 0.70, 0.10, 1.25, -0.43, sign=-s)],
           0.011, SILVER)
    # S-shaped arm support down to the seat rail
    C.tube(f"arm_support_{s}", [
        (x, -0.40, 0.63, 0.9), (x + s * 0.03, -0.43, 0.56, 1.0), (x + s * 0.01, -0.40, 0.48, 0.8),
        (x - s * 0.01, -0.44, 0.40, 1.1), (x, -0.43, 0.34, 1.0)], 0.024, SILVER)
    # outer arm frame running back
    C.tube(f"arm_rail_{s}", [(x + s * 0.06, -0.38, 0.66), (x + s * 0.08, -0.10, 0.70), (x + s * 0.07, 0.20, 0.66)],
           0.016, SILVER)

# --- Carved frame around the back ---------------------------------------------------------
outline = []
for k in range(41):
    x = -HALF - 0.02 + (2 * HALF + 0.04) * k / 40
    xc = max(-HALF, min(HALF, x))
    z = crest(xc) + 0.03
    outline.append((x, 0.20 + (z - Z0) * 0.16 + 0.03, z, 1.0 + 0.5 * math.exp(-(x / 0.12) ** 2)))
side_l = [(-HALF - 0.03, 0.22, Z0 + 0.02)] + [(-HALF - 0.03, 0.24, (Z0 + crest(-HALF)) / 2)]
side_r = [(HALF + 0.03, 0.24, (Z0 + crest(HALF)) / 2), (HALF + 0.03, 0.22, Z0 + 0.02)]
C.tube("crest_rail", side_l + outline + side_r, 0.022, SILVER, res=24)
# centre cartouche: two scrolls and a leaf on the crest
top = crest(0) + 0.03
yc = 0.20 + (top - Z0) * 0.16 + 0.02
for s in (-1, 1):
    C.tube(f"crest_scroll_{s}", [(s * 0.05 + p[0] * s, yc - 0.01, top + 0.04 + p[2] - 0.0, p[3])
                                  for p in C.spiral(0.03, 0.0, 0.05, 1.3, 0, sign=1)], 0.012, SILVER)
C.sphere("crest_leaf", 0.045, (0, yc - 0.015, top + 0.08), (0.7, 0.35, 1.3), SILVER)
C.sphere("crest_bud", 0.022, (0, yc - 0.03, top + 0.13), (1, 0.6, 1), SILVER)

# --- Front seat rail (serpentine apron) and legs ----------------------------------------------
apron = []
for k in range(33):
    x = -0.95 + 1.90 * k / 32
    y = -0.44 - 0.02 * math.cos(math.pi * x / 0.95)
    apron.append((x, y, 0.345))
C.tube("seat_rail", apron, 0.022, SILVER, res=16)
scallop = []
for k in range(49):
    x = -0.93 + 1.86 * k / 48
    dip = 0.05 * math.exp(-(x / 0.12) ** 2) + 0.03 * math.exp(-((abs(x) - 0.55) / 0.08) ** 2)
    scallop.append((x, -0.43 - 0.02 * math.cos(math.pi * x / 0.95), 0.31 - dip, 0.8))
C.tube("apron_scallop", scallop, 0.016, SILVER, res=16)
C.sphere("apron_shell", 0.05, (0, -0.47, 0.27), (1.1, 0.4, 0.9), SILVER)
# side and back rails
for s in (-1, 1):
    C.tube(f"side_rail_{s}", [(s * 0.95, -0.44, 0.345), (s * 0.97, -0.1, 0.35), (s * 0.95, 0.26, 0.345)], 0.026, SILVER)
C.tube("back_rail", [(-0.95, 0.26, 0.345), (0, 0.28, 0.35), (0.95, 0.26, 0.345)], 0.026, SILVER)


def cabriole(x, y, front=True, out=1):
    """Cabriole leg: knee bulging out, slim ankle, scroll foot."""
    f = -1 if front else 1
    pts = [(x, y, 0.33, 1.3), (x + out * 0.03, y + f * 0.035, 0.25, 1.3), (x + out * 0.015, y + f * 0.02, 0.16, 0.85),
           (x, y, 0.08, 0.6), (x, y + f * 0.015, 0.03, 0.8)]
    C.tube("leg", pts, 0.028, SILVER, res=14)
    C.sphere("foot", 0.028, (x, y + f * 0.025, 0.025), (1, 1.2, 0.7), SILVER)


for x, out in ((-0.88, -1), (-0.32, -0.3), (0.32, 0.3), (0.88, 1)):
    cabriole(x, -0.44 - 0.02 * math.cos(math.pi * x / 0.95) + 0.01, True, out)
for x in (-0.88, 0.88):
    cabriole(x, 0.25, False, 1 if x > 0 else -1)

# Shorter legs, as on the photo: squash everything under the seat rail, lower the rest.
import bpy  # noqa: E402

C.to_meshes()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for ob in bpy.context.scene.objects:
    if ob.type == "MESH":
        for v in ob.data.vertices:
            z = v.co.z
            v.co.z = z * 0.72 if z < 0.345 else z - 0.345 * 0.28

C.finish(C.out_dir_arg("/tmp/claude-0/prepared/hall-sofa"), "hall-sofa", samples=48)
