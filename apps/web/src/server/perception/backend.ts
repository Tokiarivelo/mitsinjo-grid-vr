import type { ApplianceCategory } from '@mitsinjo/engine';
import type { KitArchetype } from '@/lib/object-kit';
import type { SceneryType } from '@/lib/vision';
import type { UsageSample } from '@/server/spend';
import type { StageSheet } from './shape-script-prompt';
import type {
  CriticResult,
  JudgeResult,
  ViewsCheckResult,
  ShapeOpsResult,
  DetectionResult,
  SegmentResult,
  ShapeResult,
  TranscribeOptions,
  Transcript,
  VisionResult,
} from './schemas';

type WithoutSource<T> = Omit<T, 'source' | 'model' | 'fallback'>;

export interface PerceptionCall<T> {
  result: WithoutSource<T>;
  model: string;
  /** What the call cost, for the spend guard (empty for the mock). */
  usage: UsageSample;
}

/** One way to reach the perception models: the Meta API or the deterministic mock. */
export interface PerceptionBackend {
  readonly name: 'meta' | 'mock';
  /** `audio` must be WAV (mono PCM 16 or 24 kHz): the only format the Meta API accepts. */
  transcribe(
    audio: Blob,
    options?: TranscribeOptions,
    signal?: AbortSignal
  ): Promise<PerceptionCall<Transcript>>;
  /** `imageUrl`: https URL or `data:image/...;base64,...`. */
  analyzeImage(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<VisionResult>>;
  /** One concept per call (a short noun phrase, e.g. `solar panel`). */
  segmentImage(
    imageUrl: string,
    concept: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<SegmentResult>>;
  /** Appliances visible on a photo (PV): labels, categories, boxes. One vision call. */
  detectAppliances(
    imageUrl: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<DetectionResult>>;
  /** The one object inside an operator-drawn shape (PV-T8): `imageUrl` is the crop, `hint` what they typed. */
  identifyRegion(
    imageUrl: string,
    hint: string | undefined,
    signal?: AbortSignal
  ): Promise<PerceptionCall<DetectionResult>>;
  /** 3D recipe of one object (PV-T9): `imageUrl` is the crop around it. One vision call. */
  describeShape(
    imageUrl: string,
    target: ShapeSubject,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ShapeResult>>;
  /**
   * LLM-imagined part list (free recipe): same crop, but the model lists the solid parts itself.
   * Only for archetypes without a real kit template (`needsFreeParts`); no `kit` in the result.
   */
  describeParts(
    imageUrl: string,
    target: PartsSubject,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ShapeResult>>;
  /**
   * Visual critic (PR-0.6): `imageUrl` is crop | flat render side by side, `question` carries the
   * kit + scores. One vision call, partial-kit schema; null patch when the model matches.
   */
  criticizeShape(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<CriticResult>>;
  /**
   * Rubric judge (PQ-T4): `imageUrl` is photo | model | model ¾, `question` names the object.
   * Asked of `META_JUDGE_MODEL` (Muse Wonder); offline and background only.
   */
  judgeShape(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<JudgeResult>>;
  /**
   * AI check of a views model (PV-H): `imageUrl` is the 2 × 2 drawings | model sheet, `question`
   * the label and silhouette match. One vision call; null check when unusable.
   */
  checkViews(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ViewsCheckResult>>;
  /**
   * Shape loop stage (PG-T15): `imageUrl` is drawing | model | diff, `question` the stage, its
   * scores and the components. One vision call; null ops when unusable. Optional: no loop without it.
   * `refine` = the final check stage: asked of the deep-reasoning model (Muse Wonder).
   */
  proposeShapeOps?(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    sheet?: StageSheet,
    opts?: ShapeOpsOptions
  ): Promise<PerceptionCall<ShapeOpsResult>>;
}

/** Options of one stage call. */
export interface ShapeOpsOptions {
  /** Final check and re-refinement: deep-reasoning model instead of the standard vision one. */
  refine?: boolean;
}

/** What `describeShape` is told about the object. */
export interface ShapeSubject {
  label: string;
  category: ApplianceCategory;
  /** Set for scenery (no load): building, tree, vehicle… */
  scenery?: SceneryType;
  /** Width / height of the object on the photo, in pixels (thin pole ≈ 0.1, wide car ≈ 2). */
  aspect?: number;
  /**
   * Validated 2D facade (front elevation, unoccluded): a second image beside the crop. The crop
   * keeps size, pose and measured colours; the facade refines windows, doors, materials, parts.
   */
  facadeUrl?: string;
  /** Kit prompt version to ask with (PQ-T5, evals); default `KIT_PROMPT_VERSION`. */
  promptVersion?: number;
}

/** What `describeParts` is told about the object. */
export interface PartsSubject {
  label: string;
  archetype: KitArchetype;
  /**
   * Which photo edges cut the object (from `coverageForBox`, e.g. `cut off at the left and
   * bottom`) — absent when the box shows it whole. The model must imagine the whole object either way.
   */
  coverage?: string;
  /**
   * Validated 2D facade (front elevation, unoccluded): a second image beside the crop. The crop
   * keeps size, pose and measured colours; the facade refines windows, doors, materials, parts.
   */
  facadeUrl?: string;
}
