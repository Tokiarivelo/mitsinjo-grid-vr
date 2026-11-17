import { askSpecialists, callWithDeadline } from '../team-call';

/**
 * A team of 3D specialists (PQ-T83): a pilot briefs, the specialists read the validated drawings
 * cut to the object (never the photo) in parallel, each with its deadline and one retry, and their
 * answers merge into one reading. The definition is pure data and functions; `runTeam` is the only
 * engine. Numbers and geometry stay in the code that turns the reading into a model.
 */

/** A JSON schema as the model's structured output takes it. */
export interface TeamSchema {
  name: string;
  schema: object;
}

/** One specialist: its system prompt, its schema and its question (images, brief, own note). */
export interface TeamToolSpec<Brief, View extends string = string> {
  system: string;
  schema: TeamSchema;
  question: (label: string, views: ReadonlyArray<View>, brief: Brief | null) => string;
}

export interface SpecialistTeam<Tool extends string, Brief, Reading, View extends string = string> {
  /** Short name, in logs and in the client's call (`house`, `car`, `plant`…). */
  id: string;
  /** Raised whenever a prompt or a schema of the team changes. */
  promptVersion: number;
  tools: ReadonlyArray<Tool>;
  /** Without these after their retry, no reading. */
  required: ReadonlyArray<Tool>;
  /** Longest wait for one call. */
  timeoutMs: number;
  pilot: {
    system: string;
    schema: TeamSchema;
    question: (label: string, views: ReadonlyArray<View>) => string;
    parse: (text: string) => Brief | null;
  };
  specs: Readonly<Record<Tool, TeamToolSpec<Brief, View>>>;
  /** The specialists the brief calls (default: every tool). */
  toolsFor?: (brief: Brief | null) => ReadonlyArray<Tool>;
  /** Whether an answer is usable (else it is asked once more). */
  answered: (tool: Tool, text: string | null | undefined) => boolean;
  merge: (answers: Partial<Record<Tool, string | null>>, brief: Brief | null) => Reading | null;
  /** One line for the log. */
  summary: (reading: Reading) => string;
  briefSummary?: (brief: Brief) => string;
}

/** One call of a team: the pilot or a specialist, its prompt and schema, the main image and the others. */
export type AskTeamTool<Tool extends string = string> = (
  tool: Tool | 'pilot',
  system: string,
  schema: TeamSchema,
  imageUrl: string,
  question: string,
  references: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<string | null>;

export interface TeamInput<View extends string = string> {
  label: string;
  /** Which image is which (same order as `images`). */
  views: ReadonlyArray<View>;
  /** Drawings cut to the object, the main one first. */
  images: ReadonlyArray<string>;
  signal?: AbortSignal;
  /** Overrides the team's deadline (tests). */
  timeoutMs?: number;
}

export interface TeamResult<Tool extends string, Brief, Reading> {
  reading: Reading | null;
  brief: Brief | null;
  /** The raw answers (a fallback reading may still use them); absent when nothing was asked. */
  answers?: Partial<Record<Tool, string | null>>;
}

/** Same spec for each tool, its question built by one function (the existing teams' shape). */
export function teamSpecs<Tool extends string, Brief, View extends string>(
  tools: ReadonlyArray<Tool>,
  spec: (tool: Tool) => { system: string; schema: TeamSchema },
  question: (tool: Tool, label: string, views: ReadonlyArray<View>, brief: Brief | null) => string
): Record<Tool, TeamToolSpec<Brief, View>> {
  return Object.fromEntries(
    tools.map((t) => [
      t,
      {
        ...spec(t),
        question: (l: string, v: ReadonlyArray<View>, b: Brief | null) => question(t, l, v, b),
      },
    ])
  ) as Record<Tool, TeamToolSpec<Brief, View>>;
}

/**
 * The team at work: pilot → specialists in parallel (one retry each) → required check → merge.
 * Never throws: a null reading means the caller's current path decides.
 */
export async function runTeam<Tool extends string, Brief, Reading, View extends string>(
  team: SpecialistTeam<Tool, Brief, Reading, View>,
  rawAsk: AskTeamTool<Tool>,
  { label, views, images, signal, timeoutMs = team.timeoutMs }: TeamInput<View>
): Promise<TeamResult<Tool, Brief, Reading>> {
  const tag = `[vision] ${team.id} team for "${label}"`;
  const [main, ...refs] = images;
  if (!main) return { reading: null, brief: null };
  try {
    const ask = (tool: Tool | 'pilot', system: string, schema: TeamSchema, question: string) =>
      callWithDeadline(tag, tool, timeoutMs, signal, (both) =>
        rawAsk(tool, system, schema, main, question, refs, both)
      );
    const briefText = await ask(
      'pilot',
      team.pilot.system,
      team.pilot.schema,
      team.pilot.question(label, views)
    );
    const brief = briefText ? team.pilot.parse(briefText) : null;
    const tools = team.toolsFor ? team.toolsFor(brief) : team.tools;
    console.info(
      `${tag}: ${brief ? (team.briefSummary?.(brief) ?? 'brief') : 'no brief'} → ${tools.join(', ')}`
    );
    const askTool = (tool: Tool) => {
      const spec = team.specs[tool];
      return ask(tool, spec.system, spec.schema, spec.question(label, views, brief));
    };
    const answers = await askSpecialists(tag, tools, askTool, team.answered, signal);
    const missing = team.required.filter((t) => !team.answered(t, answers[t]));
    if (missing.length) {
      console.info(`${tag}: no ${missing.join(', ')} after a retry: no reading`);
      return { reading: null, brief, answers };
    }
    const reading = team.merge(answers, brief);
    console.info(`${tag}: ${reading ? team.summary(reading) : 'no usable reading'}`);
    return { reading, brief, answers };
  } catch (err) {
    console.warn(`${tag} failed:`, err instanceof Error ? err.message : err);
    return { reading: null, brief: null };
  }
}
