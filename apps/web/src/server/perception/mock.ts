import type { PartsSubject, PerceptionBackend, PerceptionCall, ShapeSubject } from './backend';
import { JUDGE_CRITERIA, type JudgeCriterion } from './rubric-judge';
import { mockRecipe } from './shape';
import { boxUnionCoverage } from './parse-sam';
import { classifyLabel } from './detect';
import type {
  ApplianceDetection,
  CriticResult,
  JudgeResult,
  ViewsCheckResult,
  ShapeOpsResult,
  DetectionResult,
  Observation,
  SegmentResult,
  ShapeResult,
  TranscribeOptions,
  Transcript,
  VisionResult,
} from './schemas';

/** The mock judge's grade on every criterion (PQ-T4). */
export const MOCK_JUDGE_GRADE = 3;

/** Model id reported by every mock perception result. */
export const MOCK_PERCEPTION_MODEL = 'mock-perception-v1';

/** WAV header size and bytes per ms for mono 16-bit PCM at 16 kHz. */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_MS_16K = 32;

/** Demo phrases, picked by a keyword in the file name (offline demo and tests). */
const MOCK_PHRASES: Array<{ match: RegExp; text: string }> = [
  { match: /fire|feu|afo/i, text: "Au feu à l'école !" },
  { match: /cut|coupe|market|marche/i, text: 'Coupe le marché ce soir.' },
  { match: /cloud|nuage/i, text: 'Un nuage arrive, que se passe-t-il ?' },
];
const DEFAULT_PHRASE = 'Que se passe-t-il si le solaire baisse de 40 % pendant deux heures ?';

const MEETING_TURNS = [
  { speaker: 'A', text: 'La clinique doit garder le courant toute la nuit.' },
  { speaker: 'B', text: "L'école a besoin de lumière le matin." },
  { speaker: 'A', text: 'Le marché peut fermer plus tôt le soir.' },
];

/** Image observations, picked by a keyword in the question. */
const MOCK_OBSERVATIONS: Array<{ match: RegExp; summary: string; observations: Observation[] }> = [
  {
    // First: a blurry photo matches nothing else, whatever the question asks (M4-T5).
    match: /blurr|flou|manjavozavo/i,
    summary: 'Mock: image too blurry to read.',
    observations: [],
  },
  {
    // Before panels: a dust question names the panels too (M8-T2).
    match: /dust|poussière|poussiere|dirty/i,
    summary: 'Mock: dust on the panels.',
    observations: [{ label: 'dusty_panel', value: 25, unit: '%', confidence: 0.5 }],
  },
  {
    match: /fire|feu|smoke|fumée|fumee/i,
    summary: 'Mock: smoke visible near a building, to verify.',
    observations: [{ label: 'smoke', value: true, confidence: 0.5 }],
  },
  {
    match: /meter|compteur|onduleur|inverter/i,
    summary: 'Mock: a meter display is readable.',
    observations: [{ label: 'meter_reading', value: 1284, unit: 'kWh', confidence: 0.5 }],
  },
  {
    match: /sky|ciel|cloud|nuage|lanitra/i,
    summary: 'Mock: partly cloudy sky.',
    observations: [{ label: 'cloud_cover', value: 60, unit: '%', confidence: 0.5 }],
  },
  {
    match: /panel|panneau|ombre|shade/i,
    summary: 'Mock: one panel partly covered by leaves.',
    observations: [{ label: 'shaded_panel', value: 10, unit: '%', confidence: 0.5 }],
  },
];

/**
 * Appliances "seen" on any photo in mock mode (fixture of the bundled sample room, PV-T6).
 * Image fractions, top-left origin.
 */
export const MOCK_DETECTIONS: ApplianceDetection[] = [
  {
    id: 'det-1',
    label: 'Fridge',
    labels: { fr: 'Réfrigérateur', mg: 'Vata fampangatsiahana' },
    category: 'fridge',
    confidence: 0.9,
    box: { x: 0.06, y: 0.22, w: 0.2, h: 0.66 },
  },
  {
    id: 'det-2',
    label: 'Television',
    labels: { fr: 'Télévision', mg: 'Fahitalavitra' },
    category: 'tv',
    confidence: 0.85,
    box: { x: 0.42, y: 0.3, w: 0.26, h: 0.24 },
  },
  {
    id: 'det-3',
    label: 'Ceiling lamp',
    labels: { fr: 'Plafonnier', mg: 'Jiro mihantona' },
    category: 'lamp',
    confidence: 0.8,
    box: { x: 0.5, y: 0.02, w: 0.08, h: 0.1 },
  },
  {
    id: 'det-4',
    label: 'Standing fan',
    labels: { fr: 'Ventilateur sur pied', mg: 'Fivelezana mijoro' },
    category: 'fan',
    confidence: 0.75,
    box: { x: 0.76, y: 0.38, w: 0.16, h: 0.5 },
  },
  {
    id: 'det-5',
    label: 'Phone charger',
    labels: { fr: 'Chargeur de téléphone', mg: 'Fiampangana finday' },
    category: 'phone_charger',
    confidence: 0.6,
    box: { x: 0.44, y: 0.62, w: 0.06, h: 0.06 },
  },
];

