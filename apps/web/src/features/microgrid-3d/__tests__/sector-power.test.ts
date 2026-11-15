import { describe, expect, it } from 'vitest';
import type { SectorCap } from '@mitsinjo/engine';
import {
  breaksConstitution,
  POWER_STEP_KW,
  sectorCapOf,
  sectorPowerPatch,
} from '../utils/sector-power';

const caps: SectorCap[] = [{ sector: 'market', maxKw: 1.5, fromHour: 18, toHour: 22 }];

describe('VR power panel actions (VSIM-T3)', () => {
  it('− starts from what is served now, from the shown hour to the end of the day', () => {
    expect(sectorPowerPatch('less', 'households', caps, 2.34, 19)).toEqual({
      sectorCaps: [...caps, { sector: 'households', maxKw: 1.8, fromHour: 19, toHour: 24 }],
    });
  });

  it('− / + move an existing limit by one step, never below 0', () => {
    const less = sectorPowerPatch('less', 'market', caps, 3, 20);
    expect(sectorCapOf(less!.sectorCaps, 'market')?.maxKw).toBe(1.5 - POWER_STEP_KW);
    const more = sectorPowerPatch('more', 'market', caps, 3, 20);
    expect(sectorCapOf(more!.sectorCaps, 'market')?.maxKw).toBe(1.5 + POWER_STEP_KW);
    const low: SectorCap[] = [{ sector: 'market', maxKw: 0.2, fromHour: 20, toHour: 24 }];
    expect(
      sectorCapOf(sectorPowerPatch('less', 'market', low, 3, 20)!.sectorCaps, 'market')?.maxKw
    ).toBe(0);
  });

  it('cut = 0 kW now, restore removes the limit; no-ops return null', () => {
    const cut = sectorPowerPatch('cut', 'school', undefined, 1, 10.7);
    expect(cut).toEqual({ sectorCaps: [{ sector: 'school', maxKw: 0, fromHour: 10, toHour: 24 }] });
    expect(sectorPowerPatch('restore', 'market', caps, 3, 20)).toEqual({ sectorCaps: [] });
    expect(sectorPowerPatch('restore', 'school', caps, 3, 20)).toBeNull();
    expect(sectorPowerPatch('more', 'school', caps, 3, 20)).toBeNull();
    expect(sectorPowerPatch('less', 'school', undefined, 0, 20)).toBeNull();
    expect(sectorPowerPatch('cut', 'school', cut!.sectorCaps, 1, 12)).toBeNull();
  });

  it('the clinic is never cut (village constitution), other sectors may be', () => {
    expect(breaksConstitution(sectorPowerPatch('cut', 'health', undefined, 2, 20)!)).toBe(true);
    expect(breaksConstitution(sectorPowerPatch('cut', 'households', undefined, 2, 20)!)).toBe(
      false
    );
    expect(breaksConstitution(sectorPowerPatch('less', 'health', undefined, 2, 20)!)).toBe(false);
  });
});
