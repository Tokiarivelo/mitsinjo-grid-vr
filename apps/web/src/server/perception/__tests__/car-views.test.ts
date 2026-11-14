import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { facesFor, OBJECT_FACES, VEHICLE_FACES, type ShapeTarget } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import {
  buildCarFacePrompt,
  buildCarProfilePrompt,
  CAR_PROFILE_FROM_PHOTO,
} from '../car/car-views';
import { buildFacePrompt } from '../facade-faces';
import { buildFacadePrompt } from '../facade-specialist';
import { reconstructObject } from '../recon';
import { FACADE_REFERENCE_LINE, PROFILE_REFERENCE_LINE, shapeQuestion } from '../shape';
import type { DrawnView } from '../recon/route';
import { carViews } from './fixtures/draw-views';

const png = async (img: { cols: number; rows: number; rgb: Uint8Array }) =>
  sharp(Buffer.from(img.rgb), { raw: { width: img.cols, height: img.rows, channels: 3 } })
    .png()
    .toBuffer();
const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
/** A whole reconstruction: ≈ 1.5 s alone, more under the full suite's parallel load. */
const RECON_TIMEOUT = 30_000;

describe('vehicle drawings (PQ-T76): the profile first', () => {
  it('a vehicle has front, back, top and underside; other objects keep their four views', () => {
    expect(facesFor('vehicle')).toBe(VEHICLE_FACES);
    expect(facesFor('house')).toBe(OBJECT_FACES);
    expect(facesFor(undefined)).toBe(OBJECT_FACES);
    expect(VEHICLE_FACES).not.toContain('left');
  });

  it('the 2D view of a vehicle is its profile, front to the right, from any photo angle', () => {
    const prompt = buildFacadePrompt('vehicle', 'blue pickup', 'red stripe', { fromPhoto: true });
    expect(prompt).toContain('side elevation (profile)');
    expect(prompt).toContain('front pointing to the RIGHT');
    expect(prompt).toContain(CAR_PROFILE_FROM_PHOTO);
    expect(prompt).toContain('red stripe');
    expect(buildCarProfilePrompt('van', false)).not.toContain(CAR_PROFILE_FROM_PHOTO);
    // Houses are untouched.
    expect(buildFacadePrompt('house', 'cottage')).toContain('front elevation');
  });

  it('tells Spark the 2D view of a vehicle is its profile', () => {
    expect(shapeQuestion('car', 2, 'vehicle', true)).toContain(PROFILE_REFERENCE_LINE);
    expect(shapeQuestion('hut', 1, 'house', true)).toContain(FACADE_REFERENCE_LINE);
  });

  it('each face is drawn from the profile, the plans with the front at the bottom', () => {
    expect(buildCarFacePrompt('front', 'sedan')).toContain('side profile of one sedan');
    expect(buildCarFacePrompt('back', 'sedan', { known: 2 })).toContain('REAR view');
    for (const f of ['top', 'bottom'] as const)
      expect(buildCarFacePrompt(f, 'sedan')).toContain('FRONT at the BOTTOM');
    expect(buildCarFacePrompt('bottom', 'sedan')).toContain('DIRECTLY BELOW');
    // The face route asks the car prompts for a vehicle, the house ones otherwise.
    expect(buildFacePrompt('front', 'jeep', 'vehicle')).toBe(buildCarFacePrompt('front', 'jeep'));
    expect(buildFacePrompt('top', 'jeep', 'vehicle', { known: 2 })).toBe(
      buildCarFacePrompt('top', 'jeep', { known: 2 })
    );
    expect(buildFacePrompt('top', 'hut', 'house')).toContain('roof plan');
  });

  it(
    'builds a car from its profile: the left side mirrored, the other views drawn from the profile',
    async () => {
      const views = carViews();
      const profile = await png(views.right);
      const [front, back] = await Promise.all([png(views.front), png(views.back)]);
      const calls: Array<{ prompt: string; refs: string[] }> = [];
      const draw = vi.fn(async (prompt: string, refs: string[]) => {
        calls.push({ prompt, refs });
        if (prompt.includes('FRONT view')) return front;
        if (prompt.includes('REAR view')) return back;
        throw new Error('not drawn');
      });
      const seen: DrawnView[] = [];
      const target: ShapeTarget = {
        id: 'car',
        label: 'car',
        category: 'other',
        box: { x: 0, y: 0, w: 1, h: 1 },
        facadeUrl: dataUrl(profile),
      };
      const built = await reconstructObject({ draw }, target, {
        onView: (view) => seen.push(view),
      });
      expect(built).not.toBeNull();
      // The front first (from the profile alone), then back, top and underside from both.
      expect(calls[0]!.prompt).toContain('FRONT view');
      expect(calls[0]!.refs).toEqual([dataUrl(profile)]);
      expect(
        calls.slice(1).every((c) => c.refs.length === 2 && c.refs[0] === dataUrl(profile))
      ).toBe(true);
      expect(calls.some((c) => c.prompt.includes('DIRECTLY BELOW'))).toBe(true);
      expect(calls.some((c) => /LEFT SIDE/.test(c.prompt))).toBe(false);
      expect(seen.slice(0, 3)).toEqual(['right', 'left', 'front']);
      expect(built!.drawn).toEqual(expect.arrayContaining(['front', 'back']));
      expect(built!.drawn).not.toContain('left');
      expect(built!.recipe.car?.wheels.length).toBe(2);
    },
    RECON_TIMEOUT
  );

  it(
    'builds the car the way its profile points: front to the right of the drawing = front of the model (PQ-T78)',
    async () => {
      // A profile with its cabin over the rear half and a long bonnet toward the image's right.
      const profile = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="120">
            <rect width="260" height="120" fill="#cfe0fa"/>
            <rect x="20" y="50" width="220" height="40" fill="#c82828"/>
            <rect x="24" y="22" width="96" height="30" fill="#c82828"/>
            <circle cx="65" cy="90" r="14" fill="#19191c"/>
            <circle cx="195" cy="90" r="14" fill="#19191c"/>
          </svg>`
        )
      )
        .png()
        .toBuffer();
      const target: ShapeTarget = {
        id: 'car',
        label: 'car',
        category: 'other',
        box: { x: 0, y: 0, w: 1, h: 1 },
        facadeUrl: dataUrl(profile),
        faceUrls: { front: dataUrl(await png(carViews().front)) },
      };
      const built = await reconstructObject({ draw: null }, target, { fourFaces: false });
      const top = built!.recipe.car!.body!.top;
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      // Stations run back → front: the cabin (high) is at the back, the bonnet (low) at the front.
      expect(mean(top.slice(4, 24))).toBeGreaterThan(mean(top.slice(40, 60)) + 0.2);
    },
    RECON_TIMEOUT
  );

  it(
    'uses the validated faces and draws nothing without a profile',
    async () => {
      const views = carViews();
      const draw = vi.fn(async () => Buffer.alloc(0));
      const target: ShapeTarget = {
        id: 'car',
        label: 'car',
        category: 'other',
        box: { x: 0, y: 0, w: 1, h: 1 },
        facadeUrl: dataUrl(await png(views.right)),
        faceUrls: { front: dataUrl(await png(views.front)) },
      };
      const built = await reconstructObject({ draw }, target, { fourFaces: false });
      expect(built).not.toBeNull();
      expect(draw).not.toHaveBeenCalled();
      expect(
        await reconstructObject({ draw }, { ...target, facadeUrl: undefined, faceUrls: {} })
      ).toBeNull();
    },
    RECON_TIMEOUT
  );
});
