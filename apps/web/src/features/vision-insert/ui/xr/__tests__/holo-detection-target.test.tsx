import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { SpatialTarget } from '../spatial-projection';
import { HoloDetectionTarget } from '../holo-detection-target';

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-billboard">{children}</div>
  ),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('../holo-target-texture', () => ({
  getHoloTargetTexture: vi.fn(() => ({})),
}));

describe('HoloDetectionTarget (VS-T4)', () => {
  const mockTarget: SpatialTarget = {
    id: 'target-fridge',
    detection: {
      id: 'target-fridge',
      label: 'Fridge',
      category: 'fridge',
      box: { x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
    },
    position: [0.5, 1.2, -2.0],
    dimensions: [0.5, 0.7, 0.4],
    hitRadius: 0.45,
    spawnPosition: [0.3, 1.3, -1.2],
    spawnDimensions: [0.4, 0.6, 0.3],
  };

  const renderTarget = (isMaterialized: boolean) =>
    render(
      <I18nProvider>
        <HoloDetectionTarget target={mockTarget} hovered={false} isMaterialized={isMaterialized} />
      </I18nProvider>
    );

  it('renders the hologram frame and label over its object', () => {
    const { container } = renderTarget(false);
    const group = container.querySelector('[name="holo-target-target-fridge"]');
    expect(group).toBeTruthy();
    expect(group?.querySelector('lineSegments')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-billboard"]')).toBeTruthy();
  });

  it('has no click collider of its own: XRBlasterController is the single input source', () => {
    // Regression: an R3F onClick here plus the blaster's pointerdown fired two shots
    // per click (materialize, then connect at once).
    const { container } = renderTarget(false);
    const meshes = container.querySelectorAll('[name="holo-target-target-fridge"] > mesh');
    expect(meshes).toHaveLength(0);
  });

  it('hides the wireframe once materialized and keeps the label', () => {
    const { container } = renderTarget(true);
    expect(container.querySelector('lineSegments')).toBeNull();
    expect(container.querySelector('[data-testid="mock-billboard"]')).toBeTruthy();
  });
});
