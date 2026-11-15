import { describe, expect, it } from 'vitest';
import {
  canBuild,
  isModalStage,
  snapIndex,
  viewSlides,
  XR_EXTRACT_IDLE,
  xrExtractReducer,
  type XrExtractEvent,
  type XrExtractState,
} from '../utils/xr-extract';

const run = (events: XrExtractEvent[], from: XrExtractState = XR_EXTRACT_IDLE) =>
  events.reduce(xrExtractReducer, from);

describe('xrExtractReducer (VS-T19–T22)', () => {
  it('walks the whole extraction: confirm → views → build → lab → idle', () => {
    expect(run([{ type: 'ask', id: 'det-1' }])).toEqual({ stage: 'confirm', id: 'det-1' });
    expect(run([{ type: 'ask', id: 'det-1' }, { type: 'confirm' }]).stage).toBe('views');
    const lab = run([
      { type: 'ask', id: 'det-1' },
      { type: 'confirm' },
      { type: 'build' },
      { type: 'enterLab' },
    ]);
    expect(lab).toEqual({ stage: 'lab', id: 'det-1' });
    expect(run([{ type: 'exitLab' }], lab)).toEqual(XR_EXTRACT_IDLE);
  });

  it('skips the views when the model is already built', () => {
    expect(
      run([
        { type: 'ask', id: 'det-1' },
        { type: 'confirm', built: true },
      ]).stage
    ).toBe('build');
  });

  it('cancels every step but the lab, and ignores events out of order', () => {
    for (const steps of [
      [{ type: 'ask', id: 'a' }],
      [{ type: 'ask', id: 'a' }, { type: 'confirm' }],
      [{ type: 'ask', id: 'a' }, { type: 'confirm' }, { type: 'build' }],
    ] as XrExtractEvent[][]) {
      expect(run([...steps, { type: 'cancel' }])).toEqual(XR_EXTRACT_IDLE);
    }
    const lab = { stage: 'lab' as const, id: 'a' };
    expect(run([{ type: 'cancel' }], lab)).toBe(lab);
    expect(run([{ type: 'build' }, { type: 'enterLab' }, { type: 'confirm' }])).toEqual(
      XR_EXTRACT_IDLE
    );
  });

  it('re-targets the question, never a running extraction', () => {
    expect(
      run([
        { type: 'ask', id: 'a' },
        { type: 'ask', id: 'b' },
      ]).id
    ).toBe('b');
    expect(run([{ type: 'ask', id: 'a' }, { type: 'confirm' }, { type: 'ask', id: 'b' }]).id).toBe(
      'a'
    );
  });

  it('every step but idle is modal', () => {
    expect(isModalStage('idle')).toBe(false);
    expect(isModalStage('views')).toBe(true);
  });
});

describe('viewSlides / canBuild', () => {
  it('lists the main view then the faces, and builds once the main view is drawn', () => {
    const slides = viewSlides({
      main: { status: 'ready', imageUrl: 'data:image/png;base64,AA' },
      faces: { side: { status: 'ready', imageUrl: 'x', validated: true } },
      names: ['side', 'back'],
    });
    expect(slides.map((s) => [s.id, s.status, s.validated])).toEqual([
      ['main', 'ready', true],
      ['side', 'ready', true],
      ['back', 'idle', false],
    ]);
    expect(canBuild(slides)).toBe(true);
  });

  it('waits while the main view or a face is drawing', () => {
    expect(canBuild(viewSlides({ main: { status: 'generating' }, faces: {}, names: [] }))).toBe(
      false
    );
    expect(
      canBuild(
        viewSlides({
          main: { status: 'ready', imageUrl: 'x' },
          faces: { side: { status: 'generating', validated: false } },
          names: ['side'],
        })
      )
    ).toBe(false);
  });
});

describe('snapIndex', () => {
  it('rounds to the nearest slide inside the list', () => {
    expect(snapIndex(1.4, 5)).toBe(1);
    expect(snapIndex(-3, 5)).toBe(0);
    expect(snapIndex(9, 5)).toBe(4);
    expect(snapIndex(0.6, 0)).toBe(0);
  });
});
