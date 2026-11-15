// /village VR controls + IWER tools probe (VS-T23). Drives the dev IWER emulator (Quest 3) through
// `window.__IWER_DEVICE__.remote.dispatch`: the same methods, 1:1, as the IWER MCP tools
// (`xr_*`, see docs/vr-iwer-tools.md). Checks every IWER method this app relies on, then each
// control of the app: legends, aim hint, A/X analyse, B/Y back/menu, right stick snap turn and
// step, grip, hand pinch, thumb microgestures, stick click help.
// Usage: node scripts/vr-iwer-tools.mjs <baseUrl> <outDir>   (dev server must run, mock LLM)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePort } from './port.mjs';

const [baseUrl = `http://localhost:${resolvePort()}`, outArg = 'test-results/vr-iwer-tools'] =
  process.argv.slice(2);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};
const deg = (r) => Math.round((r * 180) / Math.PI);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let scans = 0;
  page.on('request', (r) => /\/api\/vision$/.test(r.url()) && scans++);

  const rc = (method, params = {}) =>
    page.evaluate(([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p), [method, params]);
  const tryRc = async (method, params) => {
    try {
      return { ok: true, value: await rc(method, params) };
    } catch (e) {
      return { ok: false, value: String(e?.message ?? e) };
    }
  };
  const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
  const controls = () =>
    page.evaluate(() => {
      const c = window.__VR_CONTROLS__;
      return c
        ? {
            help: c.help,
            yaw: c.yaw(),
            legends: c.shown('xr-control-legend'),
            hints: c.shown('xr-aim-hint'),
            sources: c.sources(),
          }
        : null;
    });
  const menuOpen = () => page.evaluate(() => window.__VR_WRIST_MENU__?.open ?? null);
  const extract = () => page.evaluate(() => window.__VR_EXTRACT__ ?? null);
  const tour = () => page.evaluate(() => window.__VR_TOUR__ ?? null);
  const waitFor = async (fn, ms = 15000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if (await fn()) return true;
      await sleep(300);
    }
    return false;
  };
  /** Press then release one button of a controller (xr-standard index), like a real click. */
  const tapButton = async (device, index) => {
    await rc('set_gamepad_state', { device, buttons: [{ index, value: 1, touched: true }] });
    await sleep(500);
    await rc('set_gamepad_state', { device, buttons: [{ index, value: 0, touched: false }] });
    await sleep(500);
  };
  const flickStick = async (device, x, y) => {
    await rc('set_gamepad_state', {
      device,
      axes: [
        { index: 0, value: x },
        { index: 1, value: y },
      ],
    });
    await sleep(250);
    await rc('set_gamepad_state', {
      device,
      axes: [
        { index: 0, value: 0 },
        { index: 1, value: 0 },
      ],
    });
    await sleep(700);
  };

  await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 120000 });
  const enter = page.getByRole('button', { name: /View in VR immersion/i }).first();
  await enter.waitFor({ timeout: 120000 });
  await enter.evaluate((el) => setTimeout(() => el.click(), 0));

  // --- IWER tools (session, transforms, input, state) ----------------------------------------
  let active = false;
  for (let i = 0; i < 30 && !active; i++) {
    await sleep(1000);
    active = !!(await tryRc('get_session_status')).value?.sessionActive;
  }
  check('xr_get_session_status: the immersive session is active', active);
  await sleep(2500);
  const status = await tryRc('get_session_status');
  check(
    'xr_get_session_status reports mode and features',
    status.ok,
    JSON.stringify(status.value)?.slice(0, 160)
  );
  const t0 = await tryRc('get_transform', { device: 'headset' });
  check('xr_get_transform (headset)', t0.ok && !!t0.value?.position);
  check(
    'xr_set_transform (controller-right)',
    (
      await tryRc('set_transform', {
        device: 'controller-right',
        position: { x: 0.2, y: 1.3, z: -0.3 },
      })
    ).ok
  );
  check(
    'xr_look_at (headset)',
    (await tryRc('look_at', { device: 'headset', target: { x: 0, y: 1.5, z: -3 } })).ok
  );
  check(
    'xr_animate_to (controller-left, minimum-jerk)',
    (
      await tryRc('animate_to', {
        device: 'controller-left',
        position: { x: -0.25, y: 0.9, z: 0.05 },
        duration: 0.3,
        easing: 'minimum-jerk',
      })
    ).ok
  );
  await sleep(600);
  check(
    'xr_set_input_mode (controller)',
    (await tryRc('set_input_mode', { mode: 'controller' })).ok
  );
  check(
    'xr_get_gamepad_state',
    (await tryRc('get_gamepad_state', { device: 'controller-right' })).ok
  );
  check(
    'xr_get_select_value',
    (await tryRc('get_select_value', { device: 'controller-right' })).ok
  );
  const ds = await tryRc('get_device_state');
  check('xr_get_device_state', ds.ok && !!ds.value?.headset, `fov ${ds.value?.fov}`);
  await sleep(1500);

  // Which xr-standard button does an IWER gamepad index drive? (B = IWER 4 → xr-standard 5.)
  // Not A: A analyses, and a second analysis of the same view would be skipped.
  await rc('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 4, value: 1 }] });
  await sleep(400);
  const pressedB = (await controls())?.sources.find((s) => s.handedness === 'right');
  await rc('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 4, value: 0 }] });
  await sleep(400);
  const bIndex = pressedB?.buttons.findIndex(Boolean);
  check('IWER button 4 (B) is xr-standard button 5', bIndex === 5, `got ${bIndex}`);
  await tapButton('controller-right', 4); // that B opened the menu: close it

  // --- App controls (VS-T23) -----------------------------------------------------------------
  const c0 = await controls();
  check(
    'button legends show on the controllers on entry',
    !!c0 && c0.help && c0.legends >= 1,
    `legends ${c0?.legends}`
  );
  await shot('ctl-1-legends');

  // Aim hint: point the right controller at the floor arrow to the hall.
  const hall = (await tour())?.arrows.find((a) => a.to === 'hall');
  if (hall) {
    const at = { x: hall.position[0], y: hall.position[1], z: hall.position[2] };
    await rc('set_transform', {
      device: 'controller-right',
      position: { x: 0.2, y: 1.2, z: -0.1 },
    });
    await rc('look_at', { device: 'controller-right', target: at });
    await sleep(900);
  }
  const ch = await controls();
  check(
    'aiming at a floor arrow shows what the trigger will do',
    (ch?.hints ?? 0) >= 1,
    `hints ${ch?.hints}`
  );
  await shot('ctl-2-aim-hint');

  // Right stick → snap turn 30° right, then left.
  const y0 = (await controls())?.yaw ?? 0;
  await flickStick('controller-right', 0.95, 0);
  const y1 = (await controls())?.yaw ?? 0;
  check(
    'right stick → turns 30° to the right',
    Math.abs(deg(wrap(y1 - y0)) - 30) <= 3,
    `${deg(wrap(y1 - y0))}°`
  );
  await flickStick('controller-right', -0.95, 0);
  const y2 = (await controls())?.yaw ?? 0;
  check('right stick ← turns back', Math.abs(deg(wrap(y2 - y0))) <= 3, `${deg(wrap(y2 - y0))}°`);

  // Right stick ↑ → one step forward (the photo slides by ~0.8 m).
  const g0 = (await tour())?.ground?.offset ?? [0, 0, 0];
  await flickStick('controller-right', 0, -0.95);
  await sleep(800);
  const g1 = (await tour())?.ground?.offset ?? [0, 0, 0];
  const stepped = Math.hypot(g1[0] - g0[0], g1[2] - g0[2]);
  check(
    'right stick ↑ → one step forward (≈ 0.8 m)',
    stepped > 0.6 && stepped < 1.0,
    `${stepped.toFixed(2)} m`
  );
  await flickStick('controller-right', 0, 0.95);
  await sleep(800);

  // B (right) with nothing open → menu; B again → closed.
  await tapButton('controller-right', 4);
  check('B with nothing open opens the menu', (await menuOpen()) === true);
  await tapButton('controller-right', 4);
  check('B again closes it', (await menuOpen()) === false);

  // A → analyse the current view (a scan).
  const before = scans;
  await tapButton('controller-right', 3);
  check(
    'A analyses the current view',
    await waitFor(async () => scans > before, 8000),
    `scans ${scans - before}`
  );
  await waitFor(async () => ((await tour())?.targets.length ?? 0) > 0, 20000);
  await sleep(1500);
  await shot('ctl-3-after-analyse');

  // Trigger on an outlined object asks « Extract to 3D? »; B cancels it.
  const target = (await tour())?.targets[0];
  if (target) {
    const off = (await tour())?.ground?.offset ?? [0, 0, 0];
    const at = { x: target.at[0] - off[0], y: target.at[1] - off[1], z: target.at[2] - off[2] };
    await rc('set_transform', {
      device: 'controller-right',
      position: { x: 0.15, y: 1.4, z: -0.1 },
    });
    await rc('look_at', { device: 'controller-right', target: at });
    await sleep(700);
    await shot('ctl-4-aim-object');
    await rc('select', { device: 'controller-right' });
    await sleep(1200);
  }
  check('trigger on an object asks « Extract to 3D? »', (await extract())?.stage === 'confirm');
  await tapButton('controller-right', 4);
  check('B cancels the question', (await extract())?.stage === 'idle');

  // Stick click toggles the legends (they also hide alone 25 s after entry).
  const h0 = (await controls())?.help;
  await tapButton('controller-right', 2);
  check('a stick click toggles the legends', (await controls())?.help === !h0);
  await tapButton('controller-right', 2);
  check('a second stick click toggles them back', (await controls())?.help === h0);

  // --- Hands --------------------------------------------------------------------------------
  check('xr_set_input_mode (hand)', (await tryRc('set_input_mode', { mode: 'hand' })).ok);
  await sleep(800);
  check(
    'xr_set_hand_pose (point)',
    (await tryRc('set_hand_pose', { device: 'hand-right', poseId: 'point' })).ok
  );
  const hs = await tryRc('get_hand_state', { device: 'hand-right' });
  check('xr_get_hand_state', hs.ok, JSON.stringify(hs.value)?.slice(0, 120));
  // Thumb microgesture swipe-right → snap turn right (hand raised side-on, as IWER asks).
  await rc('set_transform', {
    device: 'hand-right',
    position: { x: 0.18, y: 1.35, z: -0.3 },
    anchor: 'wrist',
    orientation: { fingers: [0, -0.6, -0.8], palm: 'left' },
  });
  await sleep(500);
  const yh0 = (await controls())?.yaw ?? 0;
  const mg = await tryRc('microgesture', { device: 'hand-right', gesture: 'swipe-right' });
  await sleep(1200);
  const yh1 = (await controls())?.yaw ?? 0;
  check('xr_microgesture (swipe-right)', mg.ok, mg.ok ? '' : mg.value);
  check(
    'thumb swipe → turns 30°',
    Math.abs(deg(wrap(yh1 - yh0)) - 30) <= 3,
    `${deg(wrap(yh1 - yh0))}°`
  );
  await tryRc('microgesture', { device: 'hand-right', gesture: 'swipe-left' });
  await sleep(1000);
  check(
    'xr_set_select_value (pinch 0)',
    (await tryRc('set_select_value', { device: 'hand-right', value: 0 })).ok
  );
  const lt = await tryRc('list_targets');
  check(
    'xr_list_targets answers (no resolver on this page)',
    lt.ok,
    JSON.stringify(lt.value)?.slice(0, 80)
  );
  await shot('ctl-5-hands');
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
