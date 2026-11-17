// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerJson, objectFrame } from '../team/shared/common';
import { finishesAnswered, finishesSpec, parseFinishes } from '../team/shared/finishes';
import { openingsAnswered, openingsSpec, parseOpenings } from '../team/shared/openings';
import { legsAnswered, legsSpec, parseLegs, LEG_KINDS } from '../team/shared/legs';
import { parseProfile, profileAnswered, profileSpec } from '../team/shared/profile';
import {
  HOUSE_FINISHES_CONFIG,
  HOUSE_OPENINGS_CONFIG,
  HOUSE_TOOL_SPECS,
  mergeToolAnswers,
} from '../house/house-tools';
import { CAR_FINISHES_CONFIG, CAR_GLAZING_CONFIG, CAR_TOOL_SPECS } from '../car/car-tools';

const frame = objectFrame('sofa');
const views = ['front', 'right', 'top'] as const;
type Props = { properties: Record<string, { items: { required: string[]; properties: object } }> };
const itemOf = (schema: object, key: string) => (schema as Props).properties[key]!.items;

describe('shared finishes (PQ-T86)', () => {
  const cfg = {
    subject: 'ONE sofa',
    frame,
    finishes: [
      ['upholstery', 'the fabric of seat and back'],
      ['frame', 'the wood or metal frame'],
    ] as const,
    materials: ['fabric', 'leather', 'wood', 'metal'],
    views,
    required: ['finish', 'color'] as const,
    schemaName: 'SeatFinishes',
  };

  it('names the team finishes and materials in its prompt and closed schema', () => {
    const spec = finishesSpec(cfg);
    expect(spec.key).toBe('finishes');
    expect(spec.system).toContain('upholstery (the fabric of seat and back)');
    expect(spec.system).toContain('ONE sofa');
    const item = itemOf(spec.schema.schema, 'finishes');
    expect(item.required).toEqual(['finish', 'color']);
    expect(JSON.stringify(item.properties)).toContain('"enum":["upholstery","frame"]');
    expect(JSON.stringify(item.properties)).not.toContain('figured');
  });

  it('answers with its list, even empty; parses only the team vocabulary', () => {
    expect(finishesAnswered('{"finishes":[]}')).toBe(true);
    expect(finishesAnswered('{"colors":[]}')).toBe(false);
    expect(finishesAnswered(null)).toBe(false);
    const got = parseFinishes(
      JSON.stringify({
        finishes: [
          {
            finish: 'upholstery',
            material: 'fabric',
            color: '#aa3322',
            view: 'front',
            box: [0.1, 0.2, 0.3, 0.4],
          },
          { finish: 'paint', color: '#000000' },
          { finish: 'frame', material: 'plastic', color: '#112233' },
          { finish: 'frame', color: 'red' },
        ],
      }),
      cfg
    );
    expect(got).toEqual([
      {
        finish: 'upholstery',
        material: 'fabric',
        color: '#aa3322',
        view: 'front',
        box: [0.1, 0.2, 0.3, 0.4],
      },
      // An unknown material is dropped, the finish kept.
      { finish: 'frame', color: '#112233' },
    ]);
  });

  it('keeps the house extras: figured flag and plain colours', () => {
    const spec = HOUSE_TOOL_SPECS.finishes;
    const props = (spec.schema.schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(['finishes', 'trim', 'glass', 'door', 'base']);
    expect(itemOf(spec.schema.schema, 'finishes').required).toEqual([
      'finish',
      'material',
      'color',
      'view',
      'box',
    ]);
    expect(spec.system).toContain('figured = true on the wall finish ONLY');
    expect(CAR_TOOL_SPECS.finishes.system).not.toContain('figured');
  });
});

describe('shared openings (PQ-T86)', () => {
  it('a box team gets boxes, panes and heads; an outline team gets points', () => {
    const house = itemOf(HOUSE_TOOL_SPECS.openings.schema.schema, 'openings');
    expect(house.required).toEqual(['view', 'kind', 'box']);
    expect(Object.keys(house.properties)).toEqual(['view', 'kind', 'box', 'panes', 'head']);
    const car = itemOf(CAR_TOOL_SPECS.glazing.schema.schema, 'windows');
    expect(car.required).toEqual(['view', 'kind', 'points']);
    expect(Object.keys(car.properties)).toEqual(['view', 'kind', 'points']);
    expect(CAR_TOOL_SPECS.glazing.system).toContain('3 to 8 points');
  });

  it('answers under its own key and drops items without their shape', () => {
    expect(openingsAnswered('{"windows":[]}', CAR_GLAZING_CONFIG)).toBe(true);
    expect(openingsAnswered('{"openings":[]}', CAR_GLAZING_CONFIG)).toBe(false);
    const got = parseOpenings(
      JSON.stringify({
        openings: [
          { view: 'front', kind: 'window', box: [0.1, 0.1, 0.2, 0.3], panes: [2, 2], head: 'arch' },
          { view: 'front', kind: 'door' },
          { view: 'top', kind: 'window', box: [0, 0, 1, 1] },
          { view: 'left', kind: 'porthole', box: [0, 0, 1, 1] },
        ],
      }),
      HOUSE_OPENINGS_CONFIG
    );
    expect(got).toEqual([
      { view: 'front', kind: 'window', box: [0.1, 0.1, 0.2, 0.3], panes: [2, 2], head: 'arch' },
    ]);
  });

  it('builds a new team’s spec (glazed cabinet doors)', () => {
    const spec = openingsSpec({
      subject: 'ONE cabinet',
      frame,
      what: 'every door, drawer and glazed panel',
      key: 'openings',
      kinds: ['door', 'drawer', 'glass'],
      views,
      shape: 'box',
      schemaName: 'StorageOpenings',
      task: 'List its doors and drawers.',
    });
    expect(spec.system).toContain('every door, drawer and glazed panel');
    expect(spec.system).not.toContain('head:');
    expect(Object.keys(itemOf(spec.schema.schema, 'openings').properties)).toEqual([
      'view',
      'kind',
      'box',
    ]);
  });
});

describe('shared legs (PQ-T86)', () => {
  const spec = legsSpec({ subject: 'ONE chair', frame, views });

  it('closed kinds and a count of supports', () => {
    expect(spec.key).toBe('legs');
    const item = itemOf(spec.schema.schema, 'legs');
    expect(item.required).toEqual(['kind', 'view', 'box', 'count']);
    expect(JSON.stringify(item.properties)).toContain(JSON.stringify([...LEG_KINDS]));
    expect(spec.system).toContain('empty list');
  });

  it('an empty list is an answer; parses the supports on the team views', () => {
    expect(legsAnswered('{"legs":[]}')).toBe(true);
    expect(legsAnswered('nothing')).toBe(false);
    const got = parseLegs(
      JSON.stringify({
        legs: [
          {
            kind: 'leg',
            view: 'front',
            box: [0.05, 0.8, 0.1, 1],
            count: 4,
            section: 'round',
            taper: true,
          },
          { kind: 'leg', view: 'back', box: [0, 0, 1, 1], count: 4 },
          { kind: 'hoof', view: 'front', box: [0, 0, 1, 1], count: 4 },
          { kind: 'caster', view: 'right', box: [0, 0.9, 0.1, 1], count: 0 },
        ],
      }),
      { views }
    );
    expect(got).toEqual([
      {
        kind: 'leg',
        view: 'front',
        box: [0.05, 0.8, 0.1, 1],
        count: 4,
        section: 'round',
        taper: true,
      },
    ]);
  });
});

describe('shared profile (PQ-T86)', () => {
  const cfg = {
    subject: 'ONE sofa',
    frame,
    views,
    lines: [
      ['seat', 'top of the seat cushions'],
      ['arm', 'top of the armrests'],
    ] as const,
  };

  it('names the team lines in its prompt and schema', () => {
    const spec = profileSpec(cfg);
    expect(spec.system).toContain('seat (top of the seat cushions)');
    const item = itemOf(spec.schema.schema, 'profile');
    expect(item.required).toEqual(['view', 'body']);
    expect(JSON.stringify(item.properties)).toContain('"seat"');
    expect(profileSpec({ subject: 'ONE rock', frame, views }).system).toContain('a lid, a worktop');
  });

  it('answers with at least one body box, one per drawing', () => {
    expect(profileAnswered('{"profile":[]}', cfg)).toBe(false);
    const text = JSON.stringify({
      profile: [
        {
          view: 'front',
          body: [0, 0.1, 1, 0.85],
          top: 'flat',
          sides: 'straight',
          lines: { seat: 0.45 },
        },
        { view: 'front', body: [0, 0, 0.5, 0.5] },
        { view: 'right', body: [0.5, 0.1, 0.2, 0.9] },
        { view: 'under', body: [0, 0, 1, 1] },
      ],
    });
    expect(profileAnswered(text, cfg)).toBe(true);
    expect(parseProfile(text, cfg)).toEqual([
      {
        view: 'front',
        body: [0, 0.1, 1, 0.85],
        top: 'flat',
        sides: 'straight',
        lines: { seat: 0.45 },
      },
    ]);
  });
});

/**
 * Saved readings (`resources/`, local only: skipped in CI) replayed through the shared parsers:
 * every opening, window and finish the house and car teams read still parses, and a house
 * reading split back into specialist answers merges into the same openings and finishes.
 */
const RES = resolve(__dirname, '../../../../../../resources');
const saved = (name: RegExp) =>
  ['generated-view', 'refine-3d'].flatMap((d) => {
    const dir = join(RES, d);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((sub) => {
      const at = join(dir, sub);
      try {
        return readdirSync(at)
          .filter((f) => name.test(f))
          .map((f) => join(at, f));
      } catch {
        return [];
      }
    });
  });

describe.skipIf(!existsSync(RES))('saved readings replayed (PQ-T86)', () => {
  it('house openings and finishes parse as the team read them', () => {
    const files = saved(/^house-reading.*\.json$/);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = answerJson(readFileSync(f, 'utf8')) as Record<string, unknown[] | undefined>;
      const openings = JSON.stringify({ openings: r.openings ?? [] });
      expect(parseOpenings(openings, HOUSE_OPENINGS_CONFIG).length, f).toBe(
        (r.openings ?? []).length
      );
      const finishes = JSON.stringify({ finishes: r.finishes ?? [] });
      expect(parseFinishes(finishes, HOUSE_FINISHES_CONFIG).length, f).toBe(
        (r.finishes ?? []).length
      );
      const merged = mergeToolAnswers(
        { massing: JSON.stringify({ volumes: r.volumes }), openings, finishes },
        null
      );
      expect(merged?.openings.length, f).toBe((r.openings ?? []).length);
    }
  });

  it('car windows and finishes parse as the team read them', () => {
    const files = saved(/^car-reading.*\.json$/);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = answerJson(readFileSync(f, 'utf8')) as Record<string, unknown[]>;
      expect(
        parseOpenings(JSON.stringify({ windows: r.windows }), CAR_GLAZING_CONFIG).length,
        f
      ).toBe(r.windows!.length);
      expect(
        parseFinishes(JSON.stringify({ finishes: r.finishes }), CAR_FINISHES_CONFIG).length,
        f
      ).toBe(r.finishes!.length);
    }
  });
});
