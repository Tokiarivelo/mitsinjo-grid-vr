import 'server-only';

import type { PerceptionClient } from '../client';
import { askSpecialists, callWithDeadline } from '../team-call';
import {
  PLANT_PILOT_JSON_SCHEMA,
  PLANT_PILOT_SYSTEM_PROMPT,
  PLANT_TOOL_SPECS,
  PLANT_TOOLS,
  PLANT_TOOLS_REQUIRED,
  mergePlantAnswers,
  parsePlantBrief,
  plantPilotQuestion,
  plantToolAnswered,
  plantToolQuestion,
  type PlantBrief,
  type PlantReading,
  type PlantTool,
} from './plant-tools';

/**
 * The plant team at work (PQ-T82), the part that talks to the model: the validated front drawing
 * cut to the plant (never the photo), the pilot's brief, then the four specialists in parallel,
 * each with its deadline and one retry, merged into a `PlantReading`. Never throws: null = no
 * reading, the label and the outline decide.
 */

/** One call of the plant team: the pilot or a specialist, its system prompt and schema, the image. */
export type AskPlantTool = (
  tool: PlantTool | 'pilot',
  system: string,
  schema: { name: string; schema: object },
  imageUrl: string,
  question: string,
  signal?: AbortSignal
) => Promise<string | null>;

/** The whole reading of a plant's front drawing (live team, or a saved reading replayed). */
export type ReadPlant = (
  label: string,
  image: string,
  signal?: AbortSignal
) => Promise<PlantReading | null>;

/** The client's call as an `AskPlantTool` (a mock answer counts as none). */
export const plantToolAsk =
  (p: Pick<PerceptionClient, 'askPlantTool'>): AskPlantTool =>
  async (...args) => {
    const r = await p.askPlantTool(...args);
    return r.source === 'meta' ? r.content : null;
  };

/** Longest wait for one call: one drawing, shorter answers than a car's. */
export const PLANT_TOOL_TIMEOUT_MS = 5 * 60_000;

/** The team's reading; null when the foliage is missing after its retry. */
export async function readPlantParts(
  rawAsk: AskPlantTool,
  label: string,
  image: string,
  signal?: AbortSignal,
  timeoutMs = PLANT_TOOL_TIMEOUT_MS
): Promise<{ reading: PlantReading | null; brief: PlantBrief | null }> {
  const tag = `[vision] plant team for "${label}"`;
  const ask = (
    tool: PlantTool | 'pilot',
    system: string,
    schema: { name: string; schema: object },
    question: string
  ) =>
    callWithDeadline(tag, tool, timeoutMs, signal, (both) =>
      rawAsk(tool, system, schema, image, question, both)
    );
  const briefText = await ask(
    'pilot',
    PLANT_PILOT_SYSTEM_PROMPT,
    PLANT_PILOT_JSON_SCHEMA,
    plantPilotQuestion(label)
  );
  const brief = briefText ? parsePlantBrief(briefText) : null;
  console.info(
    `${tag}: ${brief ? `${brief.species ?? 'unnamed'}, ${brief.habit}, ${brief.leaf} leaves` : 'no brief'}`
  );
  const askTool = (tool: PlantTool) =>
    ask(
      tool,
      PLANT_TOOL_SPECS[tool].system,
      PLANT_TOOL_SPECS[tool].schema,
      plantToolQuestion(tool, label, brief)
    );
  const answers = await askSpecialists(tag, PLANT_TOOLS, askTool, plantToolAnswered, signal);
  const missing = PLANT_TOOLS_REQUIRED.filter((t) => !plantToolAnswered(t, answers[t]));
  if (missing.length) {
    console.info(`${tag}: no ${missing.join(', ')} after a retry: no reading`);
    return { reading: null, brief };
  }
  const reading = mergePlantAnswers(answers, brief);
  console.info(
    `${tag}: ${reading ? `${reading.habit}, ${reading.leaf} leaves, ${reading.foliage?.arrangement}, ${reading.trunks.length} trunks, ${reading.branches.length} limbs, ${reading.foliage?.bigLeaves ?? 0} big leaves, ${reading.flowers ? `flowers ${reading.flowers.flowers} fruit ${reading.flowers.fruit} ${reading.flowers.share}` : 'no flower answer'}` : 'no usable foliage'}`
  );
  return { reading, brief };
}

/** The live team as a `ReadPlant`. */
export const liveReadPlant =
  (ask: AskPlantTool): ReadPlant =>
  async (label, image, signal) =>
    (await readPlantParts(ask, label, image, signal)).reading;
