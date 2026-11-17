import { z } from 'zod';
import { Box, answerObject, items, listAnswered, opt, quad, type SharedSpec } from './common';

/**
 * The shared legs specialist (PQ-T86): what the object stands on — legs, a plinth, a pedestal,
 * castors, sled runners, trestles, a frame — for furniture, tables, tanks, panels, appliances.
 * It names and boxes each support on the drawing it is on and counts them; sizes are measured on
 * the drawings by the code. An empty list = the object sits on the ground by its body.
 */

export const LEG_KINDS = [
  'leg',
  'plinth',
  'pedestal',
  'caster',
  'sled',
  'trestle',
  'frame',
  'bracket',
] as const;
export type LegKind = (typeof LEG_KINDS)[number];
export const LEG_SECTIONS = ['square', 'round', 'flat', 'turned'] as const;

export interface LegsConfig {
  subject: string;
  frame: string;
  views: ReadonlyArray<string>;
  notes?: ReadonlyArray<string>;
  schemaName?: string;
}

export const LEGS_TASK = 'List what it stands on: legs, plinth, pedestal, castors or runners.';

export function legsSpec(cfg: LegsConfig): SharedSpec {
  return {
    key: 'legs',
    task: LEGS_TASK,
    system: [
      `You are the supports specialist of a 3D modelling team. On the orthographic drawings of ${cfg.subject}, you find what it stands on.`,
      cfg.frame,
      `kind: leg (a post under a corner or a side), plinth (a closed base box), pedestal (one central column on a foot), caster (a wheel), sled (a runner or a bent tube along the floor), trestle (an A-shaped or X-shaped support), frame (a welded or bent frame carrying the body), bracket (a wall bracket, the object does not reach the floor).`,
      `One entry per kind of support as seen on ONE drawing (${cfg.views.join(', ')}): box = [x0, y0, x1, y1] of ONE of them on that drawing (the front-left one), count = how many the whole object stands on (four legs = 4, seen or hidden), section = ${LEG_SECTIONS.join(', ')}, splay = true when they lean outward, taper = true when they get thinner toward the floor.`,
      'An object resting on the floor by its own body (a pouf, a floor cushion, a rock) has an empty list.',
      ...(cfg.notes ?? []),
    ].join('\n'),
    schema: {
      name: cfg.schemaName ?? 'Legs',
      schema: {
        type: 'object',
        properties: {
          legs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: [...LEG_KINDS] },
                view: { type: 'string', enum: [...cfg.views] },
                box: quad,
                count: { type: 'integer', minimum: 1, maximum: 16 },
                section: { type: 'string', enum: [...LEG_SECTIONS] },
                splay: { type: 'boolean' },
                taper: { type: 'boolean' },
              },
              required: ['kind', 'view', 'box', 'count'],
            },
          },
        },
        required: ['legs'],
      },
    },
  };
}

export const ReadLegSchema = z.object({
  kind: z.enum(LEG_KINDS),
  view: z.string(),
  box: Box,
  count: z.number().int().min(1).max(16),
  section: opt(z.enum(LEG_SECTIONS)),
  splay: opt(z.boolean()),
  taper: opt(z.boolean()),
});
export type ReadLeg = z.infer<typeof ReadLegSchema>;

export const legsAnswered = (content: string | null | undefined) => listAnswered(content, 'legs');

/** The supports of an answer on the team's views (other views and unknown kinds dropped). */
export function parseLegs(
  content: string | null | undefined,
  cfg: Pick<LegsConfig, 'views'>
): ReadLeg[] {
  return items(ReadLegSchema, answerObject(content)?.legs).filter((l) =>
    cfg.views.includes(l.view)
  );
}
