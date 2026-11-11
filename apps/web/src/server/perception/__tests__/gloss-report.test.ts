// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { pathToRings } from '@/lib/vision';
import { glossOfGap, measureGlossGaps } from '../gloss-measure';
import { REGION_GRID } from '../region-colors';
import { readCapture } from '../shape-capture';
import { sampleObjectRgb } from '../shape-colors';

/**
 * `make gloss-report` (PQ-T26): the gloss class of every material of the real captures, read on their saved
 * crops. No API call. Skipped without `GLOSS_REPORT=1` or without the local captures.
 */
const dir =
  process.env.SHAPE_REAL_DIR ??
  join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
const run = process.env.GLOSS_REPORT === '1' && existsSync(dir);

describe.skipIf(!run)('make gloss-report', () => {
  it('prints the gloss per material of the real captures', async () => {
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith('.capture.json'))
      .map((f) => f.replace('.capture.json', ''));
    const rows: string[] = [];
    for (const id of ids) {
      const { capture, cropPhoto } = await readCapture(dir, id);
      if (!capture.recipe) continue;
      const { box, outline } = capture.cropTarget;
      const grid = await sampleObjectRgb(cropPhoto, box, REGION_GRID, REGION_GRID);
      const rings = outline ? pathToRings(outline).filter((r) => r.length >= 3) : [];
      const gaps = measureGlossGaps(grid, rings, box, capture.recipe);
      const cells = [...gaps]
        .map(([m, g]) => `${m} ${glossOfGap(g.gap)} (ΔL* ${g.gap.toFixed(1)}, ${g.cells} cells)`)
        .join(' · ');
      rows.push(`| ${id} | ${capture.target.label} | ${cells || '—'} |`);
    }
    console.info(
      ['| Capture | Object | Gloss per material |', '| --- | --- | --- |', ...rows].join('\n')
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
