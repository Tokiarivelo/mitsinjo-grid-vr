import 'server-only';

import { createHash } from 'node:crypto';
import type { WithoutSource } from './backend';
import type { SegmentResult, ShapeResult } from './schemas';

/**
 * Meta answer cache (PQ-T49, E12.5): `(image fingerprint, prompt version) → kit` and
 * `(crop fingerprint, concept) → SAM answer`, remembered per server process. A repeated photo
 * (regenerate, re-open, eval re-run) pays no second Meta call and records $0 of spend. Bounded
 * oldest-out maps like the inline-image cache; entries are cloned both ways, so callers can use
 * the answer as their own. No TTL: serverless recycles the process, like the spend guard.
 * Agreement evals (`make eval-shape`) run with `SHAPE_CACHE=false`: a remembered answer is not
 * an independent sample.
 */

/** Most kit answers kept (small JSON: kit + recipe). */
export const SHAPE_CACHE_KIT_MAX = 100;
/** Most SAM answers kept (instances + outlines). */
export const SHAPE_CACHE_SAM_MAX = 300;

interface CachedKit {
  model: string;
  result: WithoutSource<ShapeResult>;
}

interface CachedSam {
  model: string;
  result: WithoutSource<SegmentResult>;
}

const kits = new Map<string, CachedKit>();
const sams = new Map<string, CachedSam>();

/** Stable fingerprint of image bytes or a unique hosted key (same input, same print). */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface KitCacheSubject {
  promptVersion: number;
  label: string;
  category: string;
  archetype?: string;
  facadeUrl?: string;
}

/**
 * Kit key: the crop (a data URL hashes by content, a hosted link by its unique key), the prompt
 * version, and every subject field that changes the question (label, category, operator hint,
 * second image). Facts need no key: the same crop and photo always measure the same.
 */
export function kitCacheKey(imageUrl: string, subject: KitCacheSubject): string {
  return fingerprint(
    [
      imageUrl,
      `v${subject.promptVersion}`,
      subject.label,
      subject.category,
      subject.archetype ?? '',
      subject.facadeUrl ? fingerprint(subject.facadeUrl) : '',
    ].join('\n')
  );
}

/** SAM key: the image plus the one concept word asked on it. */
export function samCacheKey(imageUrl: string, concept: string): string {
  return fingerprint(`${imageUrl}\n${concept}`);
}

function store<T>(map: Map<string, T>, max: number, key: string, value: T): void {
  if (map.size >= max) map.delete(map.keys().next().value!);
  map.set(key, structuredClone(value));
}

/** A remembered kit answer, or undefined. The caller owns the returned object. */
export function getCachedKit(key: string): CachedKit | undefined {
  const hit = kits.get(key);
  return hit ? structuredClone(hit) : undefined;
}

/** Remember a kit answer (callers pass only usable ones: no kit, no cache). */
export function setCachedKit(key: string, model: string, result: WithoutSource<ShapeResult>): void {
  store(kits, SHAPE_CACHE_KIT_MAX, key, { model, result });
}

/** A remembered SAM answer, or undefined. The caller owns the returned object. */
export function getCachedSam(key: string): CachedSam | undefined {
  const hit = sams.get(key);
  return hit ? structuredClone(hit) : undefined;
}

/** Remember a SAM answer, empty ones too (nothing found is an answer). */
export function setCachedSam(
  key: string,
  model: string,
  result: WithoutSource<SegmentResult>
): void {
  store(sams, SHAPE_CACHE_SAM_MAX, key, { model, result });
}

/** Test hook: forget every remembered answer. */
export function resetShapeCache(): void {
  kits.clear();
  sams.clear();
}
