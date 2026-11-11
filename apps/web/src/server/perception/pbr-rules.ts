import 'server-only';

import type { ObjectRecipe } from '@/lib/object-shape';

/**
 * Physical rules for base colours (PQ-T39, Adobe PBR guide, metal / roughness workflow): the base colour of a
 * non-metal stays between `PBR_MIN` and `PBR_MAX` sRGB (nothing pure black or pure white: it would be light or
 * shadow, not paint). Bare metal (`material: 'metal'`) is lifted in the viewer (`baseColorFor`), not clamped
 * here; a `metal` part measured dark is coated metal and becomes `painted`, so it keeps its measured colour.
 * Pure: same recipe → same recipe.
 */

/** Darkest and lightest channel value of a non-metal base colour (sRGB, 0–255). */
export const PBR_MIN = 30;
export const PBR_MAX = 240;

/**
 * Bare metal reflects 70–100 % of the light (sRGB 180–255). A part named `metal` whose brightest channel is
 * under this is not bare: it is paint, powder coat or rust over metal (a black lamp post, a green pump).
 */
export const BARE_METAL_MIN = 110;

const channel = (hex: string, k: 0 | 1 | 2) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** One colour clamped into `PBR_MIN`–`PBR_MAX` per channel; the same string when it already fits. */
export function clampBaseColor(hex: string): string {
  const [r, g, b] = [0, 1, 2].map((k) =>
    Math.min(PBR_MAX, Math.max(PBR_MIN, channel(hex, k as 0 | 1 | 2)))
  ) as [number, number, number];
  const out = toHex(r, g, b);
  return out === hex.toLowerCase() ? hex : out;
}

export interface PbrResult {
  recipe: ObjectRecipe;
  /** One line per changed part: `part 3 (rubber) #000000 → #1e1e1e`, `part 0 metal → painted (#394047)`. */
  clamps: string[];
}

/** True when a colour is too dark to be the base colour of bare metal. */
export function coatedMetal(hex: string): boolean {
  return Math.max(channel(hex, 0), channel(hex, 1), channel(hex, 2)) < BARE_METAL_MIN;
}

/**
 * Clamps the base colour of every non-metal part, turns dark `metal` parts into `painted`, and reports each
 * change. Same reference when nothing moves.
 */
export function applyPbrRules(recipe: ObjectRecipe): PbrResult {
  const clamps: string[] = [];
  const parts = recipe.parts.map((p, i) => {
    let part = p;
    if (part.material === 'metal') {
      if (!coatedMetal(part.color)) return part;
      clamps.push(`part ${i} metal → painted (${part.color})`);
      part = { ...part, material: 'painted' };
    }
    const color = clampBaseColor(part.color);
    if (color === part.color) return part;
    clamps.push(`part ${i} (${part.material ?? 'painted'}) ${part.color} → ${color}`);
    return { ...part, color };
  });
  return clamps.length === 0 ? { recipe, clamps } : { recipe: { ...recipe, parts }, clamps };
}

/** `applyPbrRules` with the changes logged, for the pipeline's last step. */
export function withPbrRules(recipe: ObjectRecipe, label: string): ObjectRecipe {
  const { recipe: out, clamps } = applyPbrRules(recipe);
  if (clamps.length > 0)
    console.info(`[vision] 3D physical rules for "${label}": ${clamps.join('; ')}`);
  return out;
}
