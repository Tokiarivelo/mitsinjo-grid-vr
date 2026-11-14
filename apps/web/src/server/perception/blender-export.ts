import 'server-only';

import { facesMesh, surfaceColor } from '@/features/vision-insert/utils/face-projection';
import { recipeMesh } from '@/features/vision-insert/utils/object-geometry';
import { HULL_SURFACES } from '@/lib/face-hull';
import { SURFACES } from '@/features/vision-insert/utils/surface-look';
import type { ObjectRecipe } from '@/lib/object-shape';

/**
 * Recipe → Blender Python (PQ-T56). The model Wonder's code built is exported exactly as the
 * viewer draws it (same `recipeMesh`, assemblies included), so a Blender render of the script
 * and the 3D editor can be compared one to one. Debug aid only: nothing in the product reads it.
 *
 * three.js is Y-up, Blender is Z-up: (x, y, z) → (x, −z, y), a pure rotation (winding kept).
 */

export interface MeshGroup {
  /** Surface name (`wood`, `glass`, …). */
  surface: string;
  /** Flat xyz of every vertex, three.js axes, un-indexed (three per triangle). */
  positions: number[];
  /** Flat linear rgb per vertex. */
  colors: number[];
}

/** One surface of a model that wears its drawings (PQ-T71): the hull with its atlas uvs. */
export interface DrawnGroup {
  /** `roof`, `front`, `right`, `back` or `left`. */
  surface: string;
  positions: number[];
  /** Flat uv per vertex in the atlas image (v up). */
  uvs: number[];
  /** The operator's colour for the surface (tint of the drawing, or colour of its material). */
  color?: string;
  /** Material that replaces the drawing on this surface, when the operator chose one. */
  material?: string;
}

/** The drawn hull of a recipe by surface, as the 3D view draws it; empty without drawn faces. */
export function drawnGroups(recipe: ObjectRecipe): DrawnGroup[] {
  if (!recipe.faces) return [];
  const geo = facesMesh({ proportions: recipe.proportions, faces: recipe.faces });
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const out = geo.groups.map((g): DrawnGroup => {
    const surface = HULL_SURFACES[g.materialIndex ?? 0]!;
    const look = recipe.faces!.surfaces?.[surface];
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let i = g.start; i < g.start + g.count; i++) {
      positions.push(r4(pos.getX(i)), r4(pos.getY(i)), r4(pos.getZ(i)));
      uvs.push(r4(uv.getX(i)), r4(uv.getY(i)));
    }
    const color = surfaceColor(look);
    return {
      surface,
      positions,
      uvs,
      ...(color ? { color } : {}),
      ...(look?.material ? { material: look.material } : {}),
    };
  });
  geo.dispose();
  return out;
}

export interface BlenderExportInput {
  label: string;
  /** Free text lines written as comments in the header (score, round, model…). */
  notes?: string[];
  groups: MeshGroup[];
  /** Surfaces of a model that wears its drawings; with them the script builds the textured hull. */
  drawn?: DrawnGroup[];
  /** The atlas of the drawings (data URL), written next to the script's temp files by Blender. */
  atlas?: string;
  /** The recipe parts as data: the python mirror of what `build()` returned. */
  recipe: ObjectRecipe;
  /** The JS body Wonder wrote, appended as a comment block when the model came from code. */
  jsCode?: string;
}

const r4 = (n: number) => Number(n.toFixed(4));

/** Mesh groups of a recipe, as the viewer builds it. */
export function recipeGroups(recipe: ObjectRecipe): MeshGroup[] {
  const geo = recipeMesh(recipe);
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const index = geo.getIndex();
  const vertexAt = (i: number) => (index ? index.getX(i) : i);
  const groups: MeshGroup[] = [];
  const spans = geo.groups.length
    ? geo.groups
    : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const g of spans) {
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = g.start; i < g.start + g.count; i++) {
      const v = vertexAt(i);
      positions.push(r4(pos.getX(v)), r4(pos.getY(v)), r4(pos.getZ(v)));
      colors.push(r4(col.getX(v)), r4(col.getY(v)), r4(col.getZ(v)));
    }
    groups.push({
      surface: SURFACES[g.materialIndex ?? 0] ?? 'plaster',
      positions,
      colors,
    });
  }
  geo.dispose();
  return groups;
}

/** A python literal for plain JSON data (None/True/False instead of null/true/false). */
function py(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent + 1);
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(r4(value));
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      return `[${value.map((v) => py(v)).join(', ')}]`;
    }
    return `[\n${value.map((v) => `${pad}${py(v, indent + 1)},`).join('\n')}\n${'    '.repeat(indent)}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${py(v, indent + 1)}`).join(', ')}}`;
}

const HEADER = `# Run in Blender: Scripting tab → Open → Run Script,
# or headless:  blender --background --python <this file> -- /path/render.png
# Units: 1 object unit = SCALE metres. Origin = object centre, Z up.`;

