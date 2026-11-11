import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ShapeImprove } from '../hooks/use-object-shape';
import { IMPROVE_FADE_MS, ImproveChip, improveProgress, scoreKey } from '../ui/improve-chip';

const running: ShapeImprove = { status: 'running', index: 3, total: 4, stage: 'openings' };
const chip = (improve?: ShapeImprove) =>
  render(
    <I18nProvider>
      <ImproveChip improve={improve} />
    </I18nProvider>
  );

afterEach(() => vi.useRealTimers());

describe('ImproveChip (PG-T18)', () => {
  it('running: names the stage, shows progress and the score once the stage ended', () => {
    const { rerender } = chip(running);
    expect(screen.getByText('Improving: stage 3/4 — Openings')).toBeTruthy();
    expect(
      screen
        .getByRole('progressbar', { name: 'Model improvement progress' })
        .getAttribute('aria-valuenow')
    ).toBe('50');
    rerender(
      <I18nProvider>
        <ImproveChip improve={{ ...running, before: 0.62, after: 0.81 }} />
      </I18nProvider>
    );
    expect(screen.getByText('Stage score 62% → 81%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75');
  });

  it('an unchanged stage says why (before: « Stage score 97% → 97% » looked like a stuck stage)', () => {
    const { rerender } = chip({ ...running, before: 0.97, after: 0.97, stop: 'gate' });
    expect(screen.getByText('Stage already matches the drawing (97%)')).toBeTruthy();
    rerender(
      <I18nProvider>
        <ImproveChip improve={{ ...running, before: 0.75, after: 0.75, stop: 'no_gain' }} />
      </I18nProvider>
    );
    expect(screen.getByText('No better change found (75%)')).toBeTruthy();
  });

  it('scoreKey: before → after when the score moved, whatever the stop', () => {
    expect(scoreKey({ ...running, before: 0.68, after: 0.95, stop: 'gate' })).toBe('score');
    expect(scoreKey({ ...running, before: 0.8, after: 0.8, stop: 'rounds' })).toBe('noGain');
    expect(scoreKey({ ...running, before: 0.8, after: 0.8, stop: 'timeout' })).toBe('score');
    // PQ-T38 stops: a stage ended on a repeat or a back-and-forth with no gain reads « no gain ».
    expect(scoreKey({ ...running, before: 0.8, after: 0.8, stop: 'repeat' })).toBe('noGain');
    expect(scoreKey({ ...running, before: 0.8, after: 0.8, stop: 'back_and_forth' })).toBe(
      'noGain'
    );
    expect(scoreKey({ ...running, before: 0.8, after: 0.9, stop: 'repeat' })).toBe('score');
    expect(scoreKey(running)).toBe('score');
  });

  it('done: « Model finalised », then fades out', () => {
    vi.useFakeTimers();
    chip({ ...running, status: 'done', index: 4 });
    expect(screen.getByText('Model finalised')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => vi.advanceTimersByTime(IMPROVE_FADE_MS + 10));
    expect(screen.queryByText('Model finalised')).toBeNull();
  });

  it('stopped: says why; nothing without an improvement; announced politely', () => {
    const { container } = chip({ ...running, status: 'stopped', cause: 'timeout' });
    expect(screen.getByText('Improvement stopped: time is up')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    const empty = chip(undefined);
    expect(empty.container.textContent).toBe('');
  });

  it('progress share: stages ended over the total, full when final', () => {
    expect(improveProgress({ ...running, index: 1 })).toBe(0);
    expect(improveProgress({ ...running, index: 1, after: 0.5 })).toBe(0.25);
    expect(improveProgress({ ...running, status: 'done' })).toBe(1);
  });

  it('« Cancel » while it runs (no time limit), none once it ended or without a handler', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <ImproveChip improve={running} onCancel={onCancel} />
      </I18nProvider>
    );
    act(() => screen.getByRole('button', { name: 'Cancel the model improvement' }).click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <I18nProvider>
        <ImproveChip
          improve={{ ...running, status: 'stopped', cause: 'aborted' }}
          onCancel={onCancel}
        />
      </I18nProvider>
    );
    expect(screen.getByText('Improvement stopped: cancelled')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <I18nProvider>
        <ImproveChip improve={running} />
      </I18nProvider>
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
