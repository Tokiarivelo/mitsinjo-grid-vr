// Object 3D viewer shots (/shape-loop, design gate of the « 3D model » block): for each fitted recipe of
// `make shape-report` (recipes.json), opens /village, stubs the vision API (no Meta call, any server
// mode), generates the 3D model and screenshots the viewer in dark and light.
// Usage: node scripts/object-viewer-shot.mjs <baseUrl> <reportDir> [outDir]   (dev server must run)
// Env: SHOT_GL=gpu → real GPU (default SwiftShader software GL). SHOT_SUFFIX=before → name-before-dark.png.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePort } from './port.mjs';
import { LOOKDEV_LIGHTS, shotFile, THEMES } from './lookdev-plan.mjs';

const [
  baseUrl = `http://localhost:${resolvePort()}`,
  reportDir,
  outDir = join(reportDir, 'viewer'),
] = process.argv.slice(2);
if (!reportDir) throw new Error('Usage: object-viewer-shot.mjs <baseUrl> <reportDir> [outDir]');
const recipes = JSON.parse(readFileSync(join(reportDir, 'recipes.json'), 'utf8'));
// LOOKDEV=1 (PQ-T40): each object under the studio, a low side light and a back light, dark and light.
const lights = process.env.LOOKDEV ? LOOKDEV_LIGHTS : [null];
const suffix = process.env.SHOT_SUFFIX ?? '';
const GL_ARGS =
  process.env.SHOT_GL === 'gpu'
    ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** 1 × 1 white PNG: the stubbed 2D facade. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const sse = (events) =>
  events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const detection = (name) => ({
  id: 'det-1',
  label: name.slice(0, 40),
  category: 'other',
  confidence: 0.9,
  box: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
});

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: GL_ARGS });
for (const theme of THEMES) {
  // SHOT_WIDTH=320: phone-width shots (height follows a 16:10 → 9:19.5 phone ratio).
  const width = Number(process.env.SHOT_WIDTH) || 1440;
  const height = width < 768 ? Math.round(width * 2.1) : 900;
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((t) => localStorage.setItem('mitsinjo_theme', t), theme);
  const page = await context.newPage();
  // SHOT_LOG=1: print browser warnings and errors (shader compile errors, WebGL warnings).
  if (process.env.SHOT_LOG)
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
    });
  for (const { name, recipe } of recipes) {
    for (const light of lights) {
      await page.route('**/api/vision', (route) =>
        route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            [
              'vision_detections',
              { phase: 'outlines', detections: [detection(name)], source: 'mock', model: 'stub' },
            ],
            ['done', {}],
          ]),
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
              },
            ],
            ['done', {}],
          ]),
        })
      );
      await page.goto(`${baseUrl}/village${light ? `?lookdev=${light}` : ''}`, {
        waitUntil: 'networkidle',
      });
      await page.getByRole('button', { name: /use the sample room/i }).click();
      await page
        .getByRole('button', { name: new RegExp(name, 'i') })
        .first()
        .click();
      // /village asks for the 2D facade first (Muse Image): stubbed with a blank elevation.
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
      const direct = page.getByRole('button', { name: /generate the 3d model/i });
      const imagine = page.getByRole('button', { name: /imagine 2d facade/i });
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
      await viewer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500); // frameloop="demand": let the env map and shadow settle
      const file = join(outDir, shotFile(name, { light, suffix, theme }));
      await viewer.screenshot({ path: file });
      console.log(`✓ ${file}`);
      await page.unrouteAll();
    }
  }
  await context.close();
}
await browser.close();
