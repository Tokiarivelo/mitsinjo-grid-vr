import 'server-only';

import type { PerceptionClient } from '../client';
import { runTeam } from '../team/team';
import {
  PLANT_TEAM,
  PLANT_TOOL_TIMEOUT_MS,
  type PlantBrief,
  type PlantReading,
  type PlantTool,
} from './plant-tools';

export { PLANT_TOOL_TIMEOUT_MS };

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

/** The team's reading; null when the foliage is missing after its retry. */
export async function readPlantParts(
  rawAsk: AskPlantTool,
  label: string,
  image: string,
  signal?: AbortSignal,
  timeoutMs = PLANT_TOOL_TIMEOUT_MS
): Promise<{ reading: PlantReading | null; brief: PlantBrief | null }> {
  const { reading, brief } = await runTeam(
    PLANT_TEAM,
    (tool, system, schema, img, question, _refs, both) =>
      rawAsk(tool, system, schema, img, question, both),
    { label, views: ['front'], images: [image], signal, timeoutMs }
  );
  return { reading, brief };
}

/** The live team as a `ReadPlant`. */
export const liveReadPlant =
  (ask: AskPlantTool): ReadPlant =>
  async (label, image, signal) =>
    (await readPlantParts(ask, label, image, signal)).reading;
