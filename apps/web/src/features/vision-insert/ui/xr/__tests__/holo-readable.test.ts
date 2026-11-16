import { describe, expect, it, vi } from 'vitest';
import { HOLO_TEXT_DMM, holoTextPx } from '../holo-style';
import { drawHoloIcon, HOLO_ICONS } from '../holo-icons';
import { popoverHeight } from '../holo-ui';

describe('holo text sized in dmm (VS-T29)', () => {
  it('turns dmm at a distance into canvas px for the plane width', () => {
    // 24 dmm at 1 m = 2.4 cm; on a 0.24 m plane drawn 1024 px wide that is a tenth: 102 px.
    expect(holoTextPx(24, 0.24, 1)).toBe(102);
    // Twice as far, twice as tall on the same plane.
    expect(holoTextPx(24, 0.24, 2)).toBe(205);
  });

  it('a chat button label is now ≥ Meta’s 18 px comfortable size, not ~7 dmm', () => {
    const planeW = 0.21 * 0.94 - 0.06 - 0.012;
    const px = holoTextPx(HOLO_TEXT_DMM.label, planeW, 1.4);
    const metres = (px / 1024) * planeW;
    expect((metres / 1.4) * 1000).toBeGreaterThanOrEqual(18);
    expect(HOLO_TEXT_DMM.caption).toBeGreaterThanOrEqual(14);
  });

  it('the hover popover grows with distance and with a tip', () => {
    expect(popoverHeight(1.4, true)).toBeGreaterThan(popoverHeight(1.4, false));
    expect(popoverHeight(2, false)).toBeGreaterThan(popoverHeight(1, false));
  });
});

describe('holo icons (VS-T29)', () => {
  it('every icon draws something in its colour', () => {
    for (const icon of HOLO_ICONS) {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        arcTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D & Record<string, ReturnType<typeof vi.fn>>;
      drawHoloIcon(ctx, icon, 0, 0, 100, '#38bdf8');
      const drew =
        (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length +
        (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length +
        (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(drew, icon).toBeGreaterThan(0);
      expect(ctx.strokeStyle).toBe('#38bdf8');
    }
  });
});
