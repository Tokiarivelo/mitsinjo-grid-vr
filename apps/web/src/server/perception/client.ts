import 'server-only';

import { env } from '@/lib/env';
import { errorWithCause, isTransientProviderError } from '@/server/copilot/providers/transient';
import { spendGuard, type SpendGuard } from '@/server/spend';
import type {
  CriticOptions,
  PartsSubject,
  PerceptionBackend,
  PerceptionCall,
  ShapeOpsOptions,
  ShapeSubject,
} from './backend';
import { MetaPerceptionBackend } from './meta';
import { MockPerceptionBackend } from './mock';
import type { StageSheet } from './shape-script-prompt';
import type {
  CodeResult,
  ShapeOpsResult,
  CriticResult,
  JudgeResult,
  DetectionResult,
  PartAskResult,
  PerceptionSource,
  SegmentResult,
  ShapeResult,
  TranscribeOptions,
  Transcript,
  ViewsCheckResult,
  VisionResult,
} from './schemas';

/**
 * Short cause of a failed Meta call: `timeout` (an explicit time limit), `aborted` (the browser left),
 * `http_<status>` (Meta answered with an error), else `network`.
 */
export function failureOf(err: unknown): string {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'aborted';
  const status = err instanceof Error ? /API error \((\d{3})\)/.exec(err.message)?.[1] : undefined;
  return status ? `http_${status}` : 'network';
}

/**
 * Perception entry point for routes and copilot tools. Never throws for a Meta problem:
 * missing key, spend cap or API error → the deterministic mock answers, with `fallback` set.
 */
export class PerceptionClient {
  constructor(
    private readonly primary: PerceptionBackend | null,
    private readonly mock: PerceptionBackend,
    private readonly guard: SpendGuard,
    private readonly budgetKey: string,
    /** Set when Meta was asked for but has no key (shown as a fallback, not as plain mock mode). */
    private readonly notConfigured = false
  ) {}

  /** True when calls go to Meta (worth hosting the photo); false in mock mode. */
  get callsMeta(): boolean {
    return this.primary !== null;
  }

  private async run<T>(
    kind: string,
    call: (b: PerceptionBackend) => Promise<PerceptionCall<T>>
  ): Promise<T & PerceptionSource> {
    const fromMock = async (fallback?: PerceptionSource['fallback'], failure?: string) => {
      const out = await call(this.mock);
      return {
        ...out.result,
        source: 'mock',
        model: out.model,
        ...(fallback ? { fallback } : {}),
        ...(failure ? { failure } : {}),
      } as T & PerceptionSource;
    };

    if (!this.primary) return fromMock(this.notConfigured ? 'not_configured' : undefined);
    if (!this.guard.canSpend(this.budgetKey)) {
      console.warn(`[perception] ${kind}: spend cap reached for "${this.budgetKey}", using mock`);
      return fromMock('spend_cap');
    }
    const primary = this.primary;
    const attempt = async () => {
      const out = await call(primary);
      this.guard.record(this.budgetKey, out.model, out.usage);
      return { ...out.result, source: 'meta', model: out.model } as T & PerceptionSource;
    };
    try {
      try {
        return await attempt();
      } catch (firstErr) {
        // A dropped connection or a 429/5xx often passes: one more try before the mock.
        if (!isTransientProviderError(firstErr)) throw firstErr;
        console.warn(
          `[perception] ${kind}: transient Meta error, retrying once:`,
          errorWithCause(firstErr)
        );
        return await attempt();
      }
    } catch (err) {
      const failure = failureOf(err);
      console.warn(
        `[perception] ${kind} failed on Meta (${failure}), using mock:`,
        errorWithCause(err)
      );
      return fromMock('provider_error', failure);
    }
  }

  transcribe(audio: Blob, options?: TranscribeOptions, signal?: AbortSignal): Promise<Transcript> {
    return this.run('transcribe', (b) => b.transcribe(audio, options, signal));
  }

