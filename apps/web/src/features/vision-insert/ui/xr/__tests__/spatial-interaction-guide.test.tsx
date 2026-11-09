import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SpatialInteractionGuide } from '../spatial-interaction-guide';

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: { xr: { isPresenting: false } },
  }),
}));

describe('SpatialInteractionGuide', () => {
  it('renders spatial interaction guide group', () => {
    const { container } = render(
      <I18nProvider>
        <SpatialInteractionGuide position={[0, 1.05, -1.2]} />
      </I18nProvider>
    );

    const group = container.querySelector('[name="spatial-interaction-guide"]');
    expect(group).toBeTruthy();
  });
});
