// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KIT_ARCHETYPES } from '@/lib/object-kit';
import {
  coverageForBox,
  FREE_PARTS_PROMPT_VERSION,
  needsFreeParts,
  parseFreeParts,
  PARTS_JSON_SCHEMA,
  PARTS_SYSTEM_PROMPT,
  partsPrompt,
  shapePartsQuestion,
  toFreePartsOutcome,
  visibilityFromCoverage,
} from '../free-recipe';

const PHOTO = { width: 200, height: 100 };

const PART = {
  shape: 'box',
  at: [0, 0, 0],
  size: [0.5, 0.8, 0.4],
  color: '#aabbcc',
  material: 'fabric',
  front: true,
};
const ANSWER = JSON.stringify({
  proportions: { w: 0.4, h: 0.8, d: 0.4 },
  parts: [PART],
});

describe('free part list (PV-T9c)', () => {
  it('routes only the crude-template archetypes to the imagination call', () => {
    expect(KIT_ARCHETYPES.filter(needsFreeParts).sort()).toEqual(
      ['animal', 'bush', 'other', 'person', 'water'].sort()
    );
    for (const a of ['vehicle', 'house', 'tree', 'cabinet', 'panel'] as const) {
      expect(needsFreeParts(a)).toBe(false);
    }
  });

  it('prompt version is pinned', () => {
    expect(FREE_PARTS_PROMPT_VERSION).toBe('v1');
  });

  it('coverage names the cut photo edges, whole boxes stay silent', () => {
    expect(coverageForBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.6 }, PHOTO)).toBeUndefined();
    expect(coverageForBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.6 }, null)).toBeUndefined();
    expect(coverageForBox({ x: 0, y: 0.2, w: 0.3, h: 0.5 }, PHOTO)).toBe('cut off at the left');
    expect(coverageForBox({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, PHOTO)).toBe(
      'cut off at the right and bottom'
    );
    expect(coverageForBox({ x: 0, y: 0, w: 1, h: 1 }, PHOTO)).toBe(
      'cut off at the left, right, top and bottom'
    );
    expect(visibilityFromCoverage('cut off at the left, right, top and bottom')).toEqual({
      kind: 'cut',
      edges: ['left', 'right', 'top', 'bottom'],
    });
  });

  it('visibility parses the coverage back, garbage means whole', () => {
    expect(visibilityFromCoverage(undefined)).toEqual({ kind: 'whole' });
    expect(visibilityFromCoverage('')).toEqual({ kind: 'whole' });
    expect(visibilityFromCoverage('visible 35% of left')).toEqual({ kind: 'whole' });
    expect(visibilityFromCoverage('cut off at the left and bottom')).toEqual({
      kind: 'cut',
      edges: ['left', 'bottom'],
    });
  });

  it('question names the object and always demands the WHOLE of it', () => {
    const q = shapePartsQuestion('Zebu "bossy"', 'animal', { kind: 'whole' });
    expect(q).toContain('Zebu');
    expect(q).toContain('animal');
    expect(q).not.toContain('"bossy"');
    expect(q).toContain('WHOLE');
    const cut = shapePartsQuestion('Guard', 'person', { kind: 'cut', edges: ['left'] });
    expect(cut).toContain('cut off at the left');
    expect(cut).toContain('WHOLE');
  });

  it('parses a part list, stamps it free and normalises the proportions', () => {
    const recipe = parseFreeParts(ANSWER);
    expect(recipe).not.toBeNull();
    expect(recipe!.source).toBe('free');
    expect(recipe!.proportions).toEqual({ w: 0.5, h: 1, d: 0.5 });
    expect(recipe!.parts).toHaveLength(1);
  });

  it('normalises meter-style proportions (live: a person came back h = 1.82)', () => {
    const meters = JSON.stringify({
      proportions: { w: 0.5, h: 1.82, d: 0.3 },
      parts: [PART],
    });
    const recipe = parseFreeParts(meters);
    expect(recipe?.proportions.h).toBe(1);
    expect(recipe?.proportions.w).toBeCloseTo(0.5 / 1.82, 10);
    expect(recipe?.proportions.d).toBeCloseTo(0.3 / 1.82, 10);
  });

  it('reads the JSON out of a chatty reply', () => {
    const recipe = parseFreeParts(`Here are the parts:\n${ANSWER}\nHope this helps.`);
    expect(recipe?.source).toBe('free');
  });

  it('rejects garbage, oversized and unbounded answers (triangle budget)', () => {
    expect(parseFreeParts('no json here')).toBeNull();
    expect(
      parseFreeParts(JSON.stringify({ proportions: { w: 1, h: 1, d: 1 }, parts: [] }))
    ).toBeNull();
    const thirteen = JSON.stringify({
      proportions: { w: 1, h: 1, d: 1 },
      parts: Array.from({ length: 13 }, () => PART),
    });
    expect(parseFreeParts(thirteen)).toBeNull();
    // extrude/lathe need server-built point lists, never LLM ones.
    const extrude = JSON.stringify({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ ...PART, shape: 'extrude' }],
    });
    expect(parseFreeParts(extrude)).toBeNull();
    const outside = JSON.stringify({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ ...PART, at: [5, 0, 0] }],
    });
    expect(parseFreeParts(outside)).toBeNull();
    const noColor = JSON.stringify({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [0.5, 0.5, 0.5] }],
    });
    expect(parseFreeParts(noColor)).toBeNull();
  });

  it('structured schema matches the parser (12 plain parts max)', () => {
    expect(PARTS_JSON_SCHEMA.name).toBe('ObjectParts');
    const schema = PARTS_JSON_SCHEMA.schema as {
      properties: {
        parts: { maxItems: number; items: { properties: { shape: { enum: string[] } } } };
      };
    };
    expect(schema.properties.parts.maxItems).toBe(12);
    expect(schema.properties.parts.items.properties.shape.enum).toEqual([
      'box',
      'cylinder',
      'sphere',
      'cone',
      'prism',
    ]);
  });

  it('outcome maps a missing recipe to its cause', () => {
    const recipe = parseFreeParts(ANSWER)!;
    expect(toFreePartsOutcome(recipe, false)).toEqual({ ok: true, recipe });
    expect(toFreePartsOutcome(null, true)).toEqual({ ok: false, reason: 'refused' });
    expect(toFreePartsOutcome(null, false)).toEqual({ ok: false, reason: 'bad-json' });
  });
});

describe('partsPrompt (PQ-T12)', () => {
  it('the first prompt by default; from kit prompt 2 the Muse cards Base + Look + Free parts', () => {
    expect(partsPrompt()).toBe(PARTS_SYSTEM_PROMPT);
    expect(partsPrompt(1)).toBe(PARTS_SYSTEM_PROMPT);
    const cards = partsPrompt(2);
    expect(cards).not.toBe(PARTS_SYSTEM_PROMPT);
    expect(cards).toContain('Before you classify, look in this order');
    expect(cards).toContain('You list the solid parts of the object');
    expect(cards).toMatch(/Never give watts/);
  });
});
