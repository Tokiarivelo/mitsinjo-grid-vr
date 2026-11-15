import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';

/**
 * Roof trim. Eave roll (PG-T12, `bulge` PG-T10): a thatched roof ends in a thick rounded lip, not
 * a knife edge (the drawing's curved eave). Each eave line of a roof part with a bulge (thatch by
 * default) gets a cylinder of the roof's colour along it. Chimney cap (PG-T10): a slab on top of a
 * chimney with `cap`. Viewer-only, like the opening expansion. Pure: recipe units in and out.
 */

/** Default roll radius of a thatch roof, share of the roof's height. */
export const EAVE_ROLL_SHARE = 0.08;
/** Chimney cap: wider than the stack by this factor, this share of the stack's width thick. */
export const CAP_WIDEN = 1.3;
export const CAP_THICK = 0.25;

/** Roll radius share of a roof part: its `bulge`, else the thatch default, else 0. */
export function roofBulge(p: RecipePart): number {
  if (p.shape !== 'hip' && p.shape !== 'prism') return 0;
  return p.bulge ?? (p.material === 'thatch' ? EAVE_ROLL_SHARE : 0);
}

const isThatchRoof = (p: RecipePart) => roofBulge(p) > 0;

/** Fascia board (PQ-T43, §7.1): thickness in world units, height as a share of the roof height. */
export const FASCIA_THICK = 0.02;
export const FASCIA_HEIGHT_SHARE = 0.12;
/** Fascia boards sink this far into the roof so no two faces sit coplanar. */
const FASCIA_EMBED = 0.005;

/**
 * Extra roof reach the trim sits on, world units each side (PQ-T43): `rendererReach` is what this
 * renderer adds (the viewer passes the legacy eave, the flat render 0 — it draws boxes as-is).
 * An explicit `overhang` (new parts) applies raw; absent (old captures) keeps legacy behaviour:
 * prisms grew, hips did not.
 */
export function trimReach(p: RecipePart, rendererReach: number): number {
  if (rendererReach === 0 || (p.shape !== 'hip' && p.shape !== 'prism')) return 0;
  if (p.overhang !== undefined) return p.overhang;
  return p.shape === 'prism' ? rendererReach : 0;
}

/**
 * Pitched roofs that read through a fascia board: `kind: 'roof'` prisms and hips with a known
 * non-thatch material. Thatch gets rolls (or nothing with `bulge: 0`); material-unknown roofs
 * stay bare — trim must not guess (else elevation drawings mismatch their renders).
 */
const isFasciaRoof = (p: RecipePart) =>
  (p.shape === 'hip' || p.shape === 'prism') &&
  p.kind === 'roof' &&
  p.material !== undefined &&
  p.material !== 'thatch' &&
  !isThatchRoof(p);

/** Parts with a cap slab added after each chimney that asks for one. */
export function expandChimneyCaps(
  parts: ReadonlyArray<RecipePart>,
  proportions: ObjectRecipe['proportions']
): RecipePart[] {
  const dims = [proportions.w, proportions.h, proportions.d];
  return parts.flatMap((p) => {
    if (p.kind !== 'chimney' || !p.cap || p.shape !== 'box') return [p];
    const [sx, sy, sz] = p.size.map((v, i) => v * dims[i]!);
    const t = Math.min(CAP_THICK * Math.min(sx!, sz!), 0.3 * sy!);
    const top = p.at[1] * dims[1]! + sy! / 2;
    const cap: RecipePart = {
      shape: 'box',
      at: [p.at[0], (top + t / 2) / dims[1]!, p.at[2]],
      size: [(CAP_WIDEN * sx!) / dims[0]!, t / dims[1]!, (CAP_WIDEN * sz!) / dims[2]!],
      color: p.color,
      ...(p.material ? { material: p.material } : {}),
      kind: 'chimney',
      ...(p.status ? { status: p.status } : {}),
    };
    return [p, cap];
  });
}

/**
 * Parts with an eave roll added after each thatch roof, and a fascia board under each eave of
 * every `kind: 'roof'` prism or hip with a known non-thatch material (PQ-T43, §7.1: the board
 * makes the overhang read as a roof edge). `overhang` = the extra roof reach this renderer applies (world units): the viewer
 * passes the legacy eave, the flat render 0 (it draws boxes as-is); per-part explicit values win.
 */
