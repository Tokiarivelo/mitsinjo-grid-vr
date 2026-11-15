import type { Lobe } from './tree-crown';

/**
 * The crown of a palm (PQ-T79): fronds, not a ball. A palm, a coconut, a traveller's tree or a
 * banana plant carries a few large leaves that leave one heart and arch outward; packed clumps
 * (`packCrown`) turn them into a broccoli. Each frond here is a ribbon of flat lobes along an arch,
 * from the heart to the outline the drawings measured (crown half-widths, top and base rows), so
 * the crown keeps its measured size and gains its kind's shape. Pure and deterministic.
 */

/** Words of a label that name a frond crown. */
export const FROND_LABEL =
  /\b(palm|palms|palmier|palmiers|coconut|cocotier|ravenala|banana|bananier|raffia|raphia|satrana|date|fern|cycad)\b/i;
/** Fronds round the heart. */
export const FRONDS = 6;
/** Lobes along one frond: two opposite fronds share a part (12 lobes), which keeps the mesh light. */
export const FROND_LOBES = 6;
/** First azimuth, radians: no frond points straight at a camera. */
export const FROND_TURN = 0.35;
/** Half-width of a frond at its widest, share of its reach. */
export const FROND_WIDTH = 0.3;
/** Thickness of a frond, share of its width. */
export const FROND_THICK = 0.4;
/** The heart sits this share of the crown's height under its top. */
export const HEART_DROP = 0.55;
/** Height of a frond's arch over the straight line to its tip, share of the crown's height. */
export const FROND_ARCH = 0.22;
/**
 * The three kinds of frond, in turn round the heart: where the tip ends (share of the crown's
 * height from its top) and how far it reaches (share of the crown's half-width).
 */
export const FROND_KINDS: ReadonlyArray<{ tip: number; reach: number }> = [
  { tip: 0.2, reach: 0.75 },
  { tip: 0.5, reach: 1 },
  { tip: 0.9, reach: 0.9 },
];

export interface FrondCrown {
  /** Where the fronds leave (the trunk's tip stands there; not drawn as a part). */
  heart: Lobe;
  /** One ribbon of lobes per frond, with the tier (0 = top) its colour comes from. */
  fronds: Array<{ lobes: Lobe[]; tier: number }>;
}

/**
 * Fronds for a crown of rows `top`..`base`, centred on `centre` (cells x, z), reaching `half`
 * (half-widths across the front and the side).
 */
export function frondCrown(
  top: number,
  base: number,
  centre: readonly [number, number],
  half: readonly [number, number]
): FrondCrown {
  const height = Math.max(1, base - top);
  const heartY = top + HEART_DROP * height;
  const reach = Math.max(1, (half[0] + half[1]) / 2);
  const heartR = Math.max(1, 0.2 * reach);
  const heart: Lobe = { c: [centre[0], heartY, centre[1]], r: [heartR, heartR * 1.3, heartR] };
  const fronds = Array.from({ length: FRONDS }, (_, k) => {
    const kind = FROND_KINDS[k % FROND_KINDS.length]!;
    const a = FROND_TURN + (k / FRONDS) * Math.PI * 2;
    const [rx, rz] = [Math.sin(a) * half[0] * kind.reach, Math.cos(a) * half[1] * kind.reach];
    const length = Math.max(1, Math.hypot(rx, rz));
    const tipY = top + kind.tip * height;
    const at = (i: number) => 0.06 + (0.9 * i) / (FROND_LOBES - 1);
    // Rows grow downward: the arch lifts the middle of the frond.
    const row = (t: number) => heartY + (tipY - heartY) * t - FROND_ARCH * height * 4 * t * (1 - t);
    const lobes: Lobe[] = Array.from({ length: FROND_LOBES }, (_, i) => {
      const t = at(i);
      const w = Math.max(1, FROND_WIDTH * length * (0.35 + 0.65 * Math.sin(Math.PI * t)));
      // Thick enough to reach the next lobe where the frond climbs or falls: one ribbon, no beads.
      const climb = Math.max(Math.abs(row(at(i + 1)) - row(t)), Math.abs(row(t) - row(at(i - 1))));
      return {
        c: [centre[0] + rx * t, row(t), centre[1] + rz * t],
        r: [w, Math.max(0.6, w * FROND_THICK, climb * 0.9), w],
      };
    });
    return { lobes, tier: k % FROND_KINDS.length };
  });
  return { heart, fronds };
}
