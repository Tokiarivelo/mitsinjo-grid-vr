import { z } from 'zod';
import { ObjectKitSchema, type ObjectKit } from '@/lib/object-kit';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import { ApplianceDetectionSchema } from '@/lib/vision';

export {
  NormBoxSchema,
  ApplianceDetectionSchema,
  type NormBox,
  type ApplianceDetection,
} from '@/lib/vision';

/**
 * Perception results: what a model heard or saw. These are observations, never energy values:
 * any number here (cloud cover, a meter reading, a box) must go through an `InputPatch`
 * proposal before the engine turns it into kW, kWh or %.
 */

/** Who produced the result. `fallback` is set when the mock answered instead of Meta. */
export const PerceptionSourceSchema = z.object({
  source: z.enum(['meta', 'mock']),
  model: z.string(),
  fallback: z.enum(['provider_error', 'spend_cap', 'not_configured']).optional(),
  /** With `provider_error`: why Meta failed (`timeout`, `aborted`, `http_<status>`, `network`). Logs + UI note. */
  failure: z.string().max(40).optional(),
});
export type PerceptionSource = z.infer<typeof PerceptionSourceSchema>;

export const TranscriptTurnSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string(),
  /** Speaker label (`A`, `B`…), only in diarization mode. */
  speaker: z.string().optional(),
});

export const TranscriptSchema = PerceptionSourceSchema.extend({
  text: z.string(),
  durationMs: z.number().int().min(0),
  turns: z.array(TranscriptTurnSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const TranscribeOptionsSchema = z.object({
  /** Language names for the model (`French`, `English`, `Malagasy`). Omit = auto-detect. */
  languages: z.array(z.string().min(1)).max(4).optional(),
  /** Split speakers (meeting recordings). */
  diarize: z.boolean().optional(),
  /** Words to bias recognition toward (sector names, `lifeline`…). */
  keywords: z.array(z.string().min(1)).max(50).optional(),
  /** File name hint; the mock uses it to pick a deterministic phrase. */
  fileName: z.string().max(200).optional(),
});
export type TranscribeOptions = z.infer<typeof TranscribeOptionsSchema>;

export const ObservationSchema = z.object({
  /** Stable id of what was observed, e.g. `cloud_cover`, `meter_reading`, `smoke`. */
  label: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().optional(),
  /** Model's own confidence, 0–1. Shown to the user, never trusted blindly. */
  confidence: z.number().min(0).max(1),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const VisionResultSchema = PerceptionSourceSchema.extend({
  summary: z.string(),
  observations: z.array(ObservationSchema),
});
export type VisionResult = z.infer<typeof VisionResultSchema>;

export const BoxSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});
export type Box = z.infer<typeof BoxSchema>;

export const SegmentInstanceSchema = z.object({
  box: BoxSchema,
  confidence: z.number().min(0).max(1).optional(),
  /** Mask outline: SVG path in image fractions (0–1), simplified. Absent when the mask is missing or unreadable. */
  outline: z.string().optional(),
});
export type SegmentInstance = z.infer<typeof SegmentInstanceSchema>;

export const SegmentResultSchema = PerceptionSourceSchema.extend({
  concept: z.string(),
  imageWidth: z.number().int().min(0),
  imageHeight: z.number().int().min(0),
  instances: z.array(SegmentInstanceSchema),
  count: z.number().int().min(0),
  /** Share of the image covered by the union of the boxes, 0–1 (boxes, not masks: an upper bound). */
  boxCoverage: z.number().min(0).max(1),
});
export type SegmentResult = z.infer<typeof SegmentResultSchema>;

/** Spark's 3D recipe of one object (PV-T9); null when the reply was not usable. */
export const ShapeResultSchema = PerceptionSourceSchema.extend({
  recipe: ObjectRecipeSchema.nullable(),
  /** Spark's kit behind `recipe` (Meta only): the server rebuilds the recipe with measured colours (PF-T2). */
  kit: ObjectKitSchema.optional(),
});
export type ShapeResult = z.infer<typeof ShapeResultSchema>;

/**
 * The critic's kit patch (PR-0.6): the fields to change, or null when the model already matches
 * (mock: always null — the mock never patches). Validated field by field in `parseKitPatch`;
 * the schema only carries the record across the backend boundary.
 */
export const CriticResultSchema = PerceptionSourceSchema.extend({
  patch: z.record(z.string(), z.unknown()).nullable(),
});
export type CriticResult = Omit<z.infer<typeof CriticResultSchema>, 'patch'> & {
  patch: Partial<ObjectKit> | null;
};

/** Rubric judge (PQ-T4): six 1–5 grades and notes; null when unusable. Parsed in `parseJudge`. */
export const JudgeResultSchema = PerceptionSourceSchema.extend({
  judgement: z.record(z.string(), z.unknown()).nullable(),
});
export type JudgeResult = Omit<z.infer<typeof JudgeResultSchema>, 'judgement'> & {
  judgement: import('./rubric-judge').Judgement | null;
};

/** AI check of a views model (PV-H): what is missing, per view; null when unusable or mock. */
export const ViewsCheckResultSchema = PerceptionSourceSchema.extend({
  check: z.record(z.string(), z.unknown()).nullable(),
});
export type ViewsCheckResult = Omit<z.infer<typeof ViewsCheckResultSchema>, 'check'> & {
  check: import('./views-check').ViewsCheck | null;
};

/** Stage patch of the shape loop (PG-T15): raw ShapeScript ops, null when unusable or mock. */
export const ShapeOpsResultSchema = PerceptionSourceSchema.extend({
  ops: z.array(z.unknown()).nullable(),
});
export type ShapeOpsResult = z.infer<typeof ShapeOpsResultSchema>;

/**
 * Sandboxed construction code, route B (PQ-T45): the `build()` body (§8bis), null when
 * unusable or mock. Parsed in `parseBuildCode`; length-capped by `CODE_MAX_BYTES`.
 */
export const CodeResultSchema = PerceptionSourceSchema.extend({
  code: z.string().nullable(),
});
export type CodeResult = z.infer<typeof CodeResultSchema>;

export const DetectionResultSchema = PerceptionSourceSchema.extend({
  detections: z.array(ApplianceDetectionSchema),
  /** E2 image type (PQ-T47): what the detection call said the image is. */
  imageType: z.enum(['photo', 'drawing']).optional(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;
