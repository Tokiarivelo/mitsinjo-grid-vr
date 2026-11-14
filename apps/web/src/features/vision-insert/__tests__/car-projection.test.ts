import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAR_SLOTS } from '@/lib/car-mesh';
import type { CarPlan } from '@/lib/car-plan';
import {
  CAR_GLASS_ROUGHNESS,
  CAR_PAINT_ROUGHNESS,
  CAR_UNDER_COLOR,
  carGeometry,
  carMaterials,
  carSlotLooks,
} from '../utils/car-projection';

const ATLAS =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const car: CarPlan = {
  wheels: [
    { z: 0.2, y: 0.2, r: 0.2 },
    { z: 0.8, y: 0.2, r: 0.2 },
  ],
  body: {
    z0: 0,
    z1: 1,
    top: [0.8, 0.9, 0.9, 0.8],
    bottom: [0.25, 0.25, 0.25, 0.25],
    half: [0.45, 0.45, 0.4, 0.35],
  },
  windows: [
    {
      view: 'right',
      points: [
        [0.3, 0.55],
        [0.7, 0.55],
        [0.7, 0.8],
      ],
    },
  ],
  look: { paint: '#c82828', glass: '#405060', tyre: '#151515' },
};
const proportions = { w: 0.4, h: 0.35, d: 1 };
const faces = {
  atlas: ATLAS,
  views: ['front', 'right', 'back', 'left'] as Array<'front' | 'right' | 'back' | 'left'>,
  hull: { grid: [4, 4, 4] as [number, number, number], boxes: [[0, 4, 0, 4, 0, 4]] as never },
};

describe('carGeometry', () => {
  it('is null without a fitted body', () => {
    expect(carGeometry({ proportions, car: { wheels: car.wheels } })).toBeNull();
  });

  it('has one group per slot', () => {
    const geo = carGeometry({ proportions, car })!;
    const used = new Set(geo.groups.filter((g) => g.count > 0).map((g) => g.materialIndex));
    expect(used.has(CAR_SLOTS.indexOf('glass'))).toBe(true);
    expect(used.has(CAR_SLOTS.indexOf('tyre'))).toBe(true);
    geo.dispose();
  });
});

describe('carSlotLooks', () => {
  it('takes the measured colours without drawings', () => {
    const looks = carSlotLooks({ proportions, car });
    const at = (s: string) => looks[CAR_SLOTS.indexOf(s as never)]!;
    expect(at('right')).toMatchObject({ drawn: false, surface: 'metal', color: '#c82828' });
    expect(at('glass')).toMatchObject({ surface: 'glass', color: '#405060' });
    expect(at('tyre')).toMatchObject({ surface: 'rubber', color: '#151515' });
    expect(at('under').color).toBe(CAR_UNDER_COLOR);
  });

  it('draws the body, glass and rims; the operator material wins on a surface', () => {
    const looks = carSlotLooks({
      proportions,
      car,
      faces: { ...faces, surfaces: { left: { material: 'wood', color: '#806040' } } } as never,
    });
    const at = (s: string) => looks[CAR_SLOTS.indexOf(s as never)]!;
    expect(at('right').drawn).toBe(true);
    expect(at('glass').drawn).toBe(true);
    expect(at('rim').drawn).toBe(true);
    expect(at('tyre').drawn).toBe(false);
    expect(at('left')).toMatchObject({ drawn: false, surface: 'wood', color: '#806040' });
  });
});

describe('carMaterials', () => {
  it('lacquers the drawn body and glazes the drawn windows', () => {
    const mats = carMaterials({ proportions, car, faces });
    expect(mats).toHaveLength(CAR_SLOTS.length);
    const body = mats[CAR_SLOTS.indexOf('right')]! as THREE.MeshPhysicalMaterial;
    const glass = mats[CAR_SLOTS.indexOf('glass')]! as THREE.MeshPhysicalMaterial;
    expect(body).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(body.roughness).toBe(CAR_PAINT_ROUGHNESS);
    expect(glass.roughness).toBe(CAR_GLASS_ROUGHNESS);
    expect(mats[CAR_SLOTS.indexOf('tyre')]!.map).not.toBe(body.map);
    for (const m of mats) m.dispose();
  });
});
