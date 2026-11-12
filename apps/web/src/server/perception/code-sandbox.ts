import 'server-only';

import {
  DefaultIntrinsics,
  isFail,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  type VmCallResult,
} from 'quickjs-emscripten';
import { newQuickJSWASMModule, RELEASE_SYNC } from 'quickjs-emscripten/variants';
import { mulberry32 } from '@/lib/seeded-random';
import {
  MAX_COMPONENTS,
  MAX_TRIANGLES,
  ObjectRecipeSchema,
  RECIPE_MATERIALS,
  RECIPE_SHAPES,
  RecipePartSchema,
  type ObjectRecipe,
  type RecipePart,
} from '@/lib/object-shape';

/**
 * Sandboxed construction code, route B (PQ-T45, §8bis): Wonder writes the body of
 * `build(api, params)`; it runs here, in QuickJS compiled to WebAssembly (pure WASM, no native
 * module: the same bundle runs on Vercel and OVHcloud). Never `eval`, never Node's `vm`, never
 * a worker with network access.
 *
 * Guest contract: the stored code is the *body* of `build(api, params)` and returns an array of
 * recipe parts (plain data). `api` exposes the current primitives first (`box, cylinder, sphere,
 * cone, prism, extrude, lathe, hip, hull`; §8bis's shorter list omits the roof shapes the
 * house-first case needs), `material` (echoes a valid material name) and `rng` (seeded). The
 * §7.3 generators (`sweep, branch, ...`) and `sdf` arrive with PQ-T50/51/53.
 *
 * Hard limits (§8bis), counted on the generated code's execution only: guest memory, guest stack,
 * a wall-clock deadline, ≤ 64 api calls, ≤ 800 built instances, ≤ 32 parts, ≤ 5 000 triangles.
 * The deadline stands in for the §8bis instruction counter: each interrupt poll costs ≈ 1.3 ms
 * of WASM↔host round-trip (measured), so counting polls would either allow minutes of runaway
 * code or slow healthy builds; a normal ≤ 32-part build polls once (≈ 1 ms) and finishes in a
 * few ms. Overrun = failed attempt, the draft model stays.
 *
 * The WASM module is instantiated once per process and cached; each execution gets a fresh
 * runtime and context (isolation), both disposed in a `finally`. One execution per request, run
 * by the route-B loop only.
 */

/** Most source bytes of one `build()` body (the checkpoint `code` field holds ≤ 64 Ko). */
export const CODE_MAX_BYTES = 64 * 1024;
/** Most `api.*` calls one execution may make (§8bis). */
export const CODE_API_CALLS_MAX = 64;
/** Most part objects one execution may build (§8bis; the recipe cap below binds first). */
export const CODE_INSTANCES_MAX = 800;
/** Guest JS heap, bytes (allocation bombs; a healthy build holds ≤ 32 small parts). */
export const CODE_MEMORY_BYTES = 16 * 1024 * 1024;
/** Guest call stack, bytes (deep-recursion bombs). */
export const CODE_STACK_BYTES = 512 * 1024;
/** Wall-clock budget of one execution, ms (runaway loops; healthy builds take a few ms). */
export const CODE_EXEC_LIMIT_MS = 2000;

/** What the host passes the guest: the draft to rebuild, nothing the photo did not show. */
export interface CodeParams {
  /** Seed of `api.rng`: the same code + seed builds the same parts, every run. */
  seed: number;
  /** Largest side = 1, like the recipe: the guest works in these proportions. */
  proportions: { w: number; h: number; d: number };
  /** Measured colour roles the guest paints with (never invented colours). */
  colors: { main: string; secondary: string; accent: string };
  /** Named measurements the guest may cite (`overhang`, `eave`, …), recipe units. */
  measures?: Record<string, number>;
}

export interface CodeIssue {
  index: number;
  reason: string;
}

export interface CodeStats {
  apiCalls: number;
  instances: number;
  triangles: number;
  dropped: number;
}

export type CodeRunResult =
  | { ok: true; recipe: ObjectRecipe; issues: CodeIssue[]; stats: CodeStats }
  | { ok: false; reason: string };

/** The WASM module, instantiated once per process (§8bis); a failure retries on the next call. */
let modulePromise: Promise<QuickJSWASMModule> | null = null;

function wasmModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    modulePromise = newQuickJSWASMModule(RELEASE_SYNC).catch((err) => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

/** Plain host value → guest value (params in, part mirrors out). Only JSON-ish values cross. */
function toGuest(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return ctx.undefined;
  if (typeof value === 'number') return ctx.newNumber(value);
  if (typeof value === 'string') return ctx.newString(value);
  if (typeof value === 'boolean') return value ? ctx.true : ctx.false;
  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    try {
      value.forEach((v, i) => {
        const h = toGuest(ctx, v);
        try {
          ctx.setProp(arr, i, h);
        } finally {
          h.dispose();
        }
      });
    } catch (err) {
      arr.dispose();
      throw err;
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = ctx.newObject();
    try {
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const h = toGuest(ctx, v);
        try {
          ctx.setProp(obj, k, h);
        } finally {
          h.dispose();
        }
      }
    } catch (err) {
      obj.dispose();
      throw err;
    }
    return obj;
  }
  throw new Error(`cannot send ${typeof value} to the sandbox`);
}

/**
 * Upper bound of the viewer triangles one part tessellates to (guardrail, not exact accounting:
 * the viewer drops details past its own budget). Values follow the viewer's segment counts
 * (`object-geometry.ts`: round parts 24 segments, spheres 18 × 12, bevel rings).
 */
export function estimateTriangles(part: RecipePart): number {
  switch (part.shape) {
    case 'box':
      return 12;
    case 'cylinder':
    case 'cone':
      return 24 * 2 * 2 + 24 * 2;
    case 'sphere':
      return 18 * 12 * 2;
    case 'prism':
      return 24;
    case 'hip':
      return 64;
    case 'extrude':
    case 'hull':
      return (part.points?.length ?? 3) * 4 + 12;
    case 'lathe':
      return (part.profile?.length ?? 2) * 24 * 2;
  }
}

interface ApiState {
  calls: number;
  instances: number;
}

function checkCallBudget(state: ApiState): void {
  state.calls += 1;
  if (state.calls > CODE_API_CALLS_MAX)
    throw new Error(`over the ${CODE_API_CALLS_MAX} api-call limit`);
}

/**
 * Value of a guest call, or a throw with the guest error's message. Unlike `unwrapResult`,
 * the error handle is always disposed: leaking it aborts the runtime disposal (QuickJS
 * `list_empty(&rt->gc_obj_list)` assertion).
 */
function takeValue(ctx: QuickJSContext, result: VmCallResult<QuickJSHandle>): QuickJSHandle {
  if (isFail(result)) {
    let message = 'guest error';
    try {
      const dumped: unknown = ctx.dump(result.error);
      if (typeof dumped === 'string') message = dumped;
      else if (dumped && typeof dumped === 'object' && 'message' in dumped)
        message = String((dumped as { message: unknown }).message);
    } finally {
      result.error.dispose();
    }
    throw new Error(message);
  }
  return result.value;
}

/**
 * Runs one `build()` body in a fresh runtime + context. Total: guest bugs, limit overruns and
 * invalid output come back as `{ ok: false }` or dropped-part issues, never as a throw — except
 * a broken WASM module, which rejects so the loop keeps the draft.
 */
