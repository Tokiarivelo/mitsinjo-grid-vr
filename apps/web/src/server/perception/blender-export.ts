import 'server-only';

import { recipeMesh } from '@/features/vision-insert/utils/object-geometry';
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

export interface BlenderExportInput {
  label: string;
  /** Free text lines written as comments in the header (score, round, model…). */
  notes?: string[];
  groups: MeshGroup[];
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


def add_stage():
    bpy.ops.object.light_add(type="SUN", location=(4, -6, 10))
    bpy.context.object.data.energy = 3.0
    bpy.ops.object.camera_add(location=(7.0, -9.0, 5.0), rotation=(1.15, 0.0, 0.62))
    bpy.context.scene.camera = bpy.context.object
    bpy.context.scene.world = bpy.data.worlds.new("bg")
    bpy.context.scene.world.color = (0.75, 0.78, 0.82)


def main():
    clear_scene()
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
  const { label, notes = [], groups, recipe, jsCode } = input;
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
  return blenderScript({ ...meta, groups: recipeGroups(recipe), recipe });
}
