// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import { renderFlat, THREE_QUARTER, type FlatRender } from '../flat-render';
import {
  buildEntry,
  frontSkinTile,
  objectPhoto,
  renderAtPhoto,
  type TourMockEntry,
} from '../tour-mock/generate';
import { TOUR_SPECS } from '../tour-mock/specs';
import { renderPlant } from '../tour-mock/plant-render';
import { TOUR_MOCK_STOP, skinFromFront, skinWrap } from '../tour-mock';

/**
 * `make tour-mock` (VS-T41): builds the mock answer of every 360° tour object from its spec on its
 * own photo, writes `tour-mock/tour-mock.json` (the shipped mock) and a contact sheet + score table
 * to `test-results/tour-mock/` (photo with outline | model at the photo's view | ¾ | front drawing).
 * `TOUR_MOCK_ONLY=<regex>` rebuilds some objects and keeps the others' entries; `TOUR_MOCK_KEEP=1`
 * keeps every built entry and only cuts the front faces again (VS-T43: `tour-skins.json`, the
 * sheets then show the model wearing its faces: photo | at the photo's view | ¾ | side | back ¾).
 */
const RUN = process.env.TOUR_MOCK === '1';
const ONLY = process.env.TOUR_MOCK_ONLY ? new RegExp(process.env.TOUR_MOCK_ONLY) : null;
const ROOT = join(__dirname, '..', '..', '..', '..');
const JSON_PATH = join(__dirname, '..', 'tour-mock', 'tour-mock.json');
const SKINS_PATH = join(__dirname, '..', 'tour-mock', 'tour-skins.json');
const KEEP = process.env.TOUR_MOCK_KEEP === '1';
const OUT = process.env.TOUR_MOCK_DIR ?? join(ROOT, '..', '..', 'test-results', 'tour-mock');
const TILE = 180;

async function tilePng(render: FlatRender, cols: number, rows: number): Promise<Buffer> {
  const rgba = Buffer.alloc(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const on = render.mask.data[i] === 1;
    rgba[i * 4] = on ? render.rgb[i * 3]! : 255;
    rgba[i * 4 + 1] = on ? render.rgb[i * 3 + 1]! : 255;
    rgba[i * 4 + 2] = on ? render.rgb[i * 3 + 2]! : 255;
    rgba[i * 4 + 3] = 255;
  }
  return sharp(rgba, { raw: { width: cols, height: rows, channels: 4 } })
    .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();
}

