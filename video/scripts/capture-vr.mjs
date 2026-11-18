// VR showcase capture (video/VR_VIDEO_SCRIPT.md § 5): one continuous headless take in the dev IWER emulator,
// /village (scan → shoot → 2D views + AI chat → 3D → lab → village table → simulation) then /simulation
// (walk, labels, map, building panel, room, mixing desk, clinic refused). Records CDP screencast frames with
// their timestamps and named markers; video/scripts/build-vr.sh cuts the clips from the markers.
// Driven like apps/web/scripts/vr-village-probe.mjs and vr-sim-probe.mjs (same window hooks, dev only).
// Usage: node video/scripts/capture-vr.mjs [baseUrl] [outDir]   (dev server with LLM_PROVIDER=mock running)
// Env: VIDEO_W (default 1920), CHROMIUM_PATH (a Chromium binary when the pinned Playwright one is missing).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      // The emulator's own UI (panels and its gizmo canvas): hidden whole.
      const dev = window.__IWER_DEVICE__?.devui?.devUIContainer;
      if (dev) dev.style.setProperty('display', 'none', 'important');
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
  // From a point between the head and the button: no other panel can stand in the ray's way.
  const h = await pos('headset');
  const from = opts?.from ?? {
    x: h.x + (at.x - h.x) * 0.45 + 0.08,
    y: h.y + (at.y - h.y) * 0.45 - 0.12,
    z: h.z + (at.z - h.z) * 0.45,
  };
  await shoot(at, from, opts);
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
    // Midday (fixed hour) for the village tour; the clock jumps to the evening later (setHour).
    const noon = page.getByRole('button', { name: /12:00/ }).first();
    if (await noon.isVisible().catch(() => false)) await noon.click().catch(() => {});
    await sleep(2000);
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
    // Slow, eased looks: in the edit they play faster, so slow capture = smooth motion.
    await look(panoPoint(uF - 0.12, 0.5, uF), 3.5);
    await look(panoPoint(uF + 0.02, 0.52, uF), 3.0);
    mark('village-look-around');
    await look(fridge, 2.4);
    mark('village-scan');
    await tapButton(3); // A: analyse the view
    await waitFor(async () => ((await tour())?.targets?.length ?? 0) > 0, 120000);
    await cleanChrome();
    await sleep(2500);
    mark('village-detected');
    // Sweep the laser over a few outlines.
    for (const t of ((await tour())?.targets ?? []).slice(0, 3)) {
      const p = { x: t.at[0], y: t.at[1], z: t.at[2] };
      const h = await pos('headset');
      const from = { x: h.x + 0.14, y: h.y - 0.22, z: h.z - 0.12 };
      await rc('animate_to', {
        device: 'controller-right',
        position: from,
        orientation: quatTo(from, p),
        duration: 1.0,
      });
      await sleep(1600);
    }

    /** Shoot → « Extract in 3D » → 2D views (+ optional chat) → build → the model in the lab. */
    async function extractTo3d(target, tag, { chat = false } = {}) {
      mark(`${tag}-shoot`);
      await shoot(target);
      if ((await extract())?.stage !== 'confirm') await shoot(target);
      await sleep(1500);
      await press('holo:extract-yes');
      mark(`${tag}-studio`);
      await waitFor(async () => {
        const x = await extract();
        return x?.stage === 'views' && x.slides.length === 5 && x.canBuild;
      }, 240000);
      await cleanChrome();
      mark(`${tag}-views`);
      await sleep(1500);
      await press('holo:views-next');
      await sleep(1800);
      await press('holo:views-next');
      await sleep(1800);
      if (chat) {
        const chatAt = await panelAt('holo:chat-keyboard');
        if (chatAt) {
          mark(`${tag}-chat`);
          await look(chatAt, 1.8);
          const left = { x: -0.25, y: 1.4, z: -0.05 };
          await press('holo:chat-keyboard', { from: left });
          await typeText('make it red', left);
          await press('holo:chat-send', { from: left });
          mark(`${tag}-chat-sent`);
          await sleep(5000);
        }
      }
      mark(`${tag}-build`);
      // « Validate & build the 3D »: if the ray caught « Leave the studio » instead, come back and retry.
      for (let tries = 0; tries < 3; tries++) {
        const build = await panelAt('holo:views-build');
        if (build) await look(build, 1.8);
        await press(
          'holo:views-build',
          tries === 0 ? { hold: 300 } : { from: { x: 0.12, y: 1.45, z: -0.05 }, hold: 300 }
        );
        const ok = await waitFor(async () => {
          const st = (await extract())?.stage;
          return !!st && st !== 'views' && st !== 'idle' && st !== 'confirm';
        }, 9000);
        if (ok) break;
        console.log(`  build not started (try ${tries + 1}), stage ${(await extract())?.stage}`);
        if ((await extract())?.stage === 'idle') {
          await press('holo:studio-door');
          await waitFor(async () => (await extract())?.stage === 'views', 30000);
          await sleep(1500);
        }
      }
      await waitFor(async () => (await extract())?.stage === 'lab', 240000);
      mark(`${tag}-lab`);
      await waitFor(
        async () => (await page.evaluate(() => window.__VR_LAB_MOTION__?.dissolve ?? 0)) >= 1,
        30000
      );
      await sleep(5000); // the model spins on its plate
      mark(`${tag}-3d`);
    }
    /** Walks like a person to the next room: turn the head to the floor arrow, hold ↑ until through. */
    async function walkTo(room) {
      const arrow = (await tour())?.arrows.find((x) => x.to === room);
      if (!arrow) return (console.log(`  (no arrow to ${room} in ${(await tour())?.room})`), false);
      await look({ x: arrow.position[0], y: 1.0, z: arrow.position[2] }, 2.2);
      await page.keyboard.down('ArrowUp');
      const ok = await waitFor(async () => (await tour())?.room === room, 30000);
      await page.keyboard.up('ArrowUp');
      if (!ok) {
        const a2 = (await tour())?.arrows.find((x) => x.to === room);
        if (a2) await shoot({ x: a2.position[0], y: a2.position[1], z: a2.position[2] });
        await waitFor(async () => (await tour())?.room === room, 30000);
      }
      await sleep(1200);
      const t = await tour();
      // A slow look around the new room.
      await look(panoPoint((t?.uFront ?? 0) + 0.08, 0.5, t?.uFront ?? 0), 2.6);
      await look(panoPoint((t?.uFront ?? 0) - 0.04, 0.52, t?.uFront ?? 0), 2.4);
      return true;
    }

    // 1. The fridge: only until its 3D model is built.
    await extractTo3d(fridge, 'fridge', { chat: true });
    await press('holo:lab-exit');
    await waitFor(async () => (await extract())?.stage === 'idle', 30000);
    await sleep(2000);
    mark('walk-out');
    // 2. Walk outside to the street with the cars.
    for (const room of ['hall', 'terrace', 'street']) {
      mark(`walk-${room}`);
      await walkTo(room);
    }
    // 3. The car: scan the street, shoot the white car, build it in 3D.
    const st = await tour();
    const car = panoPoint(0.566, 0.56, st?.uFront ?? 0, 8);
    await look(car, 2.6);
    mark('car-scan');
    await tapButton(3);
    await waitFor(async () => ((await tour())?.targets?.length ?? 0) > 0, 120000);
    await sleep(3000);
    mark('car-detected');
    const carT = ((await tour())?.targets ?? []).find((x) => /car|voiture/i.test(x.label));
    const carAt = carT ? { x: carT.at[0], y: carT.at[1], z: carT.at[2] } : car;
    await look(carAt, 1.6);
    await extractTo3d(carAt, 'car');
    // 4. Place the car on the village table and add it to the simulation.
    mark('village-table');
    const village = () => page.evaluate(() => window.__VR_VILLAGE__ ?? null);
    const table = await panelAt('holo:village-map');
    let placed = null;
    if (table) {
      await look(table, 2.0);
      const fromLeft = { x: -0.1, y: 1.4, z: -0.05 };
      await shoot(table, fromLeft);
      await sleep(2500);
      mark('village-placed');
      placed = (await village())?.position ?? null;
      await press('holo:village-insert', { from: fromLeft });
      await sleep(3000);
      mark('village-inserted');
      const sim = await panelAt('holo:village-simulation');
      if (sim) await look(sim, 1.4);
      await press('holo:village-simulation', { from: fromLeft });
    }
    writeFileSync(join(OUT, 'placed.json'), JSON.stringify(placed));
    mark('handoff');
    // VS-T49: same session, the /village canvas swaps to the simulation village behind a holo shell.
    const world = () => page.evaluate(() => window.__VR_WORLD__?.state?.() ?? null);
    await waitFor(async () => (await world())?.world === 'village', 120000);
    mark('shell');
    await waitFor(async () => (await world())?.phase === 'idle', 120000);
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
  const HOUSEHOLDS = [-9, 0, 11];
  const HOUSEHOLDS_LABEL = [-9, 4.2, 11];
  /** Slow, eased head turn toward a world point (village space), at eye level. */
  const simLookSlow = async (world, dur = 3) => {
    const t = await toOrigin(world);
    const h = await pos('headset');
    if (t) await look({ x: t.x, y: h.y - 0.1, z: t.z }, dur);
  };
  /** Walks like a person: gentle stick, ramped in and out, the head panning a little. */
  const walk = async (seconds, pan = 0) => {
    for (const v of [-0.15, -0.3]) {
      await stick('controller-left', 0, v);
      await sleep(400);
    }
    if (pan) {
      const h = await pos('headset');
      const q = (await rc('get_transform', { device: 'headset' }))?.orientation;
      if (q) {
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) + pan;
        await rc('animate_to', {
          device: 'headset',
          position: h,
          orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
          duration: seconds,
        });
      }
    }
    await sleep(seconds * 1000);
    for (const v of [-0.15, 0]) {
      await stick('controller-left', 0, v);
      await sleep(400);
    }
  };
  await sleep(1500);
  mark('sim-arrive');
  // Arriving from the lab: face the car just added (its spot on the village table).
  let placed = null;
  try {
    placed = JSON.parse(readFileSync(join(OUT, 'placed.json'), 'utf8'));
  } catch {}
  if (placed && Number.isFinite(placed.x)) {
    await simLookSlow([placed.x, 0.6, placed.z], 2.0);
  } else if (PART === 'sim') {
    const c0 = await toOrigin(CONTROLLER_LABEL);
    if (c0) await rc('look_at', { device: 'headset', target: { x: c0.x, y: 1.5, z: c0.z } });
  }
  await sleep(4500);
  // Daytime tour: the village, then the map to find your way.
  mark('sim-walk');
  await simLookSlow(CONTROLLER_LABEL, 4);
  await simLookSlow([12.5, 2, -0.5], 4); // the clinic
  await simLookSlow(HOUSEHOLDS, 4);
  await walk(5, 0.2);
  await walk(4, -0.3);
  mark('sim-labels');
  if (!(await state())?.labels) await tapButton(3);
  await sleep(2500);
  mark('sim-map');
  await simPress('sim-xr-minimap-open');
  await sleep(6000);
  await simPress('sim-xr-button-map-close');
  await sleep(1500);
  // Fast forward to the evening: « Start the battery & dispatch » plays the day in the headset.
  mark('sim-night');
  await simPress('sim-xr-minimap-open');
  await sleep(1500);
  await simPress('sim-xr-map-pin-dispatcher');
  await waitFor(async () => (await state())?.mixer === true, 20000);
  await simPress('sim-xr-button-mixer-start');
  mark('sim-ff');
  const hour = () =>
    page.evaluate(() => Number((document.body.innerText.match(/\b(\d\d):00\b/) ?? [])[1] ?? -1));
  await waitFor(async () => (await hour()) >= 19, 240000);
  console.log(`  clock at ${await hour()}:00`);
  await simPress('sim-xr-button-mixer-close');
  await sleep(1500);
  mark('sim-night-done');
  // Evening houses: cut their power, the windows and the feeder's electrons fade; restore, they come back.
  const openHouses = async () => {
    if ((await state())?.panel === 'households') return;
    await simShoot(HOUSEHOLDS_LABEL);
    await waitFor(async () => (await state())?.panel === 'households', 20000);
  };
  await simLookSlow(HOUSEHOLDS, 3);
  mark('sim-panel');
  await openHouses();
  await sleep(2500);
  mark('sim-less');
  await simPress('sim-xr-button-less');
  await sleep(3000);
  await simPress('sim-xr-button-restore');
  await sleep(2500);
  await simPress('sim-xr-button-cut');
  await sleep(5000); // the lights fade out
  mark('sim-restore');
  await simPress('sim-xr-button-restore');
  await sleep(5000); // and come back
  mark('sim-enter');
  await openHouses();
  await simPress('sim-xr-button-enter');
  await waitFor(async () => (await state())?.inside === 'households', 60000);
  await sleep(1500);
  await rc('look_at', { device: 'headset', target: { x: 0.8, y: 1.4, z: -2 } }).catch(() => {});
  await sleep(2500);
  mark('sim-room');
  await simPress('sim-xr-button-cut');
  await sleep(4000);
  await simPress('sim-xr-button-restore');
  await sleep(4000);
  await simPress('sim-xr-button-exit');
  await waitFor(async () => (await state())?.inside === null, 60000);
  await sleep(2000);
  // Dispatcher mixing desk, from its map pin.
  await simPress('sim-xr-minimap-open');
  await sleep(2000);
  mark('sim-mixer');
  await simPress('sim-xr-map-pin-dispatcher');
  await waitFor(async () => (await state())?.mixer === true, 20000);
  await sleep(3000);
  mark('sim-mixer-cut');
  await simPress('sim-xr-button-mixer-cut-market');
  await sleep(4000);
  await simPress('sim-xr-button-mixer-on-market');
  await sleep(2500);
  mark('sim-clinic');
  await simPress('sim-xr-button-mixer-cut-health');
  await sleep(4500);
  mark('sim-end');
  await sleep(1500);
  // « Back to the lab » (VS-T49): the same shell, the lab as it was left.
  if (PART !== 'sim' && (await simPress('sim-xr-button-back-to-lab'))) {
    mark('back-to-lab');
    await waitFor(
      async () => (await page.evaluate(() => window.__VR_WORLD__?.state?.()))?.world === 'lab',
      120000
    );
    await sleep(4000);
    mark('lab-again');
  }
} catch (e) {
  console.log('CAPTURE ERROR', e.message);
} finally {
  recording = false;
  save();
  await browser.close();
  console.log(`${frameN} frames in ${now().toFixed(0)} s → ${OUT}/timeline.json`);
}