/** Deterministic perception for `LLM_PROVIDER=mock`, tests and every Meta failure. */
export class MockPerceptionBackend implements PerceptionBackend {
  readonly name = 'mock' as const;

  async transcribe(
    audio: Blob,
    options: TranscribeOptions = {}
  ): Promise<PerceptionCall<Transcript>> {
    const durationMs = Math.max(0, Math.round((audio.size - WAV_HEADER_BYTES) / BYTES_PER_MS_16K));
    const hint = options.fileName ?? '';

    if (options.diarize) {
      const step = Math.floor(durationMs / MEETING_TURNS.length);
      const turns = MEETING_TURNS.map((t, i) => ({
        startMs: i * step,
        endMs: (i + 1) * step,
        text: t.text,
        speaker: t.speaker,
      }));
      return {
        model: MOCK_PERCEPTION_MODEL,
        usage: {},
        result: { text: turns.map((t) => t.text).join(' '), durationMs, turns },
      };
    }

    const text = MOCK_PHRASES.find((p) => p.match.test(hint))?.text ?? DEFAULT_PHRASE;
    return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { text, durationMs, turns: [] } };
  }

  async analyzeImage(_imageUrl: string, question: string): Promise<PerceptionCall<VisionResult>> {
    const hit = MOCK_OBSERVATIONS.find((o) => o.match.test(question));
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: hit
        ? { summary: hit.summary, observations: hit.observations }
        : { summary: 'Mock: nothing to report on this image.', observations: [] },
    };
  }

  async segmentImage(_imageUrl: string, concept: string): Promise<PerceptionCall<SegmentResult>> {
    const imageWidth = 1920;
    const imageHeight = 1280;
    const instances = [
      { box: { x1: 16, y1: 586, x2: 748, y2: 1094 }, confidence: 0.9 },
      { box: { x1: 1179, y1: 585, x2: 1900, y2: 1071 }, confidence: 0.9 },
    ];
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: {
        concept,
        imageWidth,
        imageHeight,
        instances,
        count: instances.length,
        boxCoverage: boxUnionCoverage(
          instances.map((i) => i.box),
          imageWidth,
          imageHeight
        ),
      },
    };
  }

  /** The operator's hint, classified by keywords; no hint → not identified. Box = the whole crop. */
  async identifyRegion(
    _imageUrl: string,
    hint: string | undefined
  ): Promise<PerceptionCall<DetectionResult>> {
    const label = hint?.trim().slice(0, 40);
    if (!label) return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { detections: [] } };
    const c = classifyLabel(label);
    const box = { x: 0, y: 0, w: 1, h: 1 };
    const detection: ApplianceDetection =
      c.kind === 'appliance'
        ? { id: 'region', label, category: c.category, box }
        : { id: 'region', label, kind: 'scenery', category: 'other', scenery: c.scenery, box };
    return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { detections: [detection] } };
  }

  /** Fixed recipe per category or scenery type (fridge, TV, house, tree…; else a box). */
  async describeShape(
    _imageUrl: string,
    target: ShapeSubject
  ): Promise<PerceptionCall<ShapeResult>> {
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: { recipe: mockRecipe(target.category, target.scenery) },
    };
  }

  /** No imagined parts in mock mode (null recipe): the orchestrator keeps the kit recipe. */
  async describeParts(
    _imageUrl: string,
    _target: PartsSubject
  ): Promise<PerceptionCall<ShapeResult>> {
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: { recipe: null },
    };
  }

  async detectAppliances(): Promise<PerceptionCall<DetectionResult>> {
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: { detections: MOCK_DETECTIONS.map((d) => ({ ...d, box: { ...d.box } })) },
    };
  }

  async criticizeShape(
    _imageUrl: string,
    _question: string
  ): Promise<PerceptionCall<CriticResult>> {
    // The mock never patches: the critic round is a no-op without Meta.
    return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { patch: null } };
  }

  /** Fixed grade 3 on every criterion: the judge is a developer tool, never live in mock. */
  async judgeShape(_imageUrl: string, _question: string): Promise<PerceptionCall<JudgeResult>> {
    const grades = Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, MOCK_JUDGE_GRADE])) as Record<
      JudgeCriterion,
      number
    >;
    return {
      model: MOCK_PERCEPTION_MODEL,
      usage: {},
      result: { judgement: { grades, notes: {} } },
    };
  }

  async checkViews(
    _imageUrl: string,
    _question: string
  ): Promise<PerceptionCall<ViewsCheckResult>> {
    // No check without Meta: the views model stays as built.
    return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { check: null } };
  }

  async proposeShapeOps(): Promise<PerceptionCall<ShapeOpsResult>> {
    // No stage patch without Meta: the loop keeps the seed.
    return { model: MOCK_PERCEPTION_MODEL, usage: {}, result: { ops: [] } };
  }
}
