// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  CODE_API_CALLS_MAX,
  CODE_EXEC_LIMIT_MS,
  CODE_MAX_BYTES,
  estimateTriangles,
  runSandboxedCode,
  type CodeParams,
} from '../code-sandbox';
import { MAX_COMPONENTS, MAX_TRIANGLES } from '@/lib/object-shape';

const PARAMS: CodeParams = {
  seed: 7,
  proportions: { w: 1, h: 0.8, d: 0.6 },
  colors: { main: '#d8cfc0', secondary: '#8a4a2f', accent: '#2b3440' },
  measures: { overhang: 0.04, eave: 0.62 },
};

/** House-first (PQ-T45): overhang, openings on four faces, roof/wall joint from code. */
const HOUSE_BODY = `
// overhang: roofline measured 6 % wider than the wall
const wall = api.box({ at: [0, -0.08, 0], size: [0.8, 0.62, 0.5], kind: 'wall', color: params.colors.main, material: api.material('plaster') });
// joint: the prism foot overlaps the wall top by 0.02, no groove
const roof = api.prism({ at: [0, 0.28, 0], size: [0.92, 0.28, 0.62], kind: 'roof', color: params.colors.secondary, material: api.material('tile'), overhang: params.measures.overhang });
const front = api.box({ at: [-0.2, -0.05, 0.26], size: [0.12, 0.18, 0.02], kind: 'window', color: params.colors.accent, material: 'glass' });
const back = api.box({ at: [0.2, -0.05, -0.26], size: [0.12, 0.18, 0.02], kind: 'window', color: params.colors.accent, material: 'glass' });
const left = api.box({ at: [-0.41, -0.05, 0], size: [0.02, 0.18, 0.12], kind: 'window', color: params.colors.accent, material: 'glass' });
const right = api.box({ at: [0.41, -0.12, 0], size: [0.02, 0.3, 0.14], kind: 'door', color: '#6b4a2f', material: 'wood' });
return [wall, roof, front, back, left, right];
`;

