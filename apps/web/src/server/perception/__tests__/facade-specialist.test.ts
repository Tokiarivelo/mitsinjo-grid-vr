import { describe, expect, it } from 'vitest';
import {
  buildCleanFrontPrompt,
  buildFacadePrompt,
  generateFacadeImage,
} from '../facade-specialist';
import type { ShapeTarget } from '@/lib/object-shape';

describe('facade-specialist', () => {
  describe('buildCleanFrontPrompt (PQ-T23)', () => {
    it('fills the Clean front card with the name and what the kit saw', () => {
      const prompt = buildCleanFrontPrompt('red car', {
        hiddenBy: ['hedge', 'person'],
        visibleParts: ['wheel', 'door handle'],
      });
      expect(prompt).toContain('This photo shows a red car partly hidden by hedge, person.');
      expect(prompt).toContain('number and position of wheel, door handle');
      expect(prompt).toContain('with nothing in front of it');
      expect(prompt).not.toMatch(/[{}]/);
    });

    it('says something plain when the kit listed nothing', () => {
      const prompt = buildCleanFrontPrompt('pump');
      expect(prompt).toContain('partly hidden by other objects');
      expect(prompt).not.toMatch(/[{}]/);
    });
  });

  describe('buildFacadePrompt', () => {
    it('builds an orthographic architectural prompt for a house', () => {
      const prompt = buildFacadePrompt('house', 'rural clinic cottage');
      expect(prompt).toContain('Architectural orthographic front elevation');
      expect(prompt).toContain('rural clinic cottage');
      expect(prompt).toContain('0 degree perspective tilt');
      expect(prompt).toContain('solid clean neutral background');
    });

    it('builds an orthographic prompt for a vehicle', () => {
      const prompt = buildFacadePrompt('vehicle', 'solar maintenance van');
      expect(prompt).toContain('Direct front orthographic elevation');
      expect(prompt).toContain('solar maintenance van');
      expect(prompt).toContain('symmetrical headlights');
    });

    it('builds a whole-plant elevation for a tree (PG-T19)', () => {
      const prompt = buildFacadePrompt('tree', 'mango tree');
      expect(prompt).toContain('mango tree');
      expect(prompt).toContain('from the ground to its top');
      expect(prompt).toContain('solid clean neutral background');
    });

    it('draws a bush or flower bed low and without a trunk (before: a flowering tree)', () => {
      const prompt = buildFacadePrompt('bush', 'flowering plants');
      expect(prompt).toContain('as wide and as low as it grows');
      expect(prompt).not.toContain('the trunk');
    });

    it('incorporates additional user prompt details', () => {
      const prompt = buildFacadePrompt(
        'house',
        'health center',
        'red corrugated roof, double wooden doors'
      );
      expect(prompt).toContain('health center');
      expect(prompt).toContain(
        'Additional required architectural features: red corrugated roof, double wooden doors.'
      );
    });
  });

  describe('generateFacadeImage', () => {
    const target: ShapeTarget = {
      id: 'target-1',
      label: 'cottage',
      category: 'other',
      scenery: 'building',
      box: { x: 0.1, y: 0.2, w: 0.4, h: 0.5 },
    };

    it('generates a synthetic 2D facade image in mock mode and returns consultable data', async () => {
      const result = await generateFacadeImage({
        target,
        userPrompt: 'wooden shutters',
      });

      expect(result.fileKey).toContain('vision/facades/target-1_');
      expect(result.fileKey).toMatch(/\.png$/);
      expect(result.imageUrl).toBeDefined();
      expect(result.archetype).toBe('house');
      expect(result.prompt).toContain('cottage');
      expect(result.prompt).toContain('wooden shutters');
      expect(result.source).toBe('mock');
    });
  });
});
