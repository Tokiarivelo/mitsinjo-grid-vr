import { z } from 'zod';

/**
 * What every shared specialist (PQ-T86) is built from: the JSON bits of its schema, the drawing
 * frame it measures in, and the parsers of its answer. Pure.
 */

export const share = { type: 'number', minimum: 0, maximum: 1 } as const;
export const quad = { type: 'array', items: share, minItems: 4, maxItems: 4 } as const;
export const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;
export const point = { type: 'array', items: share, minItems: 2, maxItems: 2 } as const;

export const Share = z.number().min(0).max(1);
export const Box = z.tuple([Share, Share, Share, Share]);
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().catch(undefined);

/**
 * The frame of a team whose object has no frame of its own yet (furniture, fixtures, rocks…):
 * every drawing cropped to the object, shares 0–1, y down from the top to the ground.
 */
export function objectFrame(subject = 'object'): string {
  return [
    `Every image is cropped exactly to the ${subject}: x = 0 at the left edge of the image, 1 at the right edge; y = 0 at the top of the ${subject}, 1 at the ground (or its lowest point). Give every number as a share 0–1 of the image, with 2 or 3 decimals.`,
    'Report only what the drawings show. Answer with the JSON only.',
  ].join('\n');
}

/** JSON of an answer, fenced or wrapped in prose; null when there is none. */
export function answerJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(text);
  } catch {
    const at = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (at < 0 || end <= at) return null;
    try {
      return JSON.parse(text.slice(at, end + 1));
    } catch {
      return null;
    }
  }
}

/** The answer as a JSON object; null when it is not one. */
export function answerObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content) return null;
  const j = answerJson(content);
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
}

/** Whether an answer holds its list under `key` (an empty list is an answer; no list is none). */
export const listAnswered = (content: string | null | undefined, key: string): boolean =>
  Array.isArray(answerObject(content)?.[key]);

/** Items of a list that parse, the others dropped (one bad item never loses the rest). */
export const items = <T extends z.ZodTypeAny>(schema: T, list: unknown): Array<z.infer<T>> =>
  Array.isArray(list)
    ? list.flatMap((x) => {
        const r = schema.safeParse(x);
        return r.success ? [r.data] : [];
      })
    : [];

/** A specialist made by a shared factory: what `teamSpecs` takes, plus the line closing its question. */
export interface SharedSpec {
  system: string;
  schema: { name: string; schema: object };
  task: string;
  /** The list its answer holds. */
  key: string;
}
