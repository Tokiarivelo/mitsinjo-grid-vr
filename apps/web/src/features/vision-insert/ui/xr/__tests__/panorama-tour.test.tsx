import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { I18nProvider } from '@/lib/i18n';
import { PanoramaTour } from '../tour/panorama-tour';

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ gl: { xr: {} }, camera: new THREE.PerspectiveCamera() }),
  useFrame: vi.fn(),
}));
vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children?: React.ReactNode }) => <group>{children}</group>,
}));
vi.mock('../wrist-menu-texture', () => ({ getPillLabelTexture: vi.fn(() => null) }));

function view(uFront: number | null, onRegisterCapture = vi.fn()) {
  return (
    <I18nProvider>
      <PanoramaTour
        room="loft"
        uFront={uFront}
        pending={null}
        onArrive={vi.fn()}
        onWalk={vi.fn()}
        onRegisterCapture={onRegisterCapture}
      />
    </I18nProvider>
  );
}

describe('PanoramaTour (VS-T14)', () => {
  it('draws the photo sphere and one floor arrow per doorway', () => {
    const { container } = render(view(0.8));
    expect(container.querySelector('[name="panorama-sphere"]')).toBeTruthy();
    expect(container.querySelector('[name="tour-arrow-hall"]')).toBeTruthy();
    expect(container.querySelector('[name="tour-arrow-bedroom"]')).toBeTruthy();
  });

  it('registers its scan function once the heading is known, and unregisters on unmount', () => {
    const onRegisterCapture = vi.fn();
    const { rerender, unmount } = render(view(null, onRegisterCapture));
    expect(onRegisterCapture).toHaveBeenLastCalledWith(null);
    rerender(view(0.8, onRegisterCapture));
    expect(typeof onRegisterCapture.mock.calls.at(-1)![0]).toBe('function');
    unmount();
    expect(onRegisterCapture).toHaveBeenLastCalledWith(null);
  });
});
