import 'server-only';

import { env } from '@/lib/env';
import { STEP_MODEL_STEPS, type StepModelsSelection, type StepModelStep } from '@/lib/step-models';

export { STEP_MODEL_STEPS, type StepModelStep };

/**
 * One model id per 3D vision step (PQ-T67): Wonder writes the best code but spends the most
 * tokens, so each step takes the operator's stored choice when set (`shape_step_models`),
 * else its `META_*_MODEL` override, else the cheap default (`META_3D_MODEL`, the contributor
 * Spark; code / judge: `META_REFINE_MODEL` / `META_JUDGE_MODEL`, contributor Spark too). Detection and chat Q&A (`analyzeImage`,
 * `detectAppliances`, `identifyRegion`) stay on `META_VISION_MODEL`: they are not 3D steps
 * and are never asked of Wonder.
 */

/** The env ids one step resolves from (pure input of `resolveStepModel`, tested without env). */
export interface StepModelEnv {
  /** Default of the seeing steps (`META_3D_MODEL`). */
  base: string;
  refine: string;
  judge: string;
  kit?: string;
  parts?: string;
  critic?: string;
  viewsCheck?: string;
  askPart?: string;
  code?: string;
}

/** Model id serving `step`: stored choice, else env override, else family default. */
export function resolveStepModel(
  step: StepModelStep,
  e: StepModelEnv,
  overrides: StepModelsSelection = {}
): string {
  const chosen = overrides[step];
  if (chosen) return chosen;
  switch (step) {
    case 'kit':
      return e.kit ?? e.base;
    case 'parts':
      return e.parts ?? e.base;
    case 'critic':
      return e.critic ?? e.base;
    case 'viewsCheck':
      return e.viewsCheck ?? e.base;
    case 'askPart':
      return e.askPart ?? e.base;
    case 'code':
      return e.code ?? e.refine;
    case 'judge':
      return e.judge;
  }
}

const liveEnv = (): StepModelEnv => ({
  base: env.META_3D_MODEL,
  refine: env.META_REFINE_MODEL,
  judge: env.META_JUDGE_MODEL,
  ...(env.META_KIT_MODEL ? { kit: env.META_KIT_MODEL } : {}),
  ...(env.META_PARTS_MODEL ? { parts: env.META_PARTS_MODEL } : {}),
  ...(env.META_CRITIC_MODEL ? { critic: env.META_CRITIC_MODEL } : {}),
  ...(env.META_VIEWSCHECK_MODEL ? { viewsCheck: env.META_VIEWSCHECK_MODEL } : {}),
  ...(env.META_ASKPART_MODEL ? { askPart: env.META_ASKPART_MODEL } : {}),
  ...(env.META_CODE_MODEL ? { code: env.META_CODE_MODEL } : {}),
});

/** Live model id serving `step` (reads `env`, then the stored choice). */
export function stepModel(step: StepModelStep, overrides: StepModelsSelection = {}): string {
  return resolveStepModel(step, liveEnv(), overrides);
}

/** `kit=…, parts=…, …`: the whole step → model map on one log line. */
export function stepModelsLine(
  e: StepModelEnv = liveEnv(),
  overrides: StepModelsSelection = {}
): string {
  return STEP_MODEL_STEPS.map((s) => `${s}=${resolveStepModel(s, e, overrides)}`).join(', ');
}

let logged = false;

/** The step → model map, once per process (first Meta backend built). */
export function logStepModelsOnce(): void {
  if (logged) return;
  logged = true;
  console.info(`[vision] 3D step models: ${stepModelsLine()}`);
}
