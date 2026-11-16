import { APPLIANCE_CATALOG, MAX_APPLIANCES, type Appliance } from '@mitsinjo/engine';
import { describe, expect, it } from 'vitest';
import {
  aiDraft,
  applianceIdFor,
  clampQuantity,
  clampWatts,
  fromAppliance,
  photoKey,
  sameDraft,
  suggestSector,
  toAppliance,
  upsertAppliance,
} from '../utils/appliance-draft';
import { isNonElectric } from '@/features/microgrid-3d/utils/non-electric';

describe('appliance draft (PV-T11)', () => {
  it('AI estimate = recognised category + catalog default power + suggested sector', () => {
    expect(aiDraft({ category: 'fridge_vaccine' }, ' Vaccine fridge ')).toEqual({
      name: 'Vaccine fridge',
      category: 'fridge_vaccine',
      sector: 'health',
      watts: APPLIANCE_CATALOG.fridge_vaccine.defaultW,
      quantity: 1,
      position: null,
      feederAuto: true,
      connectionMode: 'branch',
      electric: true,
    });
    expect(aiDraft({ category: 'water_pump' }, 'Pump').sector).toBe('water');
    expect(aiDraft({ category: 'tv' }, 'TV').sector).toBe('households');
  });

  it('scenery becomes an « other » load, sector from its type', () => {
    const house = aiDraft({ kind: 'scenery', category: 'other', scenery: 'building' }, 'House');
    expect(house).toMatchObject({ category: 'other', sector: 'households' });
    expect(suggestSector({ kind: 'scenery', category: 'other', scenery: 'water' })).toBe('water');
  });

  it('non-electric (VS-T40): scenery starts without load; zero duty in and out of the engine line', () => {
    const tree = aiDraft({ kind: 'scenery', category: 'other', scenery: 'tree' }, 'Mango tree');
    expect(tree.electric).toBe(false);
    const line = toAppliance('a1', tree)!;
    expect(isNonElectric(line)).toBe(true);
    expect(fromAppliance(line).electric).toBe(false);
    const lamp = toAppliance('a2', { ...tree, electric: true })!;
    expect(lamp.hourlyDuty).toBeUndefined();
    expect(fromAppliance(lamp).electric).toBe(true);
    expect(sameDraft(tree, { ...tree, electric: true })).toBe(false);
  });

  it('keeps watts and quantity inside the engine bounds', () => {
    const { minW, maxW, defaultW } = APPLIANCE_CATALOG.lamp;
    expect(clampWatts('lamp', 0)).toBe(minW);
    expect(clampWatts('lamp', 1e6)).toBe(maxW);
    expect(clampWatts('lamp', Number.NaN)).toBe(defaultW);
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(80)).toBe(50);
    expect(clampQuantity(2.6)).toBe(3);
  });

  it('toAppliance validates with the engine schema', () => {
    const d = aiDraft({ category: 'lamp' }, 'Lamp post');
    expect(toAppliance('vision-a-det-1', d)).toMatchObject({ id: 'vision-a-det-1', watts: 10 });
    expect(toAppliance('x', { ...d, name: '  ' })).toBeNull();
    expect(toAppliance('x', { ...d, watts: 1e6 })).toBeNull();
    expect(sameDraft(d, { ...d })).toBe(true);
    expect(sameDraft(d, { ...d, quantity: 2 })).toBe(false);
  });

  it('position round-trips the engine line; sameDraft sees moves (PP-T4)', () => {
    const d = aiDraft({ category: 'lamp' }, 'Lamp post');
    const placed = { ...d, sector: 'market' as const, position: { x: 30, z: 30 } };
    expect(toAppliance('x', placed)).toMatchObject({ position: { x: 30, z: 30 } });
    // Null position = ring default: no engine field (null would fail the schema).
    expect(toAppliance('x', d)).not.toHaveProperty('position');
    expect(sameDraft(d, placed)).toBe(false);
    expect(sameDraft(placed, { ...placed })).toBe(true);
    // Reopening keeps the spot; the auto flag follows the feeder (override preserved).
    expect(fromAppliance(toAppliance('x', placed)!)).toMatchObject({
      position: { x: 30, z: 30 },
      feederAuto: true,
    });
    const overridden = toAppliance('x', { ...placed, sector: 'water', feederAuto: false })!;
    expect(fromAppliance(overridden).feederAuto).toBe(false);
    expect(fromAppliance(toAppliance('x', d)!)).toMatchObject({ position: null, feederAuto: true });
  });

  it('photo key is stable and differs between photos; ids are ≤ 64 chars', () => {
    expect(photoKey('data:a')).toBe(photoKey('data:a'));
    expect(photoKey('data:a')).not.toBe(photoKey('data:b'));
    expect(applianceIdFor(photoKey('data:a'), 'det-1')).toMatch(/^vision-[0-9a-z]+-det-1$/);
    expect(applianceIdFor('p', 'x'.repeat(80)).length).toBe(64);
  });

  it('upsert replaces the same id and refuses past the engine maximum', () => {
    const line = toAppliance('a', aiDraft({ category: 'fan' }, 'Fan'))!;
    expect(upsertAppliance([line], { ...line, quantity: 2 })).toEqual([{ ...line, quantity: 2 }]);
    const full: Appliance[] = Array.from({ length: MAX_APPLIANCES }, (_, i) => ({
      ...line,
      id: `l${i}`,
    }));
    expect(upsertAppliance(full, line)).toBeNull();
    expect(upsertAppliance(full, { ...line, id: 'l0' })).toHaveLength(MAX_APPLIANCES);
  });
});
