import { describe, expect, it } from 'vitest';
import {
  applianceProfileKw,
  applyPatch,
  MAX_APPLIANCES,
  scenarios,
  SECTOR_IDS,
  simulate,
  type Appliance,
} from '@mitsinjo/engine';
import {
  applianceMarkers,
  applianceTagState,
  appliancesPerSector,
  MARKER_FEEDER_H,
  MARKER_RING,
} from '../appliance-markers';
import { terrainHeight } from '../landscape';
import { defaultPosition } from '../placement';
import { SECTOR_POSITIONS, toSceneModel } from '../to-scene-model';
import { NO_LOAD_DUTY } from '../non-electric';

const pump: Appliance = {
  id: 'p1',
  name: 'Pump',
  category: 'water_pump',
  sector: 'water',
  watts: 750,
  quantity: 2,
};
const base = scenarios.cloudy_afternoon.input;

describe('applianceMarkers (PV-T13)', () => {
  it('no appliances → no markers; the scene model carries them', () => {
    expect(applianceMarkers(undefined, SECTOR_POSITIONS, 12)).toEqual([]);
    const input = applyPatch(base, { appliances: [pump] });
    const model = toSceneModel({ input, result: simulate(input, 'proportional'), timeIndex: 12 });
    expect(model.appliances).toHaveLength(1);
    expect(toSceneModel({ input: base }).appliances).toEqual([]);
  });

  it('kW at the hour is the engine profile; glows only when drawing power in a served sector', () => {
    const input = applyPatch(base, { appliances: [pump] });
    const result = simulate(input, 'proportional');
    for (const t of [3, 12, 20]) {
      const [m] = applianceMarkers(input.appliances, SECTOR_POSITIONS, t, result);
      expect(m!.kwNow).toBeCloseTo(applianceProfileKw(pump)[t]!, 12);
      const served = (result.steps[t]!.sectors.water?.servedKw ?? 0) > 0.05;
      expect(m!.running).toBe(served && m!.kwNow > 1e-4);
    }
    // No result yet: nothing glows.
    expect(applianceMarkers([pump], SECTOR_POSITIONS, 12)[0]!.running).toBe(false);
  });

  it('30 lines: all on the outer side of their building, never on top of each other', () => {
    const list: Appliance[] = Array.from({ length: MAX_APPLIANCES }, (_, i) => ({
      ...pump,
      id: `a${i}`,
      sector: SECTOR_IDS[i % 2]!,
    }));
    const markers = applianceMarkers(list, SECTOR_POSITIONS, 12);
    for (const m of markers) {
      const [bx, , bz] = SECTOR_POSITIONS[m.sector];
      expect(Math.hypot(m.position[0], m.position[2])).toBeGreaterThan(Math.hypot(bx, bz));
      expect(Math.hypot(m.position[0] - bx, m.position[2] - bz)).toBeGreaterThanOrEqual(
        MARKER_RING - 1e-9
      );
    }
    for (let i = 0; i < markers.length; i++)
      for (let j = i + 1; j < markers.length; j++) {
        const a = markers[i]!.position;
        const b = markers[j]!.position;
        expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(0.5);
      }
    expect(appliancesPerSector(list)).toMatchObject({ health: 15, water: 15, school: 0 });
  });
});

