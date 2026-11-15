import { z } from 'zod';

/**
 * The operator's edits of a model's pieces in the 3D Studio (PQ-T77), pure. A piece is one group
 * of the model's geometry, named by its slot (a house's `HOUSE_SLOTS`, a car's `CAR_SLOTS`, a drawn
 * hull's surfaces, a parts recipe's materials). Like a layer in an image editor it can be hidden,
 * locked, faded, moved / turned / scaled round its own centre, and masked by a box (a layer mask:
 * keep what is inside, or hide it when inverted). Shares of the model's box, never metres.
 */

const share = z.number().min(0).max(1);
const vec3 = (min: number, max: number) =>
  z.tuple([
    z.number().min(min).max(max),
    z.number().min(min).max(max),
    z.number().min(min).max(max),
  ]);

/** A layer mask: a box `[x0, x1, y0, y1, z0, z1]` in shares of the model's box (x left → right, y up, z back → front). */
export const PieceMaskSchema = z.object({
  box: z.tuple([share, share, share, share, share, share]),
  /** Hide what is inside the box instead of keeping it. */
  invert: z.boolean().optional(),
  /** A mask turned off is kept but does nothing. */
  off: z.boolean().optional(),
});
export type PieceMask = z.infer<typeof PieceMaskSchema>;

export const PieceEditSchema = z.object({
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** 0.05–1; studio and object view only (the village draws pieces opaque). */
  opacity: z.number().min(0.05).max(1).optional(),
  /** Move, in shares of the model's box. */
  offset: vec3(-2, 2).optional(),
  /** Turn round the piece's centre, radians, XYZ order. */
  rotation: vec3(-Math.PI, Math.PI).optional(),
  /** Scale round the piece's centre. */
  scale: vec3(0.05, 5).optional(),
  mask: PieceMaskSchema.optional(),
});
export type PieceEdit = z.infer<typeof PieceEditSchema>;

/** Edits per piece name (at most `PIECES_MAX`). */
export const PIECES_MAX = 64;
export const PieceEditsSchema = z
  .record(z.string().min(1).max(32), PieceEditSchema)
  .refine((r) => Object.keys(r).length <= PIECES_MAX, { message: 'too many pieces' });
export type PieceEdits = z.infer<typeof PieceEditsSchema>;

/**
 * The slot a piece name belongs to and its number in it (`glass-2` → glass, 2; `roof` → roof): a
 * slot drawn as several things gives one piece per thing (PQ-T78).
 */
export function pieceBase(name: string): { base: string; index: number | null } {
  const m = /^(.*)-(\d+)$/.exec(name);
  return m ? { base: m[1]!, index: Number(m[2]) } : { base: name, index: null };
}

/** The whole box: a new mask starts there (nothing hidden yet). */
export const FULL_MASK: PieceMask = { box: [0, 1, 0, 1, 0, 1] };

const isIdentity = (v: readonly number[] | undefined, one: number) =>
  !v || v.every((x) => Math.abs(x - one) < 1e-9);

/** An edit with its no-op fields dropped; null when nothing is left. */
export function cleanEdit(edit: PieceEdit): PieceEdit | null {
  const out: PieceEdit = {};
  if (edit.hidden) out.hidden = true;
  if (edit.locked) out.locked = true;
  if (edit.opacity !== undefined && edit.opacity < 1) out.opacity = edit.opacity;
  if (!isIdentity(edit.offset, 0)) out.offset = edit.offset!;
  if (!isIdentity(edit.rotation, 0)) out.rotation = edit.rotation!;
  if (!isIdentity(edit.scale, 1)) out.scale = edit.scale!;
  if (edit.mask) out.mask = edit.mask;
  return Object.keys(out).length ? out : null;
}

/**
 * Edits with one piece's edit merged with `patch` (a field set to `undefined` is dropped); `null`
 * resets that piece. The only writer of `ObjectRecipe.pieces` besides the studio's undo history.
 */
export function editPiece(
  edits: PieceEdits | undefined,
  piece: string,
  patch: Partial<PieceEdit> | null
): PieceEdits {
  const next: PieceEdits = { ...edits };
  const merged = patch ? cleanEdit({ ...next[piece], ...patch }) : null;
  // `{ mask: undefined }` must remove the mask: spread keeps the key, `cleanEdit` drops undefined.
  if (merged && patch && 'mask' in patch && patch.mask === undefined) delete merged.mask;
  if (merged && Object.keys(merged).length) next[piece] = merged;
  else delete next[piece];
  return next;
}

/** Whether a point (shares of the box) is kept by a mask. */
export function maskKeeps(
  mask: PieceMask | undefined,
  [x, y, z]: readonly [number, number, number]
) {
  if (!mask || mask.off) return true;
  const [x0, x1, y0, y1, z0, z1] = mask.box;
  const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  return mask.invert ? !inside : inside;
}

/** Pieces shown by an « isolate » of `piece`: every other one hidden (locks and looks kept). */
export function isolatePiece(
  edits: PieceEdits | undefined,
  names: readonly string[],
  piece: string
) {
  let next = { ...edits };
  for (const n of names) next = editPiece(next, n, { hidden: n !== piece });
  return next;
}
