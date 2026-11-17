import { z } from 'zod';
import { Box, Share, answerObject, items, opt, quad, share, type SharedSpec } from './common';

/**
 * The shared profile specialist (PQ-T86): the main body of the object — its box on each drawing,
 * the shape of its top and its sides, and the horizontal lines across it (seat line, worktop,
 * plinth, lid). Proportions only, in shares of each drawing: the code measures the sizes on the
 * outline. What stands under the body is the legs specialist's; what is cut in it, the openings'.
 */

export const PROFILE_TOPS = ['flat', 'rounded', 'sloped', 'peaked', 'domed', 'stepped'] as const;
export const PROFILE_SIDES = ['straight', 'tapered', 'flared', 'curved', 'waisted'] as const;

export interface ProfileConfig {
  subject: string;
  frame: string;
  views: ReadonlyArray<string>;
  /** Names of the horizontal lines this kind of object has (seat, arm, back for a sofa). */
  lines?: ReadonlyArray<readonly [name: string, note: string]>;
  notes?: ReadonlyArray<string>;
  schemaName?: string;
}

export const PROFILE_TASK = 'Read its main body: box, top, sides and lines on each drawing.';

export function profileSpec(cfg: ProfileConfig): SharedSpec {
  const lines = cfg.lines ?? [];
  return {
    key: 'profile',
    task: PROFILE_TASK,
    system: [
      `You are the profile specialist of a 3D modelling team. On the orthographic drawings of ${cfg.subject}, you read the shape of its main body.`,
      cfg.frame,
      `One entry per drawing (${cfg.views.join(', ')}): body = [x0, y0, x1, y1] of the main body without what stands under it (legs, plinth, castors) and without small parts sticking out; top = ${PROFILE_TOPS.join(', ')}; sides = ${PROFILE_SIDES.join(', ')} (tapered = narrower at the top, flared = wider at the top); symmetric = true when its left and right halves mirror each other.`,
      lines.length
        ? `lines = the y of each line it has, only those you see: ${lines.map(([n, note]) => `${n} (${note})`).join(', ')}.`
        : 'lines = the y of the horizontal lines across it (a lid, a worktop, a plinth line), if any.',
      ...(cfg.notes ?? []),
    ].join('\n'),
    schema: {
      name: cfg.schemaName ?? 'Profile',
      schema: {
        type: 'object',
        properties: {
          profile: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                view: { type: 'string', enum: [...cfg.views] },
                body: quad,
                top: { type: 'string', enum: [...PROFILE_TOPS] },
                sides: { type: 'string', enum: [...PROFILE_SIDES] },
                symmetric: { type: 'boolean' },
                lines: lines.length
                  ? {
                      type: 'object',
                      properties: Object.fromEntries(lines.map(([n]) => [n, share])),
                    }
                  : { type: 'array', items: share },
              },
              required: ['view', 'body'],
            },
          },
        },
        required: ['profile'],
      },
    },
  };
}

export const ReadProfileSchema = z.object({
  view: z.string(),
  body: Box.refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0),
  top: opt(z.enum(PROFILE_TOPS)),
  sides: opt(z.enum(PROFILE_SIDES)),
  symmetric: opt(z.boolean()),
  lines: opt(z.union([z.record(z.string(), Share), z.array(Share)])),
});
export type ReadProfile = z.infer<typeof ReadProfileSchema>;

/** Whether the profile specialist answered: at least one body box on a drawing of the team. */
export const profileAnswered = (
  content: string | null | undefined,
  cfg: Pick<ProfileConfig, 'views'>
) => parseProfile(content, cfg).length > 0;

/** One body per drawing (the first one given), on the team's views only. */
export function parseProfile(
  content: string | null | undefined,
  cfg: Pick<ProfileConfig, 'views'>
): ReadProfile[] {
  const seen = new Set<string>();
  return items(ReadProfileSchema, answerObject(content)?.profile).filter((p) => {
    if (!cfg.views.includes(p.view) || seen.has(p.view)) return false;
    seen.add(p.view);
    return true;
  });
}