describe('code-sandbox (PQ-T45, §8bis)', () => {
  it('builds a house from a build() body', async () => {
    const out = await runSandboxedCode(HOUSE_BODY, PARAMS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.source).toBe('code');
    expect(out.recipe.parts).toHaveLength(6);
    expect(out.recipe.proportions).toEqual(PARAMS.proportions);
    const roof = out.recipe.parts.find((p) => p.kind === 'roof');
    expect(roof?.overhang).toBe(0.04);
    expect(out.recipe.parts.every((p) => p.status === 'estimated')).toBe(true);
    expect(out.issues).toEqual([]);
    expect(out.stats.apiCalls).toBe(8);
    // A guest-set status is LLM output: never trusted.
    const stamped = await runSandboxedCode(
      `const w = api.box({ at: [0, 0, 0], size: [0.5, 0.5, 0.5], color: '#ffffff', status: 'measured' }); return [w];`,
      PARAMS
    );
    expect(stamped.ok).toBe(true);
    if (stamped.ok) expect(stamped.recipe.parts[0]?.status).toBe('estimated');
  });

  it('isolates the guest: no process, require, fetch, eval, Function or Date', async () => {
    const out = await runSandboxedCode(
      `return [{ shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff',
        kind: typeof process === 'undefined' && typeof require === 'undefined' && typeof fetch === 'undefined'
          && typeof eval === 'undefined' && typeof Function === 'undefined' && typeof Date === 'undefined'
          ? 'wall' : 'body' }];`,
      PARAMS
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.recipe.parts[0]?.kind).toBe('wall');
  });

  it('passes params and seeds rng deterministically', async () => {
    const place = `const w = api.box({ at: [api.rng() * 0.1, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' }); return [w];`;
    const seq = async (seed: number) => {
      const out = await runSandboxedCode(place, { ...PARAMS, seed });
      if (!out.ok) throw new Error(out.reason);
      return out.recipe.parts[0]?.at[0];
    };
    expect(await seq(7)).toBe(await seq(7));
    expect(await seq(7)).not.toBe(await seq(8));
    const out = await runSandboxedCode(
      `if (params.seed !== 7 || params.proportions.w !== 1 || params.colors.main !== '#d8cfc0' || params.measures.eave !== 0.62) throw new Error('params lost');
       return [{ shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' }];`,
      PARAMS
    );
    expect(out.ok).toBe(true);
  });

  it('caps api calls at 64', async () => {
    const out = await runSandboxedCode(
      `const ps = []; for (let i = 0; i < ${CODE_API_CALLS_MAX + 1}; i++) ps.push(api.box({ at: [0, 0, 0], size: [0.1, 0.1, 0.1], color: '#ffffff' })); return ps;`,
      PARAMS
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/api-call limit/);
  });

  it('drops invalid parts and reports them, like compileScript', async () => {
    const out = await runSandboxedCode(
      `return [
        { shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' },
        { shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: 'red' },
      ];`,
      PARAMS
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.parts).toHaveLength(1);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]?.index).toBe(1);
    expect(out.stats.dropped).toBe(1);
  });

  it('keeps the first 32 parts past the component budget', async () => {
    const out = await runSandboxedCode(
      `const ps = []; for (let i = 0; i < ${MAX_COMPONENTS + 1}; i++) ps.push({ shape: 'box', at: [0, 0, 0], size: [0.1, 0.1, 0.1], color: '#ffffff' }); return ps;`,
      PARAMS
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.parts).toHaveLength(MAX_COMPONENTS);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]?.reason).toMatch(/part budget/);
  });

  it('refuses output over the triangle budget', async () => {
    const out = await runSandboxedCode(
      `const ps = []; for (let i = 0; i < 32; i++) ps.push({ shape: 'sphere', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' }); return ps;`,
      PARAMS
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/triangles/);
  });

  it('rejects unknown materials with the name', async () => {
    const out = await runSandboxedCode(
      `return [api.box({ at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff', material: api.material('glas') })];`,
      PARAMS
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/unknown material "glas"/);
  });

  it('fails closed on syntax errors, non-array returns and oversized code', async () => {
    const bad = await runSandboxedCode(`const x = ;`, PARAMS);
    expect(bad.ok).toBe(false);
    const scalar = await runSandboxedCode(`return 42;`, PARAMS);
    expect(scalar.ok).toBe(false);
    if (!scalar.ok) expect(scalar.reason).toMatch(/array of parts/);
    const big = await runSandboxedCode(`return []; // ${'x'.repeat(CODE_MAX_BYTES)}`, PARAMS);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toMatch(/over the 65536 limit/);
    expect(CODE_EXEC_LIMIT_MS).toBe(2000);
  });

  it('interrupts runaway loops on the deadline (fake clock: fast and deterministic)', async () => {
    const times = [0, 0, CODE_EXEC_LIMIT_MS + 1];
    let i = 0;
    const out = await runSandboxedCode(
      `while (true) {} return [];`,
      PARAMS,
      () => times[Math.min(i++, times.length - 1)]!
    );
    expect(out.ok).toBe(false);
  });

  it('catches memory and stack bombs', async () => {
    const mem = await runSandboxedCode(`const s = 'x'.repeat(60_000_000); return [];`, PARAMS);
    expect(mem.ok).toBe(false);
    const stack = await runSandboxedCode(
      `const f = (n) => (n <= 0 ? 0 : 1 + f(n - 1)); f(1000000); return [];`,
      PARAMS
    );
    expect(stack.ok).toBe(false);
    // The poisoned module is dropped: the next execution re-instantiates and works.
    const after = await runSandboxedCode(
      `return [{ shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' }];`,
      PARAMS
    );
    expect(after.ok).toBe(true);
  });

  it('gives every execution a fresh context', async () => {
    const first = await runSandboxedCode(
      `globalThis.smuggled = 1; return [{ shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff' }];`,
      PARAMS
    );
    expect(first.ok).toBe(true);
    const second = await runSandboxedCode(
      `return [{ shape: 'box', at: [0, 0, 0], size: [0.2, 0.2, 0.2], color: '#ffffff', kind: typeof globalThis.smuggled === 'undefined' ? 'wall' : 'body' }];`,
      PARAMS
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.recipe.parts[0]?.kind).toBe('wall');
  });

  it('estimates triangles per shape', () => {
    const part = (shape: 'box' | 'sphere' | 'prism' | 'lathe') => ({
      shape,
      at: [0, 0, 0] as [number, number, number],
      size: [0.2, 0.2, 0.2] as [number, number, number],
      color: '#ffffff',
      ...(shape === 'lathe'
        ? {
            profile: [
              [0.1, -0.5],
              [0.1, 0.5],
            ] as [number, number][],
          }
        : {}),
    });
    expect(estimateTriangles(part('box'))).toBe(12);
    expect(estimateTriangles(part('sphere'))).toBe(432);
    expect(estimateTriangles(part('prism'))).toBe(24);
    expect(estimateTriangles(part('lathe'))).toBe(96);
    expect(MAX_TRIANGLES).toBe(5000);
  });

  it('sdf estimates at its per-part cap; guest code builds one, stamped estimated (PQ-T53)', async () => {
    expect(
      estimateTriangles({
        shape: 'sdf',
        at: [0, 0, 0],
        size: [1, 1, 1],
        color: '#ffffff',
        blobs: [{ kind: 'sphere', c: [0, 0, 0], r: 0.3 }],
      })
    ).toBe(3000);
    const out = await runSandboxedCode(
      `return [api.sdf({ at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', blobs: [{ kind: 'sphere', c: [0, 0, 0], r: 0.3 }] })];`,
      PARAMS
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.recipe.parts[0]?.shape).toBe('sdf');
      expect(out.recipe.parts[0]?.status).toBe('estimated');
      expect(out.stats.triangles).toBe(3000);
    }
    const bad = await runSandboxedCode(
      `return [api.sdf({ at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', blobs: [{ kind: 'sphere', c: [0, 0, 0], r: 0.01 }] })];`,
      PARAMS
    );
    expect(bad.ok).toBe(false);
  });
});

describe('lenient optional fields (PQ-T62)', () => {
  it('before: glazed:true dropped the whole window; now the field goes and the part stays', async () => {
    const { runSandboxedCode } = await import('../code-sandbox');
    const out = await runSandboxedCode(
      "return [api.box({at:[0,0,0],size:[0.3,0.3,0.05],color:params.colors.accent,kind:'window',glazed:true,grid:[2,2]})];",
      {
        seed: 1,
        proportions: { w: 1, h: 1, d: 1 },
        colors: { main: '#aaaaaa', secondary: '#555555', accent: '#224466' },
      }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.parts).toHaveLength(1);
    expect(out.recipe.parts[0]!.grid).toEqual([2, 2]);
    expect(out.recipe.parts[0]!.glazed).toBeUndefined();
    expect(out.issues[0]!.reason).toMatch(/glazed invalid and ignored/);
  });
});
