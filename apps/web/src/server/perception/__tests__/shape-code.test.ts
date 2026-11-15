// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { env } from '@/lib/env';
import {
  buildCodeQuestion,
  CODE_JSON_SCHEMA,
  CODE_PROMPT_GENERIC_VERSION,
  CODE_PROMPT_MODELER_VERSION,
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
    expect(CODE_PROMPT_VERSION).toBe(3);
    expect(CODE_JSON_SCHEMA.schema.required).toEqual(['code']);
  });

  it('versions the prompt and defaults the model to the refine model', () => {
    expect(codePrompt()).toContain('build(api, params)');
    expect(codePrompt(3)).toBe(codePrompt());
    expect(() => codePrompt(99)).toThrow(/unknown code prompt version/);
    if (!process.env.META_CODE_MODEL) expect(codeModel()).toBe(env.META_REFINE_MODEL);
  });

  it('keeps v1 house-only and offers the generic v2 (PQ-T55)', () => {
    const v1 = codePrompt(1);
    expect(v1).toMatch(/House rules/);
    expect(v1).not.toMatch(/generator/);
    const v2 = codePrompt(CODE_PROMPT_GENERIC_VERSION);
    expect(v2).not.toBe(v1);
    expect(v2).toContain('build(api, params)');
    for (const section of ['HOUSE:', 'VEHICLE:', 'PLANT:', 'TECHNICAL']) {
      expect(v2).toContain(section);
    }
    for (const op of ['sweep', 'branch', 'scatter', 'drape', 'loft', 'inset', 'blobs']) {
      expect(v2).toContain(op);
    }
    expect(v2).toMatch(/no watt/);
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

  it('names the archetype beside the label when given (PQ-T55)', () => {
    const draft = {
      proportions: { w: 1, h: 0.8, d: 0.6 },
      parts: [],
      source: 'kit' as const,
    };
    const withArch = buildCodeQuestion({
      label: 'willow',
      archetype: 'tree',
      draft,
      scoreText: '0.5',
    });
    expect(withArch).toMatch(/willow \(tree\)/);
    const without = buildCodeQuestion({ label: 'willow', draft, scoreText: '0.5' });
    expect(without).toMatch(/Object: willow\. Draft/);
  });
});

describe('modeler prompt v3 (PQ-T58)', () => {
  it('is the live default and teaches the modeller order from the measured frame', () => {
    const v3 = codePrompt();
    expect(v3).toBe(codePrompt(CODE_PROMPT_MODELER_VERSION));
    for (const step of ['LOOK', 'COARSE FIRST', 'SECONDARY FORMS', 'DETAILS', 'CHECK']) {
      expect(v3).toContain(step);
    }
    expect(v3).toMatch(/multi-volume|several blocks/);
    expect(v3).toContain('extrude');
    expect(v3).toMatch(/no watt/);
  });
});

describe('silhouetteFrameText (PQ-T61)', () => {
  it('gives any object its outline and parts in object units; the side view maps to depth', async () => {
    const { silhouetteFrameText } = await import('../shape-code');
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    const parts = [{ concept: 'wheel', box: { x: 0.1, y: 0.7, w: 0.2, h: 0.3 } }];
    const front = silhouetteFrameText('front', ring, parts);
    expect(front).toContain('[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]');
    expect(front).toContain('wheel at [-0.3, -0.35] size [0.2, 0.3]');
    const side = silhouetteFrameText('side', ring, parts);
    // Side view: the front of the object is on the left, so x 0.2 → z +0.3.
    expect(side).toContain('wheel at [0.3, -0.35]');
    expect(side).toContain('[z, y]');
    expect(silhouetteFrameText('photo', ring, [])).toContain('measured on the photo');
  });
});
