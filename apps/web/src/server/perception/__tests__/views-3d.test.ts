import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ShapeTarget } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import { museImage, museImageReady } from '../facade-specialist';
import { renderFlat, THREE_QUARTER } from '../flat-render';
import { getPerceptionClient } from '../client';
import { carToolAsk, liveReadCar } from '../car/car-specialist';
import { CarReadingSchema } from '../car/car-tools';
import { houseToolAsk } from '../house/house-specialist';
import { reconstructObject, reportLine, type ViewName } from '../recon';
import { reconstructFromViews } from '../recon/reconstruct';
import { decodeView } from '../recon/route';
import { VIEW_NAMES } from '../recon/views';
import { VIEW_CAMERA } from '../recon/score';

/**
 * `make views-3d FRONT=front.png [RIGHT=… BACK=… LEFT=…] OUT=dir [LABEL=…]` (PQ-T69): the app's
 * views reconstruction on your own drawings. With the front and one side it runs offline (pure
 * math, no API call). A missing side, back or left is drawn by Muse Image when Meta is configured
 * (`LLM_PROVIDER=meta` + key; costs one drawing each), and the materials are then asked of the
 * cheap seeing model. Writes `recipe.json`, `report.txt`, each view used (`view-*.png`) and
 * `model.png` (the model seen from the four cameras, front · right · back · left) and `model-34.png`
 * (the model turned ¾, front right then back left), `classes.png` (the colour classes read on each
 * view, canonical frame, magenta = not the object). `OFFLINE=1` never calls Meta.
 */
