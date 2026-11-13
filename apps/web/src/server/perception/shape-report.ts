import 'server-only';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { KitArchetype } from '@/lib/object-kit';
import type { ObjectRecipe, PartMask } from '@/lib/object-shape';
import type { RealCase } from './__fixtures__/shape';
import { degenerateView, type ViewCheck } from './detail-score';
import { renderFlat, THREE_QUARTER, type FlatRender } from './flat-render';
import type { ModelScore, RgbGrid } from './model-score';
import { checkConstraints, notBuilt } from './object-graph';
import { presentAnatomy } from './fusion';
import { readCapture, rescoreCapture } from './shape-capture';

/**
 * Shape report (PR-0.3) for the quality loop (`/shape-loop`): a Markdown table of the scores with the worst
 * object and metric, and a contact sheet (photo box | flat render at the photo view | ¾ render).
 * Dev tooling, not shown in the app: its text is not translated.
 */

/** Stop criteria of the plan (`PV-shape-realism.md`). */

export const STOP = { iou: 0.85, edgeF1: 0.6, deltaE: 8 } as const;

/**
 * Detail gates (PQ-T6), checked when SAM part masks exist. Interior edge F1 and part ΔE come from the
 * real baseline of 2026-11-10 by the rule « a value at least half of the real objects miss today »
 * (interior F1: 6 of 12 under 0.12; part ΔE: 2 of 3 over 7, few masks yet). Recall and precision: plan values.
 */
export const STOP_DETAIL = {
  partRecall: 0.8,
  partPrecision: 0.8,
  interiorEdgeF1: 0.12,
  partDeltaE: 7,
} as const;

export interface ReportRow {
  name: string;
  score: ModelScore;
  parts: number;
  /** Whole shape math, ms; absent on replayed real captures (no shape math re-run). */
  ms?: number;
  /** Coherence violations of the shipped recipe (PR-2.14); always 0 when clean. */
  violations: number;
  /** Part dimension statuses, non-zero counts (PR-2.15). */
  statusCounts: { measured: number; estimated: number; inferred: number; unknown: number };
  /** Model seen at 0° / 45° / 90° (PQ-T36); absent when not checked. */
  view?: ViewCheck;
  /** Parts SAM saw that the model does not build (PQ-T37); absent without part masks. */
  notBuilt?: string[];
}

