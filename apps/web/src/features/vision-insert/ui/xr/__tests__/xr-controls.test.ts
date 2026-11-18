import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  aimAsStep,
  createControlMemory,
  isWalkStick,
  MICROGESTURE,
  PAD,
  readControls,
  STICK_REPEAT,
  type ControlSource,
} from '../xr-controls';
import { aimHint, aimHintKey, type AimHintContext } from '../xr-aim-hint';
import { snapTurnOffset } from '../xr-rig';
import { legendKeys } from '../xr-control-hints';

const pad = (
  handedness: 'left' | 'right',
  pressed: number[] = [],
  stick: [number, number] = [0, 0]
): ControlSource => {
  const buttons = Array.from({ length: 7 }, (_, i) => pressed.includes(i));
  return { handedness, hand: false, buttons, axes: [0, 0, stick[0], stick[1]] };
};
const hand = (handedness: 'left' | 'right', pressed: number[] = []): ControlSource => ({
  handedness,
  hand: true,
  buttons: Array.from({ length: 10 }, (_, i) => pressed.includes(i)),
  axes: [],
});

/** Runs frames of sources; returns the actions of each frame. */
function run(frames: ControlSource[][], dt = 0.016) {
  const memory = createControlMemory();
  return frames.map((f, i) => readControls(f, memory, i * dt));
}

describe('XR controls map (VS-T23)', () => {
  it('A / X analyse, B / Y go back, a stick click toggles help on release (once per press)', () => {
    const out = run([
      [pad('right'), pad('left')],
      [pad('right', [PAD.primary]), pad('left', [PAD.secondary])],
      [pad('right', [PAD.primary]), pad('left', [PAD.secondary])],
      [pad('right', [PAD.stick]), pad('left')],
      [pad('right'), pad('left')],
    ]);
    expect(out[1]).toEqual([{ type: 'analyse' }, { type: 'back' }]);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual([]);
    expect(out[4]).toEqual([{ type: 'help' }]);
  });

  it('a stick held 0.8 s toggles the hand / controller models, not the help (VS-T30)', () => {
    const memory = createControlMemory();
    readControls([pad('right')], memory, 0);
    expect(readControls([pad('right', [PAD.stick])], memory, 0.1)).toEqual([]);
    expect(readControls([pad('right', [PAD.stick])], memory, 0.5)).toEqual([]);
    expect(readControls([pad('right', [PAD.stick])], memory, 0.95)).toEqual([{ type: 'inputs' }]);
    expect(readControls([pad('right', [PAD.stick])], memory, 1.5)).toEqual([]);
    expect(readControls([pad('right')], memory, 1.6)).toEqual([]);
  });

  it('a stick already held when the session starts fires nothing on release', () => {
    const memory = createControlMemory();
    readControls([pad('right', [PAD.stick])], memory, 0);
    expect(readControls([pad('right')], memory, 0.1)).toEqual([]);
  });

  it('buttons already held when the session starts fire nothing', () => {
    expect(run([[pad('right', [PAD.primary])]])[0]).toEqual([]);
  });

  it('right stick ←/→ snap turns once, then repeats while held', () => {
    const memory = createControlMemory();
    readControls([pad('right')], memory, 0);
    expect(readControls([pad('right', [], [0.9, 0])], memory, 0.1)).toEqual([
      { type: 'turn', direction: 1 },
    ]);
    expect(readControls([pad('right', [], [0.9, 0])], memory, 0.2)).toEqual([]);
    expect(readControls([pad('right', [], [0.9, 0])], memory, 0.1 + STICK_REPEAT + 0.01)).toEqual([
      { type: 'turn', direction: 1 },
    ]);
    readControls([pad('right')], memory, 1);
    expect(readControls([pad('right', [], [-0.9, 0])], memory, 1.1)).toEqual([
      { type: 'turn', direction: -1 },
    ]);
  });

  it('right stick ↑ held aims a teleport, let go lands it; ↓ steps back; left stick only walks', () => {
    const memory = createControlMemory();
    readControls([pad('right'), pad('left')], memory, 0);
    expect(readControls([pad('right', [], [0, -0.9]), pad('left')], memory, 0.1)).toEqual([
      { type: 'aim', on: true },
    ]);
    // Held: aims on, no repeat.
    expect(readControls([pad('right', [], [0, -0.9]), pad('left')], memory, 1.5)).toEqual([]);
    expect(readControls([pad('right'), pad('left')], memory, 1.6)).toEqual([
      { type: 'aim', on: false },
    ]);
    readControls([pad('right'), pad('left')], memory, 0.2);
    expect(
      readControls([pad('right', [], [0, 0.9]), pad('left', [], [0.9, 0.9])], memory, 0.3)
    ).toEqual([{ type: 'step', direction: -1 }]);
    expect(aimAsStep({ type: 'aim', on: true })).toEqual({ type: 'step', direction: 1 });
    expect(aimAsStep({ type: 'aim', on: false })).toBeNull();
    expect(aimAsStep({ type: 'turn', direction: 1 })).toEqual({ type: 'turn', direction: 1 });
    expect(isWalkStick({ handedness: 'left' })).toBe(true);
    expect(isWalkStick({ handedness: 'right' })).toBe(false);
    expect(isWalkStick({ handedness: 'left', hand: {} })).toBe(false);
  });

  it('hands, either one: thumb swipes turn and step, a thumb tap analyses', () => {
    const out = run([
      [hand('left'), hand('right')],
      [hand('left', [MICROGESTURE.swipeLeft]), hand('right', [MICROGESTURE.swipeForward])],
      [hand('left'), hand('right', [MICROGESTURE.tap])],
      [hand('left', [MICROGESTURE.swipeRight]), hand('right', [MICROGESTURE.swipeBackward])],
    ]);
    expect(out[1]).toEqual([
      { type: 'turn', direction: -1 },
      { type: 'step', direction: 1 },
    ]);
    expect(out[2]).toEqual([{ type: 'analyse' }]);
    expect(out[3]).toEqual([
      { type: 'turn', direction: 1 },
      { type: 'step', direction: -1 },
    ]);
  });
});

