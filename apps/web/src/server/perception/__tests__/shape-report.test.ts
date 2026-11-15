// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderFlat, THREE_QUARTER } from '../flat-render';
import type { ModelScore } from '../model-score';
import { scoreRecipe } from '../score-shape';
import {
  contactSheet,
  reportMarkdown,
  reportRow,
  scoreRealSet,
  worstMetric,
  type ReportRow,
  type SheetRow,
} from '../shape-report';
import { GOLDEN_SHAPES, REAL_SHAPES, type RealCase } from '../__fixtures__/shape';
import { GOLDEN_ELEVATIONS } from '../__fixtures__/elevation';
import {
  elevationDiff,
  elevationTarget,
  scoreElevation,
  ELEVATION_CONCEPTS,
} from '../elevation-score';
import { facadeHouseRecipe, measureElevation } from '../facade-house';
import { fitRecipe } from '@/lib/object-shape';
import { elevationMarkdown, type ElevationRow } from '../shape-report';
import { runGolden, writeGoldenCapture } from './golden-run';

/** Grey levels of the drawing's concepts (label map tile, PG-T4). */
const LABEL_GREY = [200, 160, 120, 70, 90, 30];

/** One elevation row: drawing labels | render | diff, ×2 nearest. */
async function elevationTile(
  recipe: Parameters<typeof elevationDiff>[0],
  s: Parameters<typeof elevationDiff>[1]
): Promise<Buffer> {
  const { cols, rows, label } = s.target;
  const labels = Buffer.alloc(cols * rows * 3, 255);
  label.forEach((v, i) => {
    if (v >= 0) labels.fill(LABEL_GREY[v]!, i * 3, i * 3 + 3);
  });
  const built = Buffer.from(s.render.rgb);
  s.render.mask.data.forEach((v, i) => {
    if (!v) built.fill(255, i * 3, i * 3 + 3);
  });
  const diff = Buffer.from(elevationDiff(recipe, s).rgb);
  const png = (b: Buffer) =>
    sharp(b, { raw: { width: cols, height: rows, channels: 3 } })
      .resize(cols * 2, rows * 2, { kernel: 'nearest' })
      .png()
      .toBuffer();
  const tiles = await Promise.all([labels, built, diff].map(png));
  return sharp({
    create: { width: cols * 6, height: rows * 2, channels: 3, background: '#ffffff' },
  })
    .composite(tiles.map((input, i) => ({ input, left: i * cols * 2, top: 0 })))
    .png()
    .toBuffer();
}

/** PNG tiles stacked vertically. */
async function stack(tiles: Buffer[]): Promise<Buffer> {
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const width = Math.max(...metas.map((m) => m.width!));
  let top = 0;
  const parts = metas.map((m, i) => {
    const p = { input: tiles[i]!, left: 0, top };
    top += m.height!;
    return p;
  });
  return sharp({ create: { width, height: top, channels: 3, background: '#ffffff' } })
    .composite(parts)
    .png()
    .toBuffer();
}

const score = (over: Partial<ModelScore>): ModelScore => ({
  iou: 0.9,
  edgeF1: 0.7,
  deltaE: 4,
  score: 85,
  ...over,
});

