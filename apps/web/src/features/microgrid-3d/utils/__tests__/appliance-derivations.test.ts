import { describe, expect, it } from 'vitest';
import type { Appliance, SectorId } from '@mitsinjo/engine';
import { SECTOR_POSITIONS, BUS_POSITION } from '../site-positions';
import { mapPolesToSectors } from '../cable-route';
import { applianceMarkers } from '../appliance-markers';
import { buildApplianceDerivations } from '../tap-point';
import { NO_LOAD_KW } from '../feeder-tone';

const baseAppliance: Appliance = {
  id: 'app-water-1',
  name: 'Water Pump',
  category: 'water_pump',
  sector: 'water',
  watts: 1500,
  quantity: 1,
};

describe('Appliance derivations & poles (PI-T7)', () => {
  it('re-uses routeCable with poles spaced <= 4.5 scene units', () => {
    // Appliance placed 16m away from the water building (westwards)
    const bPos = SECTOR_POSITIONS.water;
    const markers = applianceMarkers(
      [{ ...baseAppliance, position: { x: bPos[0] - 16, z: bPos[2] } }],
      SECTOR_POSITIONS,
      12
    );

    const derivations = buildApplianceDerivations(markers, {
      water: { statusColor: 'battery-green', onFire: false },
    });

    expect(derivations.lines.length).toBeGreaterThan(0);
    expect(derivations.poles.length).toBeGreaterThanOrEqual(3);

    // Verify pole positions and spacing <= 4.5
    const start = derivations.lines[0]!.from;
    let prev: [number, number] = [start[0], start[2]];
    for (const pole of derivations.poles) {
      expect(pole.sectorId).toBe('water');
      const dist = Math.hypot(pole.x - prev[0], pole.z - prev[1]);
      expect(dist).toBeLessThanOrEqual(4.6);
      prev = [pole.x, pole.z];
    }
  });

  it('attaches derivation poles to the appliance sector in mapPolesToSectors', () => {
    const bPos = SECTOR_POSITIONS.health;
    const markers = applianceMarkers(
      [
        {
          ...baseAppliance,
          id: 'clinic-fridge',
          sector: 'health',
          position: { x: bPos[0] + 12, z: bPos[2] },
        },
      ],
      SECTOR_POSITIONS,
      12
    );

    const derivations = buildApplianceDerivations(markers, {
      health: { statusColor: 'battery-green', onFire: false },
    });

    const dummyLines = {
      solarToBattery: {
        from: [-10, 0, -8] as [number, number, number],
        to: [0, 0, -2] as [number, number, number],
        active: true,
        flowKw: 10,
        direction: 'forward' as const,
        speed: 1,
        color: '#ffb300',
      },
      batteryToBus: {
        from: [0, 0, -2] as [number, number, number],
        to: [0, 0, 1] as [number, number, number],
        active: true,
        flowKw: 10,
        direction: 'forward' as const,
        speed: 1,
        color: '#50d8e8',
      },
      busToSectors: {
        health: {
          from: [0, 0, 1] as [number, number, number],
          to: SECTOR_POSITIONS.health,
          active: true,
          flowKw: 5,
          direction: 'forward' as const,
          speed: 1,
          color: '#4ade80',
        },
      },
      applianceDerivations: derivations.lines,
      appliancePoles: derivations.poles,
    };

    const allPoles = mapPolesToSectors(dummyLines);
    const healthPoles = allPoles.filter((p) => p.sectorId === 'health');

    // Both the sector line poles and the appliance derivation poles must be attached to 'health'
    expect(healthPoles.length).toBeGreaterThan(derivations.poles.length);
    for (const dp of derivations.poles) {
      expect(allPoles.some((p) => p.x === dp.x && p.z === dp.z && p.sectorId === 'health')).toBe(
        true
      );
    }
  });

  it('reflects sector states: délesté/unserved and onFire isolate or cut the derivation', () => {
    const bPos = SECTOR_POSITIONS.households;
    const markers = applianceMarkers(
      [
        {
          ...baseAppliance,
          id: 'h1',
          sector: 'households',
          position: { x: bPos[0] + 10, z: bPos[2] },
        },
      ],
      SECTOR_POSITIONS,
      12
    );

    // 1. Sector on fire: line is cut
    const fireDeriv = buildApplianceDerivations(markers, {
      households: { statusColor: 'critical-red', onFire: true },
    });
    expect(fireDeriv.lines[0]!.cut).toBe(true);

    // 2. Sector served normally: line not cut
    const normalDeriv = buildApplianceDerivations(markers, {
      households: { statusColor: 'battery-green', onFire: false },
    });
    expect(normalDeriv.lines[0]!.cut).toBe(false);
  });

  it('enables electron flow when appliance consumes power', () => {
    const bPos = SECTOR_POSITIONS.water;
    const runningMarker = {
      id: 'pump-run',
      name: 'Pump',
      category: 'water_pump' as const,
      sector: 'water' as SectorId,
      quantity: 1,
      watts: 1500,
      kwNow: 1.5,
      running: true,
      position: [bPos[0] + 8, 0, bPos[2]] as [number, number, number],
      feeder: bPos,
    };

    const idleMarker = {
      ...runningMarker,
      id: 'pump-idle',
      kwNow: 0,
      running: false,
    };

    const runDeriv = buildApplianceDerivations([runningMarker], {
      water: { statusColor: 'battery-green', onFire: false },
    });
    expect(runDeriv.lines[0]!.active).toBe(true);
    expect(runDeriv.lines[0]!.flowKw).toBeGreaterThan(NO_LOAD_KW);
    expect(runDeriv.lines[0]!.direction).toBe('forward');

    const idleDeriv = buildApplianceDerivations([idleMarker], {
      water: { statusColor: 'battery-green', onFire: false },
    });
    expect(idleDeriv.lines[0]!.active).toBe(false);
    expect(idleDeriv.lines[0]!.flowKw).toBe(0);
    expect(idleDeriv.lines[0]!.direction).toBe('idle');
  });

  it('supports direct EMS derivation mode (D1)', () => {
    const markers = applianceMarkers(
      [{ ...baseAppliance, id: 'mill-1', sector: 'industry', position: { x: 10, z: 10 } }],
      SECTOR_POSITIONS,
      12
    );

    const derivations = buildApplianceDerivations(
      markers,
      { industry: { statusColor: 'battery-green', onFire: false } },
      { placedModels: { 'mill-1': { connectionMode: 'ems' } } }
    );

    expect(derivations.lines.length).toBeGreaterThan(0);
    // Line originates from Dispatch EMS (BUS_POSITION)
    expect(derivations.lines[0]!.from[0]).toBeCloseTo(BUS_POSITION[0]);
    expect(derivations.lines[0]!.from[2]).toBeCloseTo(BUS_POSITION[2]);
    // Poles are still attributed to 'industry' (D1 rule: charge counted on sector)
    for (const p of derivations.poles) {
      expect(p.sectorId).toBe('industry');
    }
  });

  it('collé au bâtiment produces 0 poles', () => {
    const bPos = SECTOR_POSITIONS.school;
    // 2 meters away from school
    const markers = applianceMarkers(
      [
        {
          ...baseAppliance,
          id: 'sch-lamp',
          sector: 'school',
          position: { x: bPos[0] + 2, z: bPos[2] },
        },
      ],
      SECTOR_POSITIONS,
      12
    );

    const derivations = buildApplianceDerivations(markers, {
      school: { statusColor: 'battery-green', onFire: false },
    });

    expect(derivations.lines.length).toBe(1);
    expect(derivations.poles.length).toBe(0);
  });
});
