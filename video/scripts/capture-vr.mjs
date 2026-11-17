// VR showcase capture (video/VR_VIDEO_SCRIPT.md § 5): one continuous headless take in the dev IWER emulator,
// /village (scan → shoot → 2D views + AI chat → 3D → lab → village table → simulation) then /simulation
// (walk, labels, map, building panel, room, mixing desk, clinic refused). Records CDP screencast frames with
// their timestamps and named markers; video/scripts/build-vr.sh cuts the clips from the markers.
// Driven like apps/web/scripts/vr-village-probe.mjs and vr-sim-probe.mjs (same window hooks, dev only).
// Usage: node video/scripts/capture-vr.mjs [baseUrl] [outDir]   (dev server with LLM_PROVIDER=mock running)
// Env: VIDEO_W (default 1920), CHROMIUM_PATH (a Chromium binary when the pinned Playwright one is missing).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(join(ROOT, 'apps/web/package.json'));
const { chromium } = req('@playwright/test');

const [baseUrl = 'http://localhost:3000', outArg = 'video/captures/raw/vr'] = process.argv.slice(2);
const OUT = resolve(outArg);
const FRAMES = join(OUT, 'frames');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const W = Number(process.env.VIDEO_W || 1920);
const H = Math.round((W * 9) / 16);

// Fake webcam: the sample room (the emulator shows the 360° tour anyway).
const y4m = join(OUT, 'room.y4m');
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-y',
  '-loop',
  '1',
  '-i',
  join(ROOT, 'apps/web/public/samples/vision-room.jpg'),
  '-t',
  '2',
  '-r',
  '10',
  '-vf',
  'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '-pix_fmt',
  'yuv420p',
  y4m,
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const markers = [];
const mark = (name) => {
  markers.push({ name, t: now() });
  console.log(`[${now().toFixed(1)}s] ${name}`);
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  locale: 'en-US',
  colorScheme: 'dark',
});
await ctx.grantPermissions(['camera', 'microphone'], { origin: baseUrl });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('theme', 'dark');
  } catch {}
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 160)));

// --- Recorder: every composited frame, with its time ---------------------------------------------
const times = [];
let frameN = 0;
let recording = false;
let cdp;
async function startCast() {
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    if (recording) {
      const name = `${String(frameN++).padStart(6, '0')}.jpg`;
      writeFileSync(join(FRAMES, name), Buffer.from(f.data, 'base64'));
      times.push({ f: name, t: now() });
    }
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: W,
    maxHeight: H,
  });
  recording = true;
}
function save() {
  writeFileSync(
    join(OUT, 'timeline.json'),
    JSON.stringify({ W, H, markers, frames: times }, null, 1)
  );
}

// --- Emulator + app helpers --------------------------------------------------------------------
const rc = async (method, params = {}) => {
  for (let a = 0; ; a++) {
    try {
      return await page.evaluate(
        ([m, p]) => window.__IWER_DEVICE__?.remote.dispatch(m, p),
        [method, params]
      );
    } catch (e) {
      if (a >= 8 || !/timed out|Execution context/.test(String(e))) throw e;
      await sleep(3000);
    }
  }
};
/** Hides the emulator chrome (DevUI, "Remote Control Active" pill and glow), the Next badge and Exit VR. */
const cleanChrome = () =>
  page.evaluate(() => {
    const run = () => {
      const css = document.getElementById('__vr_clean') || document.createElement('style');
      css.id = '__vr_clean';
      css.textContent = 'nextjs-portal,[data-xr-exit]{display:none!important}';
      if (!css.isConnected) document.head.appendChild(css);
      // Every fixed layer that does not hold the app's R3F canvas belongs to the emulator UI.
      for (const el of document.body.querySelectorAll('body *')) {
        if (el.dataset.vrHidden) continue;
        if (getComputedStyle(el).position !== 'fixed') continue;
        if (el.querySelector('canvas[data-engine]') || el.matches('canvas[data-engine]')) continue;
        if (el.closest('[data-vr-keep]')) continue;
        el.style.setProperty('display', 'none', 'important');
        el.dataset.vrHidden = '1';
      }
    };
    run();
    if (!window.__vrCleanTimer) window.__vrCleanTimer = setInterval(run, 300);
  });
const quatTo = (from, to) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const [sy, cy, sp, cp] = [
    Math.sin(yaw / 2),
    Math.cos(yaw / 2),
    Math.sin(pitch / 2),
    Math.cos(pitch / 2),
  ];
  return { x: cy * sp, y: cp * sy, z: -sy * sp, w: cy * cp };
};
const pos = async (device) =>
  (await rc('get_transform', { device }))?.position ?? { x: 0, y: 1.6, z: 0 };
