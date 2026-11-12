// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { env } from '@/lib/env';
import {
  buildCodeQuestion,
  CODE_JSON_SCHEMA,
  CODE_PROMPT_VERSION,
  codeModel,
  codePrompt,
  parseBuildCode,
} from '../shape-code';
import { CODE_MAX_BYTES } from '../code-sandbox';

describe('shape-code (PQ-T45)', () => {
  it('parses the writer answer leniently', () => {
    expect(parseBuildCode(JSON.stringify({ code: '  return [];  ' }))).toBe('return [];');
    expect(parseBuildCode('not json')).toBeNull();
    expect(parseBuildCode(JSON.stringify({ code: '   ' }))).toBeNull();
    expect(parseBuildCode(JSON.stringify({}))).toBeNull();
    expect(parseBuildCode(JSON.stringify({ code: 42 }))).toBeNull();
    expect(parseBuildCode(JSON.stringify({ code: 'x'.repeat(CODE_MAX_BYTES + 1) }))).toBeNull();
    expect(CODE_PROMPT_VERSION).toBe(1);
    expect(CODE_JSON_SCHEMA.schema.required).toEqual(['code']);
  });

  it('versions the prompt and defaults the model to the refine model', () => {
    expect(codePrompt()).toContain('build(api, params)');
    expect(codePrompt(1)).toBe(codePrompt());
    expect(() => codePrompt(99)).toThrow(/unknown code prompt version/);
    if (!process.env.META_CODE_MODEL) expect(codeModel()).toBe(env.META_REFINE_MODEL);
  });

  it('builds the writer question from the draft, score and measures', () => {
    const q = buildCodeQuestion({
      label: 'cottage',
      draft: {
        proportions: { w: 1, h: 0.8, d: 0.6 },
        parts: [
          {
            shape: 'box',
            at: [0, 0, 0],
            size: [0.8, 0.6, 0.5],
            color: '#d8cfc0',
            kind: 'wall',
          },
        ],
        source: 'facade',
      },
      scoreText: '0.812',
      detailText: 'recall 0.7',
      measuresText: 'overhang 0.04',
      currentCode: 'return [];',
      droppedText: '2: color: Invalid',
    });
    expect(q).toMatch(/cottage/);
    expect(q).toMatch(/0\.812/);
    expect(q).toMatch(/recall 0\.7/);
    expect(q).toMatch(/overhang 0\.04/);
    expect(q).toMatch(/Current code/);
    expect(q).toMatch(/2: color: Invalid/);
    expect(q).toMatch(/#d8cfc0/);
  });
});
