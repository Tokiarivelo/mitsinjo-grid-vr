import { APPLIANCE_CATEGORIES } from '@mitsinjo/engine';
import { SCENERY_TYPES } from '@/lib/vision';
import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema, recipeIssue } from '@/lib/object-shape';
import {
  criticQuestion,
  KIT_PROMPT_CARDS_VERSION,
  kitJsonSchema,
  kitPrompt,
  parseEvidence,
  mergeKitPatch,
  mockRecipe,
  parseKit,
  parseKitPatch,
  SHAPE_JSON_SCHEMA,
  SHAPE_SYSTEM_PROMPT,
  shapeQuestion,
} from '../shape';

const reply = (o: unknown) => JSON.stringify(o);

describe('parseKit (PV-T9b)', () => {
  it('reads a Spark kit and rescales proportions so the largest is 1', () => {
    const k = parseKit(
      reply({
        archetype: 'house',
        proportions: { w: 300, h: 150, d: 150 },
        colors: { main: '#C9A36A', secondary: '#6E6A62', accent: '#FFFFFF' },
        details: { windows: 4, doors: 1, chimney: true },
      })
    );
    expect(k).toEqual({
      archetype: 'house',
      proportions: { w: 1, h: 0.5, d: 0.5 },
      colors: { main: '#C9A36A', secondary: '#6E6A62', accent: '#FFFFFF' },
      details: { windows: 4, doors: 1, chimney: true },
    });
  });

  it('reads and preserves subtype when provided (e.g. vintage car, hatchback)', () => {
    const k = parseKit(
      reply({
        archetype: 'vehicle',
        subtype: 'vintage',
        proportions: { w: 200, h: 100, d: 100 },
        colors: { main: '#784384', secondary: '#ffffff', accent: '#222222' },
      })
    );
    expect(k?.subtype).toBe('vintage');
  });

  it('unknown archetype → the hint, bad colours → grey, counts rounded and clamped', () => {
    const k = parseKit(
      reply({
        archetype: 'cottage',
        proportions: { w: 1, h: 1, d: 1 },
        colors: { main: 'beige' },
        details: { windows: 40.4, wheels: -2, units: 12, color: 'x' },
      }),
      'house'
    );
    expect(k).toMatchObject({
      archetype: 'house',
      colors: { main: '#9aa3ad', secondary: '#9aa3ad', accent: '#9aa3ad' },
      details: { windows: 8, wheels: 0, units: 8 },
    });
  });

  it('returns null for prose, a missing archetype / proportions or zero proportions', () => {
    expect(parseKit('Here is a house')).toBeNull();
    expect(parseKit(reply({ proportions: { w: 1, h: 1, d: 1 } }))).toBeNull();
    expect(parseKit(reply({ archetype: 'tree' }))).toBeNull();
    expect(parseKit(reply({ archetype: 'tree', proportions: { w: 0, h: 0, d: 0 } }))).toBeNull();
  });

  it('asks for a short kit, not 3D coordinates (Spark was > 60 s on a building)', () => {
    expect(SHAPE_SYSTEM_PROMPT).toMatch(/do not plan 3D coordinates/);
    expect(JSON.stringify(SHAPE_JSON_SCHEMA)).not.toMatch(/"at"|"size"/);
    expect(shapeQuestion('Stone cottages', 1.2, 'house')).toContain('probably a "house"');
  });

  it('quotes the label safely and never asks for energy values', () => {
    expect(shapeQuestion('my "big" fridge')).toContain("'big'");
  });

  it('tells Spark how wide the object is on the photo', () => {
    expect(shapeQuestion('lamp post', 0.192)).toContain('0.19 times as wide as it is high');
    expect(shapeQuestion('lamp post')).not.toContain('times as wide');
  });

  it('carries the facts measured by code as a « Measured: » line, none without facts (PQ-T7)', () => {
    expect(
      shapeQuestion('car', 2, undefined, false, ['object 412 × 178 px', 'sharpness low'])
    ).toContain(' Measured: object 412 × 178 px · sharpness low.');
    expect(shapeQuestion('car', 2)).not.toContain('Measured:');
  });
});

describe('parseKit materials (AI)', () => {
  it('keeps known materials per role, drops unknown ones', () => {
    const k = parseKit(
      reply({
        archetype: 'house',
        proportions: { w: 1, h: 0.6, d: 0.6 },
        colors: { main: '#c9a36a', secondary: '#6e6a62', accent: '#ffffff' },
        materials: { main: 'stone', secondary: 'marble', accent: 'glass' },
      })
    );
    expect(k?.materials).toEqual({ main: 'stone', accent: 'glass' });
  });

  it('asks Spark for materials in the prompt and the JSON schema', () => {
    expect(SHAPE_SYSTEM_PROMPT).toContain('materials');
    expect(SHAPE_JSON_SCHEMA.schema.properties.materials.properties.main.enum).toContain('slate');
  });
});

