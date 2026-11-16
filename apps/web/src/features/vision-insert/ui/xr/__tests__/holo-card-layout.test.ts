import { describe, expect, it } from 'vitest';
import { layoutHoloCard } from '../holo-style';

/** Monospace stand-in: each char is half the font size wide. */
const measure = (font: string, s: string) => s.length * Number(/(\d+)px/.exec(font)![1]) * 0.5;

describe('layoutHoloCard', () => {
  it('keeps the sizes when the lines fit', () => {
    const { blocks, total } = layoutHoloCard(measure, [{ text: 'Short', size: 60 }], 1024, 148);
    expect(blocks[0]!.size).toBe(60);
    expect(total).toBeLessThanOrEqual(148);
  });

  it('shrinks every line together when a long title wraps past the card (VR studio header)', () => {
    const lines = [
      { text: 'Construction 3D de « plante en pot » en cours', size: 60, weight: 700 as const },
      { text: 'Le labo 3D s’ouvre tout seul dès que le modèle est prêt', size: 36 },
    ];
    const { blocks, total } = layoutHoloCard(measure, lines, 1024, 148);
    expect(total).toBeLessThanOrEqual(148 * 0.94);
    expect(blocks[0]!.size).toBeLessThan(60);
    expect(blocks[1]!.size).toBeLessThan(36);
    // Title stays bigger than the subtitle.
    expect(blocks[0]!.size).toBeGreaterThan(blocks[1]!.size);
  });

  it('shrinks a single word wider than the card instead of cutting it (« Keyboard », VS-T29)', () => {
    // 8 chars × 120 px × 0.5 = 480 px on a 400 px wide card (pad 20 each side): too wide.
    const { blocks } = layoutHoloCard(measure, [{ text: 'Keyboard', size: 120 }], 400, 400);
    const b = blocks[0]!;
    expect(b.rows).toEqual(['Keyboard']);
    expect(measure(b.font, b.rows[0]!)).toBeLessThanOrEqual(400 - 2 * 400 * 0.05);
  });
});
