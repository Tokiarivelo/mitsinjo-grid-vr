import 'server-only';

import sharp from 'sharp';
import {
  HOUSE_MATERIALS,
  type HouseFinish,
  type HouseMaterial,
  type HousePlan,
  type HouseWall,
  type HouseSwatch,
} from '@/lib/house-plan';
import type { PerceptionClient } from '../client';
import type { HouseReadResult } from '../schemas';
import type { AlignedViews, GridView, ViewFrame, ViewName } from '../recon/views';
import { cleanSwatch, fitHouse, housePatches, type HousePatch } from './house-fit';
import { buildHouseQuestion, type HouseReading } from './house-prompt';
import {
  HOUSE_TOOL_SPECS,
  HOUSE_TOOLS_ALWAYS,
  mergeToolAnswers,
  parseBrief,
  PILOT_JSON_SCHEMA,
  PILOT_SYSTEM_PROMPT,
  pilotQuestion,
  toolQuestion,
  type HouseBrief,
  type HouseTool,
} from './house-tools';

/**
 * The house specialist (PQ-T72), the part that talks to the model: each validated drawing cut to
 * the house as drawn (never the photo), one Spark reading of them all, then `fitHouse`. Never
 * throws: null = no plan, the model keeps its drawn hull.
 */

/** Longest side of a drawing sent to the specialist: enough to see the window bars. */
export const HOUSE_IMAGE_SIDE = 768;
/** JPEG quality of those drawings (flat colours: a fifth of the PNG bytes, bars still sharp). */
export const HOUSE_IMAGE_QUALITY = 88;