describe('shape report (PR-0.3)', () => {
  it('names the metric farthest from its target', () => {
    expect(worstMetric(score({ edgeF1: 0.3 })).metric).toBe('edgeF1');
    expect(worstMetric(score({ deltaE: 20 })).metric).toBe('deltaE');
    expect(worstMetric(score({})).gap).toBeLessThanOrEqual(0);
  });

  it('writes one row per object, the means and the next object to fix', () => {
    const rows: ReportRow[] = [
      {
        name: 'fridge',
        score: score({ score: 97 }),
        parts: 3,
        ms: 40,
        violations: 0,
        statusCounts: { measured: 1, estimated: 1, inferred: 1, unknown: 0 },
      },
      {
        name: 'car',
        score: score({
          score: 60,
          edgeF1: 0.4,
          detail: {
            partRecall: 0.5,
            partPrecision: 1,
            interiorEdgeF1: 0.31,
            partDeltaE: 6.2,
            anatomyRecall: 0.75,
            bandSsim: 0.42,
            worstBand: 3,
            blankBands: 1,
          },
        }),
        view: { sideShare: 0.05, pieces45: 1, fail: 'thin' },
        notBuilt: ['wheel ×1'],
        parts: 7,
        ms: 80,
        violations: 2,
        statusCounts: { measured: 0, estimated: 0, inferred: 5, unknown: 2 },
      },
    ];
    const md = reportMarkdown(rows, '2026-11-01');
    expect(md).toContain('| car | 60 | 0.9 ✓ | 0.4 ✗ |');
    expect(md).toContain(
      // PQ-T6 gates: recall ≥ 0.8 ✗, precision ≥ 0.8 ✓, interior F1 ≥ 0.12 ✓, part ΔE ≤ 7 ✓;
      // then the anatomy recall (PQ-T46, no gate).
      '| 0.5 ✗ | 1 ✓ | 0.31 ✓ | 6.2 ✓ | 0.75 | 0.42@3 ✗ 1 blank | ✗ thin 0.05 | wheel ×1 | 7 | 80 | 2 | I5 U2 | edgeF1 |'
    );
    expect(md).toContain('| — | — | — | — | — | — | — | — | 3 | 40 |');
    expect(md).toContain('| **mean** | 79 |');
    expect(md).toContain('| 4.0 | | | | | 0.75 |');
    expect(md).toContain('**Next:** car (score 60) — edgeF1');
  });

  it('prints a « Real » table and takes « Next » from it (PQ-T1)', () => {
    const synthetic: ReportRow[] = [
      {
        name: 'tree',
        score: score({ score: 40, iou: 0.3 }),
        parts: 2,
        ms: 10,
        violations: 0,
        statusCounts: { measured: 1, estimated: 0, inferred: 1, unknown: 0 },
      },
    ];
    const real: ReportRow = {
      name: 'fan',
      score: score({ score: 70, deltaE: 20 }),
      parts: 4,
      violations: 0,
      statusCounts: { measured: 0, estimated: 0, inferred: 0, unknown: 4 },
    };
    const md = reportMarkdown(synthetic, '2026-11-10', {
      rows: [real],
      missing: ['car-side'],
      unscored: ['TV'],
    });
    expect(md).toContain('Not scorable (capture without outline or recipe): TV.');
    expect(md).toContain('## Real (1 captured, 1 missing)');
    expect(md).toContain('| fan | 70 |');
    expect(md).toContain('| — | — | — | 4 | — | 0 | U4 | deltaE |');
    expect(md).toContain('Missing (`make shape-capture PHOTO=… ID=<id>`): car-side.');
    expect(md).toContain('**Next:** fan (score 70) — deltaE');
    // Without real rows, « Next » stays on the synthetic table.
    const none = reportMarkdown(synthetic, '2026-11-10', { rows: [], missing: ['fan'] });
    expect(none).toContain('No real capture on this machine.');
    expect(none).toContain('**Next:** tree (score 40)');
  });

  it('re-scores the captured real cases and skips the missing ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shape-real-'));
    await writeGoldenCapture(dir, 'refrigerator');
    const cases: RealCase[] = [
      { kind: 'real', id: 'refrigerator', subject: 'fridge' },
      { kind: 'real', id: 'car-hidden', subject: 'car partly hidden', hard: 'hidden' },
    ];
    const { scored, missing, unscored } = await scoreRealSet(dir, cases);
    expect(missing).toEqual(['car-hidden']);
    expect(unscored).toEqual([]);
    expect(scored).toHaveLength(1);
    expect(scored[0]!.row.name).toBe('refrigerator');
    expect(scored[0]!.row.ms).toBeUndefined();
    expect(scored[0]!.row.score.iou).toBeGreaterThan(0.6);
    expect(REAL_SHAPES.length).toBeGreaterThanOrEqual(12);
    expect(REAL_SHAPES.filter((c) => c.hard).length).toBeGreaterThanOrEqual(3);
  });

  it('writes the elevation section with ✓ / ✗ against the stop criteria', () => {
    const front = measureElevation(GOLDEN_ELEVATIONS[0]!.masks)!;
    const recipe = fitRecipe(
      {
        ...facadeHouseRecipe({ front, side: null, colors: GOLDEN_ELEVATIONS[0]!.colors }),
        source: 'facade',
      },
      0
    );
    const md = elevationMarkdown([
      { name: 'thatched house', score: scoreElevation(recipe, front) },
    ]);
    expect(md).toContain('## Elevation');
    expect(md).toMatch(/\| thatched house \| \d+ \| (1|0\.9\d*) ✓ \|/);
    expect(md).toContain('| 3/3 |');
    expect(ELEVATION_CONCEPTS).toHaveLength(6);
    expect(elevationTarget(front).openings).toHaveLength(3);
  });

  it('builds a contact sheet with a row per object', async () => {
    const { shape, photo, target } = await runGolden(GOLDEN_SHAPES[3]!);
    const s = (await scoreRecipe(photo, target, shape.recipe!))!;
    const row: SheetRow = {
      name: 'car',
      crop: s.crop,
      flat: s.render,
      threeQuarter: renderFlat(shape.recipe!, 1, 160, 120, THREE_QUARTER),
    };
    const meta = await sharp(await contactSheet([row, row])).metadata();
    expect(meta.format).toBe('png');
    expect(meta.height).toBeGreaterThan(2 * 160);
  });
});

