import { z } from 'zod';

/**
 * 3D vision steps with their own model id (PQ-T67): shared by the web modal and the server.
 * Client-safe (no `server-only`): the env defaults live in `server/perception/step-models.ts`.
 */

export const STEP_MODEL_STEPS = [
  'kit',
  'parts',
  'critic',
  'viewsCheck',
  'askPart',
  'code',
  'judge',
] as const;

export type StepModelStep = (typeof STEP_MODEL_STEPS)[number];

/**
 * Chat models usable for a vision step (Meta catalogue, `docs/ideas-meta-models.md` §1).
 * Contributor ids mirror `CONTRIBUTOR_BASES` (server `contributor.ts`): only Spark 1.2/1.3
 * exist there — no Spark 1.1 nor Wonder contributor. Same model up to 95 % cheaper, but
 * Meta trains on inputs/outputs and rate-limits them (see `META_PREFER_CONTRIBUTOR`).
 */
export const STEP_MODEL_OPTIONS = [
  'muse-spark-1.3',
  'muse-spark-1.2',
  'muse-spark-1.1',
  'muse-wonder-1.0',
  'muse-spark-1.3-contributor',
  'muse-spark-1.2-contributor',
] as const;

/** Only catalogue ids: an arbitrary string would let any caller route a step to any (costly) model. */
const modelId = z.enum(STEP_MODEL_OPTIONS);

/**
 * One operator-chosen model per step; a missing step means « env default ».
 * Stored as JSONB (`shape_step_models`), sent back untouched by the modal.
 */
export const StepModelsSelectionSchema = z
  .object({
    kit: modelId.optional(),
    parts: modelId.optional(),
    critic: modelId.optional(),
    viewsCheck: modelId.optional(),
    askPart: modelId.optional(),
    code: modelId.optional(),
    judge: modelId.optional(),
  })
  .strict();

export type StepModelsSelection = z.infer<typeof StepModelsSelectionSchema>;

/** `GET /api/vision/shape/step-models`: env defaults, offered models, stored selection. */
export const StepModelsStateSchema = z.object({
  defaults: z.object({
    kit: z.string(),
    parts: z.string(),
    critic: z.string(),
    viewsCheck: z.string(),
    askPart: z.string(),
    code: z.string(),
    judge: z.string(),
  }),
  models: z.array(z.string()),
  selection: StepModelsSelectionSchema.nullable(),
});

export type StepModelsState = z.infer<typeof StepModelsStateSchema>;
