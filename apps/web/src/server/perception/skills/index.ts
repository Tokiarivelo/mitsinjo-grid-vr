import { createHash } from 'node:crypto';
import type { KitArchetype } from '@/lib/object-kit';
import { CARD_TEXT } from './cards.generated';

/**
 * Muse skill cards (PQ-T11, `docs/vision-to-3d-muse-skills.md`): the text loaded into a call before its
 * question. The doc is the source; `cards.generated.ts` is its copy (`make skills-gen`, checked by
 * `skills.test.ts`). No call uses the cards yet: each one switches on after its own eval (PQ-T12 to PQ-T16).
 */

/** Which call the system prompt is for. */
export type SkillCall = 'kit' | 'free' | 'critic' | 'stages' | 'views' | 'final' | 'judge';

export interface Skill {
  /** Composed system prompt: Base + (Look) + call card + archetype card. */
  text: string;
  /** Names of the cards composed, in order (`archetype:vehicle`, …). */
  cards: string[];
  /** Hash of the composed text: a change of any card changes it. Logged with the call, stored by captures. */
  version: string;
}

/** Cards each call composes after the Base card, before the archetype card. */
const CALL_CARDS: Record<SkillCall, readonly string[]> = {
  kit: ['look', 'kit'],
  free: ['look', 'free'],
  critic: ['critic'],
  stages: ['stages'],
  views: ['views'],
  final: ['final'],
  judge: ['judge'],
};

/** Calls that read the object family's card (the free-parts call has no family, the judge grades blind). */
const WITH_ARCHETYPE: ReadonlySet<SkillCall> = new Set([
  'kit',
  'critic',
  'stages',
  'views',
  'final',
]);

const card = (name: string): string => {
  const text = CARD_TEXT[name];
  if (!text) throw new Error(`skill card "${name}" not found: run make skills-gen`);
  return text;
};

/** Text of one archetype card, `null` for `other` (a plain box has none). */
export function archetypeCard(archetype: KitArchetype | undefined): string | null {
  return archetype && CARD_TEXT[`archetype:${archetype}`]
    ? CARD_TEXT[`archetype:${archetype}`]!
    : null;
}

/** The system prompt of one call for one object family (PQ-T11). */
export function skillFor(call: SkillCall, archetype?: KitArchetype): Skill {
  const cards = ['base', ...CALL_CARDS[call]];
  if (WITH_ARCHETYPE.has(call) && archetypeCard(archetype)) cards.push(`archetype:${archetype}`);
  const text = cards.map(card).join('\n\n');
  const version = createHash('sha1').update(text).digest('hex').slice(0, 8);
  return { text, cards, version };
}

/** Text of a card used outside a system prompt (the Muse Image side-view and clean-front cards). */
export function imageCard(name: 'side' | 'cleanFront'): string {
  return card(name);
}
