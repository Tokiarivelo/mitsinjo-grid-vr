import { z } from 'zod';
import {
  Box,
  Hex,
  hex,
  items,
  listAnswered,
  opt,
  quad,
  answerObject,
  type SharedSpec,
} from './common';

/**
 * The shared finishes specialist (PQ-T86): each finish of the object (a closed list of the team),
 * its material, its colour as drawn and a sample box on one drawing that shows only that finish.
 * One prompt and one schema for every team (house, car, furniture…), each team naming its own
 * finishes, materials and views; the colours are re-measured on the drawings by the code.
 */

export interface FinishesConfig {
  /** What the drawings show, as the prompt says it ("ONE building", "ONE car"). */
  subject: string;
  /** The team's frame (where x and y run). */
  frame: string;
  /** Each finish and what it is on this kind of object. */
  finishes: ReadonlyArray<readonly [name: string, note: string]>;
  materials: ReadonlyArray<string>;
  views: ReadonlyArray<string>;
  /** Fields every item must hold (the house asks for all, a car for the finish and its colour). */
  required: ReadonlyArray<'finish' | 'material' | 'color' | 'view' | 'box'>;
  /** Plain-colour keys beside the list (a house's trim, glass, door, base). */
  colors?: ReadonlyArray<readonly [name: string, note: string]>;
  /** A `figured` flag and when to set it (a house's half-timbering). */
  figured?: string;
  /** The team's own advice (where a roofing is best sampled…). */
  notes?: ReadonlyArray<string>;
  schemaName: string;
}

export const FINISHES_TASK = 'Name its finishes, their colours and where to sample each.';

/** The specialist for one team's vocabulary. */
export function finishesSpec(cfg: FinishesConfig): SharedSpec {
  const names = cfg.finishes.map(([n]) => n);
  return {
    key: 'finishes',
    task: FINISHES_TASK,
    system: [
      `You are the materials specialist of a 3D modelling team. On the orthographic drawings of ${cfg.subject}, you name each finish, its true colour as drawn, and where to sample it.`,
      cfg.frame,
      `Finishes: ${cfg.finishes.map(([n, note]) => `${n} (${note})`).join(', ')}. Materials: ${cfg.materials.join(', ')}.`,
      `For each finish present: material, color (hex of its average colour in plain light: not in shadow, not a reflection or a highlight), view (${cfg.views.join(', ')}) and box = [x0, y0, x1, y1] of a sample on that drawing that shows ONLY this finish: no opening, no frame, no post, no shadow, no edge, as large as possible.`,
      ...(cfg.notes ?? []),
      cfg.figured ?? '',
      cfg.colors?.length
        ? `Also: ${cfg.colors.map(([n, note]) => `${n} (${note})`).join(', ')} as hex colours.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      name: cfg.schemaName,
      schema: {
        type: 'object',
        properties: {
          finishes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                finish: { type: 'string', enum: names },
                material: { type: 'string', enum: [...cfg.materials] },
                color: hex,
                view: { type: 'string', enum: [...cfg.views] },
                box: quad,
                ...(cfg.figured ? { figured: { type: 'boolean' } } : {}),
              },
              required: [...cfg.required],
            },
          },
          ...Object.fromEntries((cfg.colors ?? []).map(([n]) => [n, hex])),
        },
        required: ['finishes'],
      },
    },
  };
}

export interface ReadFinish {
  finish: string;
  material?: string;
  color: string;
  view?: string;
  box?: [number, number, number, number];
  figured?: boolean;
}

/** Whether the finishes specialist answered (its list, even empty). */
export const finishesAnswered = (content: string | null | undefined) =>
  listAnswered(content, 'finishes');

/** The finishes of an answer in the team's vocabulary (unknown names and materials dropped). */
export function parseFinishes(
  content: string | null | undefined,
  cfg: Pick<FinishesConfig, 'finishes' | 'materials' | 'views'>
): ReadFinish[] {
  const names = cfg.finishes.map(([n]) => n);
  const schema = z.object({
    finish: z.string().refine((n) => names.includes(n)),
    material: opt(z.string().refine((m) => cfg.materials.includes(m))),
    color: Hex,
    view: opt(z.string().refine((v) => cfg.views.includes(v))),
    box: opt(Box),
    figured: opt(z.boolean()),
  });
  return items(schema, answerObject(content)?.finishes) as ReadFinish[];
}
