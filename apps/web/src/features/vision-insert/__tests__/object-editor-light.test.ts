import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_AO, KEY_SHADOW } from '../ui/object-editor-3d';

/** The viewer is a WebGL canvas (not renderable in jsdom): its tree is checked from the source, its knobs from the exports. */
const source = readFileSync(join(__dirname, '../ui/object-editor-3d.tsx'), 'utf8');

describe('object viewer shading (PQ-T33)', () => {
  it('has the AO pass in the existing composer, before tone mapping', () => {
    const composer = source.slice(source.indexOf('<EffectComposer'));
    expect(composer.indexOf('<N8AO')).toBeGreaterThan(-1);
    expect(composer.indexOf('<N8AO')).toBeLessThan(composer.indexOf('<ToneMapping'));
    expect((source.match(/<EffectComposer/g) ?? []).length).toBe(1);
  });

  it('turns shadows on, the key light casts, the object casts and receives', () => {
    expect(source.slice(source.indexOf('<Canvas'), source.indexOf('<StudioEnvironment'))).toContain(
      '\n      shadows\n'
    );
    expect(source).toMatch(/<directionalLight[^>]*castShadow/s);
    expect(source).toMatch(
      /<mesh geometry=\{mesh\} material=\{surfaces\} castShadow receiveShadow/
    );
  });

  it('keeps the frame on demand and the knobs moderate (colours stay as measured)', () => {
    expect(source).toContain('frameloop="demand"');
    expect(EDITOR_AO.intensity).toBeLessThanOrEqual(2);
    expect(Math.log2(KEY_SHADOW.size) % 1).toBe(0);
  });
});
