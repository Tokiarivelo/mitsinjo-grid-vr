import 'server-only';

import type { PerceptionClient } from '../client';
import { cropToObject } from '../house/house-specialist';
import type { AlignedViews, ViewFrame, ViewName } from '../recon/views';
import {
  CAR_PILOT_JSON_SCHEMA,
  CAR_PILOT_SYSTEM_PROMPT,
  CAR_TOOL_SPECS,
  CAR_TOOLS_REQUIRED,
  carPilotQuestion,
  carToolAnswered,
  carToolQuestion,
  mergeCarAnswers,
  parseCarBrief,
  type CarBrief,
  type CarReading,
  type CarTool,
  type CarView,
} from './car-tools';

/**
 * The car team at work (PQ-T76), the part that talks to the model: each validated drawing cut to
 * the car (never the photo), the pilot's brief, then the four specialists in parallel, each with its
 * deadline and one retry, merged into a `CarReading`. Never throws: null = no reading, the measured
 * plan stays.
 */

/** One call of the car team: the pilot or a specialist, its system prompt and schema, the images. */
export type AskCarTool = (
  tool: CarTool | 'pilot',
  system: string,
  schema: { name: string; schema: object },
  imageUrl: string,
  question: string,
  references: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<string | null>;

/** The whole reading of a car's drawings (live team, or a saved reading replayed). */
export type ReadCar = (
  label: string,
  order: ReadonlyArray<CarView>,
  images: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<CarReading | null>;

/** The client's call as an `AskCarTool` (a mock answer counts as none). */
export const carToolAsk =
  (p: Pick<PerceptionClient, 'askCarTool'>): AskCarTool =>
  async (...args) => {
    const r = await p.askCarTool(...args);
    return r.source === 'meta' ? r.content : null;
  };

/** Longest wait for one call: a car is smaller than a house, the slowest specialist still minutes. */
export const CAR_TOOL_TIMEOUT_MS = 8 * 60_000;

/** The team's reading; null when the body or the glazing is missing after its retry. */
export async function readCarParts(
  rawAsk: AskCarTool,
  label: string,
  order: ReadonlyArray<CarView>,
  images: ReadonlyArray<string>,
  signal?: AbortSignal,
  timeoutMs = CAR_TOOL_TIMEOUT_MS
): Promise<{ reading: CarReading | null; brief: CarBrief | null }> {
  const tag = `[vision] car team for "${label}"`;
  const [main, ...refs] = images;
  if (!main) return { reading: null, brief: null };
  // Each call ends with the request or at its own deadline, whichever comes first.
  const ask = async (
    tool: CarTool | 'pilot',
    system: string,
    schema: { name: string; schema: object },
    question: string
  ): Promise<string | null> => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const both = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const stop = () =>
          reject(new Error(`${tool}: no answer in ${Math.round(timeoutMs / 1000)} s`));
        if (both.aborted) return stop();
        both.addEventListener('abort', stop, { once: true });
        rawAsk(tool, system, schema, main, question, refs, both).then(resolve, reject);
      });
    } catch (err) {
      console.warn(`${tag}: ${tool} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  };
  const briefText = await ask(
    'pilot',
    CAR_PILOT_SYSTEM_PROMPT,
    CAR_PILOT_JSON_SCHEMA,
    carPilotQuestion(label, order)
  );
  const brief = briefText ? parseCarBrief(briefText) : null;
  console.info(
    `${tag}: ${brief ? `${brief.kind}${brief.doors ? `, ${brief.doors} doors` : ''}, parts ${Object.keys(brief.parts).join(', ') || 'none'}` : 'no brief'}`
  );
  const tools = Object.keys(CAR_TOOL_SPECS) as CarTool[];
  const askTool = (tool: CarTool) =>
    ask(
      tool,
      CAR_TOOL_SPECS[tool].system,
      CAR_TOOL_SPECS[tool].schema,
      carToolQuestion(tool, label, order, brief)
    );
  const answers: Partial<Record<CarTool, string | null>> = Object.fromEntries(
    await Promise.all(tools.map(async (t) => [t, await askTool(t)] as const))
  );
  // A call cut by the network (or answering nothing usable) is asked once more, alone.
  for (const tool of tools) {
    if (carToolAnswered(tool, answers[tool]) || signal?.aborted) continue;
    console.info(`${tag}: ${tool} unusable, asked again`);
    answers[tool] = await askTool(tool);
  }
  const missing = CAR_TOOLS_REQUIRED.filter((t) => !carToolAnswered(t, answers[t]));
  if (missing.length) {
    console.info(`${tag}: no ${missing.join(', ')} after a retry: no reading`);
    return { reading: null, brief };
  }
  const reading = mergeCarAnswers(answers, brief);
  console.info(
    `${tag}: ${reading ? `${reading.windows.length} windows, ${reading.details.length} details, finishes ${reading.finishes.map((f) => f.finish).join(', ') || 'none'}` : 'no usable body'}`
  );
  return { reading, brief };
}

/** The live team as a `ReadCar`. */
export const liveReadCar =
  (ask: AskCarTool): ReadCar =>
  async (label, order, images, signal) =>
    (await readCarParts(ask, label, order, images, signal)).reading;

/**
 * The drawings the team gets: front first, then right, back, left, the view from above, each cut
 * to the car as drawn (the right one is the left drawing when only that one exists).
 */
export async function carImages(
  pngs: Partial<Record<ViewName, Buffer>>,
  aligned: Pick<AlignedViews, 'frames' | 'rightFromLeft'>,
  top?: { png: Buffer; frame: ViewFrame } | null
): Promise<{ order: CarView[]; images: string[] }> {
  const order: CarView[] = [];
  const images: string[] = [];
  for (const view of ['front', 'right', 'back', 'left'] as const) {
    const png = pngs[view];
    const frame = view === 'right' && aligned.rightFromLeft ? undefined : aligned.frames[view];
    if (!png || !frame) continue;
    const url = await cropToObject(png, frame);
    if (url) {
      order.push(view);
      images.push(url);
    }
  }
  if (top) {
    const url = await cropToObject(top.png, top.frame);
    if (url) {
      order.push('top');
      images.push(url);
    }
  }
  return { order, images };
}
