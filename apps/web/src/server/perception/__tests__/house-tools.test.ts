import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  HOUSE_TOOL_SPECS,
  mergeToolAnswers,
  parseBrief,
  patchReading,
  toolQuestion,
} from '../house/house-tools';
import { parseHouseReading } from '../house/house-prompt';
import { readHouseParts, type AskHouseTool } from '../house/house-specialist';

const massing = JSON.stringify({
  volumes: [
    {
      kind: 'body',
      plan: [0.05, 0.95, 0.2, 0.8],
      eave: 0.35,
      ridge: 0.1,
      roof: 'hip',
      ridgeAxis: 'x',
    },
    {
      kind: 'wing',
      plan: [0, 0.3, 0.6, 0.9],
      eave: 0.4,
      ridge: 0.3,
      roof: 'shed',
      ridgeAxis: 'x',
      roofFinish: 'roof2',
    },
    {
      kind: 'veranda',
      plan: [0.05, 0.95, 0.8, 1],
      eave: 0.6,
      ridge: 0.6,
      roof: 'flat',
      ridgeAxis: 'x',
      open: ['front'],
      columns: 0,
      floor: 0.95,
      arcade: 'bracket',
    },
  ],
});
const finishes = JSON.stringify({
  finishes: [
    {
      finish: 'wall',
      material: 'wood',
      color: '#7A4E30',
      view: 'front',
      box: [0.1, 0.4, 0.2, 0.5],
    },
    {
      finish: 'stone',
      material: 'stone',
      color: '#8a7360',
      view: 'front',
      box: [0.05, 0.6, 0.1, 0.9],
    },
    {
      finish: 'roof2',
      material: 'metal',
      color: '#5b5b60',
      view: 'top',
      box: [0.1, 0.1, 0.3, 0.3],
    },
  ],
  trim: '#3b2a20',
});

describe('parseBrief', () => {
  it('keeps known tools, joins notes and adds the tools a house always needs', () => {
    const brief = parseBrief(
      JSON.stringify({
        type: 'mountain lodge',
        storeys: 2,
        parts: { piers: true, arcades: true, nonsense: true },
        calls: [
          { tool: 'massing', focus: 'two metal shed roofs.' },
          { tool: 'massing', focus: 'Central gable with a truss.' },
          { tool: 'paint', focus: 'x' },
        ],
      })
    );
    expect(brief).not.toBeNull();
    expect(brief!.type).toBe('mountain lodge');
    expect(brief!.parts).toEqual({ piers: true, arcades: true });
    expect(brief!.calls.map((c) => c.tool)).toEqual([
      'massing',
      'openings',
      'structure',
      'finishes',
    ]);
    expect(brief!.calls[0]!.focus).toBe('two metal shed roofs. Central gable with a truss.');
  });

  it('reads a fenced answer and refuses prose', () => {
    expect(parseBrief('```json\n{"type":"bungalow","calls":[]}\n```')?.type).toBe('bungalow');
    expect(parseBrief('no idea')).toBeNull();
  });
});

describe('toolQuestion', () => {
  it("passes the brief's type, parts and the tool's own note", () => {
    const brief = parseBrief(
      JSON.stringify({
        type: 'villa',
        parts: { arcades: true, secondRoofing: true },
        calls: [{ tool: 'massing', focus: 'arcade of five round arches' }],
      })
    )!;
    const q = toolQuestion('massing', 'house', ['front', 'top'], brief);
    expect(q).toContain('villa');
    expect(q).toContain('arcades, second roofing');
    expect(q).toContain('arcade of five round arches');
    expect(q).toContain('image 2 = the VIEW FROM ABOVE');
    expect(toolQuestion('openings', 'house', ['front'], null)).toContain(
      HOUSE_TOOL_SPECS.openings.task
    );
  });
});

