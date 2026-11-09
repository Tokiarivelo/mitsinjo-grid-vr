import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SpatialAirButton } from '../spatial-air-button';

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-billboard">{children}</div>
  ),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('../spatial-air-button-texture', () => ({
  getSpatialAirButtonTexture: vi.fn(() => ({})),
}));

describe('SpatialAirButton (VS-T2)', () => {
  it('renders the floating button without a click handler of its own', () => {
    // Regression: its R3F onClick plus the blaster's pointerdown scanned twice per click.
    const { container } = render(
      <I18nProvider>
        <SpatialAirButton status="idle" detectedCount={0} />
      </I18nProvider>
    );
    const group = container.querySelector('[name="spatial-air-button-group"]');
    expect(group).toBeTruthy();
    expect(group?.querySelector('boxGeometry')).toBeNull();
  });
});
