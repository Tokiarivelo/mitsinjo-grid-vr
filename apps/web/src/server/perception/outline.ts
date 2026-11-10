import type { PerceptionClient } from './client';
import type { ApplianceDetection, NormBox, PerceptionSource, SegmentResult } from './schemas';
import type { CropRect } from './shape-crop';
import { remapOutlineToPhoto } from './mask-outline';

/** Longest wait for one SAM call; past it the Muse box is kept. */
export const SEGMENT_TIMEOUT_MS = 8000;
/** Most SAM calls per photo (one per distinct label), to bound cost and latency. */
export const MAX_SEGMENT_CONCEPTS = 8;
/** Minimum box overlap (IoU) for a SAM instance to belong to a Muse detection. */
export const MATCH_MIN_IOU = 0.3;

/** Intersection over union of two image-fraction boxes (0–1). */
export function iou(a: NormBox, b: NormBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** SAM box (inclusive pixels) → image fractions; null without image size. */
export function samBoxToNorm(
  box: { x1: number; y1: number; x2: number; y2: number },
  width: number,
  height: number
): NormBox | null {
  if (width <= 0 || height <= 0) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(box.x1, box.x2) / width);
  const y1 = clamp(Math.min(box.y1, box.y2) / height);
  const x2 = clamp((Math.max(box.x1, box.x2) + 1) / width);
  const y2 = clamp((Math.max(box.y1, box.y2) + 1) / height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Label words → the SAM noun (EN or FR, singular or plural): SAM segments "car", not the
 * detection wording "mini vintage". Phrases first, then nouns; first match wins.
 */
const CONCEPT_NOUNS: ReadonlyArray<readonly [RegExp, string]> = [
  // « lamp » alone finds nothing on a drawn lamp post (SAM reads a table lamp): keep the phrase.
  [/street ?lamps?|street ?lights?|lamp ?posts?|lampposts?/, 'street lamp'],
  [/power plants?/, 'building'],
  [/solar panels?|panneaus? solaires?/, 'solar panel'],
  [/motorbikes?|motorcycles?|scooters?|bicycles?|\bmotos?\b|\bbikes?\b/, 'motorbike'],
  [/trucks?|lorr(y|ies)|pickups?|camions?/, 'truck'],
  [/minibus(es)?/, 'van'],
  [/\bvan(s)?\b/, 'van'],
  [/\bbus(es)?\b/, 'bus'],
  [/cars?|vehicles?|autos?|sedans?|hatchbacks?|vintage|cooper|suv|4x4|voitures?/, 'car'],
  [/\bcarts?\b|trailers?|remorques?/, 'cart'],
  [/cottages?|\bhuts?\b|houses?|homes?|villas?|maisons?|cases?/, 'house'],
  [/buildings?|shops?|schools?|magasins?|écoles?/, 'building'],
  [/\btrees?\b|palms?|pines?|arbres?/, 'tree'],
  [/bush(es)?|plants?|hedges?|flowers?/, 'bush'],
  [/lamps?|lanterns?|lampes?|lampadaires?/, 'lamp'],
  [/fridges?|refrigerators?|réfrigérateurs?|freezers?|congélateurs?/, 'fridge'],
  [/\btvs?\b|televisions?|télévisions?|monitors?|screens?|computers?/, 'tv'],
  [/\bfans?\b|ventilateurs?/, 'fan'],
  [/tanks?|barrels?/, 'tank'],
  [/poles?|antennas?|masts?|poteaux?/, 'pole'],
  [/persons?|women|\bmen\b|\bman\b|children|personnes?|hommes?|femmes?/, 'person'],
  [/pumps?|pompes?/, 'pump'],
];

/**
 * SAM text prompt for a detection: the first known object noun in its label, else the label
 * itself trimmed and lowercased (today's behaviour for unknown wordings).
 */
export function conceptOf(d: Pick<ApplianceDetection, 'label'>): string {
  const label = d.label.trim().toLowerCase();
  // The head noun ends the main phrase: « vintage TV » is a tv, « car with roof rack » a car.
  const head = label.split(HEAD_CUT)[0]!;
  let best: { noun: string; end: number } | null = null;
  for (const [re, noun] of CONCEPT_NOUNS) {
    let end = -1;
    for (const m of head.matchAll(new RegExp(re.source, 'g'))) end = m.index + m[0].length;
    // Latest match wins; on a tie the earlier rule (phrases first) keeps it.
    if (end >= 0 && (!best || end > best.end)) best = { noun, end };
  }
  return best?.noun ?? label;
}

/** Words that start a complement after the head noun (EN, FR). */
const HEAD_CUT =
  /\s(?:with|on|near|in|at|under|beside|next to|behind|avec|sur|près de|devant|derrière)\s/;

/** Resolves to TIMEOUT after `ms` (the client also gets the abort signal), null on error. */
const TIMEOUT = Symbol('timeout');
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T | null | typeof TIMEOUT> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Greedy best-IoU matching of SAM instances to the detections that share its concept. */
function matchInstances(
  detections: ApplianceDetection[],
  indices: number[],
  seg: SegmentResult
): Map<number, { box: NormBox; confidence?: number; outline?: string }> {
  const candidates: { det: number; inst: number; score: number; box: NormBox }[] = [];
  seg.instances.forEach((inst, i) => {
    const box = samBoxToNorm(inst.box, seg.imageWidth, seg.imageHeight);
    if (!box) return;
    for (const det of indices) {
      const score = iou(detections[det]!.box, box);
      if (score >= MATCH_MIN_IOU) candidates.push({ det, inst: i, score, box });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.det - b.det || a.inst - b.inst);

  const out = new Map<number, { box: NormBox; confidence?: number; outline?: string }>();
  const usedInst = new Set<number>();
  for (const c of candidates) {
    if (out.has(c.det) || usedInst.has(c.inst)) continue;
    usedInst.add(c.inst);
    const { confidence, outline } = seg.instances[c.inst]!;
    out.set(c.det, {
      box: c.box,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(outline ? { outline } : {}),
    });
  }
  return out;
}

export interface RefineResult {
  detections: ApplianceDetection[];
  /** Detections whose box SAM refined. */
  refined: number;
  /** Concepts whose SAM call failed, timed out or answered from the mock (box kept). */
  skipped: string[];
}

/** The shape crop, so a full-photo miss can retry where the object fills the frame (FIX 2). */
export interface OutlineCrop {
  url: string;
  rect: CropRect;
  photoW: number;
  photoH: number;
}

/** Best-matching instance of one SAM answer, or the miss cause (FIX 1 strings, kept exact). */
function pickOutline(
  seg: SegmentResult,
  box: NormBox
): { outline: string; score: number } | { miss: string } {
  if (seg.instances.length === 0) return { miss: 'SAM found nothing' };
  let best: { outline: string; score: number } | null = null;
  let closest = 0;
  let outlined = 0;
  for (const inst of seg.instances) {
    if (!inst.outline) continue;
    outlined += 1;
    const found = samBoxToNorm(inst.box, seg.imageWidth, seg.imageHeight);
    if (!found) continue;
    const score = iou(box, found);
    if (score > closest) closest = score;
    if (score >= MATCH_MIN_IOU && (!best || score > best.score)) {
      best = { outline: inst.outline, score };
    }
  }
  if (!best) {
    return {
      miss: `${outlined === 0 ? 'no instance has a readable mask' : `best IoU ${closest.toFixed(2)} < ${MATCH_MIN_IOU}`} (${seg.instances.length} instances)`,
    };
  }
  return best;
}

/** A usable SAM answer, else the miss cause (timeout, failure, or mock). */
function usableAnswer(
  seg: (SegmentResult & PerceptionSource) | null | typeof TIMEOUT,
  timeoutMs: number
): { seg: SegmentResult & PerceptionSource } | { miss: string } {
  if (seg === TIMEOUT) return { miss: `SAM timed out after ${timeoutMs}ms` };
  if (!seg || seg.source !== 'meta' || seg.fallback) {
    return { miss: !seg ? 'SAM call failed' : 'mock answer ignored' };
  }
  return { seg };
}

/**
 * Mask outline for one box on demand (PR-2.20): SAM segments the full photo for `concept`
 * (already normalized), and the best-matching instance (IoU ≥ 0.3) lends its outline. Photo
 * fractions, like detection outlines — no remap. When the full photo misses and `crop` is set
 * (FIX 2), SAM retries on the shape crop — the object fills the frame there, and that variant
 * answers where the full photo stays silent (proven live on the green Mini) — and the winner
 * is remapped to photo fractions. Best effort: failure, timeout, a mock answer, no match, or
 * a match without a readable mask → null (one warn with the cause). Never throws.
 */
export async function fetchOutlineForBox(
  segmentImage: PerceptionClient['segmentImage'],
  imageUrl: string,
  concept: string,
  box: NormBox,
  {
    timeoutMs = SEGMENT_TIMEOUT_MS,
    crop,
    fallback,
  }: {
    timeoutMs?: number;
    crop?: OutlineCrop;
    /** Second concept tried once when `concept` misses (the full label: « utility pole » finds what « pole » does not). */
    fallback?: string;
  } = {}
): Promise<string | null> {
  const full = await withTimeout((signal) => segmentImage(imageUrl, concept, signal), timeoutMs);
  // Only a real SAM answer counts (the mock's boxes belong to another image).
  const answered = usableAnswer(full, timeoutMs);
  let miss: string;
  if ('miss' in answered) {
    miss = answered.miss;
  } else {
    const picked = pickOutline(answered.seg, box);
    if ('outline' in picked) return picked.outline;
    miss = picked.miss;
  }
  if (crop) {
    const boxInCrop: NormBox = {
      x: (box.x * crop.photoW - crop.rect.left) / crop.rect.width,
      y: (box.y * crop.photoH - crop.rect.top) / crop.rect.height,
      w: (box.w * crop.photoW) / crop.rect.width,
      h: (box.h * crop.photoH) / crop.rect.height,
    };
    const onCrop = await withTimeout(
      (signal) => segmentImage(crop.url, concept, signal),
      timeoutMs
    );
    const cropAnswered = usableAnswer(onCrop, timeoutMs);
    if ('miss' in cropAnswered) {
      miss = `${miss}; crop: ${cropAnswered.miss}`;
    } else {
      const picked = pickOutline(cropAnswered.seg, boxInCrop);
      if ('outline' in picked) {
        const remapped = remapOutlineToPhoto(picked.outline, crop.rect, crop.photoW, crop.photoH);
        if (remapped) {
          console.info(
            `[vision] 3D outline for "${concept}" adopted from the crop (full photo: ${miss})`
          );
          return remapped;
        }
        miss = `${miss}; crop: outline unreadable after remap`;
      } else {
        miss = `${miss}; crop: ${picked.miss}`;
      }
    }
  }
  // Every miss logs its cause: a silent null here used to cost a whole investigation session.
  console.warn(`[vision] 3D outline missed for "${concept}": ${miss}`);
  const next = fallback?.trim().toLowerCase();
  if (next && next !== concept) {
    return fetchOutlineForBox(segmentImage, imageUrl, next, box, {
      timeoutMs,
      ...(crop ? { crop } : {}),
    });
  }
  return null;
}

/**
 * Refines Muse boxes with SAM (PV-T5): one call per distinct label, in parallel, each bounded by
 * `timeoutMs`. A matched detection takes the SAM box (pixel-precise) and its mask outline. Failure, timeout, spend cap
 * or a mock answer → the Muse box is kept. Never throws. The SAM mask outline comes along when decoded.
 */
export async function refineDetections(
  perception: Pick<PerceptionClient, 'segmentImage'>,
  imageUrl: string,
  detections: ApplianceDetection[],
  { timeoutMs = SEGMENT_TIMEOUT_MS, maxConcepts = MAX_SEGMENT_CONCEPTS } = {}
): Promise<RefineResult> {
  const byConcept = new Map<string, number[]>();
  detections.forEach((d, i) => {
    const key = conceptOf(d);
    const list = byConcept.get(key);
    if (list) list.push(i);
    else if (byConcept.size < maxConcepts) byConcept.set(key, [i]);
  });

  const concepts = [...byConcept.keys()];
  const results = await Promise.all(
    concepts.map((concept) =>
      withTimeout((signal) => perception.segmentImage(imageUrl, concept, signal), timeoutMs)
    )
  );

  const out = detections.map((d) => ({ ...d, box: { ...d.box } }));
  const skipped: string[] = [];
  let refined = 0;
  concepts.forEach((concept, k) => {
    const seg = results[k];
    // Only a real SAM answer refines: the mock's boxes belong to another image.
    if (seg === TIMEOUT || !seg || seg.source !== 'meta' || seg.fallback) {
      skipped.push(concept);
      return;
    }
    for (const [det, match] of matchInstances(out, byConcept.get(concept)!, seg)) {
      const d = out[det]!;
      out[det] = {
        ...d,
        box: match.box,
        ...(match.outline ? { outline: match.outline } : {}),
        ...(d.confidence === undefined && match.confidence !== undefined
          ? { confidence: match.confidence }
          : {}),
      };
      refined += 1;
    }
  });

  return { detections: out, refined, skipped };
}
