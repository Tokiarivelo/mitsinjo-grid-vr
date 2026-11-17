import { answerObject, objectFrame, type SharedSpec } from '../shared/common';
import { finishesAnswered, finishesSpec, parseFinishes, type ReadFinish } from '../shared/finishes';
import { legsAnswered, legsSpec, parseLegs, type ReadLeg } from '../shared/legs';
import { parseProfile, profileAnswered, profileSpec, type ReadProfile } from '../shared/profile';
import type { SpecialistTeam, TeamSchema, TeamToolSpec } from '../team';

/**
 * The furniture teams (PQ-T89: seat, table, storage, bed) share one shape: a pilot names the kind
 * and the parts present, then the shared profile, legs and finishes specialists (PQ-T86) and the
 * class's own specialists read the validated front and side drawings cut to the object (never the
 * photo), each with its deadline and one retry. This factory builds such a team from the class's
 * vocabulary; the class turns the reading into its builder's dimensions (`teams/*.ts`). Pure.
 */

export const FURNITURE_VIEWS = ['front', 'side'] as const;
export type FurnitureView = (typeof FURNITURE_VIEWS)[number];

/** Longest wait for one call: two drawings, short answers. */
export const FURNITURE_TOOL_TIMEOUT_MS = 4 * 60_000;

export const FURNITURE_FRAME = objectFrame('piece of furniture');

export type FurnitureTool<Own extends string> = 'profile' | 'legs' | 'finishes' | Own;

/** What the pilot says: which kind of piece it is and which parts it has. */
export interface FurnitureBrief {
  kind: string;
  parts: string[];
}

/** The team's reading: the brief, then each specialist's answer. */
export interface FurnitureReading<Own> {
  kind: string;
  parts: string[];
  profile: ReadProfile[];
  legs: ReadLeg[];
  finishes: ReadFinish[];
  own: Own;
}

/** A class's own specialist: a shared-style spec and whether its answer is usable. */
export interface OwnSpec {
  spec: SharedSpec;
  answered: (content: string | null | undefined) => boolean;
}

export interface FurnitureTeamConfig<Own extends string, OwnReading> {
  id: string;
  promptVersion: number;
  /** "ONE seat (a sofa, an armchair, a chair, a stool, a bench or a pouf)". */
  subject: string;
  kinds: ReadonlyArray<string>;
  /** Parts the pilot may name (cushions, arms, back, legs…). */
  parts: ReadonlyArray<string>;
  /** The profile's horizontal lines (seat, arm, back for a seat). */
  lines?: ReadonlyArray<readonly [name: string, note: string]>;
  finishes: ReadonlyArray<readonly [name: string, note: string]>;
  materials: ReadonlyArray<string>;
  own: Readonly<Record<Own, OwnSpec>>;
  /** The class's own answers, parsed (missing or unusable ones give their defaults). */
  parseOwn: (answers: Partial<Record<Own, string | null>>) => OwnReading;
  /** One line for the log. */
  ownSummary: (own: OwnReading) => string;
}

/** The pilot of a furniture team. */
export function furniturePilot(
  cfg: Pick<FurnitureTeamConfig<string, unknown>, 'subject' | 'kinds' | 'parts'>
) {
  const schema: TeamSchema = {
    name: 'FurnitureBrief',
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...cfg.kinds] },
        parts: { type: 'array', items: { type: 'string', enum: [...cfg.parts] } },
      },
      required: ['kind', 'parts'],
    },
  };
  return {
    system: [
      `You lead a 3D modelling team. Image 1 is the front drawing, image 2 the side drawing of ${cfg.subject}.`,
      `Say which kind it is (${cfg.kinds.join(', ')}) and list the parts it has among: ${cfg.parts.join(', ')}.`,
      'Report only what the drawings show. Answer with the JSON only.',
    ].join('\n'),
    schema,
    parse: (text: string): FurnitureBrief | null => {
      const j = answerObject(text);
      const kind = typeof j?.kind === 'string' && cfg.kinds.includes(j.kind) ? j.kind : null;
      if (!kind) return null;
      const parts = Array.isArray(j?.parts)
        ? (j.parts as unknown[]).filter(
            (p): p is string => typeof p === 'string' && cfg.parts.includes(p)
          )
        : [];
      return { kind, parts: [...new Set(parts)] };
    },
  };
}

