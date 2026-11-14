import type { ApplianceCategory } from '@mitsinjo/engine';
import type { KitArchetype } from '@/lib/object-kit';
import type { SceneryType } from '@/lib/vision';
import type { UsageSample } from '@/server/spend';
import type {
  CodeResult,
  CriticResult,
  JudgeResult,
  ClassMaterialsResult,
  HouseReadResult,
  PartAskResult,
  ViewsCheckResult,
  DetectionResult,
  SegmentResult,
  ShapeResult,
  TranscribeOptions,
  Transcript,
  VisionResult,
} from './schemas';

/** A backend answer without its envelope: what the cache remembers (PQ-T49). */
export type WithoutSource<T> = Omit<T, 'source' | 'model' | 'fallback'>;

export interface CriticOptions {
  promptVersion?: number;
  archetype?: KitArchetype;
}

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
    signal?: AbortSignal,
    /** Prompt version and the family's card (PQ-T14); default version 1. */
    opts?: CriticOptions
  ): Promise<PerceptionCall<CriticResult>>;
  /**
   * Short per-part question (PQ-T52, E9/E11): `imageUrl` is the zone crop, `question` names one
   * part. One Spark call at `low` effort; null answer when unusable. Optional: no per-part
   * questions without it.
   */
  askPart?(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<PartAskResult>>;
  /**
   * Materials of a views reconstruction's colour classes (PQ-T69): `imageUrl` is the class
   * sheet (tile 0 = the object, one tile per class), `classes` how many to answer. One cheap
   * call at `low` effort; null when unusable. Optional: the model is built without materials.
   */
  nameClasses?(
    imageUrl: string,
    question: string,
    classes: number,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ClassMaterialsResult>>;
  /**
   * House specialist (PQ-T72): `imageUrl` is the first drawing, `references` the next ones, in
   * the order `question` names them (each cropped to the house). One Spark call at `high` effort;
   * null reading when unusable. Optional: the model keeps its drawn hull without it.
   */
  readHouse?(
    imageUrl: string,
    question: string,
    references: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<PerceptionCall<HouseReadResult>>;
  /**
   * One call of the piloted house reading (PQ-T73): the pilot or a part specialist, with its own
   * system prompt and JSON schema; the raw answer. Optional: without it the single reading runs.
   */
  askHouseTool?(
    tool: string,
    system: string,
    schema: { name: string; schema: object },
    imageUrl: string,
    question: string,
    references: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<PerceptionCall<{ content: string | null }>>;
  /**
   * One call of the car team (PQ-T76): the pilot or a specialist, with its own system prompt and
   * JSON schema; the raw answer. Optional: without it a car keeps its measured plan only.
   */
  askCarTool?(
    tool: string,
    system: string,
    schema: { name: string; schema: object },
    imageUrl: string,
    question: string,
    references: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<PerceptionCall<{ content: string | null }>>;
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
   * AI check of a views model (PV-H): `imageUrl` is the three-view drawings | model sheet,
   * `question` the label and silhouette match. One vision call; null check when unusable.
   */
  checkViews(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ViewsCheckResult>>;
  /**
   * Sandboxed construction code, route B (PQ-T45, §8bis): `imageUrl` is photo | current
   * render, `question` the draft, its score and the measures. One writer-model call
   * (`stepModel('code')`, Wonder by default); null code when unusable. Optional: no route B
   * without it.
   */
  writeBuildCode?(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    /** Writer prompt version (PQ-T55 v2: generic kinds; default = current). */
    version?: number
  ): Promise<PerceptionCall<CodeResult>>;
}

/** What `describeShape` is told about the object. */
export interface ShapeSubject {
  label: string;
  category: ApplianceCategory;
  /** Set for scenery (no load): building, tree, vehicle… */
  scenery?: SceneryType;
  /** Width / height of the object on the photo, in pixels (thin pole ≈ 0.1, wide car ≈ 2). */
  aspect?: number;
  /** Photo facts measured by code (PQ-T7), sent as the « Measured: » line of the question. */
  facts?: string[];
  /**
   * Validated 2D facade (front elevation, unoccluded): a second image beside the crop. The crop
   * keeps size, pose and measured colours; the facade refines windows, doors, materials, parts.
   */
  facadeUrl?: string;
  /** Family the operator picked (PQ-T41): the kit hint. */
  archetype?: string;
  /** Kit prompt version to ask with (PQ-T5, evals); default `KIT_PROMPT_VERSION`. */
  promptVersion?: number;
  /**
   * Skip the answer cache entirely (PQ-T49): the second kit sample of a vote must be an
   * independent answer, never the first sample remembered.
   */
  fresh?: boolean;
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
  /** Kit prompt version the object was described with (default: current): version 2 loads the Muse cards. */
  promptVersion?: number;
}
