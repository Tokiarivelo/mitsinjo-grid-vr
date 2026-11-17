import 'server-only';

import type { PerceptionClient } from '../client';
import { cropToObject } from '../house/house-specialist';
import { runTeam } from '../team/team';
import type { AlignedViews, ViewFrame, ViewName } from '../recon/views';
import {
  CAR_TEAM,
  CAR_TOOL_TIMEOUT_MS,
  type CarBrief,
  type CarReading,
  type CarTool,
  type CarView,
} from './car-tools';

export { CAR_TOOL_TIMEOUT_MS };

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

/** The team's reading; null when the body or the glazing is missing after its retry. */
export async function readCarParts(
  rawAsk: AskCarTool,
  label: string,
  order: ReadonlyArray<CarView>,
  images: ReadonlyArray<string>,
  signal?: AbortSignal,
  timeoutMs = CAR_TOOL_TIMEOUT_MS
): Promise<{ reading: CarReading | null; brief: CarBrief | null }> {
  const { reading, brief } = await runTeam(CAR_TEAM, rawAsk, {
    label,
    views: order,
    images,
    signal,
    timeoutMs,
  });
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
