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
  writeBuildCode: 'high',
  /** Yes/no short questions (PQ-T52, E12.6): `low`, confirmed accepted by the live probe. */
  askPart: 'low',
  /** Class materials (PQ-T69): a closed-list answer per tile, same `low` as the short questions. */
  nameClasses: 'low',
  /**
   * House specialist (PQ-T72): a whole house measured view by view, the hardest reading. It
   * thinks 6–17 k tokens (minutes), silent all along: sent through `longFetch` (Node's fetch
   * drops a call after 300 s without headers or without a body chunk).
   */
  readHouse: 'high',
};

export const DEFAULT_EFFORT: ReasoningEffort = 'high';

/**
 * Specialist teams (PQ-T73/T76/T82, any team since PQ-T85): the pilot only briefs (kind, parts,
 * notes): `medium`; each specialist measures its part on the drawings: the default `high`,
 * streamed like `readHouse`.
 */
export const TEAM_PILOT_EFFORT: ReasoningEffort = 'medium';

/** Effort sent with one call: its table entry, a team pilot's, else the default. */
export const effortFor = (kind?: string): ReasoningEffort =>
  (kind && CALL_EFFORT[kind]) ||
  (kind && /^[a-z]+Pilot$/.test(kind) ? TEAM_PILOT_EFFORT : DEFAULT_EFFORT);
