// /village VR probe: drives the dev IWER emulator (Quest 3) like the IWER MCP does, through
// `window.__IWER_DEVICE__.remote.dispatch`, with the sample room fed as a fake webcam.
// The emulator shows the walkable 360° tour (VS-T14), not the webcam. Checks: session starts;
// wrist menu; loft with 2 floor arrows; a controller shot at the fridge (no scan yet) starts ONE
// scan and a miniature; a tap on it connects it; a hand pinch at the lamp; shooting a floor
// arrow walks to the hall; ↑ walks on. Screenshots show the photo orientation ("MARRY" letters).
// Screenshots in <outDir>/vr-*.png.
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

// Mirror of src/features/vision-insert/ui/xr/tour (TOUR_EYE, tour-data boxes): a point
// `dist` m from the eye in the direction of panorama image point (u, v), given `uFront`.
const EYE = { x: 0, y: 1.6, z: 0 };
function panoPoint(u, v, uFront, dist = 6) {
  const yaw = (u - uFront) * Math.PI * 2;
  const pitch = (0.5 - v) * Math.PI;
  const c = Math.cos(pitch);
  return {
    x: EYE.x + Math.sin(yaw) * c * dist,
    y: EYE.y + Math.sin(pitch) * dist,
    z: EYE.z - Math.cos(yaw) * c * dist,
  };
}
// First miniature pedestal: mirror of miniatureSlot(0) in xr-layout.ts.
const MINI_0 = {
  x: Math.sin((18 * Math.PI) / 180) * 0.55,
  y: 1.28,
  z: -Math.cos((18 * Math.PI) / 180) * 0.55,
};
// Loft objects (centres of the hand-drawn boxes in tour-data.ts).
const FRIDGE_UV = [0.8435, 0.552];
const LAMP_UV = [0.9285, 0.465];

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

  // Wrist menu: hidden on entry, opened by aiming at the button on the left wrist.
  await rc('set_input_mode', { mode: 'controller' });
  await rc('set_transform', { device: 'controller-left', position: { x: -0.2, y: 1.1, z: -0.35 } });
  await sleep(800);
  const menu = () =>
    page.evaluate(() => {
      const m = window.__VR_WRIST_MENU__;
      return (
        m && {
          open: m.open,
          wearer: m.wearer,
          button: { x: m.button.x, y: m.button.y, z: m.button.z },
        }
      );
    });
  const m0 = await menu();
  check(
    'wrist menu closed on entry, button worn on the left controller',
    !!m0 && !m0.open && m0.wearer !== null
  );
  await shot('0-menu-closed');
  if (m0) await fire('controller-right', m0.button, { x: 0.2, y: 1.3, z: -0.1 });
  check('aiming at the wrist button opens the menu', !!(await menu())?.open);
  check('opening the menu does not scan', scans === 0);
  await shot('0b-menu-open');
  await rc('look_at', { device: 'headset', target: { x: 0, y: 1.2, z: -0.9 } });
  await sleep(1500);
  await shot('0c-menu-look-down');
  const m1 = await menu();
  if (m1) await fire('controller-right', m1.button, { x: 0.2, y: 1.3, z: -0.1 });
  check('a second press closes it', (await menu())?.open === false);

  const tour = () => page.evaluate(() => window.__VR_TOUR__ ?? null);
  const t0tour = await tour();
  check(
    'tour starts in the loft with 2 floor arrows',
    t0tour?.room === 'loft' && t0tour.arrows.length === 2
  );
  const uF = t0tour?.uFront ?? 0.8;
  const fridge = panoPoint(...FRIDGE_UV, uF);
  await rc('look_at', { device: 'headset', target: fridge });
  await sleep(800);
  await shot('2-loft-fridge-ahead');
  await fire('controller-right', fridge, { x: 0.15, y: 1.45, z: -0.15 });
  check('a shot at the 360° photo before any scan starts a scan', scans === 1);
  const t0 = Date.now();
  while (scansDone === 0 && Date.now() - t0 < 120000) await sleep(1000);
  await sleep(3000);
  await shot('3-fridge-3d');
  await fire('controller-right', MINI_0, { x: 0.25, y: 1.3, z: 0 });
  await shot('4-fridge-connected');
  check('one scan only (no double fire)', scans === 1);

  await rc('set_input_mode', { mode: 'hand' });
  await fire('hand-right', panoPoint(...LAMP_UV, uF, 3), { x: 0.2, y: 1.35, z: -0.1 });
  await shot('5-hand-lamp');
  await rc('set_input_mode', { mode: 'controller' });

  // Walking takes time (to the arrow, then through it): poll the room.
  const waitRoom = async (to, ms = 6000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if ((await tour())?.room === to) return true;
      await sleep(150);
    }
    return false;
  };

  const hall = (await tour())?.arrows.find((a) => a.to === 'hall');
  if (hall) {
    const at = { x: hall.position[0], y: hall.position[1], z: hall.position[2] };
    await rc('look_at', { device: 'headset', target: at });
    await sleep(600);
    await shot('6-arrow-hall');
    await fire('controller-right', at, { x: 0.2, y: 1.2, z: -0.1 });
  }
  check('shooting the floor arrow walks to the hall', await waitRoom('hall'));
  await sleep(500);
  const inHall = await tour();
  await rc('look_at', { device: 'headset', target: panoPoint(0.825, 0.56, inHall?.uFront ?? 0) });
  await sleep(800);
  await shot('7-hall-marry-letters');

  const lounge = inHall?.arrows.find((a) => a.to === 'lounge');
  if (lounge) {
    await rc('look_at', {
      device: 'headset',
      target: { x: lounge.position[0], y: 1.2, z: lounge.position[2] },
    });
    await sleep(600);
    // Hold ↑: the viewer walks (the floor slides), reaches the arrow and goes through.
    const startArrow = Math.hypot(lounge.position[0], lounge.position[2]);
    await page.keyboard.down('ArrowUp');
    // Headless rendering is slow (few fps): poll until the arrow has come closer.
    let closer = false;
    for (let i = 0; i < 40 && !closer; i++) {
      await sleep(150);
      const now = await tour();
      const mid = now?.arrows.find((a) => a.to === 'lounge');
      if (now?.room !== 'hall' || !mid) break;
      closer = Math.hypot(mid.position[0], mid.position[2]) < startArrow - 0.3;
    }
    await shot('8a-walking');
    check('holding ↑ walks: the arrow ahead comes closer', closer);
    const reached = await waitRoom('lounge');
    await page.keyboard.up('ArrowUp');
    check('↑ walks through to the room ahead (lounge)', reached);
  }
  await sleep(600);
  await shot('8-lounge');
  // Outdoor walk (houses, trees, forest) through the hall window.
  const walkTo = async (to) => {
    const arrow = (await tour())?.arrows.find((a) => a.to === to);
    if (!arrow) return false;
    const at = { x: arrow.position[0], y: arrow.position[1], z: arrow.position[2] };
    await rc('look_at', { device: 'headset', target: { x: at.x, y: 1.2, z: at.z } });
    await sleep(400);
    await fire('controller-right', at, { x: 0.2, y: 1.2, z: -0.1 });
    const ok = await waitRoom(to);
    await sleep(400);
    return ok;
  };
  let outdoor = await walkTo('hall');
  for (const to of ['terrace', 'street', 'house', 'garden', 'avenue', 'forest']) {
    outdoor = outdoor && (await walkTo(to));
    if (outdoor) {
      await rc('look_at', { device: 'headset', target: { x: 0, y: 1.6, z: -3 } });
      await sleep(900);
      await shot(`9-out-${to}`);
    }
  }
  check('walks outside: terrace → street → house → garden → avenue → forest', outdoor);
  check(
    'IWER DevUI panels (controllers, Play Mode) are mounted',
    await page.evaluate(() => !!window.__IWER_DEVICE__?.devui?.devUIContainer?.isConnected)
  );
  check(
    'an Exit VR button stays on screen during the emulated session',
    await page.evaluate(() => !!document.querySelector('[data-xr-exit]'))
  );
  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
}
console.log(
  `Screenshots: ${outDir}/vr-*.png (check the fridge miniature and that MARRY reads left to right)`
);
process.exit(results.every((r) => r.ok) ? 0 : 1);
