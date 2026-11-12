import { z } from 'zod';

const envSchema = z.object({
  LLM_PROVIDER: z.enum(['meta', 'glimmer', 'mock']).default('mock'),
  META_API_KEY: z.string().optional(),
  META_MODEL: z.string().optional(),
  META_BASE_URL: z.string().optional(),
  // Local Glimmer (OpenAI-compatible, vLLM/Ollama). Unset = no local step in the fallback chain.
  GLIMMER_BASE_URL: z.string().optional(),
  GLIMMER_MODEL: z.string().default('muse-glimmer-30b'),
  GLIMMER_API_KEY: z.string().optional(),
  // Perception models (voice, vision, segmentation, image) and spend cap
  META_VOICE_MODEL: z.string().default('muse-voice-transcribe-1.0'),
  META_VISION_MODEL: z.string().default('muse-spark-1.3'),
  /** Final 3D check and re-refinement stage (deep reasoning; falls back to META_VISION_MODEL). */
  META_REFINE_MODEL: z.string().default('muse-wonder-1.0'),
  /** Rubric judge of the 3D models (PQ-T4, offline `make shape-judge`). */
  META_JUDGE_MODEL: z.string().default('muse-wonder-1.0'),
  /** Writer of the sandboxed construction code, route B (PQ-T45, §8bis); unset = META_REFINE_MODEL. */
  META_CODE_MODEL: z.string().optional(),
  META_SEGMENT_MODEL: z.string().default('sam-3.1'),
  /** Object families whose kit call carries the family card (PQ-T13), comma separated; empty = none. */
  SHAPE_KIT_CARD_FAMILIES: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    ),
  /** Side views from the Side view card, 2 candidates scored against the front (PQ-T16, off until measured). */
  SHAPE_SIDE_V2: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Muse cards in the stage loop, views check and final check (PQ-T15, off until `make eval-stages` shows no loss). */
  SHAPE_LOOP_CARDS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Kit samples per photo (PQ-T18): 2 votes between two parallel calls when ≥ 40 s are left. */
  SHAPE_KIT_SAMPLES: z.coerce.number().int().min(1).max(2).default(1),
  META_IMAGE_MODEL: z.string().default('muse-image-1.0'),
  /** Estimated Meta spend allowed per chat session (USD). Over it → deterministic mock. 0 = no paid calls. */
  META_SPEND_CAP_USD: z.coerce.number().min(0).default(15),
  /**
   * Prefer Spark *-contributor ids (up to 95 % cheaper; Meta trains on inputs/outputs, rate-limited).
   * Refused → automatic retry on the standard id. `false` for real (non-simulated) user data.
   */
  META_PREFER_CONTRIBUTOR: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Cloudflare R2 Storage
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('mitsinjo-grid-media'),
  R2_PUBLIC_URL: z.string().optional(),
  // Vercel / Neon Database
  DATABASE_URL: z.string().optional(),
});

export const env = envSchema.parse({
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'mock',
  META_API_KEY: process.env.META_API_KEY,
  META_MODEL: process.env.META_MODEL,
  META_BASE_URL: process.env.META_BASE_URL,
  GLIMMER_BASE_URL: process.env.GLIMMER_BASE_URL,
  GLIMMER_MODEL: process.env.GLIMMER_MODEL || undefined,
  GLIMMER_API_KEY: process.env.GLIMMER_API_KEY,
  META_VOICE_MODEL: process.env.META_VOICE_MODEL || undefined,
  META_VISION_MODEL: process.env.META_VISION_MODEL || undefined,
  META_REFINE_MODEL: process.env.META_REFINE_MODEL || undefined,
  META_JUDGE_MODEL: process.env.META_JUDGE_MODEL || undefined,
  META_CODE_MODEL: process.env.META_CODE_MODEL || undefined,
  META_SEGMENT_MODEL: process.env.META_SEGMENT_MODEL || undefined,
  SHAPE_KIT_CARD_FAMILIES: process.env.SHAPE_KIT_CARD_FAMILIES || undefined,
  SHAPE_SIDE_V2: process.env.SHAPE_SIDE_V2 || undefined,
  SHAPE_LOOP_CARDS: process.env.SHAPE_LOOP_CARDS || undefined,
  SHAPE_KIT_SAMPLES: process.env.SHAPE_KIT_SAMPLES || undefined,
  META_IMAGE_MODEL: process.env.META_IMAGE_MODEL || undefined,
  META_SPEND_CAP_USD: process.env.META_SPEND_CAP_USD || undefined,
  META_PREFER_CONTRIBUTOR: process.env.META_PREFER_CONTRIBUTOR || undefined,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'mitsinjo-grid-media',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
  DATABASE_URL: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL,
});

/**
 * Browser-visible settings (NEXT_PUBLIC_*, inlined at build). Empty string = unset.
 * NEXT_PUBLIC_BRIDGE_URL: WebSocket of the local scale-model bridge (`make bridge`), e.g. ws://localhost:8787.
 * Unset → the scale-model panel is hidden (production).
 */
export const publicEnv = z
  .object({ NEXT_PUBLIC_BRIDGE_URL: z.string().url().optional() })
  .parse({ NEXT_PUBLIC_BRIDGE_URL: process.env.NEXT_PUBLIC_BRIDGE_URL || undefined });
