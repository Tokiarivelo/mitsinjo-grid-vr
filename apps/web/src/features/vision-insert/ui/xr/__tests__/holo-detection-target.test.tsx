import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import { projectDetectionsTo3D } from '../spatial-projection';
import { HoloDetectionTarget } from '../holo-detection-target';

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-billboard">{children}</div>
  ),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

const cardTexts: string[][] = [];
vi.mock('../holo-ui', () => ({
  HoloText: ({ spec }: { spec: { lines: Array<{ text: string }> } }) => {
    cardTexts.push(spec.lines.map((l) => l.text));
    return <div data-testid="holo-card">{spec.lines.map((l) => l.text).join(' | ')}</div>;
  },
}));

describe('HoloDetectionTarget (VS-T4, outline VS-T18)', () => {
  const detection: ApplianceDetection = {
    id: 'target-fridge',
    label: 'Fridge',
    category: 'fridge',
    box: { x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
    description: 'Tall white fridge with two doors',
  };
  const [target] = projectDetectionsTo3D([detection]);

  const renderTarget = (isMaterialized: boolean, hovered = false) =>
    render(
      <I18nProvider>
        <HoloDetectionTarget target={target!} hovered={hovered} isMaterialized={isMaterialized} />
      </I18nProvider>
    );

  it('traces the outline on the view and labels it with name + brief description under the laser', () => {
    const { container, getByTestId } = renderTarget(false, true);
    const group = container.querySelector('[name="holo-target-target-fridge"]');
    expect(group?.querySelector('[name="holo-outline"] lineLoop')).toBeTruthy();
    expect(getByTestId('holo-card').textContent).toContain('Fridge');
    expect(getByTestId('holo-card').textContent).toContain('Tall white fridge with two doors');
  });

  it('shows no label card on an analysed outline until the laser hovers it (VS-T42)', () => {
    // Regression: every analysed object kept its name card, the view was covered in labels.
    const { container } = renderTarget(false);
    expect(container.querySelector('lineLoop')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-billboard"]')).toBeNull();
  });

  it('has no click collider of its own: XRBlasterController is the single input source', () => {
    // Regression: an R3F onClick here plus the blaster's pointerdown fired two shots per click.
    const { container } = renderTarget(false);
    const meshes = container.querySelectorAll('[name="holo-target-target-fridge"] > mesh');
    expect(meshes).toHaveLength(0);
  });

  it('drops the outline once materialized; its card shows only under the laser', () => {
    // Regression (2026-11-17): the card stayed on once the miniature stood in front, over the
    // miniature's own card (« Put away »).
    const { container } = renderTarget(true);
    expect(container.querySelector('lineLoop')).toBeNull();
    expect(container.querySelector('[data-testid="mock-billboard"]')).toBeNull();
    const hovered = renderTarget(true, true);
    expect(hovered.container.querySelector('[data-testid="mock-billboard"]')).toBeTruthy();
  });

  it('hides its label card under an open panel, keeps the outline', () => {
    // Regression: the card drew over the « Extract in 3D? » dialog (both without depth).
    const { container } = render(
      <I18nProvider>
        <HoloDetectionTarget target={target!} hovered isMaterialized={false} hideLabel />
      </I18nProvider>
    );
    expect(container.querySelector('[data-testid="mock-billboard"]')).toBeNull();
    expect(container.querySelector('lineLoop')).toBeTruthy();
  });
});
