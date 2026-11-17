import { z } from 'zod';
import {
  Box,
  Share,
  answerObject,
  items,
  listAnswered,
  opt,
  point,
  quad,
  type SharedSpec,
} from './common';

/**
 * The shared openings specialist (PQ-T86): every window, door, glazed panel or opening of the
 * object, one entry each, on the drawing it is on. A house frames each opening by a box with its
 * panes and its head; a car traces each window's outline; a cabinet's glazed doors, a door or a
 * mirror take either. One prompt and one schema, each team naming its kinds and its shape.
 */

export const OPENING_HEADS = ['flat', 'arch', 'segment'] as const;

export interface OpeningsConfig {
  /** What the drawings show, as the prompt says it ("ONE building"). */
  subject: string;
  frame: string;
  /** What it lists, in plain words ("every window, door, … of every elevation"). */
  what: string;
  /** The list key of the answer (`openings` for a house, `windows` for a car). */
  key: string;
  kinds: ReadonlyArray<string>;
  views: ReadonlyArray<string>;
  /** A box per opening, or its outline as 3–8 points. */
  shape: 'box' | 'outline';
  /** Glass panes as [columns, rows] (a house's windows, a glazed door). */
  panes?: boolean;
  /** Arched or flat heads. */
  heads?: boolean;
  /** The team's own rules (what counts, what never does). */
  notes?: ReadonlyArray<string>;
  schemaName: string;
  task: string;
}

/** The specialist for one team's vocabulary. */
export function openingsSpec(cfg: OpeningsConfig): SharedSpec {
  const where =
    cfg.shape === 'box'
      ? 'box = [x0, y0, x1, y1] of its OUTER frame on that drawing, including an arched top'
      : 'points = its outline as 3 to 8 points [x, y] in order round it';
  return {
    key: cfg.key,
    task: cfg.task,
    system: [
      `You are the openings specialist of a 3D modelling team. On the orthographic drawings of ${cfg.subject}, you list ${cfg.what}.`,
      cfg.frame,
      `One entry each (a row of 4 windows = 4 entries). view = the drawing it is on (${cfg.views.join(', ')}); kind = one of ${cfg.kinds.join(', ')}; ${where}${cfg.panes ? '; panes = [columns, rows] of glass panes' : ''}.`,
      cfg.heads
        ? `head: ${OPENING_HEADS.join(', ')} — "arch" when the top is a round arch, "segment" when it is a flat curve, else "flat".`
        : '',
      ...(cfg.notes ?? []),
    ]
      .filter(Boolean)
      .join('\n'),
    schema: {
      name: cfg.schemaName,
      schema: {
        type: 'object',
        properties: {
          [cfg.key]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                view: { type: 'string', enum: [...cfg.views] },
                kind: { type: 'string', enum: [...cfg.kinds] },
                ...(cfg.shape === 'box'
                  ? { box: quad }
                  : { points: { type: 'array', items: point, minItems: 3, maxItems: 8 } }),
                ...(cfg.panes
                  ? {
                      panes: {
                        type: 'array',
                        items: { type: 'integer', minimum: 1, maximum: 8 },
                        minItems: 2,
                        maxItems: 2,
                      },
                    }
                  : {}),
                ...(cfg.heads ? { head: { type: 'string', enum: [...OPENING_HEADS] } } : {}),
              },
              required: ['view', 'kind', cfg.shape === 'box' ? 'box' : 'points'],
            },
          },
        },
        required: [cfg.key],
      },
    },
  };
}

export interface ReadOpening {
  view: string;
  kind: string;
  box?: [number, number, number, number];
  points?: Array<[number, number]>;
  panes?: [number, number];
  head?: (typeof OPENING_HEADS)[number];
}

/** Whether the openings specialist answered (its list, even empty). */
export const openingsAnswered = (
  content: string | null | undefined,
  cfg: Pick<OpeningsConfig, 'key'>
) => listAnswered(content, cfg.key);

/** The openings of an answer in the team's vocabulary; each needs its box or its outline. */
export function parseOpenings(
  content: string | null | undefined,
  cfg: Pick<OpeningsConfig, 'key' | 'kinds' | 'views' | 'shape'>
): ReadOpening[] {
  const Pane = z.number().int().min(1).max(8);
  const schema = z
    .object({
      view: z.string().refine((v) => cfg.views.includes(v)),
      kind: z.string().refine((k) => cfg.kinds.includes(k)),
      box: opt(Box),
      points: opt(
        z
          .array(z.tuple([Share, Share]))
          .min(3)
          .max(8)
      ),
      panes: opt(z.tuple([Pane, Pane])),
      head: opt(z.enum(OPENING_HEADS)),
    })
    .refine((o) => (cfg.shape === 'box' ? o.box : o.points));
  return items(schema, answerObject(content)?.[cfg.key]) as ReadOpening[];
}