/** Eased head turn towards a point (origin space), like a person looking. */
async function look(target, dur = 1.2) {
  const p = await pos('headset');
  await rc('animate_to', {
    device: 'headset',
    position: p,
    orientation: quatTo(p, target),
    duration: dur,
  });
  await sleep(dur * 1000 + 300);
}
/** Moves the right controller in front of the head and points it at the target, then pulls the trigger. */
async function shoot(target, from, { dur = 0.7, hold = 900 } = {}) {
  const h = await pos('headset');
  const at = from ?? { x: h.x + 0.14, y: h.y - 0.22, z: h.z - 0.12 };
  await rc('animate_to', {
    device: 'controller-right',
    position: at,
    orientation: quatTo(at, target),
    duration: dur,
  });
  await sleep(dur * 1000 + 350);
  await rc('select', { device: 'controller-right' });
  await sleep(hold);
}
const waitFor = async (fn, ms = 20000) => {
  const t1 = Date.now();
  while (Date.now() - t1 < ms) {
    if (await fn().catch(() => false)) return true;
    await sleep(400);
  }
  return false;
};
const tapButton = async (index, device = 'controller-right') => {
  await rc('set_gamepad_state', { device, buttons: [{ index, value: 1, touched: true }] });
  await sleep(350);
  await rc('set_gamepad_state', { device, buttons: [{ index, value: 0, touched: false }] });
  await sleep(500);
};
const enterVr = async (path, label) => {
  if (!page.url().includes(path))
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 240000 });
  const btn = page.getByRole('button', { name: label }).first();
  await btn.waitFor({ timeout: 240000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(4000); // the dev emulator installs after the 3D view loads
    await btn.evaluate((el) => setTimeout(() => el.click(), 0)).catch(() => {});
    if (await waitFor(async () => !!(await rc('get_session_status'))?.sessionActive, 45000))
      return true;
  }
  return false;
};

// /village window hooks (vr-village-probe.mjs)
const EYE = { x: 0, y: 1.6, z: 0 };
const panoPoint = (u, v, uFront, dist = 6) => {
  const yaw = (u - uFront) * Math.PI * 2;
  const pitch = (0.5 - v) * Math.PI;
  const c = Math.cos(pitch);
  return {
    x: EYE.x + Math.sin(yaw) * c * dist,
    y: EYE.y + Math.sin(pitch) * dist,
    z: EYE.z - Math.cos(yaw) * c * dist,
  };
};
const FRIDGE_UV = [0.8435, 0.552];
const extract = () => page.evaluate(() => window.__VR_EXTRACT__ ?? null);
const tour = () => page.evaluate(() => window.__VR_TOUR__ ?? null);
const panelAt = (id) =>
  page.evaluate((pid) => {
    const o = window.__VR_PANELS__?.objects.find((x) =>
      pid.endsWith('*')
        ? x.userData.holoPanel?.id.startsWith(pid.slice(0, -1))
        : x.userData.holoPanel?.id === pid
    );
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    const p = o.getWorldPosition(new o.position.constructor());
    return { x: p.x, y: p.y, z: p.z };
  }, id);
const press = async (id, opts) => {
  const at = await panelAt(id);
  if (!at) return (console.log(`  (no panel ${id})`), false);
  await shoot(at, opts?.from ?? { x: 0.12, y: 1.45, z: -0.05 }, opts);
  return true;
};
/** Types on the holo keyboard: aims each key's centre (layout of utils/xr-keyboard.ts, QWERTY). */
const ROWS = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'];
const keyWorld = (u, y) =>
  page.evaluate(
    ([u, y]) => {
      const o = window.__VR_PANELS__?.objects.find(
        (x) => x.userData.holoPanel?.id === 'holo:chat-keys'
      );
      if (!o) return null;
      const g = o.geometry.parameters;
      o.updateWorldMatrix(true, false);
      const p = o.localToWorld(
        new o.position.constructor((u - 0.5) * g.width, (0.5 - y) * g.height, 0)
      );
      return { x: p.x, y: p.y, z: p.z };
    },
    [u, y]
  );
async function typeText(text, from) {
  for (const ch of text) {
    let u;
    let y;
    if (ch === ' ') [u, y] = [0.4, 0.9];
    else {
      const r = ROWS.findIndex((row) => row.includes(ch));
      if (r < 0) continue;
      [u, y] = [ROWS[r].indexOf(ch) / 10 + 0.05, r / 5 + 0.1];
    }
    const at = await keyWorld(u, y);
    if (at) await shoot(at, from, { dur: 0.35, hold: 350 });
  }
}

