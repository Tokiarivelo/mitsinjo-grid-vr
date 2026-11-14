import { describe, expect, it } from 'vitest';
import {
  cleanEdit,
  editPiece,
  FULL_MASK,
  isolatePiece,
  maskKeeps,
  PIECES_MAX,
  PieceEditsSchema,
  pieceBase,
} from '../piece-edits';

describe('piece edits (3D Studio, PQ-T77)', () => {
  it('drops no-op fields and empty edits', () => {
    expect(cleanEdit({ offset: [0, 0, 0], scale: [1, 1, 1], opacity: 1 })).toBeNull();
    expect(cleanEdit({ hidden: true, rotation: [0, 0.5, 0] })).toEqual({
      hidden: true,
      rotation: [0, 0.5, 0],
    });
  });

  it('merges a patch, removes a mask on `mask: undefined`, resets on null', () => {
    let e = editPiece(undefined, 'roof', { mask: FULL_MASK, opacity: 0.5 });
    expect(e.roof).toEqual({ mask: FULL_MASK, opacity: 0.5 });
    e = editPiece(e, 'roof', { mask: undefined });
    expect(e.roof).toEqual({ opacity: 0.5 });
    e = editPiece(e, 'roof', { opacity: 1 });
    expect(e).toEqual({});
    e = editPiece({ glass: { hidden: true } }, 'glass', null);
    expect(e).toEqual({});
  });

  it('a mask keeps inside its box, inverted keeps outside, off keeps all', () => {
    const mask = { box: [0, 0.5, 0, 1, 0, 1] as [number, number, number, number, number, number] };
    expect(maskKeeps(mask, [0.25, 0.5, 0.5])).toBe(true);
    expect(maskKeeps(mask, [0.75, 0.5, 0.5])).toBe(false);
    expect(maskKeeps({ ...mask, invert: true }, [0.75, 0.5, 0.5])).toBe(true);
    expect(maskKeeps({ ...mask, off: true }, [0.75, 0.5, 0.5])).toBe(true);
  });

  it('isolates one piece and caps the number of pieces', () => {
    expect(isolatePiece({ roof: { locked: true } }, ['roof', 'glass', 'tyre'], 'glass')).toEqual({
      roof: { locked: true, hidden: true },
      tyre: { hidden: true },
    });
    const many = Object.fromEntries(
      Array.from({ length: PIECES_MAX + 1 }, (_, i) => [`p${i}`, { hidden: true }])
    );
    expect(PieceEditsSchema.safeParse(many).success).toBe(false);
    expect(PieceEditsSchema.safeParse({ roof: { opacity: 0 } }).success).toBe(false);
  });

  it('reads the slot and number of a piece of a split slot (PQ-T78)', () => {
    expect(pieceBase('glass-2')).toEqual({ base: 'glass', index: 2 });
    expect(pieceBase('roof')).toEqual({ base: 'roof', index: null });
    expect(pieceBase('piece-12')).toEqual({ base: 'piece', index: 12 });
  });
});
