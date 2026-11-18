"""Shared Blender helpers for the prepared demo objects (sofa, car, house).

Run with the bpy wheel: `video/.venv-blender/bin/python video/blender/<object>.py OUT_DIR`.
Each object script builds its model with the front facing -Y, then calls `finish()`, which renders
the orthographic views (front, right, back, left, top + a 3/4 hero) on the app's pale blue drawing
background and exports one GLB (modifiers applied, curves converted to meshes).
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

DRAWING_BG = (214, 228, 240)  # pale blue, the background every app drawing asks for


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"


def mat(name, color, rough=0.5, metal=0.0, sheen=0.0, sheen_tint=(1, 1, 1, 1), coat=0.0, alpha=1.0,
        transmission=0.0, emission=None, ior=1.45, bump=None):
    """Principled material. `bump` = (scale, strength) adds a noise bump (renders only)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    p.inputs["IOR"].default_value = ior
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
        p.inputs["Sheen Tint"].default_value = sheen_tint
        p.inputs["Sheen Roughness"].default_value = 0.4
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.05
    if transmission:
        p.inputs["Transmission Weight"].default_value = transmission
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
    if emission:
        p.inputs["Emission Color"].default_value = (*emission[0], 1)
        p.inputs["Emission Strength"].default_value = emission[1]
    if bump:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = bump[0]
        tex.inputs["Detail"].default_value = 8
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump[1]
        nt.links.new(tex.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    return m


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, material=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if material:
        ob.data.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def grid_obj(name, nu, nv, fn, material=None, smooth=True):
    """A (nu+1)×(nv+1) quad sheet, vertex (i, j) at fn(i/nu, j/nv)."""
    verts = [fn(i / nu, j / nv) for j in range(nv + 1) for i in range(nu + 1)]
    faces = [(j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i)
             for j in range(nv) for i in range(nu)]
    return mesh_obj(name, verts, faces, material, smooth)


def box(name, size, loc, material=None, bevel=0.0, segs=3, subsurf=0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = "NONE"
    if subsurf:
        mod = ob.modifiers.new("sub", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    if material:
        ob.data.materials.append(material)
    smooth(ob)
    return ob


def cyl(name, r, depth, loc, rot=(0, 0, 0), material=None, verts=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    if material:
        ob.data.materials.append(material)
    smooth(ob)
    return ob


def sphere(name, r, loc, scale=(1, 1, 1), material=None, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    if material:
        ob.data.materials.append(material)
    smooth(ob)
    return ob


def smooth(ob):
    if ob.type == "MESH":
        for p in ob.data.polygons:
            p.use_smooth = True


def tube(name, pts, radius, material=None, cyclic=False, res=12, bevel_res=4):
    """A smooth tube through `pts` [(x, y, z) or (x, y, z, radius factor)], NURBS order 3."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.resolution_u = res
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q[0], q[1], q[2], 1)
        p.radius = q[3] if len(q) > 3 else 1.0
    sp.order_u = 3 if len(pts) >= 3 else 2
    sp.use_endpoint_u = not cyclic
    sp.use_cyclic_u = cyclic
    ob = link(bpy.data.objects.new(name, cu))
    if material:
        ob.data.materials.append(material)
    return ob


def spiral(cx, cz, r0, turns, y, plane="xz", n=24, r_tube=(1.0, 0.4), start=0.0, sign=1):
    """Points of a flat scroll (volute) for `tube`, shrinking inward."""
    pts = []
    for k in range(n + 1):
        t = k / n
        a = start + sign * t * turns * 2 * math.pi
        r = r0 * (1 - 0.8 * t)
        rf = r_tube[0] + (r_tube[1] - r_tube[0]) * t
        if plane == "xz":
            pts.append((cx + r * math.cos(a), y, cz + r * math.sin(a), rf))
        else:  # yz
            pts.append((y, cx + r * math.cos(a), cz + r * math.sin(a), rf))
    return pts


def mirror_x(ob):
    mod = ob.modifiers.new("mirror", "MIRROR")
    mod.use_axis[0] = True
    return ob


def to_meshes():
    """Curves → meshes, modifiers applied, so the GLB carries exactly what renders."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in list(bpy.context.scene.objects):
        if ob.type in ("CURVE",):
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
    if bpy.context.selected_objects:
        bpy.ops.object.convert(target="MESH")


def bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.context.scene.objects:
        if ob.type not in ("MESH", "CURVE") or ob.hide_render:
            continue
        ev = ob.evaluated_get(deps)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def lights(env_strength=0.9):
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "MULTIPLE_SCATTERING"
    except TypeError:
        sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(200)
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = env_strength * 0.12
    # soft studio key + fill (camera-independent: views stay evenly lit)
    for name, loc, power, size in [("key", (-3.5, -3, 4.5), 210, 2.5), ("fill", (4, -2, 2), 45, 5), ("rim", (1, 5, 4), 160, 4)]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = power
        ld.size = size
        lo = link(bpy.data.objects.new(name, ld))
        lo.location = loc
        d = Vector((0, 0, 0.6)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render_setup(px=1024, samples=64):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = px
    sc.render.resolution_y = px
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = -0.35


VIEWS = {  # name: camera direction (from the object to the camera)
    "front": Vector((0, -1, 0)),
    "right": Vector((1, 0, 0)),
    "back": Vector((0, 1, 0)),
    "left": Vector((-1, 0, 0)),
    "top": Vector((0, 0, 1)),
    "bottom": Vector((0, 0, -1)),
}


def camera(direction, centre, extent, ortho=True, hero=False):
    cd = bpy.data.cameras.new("cam")
    cam = link(bpy.data.objects.new("cam", cd))
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = extent * 1.18
    else:
        cd.lens = 50
    dist = extent * (2.1 if hero else 4)
    cam.location = centre + direction.normalized() * dist
    up = "Y" if abs(direction.z) < 0.9 else "Y"
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", up).to_euler()
    if direction.z > 0.9:  # top view: front of the object at the bottom of the image
        cam.rotation_euler = (0, 0, 0)
    elif direction.z < -0.9:  # bottom view: looking up, front at the bottom of the image
        cam.rotation_euler = (math.pi, 0, 0)
    cd.clip_end = dist * 4
    bpy.context.scene.camera = cam
    return cam


def composite(path):
    """Transparent render → the pale blue drawing background (pure Python, no PIL needed)."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = list(img.pixels)
    bg = [c / 255 for c in DRAWING_BG]
    for i in range(0, len(px), 4):
        a = px[i + 3]
        for k in range(3):
            # pixels are linear in Blender's float buffer for PNG? Saved PNG is display-referred sRGB.
            px[i + k] = px[i + k] * a + bg[k] * (1 - a)
        px[i + 3] = 1.0
    img.pixels = px
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def finish(out_dir, name, views=("front", "right", "back", "left", "top"), hero_dir=(-1.0, -1.4, 0.7),
           px=1024, samples=64):
    os.makedirs(out_dir, exist_ok=True)
    to_meshes()  # curve bound boxes are unreliable; meshes measure right and render the same
    lo, hi = bounds()
    centre = (lo + hi) / 2
    size = hi - lo
    lights()
    render_setup(px, samples)
    sc = bpy.context.scene
    for v in views:
        d = VIEWS[v]
        # extent seen by this camera: the two axes across it
        if v in ("front", "back"):
            ext = max(size.x, size.z)
        elif v in ("left", "right"):
            ext = max(size.y, size.z)
        else:
            ext = max(size.x, size.y)
        cam = camera(d, centre, ext)
        sc.render.filepath = os.path.join(out_dir, f"{v}.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam)
        print("view", v, flush=True)
    cam = camera(Vector(hero_dir), centre, max(size), ortho=False, hero=True)
    sc.render.filepath = os.path.join(out_dir, "hero.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    # GLB: lights and cameras out, curves → meshes, modifiers applied.
    for ob in list(sc.objects):
        if ob.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(ob)
    to_meshes()
    bpy.ops.object.select_all(action="DESELECT")
    for ob in sc.objects:  # helpers (boolean cutters) are hidden from render: not exported either
        ob.hide_viewport = False
        ob.select_set(not ob.hide_render)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f"{name}.glb"), export_format="GLB",
                              export_apply=True, use_selection=True, export_yup=True)
    tris = sum(len(p.vertices) - 2 for ob in sc.objects if ob.type == "MESH" and not ob.hide_render
               for p in ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons)
    print(f"glb {name} ~{tris} triangles, size {tuple(round(x, 2) for x in size)}", flush=True)


def out_dir_arg(default):
    return sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else default)
