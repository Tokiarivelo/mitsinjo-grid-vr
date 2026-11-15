import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ObjectShape } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import type { StudioControls } from '../utils/studio';

/** The 3D view stands in: it reports the model's pieces and keeps the last studio controls. */
const seen: { studio?: StudioControls } = {};
vi.mock('../ui/lazy-object-editor-3d', () => ({
  LazyObjectEditor3d: ({ studio }: { studio: StudioControls }) => {
    seen.studio = studio;
    useEffect(() => studio.onPieces(['roof', 'glass', 'tyre']), [studio]);
    return <div data-testid="viewer" />;
  },
  ViewerSkeleton: () => null,
}));
import { ObjectStudio } from '../ui/object-studio';

const shape = {
  detectionId: 'd1',
  mode: 'recipe',
  recipe: { proportions: { w: 1, h: 1, d: 1 }, parts: [] },
} as unknown as ObjectShape;
const detection = {
  id: 'd1',
  label: 'car',
  category: 'other',
  confidence: 1,
  box: { x: 0, y: 0, w: 1, h: 1 },
} as ApplianceDetection;

function renderStudio() {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <ObjectStudio
        shape={shape}
        detection={detection}
        label="Car"
        imageUrl="data:,"
        onChange={onChange}
        onClose={onClose}
      />
    </I18nProvider>
  );
  return { onChange, onClose };
}

describe('ObjectStudio (3D Studio, PQ-T77)', () => {
  it('lists the pieces as layers; the eye hides one, undo brings it back', () => {
    const { onChange } = renderStudio();
    const layers = screen.getByRole('region', { name: 'Layers' });
    expect(within(layers).getByRole('button', { name: 'Roof' })).toBeInTheDocument();
    expect(within(layers).getByRole('button', { name: 'Tyres' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Visible: Tyres' }));
    expect(onChange).toHaveBeenLastCalledWith({ tyre: { hidden: true } });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ tyre: { hidden: true } });
  });

  it('selects a piece, masks it like a layer and hides it with H; Esc closes', () => {
    const { onChange, onClose } = renderStudio();
    expect(screen.getByText(/Select a piece to mask/)).toBeInTheDocument();
    act(() => seen.studio!.onSelect('glass'));
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    expect(onChange).toHaveBeenLastCalledWith({ glass: { mask: { box: [0, 1, 0, 1, 0, 1] } } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invert (hide inside)' }));
    expect(onChange.mock.lastCall![0].glass.mask.invert).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete mask' }));
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.keyDown(window, { key: 'h' });
    expect(onChange).toHaveBeenLastCalledWith({ glass: { hidden: true } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('switches tools and views by key and toolbar; a gizmo drag becomes an edit', () => {
    const { onChange } = renderStudio();
    fireEvent.keyDown(window, { key: 'g' });
    expect(seen.studio!.tool).toBe('move');
    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }));
    expect(seen.studio!.viewMode).toBe('wireframe');
    const n = seen.studio!.camera.n;
    fireEvent.keyDown(window, { key: '7' });
    expect(seen.studio!.camera).toEqual({ view: 'top', n: n + 1 });
    act(() => seen.studio!.onTransform('roof', { offset: [0, 0.2, 0] }));
    expect(onChange).toHaveBeenLastCalledWith({ roof: { offset: [0, 0.2, 0] } });
  });
});
