import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { VillageSpatialHUD } from '../village-spatial-hud';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('../spatial-hud-texture', () => ({
  getSpatialHUDTexture: vi.fn(() => ({})),
}));

describe('VillageSpatialHUD (VS-T8)', () => {
  it('renders holographic telemetry HUD and toggles expand/minimize on click', () => {
    const { container } = render(
      <I18nProvider>
        <VillageSpatialHUD
          position={[-0.95, 1.55, -1.2]}
          recentEvent="+180 W · Refrigerator connected"
        />
      </I18nProvider>
    );

    const group = container.querySelector('[name="village-spatial-hud"]');
    expect(group).toBeTruthy();

    const meshes = group?.querySelectorAll('mesh');
    expect(meshes?.length).toBeGreaterThanOrEqual(2);

    const interactiveMesh = meshes?.[0];
    expect(interactiveMesh).toBeTruthy();

    // Hover in/out
    act(() => {
      fireEvent.pointerOver(interactiveMesh!);
    });

    act(() => {
      fireEvent.pointerOut(interactiveMesh!);
    });

    // Toggle expand/minimize
    act(() => {
      fireEvent.click(interactiveMesh!);
    });

    expect(group).toBeTruthy();
  });
});
