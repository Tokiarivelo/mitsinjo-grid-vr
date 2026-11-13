import { z } from 'zod';
import { RECIPE_MATERIALS, type RecipeMaterial } from '@/lib/object-shape';

/**
 * Naming the colour classes (PQ-T69), the one thing the reconstruction asks of a language model.
 * The code has already measured everything; the model only says what each class is made of, by
 * tile number, from a closed list. A wrong or missing answer costs a surface look, never geometry.
 */

export const LABEL_SYSTEM_PROMPT = [
  'You name the materials of an object drawn in flat views.',
  'The image is a row of tiles. Tile 0 (leftmost) is the object as drawn.',
  'Every next tile shows the same object in grey with ONE region in red: tile 1, tile 2, … left to right.',
  'For each red region, look at tile 0 at the same place and say what that part is made of.',
  `Answer only with a material from this list: ${RECIPE_MATERIALS.join(', ')}, or "unknown" when none fits or you cannot tell.`,
  'Never describe shapes, sizes or positions. Answer every tile exactly once.',
  'Example for 3 tiles of a house: {"tiles":[{"tile":1,"material":"plaster"},{"tile":2,"material":"tile"},{"tile":3,"material":"glass"}]}',
].join('\n');

export const LABEL_JSON_SCHEMA = {
  name: 'ClassMaterials',
  schema: {
    type: 'object',
    properties: {
      tiles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tile: { type: 'integer', minimum: 1 },
            material: { type: 'string', enum: [...RECIPE_MATERIALS, 'unknown'] },
          },
          required: ['tile', 'material'],
        },
      },
    },
    required: ['tiles'],
  },
} as const;

/** The question of one sheet: the object's name and how many tiles to answer. */
export function buildLabelQuestion(label: string, classes: number): string {
  return `Object: ${label}. The sheet has tile 0 and ${classes} red-region tile${classes > 1 ? 's' : ''} (1 to ${classes}). Give the material of each.`;
}

const AnswerSchema = z.object({
  tiles: z.array(z.object({ tile: z.number().int(), material: z.string() })),
});

/**
 * `materials[class]` from the model's answer (tile n = class n − 1). Lenient per tile: an unknown
 * tile number, a word outside the list or a repeated tile is dropped and that class stays
 * unnamed. Null when the answer is not the asked JSON at all.
 */
export function parseClassMaterials(
  content: string,
  classes: number
): Array<RecipeMaterial | undefined> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) return null;
  const out: Array<RecipeMaterial | undefined> = Array(classes).fill(undefined);
  const seen = new Set<number>();
  for (const { tile, material } of parsed.data.tiles) {
    if (tile < 1 || tile > classes || seen.has(tile)) continue;
    seen.add(tile);
    if ((RECIPE_MATERIALS as readonly string[]).includes(material))
      out[tile - 1] = material as RecipeMaterial;
  }
  return out;
}