describe('mergeToolAnswers', () => {
  it('merges the specialists into one reading that replays like a single one', () => {
    const reading = mergeToolAnswers(
      {
        massing,
        openings: JSON.stringify({
          openings: [{ view: 'front', kind: 'window', box: [0.4, 0.4, 0.5, 0.55], head: 'arch' }],
        }),
        structure: JSON.stringify({
          piers: [{ plan: [0.05, 0.1, 0.9, 0.98], top: 0.4, band: 0.75 }],
          chimneys: [{ plan: [0.4, 0.45, 0.3, 0.35], top: 0 }],
        }),
        finishes,
      },
      { type: 'lodge', storeys: 2, parts: {}, calls: [] }
    );
    expect(reading).not.toBeNull();
    expect(reading!.volumes).toHaveLength(3);
    expect(reading!.volumes[1]!.roofFinish).toBe('roof2');
    expect(reading!.volumes[2]!.arcade).toBe('bracket');
    expect(reading!.openings[0]!.head).toBe('arch');
    expect(reading!.piers).toHaveLength(1);
    expect(reading!.chimneys).toHaveLength(1);
    expect(reading!.finishes?.map((f) => f.finish)).toEqual(['wall', 'stone', 'roof2']);
    expect(reading!.walls).toEqual({ material: 'wood', color: '#7a4e30' });
    expect(reading!.trim).toBe('#3b2a20');
    expect(reading!.type).toBe('lodge');
    // Saved as JSON and replayed (`make views-3d READING=`): the same reading.
    expect(parseHouseReading(JSON.stringify(reading))).toEqual(reading);
  });

  it('gives nothing without a massing, whatever the others say', () => {
    expect(mergeToolAnswers({ massing: null, finishes }, null)).toBeNull();
    expect(mergeToolAnswers({ massing: 'garbage' }, null)).toBeNull();
  });
});

describe('readHouseParts', () => {
  it('briefs, then calls the specialists the pilot asked for, each with its own prompt', async () => {
    const calls: Array<{ tool: string; system: string; question: string }> = [];
    const ask: AskHouseTool = async (tool, system, _schema, _img, question) => {
      calls.push({ tool, system, question });
      if (tool === 'pilot')
        return JSON.stringify({
          type: 'lodge',
          parts: { piers: true },
          calls: [{ tool: 'massing', focus: 'metal sheds on the wings' }],
        });
      if (tool === 'massing') return massing;
      if (tool === 'finishes') return finishes;
      return JSON.stringify({ openings: [], piers: [], chimneys: [] });
    };
    const { reading, brief } = await readHouseParts(ask, 'house', ['front', 'top'], ['a', 'b']);
    expect(brief?.type).toBe('lodge');
    expect(calls.map((c) => c.tool)).toEqual([
      'pilot',
      'massing',
      'openings',
      'structure',
      'finishes',
    ]);
    expect(calls[1]!.system).toBe(HOUSE_TOOL_SPECS.massing.system);
    expect(calls[1]!.question).toContain('metal sheds on the wings');
    expect(reading?.volumes).toHaveLength(3);
  });

  const noOpenings = JSON.stringify({ openings: [] });

  it('still runs every specialist when the pilot fails, and survives a failing optional one', async () => {
    const asked: string[] = [];
    const ask: AskHouseTool = async (tool) => {
      asked.push(tool);
      if (tool === 'pilot') throw new Error('timeout');
      if (tool === 'structure') throw new Error('http_500');
      return tool === 'massing' ? massing : tool === 'openings' ? noOpenings : null;
    };
    const { reading, brief } = await readHouseParts(ask, 'house', ['front'], ['a']);
    expect(brief).toBeNull();
    expect(reading?.volumes).toHaveLength(3);
    // An empty list is an answer: not asked again. A failed call is, once.
    expect(reading?.openings).toEqual([]);
    expect(asked.filter((t) => t === 'openings')).toHaveLength(1);
    expect(asked.filter((t) => t === 'structure')).toHaveLength(2);
  });

  it('asks a call the network cut once more, alone, keeping the other answers', async () => {
    let tries = 0;
    const ask: AskHouseTool = async (tool) => {
      if (tool === 'massing') {
        tries++;
        if (tries === 1) throw new Error('socket hang up');
        return massing;
      }
      return tool === 'finishes' ? finishes : tool === 'openings' ? noOpenings : null;
    };
    const { reading } = await readHouseParts(ask, 'house', ['front'], ['a']);
    expect(tries).toBe(2);
    expect(reading?.volumes).toHaveLength(3);
    expect(reading?.finishes).toHaveLength(3);
  });

  it('hands over to the single reading when the openings never come (never a house without windows)', async () => {
    let openings = 0;
    const ask: AskHouseTool = async (tool) => {
      if (tool === 'openings') {
        openings++;
        throw new Error('socket hang up');
      }
      return tool === 'massing' ? massing : tool === 'finishes' ? finishes : null;
    };
    const { reading } = await readHouseParts(ask, 'house', ['front'], ['a']);
    expect(openings).toBe(2);
    expect(reading).toBeNull();
  });

  it('gives up on a specialist that never answers, at its deadline', async () => {
    let aborted = 0;
    const ask: AskHouseTool = (tool, _s, _sc, _i, _q, _r, signal) => {
      if (tool === 'structure')
        return new Promise(() => signal?.addEventListener('abort', () => aborted++));
      return Promise.resolve(
        tool === 'massing' ? massing : tool === 'openings' ? noOpenings : null
      );
    };
    const { reading } = await readHouseParts(ask, 'house', ['front'], ['a'], undefined, 30);
    expect(reading?.volumes).toHaveLength(3);
    // Its first call and its retry, each ended at the deadline.
    expect(aborted).toBe(2);
  });

  it('answers no reading when the massing fails (the single reading takes over)', async () => {
    const ask: AskHouseTool = async () => null;
    expect((await readHouseParts(ask, 'house', ['front'], ['a'])).reading).toBeNull();
  });

  it('hands back the answers of the specialists when the massing fails (PQ-T74)', async () => {
    const ask: AskHouseTool = async (tool) => (tool === 'finishes' ? finishes : null);
    const out = await readHouseParts(ask, 'house', ['front'], ['a']);
    expect(out.reading).toBeNull();
    expect(out.answers?.finishes).toBe(finishes);
  });
});

