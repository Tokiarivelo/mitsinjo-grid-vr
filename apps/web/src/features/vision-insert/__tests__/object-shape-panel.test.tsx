import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ObjectShape } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';

const webgl = vi.hoisted(() => ({ on: true }));
vi.mock('@/features/microgrid-3d', () => ({ useWebGLAvailable: () => webgl.on }));

const facadeMock = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'generating' | 'ready' | 'deleting' | 'error',
  facade: undefined as
    | {
        imageUrl: string;
        fileKey: string;
        prompt: string;
        archetype: string;
        detectionId: string;
        source: 'meta' | 'mock';
      }
    | undefined,
  userPrompt: '',
  setUserPrompt: vi.fn(),
  generate: vi.fn(),
  retry: vi.fn(),
  deleteFacade: vi.fn(),
  validate: vi.fn(),
}));

vi.mock('../hooks/use-facade-2d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-facade-2d')>();
  return {
    ...actual,
    useFacade2d: () => ({
      status: facadeMock.status,
      facade: facadeMock.facade,
      userPrompt: facadeMock.userPrompt,
      setUserPrompt: facadeMock.setUserPrompt,
      generate: facadeMock.generate,
      retry: facadeMock.retry,
      deleteFacade: facadeMock.deleteFacade,
      validate: facadeMock.validate,
    }),
  };
});
vi.mock('../ui/object-editor-3d', () => ({
  ObjectEditor3d: ({
    shape,
    scale,
    tint,
  }: {
    shape: ObjectShape;
    scale?: number;
    tint?: string | null;
  }) => (
    <div data-mode={shape.mode} data-scale={scale ?? 1} data-tint={tint ?? ''}>
      viewer
    </div>
  ),
}));

import { ObjectShapePanel } from '../ui/object-shape-panel';

const fridge: ApplianceDetection = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.5 },
};
const shape = (
  mode: ObjectShape['mode'],
  id = 'det-1',
  reason: NonNullable<ObjectShape['reason']> = 'no_body'
): ObjectShape => ({
  detectionId: id,
  mode,
  ...(mode === 'recipe'
    ? {
        recipe: {
          proportions: { w: 0.5, h: 1, d: 0.5 },
          parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#eeeeee' }],
        },
      }
    : { reason }),
  source: 'meta',
  model: 'muse-spark-1.3',
});

const renderPanel = (props: Partial<Parameters<typeof ObjectShapePanel>[0]> = {}) =>
  render(
    <I18nProvider>
      <ObjectShapePanel
        status="ready"
        shape={shape('recipe')}
        viewsStatus="idle"
        detection={fridge}
        label="Fridge"
        imageUrl="data:image/png;base64,AA"
        {...props}
      />
    </I18nProvider>
  );

