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

  describe('dispatcher mixing desk (VS-T34)', () => {
    it('opens instead of the building panel, B/Y closes it first', () => {
      const { result } = setup();
      act(() => result.current.selectSector('school'));
      act(() => result.current.openMixer());
      expect(result.current.mixer).toBe(true);
      expect(result.current.panel).toBeNull();
      act(() => result.current.onXrAction({ type: 'back' }));
      expect(result.current.mixer).toBe(false);
      act(() => result.current.openMixer());
      act(() => result.current.selectSector('market'));
      expect(result.current.mixer).toBe(false);
    });

    it('a sector fader becomes an undoable kW limit; cutting the clinic is refused', () => {
      const { result, approveChange, model } = setup();
      // Households ask for power at 19:00 (evening peak): the fader has a scale.
      expect(model.buildings.households.demandKw).toBeGreaterThan(0);
      act(() => result.current.mixSector('households', 0.5));
      const [id, patch] = approveChange.mock.calls[0]!;
      expect(id).toMatch(/^vr-mix-households-/);
      const half = Math.round(model.buildings.households.demandKw * 0.5 * 10) / 10;
      expect(patch).toEqual({
        sectorCaps: [{ sector: 'households', maxKw: half, fromHour: 19, toHour: 24 }],
      });
      act(() => result.current.cutSector('health', true));
      act(() => result.current.mixSector('health', 0));
      expect(approveChange).toHaveBeenCalledTimes(1);
      expect(result.current.refused).toBe('health');
    });

    it('the battery master moves the reserve; « Start » runs the engine', () => {
      const run = vi.fn();
      useSimulationStore.setState({ run });
      const { result, approveChange } = setup();
      act(() => result.current.mixReserve(1));
      expect(approveChange.mock.calls[0]![1]).toEqual({ minSocPct: 5 });
      act(() => result.current.startDispatch());
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('an appliance wired to the dispatcher is driven by its own fader', () => {
      const fridge = {
        id: 'ph-fridge',
        name: 'Fridge',
        category: 'fridge' as const,
        sector: 'households' as const,
        watts: 100,
        quantity: 1,
      };
      useSimulationStore.setState((s) => ({ input: { ...s.input, appliances: [fridge] } }));
      const { result, approveChange } = setup();
      act(() => result.current.mixAppliance('ph-fridge', 0));
      const patch = approveChange.mock.calls[0]![1];
      expect(patch.appliances[0].hourlyDuty.slice(19).every((d: number) => d === 0)).toBe(true);
      act(() => result.current.mixAppliance('unknown', 0));
      expect(approveChange).toHaveBeenCalledTimes(1);
    });
  });

  it('the map opens alone, B/Y closes it, a pin opens its controls and closes it (VS-T37)', () => {
    const { result } = setup();
    act(() => result.current.selectSector('market'));
    act(() => result.current.openMap());
    expect(result.current.map).toBe(true);
    expect(result.current.panel).toBeNull();
    act(() => result.current.onXrAction({ type: 'back' }));
    expect(result.current.map).toBe(false);

    act(() => result.current.openMap());
    act(() => result.current.selectSector('school'));
    expect(result.current.map).toBe(false);
    expect(result.current.panel).toBe('school');

    act(() => result.current.openMap());
    act(() => result.current.openMixer());
    expect(result.current.map).toBe(false);
    expect(result.current.mixer).toBe(true);
  });

  it('a second click on the label or the dispatcher closes its menu (VS-T38)', () => {
    const { result } = setup();
    act(() => result.current.selectSector('health'));
    expect(result.current.panel).toBe('health');
    act(() => result.current.selectSector('health'));
    expect(result.current.panel).toBeNull();
    act(() => result.current.selectSector('health'));
    act(() => result.current.selectSector('market'));
    expect(result.current.panel).toBe('market');
    act(() => result.current.openMixer());
    expect(result.current.mixer).toBe(true);
    act(() => result.current.openMixer());
    expect(result.current.mixer).toBe(false);
  });
});
