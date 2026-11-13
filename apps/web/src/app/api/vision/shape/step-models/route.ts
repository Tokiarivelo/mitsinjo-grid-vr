import 'server-only';

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  STEP_MODEL_OPTIONS,
  STEP_MODEL_STEPS,
  StepModelsSelectionSchema,
  type StepModelsSelection,
  type StepModelStep,
} from '@/lib/step-models';
import { getShapeStepModels, saveShapeStepModels } from '@/server/db/neon';
import { stepModel } from '@/server/perception/step-models';
import { jsonResponse } from '@/server/perception/vision-request';

/**
 * Per-step 3D model choice (PQ-T67). `GET ?scope=` → `{ defaults, models, selection }`:
 * env-resolved default per step, offered model ids, stored choice (null = defaults
 * everywhere). `PUT { scope?, selection }` stores the choice (`shape_step_models`,
 * `scope` = session id or `global`); the next generation uses it. 400 on invalid input.
 */

const scopeOf = (scope: unknown): string | null =>
  typeof scope === 'string' && scope.length >= 1 && scope.length <= 128 ? scope : null;

/** Env-resolved default of every step (what a missing choice means). */
function stepDefaults(): Record<StepModelStep, string> {
  return Object.fromEntries(STEP_MODEL_STEPS.map((s) => [s, stepModel(s)])) as Record<
    StepModelStep,
    string
  >;
}

export async function GET(req: NextRequest) {
  const scope = scopeOf(req.nextUrl.searchParams.get('scope')) ?? 'global';
  const selection = await getShapeStepModels(scope).catch(() => null);
  return jsonResponse({
    defaults: stepDefaults(),
    models: [...STEP_MODEL_OPTIONS],
    selection,
  });
}

const PutBodySchema = z.object({
  scope: z.string().min(1).max(128).optional(),
  selection: StepModelsSelectionSchema,
});

export async function PUT(req: NextRequest) {
  let raw: unknown = null;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    raw = null;
  }
  const body = PutBodySchema.safeParse(raw);
  if (!body.success) return jsonResponse({ error: 'Invalid selection' }, 400);
  const scope = body.data.scope ?? 'global';
  let selection: StepModelsSelection;
  try {
    selection = await saveShapeStepModels(scope, body.data.selection);
  } catch {
    return jsonResponse({ error: 'Could not save' }, 500);
  }
  return jsonResponse({ selection });
}