describe.runIf(RUN)('tour mock (VS-T41)', () => {
  it('make tour-mock', { timeout: 900_000 }, async () => {
    await mkdir(OUT, { recursive: true });
    const prev: Record<string, TourMockEntry> = existsSync(JSON_PATH)
      ? JSON.parse(readFileSync(JSON_PATH, 'utf8'))
      : {};
    const out: Record<string, TourMockEntry> = { ...prev };
    const skins: Record<string, string> = existsSync(SKINS_PATH)
      ? JSON.parse(readFileSync(SKINS_PATH, 'utf8'))
      : {};
    const rows: string[] = [];
    const tiles: Buffer[] = [];
    for (const room of Object.values(TOUR_ROOMS)) {
      const objs = room.objects.filter(
        (o) => o.outline && TOUR_SPECS[o.id] && (!ONLY || ONLY.test(o.id))
      );
      if (!objs.length) continue;
      const { data, info } = await sharp(join(ROOT, 'public', room.src))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pano = { data, width: info.width, height: info.height };
      for (const o of objs) {
        const t0 = Date.now();
        const shot = await objectPhoto(pano, o.outline!);
        const entry =
          KEEP && prev[o.id] ? prev[o.id]! : await buildEntry(TOUR_SPECS[o.id]!, shot, o.label);
        if (!entry) {
          rows.push(`| ${o.id} | — | — | — | — | not built |`);
          continue;
        }
        out[o.id] = entry;
        const jpg = await frontSkinTile(shot, entry, skinWrap(entry) === 'fold');
        skins[o.id] = jpg.toString('base64');
        const skin = await skinFromFront(entry, jpg, o.outline!);
        const s = entry.score;
        const ok = s.iou >= TOUR_MOCK_STOP.iou && s.deltaE <= TOUR_MOCK_STOP.deltaE;
        rows.push(
          `| ${o.id} | ${s.iou.toFixed(2)} | ${s.edgeF1.toFixed(2)} | ${s.deltaE.toFixed(1)} | ${entry.recipe.parts.length} | ${ok ? 'ok' : 'below'} · ${Date.now() - t0} ms |`
        );
        // Sheet row: photo + outline | model wearing its faces at the photo's view | ¾ | side | back ¾.
        const { photo, box, rings } = shot;
        const px = (n: number, of: number) => Math.round(n * of);
        const left = Math.max(0, px(box.x - box.w * 0.15, photo.width));
        const top = Math.max(0, px(box.y - box.h * 0.15, photo.height));
        const width = Math.min(photo.width - left, px(box.w * 1.3, photo.width) + 1);
        const height = Math.min(photo.height - top, px(box.h * 1.3, photo.height) + 1);
        const poly = rings
          .map(
            (r) =>
              `<polygon points="${r.map(([x, y]) => `${x * photo.width - left},${y * photo.height - top}`).join(' ')}" fill="none" stroke="#ff2a2a" stroke-width="${Math.max(1, width / 160)}"/>`
          )
          .join('');
        const crop = await sharp(photo.buffer)
          .extract({ left, top, width, height })
          .composite([
            {
              input: Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${poly}</svg>`
              ),
            },
          ])
          .png()
          .toBuffer();
        const cropTile = await sharp(crop)
          .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer();
        const aspect = (box.w * photo.width) / (box.h * photo.height);
        const cols = aspect >= 1 ? 160 : Math.max(16, Math.round(160 * aspect));
        const rws = aspect >= 1 ? Math.max(16, Math.round(160 / aspect)) : 160;
        const plant = Boolean(entry.recipe.plant);
        const atPhoto = await tilePng(
          plant
            ? renderPlant(entry.recipe, cols, rws, { yaw: 0, pitch: 0 }, true)
            : renderAtPhoto(skin.recipe, cols, rws, entry.pitch, skin.paint),
          cols,
          rws
        );
        const turn = (yaw: number, pitch: number) =>
          tilePng(
            plant
              ? renderPlant(entry.recipe, 160, 160, { yaw, pitch })
              : renderFlat(skin.recipe, 1, 160, 160, { yaw, pitch }, undefined, skin.paint),
            160,
            160
          );
        const q = await turn(THREE_QUARTER.yaw, THREE_QUARTER.pitch);
        const side = await turn(-Math.PI / 2, 0.05);
        const back = await turn(Math.PI - 0.6, 0.3);
        const label = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE * 5}" height="${TILE}"><text x="4" y="16" font-size="14" fill="#000">${o.id} · IoU ${s.iou.toFixed(2)} · ΔE ${s.deltaE.toFixed(1)}</text></svg>`
        );
        tiles.push(
          await sharp({
            create: { width: TILE * 5, height: TILE, channels: 3, background: '#ffffff' },
          })
            .composite([
              { input: cropTile, left: 0, top: 0 },
              { input: atPhoto, left: TILE, top: 0 },
              { input: q, left: TILE * 2, top: 0 },
              { input: side, left: TILE * 3, top: 0 },
              { input: back, left: TILE * 4, top: 0 },
              { input: label, left: 0, top: 0 },
            ])
            .png()
            .toBuffer()
        );
      }
    }
    const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(JSON_PATH, `${JSON.stringify(sorted)}\n`);
    const skinsSorted = Object.fromEntries(
      Object.entries(skins).sort(([a], [b]) => a.localeCompare(b))
    );
    await writeFile(SKINS_PATH, `${JSON.stringify(skinsSorted)}\n`);
    // Sheets of 8 rows each.
    for (let p = 0; p * 8 < tiles.length; p++) {
      const page = tiles.slice(p * 8, p * 8 + 8);
      await sharp({
        create: { width: TILE * 5, height: TILE * page.length, channels: 3, background: '#ffffff' },
      })
        .composite(page.map((input, i) => ({ input, left: 0, top: i * TILE })))
        .png()
        .toFile(join(OUT, `sheet-${p + 1}.png`));
    }
    const table = [
      '| object | IoU | edge F1 | ΔE | parts | status |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
    await writeFile(join(OUT, 'index.md'), `# Tour mock (VS-T41)\n\n${table}\n`);
    console.info(`\n${table}\n\n→ ${JSON_PATH}\n→ ${OUT}`);
  });
});
