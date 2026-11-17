// Lab ↔ village in ONE XR session (VS-T49). Drives the dev IWER emulator on /village: the lab asks for
// the simulation's village (as « Go to the simulation » does in the headset), the hand-over shell
// covers then reveals, the session never ends, the village world (nav pad, back button) is there;
// a pinch on « Back to the lab » plays the way back and the studio returns, still in the session.
// Usage: node scripts/vr-world-probe.mjs <baseUrl> <outDir>   (dev server must run, mock LLM)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePort } from './port.mjs';

const [baseUrl = `http://localhost:${resolvePort()}`, outArg = 'test-results/vr-world-probe'] =
  process.argv.slice(2);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const rc = (method, params = {}) =>
    page.evaluate(([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p), [method, params]);
  const on = (key, fn, arg) =>
    page.evaluate(
      ([k, src, a]) => {
        const o = window[k];
        return o ? new Function('o', 'a', `return (${src})(o, a)`)(o, a) : null;
      },
      [key, fn.toString(), arg]
    );
  const world = () => on('__VR_WORLD__', (o) => o.state());
  const sessionActive = async () =>
    !!(await rc('get_session_status').catch(() => null))?.sessionActive;
  const shot = (name) =>
    page
      .screenshot({ path: join(outDir, `${name}.png`), timeout: 90000 })
      .catch(() => console.log(`  (screenshot ${name} skipped: frame too slow)`));
  const waitFor = async (fn, ms = 30000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if (await fn()) return true;
      await sleep(300);
    }
    return false;
  };

  await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 180000 });
  const enter = page.getByRole('button', { name: /View in VR immersion/i }).first();
  await enter.waitFor({ timeout: 180000 });
  await enter.evaluate((el) => setTimeout(() => el.click(), 0));
  check('the immersive session starts on /village', await waitFor(sessionActive, 40000));
  await rc('set_input_mode', { mode: 'hand' });
  check(
    'the lab is shown first',
    await waitFor(
      async () => (await world())?.world === 'lab' && !!(await on('__VR_CONTROLS__', (o) => 1))
    )
  );
  await shot('world-0-lab');

  // Walk one step in the lab tour first: the spot must be the same on the way back.
  const panelAt = (id) =>
    page.evaluate((pid) => {
      const o = window.__VR_PANELS__?.objects.find((x) => x.userData.holoPanel?.id === pid);
      if (!o) return null;
      const p = o.getWorldPosition(new o.position.constructor());
      return { x: p.x, y: p.y, z: p.z };
    }, `holo:${id}`);
  const offset = () => page.evaluate(() => [...(window.__VR_TOUR__?.ground.offset ?? [])]);
  const at0 = await panelAt('xr-nav-step-forward');
  if (at0) {
    await rc('set_transform', { device: 'hand-right', position: { x: 0.15, y: 1.25, z: -0.1 } });
    await rc('look_at', { device: 'hand-right', target: at0 });
    await sleep(500);
    await rc('select', { device: 'hand-right' });
    await sleep(2500);
  }
  const labSpot = await offset();
  check(
    'the lab tour walked one step',
    Math.hypot(labSpot[0] ?? 0, labSpot[2] ?? 0) > 0.3,
    JSON.stringify(labSpot)
  );

  // « Go to the simulation » in the headset: the shell covers, the world swaps, the shell crumbles.
  await on('__VR_WORLD__', (o) => o.go('village'));
  const covering = await world();
  check('the hand-over starts by covering', covering?.phase === 'cover', JSON.stringify(covering));
  check(
    'the shell is drawn while it covers',
    await waitFor(async () => (await on('__VR_WORLD__', (o) => o.shell())) === true, 10000)
  );
  await shot('world-1-shell');
  check(
    'the world becomes the village',
    await waitFor(async () => (await world())?.world === 'village', 60000)
  );
  check('the XR session never ended', await sessionActive());
  check(
    'the village world mounts in the same session (sim probe up)',
    await waitFor(async () => (await on('__VR_SIM__', () => 1)) === 1, 120000)
  );
  check(
    'the hand-over settles and the shell is gone',
    await waitFor(
      async () =>
        (await world())?.phase === 'idle' && (await on('__VR_WORLD__', (o) => o.shell())) === false,
      60000
    )
  );
  check(
    'the lab studio is gone (no studio controls)',
    (await on('__VR_CONTROLS__', () => 1)) === null
  );
  const sim = (fn, arg) => on('__VR_SIM__', fn, arg);
  check(
    'the village shows « Back to the lab » and the hands pad',
    await waitFor(
      async () =>
        (await sim((s) => s.shown('sim-xr-back-to-lab'))) === 1 &&
        (await sim((s) => s.shown('sim-xr-nav-pad'))) === 1,
      60000
    )
  );
  const scale = await sim((s) => s.scale());
  check('the viewer stands in the half-scale village rig', scale < 1, `scale ${scale}`);
  await shot('world-2-village');

  /** Pinch a sim button once it has settled (it lazy-follows the walker). */
  const pinchSim = async (name, device = 'hand-right') => {
    let at = await sim((s, n) => s.worldPos(n), name);
    for (let i = 0; i < 30 && at; i++) {
      await sleep(1000);
      const next = await sim((s, n) => s.worldPos(n), name);
      if (!next) break;
      const still = Math.hypot(next[0] - at[0], next[1] - at[1], next[2] - at[2]) < 0.005;
      at = next;
      if (still) break;
    }
    if (!at) return false;
    const h = await sim((s) => s.toOrigin(s.head()));
    const target = await sim((s, p) => s.toOrigin(p), at);
    const side = device.includes('left') ? -0.15 : 0.15;
    await rc('set_transform', {
      device,
      position: { x: h[0] + side, y: h[1] - 0.25, z: h[2] - 0.05 },
    });
    await rc('look_at', { device, target: { x: target[0], y: target[1], z: target[2] } });
    await sleep(500);
    await rc('select', { device });
    await sleep(2500);
    return true;
  };
  // Low left (the minimap's mirror): left of the head, below the eyes.
  const head = await sim((s) => s.toOrigin(s.head()));
  const btn = await sim((s) => s.toOrigin(s.worldPos('sim-xr-button-back-to-lab')));
  check(
    '« Back to the lab » sits low left, out of the labels ahead',
    !!btn && btn[0] < head[0] - 0.15 && btn[1] < head[1],
    btn ? `dx ${(btn[0] - head[0]).toFixed(2)} dy ${(btn[1] - head[1]).toFixed(2)}` : 'missing'
  );
  // Looking straight at it (head turned to it) must not re-centre it away from the laser.
  const before = await sim((s) => s.worldPos('sim-xr-button-back-to-lab'));
  const btnO = await sim((s, p) => s.toOrigin(p), before);
  await rc('look_at', { device: 'headset', target: { x: btnO[0], y: btnO[1], z: btnO[2] } });
  await sleep(4000);
  const after = await sim((s) => s.worldPos('sim-xr-button-back-to-lab'));
  const slid = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  check('looking at « Back to the lab » leaves it in place', slid < 0.02, `${slid.toFixed(3)} m`);
  // Every input reaches it: left controller hides it, left hand shows it, right hand presses it.
  await rc('set_input_mode', { mode: 'controller' });
  await sleep(1500);
  await pinchSim('sim-xr-button-back-to-lab-toggle', 'controller-left');
  check(
    'the LEFT controller hides « Back to the lab » with its chip (chip stays)',
    (await sim((s) => s.shown('sim-xr-button-back-to-lab'))) === 0 &&
      (await sim((s) => s.shown('sim-xr-button-back-to-lab-toggle'))) === 1
  );
  await shot('world-2b-hidden');
  await rc('set_input_mode', { mode: 'hand' });
  await sleep(1500);
  await pinchSim('sim-xr-button-back-to-lab-toggle', 'hand-left');
  check(
    'the LEFT hand shows it again',
    (await sim((s) => s.shown('sim-xr-button-back-to-lab'))) === 1
  );
  check('« Back to the lab » is in the scene', await pinchSim('sim-xr-button-back-to-lab'));
  check(
    'a pinch on « Back to the lab » starts the way back',
    await waitFor(async () => (await world())?.target === 'lab', 30000),
    JSON.stringify(await world())
  );
  check(
    'the lab comes back, same session',
    await waitFor(async () => (await world())?.world === 'lab', 60000)
  );
  check('the XR session still runs', await sessionActive());
  check(
    'the studio is back (its controls)',
    await waitFor(async () => (await on('__VR_CONTROLS__', () => 1)) === 1, 120000)
  );
  const backSpot = await offset();
  check(
    'the lab kept its state: same tour spot as before the village',
    Math.hypot((backSpot[0] ?? 0) - (labSpot[0] ?? 0), (backSpot[2] ?? 0) - (labSpot[2] ?? 0)) <
      0.01,
    JSON.stringify(backSpot)
  );
  check(
    'the village rig gave the camera back (scale 1)',
    (await page.evaluate(() => window.__VR_SIM__ === undefined)) === true
  );
  await waitFor(async () => (await world())?.phase === 'idle', 60000);
  await shot('world-3-lab-again');

  if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join('\n')}`);
  check('no page error', errors.length === 0);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
