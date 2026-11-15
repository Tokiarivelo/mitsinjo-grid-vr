/**
 * Reasoning effort per vision call kind (PQ-T17). Every kind is `high` (what the single hard-coded
 * value was) except the short per-part questions (PQ-T52): lowering one is a measured choice
 * (accept rate and latency per value on the captures), written in `docs/copilot.md`. The accepted
 * values (`low` | `medium` | `high`) are the documented ones for the chat API; `low` is confirmed
 * on the Meta endpoint by the PQ-T52 probe (a `low` short question answered), the rest unmeasured.
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
  writeBuildCode: 'high',
  /** Yes/no short questions (PQ-T52, E12.6): `low`, confirmed accepted by the live probe. */
  askPart: 'low',
};

export const DEFAULT_EFFORT: ReasoningEffort = 'high';

/** Effort sent with one call: its table entry, else the default. */
export const effortFor = (kind?: string): ReasoningEffort =>
  (kind && CALL_EFFORT[kind]) || DEFAULT_EFFORT;
