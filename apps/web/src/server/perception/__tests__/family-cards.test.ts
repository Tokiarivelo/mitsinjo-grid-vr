// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { kitToRecipe, KIT_ARCHETYPES } from '@/lib/object-kit';
import {
  KIT_PROMPT_FAMILY_VERSION,
  KIT_PROMPT_VERSION,
  SHAPE_SYSTEM_PROMPT,
  kitJsonSchema,
  kitPrompt,
  kitVersionFor,
  parseKit,
} from '../shape';
import { archetypeCard } from '../skills';

const dir = join(__dirname, '..', '__fixtures__', 'shape', 'real');
// The real set is local (gitignored): no capture on a fresh clone or in CI, the replay then has no case.
const captures = (existsSync(dir) ? readdirSync(dir) : [])
  .filter((f) => f.endsWith('.capture.json'))
  .map((f) => ({
    id: f.replace('.capture.json', ''),
    ...JSON.parse(readFileSync(join(dir, f), 'utf8')),
  }));

describe('family cards (PQ-T13)', () => {
  it('prompt 3 = prompt 1 + the family card only; a family without a card keeps prompt 1', () => {
    const carded = kitPrompt(KIT_PROMPT_FAMILY_VERSION, 'vehicle');
    expect(carded.startsWith(SHAPE_SYSTEM_PROMPT)).toBe(true);
    expect(carded).toContain(archetypeCard('vehicle')!);
    // No Look card, no evidence field: the short prompt that prompt 2 was not.
    expect(carded).not.toContain('evidence');
    expect(kitPrompt(KIT_PROMPT_FAMILY_VERSION, 'other')).toBe(SHAPE_SYSTEM_PROMPT);
    expect(kitJsonSchema(KIT_PROMPT_FAMILY_VERSION)).toBe(kitJsonSchema(KIT_PROMPT_VERSION));
  });

  it('the card is on only for the families listed', () => {
    expect(kitVersionFor('vehicle', ['vehicle', 'house'])).toBe(KIT_PROMPT_FAMILY_VERSION);
    expect(kitVersionFor('tank', ['vehicle'])).toBe(KIT_PROMPT_VERSION);
    expect(kitVersionFor('vehicle', [])).toBe(KIT_PROMPT_VERSION);
    expect(kitVersionFor(undefined, ['vehicle'])).toBe(KIT_PROMPT_VERSION);
    // A listed family with no card (other) stays on prompt 1.
    expect(kitVersionFor('other', ['other'])).toBe(KIT_PROMPT_VERSION);
  });

  it('every archetype with a card builds a prompt', () => {
    for (const a of KIT_ARCHETYPES) {
      const text = kitPrompt(KIT_PROMPT_FAMILY_VERSION, a);
      expect(text.length).toBeGreaterThan(SHAPE_SYSTEM_PROMPT.length - 1);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(1200);
    }
  });

  it.each(captures.map((c) => [c.id, c] as const))(
    'a captured answer (%s) replays through parseKit and builds a recipe',
    (_id, c) => {
      const kit = parseKit(JSON.stringify(c.kit), c.kit.archetype);
      expect(kit).not.toBeNull();
      expect(kit!.archetype).toBe(c.kit.archetype);
      const recipe = kitToRecipe(kit!);
      expect(recipe.parts.length).toBeGreaterThan(0);
    }
  );
});
