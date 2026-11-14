import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SurfaceEditor, type SurfaceEditorProps } from '../ui/surface-editor';
import { MATERIAL_COLOR, surfaceColor } from '../utils/face-projection';

const renderEditor = (props: Partial<SurfaceEditorProps> = {}) => {
  const handlers = { onSelect: vi.fn(), onChange: vi.fn() };
  render(
    <I18nProvider>
      <SurfaceEditor surfaces={{}} selected={null} {...handlers} {...props} />
    </I18nProvider>
  );
  return handlers;
};

describe('SurfaceEditor (PQ-T71)', () => {
  it('lists the roof and the four walls; picking one selects it, picking it again clears', () => {
    const h = renderEditor();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Roof',
      'Front',
      'Right side',
      'Back',
      'Left side',
    ]);
    // Nothing to edit until a surface is picked.
    expect(screen.queryByRole('button', { name: 'Material' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Roof' }));
    expect(h.onSelect).toHaveBeenCalledWith('roof');
  });

  it('a surface left on its drawing can be tinted or given a material (tiles first on a roof)', () => {
    const h = renderEditor({ selected: 'roof' });
    expect(screen.getByRole('radio', { name: 'Roof' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Drawing' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.queryByRole('button', { name: 'Back to the drawing' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Material' }));
    expect(h.onChange).toHaveBeenCalledWith('roof', { material: 'tile' });
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#ffddcc' } });
    expect(h.onChange).toHaveBeenLastCalledWith('roof', { color: '#ffddcc' });
  });

  it('a material surface changes material and colour, and goes back to its drawing', () => {
    const h = renderEditor({
      selected: 'roof',
      surfaces: { roof: { material: 'tile', color: '#aa4422' } },
    });
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'slate' } });
    expect(h.onChange).toHaveBeenLastCalledWith('roof', { material: 'slate', color: '#aa4422' });
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#112233' } });
    expect(h.onChange).toHaveBeenLastCalledWith('roof', { material: 'tile', color: '#112233' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the drawing' }));
    expect(h.onChange).toHaveBeenLastCalledWith('roof', null);
    fireEvent.click(screen.getByRole('button', { name: 'Drawing' }));
    expect(h.onChange).toHaveBeenLastCalledWith('roof', null);
  });

  it('shows a material in its default colour until the operator colours it', () => {
    expect(surfaceColor(undefined)).toBeNull();
    expect(surfaceColor({ material: 'slate' })).toBe(MATERIAL_COLOR.slate);
    expect(surfaceColor({ material: 'slate', color: '#123456' })).toBe('#123456');
    expect(surfaceColor({ color: '#abcdef' })).toBe('#abcdef');
  });
});
