import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import en from '@/messages/en.json';
import { layoutHoloCard } from '../holo-style';
import { SpatialInteractionGuide } from '../spatial-interaction-guide';

const xr = vi.hoisted(() => ({ isPresenting: false }));
vi.mock('@react-three/fiber', () => ({
  useThree: (sel: (s: unknown) => unknown) => sel({ gl: { xr } }),
}));
vi.mock('../holo-ui', () => ({
  HoloFrame: () => null,
  HoloText: ({ spec }: { spec: { lines: { text: string }[] } }) => (
    <p>{spec.lines.map((l) => l.text).join(' ')}</p>
  ),
}));

const show = () =>
  render(
    <I18nProvider>
      <SpatialInteractionGuide position={[0, 1.05, -1.2]} />
    </I18nProvider>
  );

describe('SpatialInteractionGuide', () => {
  it('shows the mouse guide on a screen, the controller guide in VR', () => {
    const { container, getByText, unmount } = show();
    expect(container.querySelector('[name="spatial-interaction-guide"]')).toBeTruthy();
    expect(getByText(en.features.visionInsert.vrInteractionGuideDesktop)).toBeTruthy();
    unmount();
    xr.isPresenting = true;
    expect(show().getByText(en.features.visionInsert.vrInteractionGuideVR)).toBeTruthy();
  });

  it('wraps the long VR guide inside its card instead of running off it (VS-T32, regression)', () => {
    // Before: one 22 px line on a 512 px canvas; the French guide ran past both ends.
    const measure = (_font: string, s: string) => s.length * 22; // ~bold 40 px glyphs
    const { blocks } = layoutHoloCard(
      measure,
      [
        {
          text: '🎮 A/X analyser · B/Y retour · Gâchette sélectionner · ✋ Pincer sélectionner',
          size: 40,
        },
      ],
      1024,
      180
    );
    expect(blocks[0]!.rows.length).toBe(2);
    for (const row of blocks[0]!.rows) expect(measure('', row)).toBeLessThanOrEqual(1024);
  });
});
