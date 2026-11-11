import { describe, expect, it } from 'vitest';
import { buildRecipeMaterials } from '../utils/recipe-materials';
import { SURFACE_LOOK, SURFACES, surfaceIndex } from '../utils/surface-look';

describe('buildRecipeMaterials (PQ-T32)', () => {
  it('one material per surface, with the surface look, vertex colours on', () => {
    const mats = buildRecipeMaterials(undefined, { textured: false });
    expect(mats).toHaveLength(SURFACES.length);
    SURFACES.forEach((s, i) => {
      expect(mats[i]!.vertexColors).toBe(true);
      expect(mats[i]!.metalness).toBe(SURFACE_LOOK[s].metalness);
      expect(mats[i]!.roughness).toBe(SURFACE_LOOK[s].roughness);
    });
    for (const m of mats) m.dispose();
  });

  it('relief maps only on the used, textured surfaces; none when untextured (low tier, village)', () => {
    const stone = surfaceIndex('stone');
    const some = buildRecipeMaterials(undefined, { used: new Set([stone]) });
    expect(some[stone]!.normalMap).not.toBeNull();
    expect(some[surfaceIndex('brick')]!.normalMap).toBeNull();
    const none = buildRecipeMaterials(undefined, { textured: false });
    expect(none[stone]!.normalMap).toBeNull();
    for (const m of [...some, ...none]) m.dispose();
  });

  it('the measured gloss shifts the look of its material only', () => {
    const base = buildRecipeMaterials(undefined, { textured: false });
    const glossy = buildRecipeMaterials({ gloss: { plastic: 'gloss' } }, { textured: false });
    const i = surfaceIndex('plastic');
    expect(glossy[i]!.roughness).toBeLessThan(base[i]!.roughness);
    expect(glossy[surfaceIndex('stone')]!.roughness).toBe(base[surfaceIndex('stone')]!.roughness);
    for (const m of [...base, ...glossy]) m.dispose();
  });

  it('a tint multiplies the base colour, the glow override reaches the lamp', () => {
    const tinted = buildRecipeMaterials(undefined, { textured: false, tint: '#808080', glow: 0 });
    expect(tinted[surfaceIndex('painted')]!.color.r).toBeLessThan(1);
    expect(tinted[SURFACES.indexOf('lamp')]!.emissiveIntensity).toBe(0);
    for (const m of tinted) m.dispose();
  });
});
