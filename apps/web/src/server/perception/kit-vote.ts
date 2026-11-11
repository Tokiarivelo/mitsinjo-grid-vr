import type { ObjectKit } from '@/lib/object-kit';

/**
 * Two kit samples vote (PQ-T18). Same archetype and subtype → one kit (the first), with every count
 * the samples disagree on marked unsure, so fusion leads it by the measurement. A split family or subtype
 * → the sample whose flat render scores higher wins (`score` is injected: the render needs the photo).
 * Pure apart from the injected scorer.
 */

/** Count fields compared between samples. */
const COUNTS = ['windows', 'doors', 'wheels', 'legs', 'floors', 'units'] as const;

export type VoteOutcome = 'agree' | 'split' | 'single';

export interface Vote {
  kit: ObjectKit;
  outcome: VoteOutcome;
  /** Fields marked unsure because the samples differ. */
  disagreed: string[];
  /** The family the other sample named (a split only): the second choice of the question (PQ-T41). */
  other?: ObjectKit['archetype'];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const subtypeOf = (k: ObjectKit) => norm(k.subtype ?? k.details?.subtype);

/** Do the two kits name the same family and subtype? */
export const sameFamily = (a: ObjectKit, b: ObjectKit): boolean =>
  a.archetype === b.archetype && subtypeOf(a) === subtypeOf(b);

/** Names of the count fields that differ (a missing count is no disagreement). */
export function differingCounts(a: ObjectKit, b: ObjectKit): string[] {
  return COUNTS.filter((k) => {
    const x = a.details?.[k];
    const y = b.details?.[k];
    return x !== undefined && y !== undefined && x !== y;
  });
}

/**
 * `b` is null when the second sample is late or failed: the first is used alone. A split family asks
 * `score` for both kits; a throwing or null score keeps the first.
 */
export async function voteKits(
  a: ObjectKit,
  b: ObjectKit | null,
  score: (kit: ObjectKit) => Promise<number | null>
): Promise<Vote> {
  if (!b) return { kit: a, outcome: 'single', disagreed: [] };
  if (!sameFamily(a, b)) {
    const [sa, sb] = await Promise.all([score(a).catch(() => null), score(b).catch(() => null)]);
    const kit = sb !== null && (sa === null || sb > sa) ? b : a;
    return {
      kit,
      outcome: 'split',
      disagreed: ['archetype'],
      other: kit === b ? a.archetype : b.archetype,
    };
  }
  const disagreed = differingCounts(a, b);
  if (!disagreed.length) return { kit: a, outcome: 'agree', disagreed };
  const unsure = [...new Set([...(a.evidence?.unsure ?? []), ...disagreed])].slice(0, 12);
  return {
    kit: { ...a, evidence: { ...a.evidence, unsure } },
    outcome: 'agree',
    disagreed,
  };
}