try {
  const PART = process.env.PART || 'all';
  if (PART !== 'sim') {
    // ============================== /village ==============================
    await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 240000 });
    await startCast();
    await sleep(2500);
    mark('village-page');
    const ok = await enterVr('/village', /View in VR immersion/i).catch(() => false);
    if (!ok) throw new Error('VR session did not start on /village');
    mark('village-vr-entered');
    await rc('set_input_mode', { mode: 'controller' });
    await rc('set_transform', {
      device: 'controller-left',
      position: { x: -0.25, y: 0.85, z: 0.05 },
    });
    await rc('set_transform', {
      device: 'controller-right',
      position: { x: 0.18, y: 1.3, z: -0.2 },
    });
    await cleanChrome();
    await sleep(1500);
    const uF = (await tour())?.uFront ?? 0.8;
    const fridge = panoPoint(...FRIDGE_UV, uF);
    // Look around the loft first: left, then towards the kitchen.
    await look(panoPoint(uF - 0.12, 0.5, uF), 2.2);
    await look(panoPoint(uF + 0.02, 0.52, uF), 2.0);
    mark('village-look-around');
    await look(fridge, 1.6);
    mark('village-scan');
    await tapButton(3); // A: analyse the view
    await waitFor(async () => ((await tour())?.targets?.length ?? 0) > 0, 120000);
    await cleanChrome();
    await sleep(2500);
    mark('village-detected');
    // Sweep the laser over a few outlines, then shoot the fridge.
    const targets = ((await tour())?.targets ?? []).slice(0, 3);
    for (const t of targets) {
      const p = { x: t.at[0], y: t.at[1], z: t.at[2] };
      const h = await pos('headset');
      const from = { x: h.x + 0.14, y: h.y - 0.22, z: h.z - 0.12 };
      await rc('animate_to', {
        device: 'controller-right',
        position: from,
        orientation: quatTo(from, p),
        duration: 0.8,
      });
      await sleep(1400);
    }
    mark('village-shoot');
    await shoot(fridge);
    if ((await extract())?.stage !== 'confirm') await shoot(fridge);
    await sleep(1200);
    mark('village-extract-dialog');
    await press('holo:extract-yes');
    mark('studio-enter');
    await waitFor(async () => {
      const x = await extract();
      return x?.stage === 'views' && x.slides.length === 5 && x.canBuild;
    }, 240000);
    await cleanChrome();
    mark('studio-views');
    await sleep(1500);
    await press('holo:views-next');
    await sleep(1500);
    await press('holo:views-next');
    await sleep(1500);
    mark('studio-chat');
    const chatAt = await panelAt('holo:chat-keyboard');
    if (chatAt) {
      await look(chatAt, 1.2);
      const left = { x: -0.25, y: 1.4, z: -0.05 };
      await press('holo:chat-keyboard', { from: left });
      mark('studio-chat-typing');
      await typeText('make it red', left);
      await press('holo:chat-send', { from: left });
      mark('studio-chat-sent');
      await waitFor(async () => {
        const all = Object.values((await extract())?.chats ?? {});
        return all.some((c) => Array.isArray(c) && c.at(-1) === 'done');
      }, 240000);
      await sleep(1500);
      mark('studio-chat-done');
    }
    const build = await panelAt('holo:views-build');
    if (build) await look(build, 1.2);
    mark('studio-build');
    await press('holo:views-build', { hold: 300 });
    await waitFor(async () => (await extract())?.stage === 'lab', 240000);
    mark('lab-open');
    await waitFor(
      async () => (await page.evaluate(() => window.__VR_LAB_MOTION__?.dissolve ?? 0)) >= 1,
      20000
    );
    await sleep(3000);
    mark('lab-edit');
    await press('holo:lab-piece-*');
    await sleep(800);
    await press('holo:lab-bigger').catch(() => {});
    await sleep(1500);
    await press('holo:lab-turn').catch(() => {});
    await sleep(2500);
    mark('village-table');
    const table = await panelAt('holo:village-map');
    if (table) {
      await look(table, 1.4);
      const fromLeft = { x: -0.1, y: 1.4, z: -0.05 };
      await shoot(table, fromLeft);
      await sleep(2000);
      mark('village-placed');
      await press('holo:village-insert', { from: fromLeft });
      await sleep(2500);
      mark('village-inserted');
      const sim = await panelAt('holo:village-simulation');
      if (sim) await look(sim, 1.0);
      await press('holo:village-simulation', { from: fromLeft });
    }
    mark('handoff');
    await waitFor(async () => page.url().includes('/simulation'), 60000);
    await waitFor(async () => !!(await rc('get_session_status'))?.sessionActive, 120000);
    save();
  }
  if (PART === 'village') throw new Error('done (village only)');
  if (PART === 'sim') {
    await page.goto(`${baseUrl}/simulation`, { waitUntil: 'networkidle', timeout: 240000 });
    await startCast();
    await sleep(2500);
    mark('sim-page');
    // Run the day first, so every panel shows engine results (not 0 kW).
    const run = page.getByRole('button', { name: /Run simulation/i }).first();
    if (await run.isVisible().catch(() => false)) {
      await run.click().catch(() => {});
      await sleep(8000);
    }
    if (!(await enterVr('/simulation', /View in VR/i).catch(() => false)))
      throw new Error('VR session did not start on /simulation');
  }

  // ============================== /simulation ==============================
  const simFn = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        const s = window.__VR_SIM__;
        return s ? new Function('s', 'a', `return (${src})(s, a)`)(s, a) : null;
      },
      [fn.toString(), arg]
    );
  const state = () => simFn((s) => s.state());
  const toOrigin = (p) =>
    simFn((s, q) => s.toOrigin(q), p).then((o) => o && { x: o[0], y: o[1], z: o[2] });
  const simShoot = async (world, opts) => {
    const t = await toOrigin(world);
    if (t) await shoot(t, undefined, { hold: 1500, ...opts });
  };
  const simPress = async (name, opts) => {
    const p = await simFn((s, n) => s.worldPos(n), name);
    if (!p) return (console.log(`  (no ${name})`), false);
    await simShoot(p, opts);
    return true;
  };
  const simLook = async (world, dur = 1.6) => {
    const t = await toOrigin(world);
    if (t) await look({ x: t.x, y: (await pos('headset')).y - 0.15, z: t.z }, dur);
  };
  await rc('set_input_mode', { mode: 'controller' });
  await rc('set_transform', {
    device: 'controller-left',
    position: { x: -0.25, y: 0.85, z: 0.05 },
  });
  await waitFor(async () => !!(await simFn((s) => s.head())), 60000);
  await cleanChrome();
  const stick = (device, x, y) =>
    rc('set_gamepad_state', {
      device,
      axes: [
        { index: 0, value: x },
        { index: 1, value: y },
      ],
    });
  const CONTROLLER_LABEL = [0, 4.4, 1];
  // Face the village centre before the first frame we keep (a palm can stand right at the spawn).
  const centre = await toOrigin(CONTROLLER_LABEL);
  if (centre)
    await rc('look_at', { device: 'headset', target: { x: centre.x, y: 1.5, z: centre.z } });
  await sleep(2500);
  mark('sim-arrive');
  await sleep(2500);
  // Walk towards the dispatcher, then a snap turn.
  mark('sim-walk');
  await stick('controller-left', 0, -0.8);
  await sleep(5000);
  await stick('controller-left', 0, 0);
  await stick('controller-right', 0.9, 0);
  await sleep(700);
  await stick('controller-right', 0, 0);
  await sleep(2500);
  mark('sim-labels');
  if (!(await state())?.labels) await tapButton(3);
  await sleep(3000);
  // Map → the households pin opens their power panel in front of you.
  mark('sim-map');
  await simPress('sim-xr-minimap-open');
  await sleep(3500);
  mark('sim-panel');
  await simPress('sim-xr-map-pin-households');
  await waitFor(async () => (await state())?.panel === 'households', 20000);
  await sleep(2500);
  mark('sim-less');
  await simPress('sim-xr-button-less');
  await sleep(1500);
  await simPress('sim-xr-button-less');
  await sleep(3000);
  mark('sim-enter');
  await simPress('sim-xr-button-enter');
  await waitFor(async () => (await state())?.inside === 'households', 60000);
  await sleep(1500);
  await rc('look_at', { device: 'headset', target: { x: 0.8, y: 1.4, z: -2 } }).catch(() => {});
  await sleep(3500);
  mark('sim-room');
  await simPress('sim-xr-button-exit');
  await waitFor(async () => (await state())?.inside === null, 60000);
  await sleep(2000);
  // Dispatcher mixing desk, from its map pin.
  await simPress('sim-xr-minimap-open');
  await sleep(2000);
  mark('sim-mixer');
  await simPress('sim-xr-map-pin-dispatcher');
  await waitFor(async () => (await state())?.mixer === true, 20000);
  await sleep(2500);
  await simPress('sim-xr-button-mixer-start').catch(() => {});
  await sleep(3000);
  mark('sim-mixer-cut');
  await simPress('sim-xr-button-mixer-cut-households');
  await sleep(3000);
  await simPress('sim-xr-button-mixer-on-households');
  await sleep(2000);
  mark('sim-clinic');
  await simPress('sim-xr-button-mixer-cut-health');
  await sleep(4000);
  mark('sim-end');
  await sleep(1500);
} catch (e) {
  console.log('CAPTURE ERROR', e.message);
} finally {
  recording = false;
  save();
  await browser.close();
  console.log(`${frameN} frames in ${now().toFixed(0)} s → ${OUT}/timeline.json`);
}
