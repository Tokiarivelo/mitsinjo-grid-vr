import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { askSpecialists, callWithDeadline } from '../team-call';
import { readPlantParts, type AskPlantTool } from '../tree/plant-specialist';
import {
  PLANT_TOOLS,
  mergePlantAnswers,
  parsePlantBrief,
  plantHints,
  plantToolAnswered,
  plantToolQuestion,
} from '../tree/plant-tools';

const BRIEF = JSON.stringify({
  species: 'weeping willow (Salix)',
  habit: 'weeping',
  leaf: 'broad',
  calls: [{ tool: 'branches', focus: 'two big limbs on the left' }, { tool: 'nope' }],
});
const ANSWERS = {
  trunk: JSON.stringify({
    trunks: [
      {
        points: [
          [0.5, 1],
          [0.52, 0.6],
        ],
        width: 0.08,
      },
    ],
  }),
  branches: JSON.stringify({
    branches: [
      {
        points: [
          [0.5, 0.6],
          [0.3, 0.4],
        ],
        width: 0.03,
      },
      {
        points: [
          [0.5, 0.6],
          [0.6, 0.5],
        ],
        width: 0.002,
      },
      { points: [[2, 0]], width: 0.1 },
    ],
  }),
  foliage:
    '```json\n{"foliage":{"habit":"weeping","leaf":"broad","arrangement":"curtain","drape":0.9}}\n```',
  flowers: JSON.stringify({ flowers: { flowers: false, fruit: false, share: 0 } }),
  leaves: JSON.stringify({
    leaves: [
      {
        points: [
          [0.5, 0.3],
          [0.7, 0.2],
          [0.9, 0.4],
        ],
        width: 0.05,
      },
      { points: [[0.5, 0.3]], width: 0.05 },
    ],
  }),
};

describe('plant team: brief, answers, merge, hints', () => {
  it('parses the brief and keeps one call per tool', () => {
    const brief = parsePlantBrief(BRIEF)!;
    expect(brief.species).toBe('weeping willow (Salix)');
    expect(brief.calls.map((c) => c.tool)).toEqual([...PLANT_TOOLS]);
    expect(plantToolQuestion('branches', 'tree', brief)).toContain('two big limbs');
    expect(parsePlantBrief('no json')).toBeNull();
    expect(parsePlantBrief('{"habit":"tall"}')).toBeNull();
  });

  it('tells an answer from none', () => {
    expect(plantToolAnswered('foliage', ANSWERS.foliage)).toBe(true);
    expect(plantToolAnswered('foliage', '{"foliage":{"habit":"weeping"}}')).toBe(true);
    expect(plantToolAnswered('foliage', '{"foliage":{"habit":"tall"}}')).toBe(false);
    expect(plantToolAnswered('branches', '{"branches":"none"}')).toBe(false);
    expect(plantToolAnswered('trunk', null)).toBe(false);
  });

  it('merges the answers, dropping bad limbs, and turns them into hints', () => {
    const reading = mergePlantAnswers(ANSWERS, parsePlantBrief(BRIEF))!;
    expect(reading.species).toBe('weeping willow (Salix)');
    expect(reading.branches).toHaveLength(2);
    expect(reading.foliage?.arrangement).toBe('curtain');
    const hints = plantHints(reading);
    expect(hints.habit).toBe('weeping');
    // The twig thinner than a hundredth of the image is not a limb.
    expect(hints.branches).toHaveLength(1);
    expect(hints.trunks).toHaveLength(1);
    // The team saw no flowers: none are drawn, whatever colour the pixels found.
    expect(hints.bloom).toBe(0);
    // The leaf specialist's traces pass through, the one-point trace dropped.
    expect(hints.traces).toHaveLength(1);
    expect(mergePlantAnswers({ ...ANSWERS, foliage: null }, null)).toBeNull();
    expect(plantHints(null)).toEqual({});
  });
});

describe('team calls', () => {
  it('ends a call at its deadline with no answer', async () => {
    const never = () => new Promise<string | null>(() => {});
    expect(await callWithDeadline('t', 'slow', 20, undefined, never)).toBeNull();
  });

  it('asks an unusable specialist once more', async () => {
    const calls: string[] = [];
    const ask = async (t: 'a' | 'b') => {
      calls.push(t);
      return t === 'b' && calls.filter((c) => c === 'b').length === 1 ? null : 'ok';
    };
    const answers = await askSpecialists('t', ['a', 'b'] as const, ask, (_, c) => c === 'ok');
    expect(answers).toEqual({ a: 'ok', b: 'ok' });
    expect(calls.filter((c) => c === 'b')).toHaveLength(2);
  });

  it('reads a plant with the pilot and the four specialists', async () => {
    const asked: string[] = [];
    const ask: AskPlantTool = async (tool) => {
      asked.push(tool);
      return tool === 'pilot' ? BRIEF : ANSWERS[tool];
    };
    const { reading, brief } = await readPlantParts(ask, 'tree', 'data:image/png;base64,');
    expect(brief?.habit).toBe('weeping');
    expect(reading?.habit).toBe('weeping');
    expect(asked.sort()).toEqual(['branches', 'flowers', 'foliage', 'leaves', 'pilot', 'trunk']);
  });

  it('gives no reading without the foliage', async () => {
    const ask: AskPlantTool = async (tool) =>
      tool === 'pilot' ? BRIEF : tool === 'foliage' ? null : ANSWERS[tool];
    expect((await readPlantParts(ask, 'tree', 'x')).reading).toBeNull();
  });
});