describe('mockRecipe', () => {
  it('gives a valid, usable recipe for every category', () => {
    for (const c of APPLIANCE_CATEGORIES) {
      const r = mockRecipe(c);
      expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
      expect(recipeIssue(r)).toBeNull();
    }
  });

  it('models scenery too: a valid recipe per type, a house is not the plain box', () => {
    for (const s of SCENERY_TYPES) {
      const r = mockRecipe('other', s);
      expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
      expect(recipeIssue(r)).toBeNull();
    }
    expect(mockRecipe('other', 'building').parts.length).toBeGreaterThan(1);
    expect(mockRecipe('other', 'building')).not.toEqual(mockRecipe('other'));
  });
});

describe('parseKitPatch + mergeKitPatch (PR-0.6)', () => {
  const kit = {
    archetype: 'vehicle' as const,
    proportions: { w: 1, h: 0.4, d: 0.45 },
    colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
  };

  it('reads a partial patch: subtype, counts, colours', () => {
    expect(parseKitPatch(reply({ subtype: 'Sedan', details: { wheels: 4, doors: 2 } }))).toEqual({
      subtype: 'sedan',
      details: { wheels: 4, doors: 2 },
    });
    expect(parseKitPatch(reply({ colors: { accent: '#ff0000' } }))).toEqual({
      colors: { accent: '#ff0000' },
    });
    expect(parseKitPatch(reply({ archetype: 'house' }))).toEqual({ archetype: 'house' });
  });

  it('clamps counts, rescales proportions, drops the unusable', () => {
    expect(parseKitPatch(reply({ details: { wheels: 99, windows: -2 } }))).toEqual({
      details: { wheels: 6, windows: 0 },
    });
    expect(parseKitPatch(reply({ proportions: { w: 200, h: 100, d: 100 } }))).toEqual({
      proportions: { w: 1, h: 0.5, d: 0.5 },
    });
    // Bad colours dropped (never greyed), roof always dropped, partial triple dropped.
    expect(parseKitPatch(reply({ colors: { main: 'red' } }))).toBeNull();
    expect(
      parseKitPatch(reply({ roof: { eave: 0.4, gables: [] }, details: { doors: 1 } }))
    ).toEqual({ details: { doors: 1 } });
    expect(parseKitPatch(reply({ proportions: { w: 1 } }))).toBeNull();
    expect(parseKitPatch(reply({ archetype: 'spaceship' }))).toBeNull();
  });

  it('null when not JSON, empty, or an array', () => {
    expect(parseKitPatch('the model looks fine')).toBeNull();
    expect(parseKitPatch(reply({}))).toBeNull();
    expect(parseKitPatch(reply([]))).toBeNull();
  });

  it('merges per key and never corrupts the kit', () => {
    const patch = parseKitPatch(
      reply({ subtype: 'sedan', colors: { accent: '#ff0000' }, details: { wheels: 4 } })
    )!;
    const out = mergeKitPatch(kit, patch);
    expect(out).toMatchObject({
      archetype: 'vehicle',
      subtype: 'sedan',
      colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#ff0000' },
      details: { wheels: 4 },
    });
    // A patch that would break the schema keeps the original.
    expect(mergeKitPatch(kit, { proportions: { w: 0, h: 0, d: 0 } })).toEqual(kit);
  });

  it('criticQuestion carries the kit and the numbers', () => {
    const q = criticQuestion(kit, { score: 62, iou: 0.7, edgeF1: 0.5, deltaE: 9 });
    expect(q).toContain('62/100');
    expect(q).toContain('"archetype":"vehicle"');
    expect(q).toContain('JSON patch');
  });
});

describe('drawing reading (PV-G live 2026-11-02)', () => {
  it('keeps partMaterials and the building details Spark read on the drawing', () => {
    const k = parseKit(
      reply({
        archetype: 'house',
        proportions: { w: 1, h: 0.7, d: 0.6 },
        colors: { main: '#c8bfae', secondary: '#a78c5f', accent: '#2f342c' },
        partMaterials: {
          roof: 'thatch',
          walls: 'plaster',
          chimney: 'brick',
          plinth: 'stone',
          door: 'gold',
        },
        details: { plinth: true, timberFrame: true, panes: [4.2, 4], chimney: true },
      })
    )!;
    expect(k.partMaterials).toEqual({
      roof: 'thatch',
      walls: 'plaster',
      chimney: 'brick',
      plinth: 'stone',
    });
    expect(k.details).toMatchObject({ plinth: true, timberFrame: true, panes: [4, 4] });
  });

  it('drops bad panes and clamps big ones', () => {
    const base = { archetype: 'house', proportions: { w: 1, h: 1, d: 1 }, colors: {} };
    expect(parseKit(reply({ ...base, details: { panes: [2] } }))!.details?.panes).toBeUndefined();
    expect(parseKit(reply({ ...base, details: { panes: [20, 0] } }))!.details?.panes).toEqual([
      6, 1,
    ]);
  });

  it('the prompt and schema ask for them', () => {
    expect(SHAPE_SYSTEM_PROMPT).toContain('timberFrame');
    expect(SHAPE_SYSTEM_PROMPT).toContain('partMaterials');
    const props = SHAPE_JSON_SCHEMA.schema.properties as Record<string, { properties?: object }>;
    expect(Object.keys(props.details!.properties!)).toEqual(
      expect.arrayContaining(['plinth', 'timberFrame', 'panes'])
    );
  });
});

