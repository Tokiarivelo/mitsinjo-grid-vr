// /simulation VR probe (VSIM-T1–T4). Drives the dev IWER emulator through
// `window.__IWER_DEVICE__.remote.dispatch` (same methods as the IWER MCP `xr_*` tools) and reads
// the app through `window.__VR_SIM__` (dev only). Checks: same controls as /village (snap turn,
// A/X labels, B/Y back), walls stop the walker, a label opens the power panel, cut / restore go
// through the engine, the clinic is never cut, enter the room and go back out.
// Usage: node scripts/vr-sim-probe.mjs <baseUrl> <outDir>   (dev server must run, mock LLM)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePort } from './port.mjs';

const [baseUrl = `http://localhost:${resolvePort()}`, outArg = 'test-results/vr-sim-probe'] =
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

// Scene positions (utils/site-positions.ts, immersion-labels.tsx anchors).
const HOUSEHOLDS = [-9, 0, 11];
const HOUSEHOLDS_LABEL = [-9, 4.2, 11];
const HEALTH_LABEL = [12.5, 5.8, -0.5];
/** The dispatcher's label (anchor above BUS_POSITION). */
const CONTROLLER_LABEL = [0, 4.4, 1];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // IWER drops an action when no frame comes for 10 s (software GL stalls): retry it.
  const rc = async (method, params = {}) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await page.evaluate(
          ([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p),
          [method, params]
        );
      } catch (e) {
        if (attempt >= 8 || !/timed out/.test(String(e))) throw e;
        // The render loop is stalled (often right after a screenshot): give it time to resume.
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
  /** Software GL renders the whole village slowly in XR: a late shot is skipped, not a failure. */
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
  const tapButton = async (device, index) => {
    await rc('set_gamepad_state', { device, buttons: [{ index, value: 1, touched: true }] });
    await sleep(400);
    await rc('set_gamepad_state', { device, buttons: [{ index, value: 0, touched: false }] });
    await sleep(600);
  };
  const stick = (device, x, y) =>
    rc('set_gamepad_state', {
      device,
      axes: [
        { index: 0, value: x },
        { index: 1, value: y },
      ],
    });
  const head = () => sim((s) => s.head());
  /** Waits until `n` more frames are rendered (time-independent: software GL is slow). */
  const frames = async (n) => {
    const f0 = await sim((s) => s.frames());
    await waitFor(async () => (await sim((s) => s.frames())) >= f0 + n, 180000);
  };
  const state = () => sim((s) => s.state());
  /** Points the right controller (beside the head) at a world point and pulls the trigger. */
  const aimSelect = async (world) => {
    const h = await sim((s) => s.toOrigin(s.head()));
    const target = await sim((s, p) => s.toOrigin(p), world);
    await rc('set_transform', {
      device: 'controller-right',
      position: { x: h[0] + 0.12, y: h[1] - 0.25, z: h[2] - 0.05 },
    });
    await rc('look_at', {
      device: 'controller-right',
      target: { x: target[0], y: target[1], z: target[2] },
    });
    await sleep(300);
    await rc('select', { device: 'controller-right' });
    await sleep(900);
  };
  const pressPanel = async (id) => {
    const p = await sim((s, n) => s.worldPos(n), `sim-xr-button-${id}`);
    if (!p) return false;
    await aimSelect(p);
    return true;
  };
  const lookAt = async (world) => {
    const target = await sim((s, p) => s.toOrigin(p), world);
    await rc('look_at', { device: 'headset', target: { x: target[0], y: 1.6, z: target[2] } });
    await sleep(400);
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
  await rc('set_input_mode', { mode: 'controller' });
  check(
    'the walk grid is built from the scene',
    await waitFor(() => sim((s) => s.gridReady()), 30000)
  );
  await sleep(3500); // second build, after late meshes
  check(
    'the households building is solid in the walk grid',
    (await sim((s, p) => s.blocked(p[0], p[2]), HOUSEHOLDS)) === true
  );
  // Software GL can take longer than the 25 s on-entry help: show it with a stick click first.
  if (!(await state()).help) await tapButton('controller-right', 2);
  check(
    'button legends show on the controllers',
    (await state()).help && (await sim((s) => s.shown('xr-control-legend'))) >= 1
  );
  await shot('sim-1-entry');

  // --- Dispatcher mixing desk (VS-T34) --------------------------------------------------------
  await aimSelect(CONTROLLER_LABEL);
  check('the dispatcher label opens its mixing desk', (await state()).mixer === true);
  const faders = await sim((s) =>
    ['battery', 'households', 'health'].map((n) => s.shown(`sim-xr-fader-${n}`))
  );
  check(
    'the desk has the battery and sector faders',
    faders.every((n) => n === 1),
    `${faders}`
  );
  await shot('sim-0-mixer');
  await pressPanel('mixer-cut-households');
  check(
    'mixer « Cut » sets a 0 kW households limit through the engine',
    (await sim((s) => s.caps())).some((c) => c.sector === 'households' && c.maxKw === 0)
  );
  await pressPanel('mixer-on-households');
  check(
    'mixer « On » removes it',
    !(await sim((s) => s.caps())).some((c) => c.sector === 'households')
  );
  await pressPanel('mixer-cut-health');
  check(
    'mixer refuses to cut the clinic (constitution)',
    !(await sim((s) => s.caps())).some((c) => c.sector === 'health') &&
      (await state()).refused === 'health'
  );
  await tapButton('controller-right', 4);
  check('B closes the mixing desk', (await state()).mixer === false);

  // --- Hands & controllers (VS-T30) -----------------------------------------------------------
  const ins = await sim((s) => s.inputs());
  const shownAtEntry = await sim((s) => s.inputsShown());
  check(
    'the controllers are drawn in VR (near plane pulled in)',
    shownAtEntry.shown &&
      shownAtEntry.drawn &&
      shownAtEntry.near <= 0.1 &&
      ins.every((i) => i.meshes > 0 && i.fromHead < 1),
    `near ${shownAtEntry.near}, meshes ${ins.map((i) => i.meshes).join('/')}`
  );
  const holdStick = async () => {
    await rc('set_gamepad_state', {
      device: 'controller-right',
      buttons: [{ index: 2, value: 1, touched: true }],
    });
    await sleep(1500);
    await frames(3);
    await rc('set_gamepad_state', {
      device: 'controller-right',
      buttons: [{ index: 2, value: 0, touched: false }],
    });
    await frames(2);
  };
  const help0 = (await state()).help;
  await holdStick();
  const hidden = await sim((s) => s.inputsShown());
  check(
    'holding a stick hides the hands & controllers (help untouched)',
    !hidden.shown && !hidden.drawn && (await state()).help === help0
  );
  await shot('sim-1b-inputs-hidden');
  await holdStick();
  check('holding it again shows them back', (await sim((s) => s.inputsShown())).drawn);

  // --- Same controls as /village ------------------------------------------------------------
  const y0 = await sim((s) => s.yaw());
  await stick('controller-right', 0.9, 0);
  // Read the first snap as soon as it shows: on slow software GL a frame can last over the 0.6 s
  // held-stick repeat, so the total after release may hold two snaps (by design).
  let y1 = y0;
  await waitFor(async () => {
    y1 = await sim((s) => s.yaw());
    return Math.abs(wrap(y1 - y0)) > 0.01;
  }, 180000);
  await stick('controller-right', 0, 0);
  await frames(2);
  check(
    'right stick → : snap turn 30° right',
    Math.abs(deg(wrap(y1 - y0)) + 30) <= 2,
    `${deg(wrap(y1 - y0))}°`
  );
  const h0 = await head();
  await stick('controller-right', 0, -0.9);
  await sleep(250);
  await stick('controller-right', 0, 0);
  // The glide moves ≤ 0.32 m a frame: 0.8 m is done well within 12 frames.
  await frames(12);
  const h1 = await head();
  // The rig is shrunk for the half-scale village (VS-T33): a step is 0.8 m as felt.
  const scale = await sim((s) => s.scale());
  check(
    'the walker is shrunk to the half-scale village (eyes under a 1.3 m house wall)',
    scale < 1 && h1[1] - (await sim((s, p) => s.ground(p[0], p[2]), h1)) < 1.3,
    `scale ${scale}, eyes ${h1[1].toFixed(2)} m`
  );
  const felt = xz(h0, h1) / scale;
  check('right stick ↑ : one 0.8 m step (felt)', Math.abs(felt - 0.8) < 0.15, felt.toFixed(2));
  // ← / → turn the head from the keyboard while W walks (VS-T33: touchpad off while typing).
  const k0 = await sim((s) => s.yaw());
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowLeft');
  await frames(6);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('KeyW');
  await frames(2);
  const k1 = await sim((s) => s.yaw());
  check(
    'keyboard ← turns the rig while walking (VS-T36 sign)',
    wrap(k1 - k0) < -0.05,
    `${deg(wrap(k1 - k0))}°`
  );
  const labels0 = (await state()).labels;
  await tapButton('controller-right', 3);
  const labels1 = (await state()).labels;
  check('A toggles the labels', labels1 === !labels0);
  if (!labels1) await tapButton('controller-right', 3);

  // --- Walls stop the walker ------------------------------------------------------------------
  await lookAt(HOUSEHOLDS);
  await stick('controller-left', 0, -1);
  // Keep pushing until the walker stops (the wall): no move over 20 frames, at most 600 frames.
  let w1 = await head();
  let w2 = w1;
  for (let i = 0; i < 30; i++) {
    await frames(20);
    w2 = await head();
    if (xz(w1, w2) < 0.05) break;
    w1 = w2;
  }
  await stick('controller-left', 0, 0);
  const inWall = await sim((s, p) => s.blocked(p[0], p[2]), w2);
  check(
    'walking into the houses stops at the wall (not through it)',
    xz(w1, w2) < 0.25 && inWall === false && xz(w2, HOUSEHOLDS) < 9,
    `stopped ${xz(w2, HOUSEHOLDS).toFixed(1)} m from the centre, drift ${xz(w1, w2).toFixed(2)}`
  );
  await shot('sim-2-wall');

  // --- Label → power panel → cut / restore ---------------------------------------------------
  await aimSelect(HOUSEHOLDS_LABEL);
  check('selecting the houses label opens the power panel', (await state()).panel === 'households');
  await shot('sim-3-panel');
  await pressPanel('cut');
  const cutCaps = await sim((s) => s.caps());
  check(
    '« Cut all » sets a 0 kW limit through the engine',
    cutCaps.some((c) => c.sector === 'households' && c.maxKw === 0),
    JSON.stringify(cutCaps)
  );
  await shot('sim-4-cut');
  await pressPanel('restore');
  check(
    '« Restore » removes the limit',
    !(await sim((s) => s.caps())).some((c) => c.sector === 'households')
  );
  await tapButton('controller-right', 4);
  check('B closes the panel', (await state()).panel === null);

  // --- Enter the room, walk, go back out -----------------------------------------------------
  await aimSelect(HOUSEHOLDS_LABEL);
  await pressPanel('enter');
  check(
    '« Enter » puts you inside the room',
    (await state()).inside === 'households' && (await waitFor(async () => (await head())[1] < -50))
  );
  check('the room is drawn', (await sim((s) => s.shown('sim-xr-interior'))) === 1);
  await shot('sim-5-interior');
  await stick('controller-left', 0, -1);
  await sleep(3000);
  await stick('controller-left', 0, 0);
  const r1 = await head();
  check(
    'the room walls keep you inside',
    Math.abs(r1[0]) < 3 && Math.abs(r1[2]) < 2.5,
    r1.map((v) => v.toFixed(1)).join(', ')
  );
  await pressPanel('cut');
  check(
    'the room panel cuts the power too',
    (await sim((s) => s.caps())).some((c) => c.sector === 'households' && c.maxKw === 0)
  );
  await shot('sim-6-interior-dark');
  await pressPanel('restore');
  await pressPanel('exit');
  // The teleport lands a few frames after the press on software GL.
  await waitFor(async () => (await state()).inside === null && (await head())[1] > -5, 60000);
  const out = await head();
  const outState = await state();
  check(
    '« Go outside » brings you to the door',
    outState.inside === null && out[1] > -5 && xz(out, HOUSEHOLDS) < 8,
    `${xz(out, HOUSEHOLDS).toFixed(1)} m from the houses, y ${out[1].toFixed(1)}, inside ${outState.inside}`
  );

  // --- The clinic is never cut ---------------------------------------------------------------
  await lookAt(HEALTH_LABEL);
  await aimSelect(HEALTH_LABEL);
  const clinicPanel = (await state()).panel === 'health';
  if (clinicPanel) await pressPanel('cut');
  check(
    'cutting the clinic is refused (village constitution)',
    clinicPanel &&
      (await state()).refused === 'health' &&
      !(await sim((s) => s.caps())).some((c) => c.sector === 'health' && c.maxKw === 0)
  );
  await shot('sim-7-clinic-refused');

  // --- Arriving from the /village lab (VS-T29): VR opens by itself, next to the object ------
  const SPOT = [3.3, 0, 23.8];
  const exitVr = page.getByRole('button', { name: /Exit VR/i }).first();
  await exitVr.evaluate((el) => setTimeout(() => el.click(), 0)).catch(() => {});
  await waitFor(
    async () => !(await rc('get_session_status').catch(() => null))?.sessionActive,
    30000
  );
  await page.evaluate((at) => window.__XR_HANDOFF__?.(at), [SPOT[0], SPOT[2]]);
  let again = false;
  for (let i = 0; i < 40 && !again; i++) {
    await sleep(1000);
    again = !!(await rc('get_session_status').catch(() => null))?.sessionActive;
  }
  // Head straight ahead in its own space: the rig alone then sets where it faces.
  await rc('look_at', { device: 'headset', target: { x: 0, y: 1.6, z: -2 } }).catch(() => {});
  await sleep(800);
  check('« Go to the simulation » from the lab opens VR by itself (no click)', again);
  await waitFor(async () => !!(await sim((s) => s.head())), 30000);
  const h2 = await head();
  const dist = h2 ? xz(h2, SPOT) : Infinity;
  const yawTo = h2 ? Math.atan2(-(SPOT[0] - h2[0]), -(SPOT[2] - h2[2])) : 0;
  const yaw2 = (await sim((s) => s.yaw())) ?? 99;
  const off = Math.abs(Math.atan2(Math.sin(yaw2 - yawTo), Math.cos(yaw2 - yawTo)));
  check(
    '… standing next to the added object, facing it',
    dist > 1 && dist < 4 && off < 0.5,
    `${dist.toFixed(1)} m away, ${((off * 180) / Math.PI).toFixed(0)}° off`
  );
  await shot('sim-8-from-lab');

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(`Screenshots: ${outDir}/sim-*.png`);
process.exit(failed ? 1 : 0);
