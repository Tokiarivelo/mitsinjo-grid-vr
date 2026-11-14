import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';
import { DEFAULT_META_BASE_URL } from '@/server/copilot/providers/meta';
import { fetchPreferringContributor } from '@/server/copilot/providers/contributor';
import type { UsageSample } from '@/server/spend';
import type { StepModelsSelection, StepModelStep } from '@/lib/step-models';
import type {
  CriticOptions,
  PartsSubject,
  PerceptionBackend,
  PerceptionCall,
  ShapeSubject,
} from './backend';
import {
  DETECT_JSON_SCHEMA,
  DETECT_QUESTION,
  DETECT_SYSTEM_PROMPT,
  parseDetections,
  parseImageType,
} from './detect';
import {
  parseFreeParts,
  PARTS_JSON_SCHEMA,
  partsPrompt,
  shapePartsQuestion,
  visibilityFromCoverage,
} from './free-recipe';
import { maskToOutline } from './mask-outline';
import { timeoutSignal } from './abort';
import { inlineImageUrl } from './inline-image';
import {
  getCachedKit,
  getCachedSam,
  kitCacheKey,
  samCacheKey,
  setCachedKit,
  setCachedSam,
} from './shape-cache';
import {
  JUDGE_CRITERIA,
  JUDGE_JSON_SCHEMA,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  parseJudge,
} from './rubric-judge';
import { CODE_JSON_SCHEMA, CODE_PROMPT_VERSION, codePrompt, parseBuildCode } from './shape-code';
import { logStepModelsOnce, stepModel } from './step-models';
import { readCompletion, STREAMED_KINDS } from './chat-stream';
import { longFetch } from './long-fetch';
import {
  HOUSE_JSON_SCHEMA,
  HOUSE_PROMPT_VERSION,
  HOUSE_SYSTEM_PROMPT,
  parseHouseReading,
} from './house/house-prompt';
import { HOUSE_TOOLS_PROMPT_VERSION } from './house/house-tools';
import {
  LABEL_JSON_SCHEMA,
  LABEL_SYSTEM_PROMPT,
  parseClassMaterials,
  parseRoofClass,
} from './recon/label-classes';
import {
  VIEWS_CHECK_JSON_SCHEMA,
  VIEWS_CHECK_CARDS_VERSION,
  VIEWS_CHECK_PROMPT_VERSION,
  viewsCheckPrompt,
  parseViewsCheck,
} from './views-check';
import { REGION_SYSTEM_PROMPT, regionQuestion } from './region-prompt';
import { archetypeOf, kitToRecipe } from '@/lib/object-kit';
import {
  CRITIC_ANATOMY_VERSION,
  CRITIC_PROMPT_CARDS_VERSION,
  CRITIC_PROMPT_VERSION,
  capPatchFields,
  criticJsonSchema,
  criticPrompt,
  parseKitReasons,
  parseMissingParts,
  kitVersionFor,
  kitPrompt,
  parseKit,
  parseKitPatch,
  kitJsonSchema,
  shapeQuestion,
} from './shape';
import { boxUnionCoverage, parseSamOutput } from './parse-sam';
import { effortFor } from './effort';
import {
  PART_QUESTION_JSON_SCHEMA,
  PART_QUESTION_SYSTEM_PROMPT,
  parsePartAnswer,
} from './part-question';
import { redactDataUrls, redactDataUrlsInText, type VisionCallLog } from './vision-log';
import {
  ObservationSchema,
  type CodeResult,
  type CriticResult,
  type JudgeResult,
  type ClassMaterialsResult,
  type HouseReadResult,
  type PartAskResult,
  type ViewsCheckResult,
  type DetectionResult,
  type SegmentResult,
  type ShapeResult,
  type TranscribeOptions,
  type Transcript,
  type VisionResult,
} from './schemas';
import { ensureNetworkDefaults } from '@/server/net';

const VISION_SYSTEM_PROMPT = [
  'You look at photos for the operator of a SIMULATED rural solar microgrid.',
  'Report only what is visible. Use snake_case labels such as cloud_cover (%), shaded_panel (%),',
  'meter_reading (copy the printed number and unit), smoke (true/false), fire (true/false).',
  'Never compute or guess energy values (kW, kWh): only copy numbers printed in the image.',
  'confidence is your own 0-1 confidence. If the image is unreadable, return no observations and say so.',
].join(' ');

