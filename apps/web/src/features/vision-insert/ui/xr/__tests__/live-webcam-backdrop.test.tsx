import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { LiveWebcamBackdrop } from '../live-webcam-backdrop';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

describe('LiveWebcamBackdrop (VS-T10)', () => {
  it('renders 360 atmosphere dome, curved video screen, and registers frame capture callback', () => {
    const onRegister = vi.fn();

    const { container } = render(
      <I18nProvider>
        <LiveWebcamBackdrop onRegisterCapture={onRegister} />
      </I18nProvider>
    );

    const root = container.querySelector('[name="live-webcam-backdrop-root"]');
    expect(root).toBeTruthy();

    const curvedScreen = root?.querySelector('[name="curved-webcam-screen"]');
    expect(curvedScreen).toBeTruthy();

    // Verify atmosphere meshes (dome, horizon rings, floor)
    const meshes = root?.querySelectorAll('mesh');
    expect(meshes?.length).toBeGreaterThanOrEqual(5);

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(typeof onRegister.mock.calls[0]![0]).toBe('function');
  });
});
