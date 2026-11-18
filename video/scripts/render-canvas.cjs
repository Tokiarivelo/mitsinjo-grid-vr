// Render a canvas page frame by frame (VIDEO_PLAN.md § 7): node render-canvas.cjs <page.html[?query]> <out-dir> [--alpha]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../apps/web/package.json'));
const { chromium } = req('@playwright/test');

(async () => {
  const [pageArg, out] = process.argv.slice(2);
  const alpha = process.argv.includes('--alpha');
  const [file, query] = pageArg.split('?');
  const url = pathToFileURL(path.resolve(file)).href + (query ? '?' + query : '');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files',
    ],
  });
  // CANVAS_W renders at that width, scale 1 (WebGL pages); default 1280 × 720 at 1.5.
  const cw = Number(process.env.CANVAS_W || 0);
  const p = await b.newPage(
    cw
      ? { viewport: { width: cw, height: Math.round((cw * 9) / 16) }, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 }
  );
  await p.goto(url);
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  const dur = await p.evaluate(() => window.__duration);
  const n = Math.round((dur / 1000) * 30);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.__seek(t), (i * 1000) / 30);
    await p.screenshot({
      path: path.join(out, `${String(i).padStart(5, '0')}.png`),
      omitBackground: alpha,
    });
  }
  await b.close();
  console.log(`${out}: ${n} frames`);
})();
