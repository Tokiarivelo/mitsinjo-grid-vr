import { KIT_ARCHETYPES, type KitArchetype, type ObjectKit } from '@/lib/object-kit';

/**
 * Ask instead of guessing (PQ-T41, gate raised to 0.82 by PQ-T47 §4.2): when the model doubts the
 * family, the operator picks between the two best ones. Doubt = archetype confidence under
 * `ASK_CONFIDENCE_MAX` (PQ-T12) or two samples that named different families (PQ-T18). Pure.
 */
export const ASK_CONFIDENCE_MAX = 0.82;

export type FamilyPair = [KitArchetype, KitArchetype];

/**
 * The two families to choose from, the kit's first, or null: nothing to ask (confident and no split), the
 * operator already chose, or no distinct second family (`alt` = the other sample's family, else the
 * detection's own hint). `other` (a plain box) is never offered as a family.
 */
export function askFamilies(
  kit: Pick<ObjectKit, 'archetype' | 'confidence'>,
  alt: KitArchetype | undefined,
  opts: { split?: boolean; chosen?: boolean } = {}
): FamilyPair | null {
  if (opts.chosen) return null;
  const doubt = (kit.confidence?.archetype ?? 1) < ASK_CONFIDENCE_MAX || opts.split === true;
  if (!doubt || !alt || alt === kit.archetype) return null;
  if (kit.archetype === 'other' || alt === 'other') return null;
  return [kit.archetype, alt];
}

/** A family name the client sent back, or undefined. */
export const asFamily = (v: string | undefined): KitArchetype | undefined =>
  (KIT_ARCHETYPES as readonly string[]).includes(v ?? '') ? (v as KitArchetype) : undefined;
