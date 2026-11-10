import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import { type AssemblyDetail, layoutOpenings, type WallHole } from './openings';
import { expandChimneyCaps, expandRoofTrim } from './roof-trim';
import { timberBeams } from './timber';
import { expandViewAssemblies } from './view-assemblies';

/** Expanded parts, the holes to cut in their walls, and the recipe part index each one comes from. */
export interface ExpandedAssemblies {
  parts: RecipePart[];
  holes: Map<RecipePart, WallHole[]>;
  origin: number[];
}

/**
 * Every assembly of a recipe expanded into plain parts, as the viewer draws them (PG-T8…T21) and the
 * flat render judges them (PQ-T3): window and door frames, panes and sills (with the holes to cut in
 * their walls), thatch eave rolls, chimney caps, wheel rims, solar cell lines and timber beams.
 * `overhang` = the viewer's extra roof reach (world units), 0 where roofs are drawn as recipe boxes.
 * `origin[i]` = the recipe part that `parts[i]` details (a frame → its window, a rim → its wheel). Pure.
 */
export function expandAssemblies(
  recipe: ObjectRecipe,
  detail: AssemblyDetail = 'full',
  overhang = 0
): ExpandedAssemblies {
  const { parts: laid, holes } = layoutOpenings(recipe, detail);
  // Openings expand alone among the walls (same host and trim as the whole layout), so each output
  // part is known to come from its opening.
  const hosts = recipe.parts.filter((p) => p.shape === 'box' && (p.kind === 'wall' || p.front));
  const own = new Map(recipe.parts.map((p, k) => [p, k]));
  const opened: Array<{ part: RecipePart; from: number }> = recipe.parts.flatMap((p, k) => {
    if (laid.includes(p)) return [{ part: p, from: k }];
    const alone = layoutOpenings({ ...recipe, parts: [...hosts, p] }, detail).parts;
    return alone.filter((q) => !own.has(q)).map((q) => ({ part: q, from: k }));
  });
  const parts: RecipePart[] = [];
  const origin: number[] = [];
  for (const { part, from } of opened) {
    // Roof rolls, chimney caps, rims and cell lines are per-part expansions.
    const out = expandViewAssemblies(
      expandChimneyCaps(expandRoofTrim([part], recipe.proportions, overhang), recipe.proportions),
      detail
    );
    for (const q of out) {
      parts.push(q);
      origin.push(from);
    }
  }
  // Timber beams, wall by wall (the other walls' frames left out).
  recipe.parts.forEach((wall, k) => {
    if (!wall.timber) return;
    const beams = timberBeams({
      ...recipe,
      parts: recipe.parts.filter((p) => p === wall || !p.timber),
    });
    for (const b of beams) {
      parts.push(b);
      origin.push(k);
    }
  });
  return { parts, holes, origin };
}