describe('patchReading (PQ-T74)', () => {
  const single = parseHouseReading(
    JSON.stringify({
      volumes: [
        { kind: 'body', plan: [0, 1, 0, 1], eave: 0.4, ridge: 0.1, roof: 'gable', ridgeAxis: 'x' },
      ],
      openings: [{ view: 'front', kind: 'door', box: [0.6, 0.5, 0.8, 0.95] }],
      chimneys: [{ plan: [0, 0.1, 0.8, 0.9], top: 0 }],
      walls: { material: 'plaster', color: '#a9a49b' },
      roof: { material: 'slate', color: '#6b5f52' },
      trim: '#5b4d3d',
      base: '#6e7373',
    })
  )!;

  it('completes a single reading with the finishes the specialist read', () => {
    const patched = patchReading(single, { massing: null, finishes }, null);
    // Blocks, openings and chimneys of the single reading; finishes and looks of the specialist.
    expect(patched.volumes).toEqual(single.volumes);
    expect(patched.openings).toEqual(single.openings);
    expect(patched.chimneys).toEqual(single.chimneys);
    expect(patched.finishes?.map((f) => f.finish)).toEqual(['wall', 'stone', 'roof2']);
    expect(patched.walls).toEqual({ material: 'wood', color: '#7a4e30' });
    expect(patched.trim).toBe('#3b2a20');
    // What the specialist did not give stays as the single reading had it.
    expect(patched.roof).toEqual(single.roof);
    expect(patched.base).toBe('#6e7373');
  });

  it('keeps the blocks of the massing specialist when only the openings failed', () => {
    const patched = patchReading(single, { massing, openings: null }, null);
    expect(patched.volumes).toHaveLength(3);
    expect(patched.openings).toEqual(single.openings);
  });

  it('reads a colour under a garbled key by its start', () => {
    const garbled = JSON.stringify({
      finishes: [],
      trim: '#111111',
      door_facade: '#59432E',
      baseweld: '#8A8A82',
    });
    const merged = mergeToolAnswers({ massing, finishes: garbled }, null)!;
    expect(merged.door).toBe('#59432e');
    expect(merged.base).toBe('#8a8a82');
    expect(merged.trim).toBe('#111111');
  });

  it('is the single reading when no specialist answered', () => {
    expect(patchReading(single, { massing: null, finishes: 'no json' }, null)).toBe(single);
  });
});