/** Compact counts cell: `M1 I11` (zeros omitted). */
function statusCell(c: ReportRow['statusCounts']): string {
  return (
    (
      [
        ['M', c.measured],
        ['E', c.estimated],
        ['I', c.inferred],
        ['U', c.unknown],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}${n}`)
      .join(' ') || '—'
  );
}

type Metric = 'iou' | 'edgeF1' | 'deltaE';

/** How far each metric is from its stop criterion, as a share of it (> 0 = below target). */
export function metricGaps(s: ModelScore): Record<Metric, number> {
  return {
    iou: (STOP.iou - s.iou) / STOP.iou,
    edgeF1: (STOP.edgeF1 - s.edgeF1) / STOP.edgeF1,
    deltaE: (s.deltaE - STOP.deltaE) / STOP.deltaE,
  };
}

/** The metric farthest from its target (the one the loop fixes first). */
export function worstMetric(s: ModelScore): { metric: Metric; gap: number } {
  const gaps = metricGaps(s);
  const metric = (Object.keys(gaps) as Metric[]).reduce((a, b) => (gaps[b] > gaps[a] ? b : a));
  return { metric, gap: gaps[metric] };
}

/** Detail cells (PQ-T2): part recall, precision, interior edge F1, part ΔE with ✓ / ✗ against `STOP_DETAIL`, then the anatomy recall (PQ-T46, no gate yet); « — » when not measured. */
function detailCells(s: ModelScore): string {
  const d = s.detail ?? {};
  const g = STOP_DETAIL;
  const gated = (
    [
      [d.partRecall, (v: number) => v >= g.partRecall],
      [d.partPrecision, (v: number) => v >= g.partPrecision],
      [d.interiorEdgeF1, (v: number) => v >= g.interiorEdgeF1],
      [d.partDeltaE, (v: number) => v <= g.partDeltaE],
    ] as const
  )
    .map(([v, pass]) => (v === undefined ? '—' : `${v} ${ok(pass(v))}`))
    .join(' | ');
  return `${gated} | ${d.anatomyRecall === undefined ? '—' : d.anatomyRecall}`;
}

/** Worst height band (PQ-T36): `SSIM@band`, ✗ with the count when bands are blank. */
function bandCell(s: ModelScore): string {
  const d = s.detail;
  if (d?.bandSsim === undefined) return '—';
  const blank = d.blankBands ? ` ✗ ${d.blankBands} blank` : '';
  return `${d.bandSsim}@${d.worstBand}${blank}`;
}

/** Degenerate view (PQ-T36): ✓ with the side share, or ✗ thin / detached. */
function viewCell(v: ViewCheck | undefined): string {
  if (!v) return '—';
  if (v.fail === 'thin') return `✗ thin ${v.sideShare}`;
  if (v.fail === 'detached') return `✗ ${v.pieces45} pieces`;
  return `✓ ${v.sideShare}`;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ok = (pass: boolean) => (pass ? '✓' : '✗');

const HEADER = [
  '| Object | Score | IoU | Edge F1 | ΔE | Recall | Prec | Int F1 | Part ΔE | Ana | Band | Views | Not built | Parts | ms | Viol | Status | Worst |',
  '| ------ | ----- | --- | ------- | -- | ------ | ---- | ------ | ------- | --- | ---- | ----- | --------- | ----- | -- | ---- | ------ | ----- |',
];

/** One table: a row per object and the means. */
function scoreTable(rows: ReadonlyArray<ReportRow>): string[] {
  const lines = [...HEADER];
  for (const r of rows) {
    const s = r.score;
    const w = worstMetric(s);
    const ms = r.ms === undefined ? '—' : String(Math.round(r.ms));
    lines.push(
      `| ${r.name} | ${s.score} | ${s.iou} ${ok(s.iou >= STOP.iou)} | ${s.edgeF1} ${ok(s.edgeF1 >= STOP.edgeF1)} | ` +
        `${s.deltaE} ${ok(s.deltaE <= STOP.deltaE)} | ${detailCells(s)} | ${bandCell(s)} | ${viewCell(r.view)} | ${r.notBuilt === undefined ? '—' : r.notBuilt.join(', ') || '✓'} | ${r.parts} | ${ms} | ${r.violations} | ${statusCell(r.statusCounts)} | ${w.gap > 0 ? w.metric : '—'} |`
    );
  }
  const avg = (f: (s: ModelScore) => number) => mean(rows.map((r) => f(r.score)));
  const avgOpt = (f: (s: ModelScore) => number | undefined) => {
    const xs = rows.map((r) => f(r.score)).filter((v): v is number => v !== undefined);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '';
  };
  lines.push(
    `| **mean** | ${Math.round(avg((s) => s.score))} | ${avg((s) => s.iou).toFixed(2)} | ` +
      `${avg((s) => s.edgeF1).toFixed(2)} | ${avg((s) => s.deltaE).toFixed(1)} | | | | | ${avgOpt((s) => s.detail?.anatomyRecall)} | | | | | | | | |`,
    ''
  );
  return lines;
}

/** « Next » line: the lowest score and its worst metric. */
function nextLine(rows: ReadonlyArray<ReportRow>): string | null {
  const worst = rows.reduce<ReportRow | null>(
    (a, r) => (!a || r.score.score < a.score.score ? r : a),
    null
  );
  if (!worst) return null;
  const w = worstMetric(worst.score);
  return w.gap > 0
    ? `**Next:** ${worst.name} (score ${worst.score.score}) — ${w.metric} is ${Math.round(w.gap * 100)} % off target.`
    : `**Next:** every object meets the metric criteria; lowest score ${worst.name} (${worst.score.score}).`;
}

/** The real set in the report (PQ-T1): captured rows and the registered ids not captured on this machine. */
export interface RealSection {
  rows: ReportRow[];
  missing: string[];
  /** Captured but not scorable (no outline or no recipe in the capture). */
  unscored?: string[];
}

/**
 * The report page: the synthetic table, the « Real » table, and what the loop should look at next —
 * taken from the real rows once there are any (synthetic drawings say little about photos).
 */
export function reportMarkdown(rows: ReportRow[], date: string, real?: RealSection): string {
  const lines = [
    `# Shape report — ${date}`,
    '',
    `Stop criteria: IoU ≥ ${STOP.iou} · edge F1 ≥ ${STOP.edgeF1} · ΔE ≤ ${STOP.deltaE}. Sheet: \`contact-sheet.png\` (photo | flat | ¾); real rows also in \`turntable-sheet.png\` (photo | model 0° | 90° | 180° | 270°).`,
    `Detail (PQ-T6, weighted into the score when SAM part masks exist): recall ≥ ${STOP_DETAIL.partRecall} · precision ≥ ${STOP_DETAIL.partPrecision} · interior edge F1 ≥ ${STOP_DETAIL.interiorEdgeF1} · part ΔE ≤ ${STOP_DETAIL.partDeltaE}; « — » when not measured.`,
    'Ana (PQ-T46): share of the closed-list parts answered `present` the model builds (no gate yet).',
    'Band (PQ-T36): SSIM of the worst of 8 height bands inside the outline @ band (0 = top), blank bands ✗. Views: side ÷ front silhouette, ✗ thin (< 0.15) or detached at 45°. Not built (PQ-T37): SAM parts the model lacks, ✓ none.',
    '',
    '## Synthetic (drawn streets)',
    '',
    ...scoreTable(rows),
  ];
  if (real) {
    lines.push(
      `## Real (${real.rows.length} captured, ${real.missing.length} missing)`,
      '',
      ...(real.rows.length ? scoreTable(real.rows) : ['No real capture on this machine.', '']),
      ...(real.missing.length
        ? [`Missing (\`make shape-capture PHOTO=… ID=<id>\`): ${real.missing.join(', ')}.`, '']
        : []),
      ...(real.unscored?.length
        ? [`Not scorable (capture without outline or recipe): ${real.unscored.join(', ')}.`, '']
        : [])
    );
  }
  const next = nextLine(real?.rows.length ? real.rows : rows);
  if (next) lines.push(next);
  return lines.join('\n') + '\n';
}

/** Report row of a scored recipe: part count, statuses and coherence violations (PR-2.14, PR-2.15). */
export function reportRow(
  name: string,
  score: ModelScore,
  recipe: ObjectRecipe,
  archetype: KitArchetype,
  ms?: number,
  masks?: ReadonlyArray<PartMask>,
  /** Closed-list parts answered `present` (PQ-T46); their misses show without SAM masks. */
  anatomy?: ReadonlyArray<string>
): ReportRow {
  const statusCounts = { measured: 0, estimated: 0, inferred: 0, unknown: 0 };
  for (const p of recipe.parts) statusCounts[p.status ?? 'unknown'] += 1;
  return {
    name,
    score,
    parts: recipe.parts.length,
    ...(ms !== undefined ? { ms } : {}),
    violations: checkConstraints(archetype, recipe),
    statusCounts,
    view: degenerateView(recipe, archetype),
    ...(masks?.length || anatomy?.length
      ? { notBuilt: notBuilt(recipe, masks ?? [], [], anatomy ?? []) }
      : {}),
  };
}

/** Turntable angles (PQ-T54, universal pipeline §9.1): the model straight on at each quarter turn. */
export const TURNTABLE_YAWS = [0, 90, 180, 270] as const;

export interface TurntableRow {
  name: string;
  crop: RgbGrid;
  /** One render per `TURNTABLE_YAWS`, straight on (pitch 0) so faces read flat. */
  views: FlatRender[];
}

/** A captured real case, re-scored offline: its row and the images for the sheets. */
export interface RealScored {
  row: ReportRow;
  sheet: SheetRow;
  turntable: TurntableRow;
}

/**
 * The real set (PQ-T1): every registered id with a capture in `dir` is re-scored offline (no API, the
 * captured recipe on the captured crop); ids without files are listed as missing, never an error.
 */
export async function scoreRealSet(
  dir: string,
  cases: ReadonlyArray<RealCase>
): Promise<{ scored: RealScored[]; missing: string[]; unscored: string[] }> {
  const scored: RealScored[] = [];
  const missing: string[] = [];
  const unscored: string[] = [];
  for (const c of cases) {
    if (
      !existsSync(join(dir, `${c.id}.capture.json`)) ||
      !existsSync(join(dir, `${c.id}.crop.jpg`))
    ) {
      missing.push(c.id);
      continue;
    }
    const { capture } = await readCapture(dir, c.id);
    const s = await rescoreCapture(dir, c.id);
    if (!s || !capture.recipe) {
      unscored.push(c.id);
      continue;
    }
    const name = c.hard ? `${c.id} (${c.hard})` : c.id;
    const recipe = capture.recipe;
    scored.push({
      row: reportRow(
        name,
        s.score,
        capture.recipe,
        capture.kit.archetype,
        undefined,
        s.masks,
        presentAnatomy(capture.kit)
      ),
      sheet: {
        name: `${name} — ${s.score.score}`,
        crop: s.crop,
        flat: s.render,
        threeQuarter: renderFlat(capture.recipe, 1, 160, 120, THREE_QUARTER),
      },
      turntable: {
        name: `${name} — ${s.score.score}`,
        crop: s.crop,
        views: TURNTABLE_YAWS.map((deg) =>
          renderFlat(recipe, 1, 160, 120, { yaw: (deg * Math.PI) / 180, pitch: 0 })
        ),
      },
    });
  }
  return { scored, missing, unscored };
}

export interface SheetRow {
  name: string;
  crop: RgbGrid;
  flat: FlatRender;
  threeQuarter: FlatRender;
}

/** Tile height in the sheet (px); widths follow each image. */
export const SHEET_TILE = 160;
const LABEL = 24;
const GAP = 8;

/** Render background → white, so dark parts stay visible on the sheet. */
function onWhite(r: FlatRender): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.rgb);
  for (let i = 0; i < r.mask.data.length; i++) if (!r.mask.data[i]) out.fill(255, i * 3, i * 3 + 3);
  return out;
}

