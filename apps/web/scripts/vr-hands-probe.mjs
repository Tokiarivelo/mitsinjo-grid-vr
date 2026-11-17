// Hands-first probe (Meta VR Start: « can someone finish the whole experience without ever pairing a
// controller? »). Drives the dev IWER emulator in HAND mode — a controller only to check the pad hides — on
// /simulation: the nav pad shows, a pinch on each pad button turns / steps / toggles the help, a
// building label opens its power panel, « Cut » goes through the engine, « Close ✕ » closes it.
// Usage: node scripts/vr-hands-probe.mjs <baseUrl> <outDir>   (dev server must run, mock LLM)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePort } from './port.mjs';

const [baseUrl = `http://localhost:${resolvePort()}`, outArg = 'test-results/vr-hands-probe'] =
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
const xz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** The households label (immersion-labels.tsx anchor), as vr-sim-probe.mjs. */
const HOUSEHOLDS_LABEL = [-9, 4.2, 11];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const rc = async (method, params = {}) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await page.evaluate(
          ([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p),
          [method, params]
        );
      } catch (e) {
        if (attempt >= 8 || !/timed out/.test(String(e))) throw e;
        await sleep(5000);
      }
    }
  };
  const sim = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        const s = window.__VR_SIM__;
        return s ? new Function('s', 'a', `return (${src})(s, a)`)(s, a) : null;
      },
      [fn.toString(), arg]
    );
  const shot = (name) =>
    page
      .screenshot({ path: join(outDir, `${name}.png`), timeout: 90000 })
      .catch(() => console.log(`  (screenshot ${name} skipped: frame too slow)`));
  const waitFor = async (fn, ms = 15000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if (await fn()) return true;
      await sleep(300);
    }
    return false;
  };
  const frames = async (n) => {
    const f0 = await sim((s) => s.frames());
    await waitFor(async () => (await sim((s) => s.frames())) >= f0 + n, 180000);
  };
  const state = () => sim((s) => s.state());
  /** Right hand beside the head, aimed at a world point, then a pinch (the hand's select). */
  const pinchAt = async (world) => {
    const h = await sim((s) => s.toOrigin(s.head()));
    const target = await sim((s, p) => s.toOrigin(p), world);
    await rc('set_transform', {
      device: 'hand-right',
      position: { x: h[0] + 0.12, y: h[1] - 0.25, z: h[2] - 0.05 },
    });
    await rc('look_at', {
      device: 'hand-right',
      target: { x: target[0], y: target[1], z: target[2] },
    });
    await sleep(300);
    await rc('select', { device: 'hand-right' });
    await sleep(900);
    await frames(3);
  };
  const pinchNamed = async (name) => {
    const p = await sim((s, n) => s.worldPos(n), name);
    if (!p) return false;
    await pinchAt(p);
    return true;
  };

  await page.goto(`${baseUrl}/simulation`, { waitUntil: 'networkidle', timeout: 180000 });
  const enter = page.getByRole('button', { name: /View in VR/i }).first();
  await enter.waitFor({ timeout: 180000 });
  await enter.evaluate((el) => setTimeout(() => el.click(), 0));
  let active = false;
  for (let i = 0; i < 40 && !active; i++) {
    await sleep(1000);
    active = !!(await rc('get_session_status').catch(() => null))?.sessionActive;
  }
  check('the immersive session starts on /simulation', active);
  // Hands only from here on: no controller is ever touched.
  await rc('set_input_mode', { mode: 'hand' });
  await frames(10);
  check(
    'the hands-first nav pad shows (5 buttons)',
    (await sim((s) => s.shown('sim-xr-nav-pad'))) === 1 &&
      (await sim((s) =>
        ['turn-left', 'step-back', 'step-forward', 'turn-right', 'help'].every(
          (id) => s.shown(`sim-xr-button-xr-nav-${id}`) === 1
        )
      ))
  );
  await shot('hands-0-pad');

  // Snap turn right then left, by pinch.
  const yaw0 = await sim((s) => s.yaw());
  await pinchNamed('sim-xr-button-xr-nav-turn-right');
  const yaw1 = await sim((s) => s.yaw());
  check(
    'pinch « turn right » snap-turns 30°',
    Math.abs(Math.abs(deg(wrap(yaw1 - yaw0))) - 30) <= 2,
    `${deg(wrap(yaw1 - yaw0))}°`
  );
  await pinchNamed('sim-xr-button-xr-nav-turn-left');
  const yaw2 = await sim((s) => s.yaw());
  check(
    'pinch « turn left » turns back',
    Math.abs(deg(wrap(yaw2 - yaw0))) <= 2,
    `${deg(wrap(yaw2 - yaw0))}°`
  );

  // One step forward, then back.
  const p0 = await sim((s) => s.head());
  await pinchNamed('sim-xr-button-xr-nav-step-forward');
  await frames(20);
  const p1 = await sim((s) => s.head());
  check(
    'pinch « one step forward » moves the walker',
    xz(p0, p1) > 0.2,
    `${xz(p0, p1).toFixed(2)} m`
  );
  await pinchNamed('sim-xr-button-xr-nav-step-back');
  await frames(20);
  const p2 = await sim((s) => s.head());
  check(
    'pinch « one step back » comes back',
    xz(p0, p2) < xz(p0, p1),
    `${xz(p0, p2).toFixed(2)} m`
  );

  // Help on and off.
  const help0 = (await state()).help;
  await pinchNamed('sim-xr-button-xr-nav-help');
  check('pinch « help » toggles the controls help', (await state()).help === !help0);
  await pinchNamed('sim-xr-button-xr-nav-help');
  await shot('hands-1-after-nav');

  // A building, its power panel, an engine action, close — all by pinch.
  await pinchAt(HOUSEHOLDS_LABEL);
  check('a pinch on the households label opens its panel', (await state()).panel === 'households');
  check(
    'the nav pad hides while a panel is open',
    (await sim((s) => s.shown('sim-xr-nav-pad'))) === 0
  );
  await shot('hands-2-panel');
  await pinchNamed('sim-xr-button-cut');
  check(
    'pinch « Cut » sets a 0 kW households limit through the engine',
    (await sim((s) => s.caps())).some((c) => c.sector === 'households' && c.maxKw === 0)
  );
  await pinchNamed('sim-xr-button-restore');
  check(
    'pinch « Restore » removes it',
    !(await sim((s) => s.caps())).some((c) => c.sector === 'households')
  );
  await pinchNamed('sim-xr-button-close');
  check('pinch « Close ✕ » closes the panel', (await state()).panel === null);
  check('the nav pad is back', (await sim((s) => s.shown('sim-xr-nav-pad'))) === 1);
  // A controller picked up: the sticks already turn and step, the pad goes away.
  await rc('set_input_mode', { mode: 'controller' });
  await frames(10);
  check('the nav pad hides with controllers', (await sim((s) => s.shown('sim-xr-nav-pad'))) === 0);
  await rc('set_input_mode', { mode: 'hand' });
  await frames(10);
  check('…and comes back with hands', (await sim((s) => s.shown('sim-xr-nav-pad'))) === 1);

  // --- /village 360° tour, hands only (studio pad, same queue) -----------------------------
  await rc('end_session').catch(() => {});
  await sleep(1500);
  await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 180000 });
  const enterV = page.getByRole('button', { name: /View in VR immersion/i }).first();
  await enterV.waitFor({ timeout: 180000 });
  await enterV.evaluate((el) => setTimeout(() => el.click(), 0));
  let activeV = false;
  for (let i = 0; i < 40 && !activeV; i++) {
    await sleep(1000);
    activeV = !!(await rc('get_session_status').catch(() => null))?.sessionActive;
  }
  check('the immersive session starts on /village', activeV);
  await rc('set_input_mode', { mode: 'hand' });
  await sleep(3000);
  const ctl = (fn) =>
    page.evaluate((src) => {
      const c = window.__VR_CONTROLS__;
      return c ? new Function('c', `return (${src})(c)`)(c) : null;
    }, fn.toString());
  const panelAt = (id) =>
    page.evaluate((pid) => {
      const o = window.__VR_PANELS__?.objects.find((x) => x.userData.holoPanel?.id === pid);
      if (!o) return null;
      const p = o.getWorldPosition(new o.position.constructor());
      return { x: p.x, y: p.y, z: p.z };
    }, `holo:${id}`);
  const pinchPad = async (id) => {
    // The pad lazy-follows the walker: after a step it glides back under the view (slow frames in
    // software GL), so aim once it has settled.
    let at = await panelAt(id);
    for (let i = 0; i < 30 && at; i++) {
      await sleep(1000);
      const next = await panelAt(id);
      if (!next) break;
      const still = Math.hypot(next.x - at.x, next.y - at.y, next.z - at.z) < 0.005;
      at = next;
      if (still) break;
    }
    if (!at) return false;
    await rc('set_transform', { device: 'hand-right', position: { x: 0.15, y: 1.25, z: -0.1 } });
    await rc('look_at', { device: 'hand-right', target: at });
    await sleep(500);
    await rc('select', { device: 'hand-right' });
    await sleep(1500);
    return true;
  };
  const offset = () => page.evaluate(() => [...(window.__VR_TOUR__?.ground.offset ?? [])]);
  check('the studio nav pad shows in the tour', (await ctl((c) => c.shown('xr-nav-pad'))) === 1);
  await shot('hands-3-village-pad');
  const o0 = await offset();
  check('pinch « one step forward » walks the tour', await pinchPad('xr-nav-step-forward'));
  const o1 = await offset();
  const moved = Math.hypot(o1[0] - o0[0], o1[2] - o0[2]);
  check('…by about one 0.8 m step', moved > 0.3, `${moved.toFixed(2)} m`);
  const helpV = await ctl((c) => c.help);
  await pinchPad('xr-nav-help');
  check('pinch « help » toggles the studio help', (await ctl((c) => c.help)) === !helpV);
  const yawV0 = await ctl((c) => c.yaw());
  await pinchPad('xr-nav-turn-right');
  const yawV1 = await ctl((c) => c.yaw());
  check(
    'pinch « turn right » snap-turns the studio 30°',
    Math.abs(Math.abs(deg(wrap(yawV1 - yawV0))) - 30) <= 3,
    `${deg(wrap(yawV1 - yawV0))}°`
  );
  await shot('hands-4-village-after');

  if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join('\n')}`);
  check('no page error', errors.length === 0);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
