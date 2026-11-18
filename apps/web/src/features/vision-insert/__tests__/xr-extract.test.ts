import { describe, expect, it } from 'vitest';
import {
  canBuild,
  deskOf,
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
  it('« Retry the 3D? » → Yes goes from the lab back to the build step only', () => {
    const lab = { stage: 'lab' as const, id: 'fridge' };
    expect(xrExtractReducer(lab, { type: 'rebuild' })).toEqual({ stage: 'build', id: 'fridge' });
    const views = { stage: 'views' as const, id: 'fridge' };
    expect(xrExtractReducer(views, { type: 'rebuild' })).toBe(views);
  });

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
    expect(run([{ type: 'exitLab' }], lab)).toEqual({
      ...XR_EXTRACT_IDLE,
      away: { id: 'det-1', stage: 'lab' },
    });
  });

  it('goes between the 2D lab and the 3D lab once the model is built (VS-T31)', () => {
    const lab = { stage: 'lab' as const, id: 'a' };
    const views = run([{ type: 'toViews' }], lab);
    expect(views).toEqual({ stage: 'views', id: 'a' });
    expect(run([{ type: 'toLab', built: true }], views)).toEqual(lab);
    // No model yet: the 3D lab stays shut; outside the lab, « 2D lab » does nothing.
    expect(run([{ type: 'toLab', built: false }], views)).toEqual(views);
    expect(run([{ type: 'toViews' }], { stage: 'build', id: 'a' }).stage).toBe('build');
    expect(run([{ type: 'toLab', built: true }], { stage: 'build', id: 'a' }).stage).toBe('build');
  });

  it('puts the views on the 2D desk, the build and the lab on the 3D desk (VS-T31)', () => {
    expect(deskOf('views')).toBe('2d');
    expect(deskOf('build')).toBe('3d');
    expect(deskOf('lab')).toBe('3d');
    expect(deskOf('confirm')).toBeNull();
    expect(deskOf('idle')).toBeNull();
  });

  it('leaves the studio and comes back to the same step (VS-T26)', () => {
    const views = run([{ type: 'ask', id: 'a' }, { type: 'confirm' }]);
    const left = run([{ type: 'leave' }], views);
    expect(left).toEqual({ stage: 'idle', id: null, away: { id: 'a', stage: 'views' } });
    expect(run([{ type: 'return' }], left)).toEqual({ stage: 'views', id: 'a' });
    // Nothing left: return does nothing; leave outside the studio does nothing.
    expect(run([{ type: 'return' }])).toEqual(XR_EXTRACT_IDLE);
    expect(run([{ type: 'ask', id: 'a' }, { type: 'leave' }]).stage).toBe('confirm');
  });

  it('keeps the object in the lab when the same object is extracted again (VS-T26, regression)', () => {
    // Before: leaving the lab forgot it; extracting it again restarted at the 2D views.
    const lab = { stage: 'lab' as const, id: 'a' };
    const left = run([{ type: 'exitLab' }], lab);
    expect(run([{ type: 'ask', id: 'a' }, { type: 'confirm' }], left)).toEqual(lab);
    // Another object: a fresh extraction, the one left is forgotten.
    expect(run([{ type: 'ask', id: 'b' }, { type: 'confirm' }], left)).toEqual({
      stage: 'views',
      id: 'b',
    });
    // Cancelling the question keeps what was left.
    expect(run([{ type: 'ask', id: 'b' }, { type: 'cancel' }], left)).toEqual(left);
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