export type ReadHouse = (
  imageUrl: string,
  question: string,
  references: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<Pick<HouseReadResult, 'reading'>>;

/**
 * One call of the piloted house reading (PQ-T73): the pilot or a part specialist, its own system
 * prompt and schema, the same images. Answers the raw content; null when the call fails.
 */
export type AskHouseTool = (
  tool: HouseTool | 'pilot',
  system: string,
  schema: { name: string; schema: object },
  imageUrl: string,
  question: string,
  references: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<string | null>;

/** The client's tool call as an `AskHouseTool` (a mock answer counts as none). */
export const houseToolAsk =
  (p: Pick<PerceptionClient, 'askHouseTool'>): AskHouseTool =>
  async (...args) => {
    const r = await p.askHouseTool(...args);
    return r.source === 'meta' ? r.content : null;
  };

/**
 * Longest wait for one pilot or specialist call (PQ-T73). The stream has no timer of its own
 * (`longFetch`): a call the provider leaves hanging would hold the whole house; the slowest
 * specialist seen answered in ~6 min. Past this, its answer counts as none.
 */
export const HOUSE_TOOL_TIMEOUT_MS = 12 * 60_000;

/**
 * The piloted reading (PQ-T73): the pilot's brief, then the specialists it calls, in parallel,
 * merged. Null when the massing specialist gives nothing usable (the caller falls back).
 */
export async function readHouseParts(
  rawAsk: AskHouseTool,
  label: string,
  order: ReadonlyArray<'front' | 'right' | 'back' | 'left' | 'top'>,
  images: ReadonlyArray<string>,
  signal?: AbortSignal,
  timeoutMs = HOUSE_TOOL_TIMEOUT_MS
): Promise<{ reading: HouseReading | null; brief: HouseBrief | null }> {
  // Each call ends with the request or at its own deadline, whichever comes first.
  const ask: AskHouseTool = (tool, system, schema, img, question, refs, outer) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const both = outer ? AbortSignal.any([outer, deadline]) : deadline;
    return new Promise<string | null>((resolve, reject) => {
      const stop = () =>
        reject(new Error(`${tool}: no answer in ${Math.round(timeoutMs / 1000)} s`));
      if (both.aborted) return stop();
      both.addEventListener('abort', stop, { once: true });
      rawAsk(tool, system, schema, img, question, refs, both).then(resolve, reject);
    });
  };
  const tag = `[vision] house pilot for "${label}"`;
  const [main, ...refs] = images;
  if (!main) return { reading: null, brief: null };
  const safe = async (p: Promise<string | null>) => {
    try {
      return await p;
    } catch (err) {
      console.warn(`${tag}: a call failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  };
  const briefText = await safe(
    ask(
      'pilot',
      PILOT_SYSTEM_PROMPT,
      PILOT_JSON_SCHEMA,
      main,
      pilotQuestion(label, order),
      refs,
      signal
    )
  );
  const brief = briefText ? parseBrief(briefText) : null;
  const tools: HouseTool[] = brief
    ? brief.calls.map((c) => c.tool)
    : [...HOUSE_TOOLS_ALWAYS, 'structure'];
  console.info(
    `${tag}: ${
      brief
        ? `${brief.type}, parts ${
            Object.keys(brief.parts)
              .filter((k) => brief.parts[k as keyof typeof brief.parts])
              .join(', ') || 'none'
          }`
        : 'no brief'
    } → ${tools.join(', ')}`
  );
  const answers = await Promise.all(
    tools.map(async (tool) => {
      const spec = HOUSE_TOOL_SPECS[tool];
      return [
        tool,
        await safe(
          ask(
            tool,
            spec.system,
            spec.schema,
            main,
            toolQuestion(tool, label, order, brief),
            refs,
            signal
          )
        ),
      ] as const;
    })
  );
  const byTool: Partial<Record<HouseTool, string | null>> = Object.fromEntries(answers);
  // The massing carries the house: a call cut by the network is asked once more, alone.
  if (!mergeToolAnswers({ massing: byTool.massing ?? null }, brief) && !signal?.aborted) {
    console.info(`${tag}: massing unusable, asked again`);
    const spec = HOUSE_TOOL_SPECS.massing;
    byTool.massing = await safe(
      ask(
        'massing',
        spec.system,
        spec.schema,
        main,
        toolQuestion('massing', label, order, brief),
        refs,
        signal
      )
    );
  }
  const reading = mergeToolAnswers(byTool, brief);
  console.info(
    `${tag}: ${reading ? `${reading.volumes.length} volumes, ${reading.openings.length} openings, ${reading.piers?.length ?? 0} piers, ${reading.chimneys.length} chimneys, finishes ${reading.finishes?.map((f) => f.finish).join(', ') || 'none'}` : 'no usable massing'}`
  );
  return { reading, brief };
}

/** A drawing cut to its object box, as drawn (not mirrored), JPEG data URL; null when it fails. */
export async function cropToObject(png: Buffer, frame: ViewFrame): Promise<string | null> {
  try {
    const flat = sharp(png, { failOn: 'none' }).flatten({ background: '#ffffff' });
    const meta = await flat.metadata();
    if (!meta.width || !meta.height) return null;
    const [kx, ky] = [meta.width / frame.cols, meta.height / frame.rows];
    const left = Math.max(0, Math.floor(frame.box.x0 * kx));
    const top = Math.max(0, Math.floor(frame.box.y0 * ky));
    const width = Math.min(meta.width - left, Math.ceil((frame.box.x1 - frame.box.x0 + 1) * kx));
    const height = Math.min(meta.height - top, Math.ceil((frame.box.y1 - frame.box.y0 + 1) * ky));
    if (width < 4 || height < 4) return null;
    const out = await flat
      .extract({ left, top, width, height })
      .resize(HOUSE_IMAGE_SIDE, HOUSE_IMAGE_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: HOUSE_IMAGE_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Longest side of a swatch image (a square repeated over a wall: sharp, small). */
export const HOUSE_SWATCH_SIDE = 256;

/**
 * A patch of a drawing (canonical shares, y up, on the view `frame` puts on its drawing) cut at the
 * drawing's own resolution, JPEG data URL; null when it fails.
 */
export async function cropPatch(
  png: Buffer,
  frame: ViewFrame,
  [s0, s1, y0, y1]: HousePatch['box']
): Promise<string | null> {
  try {
    const flat = sharp(png, { failOn: 'none' }).flatten({ background: '#ffffff' });
    const meta = await flat.metadata();
    if (!meta.width || !meta.height) return null;
    const [kx, ky] = [meta.width / frame.cols, meta.height / frame.rows];
    const bw = frame.box.x1 - frame.box.x0 + 1;
    const bh = frame.box.y1 - frame.box.y0 + 1;
    // Canonical → drawing: a mirrored view reads the drawing backwards; rows run down.
    const [u0, u1] = frame.mirrored ? [1 - s1, 1 - s0] : [s0, s1];
    const left = Math.max(0, Math.round((frame.box.x0 + u0 * bw) * kx));
    const top = Math.max(0, Math.round((frame.box.y0 + (1 - y1) * bh) * ky));
    const width = Math.min(meta.width - left, Math.round((u1 - u0) * bw * kx));
    const height = Math.min(meta.height - top, Math.round((y1 - y0) * bh * ky));
    if (width < 4 || height < 4) return null;
    const raw = await flat
      .extract({ left, top, width, height })
      .resize(HOUSE_SWATCH_SIDE, HOUSE_SWATCH_SIDE, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = raw.info;
    const clean = cleanSwatch(
      new Uint8Array(raw.data.buffer, raw.data.byteOffset, w * h * 3),
      w,
      h
    );
    const out = await sharp(Buffer.from(clean), { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: HOUSE_IMAGE_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Columns of the sharp grid a swatch is looked for on (the reading grid misses thin posts). */
export const SWATCH_GRID_COLS = 480;
/** A cell this far (rgb) from the sheet's colour is drawn. */
const PAPER_DISTANCE = 30;

/**
 * A drawing's object box as a canonical grid view at `cols` columns (mirrored back when the view
 * is), for the swatch search; null when it fails.
 */
export async function sharpView(
  png: Buffer,
  frame: ViewFrame,
  cols = SWATCH_GRID_COLS
): Promise<GridView | null> {
  try {
    const flat = sharp(png, { failOn: 'none' }).flatten({ background: '#ffffff' });
    const meta = await flat.metadata();
    if (!meta.width || !meta.height) return null;
    const [kx, ky] = [meta.width / frame.cols, meta.height / frame.rows];
    const left = Math.max(0, Math.floor(frame.box.x0 * kx));
    const top = Math.max(0, Math.floor(frame.box.y0 * ky));
    const width = Math.min(meta.width - left, Math.ceil((frame.box.x1 - frame.box.x0 + 1) * kx));
    const height = Math.min(meta.height - top, Math.ceil((frame.box.y1 - frame.box.y0 + 1) * ky));
    if (width < 8 || height < 8) return null;
    const rows = Math.max(1, Math.round((cols * height) / width));
    let img = flat.extract({ left, top, width, height }).resize(cols, rows, { fit: 'fill' });
    if (frame.mirrored) img = img.flop();
    const { data } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgb = new Uint8Array(data.buffer, data.byteOffset, cols * rows * 3);
    const mask = new Uint8Array(cols * rows);
    const [pr, pg, pb] = frame.paper;
    for (let i = 0; i < mask.length; i++) {
      const d = Math.hypot(rgb[i * 3]! - pr, rgb[i * 3 + 1]! - pg, rgb[i * 3 + 2]! - pb);
      mask[i] = d > PAPER_DISTANCE ? 1 : 0;
    }
    return { cols, rows, rgb, mask };
  } catch {
    return null;
  }
}

/** The plan's swatches cut on the drawings (`housePatches` says where). */
async function withSwatches(
  plan: HousePlan,
  views: Parameters<typeof housePatches>[1],
  sources: Partial<Record<HousePatch['view'], { png: Buffer; frame: ViewFrame; view: GridView }>>,
  finishes: Parameters<typeof housePatches>[3] = [],
  mirrored: Parameters<typeof housePatches>[4] = {}
): Promise<HousePlan> {
  // Looked for on sharp grids of the drawings, the reading grids standing in when that fails.
  const sharpOf = async (v: HousePatch['view']) => {
    const src = sources[v];
    return src ? ((await sharpView(src.png, src.frame)) ?? src.view) : null;
  };
  const front = await sharpOf('front');
  const top = await sharpOf('top');
  // PQ-T73: the sides and the back are sharp too when a finish is sampled on them.
  const sharp: Partial<Record<HouseWall, GridView>> = {};
  for (const v of ['right', 'back', 'left'] as const)
    if (finishes.some((f) => f.view === v)) {
      const g = await sharpOf(v);
      if (g) sharp[v] = g;
    }
  const swatches: Partial<Record<HouseFinish, HouseSwatch>> = {};
  const patches = housePatches(
    plan,
    { ...views, ...sharp, ...(front ? { front } : {}) },
    top,
    finishes,
    mirrored
  );
  for (const [slot, patch] of Object.entries(patches)) {
    const src = sources[patch.view];
    if (!src) continue;
    const image = await cropPatch(src.png, src.frame, patch.box);
    if (image) swatches[slot as HouseFinish] = { image, size: patch.box[1] - patch.box[0] };
  }
  return Object.keys(swatches).length ? { ...plan, look: { ...plan.look, swatches } } : plan;
}

const asHouseMaterial = (m: string | undefined): HouseMaterial | undefined =>
  (HOUSE_MATERIALS as readonly string[]).includes(m ?? '') ? (m as HouseMaterial) : undefined;

export interface HouseSpecialistInput {
  label: string;
  pngs: Partial<Record<ViewName, Buffer>>;
  aligned: AlignedViews;
  top?: { png: Buffer; view: GridView; frame: ViewFrame } | null;
  /** Materials of the walls and the roof read on the colour classes. */
  fallback?: { wall?: string; roof?: string };
  signal?: AbortSignal;
  /** Called with the raw reading (captures, evals). */
  onReading?: (reading: unknown) => void;
  /** The piloted part specialists (PQ-T73); the single reading `read` is the fallback. */
  ask?: AskHouseTool;
}

/** The house plan read on the drawings; null when the specialist cannot read them. */
export async function readHousePlan(
  read: ReadHouse,
  { label, pngs, aligned, top, fallback = {}, signal, onReading, ask }: HouseSpecialistInput
): Promise<HousePlan | null> {
  const tag = `[vision] house specialist for "${label}"`;
  try {
    const order: Array<ViewName | 'top'> = [];
    const images: string[] = [];
    for (const view of ['front', 'right', 'back', 'left'] as const) {
      const png = pngs[view];
      // The right frame is the left drawing's when the right one is missing.
      const frame = view === 'right' && aligned.rightFromLeft ? undefined : aligned.frames[view];
      if (!png || !frame) continue;
      const url = await cropToObject(png, frame);
      if (url) {
        order.push(view);
        images.push(url);
      }
    }
    if (top) {
      const url = await cropToObject(top.png, top.frame);
      if (url) {
        order.push('top');
        images.push(url);
      }
    }
    if (order[0] !== 'front') {
      console.info(`${tag}: no front drawing, skipped`);
      return null;
    }
    const piloted = ask ? await readHouseParts(ask, label, order, images, signal) : null;
    const answer = piloted?.reading
      ? { reading: piloted.reading }
      : await read(images[0]!, buildHouseQuestion(label, order), images.slice(1), signal);
    onReading?.(answer.reading);
    if (!answer.reading) return null;
    const views = {
      front: aligned.views.front,
      ...(aligned.rightFromLeft ? {} : { right: aligned.views.right }),
      ...(aligned.views.back ? { back: aligned.views.back } : {}),
      ...(aligned.views.left ? { left: aligned.views.left } : {}),
    };
    const mirrored = Object.fromEntries(
      (['front', 'right', 'back', 'left'] as const).flatMap((v) =>
        aligned.frames[v] ? [[v, aligned.frames[v]!.mirrored]] : []
      )
    );
    const wall = asHouseMaterial(fallback.wall);
    const roof = asHouseMaterial(fallback.roof);
    const plan = fitHouse({
      reading: answer.reading,
      views,
      mirrored,
      top: top?.view ?? null,
      fallback: { ...(wall ? { wall } : {}), ...(roof ? { roof } : {}) },
    });
    const front = pngs.front && aligned.frames.front;
    const sampled = plan
      ? await withSwatches(
          plan,
          views,
          {
            ...(front
              ? { front: { png: pngs.front!, frame: front, view: aligned.views.front } }
              : {}),
            ...Object.fromEntries(
              (['right', 'back', 'left'] as const).flatMap((v) => {
                const png = pngs[v];
                const frame =
                  v === 'right' && aligned.rightFromLeft ? undefined : aligned.frames[v];
                const view = aligned.views[v];
                return png && frame && view ? [[v, { png, frame, view }]] : [];
              })
            ),
            ...(top ? { top } : {}),
          },
          answer.reading.finishes ?? [],
          mirrored
        )
      : null;
    console.info(
      sampled
        ? `${tag}: ${sampled.volumes.length} volumes (${sampled.volumes.map((v) => `${v.kind} ${v.roof}`).join(', ')}), ${sampled.openings.length} openings, ${sampled.chimneys.length} chimneys, ${sampled.piers?.length ?? 0} piers, swatches: ${Object.keys(sampled.look.swatches ?? {}).join(', ') || 'none'}`
        : `${tag}: the reading does not fit the drawings`
    );
    return sampled;
  } catch (err) {
    console.warn(`${tag} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
