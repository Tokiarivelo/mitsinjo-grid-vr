import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SpatialAirButton } from '../spatial-air-button';

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: any) => <div data-testid="mock-billboard">{children}</div>,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('../spatial-air-button-texture', () => ({
  getSpatialAirButtonTexture: vi.fn(() => ({})),
}));

describe('SpatialAirButton (VS-T2)', () => {
  it('renders and invokes onTriggerScan when clicked', () => {
    const onTrigger = vi.fn();
    const { container } = render(
      <I18nProvider>
        <SpatialAirButton status="idle" detectedCount={0} onTriggerScan={onTrigger} />
      </I18nProvider>
    );

    const group = container.querySelector('[name="spatial-air-button-group"]');
    expect(group).toBeTruthy();

    const clickableMesh = group?.querySelector('mesh');
    expect(clickableMesh).toBeTruthy();

    act(() => {
      fireEvent.click(clickableMesh!);
    });

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