/** A furniture class's team as a `SpecialistTeam`, run by `runTeam`. */
export function furnitureTeam<Own extends string, OwnReading>(
  cfg: FurnitureTeamConfig<Own, OwnReading>
): SpecialistTeam<FurnitureTool<Own>, FurnitureBrief, FurnitureReading<OwnReading>, FurnitureView> {
  const views = FURNITURE_VIEWS;
  const shared = { subject: cfg.subject, frame: FURNITURE_FRAME, views };
  const ownTools = Object.keys(cfg.own) as Own[];
  const tools = ['profile', 'legs', ...ownTools, 'finishes'] as Array<FurnitureTool<Own>>;
  const finishesCfg = {
    ...shared,
    finishes: cfg.finishes,
    materials: cfg.materials,
    required: ['finish', 'color'] as const,
    schemaName: `${cfg.id[0]!.toUpperCase()}${cfg.id.slice(1)}Finishes`,
  };
  const specOf = (tool: FurnitureTool<Own>): SharedSpec =>
    tool === 'profile'
      ? profileSpec({ ...shared, ...(cfg.lines ? { lines: cfg.lines } : {}) })
      : tool === 'legs'
        ? legsSpec(shared)
        : tool === 'finishes'
          ? finishesSpec(finishesCfg)
          : cfg.own[tool as Own].spec;
  const specs = Object.fromEntries(
    tools.map((tool) => {
      const s = specOf(tool);
      const spec: TeamToolSpec<FurnitureBrief, FurnitureView> = {
        system: s.system,
        schema: s.schema,
        question: (label, v, brief) =>
          [
            `Images: ${v.map((x, i) => `${i + 1} = ${x} drawing`).join(', ')} of « ${label} ».`,
            brief
              ? `It is a ${brief.kind}${brief.parts.length ? ` with ${brief.parts.join(', ')}` : ''}.`
              : '',
            s.task,
          ]
            .filter(Boolean)
            .join('\n'),
      };
      return [tool, spec];
    })
  ) as Record<FurnitureTool<Own>, TeamToolSpec<FurnitureBrief, FurnitureView>>;
  const answered = (tool: FurnitureTool<Own>, text: string | null | undefined) =>
    tool === 'profile'
      ? profileAnswered(text, { views })
      : tool === 'legs'
        ? legsAnswered(text)
        : tool === 'finishes'
          ? finishesAnswered(text)
          : cfg.own[tool as Own].answered(text);
  const pilot = furniturePilot(cfg);
  return {
    id: cfg.id,
    promptVersion: cfg.promptVersion,
    tools,
    required: ['profile'],
    timeoutMs: FURNITURE_TOOL_TIMEOUT_MS,
    pilot: { ...pilot, question: (label) => `« ${label} »: kind and parts.` },
    specs,
    answered,
    merge: (answers, brief) => {
      const profile = parseProfile(answers.profile, { views });
      if (!profile.length) return null;
      const own = Object.fromEntries(ownTools.map((t) => [t, answers[t] ?? null])) as Partial<
        Record<Own, string | null>
      >;
      return {
        kind: brief?.kind ?? cfg.kinds[0]!,
        parts: brief?.parts ?? [],
        profile,
        legs: parseLegs(answers.legs, { views }),
        finishes: parseFinishes(answers.finishes, finishesCfg),
        own: cfg.parseOwn(own),
      };
    },
    briefSummary: (b) => `${b.kind}${b.parts.length ? ` (${b.parts.join(', ')})` : ''}`,
    summary: (r) =>
      `${r.kind}, ${r.profile.length} profiles, ${r.legs.map((l) => `${l.count} ${l.kind}`).join(' + ') || 'no legs'}, ${r.finishes.length} finishes, ${cfg.ownSummary(r.own)}`,
  };
}

// ---------------------------------------------------------------- reading → dimensions

/** The reading's profile on one drawing (the front first). */
export const profileOn = <O>(r: FurnitureReading<O>, view: FurnitureView = 'front') =>
  r.profile.find((p) => p.view === view) ?? r.profile[0]!;

/** A named line of the front profile as a height above the floor (`h` = full height), or null. */
export function lineHeight<O>(r: FurnitureReading<O>, name: string, h: number): number | null {
  for (const view of FURNITURE_VIEWS) {
    const lines = r.profile.find((p) => p.view === view)?.lines;
    const y = lines && !Array.isArray(lines) ? lines[name] : undefined;
    if (typeof y === 'number') return (1 - y) * h;
  }
  return null;
}

/** Height of what it stands on (legs, plinth…) as read on a drawing, 0 when it sits on its body. */
export function legHeight<O>(r: FurnitureReading<O>, h: number): number {
  const leg = r.legs.find((l) => l.kind !== 'bracket' && l.kind !== 'caster') ?? r.legs[0];
  if (!leg) return 0;
  return Math.max(0, Math.min(0.9, 1 - leg.box[1])) * h;
}

/** The colour of the first named finish present, else `fallback`. */
export function finishColor<O>(
  r: FurnitureReading<O>,
  names: ReadonlyArray<string>,
  fallback: string
): string {
  for (const n of names) {
    const f = r.finishes.find((x) => x.finish === n);
    if (f) return f.color.toLowerCase();
  }
  return fallback;
}

/** Width and depth (metres) for a height `h` and the measured proportions (largest side = 1). */
export function footprint(h: number, p: { w: number; h: number; d: number }) {
  return { w: (h * p.w) / Math.max(1e-6, p.h), d: (h * p.d) / Math.max(1e-6, p.h) };
}

/** An integer in a range from an answer field (absent or wrong → `fallback`). */
export function intField(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, Math.round(v)))
    : fallback;
}

/** One of a closed list from an answer field (absent or unknown → `fallback`). */
export function enumField<T extends string>(v: unknown, list: ReadonlyArray<T>, fallback: T): T {
  return typeof v === 'string' && (list as ReadonlyArray<string>).includes(v) ? (v as T) : fallback;
}

/** The object of an answer under `key`, or null (an own specialist's answer). */
export const ownObject = (content: string | null | undefined, key: string) => {
  const o = answerObject(content)?.[key];
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
};
