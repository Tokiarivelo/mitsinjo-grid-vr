// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getPerceptionClient } from '../client';
import { iou, samBoxToNorm } from '../outline';
import type { NormBox, SegmentResult } from '../schemas';
import { readCapture } from '../shape-capture';
import { cropForShape } from '../shape-crop';
import { prepareVisionImage } from '../prepare-image';
import { photoSize } from '../vision-request';

/** Closest SAM instance to `box` (IoU) and how many instances have a readable mask. */
function closest(seg: SegmentResult, box: NormBox): { best: number; outlined: number } {
  let best = 0;
  let outlined = 0;
  for (const inst of seg.instances) {
    if (inst.outline) outlined += 1;
    const b = samBoxToNorm(inst.box, seg.imageWidth, seg.imageHeight);
    if (b) best = Math.max(best, iou(box, b));
  }
  return { best, outlined };
}

/**
 * `make sam-probe ID=<capture> CONCEPTS="hut,thatched hut"` (SAM_PROBE=1, one SAM call per concept and
 * view): segments the capture's photo (`real/photos/<ID>.jpg`, or PHOTO=) and its shape crop with each
 * concept and prints, per concept, the instances found and the best box IoU with the capture's target
 * (≥ 0.3 = the outline step would adopt it). Diagnoses « no outline » captures (PQ-T1).
 */
describe.runIf(process.env.SAM_PROBE)('make sam-probe', () => {
  it('prints SAM instances per concept for one capture', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const id = process.env.SAM_PROBE_ID;
    const concepts = (process.env.SAM_PROBE_CONCEPTS ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!id || !concepts.length)
      throw new Error('Usage: make sam-probe ID=<capture id> CONCEPTS="a,b" [PHOTO=…]');
    const photoPath = process.env.SAM_PROBE_PHOTO || join(dir, 'photos', `${id}.jpg`);
    if (!existsSync(photoPath)) throw new Error(`no photo at ${photoPath} (pass PHOTO=…)`);
    const client = getPerceptionClient('sam-probe');
    if (!client.callsMeta) throw new Error('Refusing to probe with mock: set LLM_PROVIDER=meta');
    const { capture } = await readCapture(dir, id);
    const prepared = await prepareVisionImage(readFileSync(photoPath), 'image/jpeg');
    const size = await photoSize(prepared.buffer);
    if (!size) throw new Error(`photo not readable: ${photoPath}`);
    const url = `data:${prepared.contentType};base64,${prepared.buffer.toString('base64')}`;
    const crop = await cropForShape(size, capture.target.box);
    const lines: string[] = [];
    for (const concept of concepts) {
      for (const [view, image, box] of [
        ['photo', url, capture.target.box],
        ['crop', crop, capture.cropTarget.box],
      ] as const) {
        const seg = await client.segmentImage(image, concept).catch(() => null);
        if (!seg || seg.source !== 'meta' || seg.fallback) {
          lines.push(`| ${concept} | ${view} | call failed | — | — |`);
          continue;
        }
        const { best, outlined } = closest(seg, box);
        lines.push(
          `| ${concept} | ${view} | ${seg.instances.length} | ${outlined} | ${best.toFixed(2)}${best >= 0.3 ? ' ✓' : ''} |`
        );
      }
    }
    console.info(
      `\n## SAM probe: ${id} (« ${capture.target.label} », photo ${size.width}×${size.height})\n\n| Concept | View | Instances | With mask | Best IoU |\n| --- | --- | --- | --- | --- |\n${lines.join('\n')}`
    );
  }, 300_000);
});
