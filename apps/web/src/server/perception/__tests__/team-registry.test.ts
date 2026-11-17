import { describe, expect, it } from 'vitest';
import { KIT_ARCHETYPES, defaultArchetype, kitToRecipe, type KitArchetype } from '@/lib/object-kit';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import { familyOf, routeImage } from '../routing';
import { teamFor, teamIdOf } from '../team/registry';
import { CAR_TEAM } from '../car/car-tools';
import { HOUSE_TEAM } from '../house/house-tools';
import { PLANT_TEAM } from '../tree/plant-tools';
import { SEAT_TEAM } from '../team/teams/seat';
import { TABLE_TEAM } from '../team/teams/table';
import { STORAGE_TEAM } from '../team/teams/storage';
import { BED_TEAM } from '../team/teams/bed';
import { TEXTILE_TEAM } from '../team/teams/textile';

const NEW = [
  'seat',
  'table',
  'storage',
  'bed',
  'textile',
  'fixture',
  'structure',
  'terrain',
] as const;

describe('teamFor (PQ-T87)', () => {
  it('maps the classes with a team, null for the others', () => {
    expect(teamFor('house')).toBe(HOUSE_TEAM);
    expect(teamFor('building')).toBe(HOUSE_TEAM);
    expect(teamFor('vehicle')).toBe(CAR_TEAM);
    expect(teamFor('tree')).toBe(PLANT_TEAM);
    expect(teamFor('bush')).toBe(PLANT_TEAM);
    expect(teamIdOf('vehicle')).toBe('car');
    // PQ-T89: the furniture teams.
    expect(teamFor('seat')).toBe(SEAT_TEAM);
    expect(teamFor('table')).toBe(TABLE_TEAM);
    expect(teamFor('storage')).toBe(STORAGE_TEAM);
    expect(teamFor('bed')).toBe(BED_TEAM);
    expect(teamIdOf('bed')).toBe('bed');
    // PQ-T90.
    expect(teamFor('textile')).toBe(TEXTILE_TEAM);
    for (const a of ['cabinet', 'person', 'water', 'other', ...NEW.slice(5)] as KitArchetype[])
      expect(teamFor(a), a).toBeNull();
  });
});

describe('new archetypes (PQ-T87)', () => {
  it('are kit archetypes of the parametric family, routed to the pipeline', () => {
    for (const a of NEW) {
      expect(KIT_ARCHETYPES).toContain(a);
      expect(familyOf(a)).toBe('parametric');
      expect(routeImage({ detections: 1, archetype: a }).action).toBe('pipeline');
    }
    expect(familyOf('other')).toBe('parametric');
    expect(familyOf('tree')).toBe('procedural');
  });

  it('each builds a valid stand-in recipe from its template', () => {
    for (const a of NEW) {
      const recipe = kitToRecipe({
        archetype: a,
        proportions: { w: 1, h: 0.8, d: 0.7 },
        colors: { main: '#aa8866', secondary: '#553311', accent: '#ccddee' },
      });
      expect(ObjectRecipeSchema.safeParse(recipe).success, a).toBe(true);
      expect(recipe.parts.length, a).toBeGreaterThan(0);
    }
  });

  it.each([
    ['grey sofa', 'seat'],
    ['canapé d’angle', 'seat'],
    ['chaise en bois', 'seat'],
    ['bar stools', 'seat'],
    ['seza', 'seat'],
    ['dining table', 'table'],
    ['latabatra', 'table'],
    ['wardrobe', 'storage'],
    ['étagère murale', 'storage'],
    ['armoire', 'storage'],
    ['lalimoara', 'storage'],
    ['double bed', 'bed'],
    ['lit', 'bed'],
    ['fandriana', 'bed'],
    ['white curtains', 'textile'],
    ['rideau', 'textile'],
    ['tapis', 'textile'],
    ['front door', 'fixture'],
    ['wall mirror', 'fixture'],
    ['fenêtre', 'fixture'],
    ['varavarana', 'fixture'],
    ['wooden fence', 'structure'],
    ['clôture', 'structure'],
    ['fefy', 'structure'],
    ['granite boulder', 'terrain'],
    ['rocher', 'terrain'],
    ['old tyre', 'terrain'],
    ['vato', 'terrain'],
  ] as const)('reads « %s » as %s', (label, archetype) => {
    expect(defaultArchetype('other', undefined, label)).toBe(archetype);
  });

  it('keeps the earlier classes first where words overlap', () => {
    expect(defaultArchetype('other', undefined, 'table lamp')).toBe('lamp_post');
    expect(defaultArchetype('other', undefined, 'stone house')).toBe('house');
    expect(defaultArchetype('other', undefined, 'log cabin')).toBe('house');
    expect(defaultArchetype('other', undefined, 'car seat')).toBe('vehicle');
    expect(defaultArchetype('other', undefined, 'mango tree')).toBe('tree');
    expect(defaultArchetype('other', undefined, 'flower bed')).toBe('bush');
    expect(defaultArchetype('other', undefined, 'armchairlift')).toBe('other');
    expect(defaultArchetype('fridge', undefined, 'fridge')).toBe('cabinet');
  });
});
