import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceWorldSwitch,
  labSuspended,
  startWorldSwitch,
  useXrWorld,
  WORLD_COVER_MS,
  WORLD_REVEAL_MS,
  WORLD_SWITCH_START,
  worldShellBand,
} from '../xr-world-switch';

describe('lab ↔ village world switch (VS-T49)', () => {
  beforeEach(() => useXrWorld.getState().reset());

  it('starts in the lab; asking for the village covers first, the world unchanged', () => {
    const s = startWorldSwitch(WORLD_SWITCH_START, 'village', 100);
    expect(s).toMatchObject({ world: 'lab', phase: 'cover', target: 'village', startedAt: 100 });
  });

  it('ignores a request for the world shown or during a hand-over', () => {
    expect(startWorldSwitch(WORLD_SWITCH_START, 'lab', 0)).toBe(WORLD_SWITCH_START);
    const covering = startWorldSwitch(WORLD_SWITCH_START, 'village', 0);
    expect(startWorldSwitch(covering, 'lab', 10)).toBe(covering);
  });

  it('swaps the world once covered, then reveals and settles', () => {
    const covering = startWorldSwitch(WORLD_SWITCH_START, 'village', 0);
    expect(advanceWorldSwitch(covering, WORLD_COVER_MS - 1)).toBe(covering);
    const revealing = advanceWorldSwitch(covering, WORLD_COVER_MS);
    expect(revealing).toMatchObject({ world: 'village', phase: 'reveal' });
    const done = advanceWorldSwitch(revealing, WORLD_COVER_MS + WORLD_REVEAL_MS);
    expect(done).toMatchObject({ world: 'village', phase: 'idle' });
    // The way back plays the same hand-over.
    expect(startWorldSwitch(done, 'lab', 0)).toMatchObject({ phase: 'cover', target: 'lab' });
  });

  it('the shell rises from the floor, fully closed at the swap, then crumbles from the floor', () => {
    expect(worldShellBand(WORLD_SWITCH_START, 0)).toEqual({ low: 0, high: 0 });
    const covering = startWorldSwitch(WORLD_SWITCH_START, 'village', 0);
    const mid = worldShellBand(covering, WORLD_COVER_MS / 2);
    expect(mid.low).toBe(0);
    expect(mid.high).toBeGreaterThan(0);
    expect(mid.high).toBeLessThan(1);
    expect(worldShellBand(covering, WORLD_COVER_MS)).toEqual({ low: 0, high: 1 });
    const revealing = advanceWorldSwitch(covering, WORLD_COVER_MS);
    expect(worldShellBand(revealing, WORLD_COVER_MS)).toEqual({ low: 0, high: 1 });
    expect(worldShellBand(revealing, WORLD_COVER_MS + WORLD_REVEAL_MS).low).toBe(1);
  });

  it('the store runs the same steps and resets to the lab', () => {
    useXrWorld.getState().go('village');
    expect(useXrWorld.getState().phase).toBe('cover');
    useXrWorld.setState({ startedAt: performance.now() - WORLD_COVER_MS });
    useXrWorld.getState().step();
    expect(useXrWorld.getState().world).toBe('village');
    useXrWorld.getState().reset();
    expect(useXrWorld.getState()).toMatchObject(WORLD_SWITCH_START);
  });
});

describe('labSuspended', () => {
  it('is true only while the village is shown', () => {
    useXrWorld.getState().reset();
    expect(labSuspended()).toBe(false);
    useXrWorld.setState({ world: 'village' });
    expect(labSuspended()).toBe(true);
    useXrWorld.getState().reset();
  });
});
