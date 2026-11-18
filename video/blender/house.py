"""Cottage of the terrace photo (tour object `terrace-house`): yellow stucco, blue French doors, terracotta roof.

Front (doors) faces -Y. 6.4 × 4.8 m plan, walls 2.75 m, gable roof along X with a front porch gable.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

C.reset()
random.seed(7)

STUCCO = C.mat("stucco", (0.27, 0.22, 0.10), rough=0.92, bump=(14, 0.35))
PLINTH = C.mat("plinth", (0.36, 0.33, 0.28), rough=0.9, bump=(30, 0.3))
TILE = C.mat("tile", (0.26, 0.055, 0.02), rough=0.65, bump=(40, 0.2))
WHITE = C.mat("white", (0.78, 0.78, 0.76), rough=0.55)
BLUE = C.mat("blue", (0.05, 0.13, 0.55), rough=0.45, coat=0.3)
FROST = C.mat("frost", (0.70, 0.74, 0.76), rough=0.35, transmission=0.0)
TERRA = C.mat("terra", (0.30, 0.08, 0.03), rough=0.75, bump=(20, 0.1))
VINE = C.mat("vine", (0.045, 0.03, 0.02), rough=0.9)
IRON = C.mat("iron", (0.03, 0.03, 0.035), rough=0.5, metal=0.6)
LAMPGLASS = C.mat("lampglass", (0.9, 0.85, 0.6), rough=0.2, emission=((1.0, 0.85, 0.5), 0.6))

W, D, H = 6.4, 4.8, 2.75
T = 0.25  # wall thickness

# --- walls (one block, openings are inset panels) -----------------------------------------------
C.box("walls", (W, D, H), (0, 0, H / 2 + 0.15), STUCCO, bevel=0.03, segs=2)
C.box("plinth", (W + 0.06, D + 0.06, 0.3), (0, 0, 0.15), PLINTH, bevel=0.02)


def french_door(x, y, face=-1, w=1.25, h=2.25):
    """Blue double French door with frosted panes, white surround."""
    yo = y + face * 0.01
    C.box("door_surround", (w + 0.22, 0.06, h + 0.12), (x, yo, 0.3 + h / 2 + 0.03), WHITE, bevel=0.01)
    C.box("door_recess", (w, 0.08, h), (x, yo + face * 0.01, 0.3 + h / 2), C.mat("dark", (0.02, 0.02, 0.02), rough=0.9))
    for s in (-1, 1):
        lx = x + s * w / 4
        C.box("leaf", (w / 2 - 0.02, 0.05, h - 0.02), (lx, yo + face * 0.035, 0.3 + h / 2), BLUE, bevel=0.008)
        # two tall frosted panes per leaf, a mid rail between them
        for k, (z0, z1) in enumerate(((0.45, 1.25), (1.42, 2.40))):
            C.box("pane", (w / 2 - 0.16, 0.02, z1 - z0), (lx, yo + face * 0.062, 0.3 + (z0 + z1) / 2 - 0.15), FROST)
            for r in range(1, 6):  # glazing bars
                zz = z0 + (z1 - z0) * r / 6
                C.box("bar", (w / 2 - 0.16, 0.025, 0.012), (lx, yo + face * 0.068, 0.3 + zz - 0.15), WHITE)
        C.cyl("knob", 0.018, 0.05, (x + s * 0.06, yo + face * 0.08, 1.35), rot=(math.pi / 2, 0, 0), material=IRON)
    # step: terracotta landing in front of the doors
    C.box("landing", (w + 1.6, 1.3, 0.22), (x, y + face * 0.65, 0.11), TERRA, bevel=0.02)


def window(x, y, face=-1, w=0.75, h=1.45, z=1.0, axis="y"):
    """Blue-framed casement window with white glazing bars and a stone sill."""
    sx, sy = (w, 0.06) if axis == "y" else (0.06, w)
    off = (0, face * 0.02) if axis == "y" else (face * 0.02, 0)
    C.box("win_frame", (sx + (0.12 if axis == "y" else 0), sy + (0.12 if axis == "x" else 0), h + 0.12),
          (x + off[0], y + off[1], z + h / 2), WHITE, bevel=0.01)
    C.box("win_blue", (sx - (0.0 if axis == "x" else 0.02), sy - (0.02 if axis == "x" else 0), h), (x + off[0] * 2, y + off[1] * 2, z + h / 2), BLUE)
    gx, gy = (w - 0.14, 0.02) if axis == "y" else (0.02, w - 0.14)
    C.box("win_glass", (gx, gy, h - 0.14), (x + off[0] * 3.2, y + off[1] * 3.2, z + h / 2), FROST)
    for r in range(1, 4):
        bx, by = (w - 0.14, 0.03) if axis == "y" else (0.03, w - 0.14)
        C.box("win_bar", (bx, by, 0.012), (x + off[0] * 3.5, y + off[1] * 3.5, z + h * r / 4), WHITE)
    vx, vy = (0.012, 0.03) if axis == "y" else (0.03, 0.012)
    C.box("win_mull", (vx, vy, h - 0.14), (x + off[0] * 3.5, y + off[1] * 3.5, z + h / 2), WHITE)
    lx, ly = (w + 0.2, 0.12) if axis == "y" else (0.12, w + 0.2)
    C.box("sill", (lx, ly, 0.06), (x + off[0] * 3, y + off[1] * 3, z - 0.04), PLINTH, bevel=0.01)


FY = -D / 2
french_door(-0.6, FY)
window(2.0, FY, z=1.05)
window(-2.55, FY, w=0.6, h=1.1, z=1.3)
# sides and back
window(W / 2, -0.8, face=1, axis="x")
window(W / 2, 1.2, face=1, axis="x")
window(-W / 2, 0.2, face=-1, axis="x")
window(-1.6, D / 2, face=1)
window(1.6, D / 2, face=1)

# wall lamp above the doors
C.box("lamp_arm", (0.04, 0.18, 0.04), (-0.6, FY - 0.09, 2.78), IRON)
C.box("lamp", (0.14, 0.14, 0.2), (-0.6, FY - 0.2, 2.68), LAMPGLASS, bevel=0.01)
C.box("lamp_cap", (0.2, 0.2, 0.05), (-0.6, FY - 0.2, 2.8), IRON, bevel=0.01)

# --- roof: gable along X, barrel tiles, white fascia and rafter tails ---------------------------------
OV = 0.55  # eave overhang
PITCH = math.radians(24)
RUN = D / 2 + OV
RISE = (D / 2) * math.tan(PITCH)
ZE = H + 0.15  # eave line on the walls
ZR = ZE + RISE  # ridge
ROOF_W = W + 2 * 0.45


def roof_plane(side):
    """One slope of barrel tiles: corrugated across, stepped courses down the slope."""
    def pt(u, v):
        x = -ROOF_W / 2 + ROOF_W * u
        r = v * RUN  # horizontal distance from the ridge
        y = side * r
        z = ZR - r * math.tan(PITCH) + 0.06
        corr = 0.045 * abs(math.sin(math.pi * x / 0.19))
        course = 0.018 * ((r / 0.33) % 1.0)
        return (x, y, z + corr + course)
    ob = C.grid_obj(f"tiles_{side}", 340, 60, pt, TILE)
    ob.modifiers.new("solid", "SOLIDIFY").thickness = 0.04
    return ob


roof_plane(-1)
roof_plane(1)
C.tube("ridge", [(-ROOF_W / 2, 0, ZR + 0.11), (ROOF_W / 2, 0, ZR + 0.11)], 0.09, TILE, res=4)
for side in (-1, 1):
    ye = side * RUN
    ze = ZR - RUN * math.tan(PITCH)
    C.box("fascia", (ROOF_W, 0.04, 0.2), (0, ye, ze - 0.02), WHITE, bevel=0.005)
    for k in range(int(ROOF_W / 0.6) + 1):
        x = -ROOF_W / 2 + 0.1 + k * 0.6
        C.box("rafter", (0.08, OV, 0.1), (x, side * (D / 2 + OV / 2), ZE + 0.02 - (OV / 2) * math.tan(PITCH)), WHITE,
              rot=(side * PITCH, 0, 0))
# gable walls (stucco triangles) and bargeboards
for s in (-1, 1):
    x = s * W / 2
    C.mesh_obj("gable", [(x, -D / 2, ZE), (x, D / 2, ZE), (x, 0, ZR)], [(0, 1, 2)], STUCCO, smooth=False)
    for side in (-1, 1):
        C.tube("barge", [(s * ROOF_W / 2, 0, ZR + 0.05), (s * ROOF_W / 2, side * RUN, ZR - RUN * math.tan(PITCH) + 0.05)],
               0.05, WHITE, res=2, bevel_res=1)

# --- front porch gable over the doors: white timber frame, small tiled roof -----------------------
PX, PW, PD = -0.6, 2.6, 1.0
pz0 = ZE + 0.05
prise = (PW / 2) * math.tan(math.radians(30))
for s in (-1, 1):
    # rafters of the porch gable
    C.tube("porch_rafter", [(PX + s * PW / 2, FY - PD, pz0), (PX, FY - PD, pz0 + prise)], 0.06, WHITE, res=2, bevel_res=1)
    C.box("porch_bracket", (0.08, PD, 0.1), (PX + s * (PW / 2 - 0.1), FY - PD / 2, pz0 - 0.05), WHITE)
    # porch roof slopes
    def pp(u, v, s=s):
        x = PX + s * (PW / 2 + 0.15) * (1 - u)
        y = FY - (PD + 0.15) + (PD + 0.15 + 0.6) * v
        z = pz0 + prise * u + 0.08 + 0.035 * abs(math.sin(math.pi * y / 0.19))
        return (x, y, z)
    ob = C.grid_obj("porch_tiles", 40, 90, pp, TILE)
    ob.modifiers.new("solid", "SOLIDIFY").thickness = 0.04
C.box("porch_beam", (PW, 0.1, 0.12), (PX, FY - PD, pz0 - 0.02), WHITE)
C.box("porch_king", (0.08, 0.08, prise), (PX, FY - PD, pz0 + prise / 2), WHITE)
C.box("porch_tie", (0.08, PD, 0.08), (PX, FY - PD / 2, pz0 + prise * 0.55), WHITE)

# --- climbing vines on the front wall (bare stems, as on the photo) -------------------------------------
for k in range(40):
    x = random.uniform(-W / 2 + 0.2, W / 2 - 0.2)
    if -1.45 < x < 0.25 or 1.5 < x < 2.5:
        continue  # not over the door and the window
    pts = [(x, FY - 0.03, 0.32)]
    z = 0.32
    while z < H:
        z += random.uniform(0.18, 0.35)
        x += random.uniform(-0.18, 0.18)
        pts.append((x, FY - 0.03, min(z, H + 0.1), max(0.3, 1 - z / H)))
    C.tube("vine", pts, 0.007, VINE, res=4, bevel_res=1)
    for b in range(len(pts) // 2):  # side twigs
        p0 = pts[random.randrange(1, len(pts))]
        C.tube("twig", [p0[:3], (p0[0] + random.uniform(-0.3, 0.3), p0[1], p0[2] + random.uniform(0.05, 0.25))], 0.004, VINE, res=2, bevel_res=1)

C.finish(C.out_dir_arg("/tmp/claude-0/prepared/terrace-house"), "terrace-house", hero_dir=(-1.2, -1.6, 0.8),
         samples=48)
