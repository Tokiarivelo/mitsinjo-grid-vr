import type { PerceptionClient } from './client';
import type { ApplianceDetection, NormBox, PerceptionSource, SegmentResult } from './schemas';
import type { CropRect } from './shape-crop';
import { iou, MATCH_MIN_IOU } from './box-match';
import { remapOutlineToPhoto } from './mask-outline';
import { pickConsensus, type OutlineCandidate } from './sam-consensus';

/**
 * Default wait for one SAM call: none — the generation is awaited until it answers (the Muse box
 * is kept only on failure or a mock answer). Callers may still pass an explicit `timeoutMs`.
 */
export const SEGMENT_TIMEOUT_MS: number | null = null;
/** Most SAM calls per photo (one per distinct label), to bound cost and latency. */
export const MAX_SEGMENT_CONCEPTS = 8;
/** Phrasings asked together by the consensus (the noun, the full label, a lookalike). */
export const MAX_CONSENSUS_PHRASINGS = 3;

export { iou, MATCH_MIN_IOU };

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

/**
 * Words SAM does not know, and the lookalike it outlines instead (measured with `make sam-probe`, PQ-T9):
 * no pump word finds anything on two photos, « fire hydrant » outlines the hand pump (IoU 0.89).
 */
const SAM_LOOKALIKES: Readonly<Record<string, string>> = { pump: 'fire hydrant' };

/**
 * What to ask SAM after `conceptOf(d)` misses, in order: the full label (« utility pole » finds what
 * « pole » does not, 0.86 vs 0.19), then the lookalike of its noun. Duplicates and the noun itself dropped.
 */
export function samRetries(d: Pick<ApplianceDetection, 'label'>): string[] {
  const noun = conceptOf(d);
  const label = d.label.trim().toLowerCase();
  const out = [label, SAM_LOOKALIKES[noun]].filter((c): c is string => !!c && c !== noun);
  return [...new Set(out)];
}

/** Words that start a complement after the head noun (EN, FR). */
const HEAD_CUT =
  /\s(?:with|on|near|in|at|under|beside|next to|behind|avec|sur|près de|devant|derrière)\s/;

/**
 * `run` bounded by `ms`, or unbounded when `ms` is null/undefined/non-finite (the generation is
 * awaited). Resolves to TIMEOUT on an explicit bound, null on error.
 */
const TIMEOUT = Symbol('timeout');
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number | null | undefined
): Promise<T | null | typeof TIMEOUT> {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return run(new AbortController().signal).catch(() => null);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(
      () => {
        controller.abort();
        resolve(TIMEOUT);
      },
      Math.max(0, ms)
    );
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
): { outline: string; score: number; box: NormBox } | { miss: string } {
  if (seg.instances.length === 0) return { miss: 'SAM found nothing' };
  let best: { outline: string; score: number; box: NormBox } | null = null;
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
      best = { outline: inst.outline, score, box: found };
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
  timeoutMs: number | null | undefined
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
    retries = [],
    consensus = false,
    skipFull = false,
  }: {
    /** Explicit bound; null/undefined (default) awaits the generation. */
    timeoutMs?: number | null;
    crop?: OutlineCrop;
    /**
     * Concepts tried in order while SAM answers `concept` without a match (`samRetries`: the full label,
     * then a lookalike). A timeout, a failed call or a mock answer ends the walk: no word fixes those.
     */
    retries?: ReadonlyArray<string>;
    /**
     * Ask `concept` and `retries` together on the full photo and let `pickConsensus` choose (PQ-T9), instead
     * of walking the retries one by one. More SAM calls (≤ 3), but a merged answer no longer wins by being first.
     */
    consensus?: boolean;
    /** The full photo was already asked for every phrasing (consensus): the walk asks the crop only. */
    skipFull?: boolean;
  } = {}
): Promise<string | null> {
  if (consensus) {
    const phrasings = [concept, ...retries.map((r) => r.trim().toLowerCase())]
      .filter((c, i, all) => c && all.indexOf(c) === i)
      .slice(0, MAX_CONSENSUS_PHRASINGS);
    const answers = await Promise.all(
      phrasings.map((c) => withTimeout((signal) => segmentImage(imageUrl, c, signal), timeoutMs))
    );
    const candidates: OutlineCandidate[] = [];
    const misses: string[] = [];
    let heardAny = false;
    answers.forEach((raw, i) => {
      const answered = usableAnswer(raw, timeoutMs);
      if ('miss' in answered) return void misses.push(`${phrasings[i]}: ${answered.miss}`);
      heardAny = true;
      const picked = pickOutline(answered.seg, box);
      if ('miss' in picked) return void misses.push(`${phrasings[i]}: ${picked.miss}`);
      candidates.push({ concept: phrasings[i]!, ...picked });
    });
    const chosen = pickConsensus(candidates);
    if (chosen) {
      console.info(
        `[vision] 3D outline for "${concept}": ${chosen.why} (${chosen.agreeing}/${candidates.length} of ${phrasings.length} phrasings, kept "${chosen.pick.concept}")`
      );
      return chosen.pick.outline;
    }
    console.warn(`[vision] 3D outline consensus missed for "${concept}": ${misses.join('; ')}`);
    // Timeouts, failures or mock answers only: no word and no crop fixes those (as in the plain walk).
    if (!crop || !heardAny) return null;
    // SAM answered and found nothing on the full photo: every phrasing still gets its chance on the crop.
    return fetchOutlineForBox(segmentImage, imageUrl, concept, box, {
      timeoutMs,
      crop,
      retries: phrasings.slice(1),
      skipFull: true,
    });
  }
  let miss = 'full photo asked above';
  // Another word only helps when SAM answered and found nothing: not on a timeout, a failure or a mock.
  let heard = true;
  if (!skipFull) {
    const full = await withTimeout((signal) => segmentImage(imageUrl, concept, signal), timeoutMs);
    // Only a real SAM answer counts (the mock's boxes belong to another image).
    const answered = usableAnswer(full, timeoutMs);
    heard = !('miss' in answered);
    if ('miss' in answered) {
      miss = answered.miss;
    } else {
      const picked = pickOutline(answered.seg, box);
      if ('outline' in picked) return picked.outline;
      miss = picked.miss;
    }
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
    heard ||= !('miss' in cropAnswered);
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
  const rest = retries.map((r) => r.trim().toLowerCase()).filter((r) => r && r !== concept);
  if (heard && rest.length) {
    return fetchOutlineForBox(segmentImage, imageUrl, rest[0]!, box, {
      timeoutMs,
      ...(crop ? { crop } : {}),
      retries: rest.slice(1),
      // The consensus already asked every phrasing on the full photo: the walk stays on the crop.
      ...(skipFull ? { skipFull } : {}),
    });
  }
  return null;
}

/**
 * Refines Muse boxes with SAM (PV-T5): one call per distinct label, in parallel, each awaited
 * (or bounded by an explicit `timeoutMs`). A matched detection takes the SAM box (pixel-precise)
 * and its mask outline. Failure, timeout, spend cap or a mock answer → the Muse box is kept.
 * Never throws. The SAM mask outline comes along when decoded.
 */
export async function refineDetections(
  perception: Pick<PerceptionClient, 'segmentImage'>,
  imageUrl: string,
  detections: ApplianceDetection[],
  {
    timeoutMs = SEGMENT_TIMEOUT_MS,
    maxConcepts = MAX_SEGMENT_CONCEPTS,
  }: { timeoutMs?: number | null; maxConcepts?: number } = {}
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