describe.runIf(process.env.VIEWS_3D_FRONT || process.env.VIEWS_3D_PHOTO)('make views-3d', () => {
  it('rebuilds the object from its views', async () => {
    const out = process.env.VIEWS_3D_OUT;
    if (!out) throw new Error('Usage: make views-3d FRONT=front.png [RIGHT= BACK= LEFT=] OUT=dir');
    const url = async (path?: string) =>
      path
        ? `data:image/png;base64,${(
            await sharp(await readFile(path))
              .png()
              .toBuffer()
          ).toString('base64')}`
        : undefined;
    const topPng = process.env.VIEWS_3D_TOP ? await readFile(process.env.VIEWS_3D_TOP) : undefined;
    const [photoUrl, facadeUrl, side, back, left] = await Promise.all([
      url(process.env.VIEWS_3D_PHOTO),
      url(process.env.VIEWS_3D_FRONT),
      url(process.env.VIEWS_3D_RIGHT),
      url(process.env.VIEWS_3D_BACK),
      url(process.env.VIEWS_3D_LEFT),
    ]);
    const target: ShapeTarget = {
      id: 'views-3d',
      label: process.env.VIEWS_3D_LABEL || 'object',
      category: 'other',
      box: { x: 0, y: 0, w: 1, h: 1 },
      ...(facadeUrl ? { facadeUrl } : {}),
      faceUrls: { ...(side ? { side } : {}), ...(back ? { back } : {}), ...(left ? { left } : {}) },
    };
    const live = !process.env.VIEWS_3D_OFFLINE && museImageReady();
    const perception = live ? getPerceptionClient('views-3d') : null;
    await mkdir(out, { recursive: true });
    const built = await reconstructObject(
      {
        draw: live ? museImage : null,
        ...(perception ? { nameClasses: perception.nameClasses.bind(perception) } : {}),
        // PQ-T72: a house or a building is read by its specialist (one Spark call).
        ...(process.env.VIEWS_3D_READING
          ? {
              // `READING=house-reading.json`: a reading saved by an earlier run, replayed for free.
              readHouse: async () => ({
                reading: JSON.parse(await readFile(process.env.VIEWS_3D_READING!, 'utf8')),
              }),
            }
          : perception && !process.env.VIEWS_3D_NO_HOUSE
            ? {
                readHouse: perception.readHouse.bind(perception),
                // PQ-T73: the pilot and its part specialists (`SINGLE=1` = the PQ-T72 single reading).
                ...(process.env.VIEWS_3D_SINGLE ? {} : { askHouseTool: houseToolAsk(perception) }),
              }
            : {}),
        // PQ-T76: a vehicle is read by the car team (`CAR_READING=car-reading.json` replays a saved one).
        ...(process.env.VIEWS_3D_CAR_READING
          ? {
              readCar: async () =>
                CarReadingSchema.parse(
                  JSON.parse(await readFile(process.env.VIEWS_3D_CAR_READING!, 'utf8'))
                ),
            }
          : perception
            ? { readCar: liveReadCar(carToolAsk(perception)) }
            : {}),
        // Offline: materials given by hand, largest class first (`MATERIALS=slate,wood,…`).
        ...(process.env.VIEWS_3D_MATERIALS
          ? {
              nameClasses: async () => ({
                source: 'meta' as const,
                model: 'by hand',
                materials: process.env.VIEWS_3D_MATERIALS!.split(',') as never,
                // `ROOF=2`: the roof class by hand (1 = largest class), whatever its material.
                ...(process.env.VIEWS_3D_ROOF
                  ? { roof: Number(process.env.VIEWS_3D_ROOF) - 1 }
                  : {}),
              }),
            }
          : {}),
      },
      target,
      {
        // `PHOTO=`: the front itself is drawn from the photo (the object must fill it).
        ...(photoUrl ? { cropUrl: photoUrl } : {}),
        // `TOP=`: the view from above, already drawn (front at the bottom of the image).
        ...(topPng ? { topPng } : {}),
        onView: (view: ViewName | 'top', png) => void writeFile(join(out, `view-${view}.png`), png),
        onHouseReading: (reading) =>
          void writeFile(join(out, 'house-reading.json'), JSON.stringify(reading, null, 2)),
        onCarReading: (reading) =>
          void writeFile(join(out, 'car-reading.json'), JSON.stringify(reading, null, 2)),
      }
    );
    if (!built)
      throw new Error(
        'No model: the front and at least one side must be readable (give RIGHT= or LEFT=, or configure Meta so the side can be drawn).'
      );
    const { recipe, report } = built;
    await writeFile(join(out, 'recipe.json'), JSON.stringify(recipe, null, 2));
    // The viewer shots' input (`scripts/object-viewer-shot.mjs`): this one model.
    await writeFile(
      join(out, 'recipes.json'),
      JSON.stringify([{ name: target.label.replace(/\W+/g, '-'), recipe }])
    );
    if (recipe.house)
      await writeFile(join(out, 'house.json'), JSON.stringify(recipe.house, null, 2));
    if (recipe.car) await writeFile(join(out, 'car.json'), JSON.stringify(recipe.car, null, 2));
    // The drawings as projected on the model (one tile per view, paper bled over).
    if (recipe.faces)
      await writeFile(
        join(out, 'faces-atlas.jpg'),
        Buffer.from(recipe.faces.atlas.slice(recipe.faces.atlas.indexOf(',') + 1), 'base64')
      );
    await writeFile(join(out, 'report.txt'), `${reportLine(report)}\n`);
    // The model from the four cameras, 256 px tall each, side by side.
    const rows = 256;
    const tiles = (['front', 'right', 'back', 'left'] as const).map((view) => {
      const across =
        view === 'front' || view === 'back' ? recipe.proportions.w : recipe.proportions.d;
      const cols = Math.max(8, Math.round((rows * across) / recipe.proportions.h));
      const r = renderFlat(recipe, 1, cols, rows, VIEW_CAMERA[view], () => ({
        cx: 0,
        cy: 0,
        fw: across * 1.06,
        fh: recipe.proportions.h * 1.06,
      }));
      const rgb = Buffer.from(r.rgb);
      r.mask.data.forEach((v, i) => {
        if (!v) rgb.fill(255, i * 3, i * 3 + 3);
      });
      return { cols, rgb };
    });
    const gap = 12;
    const width = tiles.reduce((w, t) => w + t.cols + gap, gap);
    let leftEdge = gap;
    const tileLefts = tiles.map((t) => {
      const at = leftEdge;
      leftEdge += t.cols + gap;
      return at;
    });
    const composites = await Promise.all(
      tiles.map(async (t, i) => ({
        input: await sharp(t.rgb, { raw: { width: t.cols, height: rows, channels: 3 } })
          .png()
          .toBuffer(),
        left: tileLefts[i]!,
        top: gap,
      }))
    );
    await sharp({ create: { width, height: rows + 2 * gap, channels: 3, background: '#ffffff' } })
      .composite(composites)
      .png()
      .toFile(join(out, 'model.png'));
    // What the solver read: each view's colour classes on the working grid (paper = outside the object).
    const pngs = { front: facadeUrl, right: side, back, left };
    const decoded: Parameters<typeof reconstructFromViews>[0] = {};
    for (const view of VIEW_NAMES) {
      const data = pngs[view];
      const img = data
        ? await decodeView(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
        : null;
      if (img) decoded[view] = img;
    }
    const recon = reconstructFromViews(decoded);
    if (recon) {
      const scale = 3;
      const maps = VIEW_NAMES.flatMap((view) => {
        const labels = recon.palette.labels[view];
        const grid = recon.aligned.views[view];
        if (!labels || !grid) return [];
        const rgb = Buffer.alloc(grid.cols * grid.rows * 3, 255);
        labels.forEach((l, i) => {
          if (l < 0) return;
          const n = parseInt(recon.palette.classes[l]!.hex.slice(1), 16);
          rgb.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], i * 3);
        });
        return [{ rgb, cols: grid.cols, rows: grid.rows }];
      });
      let x = gap;
      const lefts = maps.map((m) => {
        const left = x;
        x += m.cols * scale + gap;
        return left;
      });
      const placed = await Promise.all(
        maps.map(async (m, i) => ({
          input: await sharp(m.rgb, { raw: { width: m.cols, height: m.rows, channels: 3 } })
            .resize(m.cols * scale, m.rows * scale, { kernel: 'nearest' })
            .png()
            .toBuffer(),
          left: lefts[i]!,
          top: gap,
        }))
      );
      await sharp({
        create: {
          width: x,
          height: recon.aligned.H * scale + 2 * gap,
          channels: 3,
          background: '#ff00ff',
        },
      })
        .composite(placed)
        .png()
        .toFile(join(out, 'classes.png'));
    }
    // The model turned (¾ from the front right, then from the back left): what the four cameras cannot show.
    const turns = [THREE_QUARTER, { yaw: THREE_QUARTER.yaw + Math.PI, pitch: THREE_QUARTER.pitch }];
    const turnedSide = 420;
    const turned = await Promise.all(
      turns.map(async (view, i) => {
        const r = renderFlat(recipe, 1, turnedSide, turnedSide, view);
        const rgb = Buffer.from(r.rgb);
        r.mask.data.forEach((v, k) => {
          if (!v) rgb.fill(255, k * 3, k * 3 + 3);
        });
        const input = await sharp(rgb, {
          raw: { width: turnedSide, height: turnedSide, channels: 3 },
        })
          .png()
          .toBuffer();
        return { input, left: gap + i * (turnedSide + gap), top: gap };
      })
    );
    await sharp({
      create: {
        width: 2 * turnedSide + 3 * gap,
        height: turnedSide + 2 * gap,
        channels: 3,
        background: '#ffffff',
      },
    })
      .composite(turned)
      .png()
      .toFile(join(out, 'model-34.png'));
    console.info(`\n${recipe.parts.length} parts — ${reportLine(report)}\n→ ${out}`);
    expect(recipe.parts.length).toBeGreaterThan(0);
  }, 1_800_000);
});
