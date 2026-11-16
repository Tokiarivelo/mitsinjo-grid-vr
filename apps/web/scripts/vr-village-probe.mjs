// /village VR probe: drives the dev IWER emulator (Quest 3) like the IWER MCP does, through
// `window.__IWER_DEVICE__.remote.dispatch`, with the sample room fed as a fake webcam.
// The emulator shows the walkable 360° tour (VS-T14), not the webcam. Checks: session starts;
// wrist menu; loft with 2 floor arrows; a controller shot at the fridge (no scan yet) starts ONE
// scan and outlines it, asking nothing; a second shot at it asks « Extract to 3D? »; then the 3D
// studio: 2D views carousel + generation column, the views AI chat (keys, send, bot answer) → build (the desks turn, VS-T31) → the lab opens by itself (a piece hidden; « 2D lab » / « 3D lab » turn back and forth, the object placed
// on the village hologram and added to the simulation); mouse clicks through the DevUI overlay
// (wrist menu, Help, « Cancel », menu « Close ») → leave = miniature with its card; a tap on it connects it, « Put away » removes it; a hand pinch at the lamp; shooting a floor
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

  // Menu: hidden on entry. In the emulator the button floats in front (controllers turn with the head
  // there, a worn button could never be aimed at): wearer stays null by design (eefd12e).
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
          visible: m.buttonVisible,
          button: { x: m.button.x, y: m.button.y, z: m.button.z },
        }
      );
    });
  const m0 = await menu();
  check(
    'menu closed on entry, Menu button floating in view (emulator)',
    !!m0 && !m0.open && m0.visible && m0.wearer === null
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
  // VS-T32: the menu has its own « Close » button, and no telemetry HUD any more.
  const m1b = await menu();
  if (m1b) await fire('controller-right', m1b.button, { x: 0.2, y: 1.3, z: -0.1 });
  await sleep(600);
  const shownN = (name) => page.evaluate((n) => window.__VR_CONTROLS__?.shown(n) ?? -1, name);
  check('no telemetry HUD in the open menu', (await shownN('village-spatial-hud')) === 0);
  const closeAt = await page.evaluate(() => {
    const o = window.__VR_PANELS__?.objects.find(
      (x) => x.userData.holoPanel?.id === 'holo:menu-close'
    );
    if (!o) return null;
    const p = o.getWorldPosition(new o.position.constructor());
    return { x: p.x, y: p.y, z: p.z };
  });
  await shot('0d-menu-close-button');
  if (closeAt) await fire('controller-right', closeAt, { x: 0.2, y: 1.3, z: -0.1 });
  check('« Close » in the menu closes it', !!closeAt && (await menu())?.open === false);

  // Mouse (VS-T24): the IWER DevUI canvas lies over the scene; clicks must still reach it.
  const click = async (world) => {
    const at = await page.evaluate((p) => window.__VR_CONTROLS__?.toScreen(p) ?? null, world);
    if (!at) return false;
    await page.mouse.move(at.x, at.y);
    await sleep(300);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(1500);
    return true;
  };
  // Wrist button in plain view: head level, left controller raised in front.
  await rc('look_at', { device: 'headset', target: { x: 0, y: 1.5, z: -2 } });
  await rc('set_transform', { device: 'controller-left', position: { x: -0.12, y: 1.4, z: -0.4 } });
  await sleep(1200);
  const m2 = await menu();
  if (m2) await click(m2.button);
  check('a mouse click on the wrist button opens the menu', (await menu())?.open === true);
  const helpBefore = await page.evaluate(() => window.__VR_CONTROLS__?.help);
  const helpAt = await page.evaluate(() => {
    const o = window.__VR_PANELS__?.objects.find(
      (x) => x.userData.holoPanel?.id === 'holo:menu-help'
    );
    if (!o) return null;
    const p = o.getWorldPosition(new o.position.constructor());
    return { x: p.x, y: p.y, z: p.z };
  });
  if (helpAt) await click(helpAt);
  check(
    'a mouse click on Menu › Help toggles the controls help',
    (await page.evaluate(() => window.__VR_CONTROLS__?.help)) === !helpBefore
  );
  await shot('0d-menu-help-clicked');
  const m3 = await menu();
  if (m3) await click(m3.button);
  check('a mouse click closes the menu', (await menu())?.open === false);

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
  await shot('3-fridge-outlined');

  // 3D extraction (VS-T18–T22): every press below is a real controller shot at the panel.
  const extract = () => page.evaluate(() => window.__VR_EXTRACT__ ?? null);
  const lab = () => page.evaluate(() => window.__VR_LAB__ ?? null);
  const panelAt = (id) =>
    page.evaluate((pid) => {
      const reg = window.__VR_PANELS__;
      const o = reg?.objects.find((x) =>
        typeof pid === 'string' && pid.endsWith('*')
          ? x.userData.holoPanel?.id.startsWith(pid.slice(0, -1))
          : x.userData.holoPanel?.id === pid
      );
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      const p = o.getWorldPosition(new o.position.constructor());
      return { x: p.x, y: p.y, z: p.z };
    }, id);
  const press = async (id) => {
    const at = await panelAt(id);
    if (!at) return false;
    await fire('controller-right', at, { x: 0.12, y: 1.45, z: -0.05 });
    return true;
  };
  const waitFor = async (fn, ms = 20000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if (await fn()) return true;
      await sleep(400);
    }
    return false;
  };
  // The shot only started the analysis: nothing is asked until the fridge itself is shot.
  check('the analysis alone asks nothing (no auto-selection)', (await extract())?.stage === 'idle');
  await fire('controller-right', fridge, { x: 0.15, y: 1.45, z: -0.15 });
  check('the shot fridge asks « Extract to 3D? »', (await extract())?.stage === 'confirm');
  await shot('3b-extract-dialog');
  await press('holo:extract-yes');
  check(
    '« Extract in 3D » opens the 3D studio with the generation column on the right',
    await waitFor(async () =>
      page.evaluate(
        () =>
          window.__VR_CONTROLS__?.shown('xr-studio-room') === 1 &&
          window.__VR_CONTROLS__?.shown('xr-studio-generation') === 1
      )
    )
  );
  check(
    '« Extract in 3D » draws the 2D views (main + 4 faces), shown as slides',
    await waitFor(async () => {
      const x = await extract();
      return x?.stage === 'views' && x.slides.length === 5 && x.canBuild;
    }, 240000)
  );
  await shot('3c-views-carousel');
  await press('holo:views-next');
  await sleep(800);
  await shot('3d-views-next-face');

  // Per-view AI chat (VS-T27): look left at it, open the holo keys, type, send, the bot answers.
  const chatAt = await panelAt('holo:chat-keyboard');
  check('the views chat sits beside the carousel', !!chatAt);
  if (chatAt) {
    await rc('look_at', { device: 'headset', target: chatAt });
    await sleep(800);
    await shot('3e-chat');
    // Aimed from the left hand side: the floating « Leave the studio » sits right of the gaze.
    const pressLeft = async (id) => {
      const at = await panelAt(id);
      if (!at) return false;
      await fire('controller-right', at, { x: -0.25, y: 1.4, z: -0.05 });
      return true;
    };
    await pressLeft('holo:chat-keyboard');
    await sleep(600);
    check('« Keys » opens the holo keyboard', !!(await panelAt('holo:chat-keys')));
    await pressLeft('holo:chat-keys');
    await pressLeft('holo:chat-keys');
    await shot('3f-chat-typed');
    check('typing enables « Send »', await pressLeft('holo:chat-send'));
    check(
      '« Send » logs the request and redraws that face; the bot answers once drawn',
      await waitFor(async () => {
        const c = (await extract())?.chats?.side ?? [];
        return c[0] === 'prompt' && c.at(-1) === 'done';
      }, 240000)
    );
    await sleep(800);
    await shot('3g-chat-answered');
    const build = await panelAt('holo:views-build');
    if (build) await rc('look_at', { device: 'headset', target: build });
    await sleep(600);
  }
  await press('holo:views-build');
  await sleep(450);
  await shot('3d1-desks-turning'); // VS-T31: the 2D desk slides left, the 3D desk comes from the right
  await sleep(1050);
  await shot('3d2-studio-building');
  check(
    '« Validate & build » builds the model, then the lab opens by itself',
    await waitFor(async () => (await extract())?.stage === 'lab', 240000)
  );
  await waitFor(async () => ((await lab())?.names.length ?? 0) > 0, 15000);
  await shot('3f-lab');
  await press('holo:lab-piece-*');
  const picked = (await lab())?.selected;
  await press('holo:lab-hide');
  check(
    'in the lab a piece picked in the list is hidden live',
    !!picked && ((await lab())?.hidden ?? []).includes(picked)
  );
  await shot('3g-lab-piece-hidden');
  await press('holo:lab-show-all');

  // VS-T31: « 2D lab » turns the desks back to the views, « 3D lab » turns them to the lab again.
  const toViewsAt = await panelAt('holo:lab-to-views');
  if (toViewsAt) await rc('look_at', { device: 'headset', target: toViewsAt });
  await sleep(500);
  await shot('3g0-lab-to-views-button');
  await press('holo:lab-to-views');
  await sleep(500);
  await shot('3g0b-desks-turning-back');
  check('« 2D lab » goes back to the views, the model kept', (await extract())?.stage === 'views');
  await sleep(1200);
  const toLabAt = await panelAt('holo:studio-to-lab');
  check('the 2D lab offers « 3D lab » once the model exists', !!toLabAt);
  if (toLabAt) await rc('look_at', { device: 'headset', target: toLabAt });
  await sleep(500);
  await shot('3g0c-views-to-lab-button');
  await press('holo:studio-to-lab');
  check('« 3D lab » turns back to the lab', (await extract())?.stage === 'lab');
  await sleep(1500);
  await waitFor(async () => ((await lab())?.names.length ?? 0) > 0, 15000);

  // Village hologram (VS-T28): place the edited model on the table, add it to the simulation.
  const village = () => page.evaluate(() => window.__VR_VILLAGE__ ?? null);
  const tableAt = await panelAt('holo:village-map');
  check('the lab shows the village hologram table', !!tableAt);
  if (tableAt) {
    await rc('look_at', { device: 'headset', target: tableAt });
    await sleep(800);
    const fromLeft = { x: -0.1, y: 1.4, z: -0.05 };
    const at = (id) => panelAt(id).then((p) => p && fire('controller-right', p, fromLeft));
    await at('holo:village-map');
    check('a shot on the table places the object', !!(await village())?.position);
    // VS-T29: status and buttons stand above the table's far edge, not under its near edge.
    const insertAt = await panelAt('holo:village-insert');
    check(
      'the table buttons sit above the table (readable, not under it)',
      !!insertAt && insertAt.y > tableAt.y + 0.15,
      insertAt ? `button ${(insertAt.y - tableAt.y).toFixed(2)} m above the table centre` : ''
    );
    await shot('3g2-village-placed');
    await at('holo:village-insert');
    check(
      '« Add to the simulation » puts it in the village; « Go to the simulation » is offered',
      !!(await village())?.inSimulation && !!(await panelAt('holo:village-simulation'))
    );
    await shot('3g3-village-added');
    const exitAt = await panelAt('holo:lab-exit');
    if (exitAt) await rc('look_at', { device: 'headset', target: exitAt });
    await sleep(600);
  }
  await press('holo:lab-exit');
  check('leaving the lab ends the extraction', (await extract())?.stage === 'idle');
  await sleep(1500);
  await shot('3h-fridge-miniature');

  const dismissAt = await panelAt('holo:mini-dismiss-*');
  check('the new miniature has its card with « Put away »', !!dismissAt);
  await fire('controller-right', MINI_0, { x: 0.25, y: 1.3, z: 0 });
  // The notice lasts 4.5 s: read it right after the event (the screenshots take seconds).
  check('connecting it shows a notice (no telemetry HUD)', (await shownN('xr-event-toast')) > 0);
  await shot('4-fridge-connected');
  check('one scan only (no double fire)', scans === 1);
  const pressedAway = await press('holo:mini-dismiss-*');
  await sleep(500);
  await shot('4b-fridge-put-away');
  check(
    '« Put away » removes the miniature',
    pressedAway && !(await panelAt('holo:mini-dismiss-*'))
  );

  await rc('set_input_mode', { mode: 'hand' });
  await fire('hand-right', panoPoint(...LAMP_UV, uF, 3), { x: 0.2, y: 1.35, z: -0.1 });
  await shot('5-hand-lamp');
  check('a hand pinch at the lamp asks to extract it', (await extract())?.stage === 'confirm');
  // VS-T26: after scans and a mode switch, hands are the real model, never the joint spheres.
  const hands = await page.evaluate(() => window.__VR_CONTROLS__?.hands?.());
  check(
    'hands show the real hand model, not the joint spheres',
    !!hands?.length && hands.every((h) => h.joints === 0 || (h.real && !h.spheres))
  );
  await rc('set_input_mode', { mode: 'controller' });
  await sleep(600);
  // A mouse click on « Cancel », through the DevUI overlay (VS-T24 regression).
  const no = await panelAt('holo:extract-no');
  if (no) await click(no);
  check('a mouse click on « Cancel » closes the question', (await extract())?.stage === 'idle');

  // Walking after the scan: outlines stay on the objects (laid on the photo, which moves with
  // the walk), and aiming where the lamp is drawn now still finds the lamp.
  await page.keyboard.down('ArrowRight');
  await waitFor(async () => {
    const g = (await tour())?.ground;
    return !!g && Math.hypot(g.offset[0], g.offset[2]) > 0.4;
  }, 8000);
  await page.keyboard.up('ArrowRight');
  await sleep(600);
  const walked = await tour();
  const off = walked?.ground?.offset ?? [0, 0, 0];
  // The vision model names the object over the counter « lamp », « pendant light » or « range hood ».
  const lampT = walked?.targets.find((x) => /lamp|light|hood/i.test(x.label));
  if (!lampT)
    console.log(`  no lamp among: ${(walked?.targets ?? []).map((x) => x.label).join(' | ')}`);
  check(
    'walking after the scan moves the viewer off the photo spot',
    Math.hypot(off[0], off[2]) > 0.3
  );
  if (lampT) {
    const drawn = { x: lampT.at[0] - off[0], y: lampT.at[1] - off[1], z: lampT.at[2] - off[2] };
    await rc('look_at', { device: 'headset', target: drawn });
    await rc('set_transform', {
      device: 'controller-right',
      position: { x: 0.15, y: 1.4, z: -0.1 },
    });
    await rc('look_at', { device: 'controller-right', target: drawn });
    await sleep(1200);
    await shot('5b-walked-lamp-outline');
    check(
      'after walking, the lamp outline stays on the lamp (aiming at it hovers it)',
      (await tour())?.hovered === lampT.id
    );
  } else check('after walking, the lamp outline stays on the lamp (aiming at it hovers it)', false);

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
    if (!arrow) {
      console.log(`  no arrow to ${to} in ${(await tour())?.room}`);
      return false;
    }
    const at = { x: arrow.position[0], y: arrow.position[1], z: arrow.position[2] };
    await rc('look_at', { device: 'headset', target: { x: at.x, y: 1.2, z: at.z } });
    await sleep(400);
    await fire('controller-right', at, { x: 0.2, y: 1.2, z: -0.1 });
    // Outdoor arrows are 3 m away; headless frames are slow (delta capped at 0.1 s per frame).
    const ok = await waitRoom(to, 20000);
    await sleep(400);
    if (!ok) {
      const now = await tour();
      console.log(
        `  walk to ${to} failed: in ${now?.room}, arrows ${JSON.stringify(now?.arrows.map((a) => [a.to, a.position]))}, hovered ${now?.hovered}, offset ${JSON.stringify(now?.ground?.offset)}, extract ${(await extract())?.stage}, scans ${scans}`
      );
    }
    return ok;
  };
  // Left hand down by the hip: its wrist button must not sit across the right hand's ray.
  await rc('set_transform', {
    device: 'controller-left',
    position: { x: -0.25, y: 0.85, z: 0.05 },
  });
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
