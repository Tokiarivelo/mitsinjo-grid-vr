import 'server-only';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { env } from '@/lib/env';
import type { ObjectRecipe } from '@/lib/object-shape';
import { recipeToBlender } from './blender-export';
import type { CodeParams } from './code-sandbox';
import type { CodeRoundEvent } from './shape-code-loop';

/**
 * Route-B debug dump (PQ-T56): for every object the code model touches, a folder holding the
 * draft, each round's `build()` body (JS), the same model as a Blender script (Python), the exact
 * question the writer got, the executed parts and a `summary.json`. Failures here never touch the
 * pipeline: the dump is a debug aid, every write is best effort.
 *
 * Layout: `<root>/<yyyymmdd-hhmmss>-<label>/`
 *   draft.blender.py                 route-A template model (compare in Blender)
 *   round-N.build.js                 body written by the model (wrapped as build(api, params))
 *   round-N.blender.py               what that body built, as a Blender script
 *   round-N.question.txt / .params.json / .parts.json / .json (score, kept, reason, timings)
 *   final.build.js / final.blender.py  winning code (only when a round beat the draft)
 *   summary.json                     one line per round
 */

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'object';

const stamp = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('T', '-');

/** Repo root: the folder holding `pnpm-workspace.yaml`, walking up from the server's cwd. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Dump root, or null when disabled (`off`, or production without an explicit folder). */
export function codeDumpRoot(): string | null {
  const configured = env.SHAPE_CODE_DUMP_DIR?.trim();
  if (configured?.toLowerCase() === 'off') return null;
  if (configured) return isAbsolute(configured) ? configured : resolve(repoRoot(), configured);
  if (process.env.NODE_ENV === 'production') return null;
  return join(repoRoot(), 'debug', 'shape-code');
}

/** The body as the function it is, so the file runs when pasted in a JS console with a stub api. */
export function wrapBuild(body: string): string {
  return `// Body written by the code model; runs in the QuickJS sandbox as build(api, params).\nfunction build(api, params) {\n${body
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')}\n}\n`;
}

export interface CodeDump {
  /** Folder of this object's dump. */
  dir: string;
  /** Route-A draft, before any round. */
  draft(recipe: ObjectRecipe, score: number, params: CodeParams): void;
  /** One finished (or failed) writer round. */
  round(event: CodeRoundEvent): void;
  /** Loop end: the winning code, or the note that none beat the draft. */
  final(result: { code: string | null; recipe: ObjectRecipe; score: number }): void;
}

/** Opens one object's dump, or null when disabled or the folder cannot be created. */
export function openCodeDump(label: string, model: string): CodeDump | null {
  const root = codeDumpRoot();
  if (!root) return null;
  const dir = join(root, `${stamp()}-${slug(label)}`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(
      '[vision] 3D code dump: cannot create',
      dir,
      err instanceof Error ? err.message : err
    );
    return null;
  }
  const summary: Array<Record<string, unknown>> = [];
  const save = (name: string, text: string) => {
    try {
      writeFileSync(join(dir, name), text);
    } catch (err) {
      console.warn(
        `[vision] 3D code dump: cannot write ${name}:`,
        err instanceof Error ? err.message : err
      );
    }
  };
  const blender = (recipe: ObjectRecipe, notes: string[], jsCode?: string) => {
    try {
      return recipeToBlender(recipe, { label, notes, ...(jsCode ? { jsCode } : {}) });
    } catch (err) {
      return `# Blender export failed: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  };
  console.info(`[vision] 3D code dump for "${label}": ${dir}`);
  return {
    dir,
    draft(recipe, score, params) {
      save(
        'draft.blender.py',
        blender(recipe, [`route-A template draft, score ${score.toFixed(3)}`])
      );
      save('draft.parts.json', JSON.stringify(recipe, null, 2));
      save('params.json', JSON.stringify({ model, ...params }, null, 2));
    },
    round(e) {
      const n = `round-${e.round}`;
      save(`${n}.question.txt`, e.question);
      if (e.rawBody) save(`${n}.build.js`, wrapBuild(e.rawBody));
      if (e.recipe && e.rawBody) {
        save(`${n}.parts.json`, JSON.stringify(e.recipe, null, 2));
        save(
          `${n}.blender.py`,
          blender(
            e.recipe,
            [
              `round ${e.round}, model ${e.model ?? model}, score ${e.score === null ? 'n/a' : e.score.toFixed(3)}, ${e.kept ? 'KEPT' : 'dropped'}`,
              ...(e.issues.length ? [`dropped parts: ${e.issues.join('; ')}`] : []),
            ],
            e.rawBody
          )
        );
      }
      const meta = {
        round: e.round,
        model: e.model ?? model,
        kept: e.kept,
        score: e.score,
        baseScore: e.baseScore,
        reason: e.reason ?? null,
        bytes: e.bytes,
        dropped: e.issues,
        parts: e.recipe?.parts.length ?? 0,
        ms: e.ms,
        writeMs: e.writeMs,
        execMs: e.execMs,
        scoreMs: e.scoreMs,
        costUsd: e.costUsd ?? null,
      };
      save(`${n}.json`, JSON.stringify(meta, null, 2));
      summary.push(meta);
      save('summary.json', JSON.stringify(summary, null, 2));
    },
    final({ code, recipe, score }) {
      if (code) {
        save('final.build.js', wrapBuild(code));
        save(
          'final.blender.py',
          blender(recipe, [`FINAL model from code, score ${score.toFixed(3)}`], code)
        );
      } else {
        save('final.txt', 'No round beat the route-A draft: the editor shows draft.blender.py.\n');
      }
    },
  };
}
