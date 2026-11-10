import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { I18nProvider } from '@/lib/i18n';
import { createWristMenu } from '../wrist-menu';
import { WristMenuButton, WristMenuPanel } from '../xr-wrist-menu';

const controllers = [new THREE.Group(), new THREE.Group()];
const gl = { xr: { isPresenting: false, getController: (i: number) => controllers[i] } };

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ gl, camera: new THREE.PerspectiveCamera() }),
  useFrame: vi.fn(),
}));
vi.mock('../wrist-menu-texture', () => ({
  getWristIconTexture: vi.fn(() => null),
  getPillLabelTexture: vi.fn(() => null),
}));

describe('WristMenuButton', () => {
  it('renders the wrist button with no click handler of its own (single input source)', () => {
    const { container } = render(
      <I18nProvider>
        <WristMenuButton menu={createWristMenu()} open={false} />
      </I18nProvider>
    );
    const button = container.querySelector('[name="wrist-menu-button"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('onClick')).toBeNull();
  });

  it('listens to XR connect events to find the left hand, and stops on unmount', () => {
    const add = vi.spyOn(controllers[0]!, 'addEventListener');
    const remove = vi.spyOn(controllers[0]!, 'removeEventListener');
    const { unmount } = render(
      <I18nProvider>
        <WristMenuButton menu={createWristMenu()} open />
      </I18nProvider>
    );
    expect(add).toHaveBeenCalledWith('connected', expect.any(Function));
    unmount();
    expect(remove).toHaveBeenCalledWith('connected', expect.any(Function));
  });
});

describe('WristMenuPanel', () => {
  it('renders its children (the menu content)', () => {
    const { container } = render(
      <WristMenuPanel menu={createWristMenu()}>
        <mesh name="child" />
      </WristMenuPanel>
    );
    expect(container.querySelector('[name="wrist-menu-panel"] [name="child"]')).toBeTruthy();
  });
});
