import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { PlaceMinimap } from '../ui/place-minimap';
import { KEEP_OUT_ZONES } from '@/features/microgrid-3d/utils/landscape';

const rect = (width = 230, height = 230) =>
  ({ left: 0, top: 0, width, height, right: width, bottom: height }) as DOMRect;

function setup(
  value: { x: number; z: number } | null = null,
  connectionMode: 'branch' | 'ems' = 'branch'
) {
  const onPlace = vi.fn();
  const utils = render(
    <I18nProvider>
      <PlaceMinimap
        value={value}
        sector="water"
        onPlace={onPlace}
        connectionMode={connectionMode}
      />
    </I18nProvider>
  );
  return { ...utils, onPlace, map: screen.getByRole('application', { name: 'Village map' }) };
}

describe('PlaceMinimap (PP-T4, PI-T9)', () => {
  it('shows the six buildings, EMS shelter, derivation cable, and the placed dot', () => {
    setup({ x: 30, z: 30 });
    expect(screen.getByTestId('minimap-ems').textContent).toBe('EMS');
    expect(screen.getByTestId('minimap-derivation')).toBeTruthy();
    expect(screen.getByTestId('minimap-tap')).toBeTruthy();
    expect(screen.getByText('Arrows move the cursor. Enter places.')).toBeTruthy();
  });

  it('draws derivation connecting to Dispatch EMS in ems mode (PI-T9)', () => {
    setup({ x: 25, z: 25 }, 'ems');
    const tap = screen.getByTestId('minimap-tap');
    // EMS is at [0, 0, 1]
    expect(Number(tap.getAttribute('cx'))).toBe(0);
    expect(Number(tap.getAttribute('cy'))).toBe(1);
    expect(screen.getByTestId('minimap-derivation')).toBeTruthy();
  });

  it('click sets the spot (client px → map units)', () => {
    const { map, onPlace } = setup();
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue(rect());
    // Centre of a 230 px map = village centre.
    fireEvent.click(map, { clientX: 115, clientY: 115 });
    expect(onPlace).toHaveBeenCalledWith({ x: 0, z: 0 });
    // Village view (VS-T39): the top-left corner clamps into ±40.
    fireEvent.click(map, { clientX: 0, clientY: 0 });
    expect(onPlace).toHaveBeenCalledWith({ x: -38, z: -38 });
    // Whole terrain: the corner reaches ±115.
    fireEvent.click(screen.getByRole('button', { name: 'Whole terrain' }));
    fireEvent.click(map, { clientX: 0, clientY: 0 });
    expect(onPlace).toHaveBeenCalledWith({ x: -113, z: -113 });
    expect(screen.getByRole('button', { name: 'Village' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('keyboard: arrows move the cursor (announced), Enter places', () => {
    const { map, onPlace } = setup();
    // Cursor starts on the sector building: water (−10.5, 0.5).
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    expect(screen.getByText('Cursor: -8.5, 0.5')).toBeTruthy();
    fireEvent.keyDown(map, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByText('Cursor: -8.5, 10.5')).toBeTruthy();
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.keyDown(map, { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledWith({ x: -8.5, z: 10.5 });
  });

  it('draws placed objects (not its own) and warns when the cursor is on an obstacle (PI-T3)', () => {
    const zones = [
      ...KEEP_OUT_ZONES,
      { id: 'other', x: 30, z: 30, r: 2 },
      { id: 'me', x: 0, z: 40, r: 2 },
    ];
    const { container } = render(
      <I18nProvider>
        <PlaceMinimap value={null} sector="water" onPlace={vi.fn()} zones={zones} excludeId="me" />
      </I18nProvider>
    );
    expect(container.querySelectorAll('[data-testid^="minimap-object-"]')).toHaveLength(1);
    expect(screen.getByTestId('minimap-object-other')).toBeTruthy();
    // Cursor starts on the water building: blocked.
    expect(screen.getByText(/Spot taken/)).toBeTruthy();
  });

  it('is drawn like the /simulation map: roads, water, paddy, named buildings, north (VS-T39)', () => {
    setup();
    expect(screen.getAllByTestId('minimap-road').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByTestId('minimap-water')).toHaveLength(2); // lake + pond
    expect(screen.getByTestId('minimap-paddy')).toBeTruthy();
    for (const name of ['Primary School', 'Health Clinic', 'Local Market & Artisans']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText('N')).toBeTruthy();
    // The feeder building is highlighted.
    expect(screen.getByTestId('minimap-sector-water').innerHTML).toContain('energy-cyan');
  });

  it('opens on the whole terrain when the spot is out of the village view', () => {
    setup({ x: 80, z: -60 });
    expect(screen.getByRole('button', { name: 'Village' })).toBeTruthy();
  });
});