/**
 * `make shape-report` (SHAPE_REPORT=1): the golden set → `test-results/shape-report/` (index.md +
 * contact-sheet.png + recipes.json). Skipped in the normal suite.
 */
describe.runIf(process.env.SHAPE_REPORT)('make shape-report', () => {
  it('writes the report', async () => {
    const dir = process.env.SHAPE_REPORT_DIR ?? join(process.cwd(), 'test-results', 'shape-report');
    const rows: ReportRow[] = [];
    const sheet: SheetRow[] = [];
    const recipes: Array<{ name: string; recipe: unknown }> = [];
    for (const c of GOLDEN_SHAPES) {
      await runGolden(c); // warm-up: `ms` is the steady-state math
      const { shape, ms, photo, target } = await runGolden(c);
      const recipe = shape.recipe!;
      const s = await scoreRecipe(photo, target, recipe);
      if (!s) continue;
      rows.push(reportRow(c.name, s.score, recipe, c.prior.archetype, ms));
      recipes.push({ name: c.name, recipe });
      sheet.push({
        name: `${c.name} — ${s.score.score}`,
        crop: s.crop,
        flat: s.render,
        threeQuarter: renderFlat(recipe, 1, 160, 120, THREE_QUARTER),
      });
    }
    // PQ-T1: the real set, re-scored from the local captures (`real/` is gitignored).
    const realDir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const real = await scoreRealSet(realDir, REAL_SHAPES);
    for (const r of real.scored) sheet.push(r.sheet);
    await mkdir(dir, { recursive: true });
    const md = reportMarkdown(rows, new Date().toISOString().slice(0, 10), {
      rows: real.scored.map((r) => r.row),
      missing: real.missing,
      unscored: real.unscored,
    });
    // PG-T4: every golden drawing rebuilt and scored straight on.
    const elevRows: ElevationRow[] = [];
    const elevTiles: Buffer[] = [];
    for (const g of GOLDEN_ELEVATIONS) {
      const front = measureElevation(g.masks)!;
      const recipe = fitRecipe(
        {
          ...facadeHouseRecipe({
            front,
            side: null,
            colors: g.colors,
            ...(g.partMaterials ? { partMaterials: g.partMaterials } : {}),
          }),
          source: 'facade',
        },
        0
      );
      const s = scoreElevation(
        recipe,
        front,
        front.roofRings ? { roofRings: front.roofRings } : {}
      );
      elevRows.push({ name: g.name, score: s });
      recipes.push({ name: g.name, recipe });
      elevTiles.push(await elevationTile(recipe, s));
    }
    const elevMd = elevationMarkdown(elevRows);
    await writeFile(join(dir, 'index.md'), md + '\n' + elevMd);
    if (elevTiles.length) await writeFile(join(dir, 'elevation-sheet.png'), await stack(elevTiles));
    await writeFile(join(dir, 'contact-sheet.png'), await contactSheet(sheet));
    // Fitted recipes for `make shape-shots` (the real 3D viewer, stubbed API).
    await writeFile(join(dir, 'recipes.json'), JSON.stringify(recipes));
    console.info(`\n${md}\n${elevMd}\n→ ${dir}`);
    expect(rows.length).toBe(GOLDEN_SHAPES.length);
  }, 60_000);
});