async function tile(rgb: ArrayLike<number>, cols: number, rows: number) {
  const width = Math.max(1, Math.round((SHEET_TILE * cols) / rows));
  const input = await sharp(Buffer.from(rgb as Uint8Array), {
    raw: { width: cols, height: rows, channels: 3 },
  })
    .resize({ width, height: SHEET_TILE, fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
  return { input, width };
}

const esc = (t: string) =>
  t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** One PNG: a row per object, photo box | flat render | ¾ render, name above. */
export async function contactSheet(rows: SheetRow[]): Promise<Buffer> {
  const built = await Promise.all(
    rows.map(async (r) => [
      await tile(r.crop.rgb, r.crop.cols, r.crop.rows),
      await tile(onWhite(r.flat), r.flat.mask.cols, r.flat.mask.rows),
      await tile(onWhite(r.threeQuarter), r.threeQuarter.mask.cols, r.threeQuarter.mask.rows),
    ])
  );
  const rowW = (ts: Array<{ width: number }>) => ts.reduce((a, t) => a + t.width + GAP, GAP);
  const width = Math.max(320, ...built.map(rowW));
  const height = rows.length * (LABEL + SHEET_TILE + GAP) + GAP;
  const composites: sharp.OverlayOptions[] = [];
  built.forEach((ts, i) => {
    const top = GAP + i * (LABEL + SHEET_TILE + GAP);
    composites.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><text x="${GAP}" y="17" font-family="sans-serif" font-size="14" fill="#222">${esc(rows[i]!.name)}</text></svg>`
      ),
      top,
      left: 0,
    });
    let left = GAP;
    for (const t of ts) {
      composites.push({ input: t.input, top: top + LABEL, left });
      left += t.width + GAP;
    }
  });
  return sharp({ create: { width, height, channels: 3, background: '#eeeeee' } })
    .composite(composites)
    .png()
    .toBuffer();
}

/** One PNG: a row per real object, photo | model 0° | 90° | 180° | 270° — naked faces show. */
export async function turntableSheet(rows: TurntableRow[]): Promise<Buffer> {
  const legend = `photo | model ${TURNTABLE_YAWS.map((d) => `${d}°`).join(' | ')}`;
  const built = await Promise.all(
    rows.map(async (r) => [
      await tile(r.crop.rgb, r.crop.cols, r.crop.rows),
      ...(await Promise.all(r.views.map((v) => tile(onWhite(v), v.mask.cols, v.mask.rows)))),
    ])
  );
  const rowW = (ts: Array<{ width: number }>) => ts.reduce((a, t) => a + t.width + GAP, GAP);
  const width = Math.max(320, ...built.map(rowW));
  const height = LABEL + rows.length * (LABEL + SHEET_TILE + GAP) + GAP;
  const composites: sharp.OverlayOptions[] = [
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><text x="${GAP}" y="17" font-family="sans-serif" font-size="14" fill="#222">${esc(legend)}</text></svg>`
      ),
      top: GAP,
      left: 0,
    },
  ];
  built.forEach((ts, i) => {
    const top = GAP + LABEL + i * (LABEL + SHEET_TILE + GAP);
    composites.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><text x="${GAP}" y="17" font-family="sans-serif" font-size="14" fill="#222">${esc(rows[i]!.name)}</text></svg>`
      ),
      top,
      left: 0,
    });
    let left = GAP;
    for (const t of ts) {
      composites.push({ input: t.input, top: top + LABEL, left });
      left += t.width + GAP;
    }
  });
  return sharp({ create: { width, height, channels: 3, background: '#eeeeee' } })
    .composite(composites)
    .png()
    .toBuffer();
}
