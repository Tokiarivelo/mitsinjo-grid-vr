import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import { DetectionCanvas, type DetectionCanvasProps } from '../index';

const fridge: ApplianceDetection = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.06, y: 0.22, w: 0.2, h: 0.66 },
  outline: 'M0.06 0.22L0.26 0.22L0.26 0.88Z',
};
const tv: ApplianceDetection = {
  id: 'det-2',
  label: 'TV',
  category: 'tv',
  box: { x: 0.42, y: 0.3, w: 0.26, h: 0.24 },
};

function setup(props: Partial<DetectionCanvasProps> = {}) {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  const utils = render(
    <I18nProvider>
      <DetectionCanvas
        imageUrl="data:image/jpeg;base64,AA"
        status="ready"
        detections={[fridge, tv]}
        selectedId={null}
        onSelect={onSelect}
        onRetry={onRetry}
        {...props}
      />
    </I18nProvider>
  );
  const path = (id: string) => utils.container.querySelector(`path[data-detection="${id}"]`)!;
  return { ...utils, onSelect, onRetry, path };
}

describe('DetectionCanvas (PV-T7)', () => {
  it('draws the SAM outline, or the box when there is none, labelled as AI perception', () => {
    const { path } = setup();
    expect(path('det-1').getAttribute('d')).toBe(fridge.outline);
    expect(path('det-2').getAttribute('d')).toBe('M0.42 0.3H0.6799999999999999V0.54H0.42Z');
    expect(screen.getByText('AI perception · to verify')).toBeTruthy();
    expect(screen.getByText('Objects found (2)')).toBeTruthy();
  });

  it('hover on an outline highlights it and shows its label chip', () => {
    const { path } = setup();
    expect(screen.queryByText('TV · Television')).toBeNull();
    fireEvent.pointerEnter(path('det-2'));
    expect(screen.getByText('TV · Television')).toBeTruthy();
    expect(path('det-2').getAttribute('stroke-width')).toBe('3');
    fireEvent.pointerLeave(path('det-2'));
    expect(screen.queryByText('TV · Television')).toBeNull();
    // Label equal to its category: no repeated "Fridge · Fridge".
    fireEvent.pointerEnter(path('det-1'));
    expect(screen.queryByText('Fridge · Fridge')).toBeNull();
  });

  it('keyboard: focusing a list item highlights it; Enter/click selects', () => {
    const { onSelect } = setup();
    const item = screen.getByRole('button', { name: /TV\s*Television/ });
    fireEvent.focus(item);
    expect(screen.getByText('TV · Television')).toBeTruthy();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith('det-2');
  });

  it('tap on an outline selects; the selected item is marked', () => {
    const { onSelect, path } = setup({ selectedId: 'det-1' });
    fireEvent.click(path('det-2'));
    expect(onSelect).toHaveBeenCalledWith('det-2');
    expect(screen.getByRole('button', { name: /Fridge/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(path('det-1').getAttribute('stroke-width')).toBe('4');
    expect(path('det-1').getAttribute('class')).toContain('fill-(--mark)/35');
  });

  it('each object has its own colour, shared by its photo box and its list border', () => {
    const { path } = setup();
    const hue = (el: Element) => (el as HTMLElement).style.getPropertyValue('--mark-h');
    expect(hue(path('det-1'))).not.toBe(hue(path('det-2')));
    const row = screen.getByRole('button', { name: /TV\s*Television/ });
    expect(hue(row)).toBe(hue(path('det-2')));
    expect(row.getAttribute('class')).toContain('border-(--mark)');
    expect(path('det-2').getAttribute('class')).toContain('stroke-(--mark)');
  });

  it('empty result: message, no overlay', () => {
    const { container } = setup({ detections: [] });
    expect(screen.getByText('Nothing recognised on this photo.')).toBeTruthy();
    expect(container.querySelector('svg path[data-detection]')).toBeNull();
  });

  it('cancels a running analysis, then offers a retry (VS-T26)', () => {
    const onCancel = vi.fn();
    const { rerender, onRetry } = setup({ status: 'loading', detections: [], onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the analysis' }));
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(
      <I18nProvider>
        <DetectionCanvas
          imageUrl="data:image/jpeg;base64,AA"
          status="cancelled"
          detections={[]}
          selectedId={null}
          onSelect={vi.fn()}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      </I18nProvider>
    );
    expect(screen.getByText('Analysis cancelled.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel the analysis' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('can cancel while outlines refine; boxes stay', () => {
    const onCancel = vi.fn();
    setup({ status: 'refining', onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the analysis' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('error state: alert with retry', () => {
    const { onRetry } = setup({ status: 'error', detections: [] });
    expect(screen.getByRole('alert').textContent).toContain('Appliance detection failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('ready state: header retry button re-runs detection; hidden while loading', () => {
    const { onRetry, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Run detection again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(
      <I18nProvider>
        <DetectionCanvas
          imageUrl="data:image/jpeg;base64,AA"
          status="loading"
          detections={[]}
          selectedId={null}
          onSelect={() => {}}
          onRetry={() => {}}
        />
      </I18nProvider>
    );
    expect(screen.queryByRole('button', { name: 'Run detection again' })).toBeNull();
  });

  it('loading shows a status and no outlines; refining keeps outlines with a note; demo note', () => {
    const { rerender, container } = setup({ status: 'loading', detections: [] });
    expect(screen.getByRole('status').textContent).toContain('Looking for appliances…');
    rerender(
      <I18nProvider>
        <DetectionCanvas
          imageUrl="data:x"
          status="refining"
          detections={[fridge]}
          selectedId={null}
          onSelect={() => {}}
          isDemo
        />
      </I18nProvider>
    );
    expect(screen.getByText('Refining outlines…')).toBeTruthy();
    expect(screen.getByText(/Demo detections/)).toBeTruthy();
    expect(container.querySelectorAll('path[data-detection]')).toHaveLength(1);
  });

  it('scenery (house, car…) is outlined with a lighter fill, tagged « No load », still selectable', () => {
    const house: ApplianceDetection = {
      id: 'det-3',
      label: 'Stone house',
      kind: 'scenery',
      category: 'other',
      scenery: 'building',
      box: { x: 0.2, y: 0.2, w: 0.5, h: 0.4 },
    };
    const { path, onSelect } = setup({ detections: [fridge, house] });
    expect(path('det-3').getAttribute('class')).toContain('fill-(--mark)/5');
    expect(path('det-1').getAttribute('class')).toContain('fill-(--mark)/10');
    const item = screen.getByRole('button', { name: /Stone house\s*Building\s*No load/ });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith('det-3');
  });

  it('regression: a small box under a big one is drawn on top and can be picked, a 2nd click goes under', () => {
    const house: ApplianceDetection = {
      id: 'det-9',
      label: 'House',
      kind: 'scenery',
      category: 'other',
      scenery: 'building',
      box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    };
    const lamp: ApplianceDetection = {
      id: 'det-10',
      label: 'Lamp post',
      category: 'lamp',
      box: { x: 0.44, y: 0.48, w: 0.02, h: 0.11 },
    };
    // The big house comes AFTER the lamp in the list: it used to cover it.
    const { container, onSelect, path, rerender } = setup({ detections: [lamp, house] });
    const order = [...container.querySelectorAll('path[data-detection]')].map((p) =>
      p.getAttribute('data-detection')
    );
    expect(order).toEqual(['det-9', 'det-10']);
    const svg = (path('det-9') as SVGPathElement).ownerSVGElement!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 }) as DOMRect;
    // Click on the lamp spot, even if the event lands on the house path.
    fireEvent.click(path('det-9'), { clientX: 450, clientY: 530 });
    expect(onSelect).toHaveBeenLastCalledWith('det-10');
    rerender(
      <I18nProvider>
        <DetectionCanvas
          imageUrl="data:image/jpeg;base64,AA"
          status="ready"
          detections={[lamp, house]}
          selectedId="det-10"
          onSelect={onSelect}
        />
      </I18nProvider>
    );
    fireEvent.click(path('det-10'), { clientX: 450, clientY: 530 });
    expect(onSelect).toHaveBeenLastCalledWith('det-9');
    // Colours still follow the list order, not the paint order.
    const row = screen.getByRole('button', { name: /Lamp post/ });
    expect((row as HTMLElement).style.getPropertyValue('--mark-h')).toBe(
      (path('det-10') as unknown as HTMLElement).style.getPropertyValue('--mark-h')
    );
  });
});
