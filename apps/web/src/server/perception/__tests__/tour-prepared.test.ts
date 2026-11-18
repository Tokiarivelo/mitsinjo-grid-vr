// @vitest-environment node
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { FACE_NAMES, ObjectShapeSchema } from '@/lib/object-shape';
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import { tourMockDrawing, tourMockShape } from '../tour-mock';
import {
  PREPARED_IDS,
  preparedDrawing,
  preparedModelUrl,
  preparedViewKey,
} from '../tour-mock/prepared';

const PUBLIC = join(__dirname, '../../../../public');
const OBJECTS = Object.values(TOUR_ROOMS).flatMap((r) => r.objects);

describe('prepared tour answers (VS-T52)', () => {
  it('names the main view: a car by its profile, anything else by its front', () => {
    expect(preparedViewKey('main', true)).toBe('right');
    expect(preparedViewKey('main', false)).toBe('front');
    expect(preparedViewKey('side', false)).toBe('right');
    expect(preparedViewKey('bottom', true)).toBe('bottom');
  });

  it('ships a model and every face the studio asks of each prepared object', () => {
    for (const id of PREPARED_IDS) {
      const object = OBJECTS.find((o) => o.id === id);
      expect(object, id).toBeDefined();
      expect(existsSync(join(PUBLIC, preparedModelUrl(id)!)), id).toBe(true);
      const vehicle = object!.scenery === 'vehicle';
      const faces = FACE_NAMES.filter((f) => vehicle || f !== 'bottom');
      for (const face of ['main' as const, ...faces])
        expect(
          existsSync(join(PUBLIC, 'models/prepared', id, `${preparedViewKey(face, vehicle)}.png`)),
          `${id} ${face}`
        ).toBe(true);
    }
  });

  it('answers nothing for any other object', async () => {
    expect(preparedModelUrl('loft-fridge')).toBeNull();
    expect(await preparedDrawing('loft-fridge', 'main', false)).toBeNull();
  });

  it('serves its drawings and its model through the tour mock', async () => {
    const sofa = {
      id: 'hall-sofa',
      label: 'Sofa',
      category: 'other' as const,
      box: { x: 0.33, y: 0.56, w: 0.1, h: 0.09 },
      outline: 'M0.33 0.56L0.43 0.56L0.43 0.65Z',
    };
    const png = await tourMockDrawing(sofa, 'main');
    const meta = await sharp(png!).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(512);
    const shape = await tourMockShape(sofa, null);
    expect(shape?.modelUrl).toBe('/models/prepared/hall-sofa/model.glb');
    expect(shape?.recipe).toBeDefined(); // still its footprint and size in the village
    expect(ObjectShapeSchema.safeParse(shape).success).toBe(true);
    expect(ObjectShapeSchema.shape.modelUrl.safeParse('https://elsewhere/x.glb').success).toBe(
      false
    );
  });
});
