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
  /** Default model of every 3D step (kit, parts, critic, views check, part questions): the cheap contributor Spark. Changeable per step in the /village gear. */
  META_3D_MODEL: z.string().default('muse-spark-1.3-contributor'),
  /** Default writer of the 3D construction code (see META_CODE_MODEL); contributor Spark, not Wonder. */
  META_REFINE_MODEL: z.string().default('muse-spark-1.3-contributor'),
  /** Rubric judge of the 3D models (PQ-T4, offline `make shape-judge`); contributor Spark. */
  META_JUDGE_MODEL: z.string().default('muse-spark-1.3-contributor'),
  /** Writer of the sandboxed construction code, route B (PQ-T45, §8bis); unset = META_REFINE_MODEL. */
  META_CODE_MODEL: z.string().optional(),
  /** Per-step 3D vision overrides (PQ-T67); each unset = META_VISION_MODEL. */
  META_KIT_MODEL: z.string().optional(),
  META_PARTS_MODEL: z.string().optional(),
  META_CRITIC_MODEL: z.string().optional(),
  META_VIEWSCHECK_MODEL: z.string().optional(),
  META_ASKPART_MODEL: z.string().optional(),
  /** Folder of the route-B debug dump (PQ-T56): code, Blender .py, logs per round. `off` disables; unset = `debug/shape-code` outside production. */
  SHAPE_CODE_DUMP_DIR: z.string().optional(),
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
  /** Views reconstruction (PQ-T69): also draw the back and the left side when not validated (2 more Muse Image calls per object). */
  SHAPE_FOUR_FACES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Muse cards in the stage loop, views check and final check (PQ-T15, off by default). */
  SHAPE_LOOP_CARDS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Kit samples per photo (PQ-T18): 2 votes between two parallel calls when ≥ 40 s are left. */
  SHAPE_KIT_SAMPLES: z.coerce.number().int().min(1).max(2).default(1),
  /** Meta answer cache (PQ-T49, E12): (image, prompt version) → kit, (crop, concept) → SAM. Off for agreement evals. */
  SHAPE_CACHE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
  META_3D_MODEL: process.env.META_3D_MODEL || undefined,
  META_REFINE_MODEL: process.env.META_REFINE_MODEL || undefined,
  META_JUDGE_MODEL: process.env.META_JUDGE_MODEL || undefined,
  META_CODE_MODEL: process.env.META_CODE_MODEL || undefined,
  META_KIT_MODEL: process.env.META_KIT_MODEL || undefined,
  META_PARTS_MODEL: process.env.META_PARTS_MODEL || undefined,
  META_CRITIC_MODEL: process.env.META_CRITIC_MODEL || undefined,
  META_VIEWSCHECK_MODEL: process.env.META_VIEWSCHECK_MODEL || undefined,
  META_ASKPART_MODEL: process.env.META_ASKPART_MODEL || undefined,
  SHAPE_CODE_DUMP_DIR: process.env.SHAPE_CODE_DUMP_DIR || undefined,
  META_SEGMENT_MODEL: process.env.META_SEGMENT_MODEL || undefined,
  SHAPE_KIT_CARD_FAMILIES: process.env.SHAPE_KIT_CARD_FAMILIES || undefined,
  SHAPE_SIDE_V2: process.env.SHAPE_SIDE_V2 || undefined,
  SHAPE_FOUR_FACES: process.env.SHAPE_FOUR_FACES || undefined,
  SHAPE_LOOP_CARDS: process.env.SHAPE_LOOP_CARDS || undefined,
  SHAPE_KIT_SAMPLES: process.env.SHAPE_KIT_SAMPLES || undefined,
  SHAPE_CACHE: process.env.SHAPE_CACHE || undefined,
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