  analyzeImage(imageUrl: string, question: string, signal?: AbortSignal): Promise<VisionResult> {
    return this.run('analyzeImage', (b) => b.analyzeImage(imageUrl, question, signal));
  }

  segmentImage(imageUrl: string, concept: string, signal?: AbortSignal): Promise<SegmentResult> {
    return this.run('segmentImage', (b) => b.segmentImage(imageUrl, concept, signal));
  }

  detectAppliances(imageUrl: string, signal?: AbortSignal): Promise<DetectionResult> {
    return this.run('detectAppliances', (b) => b.detectAppliances(imageUrl, signal));
  }

  identifyRegion(
    imageUrl: string,
    hint: string | undefined,
    signal?: AbortSignal
  ): Promise<DetectionResult> {
    return this.run('identifyRegion', (b) => b.identifyRegion(imageUrl, hint, signal));
  }

  describeShape(
    imageUrl: string,
    target: ShapeSubject,
    signal?: AbortSignal
  ): Promise<ShapeResult> {
    return this.run('describeShape', (b) => b.describeShape(imageUrl, target, signal));
  }

  describeParts(
    imageUrl: string,
    target: PartsSubject,
    signal?: AbortSignal
  ): Promise<ShapeResult> {
    return this.run('describeParts', (b) => b.describeParts(imageUrl, target, signal));
  }

  criticizeShape(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    opts?: CriticOptions
  ): Promise<CriticResult> {
    return this.run('criticizeShape', (b) => b.criticizeShape(imageUrl, question, signal, opts));
  }

  /** Short per-part question (PQ-T52); a backend without it answers null (no questions). */
  askPart(imageUrl: string, question: string, signal?: AbortSignal): Promise<PartAskResult> {
    return this.run('askPart', (b) =>
      b.askPart
        ? b.askPart(imageUrl, question, signal)
        : Promise.resolve({ model: b.name, usage: {}, result: { answer: null } })
    );
  }

  judgeShape(imageUrl: string, question: string, signal?: AbortSignal): Promise<JudgeResult> {
    return this.run('judgeShape', (b) => b.judgeShape(imageUrl, question, signal));
  }

  checkViews(imageUrl: string, question: string, signal?: AbortSignal): Promise<ViewsCheckResult> {
    return this.run('checkViews', (b) => b.checkViews(imageUrl, question, signal));
  }

  /** Shape loop stage patch (PG-T15); a backend without it answers an empty patch. */
  proposeShapeOps(
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    sheet?: StageSheet,
    opts?: ShapeOpsOptions
  ): Promise<ShapeOpsResult> {
    return this.run('proposeShapeOps', (b) =>
      b.proposeShapeOps
        ? b.proposeShapeOps(imageUrl, question, signal, sheet, opts)
        : Promise.resolve({ model: b.name, usage: {}, result: { ops: [] } })
    );
  }

  /** Route-B construction code (PQ-T45); a backend without it answers null (no route B). */
  writeBuildCode(imageUrl: string, question: string, signal?: AbortSignal): Promise<CodeResult> {
    return this.run('writeBuildCode', (b) =>
      b.writeBuildCode
        ? b.writeBuildCode(imageUrl, question, signal)
        : Promise.resolve({ model: b.name, usage: {}, result: { code: null } })
    );
  }
}

/** Client for one chat session (`budgetKey` = session id): Meta when configured, else mock. */
export function getPerceptionClient(budgetKey = 'global'): PerceptionClient {
  const wantsMeta = env.LLM_PROVIDER === 'meta';
  const hasKey = Boolean(env.META_API_KEY);
  return new PerceptionClient(
    wantsMeta && hasKey ? new MetaPerceptionBackend() : null,
    new MockPerceptionBackend(),
    spendGuard,
    budgetKey,
    wantsMeta && !hasKey
  );
}
