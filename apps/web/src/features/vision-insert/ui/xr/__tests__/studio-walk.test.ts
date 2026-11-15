import { describe, expect, it } from 'vitest';
import { STUDIO_WALK_RADIUS, WHEEL_STEP, wheelStep } from '../studio-walk';
import { glideStep, STEP_GLIDE_SPEED } from '../tour/tour-nav';
import { STEP_DISTANCE } from '../xr-controls';
import { lockedTurn, LOCKED_TURN_GAIN } from '../xr-blaster-controller';

describe('glideStep', () => {
  it('glides a forward step along the gaze (yaw 0 = -Z) at glide speed, then stops', () => {
    let state = { ground: [0, 0] as [number, number], pending: STEP_DISTANCE };
    state = glideStep(state.ground, state.pending, 0, 0.1, 5);
    expect(state.ground[1]).toBeCloseTo(-STEP_GLIDE_SPEED * 0.1);
    for (let i = 0; i < 20; i++) state = glideStep(state.ground, state.pending, 0, 0.1, 5);
    expect(state.pending).toBe(0);
    expect(state.ground[1]).toBeCloseTo(-STEP_DISTANCE);
  });

  it('steps back to the right when facing right, and stays inside the walkable disc', () => {
    const back = glideStep([0, 0], -0.5, Math.PI / 2, 1, 5);
    expect(back.ground[0]).toBeCloseTo(-0.5);
    const far = glideStep([STUDIO_WALK_RADIUS - 0.1, 0], 1, Math.PI / 2, 1, STUDIO_WALK_RADIUS);
    expect(Math.hypot(...far.ground)).toBeCloseTo(STUDIO_WALK_RADIUS);
  });

  it('leaves the ground alone with nothing to glide', () => {
    const g: [number, number] = [0.3, -0.2];
    expect(glideStep(g, 0, 1, 0.1, 5)).toEqual({ ground: g, pending: 0 });
  });
});

describe('wheelStep', () => {
  it('walks forward on wheel up, back on wheel down', () => {
    expect(wheelStep(0, -100)).toBeCloseTo(WHEEL_STEP);
    expect(wheelStep(0, 100)).toBeCloseTo(-WHEEL_STEP);
    expect(wheelStep(0.1, 0)).toBe(0.1);
  });

  it('never queues more than one snap step on a fast spin', () => {
    let pending = 0;
    for (let i = 0; i < 20; i++) pending = wheelStep(pending, -120);
    expect(pending).toBe(STEP_DISTANCE);
  });
});

describe('lockedTurn (IWER Play mode)', () => {
  it('turns right / down like the DevUI would turn the headset', () => {
    expect(lockedTurn(100, 0)).toEqual({ yaw: 100 * LOCKED_TURN_GAIN, pitch: -0 });
    expect(lockedTurn(0, 50).pitch).toBeCloseTo(-50 * LOCKED_TURN_GAIN);
  });
});