const VISION_JSON_SCHEMA = {
  name: 'Perception',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      observations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: ['number', 'string', 'boolean'] },
            unit: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['label', 'value', 'confidence'],
        },
      },
    },
    required: ['summary', 'observations'],
  },
};

const VisionPayloadSchema = z.object({
  summary: z.string(),
  observations: z.array(z.unknown()),
});

const TranscribePayloadSchema = z.object({
  transcript: z.string(),
  audioDurationMs: z.number(),
  turns: z
    .array(
      z.object({
        startMs: z.number(),
        endMs: z.number(),
        transcript: z.string(),
        speaker: z.string().optional(),
      })
    )
    .default([]),
});

interface ResponsesPayload {
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
}

/**
 * Default cap on one vision call: none — the generation is awaited until it answers (only the
 * caller's own signal, e.g. the browser leaving, aborts it).
 */
export const VISION_CALL_MAX_MS: number | null = null;

/** Perception through the Meta Model API (same key and base URL as the chat). */
export class MetaPerceptionBackend implements PerceptionBackend {
  readonly name = 'meta' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly preferContributor: boolean;
  private readonly stepModels: StepModelsSelection;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    preferContributor?: boolean;
    /** Operator's stored per-step choice (`shape_step_models`): wins over the env defaults. */
    stepModels?: StepModelsSelection;
  }) {
    ensureNetworkDefaults();
    this.preferContributor = options?.preferContributor ?? env.META_PREFER_CONTRIBUTOR;
    this.apiKey = options?.apiKey || env.META_API_KEY || '';
    this.baseUrl = (options?.baseUrl || env.META_BASE_URL || DEFAULT_META_BASE_URL).replace(
      /\/$/,
      ''
    );
    this.stepModels = options?.stepModels ?? {};
    logStepModelsOnce();
  }

  /** Model id serving one 3D step for this request (stored choice, else env). */
  private modelFor(step: StepModelStep): string {
    return stepModel(step, this.stepModels);
  }

  private async post(path: string, body: BodyInit, init: HeadersInit, signal?: AbortSignal) {
    return (await this.postWithModel(path, () => body, '', init, signal)).data;
  }

  /** POST whose body depends on the model id, so a contributor refusal can be resent on `baseModel`. */
  private async postWithModel(
    path: string,
    makeBody: (model: string) => BodyInit,
    baseModel: string,
    init: HeadersInit,
    signal?: AbortSignal,
    allowContributor = true,
    /** A long reasoning call: sent through `longFetch` (no 300 s header / body timers). */
    long = false
  ): Promise<{ data: unknown; model: string }> {
    if (!this.apiKey) throw new Error('META_API_KEY is not configured in environment');
    const { res, model } = await fetchPreferringContributor(
      baseModel,
      Boolean(baseModel) && this.preferContributor && allowContributor,
      (m) => {
        const body = makeBody(m);
        const headers = { Authorization: `Bearer ${this.apiKey}`, ...init } as Record<
          string,
          string
        >;
        return long && typeof body === 'string'
          ? longFetch(`${this.baseUrl}${path}`, {
              method: 'POST',
              headers,
              body,
              ...(signal ? { signal } : {}),
            })
          : fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body, signal });
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Meta perception API error (${res.status}) on ${path}: ${text.slice(0, 300)}`
      );
    }
    // A streamed call (`STREAMED_KINDS`) answers in server-sent events: put back into one completion.
    return { data: await readCompletion(res), model };
  }

  async transcribe(
    audio: Blob,
    options: TranscribeOptions = {},
    signal?: AbortSignal
  ): Promise<PerceptionCall<Transcript>> {
    const model = env.META_VOICE_MODEL;
    const form = new FormData();
    const request = {
      model,
      audioEncoding: 'WAV',
      mode: options.diarize ? 'DIARIZATION' : 'PUSH_TO_TALK',
      ...(options.languages?.length ? { languageBias: options.languages } : {}),
      ...(options.keywords?.length ? { keywords: options.keywords } : {}),
    };
    form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
    form.append('audio', audio, options.fileName || 'audio.wav');

    const data = TranscribePayloadSchema.parse(
      await this.post('/asr/transcribe', form, { Accept: 'application/json' }, signal)
    );
    return {
      model,
      usage: { audioMs: data.audioDurationMs },
      result: {
        text: data.transcript,
        durationMs: Math.round(data.audioDurationMs),
        turns: data.turns.map((t) => ({
          startMs: Math.round(t.startMs),
          endMs: Math.round(t.endMs),
          text: t.transcript,
          ...(t.speaker ? { speaker: t.speaker } : {}),
        })),
      },
    };
  }

  /** Spark `chat/completions` with a JSON-schema answer: shared by every vision call. */
  private async visionJson(
    system: string,
    question: string,
    imageUrl: string,
    jsonSchema: object,
    signal?: AbortSignal,
    /** false = always the standard model id (latency-sensitive calls). */
    allowContributor = true,
    /** Full request + result lines for the 3D calls (images logged as placeholders only). */
    log?: VisionCallLog,
    /** Reference images sent after the main one (the validated 2D facade). */
    extraImages: ReadonlyArray<string> = [],
    baseModel: string = env.META_VISION_MODEL
  ): Promise<{ content: string; model: string; usage: UsageSample }> {
    if (log) {
      const schema = (jsonSchema as { name?: unknown }).name;
      console.info(
        `[vision] 3D ${log.kind} → model ${baseModel} params ${JSON.stringify(log.params ?? {}, redactDataUrls)} image ${redactDataUrls('image', imageUrl)}${extraImages.map((u) => ` + reference ${redactDataUrls('image', u)}`).join('')} schema ${typeof schema === 'string' ? schema : 'custom'}`
      );
      console.info(`[vision] 3D ${log.kind} system: ${system}`);
      console.info(`[vision] 3D ${log.kind} question: ${question}`);
    }
    const [mainImage, ...references] = await Promise.all(
      [imageUrl, ...extraImages].map((url) => inlineImageUrl(url))
    );
    const body = (model: string) => ({
      model,
      // High reasoning on detection + 3D kits: better perception for the operator (table: effort.ts).
      reasoning_effort: effortFor(log?.kind),
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: mainImage } },
            ...references.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: jsonSchema },
      // Long reasoning calls stream: headers at once, no 300 s wait for the first byte.
      ...(log && STREAMED_KINDS.has(log.kind)
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
    });
    const sent = await this.postWithModel(
      '/chat/completions',
      (m) => JSON.stringify(body(m)),
      baseModel,
      { 'Content-Type': 'application/json' },
      timeoutSignal(VISION_CALL_MAX_MS, signal),
      allowContributor,
      Boolean(log && STREAMED_KINDS.has(log.kind))
    );
    const data = sent.data as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const out = {
      content: data.choices?.[0]?.message?.content ?? '',
      model: sent.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
    if (log) {
      console.info(
        `[vision] 3D ${log.kind} ← ${out.model} (in ${out.usage.inputTokens}, out ${out.usage.outputTokens}): ${redactDataUrlsInText(out.content)}`
      );
    }
    return out;
  }

  async analyzeImage(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<VisionResult>> {
    const { content, model, usage } = await this.visionJson(
      VISION_SYSTEM_PROMPT,
      question,
      imageUrl,
      VISION_JSON_SCHEMA,
      signal
    );
    const parsed = VisionPayloadSchema.parse(JSON.parse(content));
    // Keep only well-formed observations; clamp confidence the model may print as 0-100.
    const observations = parsed.observations.flatMap((raw) => {
      const obs = raw as Record<string, unknown>;
      const confidence =
        typeof obs.confidence === 'number' && obs.confidence > 1
          ? obs.confidence / 100
          : obs.confidence;
      const ok = ObservationSchema.safeParse({ ...obs, confidence });
      return ok.success ? [ok.data] : [];
    });

    return { model, usage, result: { summary: parsed.summary, observations } };
  }

  async detectAppliances(
    imageUrl: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<DetectionResult>> {
    const { content, model, usage } = await this.visionJson(
      DETECT_SYSTEM_PROMPT,
      DETECT_QUESTION,
      imageUrl,
      DETECT_JSON_SCHEMA,
      signal
    );
    const detections = parseDetections(content);
    if (detections.length === 0) {
      // Helps tell « nothing seen » from a reply shape we do not read.
      console.info(`[vision] ${model} listed no object: ${content.slice(0, 300)}`);
    }
    return { model, usage, result: { detections, imageType: parseImageType(content) } };
  }

  async identifyRegion(
    imageUrl: string,
    hint: string | undefined,
    signal?: AbortSignal
  ): Promise<PerceptionCall<DetectionResult>> {
    const { content, model, usage } = await this.visionJson(
      REGION_SYSTEM_PROMPT,
      regionQuestion(hint),
      imageUrl,
      DETECT_JSON_SCHEMA,
      signal
    );
    return { model, usage, result: { detections: parseDetections(content) } };
  }

  async describeShape(
    imageUrl: string,
    target: ShapeSubject,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ShapeResult>> {
    const hint = archetypeOf(target);
    // Standard id, not the contributor one: the operator waits on this answer (≈ 15 s vs ≈ 25 s measured).
    const promptVersion = target.promptVersion ?? kitVersionFor(hint, env.SHAPE_KIT_CARD_FAMILIES);
    // PQ-T49: a repeated crop is answered from memory (no Meta call, $0 of spend).
    // A `fresh` sample bypasses both ways: it must be independent and leave no trace.
    const cacheKey =
      env.SHAPE_CACHE && !target.fresh
        ? kitCacheKey(imageUrl, {
            promptVersion,
            label: target.label,
            category: target.category,
            ...(target.archetype ? { archetype: target.archetype } : {}),
            ...(target.facadeUrl ? { facadeUrl: target.facadeUrl } : {}),
            model: this.modelFor('kit'),
          })
        : null;
    const remembered = cacheKey ? getCachedKit(cacheKey) : undefined;
    if (remembered) {
      console.info(
        `[vision] 3D kit cache hit from ${remembered.model} (${remembered.result.kit?.archetype ?? '?'}, prompt v${promptVersion})`
      );
      return { model: remembered.model, usage: {}, result: remembered.result };
    }
    const { content, model, usage } = await this.visionJson(
      kitPrompt(promptVersion, hint),
      shapeQuestion(target.label, target.aspect, hint, Boolean(target.facadeUrl), target.facts),
      imageUrl,
      kitJsonSchema(promptVersion),
      signal,
      false,
      { kind: 'describeShape', params: { ...target, promptVersion } },
      target.facadeUrl ? [target.facadeUrl] : [],
      this.modelFor('kit')
    );
    const kit = parseKit(content, hint);
    if (!kit) console.info(`[vision] ${model} gave no usable 3D kit: ${content.slice(0, 300)}`);
    else console.info(`[vision] 3D kit from ${model}: ${kit.archetype}`);
    const result = {
      recipe: kit ? kitToRecipe(kit) : null,
      ...(kit ? { kit } : {}),
    };
    if (cacheKey && kit) setCachedKit(cacheKey, model, result);
    return { model, usage, result };
  }

  async describeParts(
    imageUrl: string,
    target: PartsSubject,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ShapeResult>> {
    // Standard id, not the contributor one: the operator waits on this answer (same as the kit call).
    const { content, model, usage } = await this.visionJson(
      partsPrompt(target.promptVersion),
      shapePartsQuestion(
        target.label,
        target.archetype,
        visibilityFromCoverage(target.coverage),
        Boolean(target.facadeUrl)
      ),
      imageUrl,
      PARTS_JSON_SCHEMA,
      signal,
      false,
      { kind: 'describeParts', params: { ...target } },
      target.facadeUrl ? [target.facadeUrl] : [],
      this.modelFor('parts')
    );
    const recipe = parseFreeParts(content);
    if (!recipe)
      console.info(`[vision] ${model} gave no usable part list: ${content.slice(0, 300)}`);
    else
      console.info(
        `[vision] free part list from ${model}: ${recipe.parts.length} parts (${target.archetype})`
      );
    return { model, usage, result: { recipe } };
  }

  async criticizeShape(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    opts: CriticOptions = {}
  ): Promise<PerceptionCall<CriticResult>> {
    const promptVersion = opts.promptVersion ?? CRITIC_PROMPT_VERSION;
    // Standard id, like the kit call: the operator waits on this answer.
    // No separate params: the question already carries the kit and the scores.
    const { content, model, usage } = await this.visionJson(
      criticPrompt(promptVersion, opts.archetype),
      question,
      imageUrl,
      criticJsonSchema(promptVersion),
      signal,
      false,
      { kind: 'criticizeShape', params: { promptVersion } },
      [],
      this.modelFor('critic')
    );
    const parsed = parseKitPatch(content);
    // Version 2 cuts a long patch to its first 4 fields (PQ-T14); version 3 keeps version 1 whole.
    const patch =
      parsed && promptVersion === CRITIC_PROMPT_CARDS_VERSION ? capPatchFields(parsed) : parsed;
    const reasons = promptVersion === CRITIC_PROMPT_CARDS_VERSION ? parseKitReasons(content) : [];
    const missingParts =
      promptVersion === CRITIC_PROMPT_CARDS_VERSION || promptVersion >= CRITIC_ANATOMY_VERSION
        ? parseMissingParts(content, opts.archetype)
        : [];
    console.info(
      `[vision] 3D critic from ${model}: ${patch ? Object.keys(patch).join(',') : 'no patch'}${missingParts.length ? `, missing ${missingParts.join(', ')}` : ''}${reasons.length ? ` (${reasons.join(' | ')})` : ''}`
    );
    return { model, usage, result: { patch, missingParts } };
  }

  async askPart(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<PartAskResult>> {
    // Standard id, like the kit call: the critic waits on these answers.
    const { content, model, usage } = await this.visionJson(
      PART_QUESTION_SYSTEM_PROMPT,
      question,
      imageUrl,
      PART_QUESTION_JSON_SCHEMA,
      signal,
      false,
      { kind: 'askPart' },
      [],
      this.modelFor('askPart')
    );
    const answer = parsePartAnswer(content);
    console.info(
      `[vision] 3D part answer from ${model}: ${answer ? (answer.present ? `yes${answer.where ? ` (${answer.where})` : ''}${answer.color ? ` ${answer.color}` : ''}` : 'no') : 'unusable'}`
    );
    return { model, usage, result: { answer } };
  }

  async nameClasses(
    imageUrl: string,
    question: string,
    classes: number,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ClassMaterialsResult>> {
    // The cheapest seeing model (contributor allowed): a wrong answer costs a surface look only.
    const { content, model, usage } = await this.visionJson(
      LABEL_SYSTEM_PROMPT,
      question,
      imageUrl,
      LABEL_JSON_SCHEMA,
      signal,
      true,
      { kind: 'nameClasses' },
      [],
      this.modelFor('parts')
    );
    const materials = parseClassMaterials(content, classes);
    const roof = materials ? parseRoofClass(content, classes) : null;
    console.info(
      `[vision] 3D class materials from ${model}: ${materials ? materials.map((m, i) => `${i + 1}=${m ?? '?'}`).join(' ') : 'unusable'}${roof !== null ? `, roof = ${roof + 1}` : ''}`
    );
    return { model, usage, result: { materials, ...(roof !== null ? { roof } : {}) } };
  }

  async readHouse(
    imageUrl: string,
    question: string,
    references: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<PerceptionCall<HouseReadResult>> {
    // The seeing model of the parts step (contributor allowed): a wrong reading keeps the hull.
    const { content, model, usage } = await this.visionJson(
      HOUSE_SYSTEM_PROMPT,
      question,
      imageUrl,
      HOUSE_JSON_SCHEMA,
      signal,
      true,
      { kind: 'readHouse', params: { promptVersion: HOUSE_PROMPT_VERSION } },
      references,
      this.modelFor('parts')
    );
    const reading = parseHouseReading(content);
    console.info(
      `[vision] 3D house reading from ${model}: ${reading ? `${reading.volumes.length} volumes (${reading.volumes.map((v) => v.kind).join(', ')}), ${reading.openings.length} openings, ${reading.chimneys.length} chimneys` : 'unusable'}`
    );
    return { model, usage, result: { reading } };
  }

  async askHouseTool(
    tool: string,
    system: string,
    schema: { name: string; schema: object },
    imageUrl: string,
    question: string,
    references: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<PerceptionCall<{ content: string | null }>> {
    // PQ-T73: the pilot and each part specialist, on the seeing model of the parts step.
    const kind = tool === 'pilot' ? 'housePilot' : 'houseTool';
    const { content, model, usage } = await this.visionJson(
      system,
      question,
      imageUrl,
      schema,
      signal,
      true,
      { kind, params: { tool, promptVersion: HOUSE_TOOLS_PROMPT_VERSION } },
      references,
      this.modelFor('parts')
    );
    console.info(
      `[vision] 3D house ${tool} from ${model}: ${content ? `${content.length} chars` : 'empty'}`
    );
    return { model, usage, result: { content: content || null } };
  }

  async judgeShape(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<JudgeResult>> {
    const { content, model, usage } = await this.visionJson(
      JUDGE_SYSTEM_PROMPT,
      question,
      imageUrl,
      JUDGE_JSON_SCHEMA,
      signal,
      false,
      { kind: 'judgeShape', params: { promptVersion: JUDGE_PROMPT_VERSION } },
      [],
      this.modelFor('judge')
    );
    const judgement = parseJudge(content);
    console.info(
      `[vision] 3D judge from ${model}: ${judgement ? JUDGE_CRITERIA.map((c) => `${c} ${judgement.grades[c]}`).join(', ') : 'unusable'}`
    );
    return { model, usage, result: { judgement } };
  }

  async writeBuildCode(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    version: number = CODE_PROMPT_VERSION
  ): Promise<PerceptionCall<CodeResult>> {
    const { content, model, usage } = await this.visionJson(
      codePrompt(version),
      question,
      imageUrl,
      CODE_JSON_SCHEMA,
      signal,
      false,
      { kind: 'writeBuildCode', params: { promptVersion: version } },
      [],
      this.modelFor('code')
    );
    const code = parseBuildCode(content);
    console.info(
      `[vision] 3D build code from ${model}: ${code ? `${Buffer.byteLength(code, 'utf8')} bytes` : 'unusable'}`
    );
    return { model, usage, result: { code } };
  }

  async checkViews(
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<ViewsCheckResult>> {
    const promptVersion = env.SHAPE_LOOP_CARDS
      ? VIEWS_CHECK_CARDS_VERSION
      : VIEWS_CHECK_PROMPT_VERSION;
    const { content, model, usage } = await this.visionJson(
      viewsCheckPrompt(promptVersion),
      question,
      imageUrl,
      VIEWS_CHECK_JSON_SCHEMA,
      signal,
      false,
      { kind: 'checkViews', params: { promptVersion } },
      [],
      this.modelFor('viewsCheck')
    );
    const check = parseViewsCheck(content);
    console.info(
      `[vision] 3D views check from ${model}: ${check ? `${check.missing.map((m) => `${m.part} (${m.view})`).join(', ') || 'complete'}${check.redrawSide ? ', redraw side' : ''}` : 'unusable'}`
    );
    return { model, usage, result: { check } };
  }

  async segmentImage(
    imageUrl: string,
    concept: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<SegmentResult>> {
    const model = env.META_SEGMENT_MODEL;
    // PQ-T49: a repeated (crop, concept) is answered from memory (no SAM call, $0 of spend).
    const cacheKey = env.SHAPE_CACHE ? samCacheKey(imageUrl, concept) : null;
    const remembered = cacheKey ? getCachedSam(cacheKey) : undefined;
    if (remembered) {
      console.info(`[vision] segment cache hit (${concept})`);
      return { model: remembered.model, usage: {}, result: remembered.result };
    }
    const image = await inlineImageUrl(imageUrl);
    const body = {
      model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: concept },
            { type: 'input_image', image_url: image },
          ],
        },
      ],
      metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
    };
    const data = (await this.post(
      '/responses',
      JSON.stringify(body),
      { 'Content-Type': 'application/json' },
      signal
    )) as ResponsesPayload;

    const text = (data.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');
    const parsed = parseSamOutput(text);
    const { imageWidth, imageHeight } = parsed;
    const instances = parsed.instances.map((inst, i) => {
      const mask = parsed.masks[i];
      const outline = mask ? maskToOutline(mask, inst.box, imageWidth, imageHeight) : null;
      return outline ? { ...inst, outline } : inst;
    });

    const result = {
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
    };
    if (cacheKey) setCachedSam(cacheKey, model, result);
    return { model, usage: { images: 1 }, result };
  }
}
