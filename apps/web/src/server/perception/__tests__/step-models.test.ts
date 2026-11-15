// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { env } from '@/lib/env';
import {
  resolveStepModel,
  STEP_MODEL_STEPS,
  stepModel,
  stepModelsLine,
  type StepModelEnv,
} from '../step-models';

const BASE: StepModelEnv = {
  base: 'muse-spark-1.3-contributor',
  refine: 'muse-spark-1.3-contributor',
  judge: 'muse-spark-1.3-contributor',
};

describe('step-models (PQ-T67)', () => {
  it('defaults every step to the contributor Spark, never Wonder', () => {
    for (const s of ['kit', 'parts', 'critic', 'viewsCheck', 'askPart'] as const) {
      expect(resolveStepModel(s, BASE)).toBe('muse-spark-1.3-contributor');
    }
    expect(resolveStepModel('code', BASE)).toBe('muse-spark-1.3-contributor');
    expect(resolveStepModel('judge', BASE)).toBe('muse-spark-1.3-contributor');
  });

  it('lets each override win over its default', () => {
    expect(resolveStepModel('kit', { ...BASE, kit: 'muse-wonder-1.0' })).toBe('muse-wonder-1.0');
    expect(resolveStepModel('parts', { ...BASE, parts: 'muse-wonder-1.0' })).toBe(
      'muse-wonder-1.0'
    );
    expect(resolveStepModel('critic', { ...BASE, critic: 'muse-wonder-1.0' })).toBe(
      'muse-wonder-1.0'
    );
    expect(resolveStepModel('viewsCheck', { ...BASE, viewsCheck: 'muse-wonder-1.0' })).toBe(
      'muse-wonder-1.0'
    );
    expect(resolveStepModel('askPart', { ...BASE, askPart: 'muse-wonder-1.0' })).toBe(
      'muse-wonder-1.0'
    );
    // The cheap experiment: Spark writes the code instead of Wonder.
    expect(resolveStepModel('code', { ...BASE, code: 'muse-spark-1.3' })).toBe('muse-spark-1.3');
  });

  it('prefers the stored choice over env on every step', () => {
    expect(resolveStepModel('kit', BASE, { kit: 'muse-wonder-1.0' })).toBe('muse-wonder-1.0');
    expect(resolveStepModel('code', BASE, { code: 'muse-spark-1.3' })).toBe('muse-spark-1.3');
    // Env override still applies where nothing is stored …
    expect(resolveStepModel('kit', { ...BASE, kit: 'muse-wonder-1.0' }, {})).toBe(
      'muse-wonder-1.0'
    );
    // … and the stored choice wins over it.
    expect(
      resolveStepModel('kit', { ...BASE, kit: 'muse-wonder-1.0' }, { kit: 'muse-spark-1.2' })
    ).toBe('muse-spark-1.2');
    expect(stepModelsLine(BASE, { code: 'muse-spark-1.3' })).toContain('code=muse-spark-1.3');
  });

  it('prints the whole map on one line', () => {
    const line = stepModelsLine(BASE);
    for (const s of STEP_MODEL_STEPS) expect(line).toContain(`${s}=`);
    expect(line).not.toContain('wonder');
    expect(line).toContain('kit=muse-spark-1.3-contributor');
  });

  it('reads the live env (defaults when no override is set)', () => {
    if (!process.env.META_KIT_MODEL) expect(stepModel('kit')).toBe(env.META_3D_MODEL);
    if (!process.env.META_CODE_MODEL) expect(stepModel('code')).toBe(env.META_REFINE_MODEL);
    expect(stepModel('judge')).toBe(env.META_JUDGE_MODEL);
    expect(stepModelsLine()).toContain('judge=');
  });
});
