import { MAX_PANES, RECIPE_MATERIALS, type RecipePart } from '@/lib/object-shape';
import { FACES, MAX_REPEAT, WALL_FACES, type Component } from '@/lib/shape-script';
import { cardText } from './skills';
import type { RoundFeedback } from './shape-stages';
import type { OpTrial } from './stage-steps';

/**
 * Stage prompt (PG-T15): one Spark call per loop round. The image is target | model | diff for
 * the current stage; the question carries the stage, its scores, the locked components
 * (read-only) and the editable ones with their current values. Spark answers ShapeScript patch
 * ops for this stage only; the compiler checks every op (it never writes vertices or code).
 * Pure: prompt, schema, question, parsing. The round itself lives in `shape-stages-spark.ts`.
 */

/** Bump when the wording changes; logged with every stage call (eval keeps the best). */
export const SHAPE_SCRIPT_PROMPT_VERSION = 3;
/** Version 4 (PQ-T15): version 3 + the Stage ops card. Opt-in (`SHAPE_LOOP_CARDS`). */
export const SHAPE_SCRIPT_CARDS_VERSION = 4;
/** Most ops kept from one answer. */
export const MAX_STAGE_OPS = 12;
/** Ops Spark may use; `add` only for boxes (no rings, no lathe profiles). */
export const SPARK_OPS = ['set', 'cut', 'remove', 'repeat', 'material', 'attach', 'add'] as const;

/** What the stage image shows: the house elevation sheet, or the views sheet (PG-T20). */
export type StageSheet = 'elevation' | 'views';

const SHEET_LINES: Record<StageSheet, ReadonlyArray<string>> = {
  elevation: [
    'You improve a 3D model of ONE object, one build stage at a time, so it matches its validated 2D front elevation.',
    'The image has three tiles side by side: left = the drawing (target), middle = our model rendered flat from the same front view and scale, right = the difference (grey = right, red = drawn but missing, blue = built but not drawn, amber = wrong part).',
  ],
  views: [
    'You improve a 3D model of ONE object, one build stage at a time, so it matches its validated 2D drawings.',
    'The image is a 2 × 2 sheet: top-left = the front drawing (target), top-right = our model seen from the front; bottom-left = the side drawing (blank when none), bottom-right = our model seen from the side (its front on the left). Each tile is framed on the object.',
  ],
};

/** Kinds Spark may give a part it adds (boxes only). */
export const SPARK_ADD_KINDS = [
  'window',
  'door',
  'chimney',
  'step',
  'plinth',
  'light',
  'bumper',
  'grille',
  'handle',
  'display',
  'cell',
] as const;

const promptLines = (sheet: StageSheet) => [
  ...SHEET_LINES[sheet],
  'You answer a list of edit ops on NAMED components of the current stage only. Locked components are read-only: never name them.',
  'Units: positions `at` and sizes `size` are [x, y, z] fractions of the whole object (x right, y up, z toward the viewer, centre 0). For `cut` and `attach`, u and v are 0–1 across the parent face (u left → right as seen from outside, v ground → top).',
  `Ops: set {id, at?, size?, grid?, leaves?, glazed?, panels?, sill?, lintel?, cap?, bulge?, ridge?, clip?, apex?} · cut {id, wall, kind: window|door, face (${WALL_FACES.join('|')}), u, v, w, h} = new opening on a wall · remove {id} · repeat {id, count 2–${MAX_REPEAT}, axis, step} · material {id, material, color?} · attach {id, parent, face (${FACES.join('|')}), u, v} · add {id, part: box only}.`,
  `grid = glass panes [across, down], 1–${MAX_PANES} each; leaves 1|2; glazed = share of a door glazed from its top (0–0.8); bulge = rounded eave of a thatch roof (0–0.3 of the roof height); ridge = hip ridge length share (0 pyramid, 1 gable); clip = half-hip: vertical gable at each end up to this share of the roof height (0 full hip, ≤ 0.9).`,
  `material = one of: ${RECIPE_MATERIALS.join(', ')}.`,
  'Fix the largest red and blue areas first. Small steps: a patch is kept only if the stage score rises. Empty list when the stage already matches.',
  'Answer ONLY JSON. Never give metres, watts or any energy value.',
];

/** System prompt of the stage loop for one kind of sheet (prompt v`SHAPE_SCRIPT_PROMPT_VERSION`). */
export const shapeScriptSystemPrompt = (sheet: StageSheet = 'elevation', cards = false) =>
  cards ? `${promptLines(sheet).join(' ')}\n\n${cardText('stages')}` : promptLines(sheet).join(' ');

/** The house elevation variant (kept for callers and tests). */
export const SHAPE_SCRIPT_SYSTEM_PROMPT = shapeScriptSystemPrompt('elevation');

const num = { type: 'number' };
const vec3 = { type: 'array', items: num, minItems: 3, maxItems: 3 };

export const SHAPE_SCRIPT_JSON_SCHEMA = {
  name: 'ShapeStagePatch',
  schema: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        maxItems: MAX_STAGE_OPS,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: [...SPARK_OPS] },
            id: { type: 'string' },
            at: vec3,
            size: vec3,
            wall: { type: 'string' },
            parent: { type: 'string' },
            part: {
              type: 'object',
              properties: {
                shape: { type: 'string', enum: ['box'] },
                at: vec3,
                size: vec3,
                color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                material: { type: 'string', enum: [...RECIPE_MATERIALS] },
                kind: { type: 'string', enum: [...SPARK_ADD_KINDS] },
              },
              required: ['shape', 'at', 'size', 'color'],
            },
            kind: { type: 'string', enum: ['window', 'door'] },
            face: { type: 'string', enum: [...FACES] },
            u: num,
            v: num,
            w: num,
            h: num,
            count: { type: 'integer' },
            axis: { type: 'string', enum: ['x', 'y', 'z'] },
            step: num,
            material: { type: 'string', enum: [...RECIPE_MATERIALS] },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            grid: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
            leaves: { type: 'integer' },
            glazed: num,
            panels: { type: 'integer' },
            sill: { type: 'boolean' },
            lintel: { type: 'boolean' },
            cap: { type: 'boolean' },
            bulge: num,
            ridge: num,
            clip: num,
            apex: num,
          },
          required: ['op', 'id'],
        },
      },
    },
    required: ['ops'],
  },
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const OPTION_KEYS = [
  'grid',
  'leaves',
  'glazed',
  'panels',
  'sill',
  'lintel',
  'cap',
  'bulge',
  'ridge',
  'clip',
  'apex',
] as const;

