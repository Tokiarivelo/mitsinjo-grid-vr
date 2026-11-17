import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { I18nProvider } from '@/lib/i18n';
import en from '@/messages/en.json';
import type { ApplianceDetection } from '@/lib/vision';
import type { ObjectRecipe } from '@/lib/object-shape';
import { resetSimulationStore, usePlacedModelsStore, useSimulationStore } from '@/stores';
import type { HoloPanelHandlers } from '../holo-panel';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  end: vi.fn(() => Promise.resolve()),
  presenting: false,
}));
const panels = vi.hoisted(() => new Map<string, HoloPanelHandlers>());
const draws = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock('@react-three/fiber', () => ({
  useThree: (sel: (s: unknown) => unknown) =>
    sel({
      gl: {
        xr: {
          getSession: () => ({ end: nav.end }),
          get isPresenting() {
            return nav.presenting;
          },
        },
      },
    }),
  useFrame: vi.fn(),
}));
vi.mock('../holo-panel', () => ({
  useHoloPanel: (registry: unknown, id: string, handlers: HoloPanelHandlers) => {
    if (registry) panels.set(id, handlers);
    return () => {};
  },
}));
vi.mock('../holo-ui', () => ({
  HoloFrame: () => null,
  HoloText: ({ spec }: { spec: { lines: { text: string }[] } }) => (
    <p>{spec.lines.map((l) => l.text).join(' | ')}</p>
  ),
  HoloButton: (p: { label: string; disabled?: boolean; onSelect?: () => void }) => (
    <button type="button" disabled={p.disabled} onClick={p.onSelect}>
      {p.label}
    </button>
  ),
}));

vi.mock('@/features/microgrid-3d/utils/sim-xr-map-draw', () => ({
  drawVillageMap: (_ctx: unknown, o: Record<string, unknown>) => draws.push(o),
}));

import { useXrWorld } from '../xr-world-switch';
import { useXrHandoff } from '@/features/microgrid-3d/utils/xr-handoff';
import { HoloVillageTable } from '../holo-village-table';
import { HOLO } from '../holo-style';

const v = en.features.visionInsert;
const pump: ApplianceDetection = {
  id: 'det-1',
  label: 'Water pump',
  category: 'water_pump',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
};
const recipe: ObjectRecipe = {
  proportions: { w: 1, h: 0.6, d: 0.5 },
  parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#336699' }],
};

const setup = () =>
  render(
    <I18nProvider>
      <HoloVillageTable
        registry={{ objects: [], add: vi.fn(), remove: vi.fn() }}
        hoveredId={null}
        detection={pump}
        name="Water pump"
        photo="p1"
        recipe={recipe}
      />
    </I18nProvider>
  );
const tapTable = (u: number, w: number) =>
  act(() =>
    panels.get('holo:village-map')!.onSelect!({ uv: { x: u, y: w } } as THREE.Intersection)
  );

describe('HoloVillageTable (VS-T28)', () => {
  beforeEach(() => {
    panels.clear();
    nav.push.mockClear();
    nav.end.mockClear();
    resetSimulationStore();
    usePlacedModelsStore.setState({ models: {} });
  });

  it('asks to place first: « Add » and « Go to the simulation » wait', () => {
    setup();
    expect(screen.getByText(/Place « Water pump » in the village/)).toBeTruthy();
    expect(screen.getByText(new RegExp(v.vrVillage.notPlaced))).toBeTruthy();
    expect(screen.getByRole('button', { name: v.insertButton })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: v.vrVillage.goSimulation })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('a tap on the table places it; « Add » puts the line and the edited model in the village', () => {
    setup();
    tapTable(0.75, 0.3); // east, south of the centre
    expect(screen.getByText(/Placed at .* · feeder:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: v.insertButton }));
    const line = useSimulationStore
      .getState()
      .input.appliances?.find((a) => a.id.includes('det-1'));
    expect(line?.position?.x).toBeGreaterThan(0);
    expect(line?.position?.z).toBeGreaterThan(0);
    expect(Object.values(usePlacedModelsStore.getState().models)[0]?.recipe).toEqual(recipe);
    expect(screen.getByText(new RegExp(v.vrVillage.inSimulation))).toBeTruthy();
    expect(screen.getByRole('button', { name: v.insertUpdate })).toBeTruthy();
  });

  it('« Go to the simulation » off the headset opens /simulation', () => {
    nav.presenting = false;
    setup();
    tapTable(0.6, 0.6);
    fireEvent.click(screen.getByRole('button', { name: v.insertButton }));
    fireEvent.click(screen.getByRole('button', { name: v.vrVillage.goSimulation }));
    expect(nav.push).toHaveBeenCalledWith('/simulation?immersion=vr');
  });

  it('« Go to the simulation » in the headset keeps the session and swaps to the village (VS-T49)', () => {
    useXrWorld.getState().reset();
    nav.presenting = true;
    nav.end.mockClear();
    setup();
    tapTable(0.6, 0.6);
    fireEvent.click(screen.getByRole('button', { name: v.insertButton }));
    fireEvent.click(screen.getByRole('button', { name: v.vrVillage.goSimulation }));
    expect(nav.end).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(useXrWorld.getState()).toMatchObject({ phase: 'cover', target: 'village' });
    expect(useXrHandoff.getState().pending?.at).toBeTruthy();
    nav.presenting = false;
    useXrWorld.getState().reset();
  });

  it('the table is the /simulation map: named buildings, feeder in green, no walker (VS-T39)', () => {
    draws.length = 0;
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as CanvasRenderingContext2D);
    setup();
    spy.mockRestore();
    const o = draws.at(-1) as {
      names: (id: string) => string;
      tone: (id: string) => string;
      arrow?: number;
    };
    expect(o.arrow).toBeUndefined();
    expect(o.names('school')).toBe(en.sectors.school);
    expect(o.names('dispatcher')).toBe(en.features.simulation.villageTags.controllerTitle);
    // The pump's default feeder (water) is highlighted; the other buildings stay cyan.
    expect(o.tone('water')).toBe(HOLO.green);
    expect(o.tone('school')).toBe(HOLO.cyan);
    expect(o.tone('dispatcher')).toBe(HOLO.violet);
  });

  it('electric switch (VS-T40): « Non-electric · no pole » inserts a zero-duty line', () => {
    setup();
    tapTable(0.7, 0.4);
    fireEvent.click(screen.getByRole('button', { name: v.insertElectric }));
    expect(screen.getByRole('button', { name: v.insertNonElectric })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: v.insertButton }));
    const line = useSimulationStore
      .getState()
      .input.appliances?.find((a) => a.id.includes('det-1'));
    expect(line?.hourlyDuty?.every((d) => d === 0)).toBe(true);
    // Never wired to the dispatcher.
    expect(Object.values(usePlacedModelsStore.getState().models)[0]?.connectionMode).toBe('branch');
  });
});
