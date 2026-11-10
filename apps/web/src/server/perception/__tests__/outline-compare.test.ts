// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getPerceptionClient } from '../client';
import { conceptOf, fetchOutlineForBox, samRetries } from '../outline';
import { prepareVisionImage } from '../prepare-image';
import { readCapture } from '../shape-capture';
import { cropForShape, cropRectForShape } from '../shape-crop';
import { photoSize } from '../vision-request';

/**
 * `make outline-compare` (OUTLINE_COMPARE=1, ≈ 4 SAM calls per photo): for every real capture that has its
 * photo, asks for the outline the way the pipeline did before PQ-T9 (noun, then the retries one by one) and
 * with SAM agreement (`consensus`), and prints how many photos end with an outline in each way.
 */
describe.runIf(process.env.OUTLINE_COMPARE)('make outline-compare', () => {
  it('counts photos with an outline, plain walk vs consensus', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const client = getPerceptionClient('outline-compare');
    if (!client.callsMeta) throw new Error('Refusing to run with mock: set LLM_PROVIDER=meta');
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith('.capture.json'))
      .map((f) => f.slice(0, -'.capture.json'.length))
      .sort();
    const rows: string[] = [];
    let plainHits = 0;
    let consensusHits = 0;
    let total = 0;
    for (const id of ids) {
      const photoPath = join(dir, 'photos', `${id}.jpg`);
      if (!existsSync(photoPath)) continue;
      const { capture } = await readCapture(dir, id);
      const prepared = await prepareVisionImage(readFileSync(photoPath), 'image/jpeg');
      const size = await photoSize(prepared.buffer);
      if (!size) continue;
      const url = `data:${prepared.contentType};base64,${prepared.buffer.toString('base64')}`;
      const box = capture.target.box;
      const crop = {
        url: await cropForShape(size, box),
        rect: cropRectForShape(size.width, size.height, box),
        photoW: size.width,
        photoH: size.height,
      };
      const seg = client.segmentImage.bind(client);
      const concept = conceptOf(capture.target);
      const retries = samRetries(capture.target);
      const plain = await fetchOutlineForBox(seg, url, concept, box, { crop, retries });
      const agreed = await fetchOutlineForBox(seg, url, concept, box, {
        crop,
        retries,
        consensus: true,
      });
      total += 1;
      if (plain) plainHits += 1;
      if (agreed) consensusHits += 1;
      rows.push(`| ${id} | ${concept} | ${plain ? '✓' : '✗'} | ${agreed ? '✓' : '✗'} |`);
    }
    console.info(
      `\n## Outline: plain walk vs SAM agreement (${total} photos)\n\n| id | concept | plain | consensus |\n| -- | ------- | ----- | --------- |\n${rows.join('\n')}\n\nwith an outline: plain ${plainHits}/${total}, consensus ${consensusHits}/${total}`
    );
  }, 600_000);
});
