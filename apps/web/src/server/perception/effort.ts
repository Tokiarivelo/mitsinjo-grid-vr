/**
 * Reasoning effort per vision call kind (PQ-T17). Every kind is `high` today (what the single
 * hard-coded value was): lowering one is a measured choice (accept rate and latency per value on the
 * captures), written in `docs/copilot.md`. The accepted values (`low` | `medium` | `high`) are the
 * documented ones for the chat API and not yet confirmed on the Meta endpoint, so only `high` is used.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/** Call kinds that name their effort; any other call (detection, analysis, …) uses `DEFAULT_EFFORT`. */
export const CALL_EFFORT: Readonly<Record<string, ReasoningEffort>> = {
  describeShape: 'high',
  describeParts: 'high',
  criticizeShape: 'high',
  judgeShape: 'high',
  checkViews: 'high',
  proposeShapeOps: 'high',
};

export const DEFAULT_EFFORT: ReasoningEffort = 'high';

/** Effort sent with one call: its table entry, else the default. */
export const effortFor = (kind?: string): ReasoningEffort =>
  (kind && CALL_EFFORT[kind]) || DEFAULT_EFFORT;
