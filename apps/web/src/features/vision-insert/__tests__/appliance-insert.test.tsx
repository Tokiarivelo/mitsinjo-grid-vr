import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { APPLIANCE_CATALOG, applianceProfileKw, applianceSummary } from '@mitsinjo/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  resetSimulationStore,
  selectActiveResult,
  useSimulationStore,
  usePlacedModelsStore,
} from '@/stores';
import { useApplianceDraft } from '../hooks/use-appliance-draft';
import { ApplianceInsert } from '../ui/appliance-insert';

const pump: ApplianceDetection = {
  id: 'det-1',
  label: 'Water pump',
  category: 'water_pump',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
};
const house: ApplianceDetection = {
  id: 'det-2',
  label: 'House',
  kind: 'scenery',
  category: 'other',
  scenery: 'building',
  box: { x: 0.5, y: 0.1, w: 0.3, h: 0.3 },
};

describe('useApplianceDraft (PV-T11)', () => {
  it('starts from the AI estimate; an edit turns it manual; AI estimate restores it', () => {
    const { result } = renderHook(() => useApplianceDraft('vision-p-det-1', pump, 'Water pump'));
    expect(result.current.source).toBe('ai');
    expect(result.current.draft).toMatchObject({
      category: 'water_pump',
      sector: 'water',
      watts: APPLIANCE_CATALOG.water_pump.defaultW,
      quantity: 1,
    });
    expect(result.current.summary).toEqual(applianceSummary(result.current.appliance!));
    act(() => result.current.setWatts(1200));
    expect(result.current.source).toBe('manual');
    expect(result.current.appliance?.watts).toBe(1200);
    act(() => result.current.setWatts(1e6));
    expect(result.current.appliance).toBeNull();
    expect(result.current.summary).toBeNull();
    act(() => result.current.applyAiEstimate());
    expect(result.current.source).toBe('ai');
    expect(result.current.draft.watts).toBe(APPLIANCE_CATALOG.water_pump.defaultW);
  });

  it('exposes the 24 h engine curve; null while the draft is invalid (PV-T11b)', () => {
    const { result } = renderHook(() => useApplianceDraft('x', pump, 'Pump'));
    expect(result.current.curve).toEqual(applianceProfileKw(result.current.appliance!));
    expect(result.current.curve).toHaveLength(24);
    act(() => result.current.setWatts(1e6));
    expect(result.current.appliance).toBeNull();
    expect(result.current.curve).toBeNull();
  });

  it('a new type keeps the watts inside its catalog range', () => {
    const { result } = renderHook(() => useApplianceDraft('x', pump, 'Pump'));
    act(() => result.current.setCategory('phone_charger'));
    expect(result.current.draft.watts).toBe(APPLIANCE_CATALOG.phone_charger.maxW);
    expect(result.current.range).toMatchObject({ minW: APPLIANCE_CATALOG.phone_charger.minW });
  });

  it('reopens an inserted line as it was (manual when it differs from the AI estimate)', () => {
    const existing = {
      id: 'x',
      name: 'Big pump',
      category: 'water_pump' as const,
      sector: 'water' as const,
      watts: 900,
      quantity: 2,
    };
    const { result } = renderHook(() => useApplianceDraft('x', pump, 'Pump', existing));
    expect(result.current.source).toBe('manual');
    expect(result.current.draft).toMatchObject({ name: 'Big pump', quantity: 2 });
  });

  it('free placement (PP-T4): normalized spot, feeder follows unless overridden', () => {
    const { result } = renderHook(() => useApplianceDraft('x', pump, 'Pump'));
    expect(result.current.draft.position).toBeNull();
    act(() => result.current.setPosition({ x: 30, z: 30 }));
    expect(result.current.draft.position).toEqual({ x: 30, z: 30 });
    expect(result.current.draft.sector).toBe('market');
    expect(result.current.draft.feederAuto).toBe(true);
    // A building centre snaps out of its footprint.
    act(() => result.current.setPosition({ x: -10.5, z: 0.5 }));
    const snapped = result.current.draft.position!;
    expect(Math.hypot(snapped.x + 10.5, snapped.z - 0.5)).toBeGreaterThanOrEqual(3.9 - 1e-9);
    expect(result.current.draft.sector).toBe('water');
    // An explicit feeder sticks when the spot moves; Auto restores the nearest.
    act(() => result.current.setSector('water'));
    act(() => result.current.setPosition({ x: 32, z: 32 }));
    expect(result.current.draft.sector).toBe('water');
    expect(result.current.draft.feederAuto).toBe(false);
    act(() => result.current.useNearestFeeder());
    expect(result.current.draft.sector).toBe('market');
    expect(result.current.draft.feederAuto).toBe(true);
    act(() => result.current.setPosition(null));
    expect(result.current.draft.position).toBeNull();
  });
});

const renderInsert = (detection: ApplianceDetection, name: string, recipe?: ObjectRecipe | null) =>
  render(
    <I18nProvider>
      <ApplianceInsert detection={detection} name={name} photo="p1" recipe={recipe} />
    </I18nProvider>
  );

