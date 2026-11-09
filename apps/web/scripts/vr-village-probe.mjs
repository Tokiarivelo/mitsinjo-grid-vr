// /village VR probe: drives the dev IWER emulator (Quest 3) like the IWER MCP does, through
// `window.__IWER_DEVICE__.remote.dispatch`, with the sample room fed as a fake webcam.
// Checks: session starts; a controller shot at the fridge in the video (no scan yet) starts ONE
// scan and turns it into 3D; a 2nd shot connects it; a hand pinch at the fan and the left
// controller at the TV turn those into 3D. Screenshots in <outDir>/vr-*.png.
// Usage: node scripts/vr-village-probe.mjs <baseUrl> <outDir>   (dev server must run; needs ffmpeg)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePort } from './port.mjs';

const [baseUrl = `http://localhost:${resolvePort()}`, outArg = 'test-results/vr-probe'] =
  process.argv.slice(2);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

// Fake webcam: the sample room as a 1280×720 y4m clip (Chromium loops it).
const video = join(outDir, 'room.y4m');
if (!existsSync(video)) {
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    resolve('public/samples/vision-room.jpg'),
    '-t',
    '3',
    '-r',
    '10',
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-pix_fmt',
    'yuv420p',
    video,
  ]);
}

// Mirror of src/features/vision-insert/ui/xr/webcam-screen.ts (WEBCAM_SCREEN).
const G = { radius: 8.5, height: 4.2, distance: 2.6, centerY: 2.1, aspect: 16 / 9 };
function screenPoint(u, v) {
  const L = (G.height * G.aspect) / G.radius;
  const th = Math.PI - L / 2 + u * L;
  const cz = G.radius - G.distance;
  return {
    x: -G.radius * Math.sin(th),
    y: G.centerY + G.height / 2 - v * G.height,
    z: cz + G.radius * Math.cos(th),
  };
}
// Object centres in the sample room (mock detector boxes).
const FRIDGE = screenPoint(0.2137, 0.5506);
const FAN = screenPoint(0.787, 0.631);
const TV = screenPoint(0.543, 0.419);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  await ctx.grantPermissions(['camera'], { origin: baseUrl });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let scans = 0;
  let scansDone = 0;
  page.on('request', (r) => /\/api\/vision$/.test(r.url()) && scans++);
  page.on('requestfinished', (r) => /\/api\/vision$/.test(r.url()) && scansDone++);

  const rc = (method, params = {}) =>
    page.evaluate(([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p), [method, params]);
  const shot = (name) => page.screenshot({ path: join(outDir, `vr-${name}.png`) });
  const fire = async (device, at, from) => {
    if (from) await rc('set_transform', { device, position: from });
    await rc('look_at', { device, target: at });
    await sleep(600);
    await rc('select', { device });
    await sleep(2500);
  };

  await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 120000 });
  const enter = page.getByRole('button', { name: /View in VR immersion/i }).first();
  await enter.waitFor({ timeout: 120000 });
  // Clicking through Playwright waits on the page; the XR session takes the main loop.
  await enter.evaluate((el) => setTimeout(() => el.click(), 0));
  let active = false;
  for (let i = 0; i < 30 && !active; i++) {
    await sleep(1000);
    active = !!(await rc('get_session_status').catch(() => null))?.sessionActive;
  }
  check('immersive-vr session starts in the IWER emulator', active);
  await sleep(2000);
  await shot('1-entered');

  await rc('set_input_mode', { mode: 'controller' });
  await fire('controller-right', FRIDGE, { x: 0.2, y: 1.3, z: -0.3 });
  check('a shot at the video before any scan starts a scan', scans === 1);
  const t0 = Date.now();
  while (scansDone === 0 && Date.now() - t0 < 120000) await sleep(1000);
  await sleep(3000);
  await shot('2-fridge-3d');
  await rc('select', { device: 'controller-right' });
  await sleep(2500);
  await shot('3-fridge-connected');
  check('one scan only (no double fire)', scans === 1);

  await rc('set_input_mode', { mode: 'hand' });
  await fire('hand-right', FAN, { x: 0.2, y: 1.3, z: -0.35 });
  await shot('4-hand-fan-3d');

  await rc('set_input_mode', { mode: 'controller' });
  await fire('controller-left', TV, { x: -0.2, y: 1.3, z: -0.3 });
  await shot('5-tv-3d');
  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
}
console.log(`Screenshots: ${outDir}/vr-*.png (check the 3D models over the fridge, fan and TV)`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
