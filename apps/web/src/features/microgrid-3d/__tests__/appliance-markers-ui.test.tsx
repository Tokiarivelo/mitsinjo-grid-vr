import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Appliance } from '@mitsinjo/engine';
import { usePlacedModelsStore } from '@/stores';
import type { ObjectRecipe } from '@/lib/object-shape';
import { ApplianceMarkers, MarkerDragGhost } from '../ui/appliance-markers';
import { BADGE_ABOVE_BEACON, BADGE_DISTANCE_FACTOR } from '../ui/scene-badge';
import { APPLIANCE_FOCUS_SCALE } from '../utils/camera-focus';
import { applianceMarkers } from '../utils/appliance-markers';
import { SECTOR_POSITIONS } from '../utils/to-scene-model';

vi.mock('@react-three/drei', () => ({
  Html: ({
    children,
    position,
    distanceFactor,
  }: {
    children: React.ReactNode;
    position?: [number, number, number];
    distanceFactor?: number;
  }) => (
    <div data-html-position={JSON.stringify(position)} data-distance-factor={distanceFactor}>
      {children}
    </div>
  ),
  Instances: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Instance: ({
    position,
    onClick,
    onPointerDown,
    color,
  }: {
    position: [number, number, number];
    onClick?: unknown;
    onPointerDown?: unknown;
    color?: unknown;
  }) => (
    <div
      data-testid={color ? 'mock-beacon' : 'mock-instance'}
      data-position={JSON.stringify(position)}
      data-bound={onClick && onPointerDown ? '1' : ''}
    />
  ),
  Line: ({
    points,
    segments,
  }: {
    points: { x: number; y: number; z: number }[];
    segments?: boolean;
  }) => (
    <div
      data-testid="mock-line"
      data-segments={segments ? '1' : ''}
      data-count={points.length}
      data-p0={JSON.stringify({ x: points[0]!.x, y: points[0]!.y, z: points[0]!.z })}
      data-p1={JSON.stringify({ x: points[1]!.x, y: points[1]!.y, z: points[1]!.z })}
    />
  ),
}));

const pump: Appliance = {
  id: 'p1',
  name: 'Pump',
  category: 'water_pump',
  sector: 'water',
  watts: 750,
  quantity: 2,
};