describe('applianceMarkers free placement (PP-T3)', () => {
  it('position when set: kept, grounded, feeder anchors the sector building', () => {
    const [m] = applianceMarkers([{ ...pump, position: { x: 30, z: 30 } }], SECTOR_POSITIONS, 12);
    expect(m!.position[0]).toBe(30);
    expect(m!.position[2]).toBe(30);
    expect(m!.position[1]).toBe(terrainHeight(30, 30));
    const [bx, , bz] = SECTOR_POSITIONS.water;
    expect(m!.feeder[0]).toBe(bx);
    expect(m!.feeder[2]).toBe(bz);
    expect(m!.feeder[1]).toBe(terrainHeight(bx, bz) + MARKER_FEEDER_H);
  });

  it('off-terrain corner clamps onto the disc; footprints snap out', () => {
    const [corner] = applianceMarkers(
      [{ ...pump, position: { x: 110, z: 110 } }],
      SECTOR_POSITIONS,
      12
    );
    expect(Math.hypot(corner!.position[0], corner!.position[2])).toBeLessThanOrEqual(106);
    expect(corner!.position[0]).toBeCloseTo(corner!.position[2], 9);
    const [bx, , bz] = SECTOR_POSITIONS.water;
    const [inside] = applianceMarkers(
      [{ ...pump, position: { x: bx, z: bz } }],
      SECTOR_POSITIONS,
      12
    );
    // Water clearing r 3.4 + 0.5 clearance: the snapped marker clears it.
    expect(Math.hypot(inside!.position[0] - bx, inside!.position[2] - bz)).toBeGreaterThanOrEqual(
      3.9 - 1e-9
    );
  });

  it('unplaced keeps the ring slot; placing one never moves the ring', () => {
    const placed: Appliance = { ...pump, id: 'placed', position: { x: 30, z: 30 } };
    const ring: Appliance = { ...pump, id: 'ring' };
    const [p, r] = applianceMarkers([placed, ring], SECTOR_POSITIONS, 12);
    // k counts every same-sector appliance in input order, placed or not.
    expect(p!.position[0]).toBe(30);
    const [x, , z] = defaultPosition('water', 1);
    expect(r!.position[0]).toBeCloseTo(x, 9);
    expect(r!.position[2]).toBeCloseTo(z, 9);
    const [solo] = applianceMarkers([ring], SECTOR_POSITIONS, 12);
    const [sx, , sz] = defaultPosition('water', 0);
    expect(solo!.position[0]).toBeCloseTo(sx, 9);
    expect(solo!.position[2]).toBeCloseTo(sz, 9);
  });
});

describe('applianceTagState (PT-11b)', () => {
  const sector = {
    priority: 'critical' as const,
    statusColor: 'warning-amber' as const,
    connected: true,
    inAlert: false,
    onFire: false,
  };

  it('takes its sector priority and served status while it draws power', () => {
    expect(applianceTagState({ kwNow: 0.5 }, sector)).toEqual({
      priority: 'critical',
      statusColor: 'warning-amber',
      inAlert: false,
    });
  });

  it('idle when it draws nothing this hour or its sector is off', () => {
    expect(applianceTagState({ kwNow: 0 }, sector).statusColor).toBe('idle');
    expect(applianceTagState({ kwNow: 0.5 }, { ...sector, connected: false }).statusColor).toBe(
      'idle'
    );
  });

  it('alerts with its sector (fire or critical incident)', () => {
    expect(applianceTagState({ kwNow: 0 }, { ...sector, onFire: true }).inAlert).toBe(true);
    expect(applianceTagState({ kwNow: 0 }, { ...sector, inAlert: true }).inAlert).toBe(true);
  });

  it('the scene model tags every appliance from its sector building', () => {
    const input = applyPatch(base, { appliances: [pump] });
    const model = toSceneModel({ input, result: simulate(input, 'proportional'), timeIndex: 12 });
    const [m] = model.appliances;
    const b = model.buildings.water;
    expect(m!.tag).toEqual(applianceTagState(m!, b));
    expect(m!.tag!.priority).toBe(b.priority);
  });
});

describe('non-electric objects (VS-T40)', () => {
  it('a zero-duty line is flagged, draws 0 kW and gets no pole or cable in the scene', () => {
    const tree: Appliance = {
      id: 't1',
      name: 'Tree',
      category: 'other',
      sector: 'households',
      watts: 100,
      quantity: 1,
      hourlyDuty: [...NO_LOAD_DUTY],
      position: { x: 20, z: 20 },
    };
    const input = applyPatch(base, { appliances: [pump, tree] });
    const model = toSceneModel({ input, result: simulate(input, 'proportional'), timeIndex: 12 });
    const [p, t] = model.appliances!;
    expect(p!.nonElectric).toBeUndefined();
    expect(t!.nonElectric).toBe(true);
    expect(t!.kwNow).toBe(0);
    expect(applianceProfileKw(tree).every((kw) => kw === 0)).toBe(true);
    // Only the pump is wired: every derivation cable ends at the pump, none at the tree.
    const ends = model.lines.applianceDerivations!.map((l) => l.to);
    expect(ends.some((e) => e[0] === t!.position[0] && e[2] === t!.position[2])).toBe(false);
    expect(ends.some((e) => e[0] === p!.position[0] && e[2] === p!.position[2])).toBe(true);
  });
});
