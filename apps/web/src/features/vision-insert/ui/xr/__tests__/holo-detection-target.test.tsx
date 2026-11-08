import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { SpatialTarget } from '../spatial-projection';
import { HoloDetectionTarget } from '../holo-detection-target';

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: any) => <div data-testid="mock-billboard">{children}</div>,
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
  };

  it('renders target group and triggers onShootTarget on click', () => {
    const onShoot = vi.fn();
    const onHover = vi.fn();

    const { container } = render(
      <I18nProvider>
        <HoloDetectionTarget
          target={mockTarget}
          hovered={false}
          isMaterialized={false}
          onHoverChange={onHover}
          onShootTarget={onShoot}
        />
      </I18nProvider>
    );

    const group = container.querySelector('[name="holo-target-target-fridge"]');
    expect(group).toBeTruthy();

    const clickMesh = group?.querySelector('mesh');
    expect(clickMesh).toBeTruthy();

    act(() => {
      fireEvent.click(clickMesh!);
    });

    expect(onShoot).toHaveBeenCalledWith('target-fridge');
  });

  it('triggers onHoverChange on pointer enter and pointer leave', () => {
    const onShoot = vi.fn();
    const onHover = vi.fn();

    const { container } = render(
      <I18nProvider>
        <HoloDetectionTarget
          target={mockTarget}
          hovered={false}
          isMaterialized={false}
          onHoverChange={onHover}
          onShootTarget={onShoot}
        />
      </I18nProvider>
    );

    const clickMesh = container.querySelector('[name="holo-target-target-fridge"] mesh');
    expect(clickMesh).toBeTruthy();

    act(() => {
      fireEvent.pointerOver(clickMesh!);
    });
    expect(onHover).toHaveBeenCalledWith('target-fridge', true);

    act(() => {
      fireEvent.pointerOut(clickMesh!);
    });
    expect(onHover).toHaveBeenCalledWith('target-fridge', false);
  });
});
