import { describe, expect, it } from 'vitest';
import { readCarParts, type AskCarTool } from '../car/car-specialist';
import {
  CAR_PILOT_SYSTEM_PROMPT,
  CAR_TOOL_SPECS,
  CarReadingSchema,
  carImageNames,
  carToolAnswered,
  carToolQuestion,
  mergeCarAnswers,
  parseCarBrief,
} from '../car/car-tools';

const pilot = JSON.stringify({
  kind: 'sedan',
  doors: 4,
  parts: { twoTone: true, chromeTrim: true, sunroof: false, flyingCar: true },
  calls: [
    { tool: 'finishes', focus: 'dark green roof over a mint body' },
    { tool: 'finishes', focus: 'chrome strip along the flank' },
    { tool: 'wheels', focus: 'not a tool' },
  ],
});
const body = JSON.stringify({
  body: {
    view: 'right',
    stations: { nose: 0.01, cowl: 0.36, roofFront: 0.44, roofRear: 0.72, tail: 0.88, rear: 0.99 },
    heights: { bonnet: 0.42, belt: 0.45, roof: 0.02, tail: 0.4, sill: 0.82 },
    roofWidth: 0.7,
    shoulderWidth: 0.96,
  },
});
const glazing = JSON.stringify({
  windows: [
    {
      view: 'front',
      kind: 'windscreen',
      points: [
        [0.2, 0.1],
        [0.8, 0.1],
        [0.85, 0.3],
        [0.15, 0.3],
      ],
    },
    { view: 'right', kind: 'side', points: [[0.5, 0.1]] }, // two points short: dropped
  ],
});
const details = JSON.stringify({
  details: [{ view: 'front', kind: 'headlight', box: [0.05, 0.4, 0.18, 0.5], color: '#f2f2e8' }],
});
const finishes =
  '```json\n{"finishes":[{"finish":"paint","material":"metal","color":"#c0d8c8","view":"right","box":[0.4,0.5,0.5,0.6]},{"finish":"paint2","color":"#2f5a48"}]}\n```';

describe('parseCarBrief (PQ-T76)', () => {
  it('keeps the kind and known parts, joins the notes per tool, calls every tool', () => {
    const b = parseCarBrief(pilot)!;
    expect(b.kind).toBe('sedan');
    expect(b.doors).toBe(4);
    expect(b.parts).toEqual({ twoTone: true, chromeTrim: true });
    expect(b.calls.map((c) => c.tool)).toEqual(['body', 'glazing', 'lights', 'finishes']);
    expect(b.calls[3]!.focus).toBe('dark green roof over a mint body chrome strip along the flank');
  });

  it('reads an unknown kind as other, null when the answer is not JSON', () => {
    expect(parseCarBrief('{"kind":"spaceship","calls":[]}')!.kind).toBe('other');
    expect(parseCarBrief('I cannot see a car')).toBeNull();
  });
});

describe('car questions', () => {
  it('names the images with the side orientation, and passes the brief and the note', () => {
    expect(carImageNames(['front', 'right'])).toBe(
      'image 1 = the FRONT view; image 2 = the RIGHT side (the front of the car at its LEFT edge)'
    );
    const q = carToolQuestion('finishes', 'car', ['front', 'right'], parseCarBrief(pilot));
    expect(q).toContain('(sedan, 4 doors)');
    expect(q).toContain('two tone, chrome trim');
    expect(q).toContain('dark green roof');
    expect(q).toContain(CAR_TOOL_SPECS.finishes.task);
  });
});

describe('carToolAnswered and mergeCarAnswers (PQ-T76)', () => {
  it('needs a body with two stations, and the lists of the others', () => {
    expect(carToolAnswered('body', body)).toBe(true);
    expect(carToolAnswered('body', '{"body":{"stations":{"nose":0.1},"heights":{}}}')).toBe(false);
    expect(carToolAnswered('glazing', glazing)).toBe(true);
    expect(carToolAnswered('glazing', '{"windowz":[]}')).toBe(false);
    expect(carToolAnswered('lights', null)).toBe(false);
  });

  it('merges the answers into a valid reading, bad items dropped', () => {
    const r = mergeCarAnswers({ body, glazing, lights: details, finishes }, parseCarBrief(pilot))!;
    expect(CarReadingSchema.parse(r)).toEqual(r);
    expect(r.kind).toBe('sedan');
    expect(r.parts).toEqual(['twoTone', 'chromeTrim']);
    expect(r.body?.stations.cowl).toBe(0.36);
    expect(r.windows).toHaveLength(1);
    expect(r.details[0]!.kind).toBe('headlight');
    expect(r.finishes.map((f) => f.finish)).toEqual(['paint', 'paint2']);
    expect(mergeCarAnswers({ glazing }, null)).toBeNull();
  });
});

describe('readCarParts (PQ-T76)', () => {
  it('briefs, then asks the four specialists with their own prompt and the pilot note', async () => {
    const calls: Array<{ tool: string; system: string; question: string }> = [];
    const ask: AskCarTool = async (tool, system, _schema, _img, question) => {
      calls.push({ tool, system, question });
      return { pilot, body, glazing, lights: details, finishes }[tool] ?? null;
    };
    const { reading, brief } = await readCarParts(ask, 'car', ['front', 'right'], ['a', 'b']);
    expect(brief?.kind).toBe('sedan');
    expect(calls.map((c) => c.tool)).toEqual(['pilot', 'body', 'glazing', 'lights', 'finishes']);
    expect(calls[0]!.system).toBe(CAR_PILOT_SYSTEM_PROMPT);
    expect(calls[4]!.question).toContain('chrome strip');
    expect(reading?.windows).toHaveLength(1);
  });

  it('asks a failed specialist once more; no body after the retry = no reading', async () => {
    let bodyCalls = 0;
    const flaky: AskCarTool = async (tool) => {
      if (tool === 'body') return ++bodyCalls === 1 ? null : body;
      return { pilot, glazing, lights: details, finishes }[tool] ?? null;
    };
    expect((await readCarParts(flaky, 'car', ['front'], ['a'])).reading?.body).toBeTruthy();
    expect(bodyCalls).toBe(2);
    const noBody: AskCarTool = async (tool) => ({ pilot, glazing })[tool as 'pilot'] ?? null;
    expect((await readCarParts(noBody, 'car', ['front'], ['a'])).reading).toBeNull();
  });

  it('ends a hanging call at its deadline and works without a brief', async () => {
    const hang: AskCarTool = (tool) =>
      tool === 'pilot'
        ? new Promise(() => {})
        : Promise.resolve({ body, glazing, lights: details, finishes }[tool] ?? null);
    const { reading, brief } = await readCarParts(hang, 'car', ['front'], ['a'], undefined, 30);
    expect(brief).toBeNull();
    expect(reading?.kind).toBeUndefined();
    expect(reading?.body?.heights.belt).toBe(0.45);
  });

  it('reads nothing without an image', async () => {
    const ask: AskCarTool = async () => pilot;
    expect(await readCarParts(ask, 'car', [], [])).toEqual({ reading: null, brief: null });
  });
});
