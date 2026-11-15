import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { FacesState } from '../hooks/use-facade-faces';
import { FacadeFacesPanel } from '../ui/facade-faces-panel';

const idleFace = { status: 'idle', validated: false, userPrompt: '' } as const;
const ready = (name: string, validated = false) => ({
  status: 'ready' as const,
  imageUrl: `https://r2/${name}.png`,
  fileKey: name,
  validated,
  userPrompt: '',
});

const renderPanel = (faces: FacesState, props = {}) => {
  const handlers = {
    onGenerate: vi.fn(),
    onGenerateAll: vi.fn(),
    onDetailsChange: vi.fn(),
    onValidate: vi.fn(),
    onValidateAll: vi.fn(),
  };
  render(
    <I18nProvider>
      <FacadeFacesPanel faces={faces} {...handlers} {...props} />
    </I18nProvider>
  );
  return handlers;
};

describe('FacadeFacesPanel (PQ-T68)', () => {
  it('starts empty: three faces and the top view to draw, « Draw all views » draws them all', () => {
    const h = renderPanel({ side: idleFace, back: idleFace, left: idleFace, top: idleFace });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Draw this face' })).toHaveLength(4);
    expect(screen.getByText('Top view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Draw all views' }));
    expect(h.onGenerateAll).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Validate all views' })).toBeNull();
  });

  it('a drawn face is validated, redrawn with details, or un-validated on its own', () => {
    const h = renderPanel({
      side: ready('side'),
      back: ready('back', true),
      left: idleFace,
      top: idleFace,
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Validate' })[0]!);
    expect(h.onValidate).toHaveBeenCalledWith('side', true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo validation' }));
    expect(h.onValidate).toHaveBeenCalledWith('back', false);
    fireEvent.change(screen.getByLabelText('Details for the Right side face'), {
      target: { value: 'add a window' },
    });
    expect(h.onDetailsChange).toHaveBeenCalledWith('side', 'add a window');
    fireEvent.click(screen.getAllByRole('button', { name: 'Redraw this face' })[0]!);
    expect(h.onGenerate).toHaveBeenCalledWith('side');
    expect(screen.getByRole('img', { name: 'Back' })).toBeTruthy();
  });

  it('offers « Validate all views » once every view is drawn, and a busy panel locks the buttons', () => {
    const h = renderPanel({
      side: ready('side'),
      back: ready('back'),
      left: ready('left'),
      top: ready('top'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate all views' }));
    expect(h.onValidateAll).toHaveBeenCalled();
  });

  it('shows an error on a face that failed, with a way to redraw it', () => {
    renderPanel({
      side: { ...idleFace, status: 'error' },
      back: idleFace,
      left: idleFace,
      top: idleFace,
    });
    expect(screen.getByRole('alert').textContent).toContain('could not be drawn');
  });
});
