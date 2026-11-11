import { iou, MATCH_MIN_IOU } from './box-match';
import type { NormBox } from './schemas';

/**
 * SAM agreement (PQ-T9): the same object asked with several phrasings gives several masks. Pure, no I/O.
 * Phrasings that agree confirm each other; when they disagree, the mask that sits inside the box wins
 * (a merged answer, car + hedge, has a bigger box and a lower overlap with the detection box).
 */

/** Boxes of two answers with at least this overlap count as the same object. */
export const AGREE_IOU = 0.8;

export interface OutlineCandidate {
  /** The phrasing that gave it. */
  concept: string;
  outline: string;
  /** The mask's box, photo fractions. */
  box: NormBox;
  /** Overlap of that box with the detection box. */
  score: number;
}

export interface Consensus {
  pick: OutlineCandidate;
  /** How many phrasings gave a mask that agrees with the pick (itself included). */
  agreeing: number;
  /** `agreed` = at least two phrasings agree · `inside` = they disagree, the one inside the box won · `single`. */
  why: 'agreed' | 'inside' | 'single';
}

/** Picks the outline from the candidates, or null when none overlaps the detection box. */
export function pickConsensus(candidates: ReadonlyArray<OutlineCandidate>): Consensus | null {
  const usable = candidates.filter((c) => c.score >= MATCH_MIN_IOU);
  if (usable.length === 0) return null;
  const byScore = [...usable].sort((a, b) => b.score - a.score);
  if (usable.length === 1) return { pick: byScore[0]!, agreeing: 1, why: 'single' };
  // Largest group of answers that agree with each other (by box), ties → best overlap with the box.
  let best: { members: OutlineCandidate[] } | null = null;
  for (const seed of byScore) {
    const members = byScore.filter((c) => c === seed || iou(c.box, seed.box) >= AGREE_IOU);
    if (!best || members.length > best.members.length) best = { members };
  }
  if (best!.members.length >= 2) {
    return { pick: best!.members[0]!, agreeing: best!.members.length, why: 'agreed' };
  }
  return { pick: byScore[0]!, agreeing: 1, why: 'inside' };
}
