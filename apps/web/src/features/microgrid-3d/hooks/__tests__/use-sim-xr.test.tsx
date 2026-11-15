import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simulate } from '@mitsinjo/engine';
import { useSimulationStore } from '@/stores';
import { toSceneModel } from '../../utils/to-scene-model';
import { useSimXr } from '../use-sim-xr';
import { interiorSpawn } from '../../utils/sim-xr-place';

const initial = useSimulationStore.getState();

function setup(xrActive = true) {
  const onSelectSector = vi.fn();
  const approveChange = vi.fn();
  const undoLastChange = vi.fn(() => null);
  useSimulationStore.setState({ approveChange, undoLastChange, changeHistory: [] });
  const input = useSimulationStore.getState().input;
  const model = toSceneModel({ input, result: simulate(input, 'proportional'), timeIndex: 19 });
  const hook = renderHook(
    (p: { xr: boolean }) => useSimXr({ xrActive: p.xr, model, onSelectSector }),
    {
      initialProps: { xr: xrActive },
    }
  );
  return { ...hook, onSelectSector, approveChange, undoLastChange, model };
}

describe('useSimXr (VSIM-T1–T4)', () => {
  beforeEach(() => useSimulationStore.setState(initial, true));

  it('on screen, a label click keeps the usual selection; in VR it opens the power panel', () => {
    const screen = setup(false);
    act(() => screen.result.current.selectSector('households'));
    expect(screen.onSelectSector).toHaveBeenCalledWith('households');
    expect(screen.result.current.panel).toBeNull();

    const vr = setup(true);
    act(() => vr.result.current.selectSector('households'));
    expect(vr.onSelectSector).not.toHaveBeenCalled();
    expect(vr.result.current.panel).toBe('households');
  });

  it('« Cut all » runs the engine through an undoable change; the clinic is refused', () => {
    const { result, approveChange } = setup();
    act(() => result.current.power('households', 'cut'));
    expect(approveChange).toHaveBeenCalledTimes(1);
    const [id, patch] = approveChange.mock.calls[0]!;
    expect(id).toMatch(/^vr-power-households-cut-/);
    expect(patch).toEqual({
      sectorCaps: [{ sector: 'households', maxKw: 0, fromHour: 19, toHour: 24 }],
    });
    act(() => result.current.power('health', 'cut'));
    expect(approveChange).toHaveBeenCalledTimes(1);
    expect(result.current.refused).toBe('health');
  });

  it('enter puts you in the room, B/Y closes the panel then leaves the room to the door', () => {
    const { result } = setup();
    act(() => result.current.selectSector('school'));
    act(() => result.current.enter('school'));
    expect(result.current.inside).toBe('school');
    expect(result.current.place).toMatchObject({ interior: true, spot: interiorSpawn() });
    const key = result.current.place!.key;
    act(() => result.current.onXrAction({ type: 'back' }));
    expect(result.current.inside).toBeNull();
    expect(result.current.place).toMatchObject({ interior: false });
    expect(result.current.place!.key).toBeGreaterThan(key);

    act(() => result.current.selectSector('market'));
    act(() => result.current.onXrAction({ type: 'back' }));
    expect(result.current.panel).toBeNull();
  });

  it('A/X toggles labels, stick click toggles the legends; leaving VR resets', () => {
    const { result, rerender } = setup();
    const labels = result.current.labels;
    act(() => result.current.onXrAction({ type: 'analyse' }));
    expect(result.current.labels).toBe(!labels);
    const help = result.current.help;
    act(() => result.current.onXrAction({ type: 'help' }));
    expect(result.current.help).toBe(!help);
    act(() => result.current.enter('water'));
    rerender({ xr: false });
    expect(result.current.inside).toBeNull();
    expect(result.current.place).toBeNull();
  });
});
