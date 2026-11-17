import { describe, expect, it, vi } from 'vitest';
import { MockPerceptionBackend } from '../mock';
import { runTeam, teamAsk, teamSpecs, type AskTeamTool, type SpecialistTeam } from '../team/team';

vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

type Tool = 'shape' | 'legs' | 'finishes';
interface Brief {
  kind: string;
}
interface Reading {
  kind: string | null;
  parts: string[];
}

const TOOLS = ['shape', 'legs', 'finishes'] as const;

const TEAM: SpecialistTeam<Tool, Brief, Reading, 'front'> = {
  id: 'test',
  promptVersion: 1,
  tools: TOOLS,
  required: ['shape'],
  timeoutMs: 60_000,
  pilot: {
    system: 'pilot system',
    schema: { name: 'Brief', schema: {} },
    question: (label) => `brief ${label}`,
    parse: (text) => (text.startsWith('{') ? (JSON.parse(text) as Brief) : null),
  },
  specs: teamSpecs<Tool, Brief, 'front'>(
    TOOLS,
    (t) => ({ system: `${t} system`, schema: { name: t, schema: {} } }),
    (t, label, _views, brief) => `${t} of ${label}${brief ? ` (${brief.kind})` : ''}`
  ),
  answered: (_t, text) => !!text && text !== 'junk',
  merge: (answers, brief) => ({
    kind: brief?.kind ?? null,
    parts: TOOLS.filter((t) => answers[t] && answers[t] !== 'junk').map((t) => answers[t]!),
  }),
  summary: (r) => r.parts.join(', '),
};

const input = { label: 'sofa', views: ['front'] as const, images: ['main', 'ref'] };

describe('runTeam (PQ-T83)', () => {
  it('briefs, asks every specialist with its own prompt, merges the answers', async () => {
    const calls: Array<{ tool: string; system: string; question: string; refs: number }> = [];
    const ask: AskTeamTool<Tool> = async (tool, system, _schema, img, question, refs) => {
      expect(img).toBe('main');
      calls.push({ tool, system, question, refs: refs.length });
      return tool === 'pilot' ? '{"kind":"sofa"}' : `${tool}!`;
    };
    const { reading, brief } = await runTeam(TEAM, ask, input);
    expect(brief).toEqual({ kind: 'sofa' });
    expect(calls.map((c) => c.tool)).toEqual(['pilot', 'shape', 'legs', 'finishes']);
    expect(calls[1]).toEqual({
      tool: 'shape',
      system: 'shape system',
      question: 'shape of sofa (sofa)',
      refs: 1,
    });
    expect(reading).toEqual({ kind: 'sofa', parts: ['shape!', 'legs!', 'finishes!'] });
  });

  it('asks an empty specialist once more, alone, then merges', async () => {
    const asked: string[] = [];
    let legs = 0;
    const ask: AskTeamTool<Tool> = async (tool) => {
      asked.push(tool);
      if (tool === 'legs') return ++legs === 1 ? null : 'legs!';
      return tool === 'pilot' ? null : `${tool}!`;
    };
    const { reading, brief } = await runTeam(TEAM, ask, input);
    expect(brief).toBeNull();
    expect(asked).toEqual(['pilot', 'shape', 'legs', 'finishes', 'legs']);
    expect(reading?.parts).toEqual(['shape!', 'legs!', 'finishes!']);
  });

  it('gives no reading when a required specialist is missing after its retry, keeps the brief', async () => {
    let shape = 0;
    const ask: AskTeamTool<Tool> = async (tool) => {
      if (tool === 'shape') {
        shape++;
        return 'junk';
      }
      return tool === 'pilot' ? '{"kind":"chair"}' : `${tool}!`;
    };
    const out = await runTeam(TEAM, ask, input);
    expect(shape).toBe(2);
    expect(out.reading).toBeNull();
    expect(out.brief).toEqual({ kind: 'chair' });
    expect(out.answers?.legs).toBe('legs!');
  });

  it('calls only the specialists the brief picks', async () => {
    const asked: string[] = [];
    const ask: AskTeamTool<Tool> = async (tool) => {
      asked.push(tool);
      return tool === 'pilot' ? '{"kind":"stool"}' : `${tool}!`;
    };
    const picky = { ...TEAM, toolsFor: () => ['shape'] as const };
    expect((await runTeam(picky, ask, input)).reading?.parts).toEqual(['shape!']);
    expect(asked).toEqual(['pilot', 'shape']);
  });

  it('ends at the deadline without throwing: no reading', async () => {
    let aborted = 0;
    const hang: AskTeamTool<Tool> = (_tool, _s, _sc, _i, _q, _r, signal) =>
      new Promise(() => signal?.addEventListener('abort', () => aborted++));
    const out = await runTeam(TEAM, hang, { ...input, timeoutMs: 20 });
    expect(out.reading).toBeNull();
    expect(out.brief).toBeNull();
    // Pilot, three specialists, three retries.
    expect(aborted).toBe(7);
  });

  it('stops on a cancelled request without throwing, nor retrying', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ask = vi.fn<AskTeamTool<Tool>>(async () => 'never');
    const out = await runTeam(TEAM, ask, { ...input, signal: ctrl.signal });
    expect(out.reading).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('survives a merge that throws, and reads nothing without an image', async () => {
    const ask: AskTeamTool<Tool> = async (tool) => `${tool}!`;
    const broken = {
      ...TEAM,
      merge: () => {
        throw new Error('bad');
      },
    };
    expect((await runTeam(broken, ask, input)).reading).toBeNull();
    expect(await runTeam(TEAM, ask, { ...input, images: [] })).toEqual({
      reading: null,
      brief: null,
    });
  });
});

describe('teamAsk (PQ-T85)', () => {
  it('calls the client for the team, a mock answer counting as none', async () => {
    const askTeamTool = vi.fn(async () => ({ content: '{}', source: 'meta' as const }));
    const ask = teamAsk<Tool>({ askTeamTool } as never, TEAM);
    expect(await ask('legs', 's', { name: 'L', schema: {} }, 'img', 'q', ['r'])).toBe('{}');
    expect(askTeamTool).toHaveBeenCalledWith(
      TEAM,
      'legs',
      's',
      { name: 'L', schema: {} },
      'img',
      'q',
      ['r']
    );
    const mocked = teamAsk<Tool>(
      { askTeamTool: async () => ({ content: '{}', source: 'mock' as const }) } as never,
      TEAM
    );
    expect(await mocked('legs', 's', { name: 'L', schema: {} }, 'img', 'q', [])).toBeNull();
  });

  it('the mock backend answers nothing to any team', async () => {
    const r = await new MockPerceptionBackend().askTeamTool();
    expect(r.result.content).toBeNull();
  });
});
