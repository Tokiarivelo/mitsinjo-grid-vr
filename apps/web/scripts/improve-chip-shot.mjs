// Improvement chip shots (PG-T18 design gate): opens /village, stubs the vision API with the thatched
// house of `make shape-report` and a background stage job (stage 1 done, stage 2 running, held open),
// screenshots the 3D viewer with the chip, then releases the job (« Model finalised ») and shoots again.
// Desktop 1440×900 + mobile 390×844, dark + light. No Meta call.
// Usage: node scripts/improve-chip-shot.mjs <baseUrl> <reportDir> [outDir]   (dev server must run)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePort } from './port.mjs';

const [
  baseUrl = `http://localhost:${resolvePort()}`,
  reportDir,
  outDir = join(reportDir, 'improve-chip'),
] = process.argv.slice(2);
if (!reportDir) throw new Error('Usage: improve-chip-shot.mjs <baseUrl> <reportDir> [outDir]');
const recipes = JSON.parse(readFileSync(join(reportDir, 'recipes.json'), 'utf8'));
const { name, recipe } = recipes.find((r) => /thatch/i.test(r.name)) ?? recipes[0];

const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const JOB = 'shot-job';
const sse = (events) =>
  events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const stage = (index, id, state, extra = {}) => ({
  jobId: JOB,
  phase: 'background',
  index,
  total: 4,
  stage: id,
  state,
  ...extra,
});

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const theme of ['dark', 'light']) {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((t) => localStorage.setItem('mitsinjo_theme', t), theme);
    const page = await context.newPage();
    let release;
    const held = new Promise((r) => (release = r));
    await page.route('**/api/vision', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: sse([
          [
            'vision_detections',
            {
              phase: 'outlines',
              detections: [
                {
                  id: 'det-1',
                  label: name,
                  category: 'other',
                  confidence: 0.9,
                  box: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
                },
              ],
              source: 'mock',
              model: 'stub',
            },
          ],
          ['done', {}],
        ]),
      })
    );
    await page.route('**/api/vision/facade', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          detectionId: 'det-1',
          imageUrl: BLANK_PNG,
          fileKey: 'stub.png',
          prompt: 'stub',
          archetype: 'house',
          source: 'mock',
        }),
      })
    );
    await page.route('**/api/vision/shape', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: sse([
          [
            'shape_result',
            {
              shape: {
                detectionId: 'det-1',
                mode: 'recipe',
                recipe,
                source: 'mock',
                model: 'stub',
              },
              jobId: JOB,
            },
          ],
          [
            'shape_stage',
            { ...stage(1, 'massing', 'done', { before: 0.88, after: 0.93 }), seq: 0 },
          ],
          ['shape_stage', { ...stage(2, 'roof', 'running'), seq: 1 }],
        ]),
      })
    );
    // The resume call stays open until the « running » shots are taken, then the job ends.
    await page.route('**/api/vision/shape/stages**', async (route) => {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      await held;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: sse([
          [
            'shape_stage',
            { ...stage(4, 'accessories', 'done', { before: 0.71, after: 0.8 }), seq: 2 },
          ],
          ['shape_stages_done', { jobId: JOB, status: 'done', seq: 3 }],
        ]),
      });
    });
    await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /use the sample room/i }).click();
    await page
      .getByRole('button', { name: new RegExp(name, 'i') })
      .first()
      .click();
    const direct = page.getByRole('button', { name: /generate the 3d model/i });
    const imagine = page.getByRole('button', { name: /imagine 2d (facade|profile)/i });
    await direct.or(imagine).first().waitFor();
    if (await imagine.isVisible()) {
      await imagine.click();
      await page
        .getByRole('button', { name: /validate & generate 3d/i })
        .first()
        .click();
    } else {
      await direct.click();
    }
    const viewer = page.locator('.viewer-studio').first();
    await viewer.locator('canvas').waitFor({ timeout: 30_000 });
    const chip = page.getByRole('progressbar').first();
    await chip.waitFor({ timeout: 15_000 });
    await viewer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500); // frameloop="demand": let the env map settle
    const box = viewer.locator('..');
    const shot = async (state) => {
      const file = join(outDir, `${state}-${device}-${theme}.png`);
      await box.screenshot({ path: file });
      console.log(`✓ ${file}`);
    };
    await shot('running');
    release();
    await page
      .getByText(/model finalised/i)
      .first()
      .waitFor({ timeout: 15_000 });
    await shot('done');
    await context.close();
  }
}
await browser.close();