export function expandRoofTrim(
  parts: ReadonlyArray<RecipePart>,
  proportions: ObjectRecipe['proportions'],
  overhang = 0
): RecipePart[] {
  if (!parts.some((p) => isThatchRoof(p) || isFasciaRoof(p))) return [...parts];
  const dims = [proportions.w, proportions.h, proportions.d];
  return parts.flatMap((p) => {
    if (isThatchRoof(p)) return [p, ...rolls(p, dims, trimReach(p, overhang))];
    if (isFasciaRoof(p)) return [p, ...fascia(p, dims, trimReach(p, overhang))];
    return [p];
  });
}

function rolls(p: RecipePart, dims: number[], overhang: number): RecipePart[] {
  const [cx, cy, cz] = p.at.map((v, i) => v * dims[i]!);
  const [sx, sy, sz] = p.size.map((v, i) => v * dims[i]!);
  const r = roofBulge(p) * sy!;
  const y = cy! - sy! / 2 + 0.6 * r;
  const look = { color: p.color, material: p.material, kind: 'roof' as const };
  const roll = (at: [number, number, number], axis: 'x' | 'z', len: number): RecipePart => ({
    shape: 'cylinder',
    axis,
    at: [at[0] / dims[0]!, at[1] / dims[1]!, at[2] / dims[2]!],
    size:
      axis === 'x'
        ? [len / dims[0]!, (2 * r) / dims[1]!, (2 * r) / dims[2]!]
        : [(2 * r) / dims[0]!, (2 * r) / dims[1]!, len / dims[2]!],
    ...look,
    ...(p.status ? { status: p.status } : {}),
  });
  if (p.shape === 'prism') {
    // Ridge front to back: the eaves run along z on both long sides.
    const half = sx! / 2 + overhang;
    const len = sz! + 2 * overhang;
    return [roll([cx! - half, y, cz!], 'z', len), roll([cx! + half, y, cz!], 'z', len)];
  }
  // Hip: eaves on all four sides.
  return [
    roll([cx!, y, cz! + sz! / 2 + overhang], 'x', sx! + 2 * overhang),
    roll([cx!, y, cz! - sz! / 2 - overhang], 'x', sx! + 2 * overhang),
    roll([cx! - sx! / 2 - overhang, y, cz!], 'z', sz! + 2 * overhang),
    roll([cx! + sx! / 2 + overhang, y, cz!], 'z', sz! + 2 * overhang),
  ];
}

/** Thin boards under a pitched roof's eaves, outer face flush with the drawn edge (PQ-T43). */
function fascia(p: RecipePart, dims: number[], reach: number): RecipePart[] {
  const [cx, cy, cz] = p.at.map((v, i) => v * dims[i]!);
  const [sx, sy, sz] = p.size.map((v, i) => v * dims[i]!);
  const h = Math.max(0.02, FASCIA_HEIGHT_SHARE * sy!);
  const t = FASCIA_THICK;
  const y = cy! - sy! / 2 + FASCIA_EMBED - h / 2;
  const look = { color: p.color, material: p.material, kind: 'roof' as const };
  const board = (at: [number, number, number], size: [number, number, number]): RecipePart => ({
    shape: 'box',
    at: [at[0] / dims[0]!, at[1] / dims[1]!, at[2] / dims[2]!],
    size: [size[0] / dims[0]!, size[1] / dims[1]!, size[2] / dims[2]!],
    ...look,
    ...(p.status ? { status: p.status } : {}),
  });
  if (p.shape === 'prism') {
    // Ridge front to back: one board along each long eave.
    const half = sx! / 2 + reach;
    const len = sz! + 2 * reach;
    return [
      board([cx! - half + t / 2, y, cz!], [t, h, len]),
      board([cx! + half - t / 2, y, cz!], [t, h, len]),
    ];
  }
  // Hip: boards on all four sides.
  return [
    board([cx!, y, cz! + sz! / 2 + reach - t / 2], [sx! + 2 * reach, h, t]),
    board([cx!, y, cz! - sz! / 2 - reach + t / 2], [sx! + 2 * reach, h, t]),
    board([cx! - sx! / 2 - reach + t / 2, y, cz!], [t, h, sz! + 2 * reach]),
    board([cx! + sx! / 2 + reach - t / 2, y, cz!], [t, h, sz! + 2 * reach]),
  ];
}