/** One component on one line: id, kind, shape, placement and the options it carries. */
export function describeComponent(c: Component): string {
  const p: RecipePart = c.part;
  const opts = OPTION_KEYS.filter((k) => p[k] !== undefined).map(
    (k) => `${k} ${JSON.stringify(p[k])}`
  );
  return [
    `${c.id} (${p.kind ?? p.shape}${p.kind ? ` ${p.shape}` : ''}${c.parent ? ` on ${c.parent}` : ''})`,
    `at [${p.at.map(r3).join(', ')}]`,
    `size [${p.size.map(r3).join(', ')}]`,
    ...(p.material ? [p.material] : []),
    ...opts,
  ].join(' ');
}

export interface StageQuestionInput {
  label: string;
  stage: string;
  round: number;
  score: { stage: number; overall: number };
  components: ReadonlyArray<Component>;
  editable: ReadonlyArray<string>;
  /** Plain hints from the measurement (e.g. « 3 openings drawn, 2 built »). */
  notes?: ReadonlyArray<string>;
  /** What the previous round's ops did (a retry after no gain). */
  feedback?: RoundFeedback;
  /** Muse cards on (PQ-T15): the final check reads its card instead of the short line. */
  cards?: boolean;
}

const OUTCOME_TEXT: Record<OpTrial['outcome'], string> = {
  kept: 'kept',
  worse: 'made the score worse, dropped',
  no_effect: 'changed nothing',
  dropped: 'refused',
};

/**
 * The previous round, op by op: what was kept (at a smaller step when it overshot), what made
 * things worse, what changed nothing (e.g. a `set` with no usable field) or was refused.
 */
export function feedbackLines(f: RoundFeedback): string[] {
  const ops = f.trials.map((t) => {
    const name = `${t.op}${t.id ? ` ${t.id}` : ''}`;
    if (t.outcome === 'kept' && t.share !== undefined && t.share < 1)
      return `${name}: overshot, kept at ${Math.round(t.share * 100)} % of the step`;
    if (t.outcome === 'no_effect')
      return `${name}: changed nothing${t.fields.length ? ` (fields ${t.fields.join(', ')})` : ' (no field)'}`;
    if (t.outcome === 'dropped') return `${name}: refused (${t.reason ?? 'invalid'})`;
    return `${name}: ${OUTCOME_TEXT[t.outcome]}`;
  });
  return [
    `Previous round ${f.round}: ${f.kept ? 'part of your patch was kept' : 'no op raised the stage score'}.`,
    ...ops.map((o) => `- ${o}`),
    ...(f.refused ? [`- ${f.refused} op(s) named parts outside this stage: refused`] : []),
    f.kept
      ? 'Go on from the current model.'
      : 'Try a different fix: smaller moves, other parts, only the listed op fields.',
  ];
}

/** The question sent with the stage sheet. */
export function stageQuestion(q: StageQuestionInput): string {
  const name = q.label.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  const edit = q.components.filter((c) => q.editable.includes(c.id));
  const locked = q.components.filter((c) => !q.editable.includes(c.id));
  return [
    `Object: "${name}". Stage: ${q.stage} (round ${q.round}). Stage score ${Math.round(q.score.stage * 100)} %, whole model ${Math.round(q.score.overall * 100)} %.`,
    ...(q.notes?.length ? [`Measured: ${q.notes.join('; ')}.`] : []),
    ...(q.feedback ? feedbackLines(q.feedback) : []),
    ...(q.stage === 'final'
      ? [
          q.cards
            ? cardText('final')
            : 'Final check: every earlier stage is done. Compare the WHOLE model with the drawing, part by part, and fix what still differs (missing, extra, misplaced or wrongly sized parts, wrong materials). Empty list when the model already matches.',
        ]
      : []),
    `Editable components:\n${edit.map(describeComponent).join('\n') || '(none yet — add or cut them)'}`,
    `Locked (read-only):\n${locked.map(describeComponent).join('\n') || '(none)'}`,
    'Answer only the JSON ops for this stage.',
  ].join('\n');
}

/**
 * Spark's reply → raw ops (the compiler validates each one), capped; `add` kept for boxes only.
 * Null when the reply is not JSON with an `ops` list. Never throws.
 */
export function parseStageOps(content: string): unknown[] | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const list =
    json && typeof json === 'object' && Array.isArray((json as { ops?: unknown }).ops)
      ? ((json as { ops: unknown[] }).ops as unknown[])
      : null;
  if (!list) return null;
  const ops: unknown[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (!(SPARK_OPS as ReadonlyArray<unknown>).includes(o.op)) continue;
    if (o.op === 'add') {
      const part = o.part as Record<string, unknown> | undefined;
      if (!part || part.shape !== 'box' || 'points' in part || 'profile' in part) continue;
    }
    ops.push(raw);
    if (ops.length >= MAX_STAGE_OPS) break;
  }
  return ops;
}
