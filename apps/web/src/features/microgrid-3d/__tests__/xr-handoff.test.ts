import { beforeEach, describe, expect, it } from 'vitest';
import { standNear, useXrHandoff, XR_HANDOFF_STAND } from '../utils/xr-handoff';

describe('xr hand-off from the /village lab (VS-T29)', () => {
  beforeEach(() => useXrHandoff.getState().clear());

  it('keeps one pending VR entry until it is taken', () => {
    expect(useXrHandoff.getState().pending).toBeNull();
    useXrHandoff.getState().request([3.3, 23.8]);
    expect(useXrHandoff.getState().pending).toEqual({ at: [3.3, 23.8] });
    useXrHandoff.getState().clear();
    expect(useXrHandoff.getState().pending).toBeNull();
  });

  it('stands the viewer next to the object, on the village-centre side, looking at it', () => {
    const v = standNear(10, 0, 1.8);
    expect(v.position).toEqual([10 - XR_HANDOFF_STAND, 1.8, 0]);
    expect(v.target).toEqual([10, 1.8, 0]);
    const far = standNear(3, 4, 1.8, 2);
    expect(Math.hypot(far.position[0] - 3, far.position[2] - 4)).toBeCloseTo(2);
    expect(Math.hypot(far.position[0], far.position[2])).toBeCloseTo(3);
  });

  it('an object at the centre still gets a spot', () => {
    expect(standNear(0, 0, 1.8).position).toEqual([0, 1.8, XR_HANDOFF_STAND]);
  });
});
