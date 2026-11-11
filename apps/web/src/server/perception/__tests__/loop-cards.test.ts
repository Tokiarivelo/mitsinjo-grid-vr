import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  SHAPE_SCRIPT_CARDS_VERSION,
  SHAPE_SCRIPT_PROMPT_VERSION,
  shapeScriptSystemPrompt,
  stageQuestion,
} from '../shape-script-prompt';
import {
  VIEWS_CHECK_CARDS_VERSION,
  VIEWS_CHECK_PROMPT_VERSION,
  VIEWS_CHECK_SYSTEM_PROMPT,
  viewsCheckPrompt,
} from '../views-check';

describe('cards in the loop calls (PQ-T15)', () => {
  it('stage prompt: the card only when asked, version changed', () => {
    const plain = shapeScriptSystemPrompt('elevation');
    const carded = shapeScriptSystemPrompt('elevation', true);
    expect(carded.startsWith(plain)).toBe(true);
    expect(carded).toContain('How to choose ops for this stage');
    expect(plain).not.toContain('How to choose ops for this stage');
    expect(SHAPE_SCRIPT_CARDS_VERSION).not.toBe(SHAPE_SCRIPT_PROMPT_VERSION);
  });

  it('views check: the card only when asked, version changed', () => {
    expect(viewsCheckPrompt()).toBe(VIEWS_CHECK_SYSTEM_PROMPT);
    expect(viewsCheckPrompt(VIEWS_CHECK_CARDS_VERSION)).toContain('redrawSide = true only when');
    expect(VIEWS_CHECK_CARDS_VERSION).not.toBe(VIEWS_CHECK_PROMPT_VERSION);
  });

  it('final stage question: the Final check card replaces the short line', () => {
    const q = {
      label: 'house',
      stage: 'final',
      round: 1,
      score: { stage: 0.9, overall: 0.9 },
      components: [],
      editable: [],
    };
    expect(stageQuestion(q)).toContain('Final check: every earlier stage is done');
    const carded = stageQuestion({ ...q, cards: true });
    expect(carded).toContain('last check before the operator');
    expect(carded).not.toContain('Final check: every earlier stage is done');
    expect(stageQuestion({ ...q, stage: 'roof', cards: true })).not.toContain('last check');
  });
});
