import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchLibraryModel, MODEL_LIBRARY } from '../model-library';

describe('matchLibraryModel', () => {
  it('finds the sofa and the car in every language', () => {
    for (const l of ['Sofa', 'Canapé', 'Seza lava', 'couch'])
      expect(matchLibraryModel(l)?.id).toBe('glam-velvet-sofa');
    for (const l of ['Car', 'Voiture', 'Fiara'])
      expect(matchLibraryModel(l)?.id).toBe('car-concept');
  });

  it('answers nothing for objects the library has no model of', () => {
    for (const l of ['Fridge', 'House', 'Cardboard box', 'Carpet', '', null, undefined])
      expect(matchLibraryModel(l)).toBeNull();
  });

  it('ships every file it names, each with a credit and a licence', () => {
    for (const m of MODEL_LIBRARY) {
      expect(existsSync(join(__dirname, '../../../public', m.url))).toBe(true);
      expect(m.credit).toMatch(/©/);
      expect(m.license).toBe('CC BY 4.0');
    }
  });
});