const BUILDER = `
import sys
import bpy

SCALE = 4.0


def to_blender(p):
    # three.js (x, y, z) Y-up -> Blender (x, -z, y) Z-up
    return (p[0] * SCALE, -p[2] * SCALE, p[1] * SCALE)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def build_group(group):
    flat = group["positions"]
    colors = group["colors"]
    count = len(flat) // 3
    verts = [to_blender(flat[i * 3 : i * 3 + 3]) for i in range(count)]
    faces = [(i, i + 1, i + 2) for i in range(0, count - count % 3, 3)]
    mesh = bpy.data.meshes.new(group["surface"])
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    # One colour per corner: the measured colour of the part, not a texture.
    layer = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    for loop in mesh.loops:
        r, g, b = colors[loop.vertex_index * 3 : loop.vertex_index * 3 + 3]
        layer.data[loop.index].color = (r, g, b, 1.0)
    mat = bpy.data.materials.new(group["surface"])
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.1 if group["surface"] == "glass" else 0.8
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(group["surface"], mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def load_atlas():
    # The drawings the model wears, embedded in this script.
    import base64, os, tempfile
    path = os.path.join(tempfile.gettempdir(), "mitsinjo_atlas.jpg")
    with open(path, "wb") as f:
        f.write(base64.b64decode(ATLAS_B64))
    return bpy.data.images.load(path)


def hex_rgb(value):
    return tuple(int(value[i : i + 2], 16) / 255.0 for i in (1, 3, 5)) + (1.0,)


def build_drawn(group, image):
    flat = group["positions"]
    count = len(flat) // 3
    verts = [to_blender(flat[i * 3 : i * 3 + 3]) for i in range(count)]
    faces = [(i, i + 1, i + 2) for i in range(0, count - count % 3, 3)]
    mesh = bpy.data.meshes.new(group["surface"])
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    layer = mesh.uv_layers.new(name="Atlas")
    for loop in mesh.loops:
        layer.data[loop.index].uv = group["uvs"][loop.vertex_index * 2 : loop.vertex_index * 2 + 2]
    mat = bpy.data.materials.new(group["surface"])
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    color = hex_rgb(group["color"]) if group.get("color") else None
    if group.get("material"):
        # The operator replaced the drawing by a material: its colour, no texture.
        bsdf.inputs["Base Color"].default_value = color or (0.7, 0.7, 0.7, 1.0)
    else:
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = "EXTEND"
        if color:
            mix = tree.nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 1.0
            mix.inputs["Color2"].default_value = color
            tree.links.new(tex.outputs["Color"], mix.inputs["Color1"])
            tree.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(group["surface"], mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def add_stage():
    bpy.ops.object.light_add(type="SUN", location=(4, -6, 10))
    bpy.context.object.data.energy = 3.0
    bpy.ops.object.camera_add(location=(7.0, -9.0, 5.0), rotation=(1.15, 0.0, 0.62))
    bpy.context.scene.camera = bpy.context.object
    bpy.context.scene.world = bpy.data.worlds.new("bg")
    bpy.context.scene.world.color = (0.75, 0.78, 0.82)


def main():
    clear_scene()
    if DRAWN:
        # The model wears its drawings: the textured hull, as in the 3D view.
        image = load_atlas()
        for group in DRAWN:
            build_drawn(group, image)
    else:
        for group in GROUPS:
            build_group(group)
    add_stage()
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if argv:
        bpy.context.scene.render.filepath = argv[0]
        bpy.ops.render.render(write_still=True)


main()
`;

/** The Blender script of one model. Pure string building: no three.js, no Blender needed here. */
export function blenderScript(input: BlenderExportInput): string {
  const { label, notes = [], groups, recipe, jsCode, drawn = [], atlas } = input;
  const atlasB64 = drawn.length && atlas ? atlas.slice(atlas.indexOf(',') + 1) : '';
  const parts = recipe.parts.map((p) => {
    const { shape, at, size, color, material, kind, ...rest } = p;
    return { shape, at, size, color, material, kind, ...rest };
  });
  const out = [
    `# Mitsinjo Grid — 3D model of "${label.replace(/[\r\n]+/g, ' ')}" (debug export, PQ-T56)`,
    ...notes.map((n) => `# ${n.replace(/[\r\n]+/g, ' ')}`),
    HEADER,
    '',
    `# Proportions (largest side = 1): ${py(recipe.proportions)}`,
    `PROPORTIONS = ${py(recipe.proportions)}`,
    '',
    '# The parts the construction code returned (python mirror of build(api, params)).',
    `PARTS = ${py(parts)}`,
    '',
    '# Meshes exactly as the 3D editor draws them (assemblies expanded), one group per surface.',
    'GROUPS = [',
    ...groups.map(
      (g) =>
        `    {"surface": ${JSON.stringify(g.surface)}, "positions": ${py(g.positions)}, "colors": ${py(g.colors)}},`
    ),
    ']',
    '',
    '# The hull wearing the validated drawings (uvs in the atlas), one group per surface; empty',
    '# for a model in flat colours. With it, main() builds this instead of GROUPS.',
    `ATLAS_B64 = ${JSON.stringify(atlasB64)}`,
    'DRAWN = [',
    ...(atlasB64 ? drawn : []).map(
      (g) =>
        `    {"surface": ${JSON.stringify(g.surface)}, "positions": ${py(g.positions)}, "uvs": ${py(g.uvs)}, "color": ${py(g.color ?? null)}, "material": ${py(g.material ?? null)}},`
    ),
    ']',
    BUILDER,
  ];
  if (jsCode) {
    out.push(
      '',
      '# ── build() body written by the code model (JavaScript, runs in the QuickJS sandbox) ──',
      ...jsCode.split('\n').map((l) => `# ${l}`)
    );
  }
  return out.join('\n');
}

/** Convenience: recipe → script, the viewer's own mesh included. */
export function recipeToBlender(
  recipe: ObjectRecipe,
  meta: Pick<BlenderExportInput, 'label' | 'notes' | 'jsCode'>
): string {
  return blenderScript({
    ...meta,
    groups: recipeGroups(recipe),
    recipe,
    ...(recipe.faces ? { drawn: drawnGroups(recipe), atlas: recipe.faces.atlas } : {}),
  });
}
