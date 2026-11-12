import { describe, expect, it } from 'vitest';
import { KIT_ARCHETYPES, type KitArchetype } from '@/lib/object-kit';
import type { PhotoConditions } from '@/lib/object-shape';
import { familyOf, REFUSE_MIN_PX, routeImage } from '../routing';

const conditions = (over: Partial<PhotoConditions> = {}): PhotoConditions => ({
  widthPx: 400,
  heightPx: 300,
  sharpness: 'high',
  ...over,
});

describe('familyOf (PQ-T47 §4.1)', () => {
  it('maps every archetype to a family', () => {
    const families = Object.fromEntries(
      KIT_ARCHETYPES.map((a) => [a, familyOf(a as KitArchetype)])
    );
    expect(families).toMatchObject({
      tree: 'procedural',
      bush: 'procedural',
      person: 'sdf',
      animal: 'sdf',
      other: 'parametric',
      vehicle: 'library',
      house: 'library',
      building: 'library',
      cabinet: 'library',
      water: 'library',
    });
  });
});

describe('routeImage (PQ-T47 §4.2)', () => {
  it('routes a clear single object to the pipeline in its family', () => {
    expect(
      routeImage({ detections: 1, archetype: 'vehicle', confidence: 0.9, conditions: conditions() })
    ).toEqual({ imageType: 'photo_single', family: 'library', action: 'pipeline' });
  });
  it('labels several objects but keeps the pipeline (the operator picks one)', () => {
    const route = routeImage({
      detections: 3,
      archetype: 'house',
      confidence: 0.9,
      conditions: conditions(),
    });
    expect(route.imageType).toBe('photo_multi');
    expect(route.action).toBe('pipeline');
  });
  it('labels a hidden object but keeps the pipeline (the clean-front offer rides along)', () => {
    const route = routeImage({
      detections: 1,
      archetype: 'vehicle',
      confidence: 0.9,
      conditions: conditions({ hidden: 0.4 }),
    });
    expect(route.imageType).toBe('hidden_object');
    expect(route.action).toBe('pipeline');
  });
  it('labels a drawing (2D path downstream)', () => {
    const route = routeImage({
      detections: 1,
      archetype: 'house',
      confidence: 0.9,
      conditions: conditions(),
      imageKind: 'drawing',
    });
    expect(route.imageType).toBe('drawing');
    expect(route.action).toBe('pipeline');
  });
  it('asks the operator under 0.82 confidence, or for a plain box', () => {
    expect(
      routeImage({ detections: 1, archetype: 'house', confidence: 0.81, conditions: conditions() })
        .action
    ).toBe('ask');
    expect(
      routeImage({ detections: 1, archetype: 'house', confidence: 0.82, conditions: conditions() })
        .action
    ).toBe('pipeline');
    expect(
      routeImage({ detections: 1, archetype: 'other', confidence: 0.95, conditions: conditions() })
    ).toMatchObject({ family: 'parametric', action: 'ask' });
  });
  it('refuses nothing found, with the cause', () => {
    expect(routeImage({ detections: 0 })).toEqual({
      imageType: 'none',
      family: 'parametric',
      action: 'refuse',
      cause: 'no_object',
    });
    // E2 routes 0 detections with frame conditions: unusable pixels name the cause.
    expect(routeImage({ detections: 0, conditions: conditions({ sharpness: 'low' }) }).cause).toBe(
      'too_blurry'
    );
    expect(
      routeImage({ detections: 0, conditions: conditions({ widthPx: 40, heightPx: 30 }) }).cause
    ).toBe('too_small');
  });
  it('refuses a minuscule object before any AI call', () => {
    const route = routeImage({
      detections: 1,
      archetype: 'pole',
      confidence: 0.9,
      conditions: conditions({ widthPx: REFUSE_MIN_PX - 1, heightPx: 20 }),
    });
    expect(route).toMatchObject({ action: 'refuse', cause: 'too_small' });
    expect(
      routeImage({
        detections: 1,
        archetype: 'pole',
        confidence: 0.9,
        conditions: conditions({ widthPx: REFUSE_MIN_PX, heightPx: 20 }),
      }).action
    ).toBe('pipeline');
  });
  it('refuses a blurred photo', () => {
    expect(
      routeImage({
        detections: 1,
        archetype: 'house',
        confidence: 0.9,
        conditions: conditions({ sharpness: 'low' }),
      })
    ).toMatchObject({ action: 'refuse', cause: 'too_blurry' });
  });
  it('refusal wins over doubt and routes without conditions never refuse', () => {
    // Blurry and doubtful: the cause is what the operator can fix.
    expect(
      routeImage({
        detections: 1,
        archetype: 'other',
        confidence: 0.2,
        conditions: conditions({ sharpness: 'low' }),
      }).action
    ).toBe('refuse');
    // No photo behind the request (mock, tests): nothing measured, nothing refused.
    expect(routeImage({ detections: 1, archetype: 'house', confidence: 0.9 }).action).toBe(
      'pipeline'
    );
  });
});
