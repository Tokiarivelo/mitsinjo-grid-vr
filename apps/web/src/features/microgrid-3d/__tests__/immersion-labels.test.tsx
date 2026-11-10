import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Priority, SectorId } from '@mitsinjo/engine';
import { scenarios, simulate } from '@mitsinjo/engine';
import { I18nProvider } from '@/lib/i18n';
import { toSceneModel } from '../utils/to-scene-model';
import { AirOptionBeacon, ImmersionLabels } from '../ui/immersion-labels';

// Mock Drei Billboard and R3F
vi.mock('@react-three/drei', () => ({
  Billboard: ({
    children,
    position,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { position?: unknown }) => (
    <div data-testid="mock-billboard" data-position={JSON.stringify(position)} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

const mockSectorNames: Record<SectorId, string> = {
  health: 'Health Clinic',
  water: 'Water Pumping Station',
  school: 'Primary School',
  households: 'Village Households',
  market: 'Local Market & Artisans',
  industry: 'Carpentry Workshop',
};

const mockPriorityLabels: Record<Priority, string> = {
  critical: 'Vital',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

describe('AirOptionBeacon', () => {
  it('renders with correct default position and triggers onToggle on click', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <I18nProvider>
        <AirOptionBeacon active={false} onToggle={onToggle} />
      </I18nProvider>
    );

    const toggleGroup = container.querySelector('[name="air-option-toggle"]');
    expect(toggleGroup).toBeDefined();

    // Click triggers onToggle
    act(() => {
      fireEvent.click(toggleGroup!);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ImmersionLabels', () => {
  const input = scenarios.baseline.input;
  const result = simulate(input, 'proportional');
  const model = toSceneModel({ input, result, timeIndex: 12 });

  it('renders beacon and toggles all 11 village types upon clicking', () => {
    const onSelectSector = vi.fn();
    const { container } = render(
      <I18nProvider>
        <ImmersionLabels
          model={model}
          selectedSector={null}
          onSelectSector={onSelectSector}
          sectorNames={mockSectorNames}
          priorityLabels={mockPriorityLabels}
        />
      </I18nProvider>
    );

    // Initially active is false: tags are not rendered yet
    expect(container.querySelector('[name="vtag-households"]')).toBeNull();

    // Click the air option beacon
    const toggleGroup = container.querySelector('[name="air-option-toggle"]');
    expect(toggleGroup).not.toBeNull();
    act(() => {
      fireEvent.click(toggleGroup!);
    });

    // Now all 11 tags are rendered across diorama
    expect(container.querySelector('[name="vtag-households"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-school"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-water"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-market"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-health"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-industry"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-solar"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-battery"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-controller"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-wind"]')).not.toBeNull();
    expect(container.querySelector('[name="vtag-lake"]')).not.toBeNull();

    // Clicking a sector tag badge calls onSelectSector
    const schoolTag = container.querySelector('[name="vtag-school"]');
    const badgeMesh = schoolTag?.querySelector('[data-testid="mock-billboard"] mesh');
    if (badgeMesh) {
      act(() => {
        fireEvent.click(badgeMesh);
      });
      expect(onSelectSector).toHaveBeenCalledWith('school');
    }
  });

  it('respects controlled showLabels prop and onToggleLabels callback', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <I18nProvider>
        <ImmersionLabels
          model={model}
          selectedSector={null}
          onSelectSector={vi.fn()}
          sectorNames={mockSectorNames}
          priorityLabels={mockPriorityLabels}
          showLabels={true}
          onToggleLabels={onToggle}
        />
      </I18nProvider>
    );

    // Shows tags immediately because showLabels is true
    expect(container.querySelector('[name="vtag-households"]')).not.toBeNull();

    // Clicking beacon invokes onToggleLabels
    const toggleGroup = container.querySelector('[name="air-option-toggle"]');
    act(() => {
      fireEvent.click(toggleGroup!);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
