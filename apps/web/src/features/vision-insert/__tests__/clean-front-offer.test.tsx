import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { CleanFrontOffer } from '../ui/clean-front-offer';

const show = (hidden: number | undefined, onDraw = vi.fn(), busy = false) =>
  render(
    <I18nProvider>
      <CleanFrontOffer hidden={hidden} onDraw={onDraw} busy={busy} />
    </I18nProvider>
  );

describe('CleanFrontOffer (PQ-T23)', () => {
  it('shows only from 30 % hidden, with the share, and draws on one tap', () => {
    const onDraw = vi.fn();
    show(0.4, onDraw);
    expect(screen.getByText(/40 % of this object is hidden/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Draw a clean front' });
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(onDraw).toHaveBeenCalledTimes(1);
  });

  it('shows nothing under 30 %, or with no measure', () => {
    const { container, unmount } = show(0.29);
    expect(container.textContent).toBe('');
    unmount();
    expect(show(undefined).container.textContent).toBe('');
  });

  it('is disabled while the drawing is being made', () => {
    show(0.5, vi.fn(), true);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
