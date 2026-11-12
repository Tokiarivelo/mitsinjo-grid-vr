import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';
import { DEFAULT_META_BASE_URL } from '@/server/copilot/providers/meta';
import { fetchPreferringContributor } from '@/server/copilot/providers/contributor';
import type { UsageSample } from '@/server/spend';
import type {
  CriticOptions,
  PartsSubject,
  PerceptionBackend,
  PerceptionCall,
  ShapeOpsOptions,
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
  JUDGE_CRITERIA,
  JUDGE_JSON_SCHEMA,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  parseJudge,
} from './rubric-judge';
import {
  CODE_JSON_SCHEMA,
  CODE_PROMPT_VERSION,
  codeModel,
  codePrompt,
  parseBuildCode,
} from './shape-code';
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
  CRITIC_PROMPT_VERSION,
  capPatchFields,
  criticJsonSchema,
  criticPrompt,
  parseKitReasons,
  kitVersionFor,
  kitPrompt,
  parseKit,
  parseKitPatch,
  kitJsonSchema,
  shapeQuestion,
} from './shape';
import { boxUnionCoverage, parseSamOutput } from './parse-sam';
import {
  SHAPE_SCRIPT_JSON_SCHEMA,
  SHAPE_SCRIPT_CARDS_VERSION,
  SHAPE_SCRIPT_PROMPT_VERSION,
  shapeScriptSystemPrompt,
  type StageSheet,
  parseStageOps,
} from './shape-script-prompt';
import { effortFor } from './effort';
import { redactDataUrls, redactDataUrlsInText, type VisionCallLog } from './vision-log';
import {
  ObservationSchema,
  type CodeResult,
  type CriticResult,
  type JudgeResult,
  type ViewsCheckResult,
  type ShapeOpsResult,
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

  constructor(options?: { apiKey?: string; baseUrl?: string; preferContributor?: boolean }) {
    ensureNetworkDefaults();
    this.preferContributor = options?.preferContributor ?? env.META_PREFER_CONTRIBUTOR;
    this.apiKey = options?.apiKey || env.META_API_KEY || '';
    this.baseUrl = (options?.baseUrl || env.META_BASE_URL || DEFAULT_META_BASE_URL).replace(
      /\/$/,
      ''
    );
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
    allowContributor = true
  ): Promise<{ data: unknown; model: string }> {
    if (!this.apiKey) throw new Error('META_API_KEY is not configured in environment');
    const { res, model } = await fetchPreferringContributor(
      baseModel,
      Boolean(baseModel) && this.preferContributor && allowContributor,
      (m) =>
        fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, ...init },
          body: makeBody(m),
          signal,
        })
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Meta perception API error (${res.status}) on ${path}: ${text.slice(0, 300)}`
      );
    }
    return { data: (await res.json()) as unknown, model };
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
        `[vision] 3D ${log.kind} → params ${JSON.stringify(log.params ?? {}, redactDataUrls)} image ${redactDataUrls('image', imageUrl)}${extraImages.map((u) => ` + reference ${redactDataUrls('image', u)}`).join('')} schema ${typeof schema === 'string' ? schema : 'custom'}`
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
    });
    const sent = await this.postWithModel(
      '/chat/completions',
      (m) => JSON.stringify(body(m)),
      baseModel,
      { 'Content-Type': 'application/json' },
      timeoutSignal(VISION_CALL_MAX_MS, signal),
      allowContributor
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
    const { content, model, usage } = await this.visionJson(
      kitPrompt(promptVersion, hint),
      shapeQuestion(target.label, target.aspect, hint, Boolean(target.facadeUrl), target.facts),
      imageUrl,
      kitJsonSchema(promptVersion),
      signal,
      false,
      { kind: 'describeShape', params: { ...target, promptVersion } },
      target.facadeUrl ? [target.facadeUrl] : []
    );
    const kit = parseKit(content, hint);
    if (!kit) console.info(`[vision] ${model} gave no usable 3D kit: ${content.slice(0, 300)}`);
    else console.info(`[vision] 3D kit from ${model}: ${kit.archetype}`);
    return {
      model,
      usage,
      result: { recipe: kit ? kitToRecipe(kit) : null, ...(kit ? { kit } : {}) },
    };
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
      target.facadeUrl ? [target.facadeUrl] : []
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
      { kind: 'criticizeShape', params: { promptVersion } }
    );
    const parsed = parseKitPatch(content);
    // Version 2 cuts a long patch to its first 4 fields (PQ-T14).
    const patch = parsed && promptVersion >= 2 ? capPatchFields(parsed) : parsed;
    const reasons = promptVersion >= 2 ? parseKitReasons(content) : [];
    console.info(
      `[vision] 3D critic from ${model}: ${patch ? Object.keys(patch).join(',') : 'no patch'}${reasons.length ? ` (${reasons.join(' | ')})` : ''}`
    );
    return { model, usage, result: { patch } };
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
      env.META_JUDGE_MODEL
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
    signal?: AbortSignal
  ): Promise<PerceptionCall<CodeResult>> {
    const { content, model, usage } = await this.visionJson(
      codePrompt(),
      question,
      imageUrl,
      CODE_JSON_SCHEMA,
      signal,
      false,
      { kind: 'writeBuildCode', params: { promptVersion: CODE_PROMPT_VERSION } },
      [],
      codeModel()
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
      { kind: 'checkViews', params: { promptVersion } }
    );
    const check = parseViewsCheck(content);
    console.info(
      `[vision] 3D views check from ${model}: ${check ? `${check.missing.map((m) => `${m.part} (${m.view})`).join(', ') || 'complete'}${check.redrawSide ? ', redraw side' : ''}` : 'unusable'}`
    );
    return { model, usage, result: { check } };
  }

  async proposeShapeOps(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    sheet: StageSheet = 'elevation',
    opts: ShapeOpsOptions = {}
  ): Promise<PerceptionCall<ShapeOpsResult>> {
    const promptVersion = env.SHAPE_LOOP_CARDS
      ? SHAPE_SCRIPT_CARDS_VERSION
      : SHAPE_SCRIPT_PROMPT_VERSION;
    const ask = (baseModel: string) =>
      this.visionJson(
        shapeScriptSystemPrompt(sheet, env.SHAPE_LOOP_CARDS),
        question,
        imageUrl,
        SHAPE_SCRIPT_JSON_SCHEMA,
        signal,
        false,
        {
          kind: 'proposeShapeOps',
          params: { promptVersion, sheet, refine: !!opts.refine },
        },
        [],
        baseModel
      );
    let answer: Awaited<ReturnType<typeof ask>>;
    if (opts.refine && env.META_REFINE_MODEL !== env.META_VISION_MODEL) {
      // Final check on Wonder; one retry on the standard model when Wonder is not served.
      try {
        answer = await ask(env.META_REFINE_MODEL);
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn(
          `[vision] 3D final check on ${env.META_REFINE_MODEL} failed, retrying on ${env.META_VISION_MODEL}:`,
          err instanceof Error ? err.message : err
        );
        answer = await ask(env.META_VISION_MODEL);
      }
    } else {
      answer = await ask(env.META_VISION_MODEL);
    }
    const { content, model, usage } = answer;
    const ops = parseStageOps(content);
    console.info(
      `[vision] 3D stage ops from ${model} (prompt v${promptVersion}): ${ops ? ops.map((o) => `${(o as { op: string }).op} ${(o as { id?: string }).id ?? ''}`.trim()).join(', ') || 'none' : 'unusable'}`
    );
    return { model, usage, result: { ops } };
  }

  async segmentImage(
    imageUrl: string,
    concept: string,
    signal?: AbortSignal
  ): Promise<PerceptionCall<SegmentResult>> {
    const model = env.META_SEGMENT_MODEL;
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

    return {
      model,
      usage: { images: 1 },
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
}