describe('ApplianceInsert (PV-T12)', () => {
  beforeEach(() => {
    resetSimulationStore();
    useSimulationStore.getState().run();
  });

  it('inserts the AI estimate, re-runs the simulation, then updates and removes it', () => {
    const before = selectActiveResult(useSimulationStore.getState())!.metrics.demandKwh;
    renderInsert(pump, 'Water pump');
    expect(screen.getByText(/^Engine: peak/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Insert into simulation' }));
    let s = useSimulationStore.getState();
    expect(s.input.appliances).toEqual([
      expect.objectContaining({ id: 'vision-p1-det-1', sector: 'water', quantity: 1 }),
    ]);
    const after = selectActiveResult(s)!.metrics.demandKwh;
    expect(after).toBeGreaterThan(before);
    expect(screen.getByRole('status').textContent).toContain('strategies re-computed');

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update in simulation' }));
    s = useSimulationStore.getState();
    expect(s.input.appliances).toHaveLength(1);
    expect(s.input.appliances![0]!.quantity).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Remove from simulation' }));
    expect(useSimulationStore.getState().input.appliances).toBeUndefined();
    expect(selectActiveResult(useSimulationStore.getState())!.metrics.demandKwh).toBeCloseTo(
      before
    );
  });

  it('scenery can become a load by hand; out-of-range power blocks the insert', () => {
    renderInsert(house, 'House');
    expect(screen.getByText(/Scenery has no load by default/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Power per unit (W)'), { target: { value: '99999' } });
    expect(screen.getByText('Check the name and the power range.')).toBeTruthy();
    const insert = screen.getByRole('button', {
      name: 'Insert into simulation',
    }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Power per unit (W)'), { target: { value: '400' } });
    fireEvent.click(insert);
    expect(useSimulationStore.getState().input.appliances).toEqual([
      expect.objectContaining({ category: 'other', sector: 'households', watts: 400 }),
    ]);
  });

  it('free placement (PP-T4): place on the map, feeder follows, back to ring', () => {
    renderInsert(pump, 'Water pump');
    expect(screen.getByText('Ring around the building')).toBeTruthy();
    expect(screen.getByLabelText('Feeder line')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Place on the map' }));
    const map = screen.getByRole('application', { name: 'Village map' });
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 230,
      height: 230,
      right: 230,
      bottom: 230,
    } as DOMRect);
    // Top-left (−95, −95) clamps onto the disc near the school; the feeder follows.
    fireEvent.click(map, { clientX: 20, clientY: 20 });
    expect(screen.getByText('Placed: -75.0, -75.0')).toBeTruthy();
    expect(screen.getByLabelText('Feeder line')).toHaveValue('school');
    expect(screen.getByText('Nearest: Primary School')).toBeTruthy();
    // Override the feeder, then Auto restores the nearest.
    fireEvent.change(screen.getByLabelText('Feeder line'), { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(screen.getByLabelText('Feeder line')).toHaveValue('school');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the ring' }));
    expect(screen.getByText('Ring around the building')).toBeTruthy();
  });

  it('stores placed 3D model in usePlacedModelsStore on insert and clears on remove (PI-T1)', () => {
    const recipe: ObjectRecipe = {
      proportions: { w: 1, h: 0.6, d: 0.5 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#336699' }],
    };
    renderInsert(pump, 'Water pump', recipe);
    fireEvent.click(screen.getByRole('button', { name: 'Insert into simulation' }));

    const id = 'vision-p1-det-1';
    const placed = usePlacedModelsStore.getState().getModel(id);
    expect(placed).toBeDefined();
    expect(placed?.applianceId).toBe(id);
    expect(placed?.recipe).toEqual(recipe);
    expect(placed?.scale).toBe(0.9); // machine / pump scale

    // Removing clears from placed models store
    fireEvent.click(screen.getByRole('button', { name: 'Remove from simulation' }));
    expect(usePlacedModelsStore.getState().getModel(id)).toBeUndefined();
  });

  it('chooses grid connection mode: branch (recommended) or direct EMS (PI-T8)', () => {
    const recipe: ObjectRecipe = {
      proportions: { w: 1, h: 0.6, d: 0.5 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#336699' }],
    };
    renderInsert(pump, 'Water pump', recipe);

    // Initial state: branch is recommended and pressed
    const branchBtn = screen.getByRole('button', { name: 'On feeder branch (recommended)' });
    const emsBtn = screen.getByRole('button', { name: 'Direct to Dispatch EMS' });
    expect(branchBtn.getAttribute('aria-pressed')).toBe('true');
    expect(emsBtn.getAttribute('aria-pressed')).toBe('false');

    // Reminder of the sector that bears the load (D1)
    expect(screen.getByText(/Powered by:.*Water/i)).toBeTruthy();

    // Click direct to EMS
    fireEvent.click(emsBtn);
    expect(branchBtn.getAttribute('aria-pressed')).toBe('false');
    expect(emsBtn.getAttribute('aria-pressed')).toBe('true');

    // Insert into simulation
    fireEvent.click(screen.getByRole('button', { name: 'Insert into simulation' }));

    const id = 'vision-p1-det-1';
    const placed = usePlacedModelsStore.getState().getModel(id);
    expect(placed).toBeDefined();
    expect(placed?.connectionMode).toBe('ems');
  });

  it('without a 3D model: no connection selector and no placed model stored (PR #56 review)', () => {
    renderInsert(pump, 'Water pump');
    expect(screen.queryByRole('group', { name: 'Grid connection' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Insert into simulation' }));
    expect(usePlacedModelsStore.getState().getModel('vision-p1-det-1')).toBeUndefined();
  });
});
