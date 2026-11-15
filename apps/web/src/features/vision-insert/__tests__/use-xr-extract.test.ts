import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShapeRequest } from '../hooks/use-object-shape';

const facade = vi.hoisted(() => ({
  state: {
    status: 'idle' as 'idle' | 'generating' | 'ready',
    facade: undefined as undefined | { imageUrl: string; fileKey: string },
  },
  generate: vi.fn(),
  retry: vi.fn(),
  validate: vi.fn(),
  target: null as unknown,
}));
const faces = vi.hoisted(() => ({
  generateAll: vi.fn(),
  generate: vi.fn(),
  validate: vi.fn(),
  faces: {
    side: {
      status: 'ready',
      imageUrl: 'data:image/png;base64,S',
      fileKey: 'k-side',
      validated: true,
    },
    back: { status: 'idle', validated: false },
  } as Record<string, unknown>,
}));

vi.mock('../hooks/use-facade-2d', () => ({
  useFacade2d: (_img: string | null, target: unknown) => {
    facade.target = target;
    return {
      ...facade.state,
      generate: facade.generate,
      retry: facade.retry,
      validate: facade.validate,
    };
  },
  validatedFacade: (f?: { imageUrl: string; fileKey: string }, fc?: unknown) =>
    f ? { url: f.imageUrl, key: f.fileKey, ...(fc ? { faces: fc } : {}) } : undefined,
}));
vi.mock('../hooks/use-facade-faces', () => ({
  useFacadeFaces: () => ({
    faces: faces.faces,
    names: ['side', 'back'],
    generate: faces.generate,
    generateAll: faces.generateAll,
    validate: faces.validate,
  }),
  validatedFaces: () => ({ urls: { side: 'data:image/png;base64,S' }, keys: { side: 'k-side' } }),
}));

import { useXrExtract } from '../hooks/use-xr-extract';

const fridge: ShapeRequest = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.2, w: 0.2, h: 0.6 },
};

function setup(shape: Parameters<typeof useXrExtract>[0]['shape'] = { status: 'idle' }) {
  const requestShape = vi.fn();
  const select = vi.fn();
  const r = renderHook(
    (props: { target: ShapeRequest | null }) =>
      useXrExtract({
        imageUrl: 'data:image/jpeg;base64,PHOTO',
        target: props.target,
        shape,
        requestShape,
        editPieces: vi.fn(),
        select,
      }),
    { initialProps: { target: null as ShapeRequest | null } }
  );
  return { ...r, requestShape, select };
}

describe('useXrExtract (VS-T19–T22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facade.state = { status: 'idle', facade: undefined };
  });

  it('asks, selects the object, and draws nothing before « Extract »', () => {
    const { result, rerender, select } = setup();
    act(() => result.current.ask('det-1'));
    rerender({ target: fridge });
    expect(select).toHaveBeenCalledWith('det-1');
    expect(result.current.stage).toBe('confirm');
    expect(facade.generate).not.toHaveBeenCalled();
  });

  it('« Extract » draws the main view once, then every face once', () => {
    const { result, rerender } = setup();
    act(() => result.current.ask('det-1'));
    rerender({ target: fridge });
    act(() => result.current.confirm());
    expect(result.current.stage).toBe('views');
    expect(facade.generate).toHaveBeenCalledTimes(1);
    rerender({ target: fridge });
    expect(facade.generate).toHaveBeenCalledTimes(1);

    facade.state = {
      status: 'ready',
      facade: { imageUrl: 'data:image/png;base64,F', fileKey: 'k-front' },
    };
    rerender({ target: fridge });
    rerender({ target: fridge });
    expect(faces.generateAll).toHaveBeenCalledTimes(1);
    expect(result.current.slides.map((s) => s.id)).toEqual(['main', 'side', 'back']);
    expect(result.current.canBuild).toBe(true);
  });

  it('builds from the main view and the validated faces', () => {
    facade.state = {
      status: 'ready',
      facade: { imageUrl: 'data:image/png;base64,F', fileKey: 'k-front' },
    };
    const { result, rerender, requestShape } = setup();
    act(() => result.current.ask('det-1'));
    rerender({ target: fridge });
    act(() => result.current.confirm());
    act(() => result.current.build());
    expect(facade.validate).toHaveBeenCalled();
    expect(requestShape).toHaveBeenCalledWith('data:image/jpeg;base64,PHOTO', {
      ...fridge,
      facadeUrl: 'data:image/png;base64,F',
      facadeKey: 'k-front',
      faceUrls: { side: 'data:image/png;base64,S' },
      faceKeys: { side: 'k-side' },
    });
    expect(result.current.stage).toBe('build');
  });

  it('skips the views when the model is already built, then opens the lab', () => {
    const { result, rerender } = setup({
      status: 'ready',
      shape: { detectionId: 'det-1', mode: 'recipe' } as never,
    });
    act(() => result.current.ask('det-1'));
    rerender({ target: fridge });
    expect(result.current.ready).toBe(true);
    act(() => result.current.confirm());
    expect(result.current.stage).toBe('build');
    expect(facade.generate).not.toHaveBeenCalled();
    act(() => result.current.enterLab());
    expect(result.current.stage).toBe('lab');
    act(() => result.current.exitLab());
    expect(result.current.stage).toBe('idle');
  });

  it('toggles a face validation, never the main view; redraw goes to the right call', () => {
    const { result } = setup();
    act(() => result.current.toggleValidated('side'));
    expect(faces.validate).toHaveBeenCalledWith('side', false);
    act(() => result.current.toggleValidated('main'));
    expect(faces.validate).toHaveBeenCalledTimes(1);
    act(() => result.current.redraw('main'));
    expect(facade.retry).toHaveBeenCalled();
    act(() => result.current.redraw('back'));
    expect(faces.generate).toHaveBeenCalledWith('back');
  });
});
