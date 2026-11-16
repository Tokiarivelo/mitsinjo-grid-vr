import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
/**
 * Inserted objects in /simulation (VS-T35): seeds four real captured objects (fridge wired to the
 * dispatcher, TV, fan, pump) next to the village, then screenshots the 3D view on screen and in
 * immersion. Prints each object's scene scale. Dev server must run (`window.__SIM_STORES__`).
 * Usage: node scripts/placed-shot.mjs <url> <fixtures dir> <out dir> [tag]
 */
const [, , base, fixDir, out, tag = 'placed'] = process.argv;
const pick = (n) => JSON.parse(readFileSync(`${fixDir}/${n}.capture.json`, 'utf8'));
const items = [
  ['refrigerator', 'fridge', 'Réfrigérateur', [4, 9], 'ems'],
  ['TV', 'tv', 'Télévision', [6, 9], 'branch'],
  ['fan', 'fan', 'Ventilateur', [8, 9], 'branch'],
  ['pump', 'water_pump', 'Pompe', [2, 9], 'branch'],
].map(([fix, category, name, [x, z], mode]) => {
  const c = pick(fix);
  return { fix, category, name, x, z, mode, recipe: c.recipe, archetype: c.kit?.archetype };
});
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/simulation`, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__SIM_STORES__, null, { timeout: 120000 });
const res = await page.evaluate((items) => {
  const { sim, placed } = window.__SIM_STORES__;
  const s = sim.getState();
  const cats = items.map((i) => i.category);
  const appliances = items.map((i, k) => ({
    id: `shot-${i.fix}`,
    name: i.name,
    category: i.category,
    sector: 'households',
    watts: { fridge: 100, tv: 60, fan: 50, water_pump: 400 }[i.category],
    quantity: 1,
    position: { x: i.x, z: i.z },
  }));
  for (const i of items)
    placed.getState().upsert({
      applianceId: `shot-${i.fix}`,
      recipe: i.recipe,
      archetype: i.archetype,
      connectionMode: i.mode,
    });
  try {
    s.patchInput({ appliances });
    s.run();
  } catch (e) {
    return String(e);
  }
  return { status: sim.getState().status, n: sim.getState().input.appliances?.length, cats };
}, items);
console.log(JSON.stringify(res));
// Software GL: give the scene time to draw the new models (no frame counter on screen).
const settle = () =>
  page
    .waitForFunction(() => document.readyState === 'complete')
    .then(() => page.waitForTimeout(8000));
await settle();
await page.screenshot({ path: `${out}/${tag}-web.png`, timeout: 180000 });
// Immersion: the « Immersion » camera preset (labels in 3D, no HTML badges).
const immersion = page.getByRole('button', { name: /immersion/i }).first();
if (await immersion.isVisible().catch(() => false)) {
  await immersion.click();
  await settle();
  await page.screenshot({ path: `${out}/${tag}-immersion.png`, timeout: 180000 });
}
const scale = await page.evaluate(() =>
  Object.values(window.__SIM_STORES__.placed.getState().models).map((m) => [
    m.applianceId,
    m.scale,
    m.archetype,
  ])
);
console.log(JSON.stringify(scale));
await browser.close();
