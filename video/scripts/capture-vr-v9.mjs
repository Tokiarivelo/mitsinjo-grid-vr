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
    localStorage.setItem('mitsinjo.sceneQuality', 'high'); // HDRI light and sun shadows in the take
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

if (process.env.STORAGE) {
  const seed = JSON.parse(readFileSync(process.env.STORAGE, 'utf8'));
  await page.addInitScript((kv) => {
    if (sessionStorage.getItem('seeded')) return;
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded', '1');
  }, seed);
}
try {
  const PART = process.env.PART || 'all';
  if (!['sim', 'simday', 'simnight', 'night'].includes(PART)) {
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

    /** Leaves the lab back to the tour (« Leave the lab », or B if the button is out of reach). */
    async function leaveLab() {
      if (!(await press('holo:lab-exit'))) await tapButton(4);
      await waitFor(async () => (await extract())?.stage === 'idle', 30000);
      await sleep(1500);
    }
    /** VS-T51: the realistic library model of the object (credited), then back to the lab view. */
    async function showLibrary(tag) {
      const at = await panelAt('holo:lab-library');
      if (!at) return console.log(`  (no library model for ${tag})`);
      mark(`${tag}-lib`);
      await look(at, 1.4);
      await press('holo:lab-library');
      await sleep(1500);
      const h = await pos('headset');
      await look({ x: h.x, y: h.y - 0.35, z: h.z - 1.2 }, 1.6); // back on the model, the credit under it
      await sleep(6000);
      mark(`${tag}-lib-done`);
    }
    /** Scans the current room, then picks the detection whose label matches (or the photo point). */
    async function scanAndFind(uv, re, tag, dist = 6) {
      const t0 = await tour();
      const guess = panoPoint(uv[0], uv[1], t0?.uFront ?? 0, dist);
      await look(guess, 2.4);
      mark(`${tag}-scan`);
      await tapButton(3);
      await waitFor(async () => ((await tour())?.targets?.length ?? 0) > 0, 120000);
      await sleep(2500);
      mark(`${tag}-detected`);
      const hit = ((await tour())?.targets ?? []).find((x) => re.test(x.label));
      const at = hit ? { x: hit.at[0], y: hit.at[1], z: hit.at[2] } : guess;
      await look(at, 1.4);
      return at;
    }

    // 1. The fridge (kitchen): the whole pipeline in detail, with the AI chat.
    await extractTo3d(fridge, 'fridge', { chat: true });
    await leaveLab();
    // 2. The sofa (hall): faster, the lab tools — pick a piece, resize it, X-ray view.
    mark('walk-hall');
    await walkTo('hall');
    const sofa = await scanAndFind([0.385, 0.607], /sofa|canap/i, 'sofa', 4);
    await extractTo3d(sofa, 'sofa');
    mark('sofa-turn');
    await sleep(7000); // the prepared model turns on the plate
    mark('sofa-turn-done');
    await leaveLab();
    // 3. The house (terrace): architecture.
    mark('walk-terrace');
    await walkTo('terrace');
    const house = await scanAndFind([0.62, 0.495], /house|maison/i, 'house', 10);
    await extractTo3d(house, 'house');
    mark('house-turn');
    await sleep(7000);
    mark('house-turn-done');
    await leaveLab();
    // 4. The car (street): a big object outdoors.
    mark('walk-street');
    await walkTo('street');
    const carAt = await scanAndFind([0.566, 0.56], /car|voiture/i, 'car', 8);
    await extractTo3d(carAt, 'car');
    mark('car-turn');
    await sleep(6000);
    mark('car-turn-done');
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
    writeFileSync(
      join(OUT, 'storage.json'),
      JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))))
    );
    mark('handoff');
    // VS-T49: same session, the /village canvas swaps to the simulation village behind a holo shell.
    const world = () => page.evaluate(() => window.__VR_WORLD__?.state?.() ?? null);
    await waitFor(async () => (await world())?.world === 'village', 120000);
    mark('shell');
    await waitFor(async () => (await world())?.phase === 'idle', 120000);
    save();
  }
  if (PART === 'village') throw new Error('done (village only)');
  if (PART === 'night') {
    // Evening take: /village at 19:00, straight into the simulation village (no lab), same session API.
    await page.goto(`${baseUrl}/village`, { waitUntil: 'networkidle', timeout: 240000 });
    await startCast();
    await sleep(2000);
    const ev = page.getByRole('button', { name: /19:00/ }).first();
    if (await ev.isVisible().catch(() => false)) await ev.click().catch(() => {});
    await sleep(2000);
    if (!(await enterVr('/village', /View in VR immersion/i).catch(() => false)))
      throw new Error('VR session did not start on /village');
    await rc('set_input_mode', { mode: 'controller' });
    await cleanChrome();
    await page.evaluate(() => window.__VR_WORLD__?.go?.('village'));
    const world = () => page.evaluate(() => window.__VR_WORLD__?.state?.() ?? null);
    await waitFor(async () => (await world())?.world === 'village', 120000);
    await waitFor(async () => (await world())?.phase === 'idle', 120000);
    mark('night-start');
  }
  if (PART === 'sim' || PART === 'simday' || PART === 'simnight') {
    await page.goto(`${baseUrl}/simulation`, { waitUntil: 'networkidle', timeout: 240000 });
    await startCast();
    await sleep(2500);
    mark('sim-page');
    // Run the day first, so every panel shows engine results (not 0 kW), then pin the hour (HOUR=12|19).
    const run = page.getByRole('button', { name: /Run simulation/i }).first();
    if (await run.isVisible().catch(() => false)) {
      await run.click().catch(() => {});
      await sleep(6000);
    }
    const stopBtn = page.getByRole('button', { name: /^(Stop|Pause)$/i }).first();
    if (await stopBtn.isVisible().catch(() => false)) await stopBtn.click().catch(() => {});
    const HOUR = Number(process.env.HOUR ?? 12);
    await page.evaluate((h) => {
      const r = [...document.querySelectorAll('input[type=range]')].find(
        (x) => Number(x.max) === 23
      );
      if (!r) return;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(r, String(h));
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    }, HOUR);
    await sleep(2500);
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
  /** Nearest walkable spot around `centre` at about `radius` (m), toward `from` first (walk grid). */
  const freeSpot = async (centre, radius, toward = [0, 0]) => {
    const base = Math.atan2(toward[1] - centre[2], toward[0] - centre[0]);
    for (const dr of [0, 1, -1, 2, -2, 3])
      for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3]) {
        const r = radius + dr;
        const x = centre[0] + Math.cos(base + da) * r;
        const z = centre[2] + Math.sin(base + da) * r;
        const blocked = await simFn((s, p) => s.blocked(p[0], p[1]), [x, z]);
        if (blocked === false) return [x, 0, z];
      }
    return null;
  };
  /** Glides the viewer (headset in origin space) to a village point at eye height, like walking there. */
  const glide = async (world, seconds) => {
    const o = await toOrigin(world);
    const h = await pos('headset');
    if (!o) return;
    const q = (await rc('get_transform', { device: 'headset' }))?.orientation;
    await rc('animate_to', {
      device: 'headset',
      position: { x: o.x, y: h.y, z: o.z },
      ...(q ? { orientation: q } : {}),
      duration: seconds,
    });
    await sleep(seconds * 1000 + 500);
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
    await sleep(1500);
    await waitFor(async () => !!(await simFn((s) => s.gridReady())), 30000);
    const near = await freeSpot([placed.x, 0, placed.z], 4.5, [0, 0]);
    if (near) {
      mark('sim-car-walk');
      await glide(near, 4);
      await simLookSlow([placed.x, 0.5, placed.z], 2);
      mark('sim-car');
      await sleep(4000);
      mark('sim-car-done');
    }
  } else if (PART === 'sim') {
    const c0 = await toOrigin(CONTROLLER_LABEL);
    if (c0) await rc('look_at', { device: 'headset', target: { x: c0.x, y: 1.5, z: c0.z } });
  }
  await sleep(4500);
  if (PART !== 'night' && PART !== 'simnight') {
    // Daytime tour from an open spot: a wide look over the village, the clinic, the houses, then the map.
    mark('sim-walk');
    await waitFor(async () => !!(await simFn((s) => s.gridReady())), 30000);
    await simLookSlow(CONTROLLER_LABEL, 3);
    const vantage = await freeSpot([0, 0, 0], 7, [-9, 11]);
    if (vantage) await glide(vantage, 4);
    await simLookSlow([-9, 1.5, 11], 5);
    await simLookSlow([12.5, 2, -0.5], 6);
    await simLookSlow([0, 1.5, -6], 4);
    mark('sim-labels');
    if (!(await state())?.labels) await tapButton(3);
    await sleep(2500);
    mark('sim-map');
    await simPress('sim-xr-minimap-open');
    await sleep(6000);
    await simPress('sim-xr-button-map-close');
    await sleep(1500);
    mark('sim-ff-walk');
    for (const [c, r] of [
      [[-4, 0, 6], 3],
      [[6, 0, 4], 3],
      [[3, 0, -3], 3],
    ]) {
      const p = await freeSpot(c, r, [0, 0]);
      if (p) await glide(p, 5);
      await simLookSlow([c[0] * 1.6, 1.2, c[2] * 1.6], 1.5);
    }
    mark('sim-night');
  }
  if (PART === 'night' || PART === 'simnight') {
    // Evening: arrive at the dispatch controller, cut the households' power from its mixing desk while
    // turning toward the houses (their lights fade), restore, then try the clinic (refused) facing it.
    await waitFor(async () => !!(await simFn((s) => s.gridReady())), 30000);
    const CONTROLLER = [0, 0, 1];
    const CLINIC = [12.5, 1.5, -0.5];
    const spot = await freeSpot(CONTROLLER, 3.5, [3, -5]);
    if (spot) await glide(spot, 3);
    await simLookSlow([0, 1.2, 1], 2);
    await sleep(2000);
    mark('sim-night-done');
    mark('sim-controller');
    // its mixing desk: the controller itself, else its pin on the map
    await simShoot([0, 1.3, 1]);
    await sleep(1500);
    if (!(await state())?.mixer) {
      await simPress('sim-xr-minimap-open');
      await sleep(1500);
      await simPress('sim-xr-map-pin-dispatcher');
    }
    await waitFor(async () => (await state())?.mixer === true, 20000);
    await sleep(3000);
    mark('sim-mixer');
    const desk = async (name) => {
      const p = await simFn((s, n) => s.worldPos(n), name);
      if (p) await simLookSlow(p, 1.5);
      await simPress(name);
    };
    mark('sim-houses-cut');
    await desk('sim-xr-button-mixer-cut-households');
    await sleep(800);
    await simLookSlow([-9, 0.8, 11], 3);
    await sleep(4500); // the windows and the feeder's electrons fade out
    mark('sim-houses-dark');
    await desk('sim-xr-button-mixer-on-households');
    await sleep(800);
    await simLookSlow([-9, 0.8, 11], 3);
    await sleep(4500); // and come back
    mark('sim-houses-on');
    mark('sim-clinic');
    await desk('sim-xr-button-mixer-cut-health');
    await sleep(800);
    await simLookSlow(CLINIC, 3);
    await sleep(5000); // refused: the clinic stays lit
    mark('sim-end');
    await sleep(1500);
  }
  // « Back to the lab » (VS-T49): the same shell, the lab as it was left.
  if (PART === 'all' && (await simPress('sim-xr-button-back-to-lab'))) {
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