describe('ObjectShapePanel (PV-T10)', () => {
  it('idle: « Not built yet », the 2D facade comes first, no 3D shortcut, no viewer', () => {
    const onGenerate = vi.fn();
    renderPanel({ status: 'idle', shape: undefined, onGenerate });
    expect(screen.getByText('Not built yet')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Imagine 2D facade' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generate the 3D model' })).toBeNull();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('the viewer sits on the studio backdrop (lighter than dark objects in both themes)', () => {
    renderPanel();
    expect(screen.getByRole('img', { name: '3D model of Fridge' }).className).toContain(
      'viewer-studio'
    );
  });

  it('loading: says the model is being built, no viewer yet', () => {
    renderPanel({ status: 'loading', shape: undefined });
    expect(screen.getByText('Building the 3D model…')).toBeTruthy();
    expect(screen.queryByText('viewer')).toBeNull();
  });

  it('loading shows the AI steps: done, current (with seconds and wait hint), to do', () => {
    renderPanel({ status: 'loading', shape: undefined, step: 'model', startedAt: Date.now() });
    const steps = screen.getByRole('list', { name: 'AI steps for the 3D model' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('Extracting the object');
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[1]!.textContent).toMatch(/Muse Spark imagines the parts.*0 s/);
    expect(items[2]!.getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByText(
        /usually needs 15 to 40 s \(limit 60 s\); a house or any object rebuilt from its 2D view, checked by the AI, up to 90 s/
      )
    ).toBeTruthy();
  });

  it('the AI check joins the steps when it starts (views path)', () => {
    renderPanel({ status: 'loading', shape: undefined, step: 'check', startedAt: Date.now() });
    const steps = screen.getByRole('list', { name: 'AI steps for the 3D model' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[3]!.getAttribute('aria-current')).toBe('step');
    expect(items[3]!.textContent).toContain('checks every side against the drawings');
  });

  it('recipe: AI badge, labelled viewer and the orbit hint', async () => {
    renderPanel();
    expect(screen.getByText('AI shape')).toBeTruthy();
    expect(screen.getByRole('img', { name: '3D model of Fridge' })).toBeTruthy();
    expect((await screen.findByText('viewer')).getAttribute('data-mode')).toBe('recipe');
    expect(screen.getByText('Drag to turn · pinch or scroll to zoom')).toBeTruthy();
  });

  it('recipe with part masks: parts seen vs built, missing ones flagged (PQ-T37)', () => {
    renderPanel({
      shape: {
        ...shape('recipe'),
        coverage: [
          { concept: 'wheel', seen: 2, built: 2 },
          { concept: 'window', seen: 3, built: 1 },
        ],
      },
    });
    expect(screen.getByText('Parts seen on the photo:')).toBeTruthy();
    expect(screen.getByText(/Wheels 2\/2/)).toBeTruthy();
    expect(screen.getByText(/Windows 1\/3/)).toBeTruthy();
    expect(screen.getByText('not built: 2')).toBeTruthy();
    expect(screen.queryByText(/not built: 0/)).toBeNull();
  });

  it('a SAM concept without a label is left out, never shown as a raw key (PR #10 review)', () => {
    renderPanel({
      shape: {
        ...shape('recipe'),
        coverage: [
          { concept: 'wheel', seen: 2, built: 2 },
          { concept: 'mirror', seen: 1, built: 0 },
        ],
      },
    });
    expect(screen.getByText(/Wheels 2\/2/)).toBeTruthy();
    expect(screen.queryByText(/model3dPart|mirror/)).toBeNull();
  });

  it('small or blurred photo: a hint; a good photo: none (PQ-T7)', () => {
    renderPanel({
      shape: { ...shape('recipe'), conditions: { widthPx: 90, heightPx: 120, sharpness: 'high' } },
    });
    expect(screen.getByText(/Object too small on the photo/)).toBeTruthy();
  });

  it('blurred photo hint (PQ-T7)', () => {
    renderPanel({
      shape: { ...shape('recipe'), conditions: { widthPx: 400, heightPx: 300, sharpness: 'low' } },
    });
    expect(screen.getByText(/Photo blurred/)).toBeTruthy();
  });

  it('good photo: no hint (PQ-T7)', () => {
    renderPanel({
      shape: { ...shape('recipe'), conditions: { widthPx: 400, heightPx: 300, sharpness: 'high' } },
    });
    expect(screen.queryByText(/too small|blurred/)).toBeNull();
  });

  it('no part masks: no parts line', () => {
    renderPanel();
    expect(screen.queryByText('Parts seen on the photo:')).toBeNull();
  });

  it('silhouette: outline badge, why, and a retry button', async () => {
    const onRetry = vi.fn();
    renderPanel({ shape: shape('silhouette'), onRetry });
    expect(screen.getByText('Outline shape')).toBeTruthy();
    expect(
      screen.getByText("The AI shape could not be built: shown from the object's outline.")
    ).toBeTruthy();
    expect((await screen.findByText('viewer')).getAttribute('data-mode')).toBe('silhouette');
    fireEvent.click(screen.getByRole('button', { name: 'Try the AI shape again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('each fallback says its own cause; recipe mode has no retry', () => {
    const cases: Array<[NonNullable<ObjectShape['reason']>, RegExp]> = [
      ['provider_error', /The Meta model did not answer/],
      ['timeout', /Muse Spark took more than 60 s/],
      ['spend_cap', /spend cap is reached/],
      ['network', /app server could not be reached/],
    ];
    for (const [reason, text] of cases) {
      const { unmount } = renderPanel({
        shape: shape('silhouette', 'det-1', reason),
        onRetry: () => {},
      });
      expect(screen.getByText(text)).toBeTruthy();
      unmount();
    }
    const { unmount } = renderPanel({
      shape: { ...shape('silhouette', 'det-1', 'provider_error'), detail: 'http_429' },
    });
    expect(screen.getByText('Cause: HTTP 429')).toBeTruthy();
    unmount();
    renderPanel({ onRetry: () => {} });
    expect(screen.queryByRole('button', { name: 'Try the AI shape again' })).toBeNull();
  });

  it('a shape for another object is not shown (no stale model)', () => {
    renderPanel({ shape: shape('recipe', 'det-9') });
    expect(screen.getByText('Not built yet')).toBeTruthy();
    expect(screen.queryByText('viewer')).toBeNull();
  });

  it('no WebGL: a note instead of the viewer', () => {
    webgl.on = false;
    renderPanel();
    expect(
      screen.getByText('The 3D view needs WebGL. The photo stays the reference.')
    ).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    webgl.on = true;
  });

  it('recipe: shows « Regenerate the 3D model » when onRegenerate is provided', () => {
    const onRegenerate = vi.fn();
    renderPanel({ onRegenerate });
    const btn = screen.getByRole('button', { name: 'Regenerate the 3D model' });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('ready with facade: tabs switch between the 3D model and 2D facade', () => {
    facadeMock.status = 'ready';
    facadeMock.facade = {
      imageUrl: 'data:image/png;base64,FACADE',
      fileKey: 'facade-1',
      prompt: 'A fridge',
      archetype: 'appliance',
      detectionId: 'det-1',
      source: 'meta',
    };
    renderPanel({ shape: shape('recipe') });
    // Model tab first: viewer is visible.
    expect(screen.getByText('viewer')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '3D model' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '2D Facade' })).toBeTruthy();

    // Click 2D Facade tab: 2D facade panel is displayed, viewer is hidden.
    fireEvent.click(screen.getByRole('tab', { name: '2D Facade' }));
    expect(screen.getByText('2D Facade Imagination')).toBeTruthy();
    expect(screen.queryByText('viewer')).toBeNull();

    // Switch back to 3D model tab: viewer shows again.
    fireEvent.click(screen.getByRole('tab', { name: '3D model' }));
    expect(screen.getByText('viewer')).toBeTruthy();

    facadeMock.status = 'idle';
    facadeMock.facade = undefined;
  });

  it('statuses (PR-2.15): dims grouped by status + hidden note for inferred parts', () => {
    const s = shape('recipe');
    s.recipe = {
      proportions: { w: 1, h: 0.6, d: 0.5 },
      parts: [
        {
          shape: 'box',
          at: [0, 0, 0],
          size: [1, 1, 1],
          color: '#aaaaaa',
          front: true,
          status: 'estimated',
        },
        {
          shape: 'box',
          at: [0, 0, 0.505],
          size: [0.1, 0.1, 0.02],
          color: '#2222bb',
          status: 'measured',
        },
        {
          shape: 'box',
          at: [0, 0, -0.505],
          size: [0.1, 0.1, 0.02],
          color: '#2222bb',
          status: 'inferred',
        },
      ],
      dimStatus: { eave: 'measured', depth: 'estimated', yaw: 'estimated', scale: 'estimated' },
    };
    renderPanel({ shape: s });
    expect(
      screen.getByText('Dimensions: measured — roof · estimated — depth, orientation, scale')
    ).toBeTruthy();
    expect(screen.getByText('Parts: measured : 1 · estimated : 1 · inferred : 1')).toBeTruthy();
    expect(
      screen.getByText('Some parts are hidden in the photo: they are inferred, not measured.')
    ).toBeTruthy();
  });

  it('no statuses: no dims line, no hidden note', () => {
    renderPanel({ shape: shape('recipe') });
    expect(screen.queryByText(/Dimensions:/)).toBeNull();
    expect(screen.queryByText(/hidden in the photo/)).toBeNull();
  });

  it('display tweaks reach the viewer, reset restores, new object restarts (PV-T11b)', () => {
    const { container, rerender } = renderPanel();
    const viewer = () => container.querySelector('[data-mode="recipe"]')!;
    expect(viewer().getAttribute('data-scale')).toBe('1');
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    fireEvent.change(screen.getByRole('slider', { name: 'Model size' }), {
      target: { value: '1.5' },
    });
    expect(viewer().getAttribute('data-scale')).toBe('1.5');
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#ff0000' } });
    expect(viewer().getAttribute('data-tint')).toBe('#ff0000');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(viewer().getAttribute('data-scale')).toBe('1');
    expect(viewer().getAttribute('data-tint')).toBe('');
    // A tweak followed by another object: the new object starts untweaked.
    fireEvent.change(screen.getByRole('slider', { name: 'Model size' }), {
      target: { value: '2' },
    });
    const det2 = { ...fridge, id: 'det-2' };
    rerender(
      <I18nProvider>
        <ObjectShapePanel
          status="ready"
          shape={shape('recipe', 'det-2')}
          viewsStatus="idle"
          detection={det2}
          label="TV"
          imageUrl="data:image/png;base64,AA"
        />
      </I18nProvider>
    );
    expect(viewer().getAttribute('data-scale')).toBe('1');
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });
});

describe('ObjectShapePanel staged improvement (PG-T18)', () => {
  it('shows the chip over the ready model, outside the image role, and never while loading', () => {
    renderPanel({ improve: { status: 'running', index: 2, total: 4, stage: 'roof' } });
    const text = screen.getByText('Improving: stage 2/4 — Roof');
    expect(screen.getByRole('img').contains(text)).toBe(false);
    renderPanel({
      status: 'loading',
      shape: undefined,
      step: 'model',
      improve: { status: 'running', index: 1, total: 4, stage: 'massing' },
    });
    expect(screen.queryByText('Improving: stage 1/4 — Massing')).toBeNull();
  });
});
