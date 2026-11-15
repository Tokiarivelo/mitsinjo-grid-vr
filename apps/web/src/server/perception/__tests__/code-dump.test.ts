import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const root = vi.hoisted(
  () => `${process.env.CODE_DUMP_TEST_DIR ?? process.cwd() + '/.vitest'}/code-dump-${process.pid}`
);
vi.mock('@/lib/env', async (orig) => {
  const mod = await orig<typeof import('@/lib/env')>();
  return { ...mod, env: { ...mod.env, SHAPE_CODE_DUMP_DIR: root } };
});

import type { ObjectRecipe } from '@/lib/object-shape';
import { openCodeDump, wrapBuild } from '../code-dump';
import { refineWithCode } from '../shape-code-loop';

const draft = {
  proportions: { w: 1, h: 0.6, d: 0.6 },
  parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 0.5, 0.6], color: '#aa8855' }],
} as ObjectRecipe;
const params = {
  seed: 1,
  proportions: draft.proportions,
  colors: { main: '#aa8855', secondary: '#553322', accent: '#336699' },
};
const body =
  "return [{shape:'box',at:[0,0,0],size:[1,0.5,0.6],color:params.colors.main},{shape:'prism',at:[0,0.35,0],size:[1,0.2,0.6],color:params.colors.secondary,kind:'roof'}];";

describe('route-B debug dump (PQ-T56)', () => {
  it('wraps the body as build(api, params)', () => {
    expect(wrapBuild('return [];')).toContain('function build(api, params) {');
  });

  it('writes draft, round code, Blender script and summary through the real loop', async () => {
    const dump = openCodeDump('Maison test', 'muse-wonder-1.0')!;
    expect(dump).not.toBeNull();
    dump.draft(draft, 0.4, params);
    const out = await refineWithCode({
      label: 'Maison test',
      draft,
      baseScore: 0.4,
      params,
      sheet: async () => 'data:image/png;base64,AA==',
      writeCode: async () => ({ code: body, model: 'muse-wonder-1.0' }),
      score: async () => 0.7,
      roundsMax: 1,
      onRound: (e) => dump.round(e),
    });
    dump.final({ code: out.code, recipe: out.recipe, score: 0.7 });
    const files = readdirSync(dump.dir);
    expect(files).toEqual(
      expect.arrayContaining([
        'draft.blender.py',
        'round-1.build.js',
        'round-1.blender.py',
        'round-1.question.txt',
        'round-1.json',
        'final.build.js',
        'final.blender.py',
        'summary.json',
      ])
    );
    expect(readFileSync(join(dump.dir, 'round-1.build.js'), 'utf8')).toContain("shape:'prism'");
    const py = readFileSync(join(dump.dir, 'final.blender.py'), 'utf8');
    expect(py).toContain('import bpy');
    expect(py).toContain('"shape": "prism"');
    const summary = JSON.parse(readFileSync(join(dump.dir, 'summary.json'), 'utf8'));
    expect(summary[0]).toMatchObject({ round: 1, kept: true, score: 0.7 });
  });
});
