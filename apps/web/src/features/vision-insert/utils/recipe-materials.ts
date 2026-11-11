import * as THREE from 'three';
import type { ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import { surfaceMaterial, SURFACES } from './surface-look';
import { SWATCH_GAIN } from './surface-maps';
import { surfaceTextures, swatchTexture } from './surface-textures';

/** What `buildRecipeMaterials` reads from a recipe: its photo swatches and its measured gloss. */
export type MaterialSource = Pick<ObjectRecipe, 'swatches' | 'gloss'>;

export interface RecipeMaterialOptions {
  /** Surfaces (indices of `SURFACES`) the mesh uses: only these get relief maps. Default: all. */
  used?: ReadonlySet<number>;
  /** Relief maps and photo swatches (procedural normal / roughness / shade, 64 px swatches). Default true. */
  textured?: boolean;
  /** Tint multiplied over the measured colours (display only); null = as measured. */
  tint?: string | null;
  /** Called when an async swatch texture lands (the on-demand viewer needs its frame). */
  onTexture?: () => void;
  /** Emissive strength of the glow surfaces (lamp, screen); default = the viewer's fixed glow, 0 = off. */
  glow?: number;
}

/**
 * One material per surface, indexed by the geometry groups (PQ-T32): the same look in the viewer, the village
 * and VR. Stone matte, glass shiny, metal bare; the measured gloss shifts roughness and clearcoat (PQ-T26);
 * with `textured`, the surfaces the model uses get their relief maps (PR-1.4) or photo swatch (PR-1.5), tinted
 * by the measured colours and compensated with a brightness gain so surfaces do not darken. The caller disposes
 * the materials (the textures are shared and cached).
 */
export function buildRecipeMaterials(
  source: MaterialSource | undefined,
  opts: RecipeMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const { used, textured = true, tint = null, onTexture, glow } = opts;
  return SURFACES.map((s, i) => {
    const maps = textured && (!used || used.has(i)) ? surfaceTextures(s) : null;
    const swatch = textured && source?.swatches?.[s as RecipeMaterial];
    const swatchTex = swatch ? swatchTexture(swatch, onTexture) : null;
    const map = swatchTex ?? maps?.map;
    const gain = swatchTex ? SWATCH_GAIN : (maps?.gain ?? 1);
    return surfaceMaterial(
      s,
      {
        vertexColors: true,
        color: new THREE.Color(tint ?? '#ffffff').multiplyScalar(gain),
        ...(maps ? { normalMap: maps.normalMap, roughnessMap: maps.roughnessMap } : {}),
        ...(map ? { map } : {}),
      },
      source?.gloss?.[s as RecipeMaterial],
      glow
    );
  });
}