describe('snap turn offset', () => {
  it('turns about the head: the head point maps to itself', () => {
    const head: [number, number, number] = [0.4, 1.6, -0.3];
    const { position, orientation } = snapTurnOffset(head, Math.PI / 6);
    const q = new THREE.Quaternion(...orientation);
    const h = new THREE.Vector3(head[0], 0, head[2]).applyQuaternion(q);
    expect(h.x + position[0]).toBeCloseTo(head[0]);
    expect(h.z + position[2]).toBeCloseTo(head[2]);
    expect(position[1]).toBe(0);
  });
});

describe('aim hint (what the select will do)', () => {
  const ctx: AimHintContext = {
    targetName: (id) => (id === 'fridge' ? 'Fridge' : null),
    isMaterialized: (id) => id === 'tv',
    isConnected: () => false,
    placeOf: (id) => (id === 'tour-link:hall' ? 'Hall' : null),
    menuOpen: false,
    outsideAnalyses: true,
    screenAnalyses: false,
  };

  it('names the verb of the input and the action on the aimed thing', () => {
    expect(aimHint({ kind: 'target', id: 'fridge', input: 'controller' }, ctx)).toEqual({
      verb: 'verbTrigger',
      action: 'extract',
      values: { name: 'Fridge' },
    });
    expect(aimHint({ kind: 'target', id: 'tv', input: 'hand' }, ctx)?.action).toBe('connect');
    expect(aimHint({ kind: 'hotspot', id: 'tour-link:hall', input: 'mouse' }, ctx)).toEqual({
      verb: 'verbClick',
      action: 'goTo',
      values: { room: 'Hall' },
    });
    expect(aimHint({ kind: 'wrist', id: null, input: 'hand' }, ctx)?.action).toBe('menuOpen');
    expect(aimHint({ kind: 'none', id: null, input: 'hand' }, ctx)?.action).toBe('analyse');
  });

  it('says nothing on panels (they label themselves) or where a shot does nothing', () => {
    expect(aimHint({ kind: 'panel', id: 'holo:x', input: 'hand' }, ctx)).toBeNull();
    expect(aimHint({ kind: 'screen', id: null, input: 'hand' }, ctx)).toBeNull();
  });

  it('rebuilds the text when the aimed object changes state', () => {
    const a = { kind: 'target' as const, id: 'fridge', input: 'hand' as const };
    const before = aimHintKey(a, ctx);
    const after = aimHintKey(a, { ...ctx, isMaterialized: () => true });
    expect(before).not.toBe(after);
  });
});

describe('button legends', () => {
  it('each controller lists its own buttons; hands share one legend', () => {
    expect(legendKeys('controller', 'left')).toContain('legendStickWalk');
    expect(legendKeys('controller', 'right')).toContain('legendStickTurn');
    expect(legendKeys('controller', 'right')).toContain('legendA');
    expect(legendKeys('hand', 'left')).toEqual(legendKeys('hand', 'right'));
  });
});
