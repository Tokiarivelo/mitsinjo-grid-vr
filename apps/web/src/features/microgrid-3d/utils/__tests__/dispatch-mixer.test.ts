import { describe, expect, it } from 'vitest';
import { APPLIANCE_CATALOG, applyPatch, scenarios, type Appliance } from '@mitsinjo/engine';
import { simulate } from '@mitsinjo/engine';
import { toSceneModel } from '../to-scene-model';
import {
  dispatchMixerStrips,
  applianceLevel,
  applianceLevelPatch,
  levelOfReserve,
  reserveLevelPatch,
  reserveOfLevel,
  sectorFader,
  sectorLevelPatch,
} from '../dispatch-mixer';

const fridge: Appliance = {
  id: 'ph-fridge',
  name: 'Fridge',
  category: 'fridge',
  sector: 'households',
  watts: 100,
  quantity: 1,
};

describe('sectorFader', () => {
  it('sits at the top with no limit, scaled on the demand now', () => {
    expect(sectorFader(4, null)).toEqual({ scaleKw: 4, level: 1, limitKw: null, cut: false });
  });

  it('reads a limit as a share of the demand, a 0 kW limit as cut', () => {
    const cap = { sector: 'households' as const, maxKw: 1, fromHour: 18, toHour: 24 };
    expect(sectorFader(4, cap).level).toBeCloseTo(0.25);
    expect(sectorFader(4, { ...cap, maxKw: 0 }).cut).toBe(true);
    // A limit above the demand widens the scale instead of overflowing it.
    expect(sectorFader(2, { ...cap, maxKw: 3 })).toMatchObject({ scaleKw: 3, level: 1 });
  });
});

describe('sectorLevelPatch', () => {
  it('turns a fader position into a kW limit from the shown hour to the end of the day', () => {
    expect(sectorLevelPatch('school', 0.5, 3, undefined, 18.6)).toEqual({
      sectorCaps: [{ sector: 'school', maxKw: 1.5, fromHour: 18, toHour: 24 }],
    });
  });

  it('removes the limit at the top notch, and does nothing when already there', () => {
    const caps = [{ sector: 'school' as const, maxKw: 1, fromHour: 18, toHour: 24 }];
    expect(sectorLevelPatch('school', 1, 3, caps, 18)).toEqual({ sectorCaps: [] });
    expect(sectorLevelPatch('school', 1, 3, undefined, 18)).toBeNull();
    expect(sectorLevelPatch('school', 1 / 3, 3, caps, 18)).toBeNull();
  });

  it('is accepted by the engine', () => {
    const patch = sectorLevelPatch('school', 0.4, 2.5, undefined, 12)!;
    const input = applyPatch(scenarios.baseline.input, patch);
    expect(input.sectorCaps).toEqual([{ sector: 'school', maxKw: 1, fromHour: 12, toHour: 24 }]);
  });
});

describe('appliance fader', () => {
  it('reads a plain appliance at full level', () => {
    expect(applianceLevel(fridge, 14)).toBe(1);
  });

  it('scales its duty from the shown hour only, and reads it back', () => {
    const patch = applianceLevelPatch([fridge], fridge.id, 0.5, 10)!;
    const next = patch.appliances![0]!;
    const base = APPLIANCE_CATALOG.fridge.hourlyDuty;
    expect(next.hourlyDuty![9]).toBe(base[9]);
    expect(next.hourlyDuty![10]).toBeCloseTo(base[10]! * 0.5, 3);
    expect(applianceLevel(next, 14)).toBeCloseTo(0.5, 2);
  });

  it('cuts at 0 and returns to the plain profile at the top notch', () => {
    const cut = applianceLevelPatch([fridge], fridge.id, 0, 0)!.appliances![0]!;
    expect(cut.hourlyDuty!.every((d) => d === 0)).toBe(true);
    expect(applianceLevel(cut, 12)).toBe(0);
    const back = applianceLevelPatch([cut], fridge.id, 1, 0)!.appliances![0]!;
    expect(back.hourlyDuty).toBeUndefined();
  });

  it('ignores an unknown id and a move that changes nothing', () => {
    expect(applianceLevelPatch([fridge], 'nope', 0.5, 0)).toBeNull();
    expect(applianceLevelPatch([fridge], fridge.id, 1, 0)).toBeNull();
  });

  it('is accepted by the engine', () => {
    const patch = applianceLevelPatch([fridge], fridge.id, 0.3, 6)!;
    expect(() => applyPatch(scenarios.baseline.input, patch)).not.toThrow();
  });
});

describe('battery master fader', () => {
  it('maps up to a lower reserve (more battery dispatched), both ways', () => {
    expect(reserveOfLevel(0)).toBe(90);
    expect(reserveOfLevel(1)).toBe(5);
    expect(levelOfReserve(reserveOfLevel(0.4))).toBeCloseTo(0.4, 1);
  });

  it('patches the reserve only when it moves', () => {
    expect(reserveLevelPatch(1, 20)).toEqual({ minSocPct: 5 });
    expect(reserveLevelPatch(levelOfReserve(20), 20)).toBeNull();
  });
});

describe('dispatchMixerStrips', () => {
  const input = {
    ...scenarios.baseline.input,
    appliances: [
      fridge,
      { ...fridge, id: 'ph-tv', name: 'TV', category: 'tv' as const, watts: 60 },
    ],
  };
  const model = toSceneModel({
    input,
    result: simulate(input, 'proportional'),
    timeIndex: 19,
    placedModels: { 'ph-fridge': { connectionMode: 'ems' } },
  });

  it('lists the battery, the six sectors, then only the appliances wired to the dispatcher', () => {
    const strips = dispatchMixerStrips(model, undefined, input.appliances, 20);
    expect(strips.mixerBattery).toMatchObject({ minSocPct: 20, socPct: model.battery.socPct });
    expect(strips.mixerSectors.map((s) => s.sector)).toHaveLength(6);
    expect(strips.mixerSectors[0]!.servedKw).toBe(
      model.buildings[strips.mixerSectors[0]!.sector].servedKw
    );
    expect(strips.mixerAppliances).toEqual([
      { id: 'ph-fridge', name: 'Fridge', level: 1, kwNow: expect.any(Number) },
    ]);
  });
});
