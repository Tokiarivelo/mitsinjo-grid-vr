import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { faderLevelAt, SimXrDispatchPanel } from '../sim-xr-dispatch-panel';
import { sectorFader } from '../../utils/dispatch-mixer';

const texts: string[] = [];
vi.mock('@/features/vision-insert/ui/xr/holo-style', () => ({
  HOLO: new Proxy({}, { get: () => '#00ffff' }),
  holoCardTexture: (spec: { lines: { text: string }[] }) => {
    texts.push(...spec.lines.map((l) => l.text));
    return {};
  },
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (sel: (s: unknown) => unknown) => sel({ camera: { parent: null } }),
}));
vi.mock('../sim-xr-holo', async (orig) => ({
  ...(await orig<typeof import('../sim-xr-holo')>()),
  useOpenInFront: vi.fn(),
}));

function setup(hasResult = true) {
  texts.length = 0;
  const props = {
    battery: { socPct: 62, minSocPct: 20, level: 0.8 },
    hasResult,
    sectors: [
      { sector: 'households' as const, fader: sectorFader(3, null), servedKw: 2.5 },
      {
        sector: 'school' as const,
        fader: sectorFader(2, { sector: 'school', maxKw: 0, fromHour: 19, toHour: 24 }),
        servedKw: 0,
      },
    ],
    appliances: Array.from({ length: 8 }, (_, i) => ({
      id: `ph-${i}`,
      name: `Fridge ${i}`,
      level: i === 0 ? 0 : 1,
      kwNow: 0.1,
    })),
    refused: false,
    canUndo: false,
    onStart: vi.fn(),
    onReserve: vi.fn(),
    onSector: vi.fn(),
    onSectorCut: vi.fn(),
    onAppliance: vi.fn(),
    onUndo: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <I18nProvider>
      <SimXrDispatchPanel {...props} />
    </I18nProvider>
  );
  const byName = (n: string) => view.container.querySelector(`[name="${n}"]`);
  return { ...view, props, byName };
}

describe('SimXrDispatchPanel (VS-T34)', () => {
  it('shows a fader for the battery, each sector and up to six dispatcher appliances', () => {
    const { container } = setup();
    const faders = container.querySelectorAll('[name^="sim-xr-fader-"]');
    // battery + 2 sectors + 6 of the 8 appliances
    expect(faders).toHaveLength(9);
    expect(texts).toContain('+2 more on the 2D panel');
    expect(texts).toContain('Battery');
    expect(texts).toContain('Reserve 20%');
    expect(texts).toContain('Served 2.5 kW');
    expect(texts).toContain('No limit');
  });

  it('« Cut » / « On » per strip: a cut sector turns back on, an off appliance too', () => {
    const { byName, props } = setup();
    fireEvent.click(byName('sim-xr-button-mixer-cut-households')!);
    expect(props.onSectorCut).toHaveBeenCalledWith('households', true);
    fireEvent.click(byName('sim-xr-button-mixer-on-school')!);
    expect(props.onSectorCut).toHaveBeenCalledWith('school', false);
    fireEvent.click(byName('sim-xr-button-mixer-on-ph-0')!);
    expect(props.onAppliance).toHaveBeenCalledWith('ph-0', 1);
    fireEvent.click(byName('sim-xr-button-mixer-cut-ph-1')!);
    expect(props.onAppliance).toHaveBeenCalledWith('ph-1', 0);
  });

  it('« Start the battery & dispatch » runs once, then reads « Dispatching »', () => {
    const idle = setup(false);
    fireEvent.click(idle.byName('sim-xr-button-mixer-start')!);
    expect(idle.props.onStart).toHaveBeenCalledTimes(1);
    idle.unmount();
    setup(true);
    expect(texts).toContain('Dispatching');
  });

  it('maps the laser height on the track to a level, clamped', () => {
    expect(faderLevelAt(0)).toBeCloseTo(0.5);
    expect(faderLevelAt(-1)).toBe(0);
    expect(faderLevelAt(1)).toBe(1);
  });
});