describe('Spark depth within real sizes (PT-8)', () => {
  const colors = { main: '#ffffff', secondary: '#cccccc', accent: '#333333' };

  it('parseKit clamps an estimated fridge depth', () => {
    const k = parseKit(
      reply({ archetype: 'cabinet', proportions: { w: 600, h: 1800, d: 1800 }, colors })
    );
    expect(k!.proportions.h).toBe(1);
    expect(k!.proportions.d / k!.proportions.w).toBeCloseTo(1.5, 6);
  });

  it('a critic patch is clamped too, a plausible one passes untouched', () => {
    const k = parseKit(
      reply({ archetype: 'cabinet', proportions: { w: 600, h: 1800, d: 600 }, colors })
    )!;
    expect(
      mergeKitPatch(k, { proportions: { w: 1 / 3, h: 1, d: 0.01 } }).proportions.d
    ).toBeGreaterThan(0.2);
    const fine = { w: 1 / 3, h: 1, d: 0.3 };
    expect(mergeKitPatch(k, { proportions: fine }).proportions).toEqual(fine);
  });
});

describe('kit evidence and confidence (PQ-T12)', () => {
  const base = {
    archetype: 'vehicle',
    proportions: { w: 1, h: 0.4, d: 0.5 },
    colors: { main: '#aa2222', secondary: '#222222', accent: '#88aacc' },
  };

  it('reads the evidence written first, capped at 12 parts, an unknown view dropped', () => {
    const parts = Array.from({ length: 15 }, (_, i) => `part ${i}`);
    const k = parseKit(
      reply({
        evidence: {
          view: 'diagonal',
          hiddenBy: ['Hedge'],
          visibleParts: parts,
          repeats: { wheels: 2.4 },
          unsure: ['proportions.d'],
        },
        confidence: { archetype: 0.9, colors: 1.7, counts: 'high' },
        ...base,
      })
    );
    expect(k!.evidence!.view).toBeUndefined();
    expect(k!.evidence!.visibleParts).toHaveLength(12);
    expect(k!.evidence!.hiddenBy).toEqual(['hedge']);
    expect(k!.evidence!.repeats).toEqual({ wheels: 2 });
    expect(k!.evidence!.unsure).toEqual(['proportions.d']);
    expect(k!.confidence).toEqual({ archetype: 0.9, colors: 1 });
    expect(parseEvidence({ view: 'side' })!.view).toBe('side');
  });

  it('an answer without evidence is still a valid kit (answers of the first prompt)', () => {
    const k = parseKit(reply(base));
    expect(k).not.toBeNull();
    expect(k!.evidence).toBeUndefined();
    expect(k!.confidence).toBeUndefined();
    expect(parseEvidence('nope')).toBeUndefined();
    expect(parseEvidence({ visibleParts: 'wheel' })).toBeUndefined();
  });

  it('prompt 2 asks for the evidence before the answer', () => {
    const keys = Object.keys(kitJsonSchema(KIT_PROMPT_CARDS_VERSION).schema.properties);
    expect(keys[0]).toBe('evidence');
    expect(keys).toContain('confidence');
    expect(kitJsonSchema(KIT_PROMPT_CARDS_VERSION).schema.required).toEqual(
      SHAPE_JSON_SCHEMA.schema.required
    );
  });

  it('regression (PR #12 review): prompt 1 is not offered evidence or confidence', () => {
    // Before: one schema for both prompts, so the default call could answer the extra fields too
    // (longer answers, and parts and doubts that were said to be off under prompt 1).
    const keys = Object.keys(kitJsonSchema().schema.properties);
    expect(kitJsonSchema()).toBe(SHAPE_JSON_SCHEMA);
    expect(keys).not.toContain('evidence');
    expect(keys).not.toContain('confidence');
    expect(keys[0]).toBe('archetype');
  });

  it('version 2 is the Muse cards of the hint family: look first, no « answer fast »', () => {
    const p = kitPrompt(KIT_PROMPT_CARDS_VERSION, 'vehicle');
    expect(p).toContain('Before you classify, look in this order');
    expect(p).toContain('VEHICLE');
    expect(p).not.toMatch(/answer fast/i);
    expect(kitPrompt(KIT_PROMPT_CARDS_VERSION, 'other')).not.toContain('VEHICLE');
    expect(() => kitPrompt(99)).toThrow(/unknown kit prompt version 99 \(kept: 1, 2\)/);
  });
});
