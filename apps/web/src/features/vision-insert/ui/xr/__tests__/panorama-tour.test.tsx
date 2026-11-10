import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { I18nProvider } from '@/lib/i18n';
import { PanoramaTour } from '../tour/panorama-tour';
import { tourArrows } from '../tour/tour-nav';
import { TOUR_ROOMS } from '../tour/tour-data';

const three = vi.hoisted(() => ({
  frame: null as null | ((state: unknown, delta: number) => void),
  canvas: null as HTMLCanvasElement | null,
  camera: null as unknown,
}));

vi.mock('@react-three/fiber', async () => {
  const T = await import('three');
  three.canvas = document.createElement('canvas');
  three.camera = new T.PerspectiveCamera();
  return {
    useThree: () => ({ gl: { xr: {}, domElement: three.canvas }, camera: three.camera }),
    useFrame: (fn: (state: unknown, delta: number) => void) => {
      three.frame = fn;
    },
  };
});
vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children?: React.ReactNode }) => <group>{children}</group>,
}));
vi.mock('../wrist-menu-texture', () => ({ getPillLabelTexture: vi.fn(() => null) }));

function view(
  uFront: number | null,
  onRegisterCapture = vi.fn(),
  arrows = tourArrows(TOUR_ROOMS.loft, uFront ?? 0.8),
  onWalk = vi.fn()
) {
  return (
    <I18nProvider>
      <PanoramaTour
        room="loft"
        uFront={uFront}
        arrows={arrows}
        pending={null}
        onArrive={vi.fn()}
        onWalk={onWalk}
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

  it('walks while Z is held: the floor arrows come closer, and walking onto one goes through', () => {
    const arrows = tourArrows(TOUR_ROOMS.loft, 0.8);
    const hall = arrows.find((a) => a.to === 'hall')!;
    const onWalk = vi.fn();
    render(view(0.8, vi.fn(), arrows, onWalk));
    const camera = three.camera as THREE.PerspectiveCamera;
    camera.position.set(0, 1.6, 0);
    camera.lookAt(hall.position[0], 1.6, hall.position[2]);
    camera.updateMatrixWorld();
    three.canvas!.dispatchEvent(new Event('pointerenter'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));

    const start = Math.hypot(hall.position[0], hall.position[2]);
    three.frame!({}, 0.1);
    three.frame!({}, 0.1);
    expect(Math.hypot(hall.position[0], hall.position[2])).toBeLessThan(start);
    expect(onWalk).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) three.frame!({}, 0.1);
    expect(onWalk).toHaveBeenCalledWith('hall');

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z' }));
  });

  it('ignores walking keys while the pointer is away from the scene (page still scrolls)', () => {
    const arrows = tourArrows(TOUR_ROOMS.loft, 0.8);
    const before = arrows.map((a) => [...a.position]);
    render(view(0.8, vi.fn(), arrows));
    three.canvas!.dispatchEvent(new Event('pointerleave'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    for (let i = 0; i < 5; i++) three.frame!({}, 0.1);
    expect(arrows.map((a) => [...a.position])).toEqual(before);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }));
  });
});
