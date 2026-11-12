import { describe, expect, it } from 'vitest';
import {
  gridBoxToNorm,
  MAX_DETECTIONS,
  parseDetections,
  parseImageType,
  toApplianceCategory,
  toSceneryType,
} from '../detect';
import { ApplianceDetectionSchema } from '../schemas';

const reply = (objects: unknown[]) => JSON.stringify({ objects });

describe('parseDetections (PV-T4)', () => {
  it('maps a Muse reply to normalized detections with stable ids', () => {
    const out = parseDetections(
      reply([
        { label: 'Fridge', category: 'fridge', bbox: [100, 200, 300, 900], confidence: 0.9 },
        { label: 'TV', category: 'tv', bbox: [400, 300, 700, 550] },
      ])
    );
    expect(out).toEqual([
      {
        id: 'det-1',
        label: 'Fridge',
        category: 'fridge',
        confidence: 0.9,
        box: { x: 0.1, y: 0.2, w: 0.2, h: 0.7 },
      },
      { id: 'det-2', label: 'TV', category: 'tv', box: { x: 0.4, y: 0.3, w: 0.3, h: 0.25 } },
    ]);
    for (const d of out) expect(ApplianceDetectionSchema.safeParse(d).success).toBe(true);
  });

  it('clamps boxes to the 0–1000 grid and fixes swapped corners', () => {
    expect(gridBoxToNorm([-50, 900, 1200, 1100])).toEqual({ x: 0, y: 0.9, w: 1, h: 0.1 });
    expect(gridBoxToNorm([600, 500, 200, 100])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
    expect(gridBoxToNorm([10, 10, 10, 50])).toBeNull(); // zero width
    expect(gridBoxToNorm([1, 2, 3])).toBeNull();
    expect(gridBoxToNorm([1, 2, 'x', 4])).toBeNull();
    expect(gridBoxToNorm([1100, 0, 1500, 100])).toBeNull(); // fully outside → empty
  });

  it('maps out-of-enum categories to aliases or other', () => {
    expect(toApplianceCategory('Refrigerator')).toBe('fridge');
    expect(toApplianceCategory('light bulb')).toBe('lamp');
    expect(toApplianceCategory('phone-charger')).toBe('phone_charger');
    expect(toApplianceCategory('microwave')).toBe('other');
    expect(toApplianceCategory(42)).toBe('other');
    const [d] = parseDetections(
      reply([{ label: 'Microwave', category: 'microwave', bbox: [0, 0, 10, 10] }])
    );
    expect(d!.category).toBe('other');
    expect(d!.label).toBe('Microwave');
  });

  it('skips malformed objects, fixes confidence scale and empty labels, caps the count', () => {
    const out = parseDetections(
      reply([
        null,
        'fridge',
        { label: 'no box', category: 'fan' },
        { label: '  ', category: 'fan', bbox: [0, 0, 100, 100], confidence: 85 },
        { label: 'x'.repeat(60), category: 'lamp', bbox: [0, 0, 100, 100], confidence: -1 },
      ])
    );
    expect(out.map((d) => [d.id, d.label.length, d.confidence])).toEqual([
      ['det-1', 3, 0.85],
      ['det-2', 40, undefined],
    ]);
    expect(out[0]!.label).toBe('fan');
    const many = Array.from({ length: 30 }, () => ({
      label: 'l',
      category: 'lamp',
      bbox: [0, 0, 9, 9],
    }));
    expect(parseDetections(reply(many))).toHaveLength(MAX_DETECTIONS);
  });

  it('accepts a fenced JSON reply and an empty list', () => {
    expect(parseDetections('```json\n{"objects": []}\n```')).toEqual([]);
  });

  it('throws on a malformed reply so the client can fall back', () => {
    expect(() => parseDetections('I see a fridge.')).toThrow(/not valid JSON/);
    expect(() => parseDetections('{"items": []}')).toThrow();
    expect(() => parseDetections('')).toThrow();
  });

  it('never carries a power value, even if the model adds one', () => {
    const [d] = parseDetections(
      reply([
        { label: 'Pump', category: 'water_pump', bbox: [0, 0, 500, 500], watts: 750, kw: 0.75 },
      ])
    );
    expect(Object.keys(d!).sort()).toEqual(['box', 'category', 'id', 'label']);
  });

  it('outdoor scene: houses, cars and trees become scenery (no load); street lights are lamps', () => {
    const out = parseDetections(
      reply([
        { label: 'Stone house', kind: 'scenery', scenery: 'building', bbox: [350, 250, 700, 600] },
        { label: 'Blue car', kind: 'scenery', scenery: 'vehicle', bbox: [290, 590, 480, 720] },
        { label: 'Willow tree', kind: 'scenery', bbox: [0, 0, 220, 650] },
        {
          label: 'Street lamp',
          kind: 'appliance',
          category: 'street_light',
          bbox: [565, 480, 580, 560],
        },
      ])
    );
    expect(out.map((d) => [d.id, d.label, d.kind ?? 'appliance', d.category, d.scenery])).toEqual([
      ['det-1', 'Street lamp', 'appliance', 'lamp', undefined],
      ['det-2', 'Stone house', 'scenery', 'other', 'building'],
      ['det-3', 'Blue car', 'scenery', 'other', 'vehicle'],
      ['det-4', 'Willow tree', 'scenery', 'other', 'tree'],
    ]);
    for (const d of out) expect(ApplianceDetectionSchema.safeParse(d).success).toBe(true);
  });

  it('without kind: a scenery word in category or label makes it scenery', () => {
    const out = parseDetections(
      reply([
        { label: 'Car', category: 'car', bbox: [0, 0, 100, 100] },
        { label: 'Flowers', bbox: [0, 0, 100, 100] },
        { label: 'Microwave', category: 'microwave', bbox: [0, 0, 100, 100] },
        { label: 'Water pump', bbox: [0, 0, 100, 100] },
      ])
    );
    expect(out.map((d) => [d.label, d.kind ?? 'appliance', d.scenery ?? d.category])).toEqual([
      ['Microwave', 'appliance', 'other'],
      ['Water pump', 'appliance', 'water_pump'],
      ['Car', 'scenery', 'vehicle'],
      ['Flowers', 'scenery', 'plant'],
    ]);
    expect(toSceneryType('houses')).toBe('building');
    expect(toSceneryType('Mini Cooper')).toBe('vehicle');
    expect(toSceneryType('purple vintage car')).toBe('vehicle');
    expect(toSceneryType('automobile')).toBe('vehicle');
    expect(toSceneryType('voiture')).toBe('vehicle');
    expect(toSceneryType('fridge')).toBeNull();
  });

  it('accepts object-shaped boxes and a `box` key', () => {
    const out = parseDetections(
      reply([
        { label: 'Fan', category: 'fan', bbox: { x_min: 100, y_min: 200, x_max: 300, y_max: 400 } },
        { label: 'TV', category: 'tv', box: [400, 300, 700, 550] },
      ])
    );
    expect(out.map((d) => d.box)).toEqual([
      { x: 0.1, y: 0.2, w: 0.2, h: 0.2 },
      { x: 0.4, y: 0.3, w: 0.3, h: 0.25 },
    ]);
  });

  it('ignores image_type: detections read the same with or without it', () => {
    const objects = [{ label: 'Fridge', category: 'fridge', bbox: [100, 200, 300, 900] }];
    expect(parseDetections(JSON.stringify({ objects, image_type: 'drawing' }))).toEqual(
      parseDetections(reply(objects))
    );
  });
});

describe('parseImageType (PQ-T47 E2)', () => {
  it('reads drawing, defaults to photo, never throws', () => {
    expect(parseImageType(JSON.stringify({ objects: [], image_type: 'drawing' }))).toBe('drawing');
    expect(parseImageType(JSON.stringify({ objects: [], image_type: 'photo' }))).toBe('photo');
    expect(parseImageType(JSON.stringify({ objects: [] }))).toBe('photo');
    expect(parseImageType(JSON.stringify({ objects: [], image_type: 'plan' }))).toBe('photo');
    expect(parseImageType('not json')).toBe('photo');
  });
});