describe('ApplianceMarkers UI (PP-T3)', () => {
  it('no markers → nothing', () => {
    const { container } = render(
      <ApplianceMarkers markers={[]} selectedSector={null} tagOf={(m) => m.name} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('straight lines disappear by default (PI-T7), but render when requested', () => {
    const markers = applianceMarkers(
      [pump, { ...pump, id: 'p2', position: { x: 30, z: 30 } }],
      SECTOR_POSITIONS,
      12
    );
    const { rerender } = render(
      <ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />
    );
    // By default (PI-T7), straight lines are not rendered (replaced by DistributionLines cables)
    expect(screen.queryAllByTestId('mock-line')).toHaveLength(0);

    // When explicitly enabled (legacy / preview)
    rerender(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        showStraightFeederLinks
      />
    );
    const lines = screen.getAllByTestId('mock-line');
    expect(lines).toHaveLength(1);
  });

  it('instances sit on the ground height; one batched Line links marker tops to feeders', () => {
    const markers = applianceMarkers(
      [pump, { ...pump, id: 'p2', position: { x: 30, z: 30 } }],
      SECTOR_POSITIONS,
      12
    );
    render(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        showStraightFeederLinks
      />
    );
    // Plinth of the first marker: ground + half plinth height (0.12 / 2).
    const instances = screen.getAllByTestId('mock-instance');
    const y0 = (JSON.parse(instances[0]!.dataset.position!) as number[])[1]!;
    expect(y0).toBeCloseTo(markers[0]!.position[1] + 0.06, 9);
    // Feeder links: one segments batch, 2 points per marker, top → feeder anchor.
    const lines = screen.getAllByTestId('mock-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.dataset.segments).toBe('1');
    expect(Number(lines[0]!.dataset.count)).toBe(markers.length * 2);
    const p0 = JSON.parse(lines[0]!.dataset.p0!) as { x: number; y: number; z: number };
    const p1 = JSON.parse(lines[0]!.dataset.p1!) as { x: number; y: number; z: number };
    expect(p0.x).toBeCloseTo(markers[0]!.position[0], 9);
    expect(p0.y).toBeCloseTo(markers[0]!.position[1] + 0.62, 9);
    expect(p1.x).toBeCloseTo(markers[0]!.feeder[0], 9);
    expect(p1.y).toBeCloseTo(markers[0]!.feeder[1], 9);
  });
});

describe('ApplianceMarkers drag UI (PP-T5)', () => {
  const markers = applianceMarkers(
    [pump, { ...pump, id: 'p2', position: { x: 30, z: 30 } }],
    SECTOR_POSITIONS,
    12
  );

  it('selection ring + cyan tag on the selected marker only', () => {
    const { container } = render(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        selectedId="p1"
      />
    );
    expect(container.querySelector('mesh[name="appliance-selection-ring"]')).not.toBeNull();
    const tag1 = container.querySelector('[data-scene-badge="p1"]')!;
    const tag2 = container.querySelector('[data-scene-badge="p2"]')!;
    expect(tag1.className).toContain('border-energy-cyan');
    expect(tag2.className).toContain('border-border');
    expect(tag2.className).not.toContain('border-energy-cyan');
  });

  it('no ring without a matching selection', () => {
    const { container, rerender } = render(
      <ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />
    );
    expect(container.querySelector('mesh[name="appliance-selection-ring"]')).toBeNull();
    rerender(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        selectedId="nope"
      />
    );
    expect(container.querySelector('mesh[name="appliance-selection-ring"]')).toBeNull();
  });

  it('dragged marker hides: instances, tag and feeder link', () => {
    const { container } = render(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        dragId="p1"
        showStraightFeederLinks
      />
    );
    // One plinth + one body instance per marker: the dragged one is gone.
    expect(screen.getAllByTestId('mock-instance')).toHaveLength(2);
    expect(container.querySelector('[data-scene-badge="p1"]')).toBeNull();
    expect(container.querySelector('[data-scene-badge="p2"]')).not.toBeNull();
    const lines = screen.getAllByTestId('mock-line');
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.dataset.count)).toBe(2);
  });

  it('bindMarker handlers reach every instance; inert without them', () => {
    const bound = render(
      <ApplianceMarkers
        markers={markers}
        selectedSector={null}
        tagOf={(m) => m.name}
        bindMarker={() => ({ onClick: vi.fn(), onPointerDown: vi.fn() })}
      />
    );
    for (const inst of screen.getAllByTestId('mock-instance')) {
      expect(inst.dataset.bound).toBe('1');
    }
    bound.unmount();
    render(<ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />);
    for (const inst of screen.getAllByTestId('mock-instance')) {
      expect(inst.dataset.bound).toBe('');
    }
  });

  it('MarkerDragGhost renders a translucent plinth + body pair', () => {
    const ghostRef = { current: null } as React.RefObject<THREE.Group | null>;
    const { container } = render(<MarkerDragGhost ghostRef={ghostRef} visible />);
    const ghost = container.querySelector('group[name="appliance-drag-ghost"]')!;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelectorAll(':scope > mesh')).toHaveLength(2);
  });
});

describe('ApplianceMarkers with Placed Models (PI-T2)', () => {
  beforeEach(() => {
    usePlacedModelsStore.getState().clear();
  });

  const recipe: ObjectRecipe = {
    proportions: { w: 1, h: 0.8, d: 0.6 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#ff6600' }],
  };

  it('renders placed 3D model mesh for appliances with stored recipes and standard instances for others', () => {
    usePlacedModelsStore.getState().upsert({
      applianceId: 'p1',
      recipe,
      scale: 1.0,
      archetype: 'machine',
    });

    const markers = applianceMarkers(
      [pump, { ...pump, id: 'p2', position: { x: 30, z: 30 } }],
      SECTOR_POSITIONS,
      12
    );

    const { container } = render(
      <ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />
    );

    // p1 has a placed 3D model: rendered via placed-appliance-models mesh
    const placedMesh = container.querySelector('mesh[name^="placed-appliance-models"]');
    expect(placedMesh).not.toBeNull();

    // p2 is a standard marker: 1 plinth + 1 body instance rendered
    const instances = screen.getAllByTestId('mock-instance');
    expect(instances).toHaveLength(2);
  });

  it('draws 30 placed objects in one merged mesh per surface family (draw call budget: ≤ 5)', () => {
    const thirtyPumps: Appliance[] = Array.from({ length: 30 }, (_, i) => ({
      ...pump,
      id: `pump-${i}`,
      position: { x: (i % 6) * 4 - 10, z: Math.floor(i / 6) * 4 - 10 },
    }));

    for (const p of thirtyPumps) {
      usePlacedModelsStore.getState().upsert({
        applianceId: p.id,
        recipe,
        scale: 1.0,
        archetype: 'machine',
      });
    }

    const markers = applianceMarkers(thirtyPumps, SECTOR_POSITIONS, 12);
    const { container } = render(
      <ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />
    );

    // All 30 models merged into one mesh per surface family, never more than 5 (PQ-T32).
    const placedMeshes = container.querySelectorAll('mesh[name^="placed-appliance-models"]');
    expect(placedMeshes.length).toBeGreaterThanOrEqual(1);
    expect(placedMeshes.length).toBeLessThanOrEqual(5);

    // Standard instances are completely empty (0 standard markers)
    expect(screen.queryByTestId('mock-instance')).toBeNull();
  });

  it('draws every slope plinth in one instanced batch (no mesh per plinth)', () => {
    const hills: Appliance[] = Array.from({ length: 3 }, (_, i) => ({
      ...pump,
      id: `hill-${i}`,
      position: { x: 30 + i * 3, z: 30 },
    }));
    for (const p of hills) {
      usePlacedModelsStore.getState().upsert({ applianceId: p.id, recipe, scale: 2.0 });
    }
    const { container } = render(
      <ApplianceMarkers
        markers={applianceMarkers(hills, SECTOR_POSITIONS, 12)}
        selectedSector={null}
        tagOf={(m) => m.name}
      />
    );
    const meshes = container.querySelectorAll('mesh');
    // merged models + one invisible hit target per model; plinths are Instance children
    expect(meshes).toHaveLength(1 + hills.length);
    expect(screen.getAllByTestId('mock-instance').length).toBeGreaterThan(0);
  });
});

describe('ApplianceMarkers badge like the buildings (PT-11)', () => {
  const PRIORITIES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const tagged = (priority: 'critical' | 'medium') =>
    applianceMarkers([pump], SECTOR_POSITIONS, 12).map((m) => ({
      ...m,
      kwNow: 1.5,
      tag: { priority, statusColor: 'battery-green' as const, inAlert: false },
    }));

  it('shows the category icon, the title, the priority and the kW now', () => {
    const { container } = render(
      <ApplianceMarkers
        markers={tagged('medium')}
        selectedSector={null}
        tagOf={(m) => m.name}
        priorityLabels={PRIORITIES}
      />
    );
    const badge = container.querySelector('[data-scene-badge="p1"]')!;
    expect(badge.querySelector('[data-appliance-icon="water_pump"]')).not.toBeNull();
    expect(badge.textContent).toContain('Pump');
    expect(badge.textContent).toContain('Medium');
    expect(badge.textContent).toContain('1.50 kW');
    expect(badge.querySelector('[data-priority="medium"]')!.className).not.toContain(
      'text-critical-red'
    );
  });

  it('a critical sector shows its priority in red', () => {
    const { container } = render(
      <ApplianceMarkers
        markers={tagged('critical')}
        selectedSector={null}
        tagOf={(m) => m.name}
        priorityLabels={PRIORITIES}
      />
    );
    expect(container.querySelector('[data-priority="critical"]')!.className).toContain(
      'text-critical-red'
    );
  });

  it('badge click selects the marker', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ApplianceMarkers
        markers={tagged('medium')}
        selectedSector={null}
        tagOf={(m) => m.name}
        onSelectMarker={onSelect}
      />
    );
    fireEvent.click(container.querySelector('[data-scene-badge="p1"]')!);
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('one beacon per badge, the badge at the buildings height rule above it', () => {
    const markers = tagged('medium');
    const { container } = render(
      <ApplianceMarkers markers={markers} selectedSector={null} tagOf={(m) => m.name} />
    );
    const beacons = screen.getAllByTestId('mock-beacon');
    expect(beacons).toHaveLength(1);
    const beaconPos = JSON.parse(beacons[0]!.getAttribute('data-position')!) as number[];
    const badgePos = JSON.parse(
      container
        .querySelector('[data-scene-badge="p1"]')!
        .closest('[data-html-position]')!
        .getAttribute('data-html-position')!
    ) as number[];
    expect(badgePos[1]! - beaconPos[1]!).toBeCloseTo(BADGE_ABOVE_BEACON, 6);
    expect(beaconPos[1]! - markers[0]!.position[1]).toBeGreaterThan(0.62);
  });

  it('badge scale follows the camera focus scale: focused, it reads like a focused building', () => {
    const { container } = render(
      <ApplianceMarkers markers={tagged('medium')} selectedSector={null} tagOf={(m) => m.name} />
    );
    const anchor = container
      .querySelector('[data-scene-badge="p1"]')!
      .closest('[data-html-position]')!;
    expect(Number(anchor.getAttribute('data-distance-factor'))).toBeCloseTo(
      BADGE_DISTANCE_FACTOR * APPLIANCE_FOCUS_SCALE,
      6
    );
  });
});
