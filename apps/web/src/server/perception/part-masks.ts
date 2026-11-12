import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import type { PartMask } from '@/lib/object-shape';
import type { NormBox } from '@/lib/vision';
import type { PerceptionClient } from './client';
import { samBoxToNorm } from './outline';

/** SAM concepts segmented per archetype on the object crop (PR-2.5). */
export const PART_CONCEPTS: Record<KitArchetype, ReadonlyArray<string>> = {
  vehicle: ['wheel', 'window'],
  house: ['window', 'door', 'chimney'],
  lamp_post: ['lamp'],
  cabinet: [],
  screen: [],
  fan: [],
  machine: [],
  pole: [],
  tank: [],
  panel: [],
  building: [],
  tree: [],
  bush: [],
  person: [],
  animal: [],
  water: [],
  other: [],
};

/**
 * Default wait for the whole batch (all concepts in parallel): none — every concept is awaited.
 * Callers may pass an explicit `timeoutMs`; stragglers past it are dropped.
 */
export const PART_MASKS_TIMEOUT_MS: number | null = null;

/** Share of the time left that part masks may use (PQ-T9), bounded below and above. */
export const PART_MASKS_TIME_SHARE = 0.25;
export const PART_MASKS_MIN_MS = 3000;
export const PART_MASKS_MAX_MS = 8000;

/**
 * Deadline of the part-mask batch from the time left in the request (a share of it, bounded);
 * null when the request itself is unbounded, so the batch waits for every concept.
 */
export function partMasksTimeout(timeLeftMs: number | null): number | null {
  if (timeLeftMs === null || !Number.isFinite(timeLeftMs)) return null;
  const share = Math.round(Math.max(0, timeLeftMs) * PART_MASKS_TIME_SHARE);
  return Math.min(PART_MASKS_MAX_MS, Math.max(PART_MASKS_MIN_MS, share));
}

/** Second phrasing tried once when the first answer for a part is empty (PQ-T9). */
export const PART_RETRY: Readonly<Record<string, string>> = {
  wheel: 'tire',
  window: 'glass window',
  door: 'doorway',
  chimney: 'chimney stack',
  lamp: 'light',
};

/** Most instances kept per concept, highest confidence first. */
export const PART_MASKS_PER_CONCEPT = 8;

/**
 * Segments the archetype's part concepts on the crop, in parallel (PR-2.5). Best effort:
 * a failed concept contributes nothing, a hanging one is dropped at the shared deadline when an
 * explicit `timeoutMs` bounds it (by default every concept is awaited), and only real SAM
 * answers count (the mock's boxes belong to another image). Never throws.
 */
export async function fetchPartMasks(
  segmentImage: PerceptionClient['segmentImage'],
  cropUrl: string,
  archetype: KitArchetype,
  {
    timeoutMs = PART_MASKS_TIMEOUT_MS,
    concepts = PART_CONCEPTS[archetype] ?? [],
  }: {
    /** Explicit bound; null/undefined (default) awaits every concept. */
    timeoutMs?: number | null;
    /** Concepts to segment instead of the archetype's (the facade asks windows and doors only). */
    concepts?: ReadonlyArray<string>;
  } = {}
): Promise<PartMask[]> {
  if (concepts.length === 0) return [];
  const ms =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : null;
  const deadline = ms === null ? Infinity : Date.now() + ms;
  const controller = new AbortController();
  const abortTimer = ms === null ? undefined : setTimeout(() => controller.abort(), ms);
  // Per-concept miss cause, for the one warn when every concept misses (else the caller logs
  // the hits and the misses stay invisible — the green Mini lost its wheels silently).
  const missed = new Map<string, string>();
  try {
    const perConcept = await Promise.all(
      concepts.map(async (concept): Promise<PartMask[]> => {
        type Settled =
          | { status: 'answer'; seg: Awaited<ReturnType<typeof segmentImage>> }
          | { status: 'error' }
          | { status: 'late' };
        const call: Promise<Settled> = segmentImage(cropUrl, concept, controller.signal).then(
          (seg) => ({ status: 'answer', seg }) as const,
          () => ({ status: 'error' }) as const
        );
        const late: Promise<Settled> | null =
          deadline === Infinity
            ? null
            : new Promise((resolve) =>
                setTimeout(() => resolve({ status: 'late' }), Math.max(0, deadline - Date.now()))
              );
        let settled = late ? await Promise.race([call, late]) : await call;
        // First answer empty (a real SAM answer with no instance): one more phrasing, inside the same deadline.
        const retry = PART_RETRY[concept];
        if (
          retry &&
          settled.status === 'answer' &&
          settled.seg.source === 'meta' &&
          !settled.seg.fallback &&
          settled.seg.instances.length === 0 &&
          Date.now() < deadline
        ) {
          const again: Promise<Settled> = segmentImage(cropUrl, retry, controller.signal).then(
            (seg) => ({ status: 'answer', seg }) as const,
            () => ({ status: 'error' }) as const
          );
          const second = late ? await Promise.race([again, late]) : await again;
          if (second.status === 'answer' && second.seg.instances.length > 0) settled = second;
        }
        if (settled.status !== 'answer') {
          missed.set(concept, settled.status === 'late' ? 'timed out' : 'call failed');
          return [];
        }
        const { seg } = settled;
        if (seg.source !== 'meta' || seg.fallback) {
          missed.set(concept, 'mock answer ignored');
          return [];
        }
        if (seg.instances.length === 0) {
          missed.set(concept, 'SAM found nothing');
          return [];
        }
        const masks = seg.instances
          .map((inst) => ({
            inst,
            box: samBoxToNorm(inst.box, seg.imageWidth, seg.imageHeight),
          }))
          .filter(
            (m): m is { inst: (typeof seg.instances)[number]; box: NormBox } => m.box !== null
          )
          .sort((a, b) => (b.inst.confidence ?? 0) - (a.inst.confidence ?? 0))
          .slice(0, PART_MASKS_PER_CONCEPT)
          .map(({ inst, box }) => ({
            concept,
            box,
            ...(inst.outline ? { outline: inst.outline } : {}),
          }));
        if (masks.length === 0) missed.set(concept, 'no usable boxes');
        return masks;
      })
    );
    const masks = perConcept.flat();
    if (masks.length === 0 && missed.size > 0) {
      console.warn(
        `[vision] 3D part masks missed for "${archetype}": ${[...missed].map(([c, why]) => `${c} ${why}`).join(', ')}`
      );
    }
    return masks;
  } finally {
    clearTimeout(abortTimer);
  }
}