export async function runSandboxedCode(
  code: string,
  params: CodeParams,
  now: () => number = Date.now
): Promise<CodeRunResult> {
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > CODE_MAX_BYTES) {
    return { ok: false, reason: `code is ${bytes} bytes, over the ${CODE_MAX_BYTES} limit` };
  }
  const wasm = await wasmModule();
  const runtime: QuickJSRuntime = wasm.newRuntime();
  runtime.setMemoryLimit(CODE_MEMORY_BYTES);
  runtime.setMaxStackSize(CODE_STACK_BYTES);
  // No clock inside (the Eval intrinsic stays: the host needs it for `evalCode`).
  const ctx = runtime.newContext({
    intrinsics: { ...DefaultIntrinsics, Date: false },
  });
  // Guest code compilation off the table: `eval` and `Function` are not reachable as globals
  // (`(()=>{}).constructor` still is — accepted: with no I/O, no host refs but `api`, and a
  // Zod-validated, triangle-capped output, the worst computed code can do is fail the attempt).
  ctx.setProp(ctx.global, 'eval', ctx.undefined);
  ctx.setProp(ctx.global, 'Function', ctx.undefined);
  const state: ApiState = { calls: 0, instances: 0 };
  const started = now();
  runtime.setInterruptHandler(() => now() - started > CODE_EXEC_LIMIT_MS);
  try {
    const api = ctx.newObject();
    try {
      for (const shape of RECIPE_SHAPES) {
        const fn = ctx.newFunction(shape, (opts) => {
          checkCallBudget(state);
          const dumped: unknown = ctx.dump(opts);
          if (!dumped || typeof dumped !== 'object' || Array.isArray(dumped))
            throw new Error(`api.${shape} takes an options object`);
          state.instances += 1;
          if (state.instances > CODE_INSTANCES_MAX)
            throw new Error(`over the ${CODE_INSTANCES_MAX} instance limit`);
          return toGuest(ctx, { shape, ...(dumped as Record<string, unknown>) });
        });
        try {
          ctx.setProp(api, shape, fn);
        } finally {
          fn.dispose();
        }
      }
      const material = ctx.newFunction('material', (name) => {
        checkCallBudget(state);
        const dumped: unknown = ctx.dump(name);
        if (typeof dumped !== 'string' || !RECIPE_MATERIALS.includes(dumped as never))
          throw new Error(`unknown material ${JSON.stringify(dumped)}`);
        return ctx.newString(dumped);
      });
      try {
        ctx.setProp(api, 'material', material);
      } finally {
        material.dispose();
      }
      const random = mulberry32(params.seed);
      const rng = ctx.newFunction('rng', () => ctx.newNumber(random()));
      try {
        ctx.setProp(api, 'rng', rng);
      } finally {
        rng.dispose();
      }
      const paramsHandle = toGuest(ctx, {
        seed: params.seed,
        proportions: params.proportions,
        colors: params.colors,
        ...(params.measures ? { measures: params.measures } : {}),
      });
      try {
        const fn = takeValue(ctx, ctx.evalCode(`(api, params) => {\n${code}\n}`, 'build.js'));
        try {
          const out = takeValue(ctx, ctx.callFunction(fn, ctx.undefined, api, paramsHandle));
          try {
            const returned: unknown = ctx.dump(out);
            if (!Array.isArray(returned))
              return { ok: false, reason: 'build() must return an array of parts' };
            const issues: CodeIssue[] = [];
            const parts: RecipePart[] = [];
            returned.forEach((raw: unknown, index: number) => {
              if (parts.length >= MAX_COMPONENTS) {
                issues.push({ index, reason: `over the ${MAX_COMPONENTS} part budget` });
                return;
              }
              const parsed = RecipePartSchema.safeParse(raw);
              if (!parsed.success) {
                const first = parsed.error.issues[0];
                issues.push({
                  index,
                  reason: first
                    ? `${String(first.path.join('.') || 'part')}: ${first.message}`
                    : 'invalid part',
                });
                return;
              }
              // Code-chosen placement is computed, never measured: stamp it honestly
              // (a guest-set status is LLM output and must not be trusted).
              parts.push({ ...parsed.data, status: 'estimated' });
            });
            if (!parts.length) return { ok: false, reason: 'no valid part returned' };
            const triangles = parts.reduce((n, p) => n + estimateTriangles(p), 0);
            if (triangles > MAX_TRIANGLES)
              return {
                ok: false,
                reason: `≈ ${triangles} triangles, over the ${MAX_TRIANGLES} budget`,
              };
            const recipe = ObjectRecipeSchema.parse({
              proportions: params.proportions,
              parts,
              source: 'code',
            });
            return {
              ok: true,
              recipe,
              issues,
              stats: {
                apiCalls: state.calls,
                instances: state.instances,
                triangles,
                dropped: issues.length,
              },
            };
          } finally {
            out.dispose();
          }
        } finally {
          fn.dispose();
        }
      } finally {
        paramsHandle.dispose();
      }
    } finally {
      api.dispose();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message.length > 300 ? `${message.slice(0, 300)}…` : message };
  } finally {
    try {
      ctx.dispose();
    } finally {
      try {
        runtime.dispose();
      } catch {
        // A poisoned runtime (QuickJS aborts its own disposal after a stack
        // overflow): drop the cached module so the next execution re-instantiates
        // a fresh WASM instance; this attempt already failed above.
        modulePromise = null;
      }
    }
  }
}
