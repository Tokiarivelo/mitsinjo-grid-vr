import { log, rock, stump, tyre, type PartSpec } from '../../furniture';
import { enumField, finishColor, furnitureTeam, type FurnitureReading } from './furniture';

/**
 * The terrain team (PQ-T90): rocks, boulders, fallen logs, stumps, tyres lying on the ground.
 * Shared profile and finishes only. A rock or a log is its outline (`silhouette` part cut from
 * the SAM contour by `furnitureModel`) with a boulder or round section; a tyre a tread ring with
 * its soil; a stump a short trunk. Only the proportions are measured: one height (1 m) is enough.
 */

export const TERRAIN_KINDS = ['rock', 'log', 'stump', 'tyre'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];
export const TERRAIN_PARTS = ['moss', 'soil', 'bark', 'cut_face', 'tread'] as const;

/** 1: first version. */
export const TERRAIN_PROMPT_VERSION = 1;

export const TERRAIN_TEAM = furnitureTeam({
  id: 'terrain',
  promptVersion: TERRAIN_PROMPT_VERSION,
  noun: 'object',
  subject: 'ONE thing lying on the ground (a rock, a fallen log, a stump or a tyre)',
  kinds: TERRAIN_KINDS,
  parts: TERRAIN_PARTS,
  finishes: [
    ['surface', 'its main surface: stone, bark or rubber'],
    ['soil', 'the soil or moss filling or covering it'],
    ['cut', 'the cut face of a stump'],
  ],
  materials: ['stone', 'wood', 'rubber'],
  own: {},
  parseOwn: () => ({}),
  ownSummary: () => 'outline and section',
});

export type TerrainReading = FurnitureReading<Record<string, never>>;

const H = 1;

/** A terrain reading on its measured proportions (largest side = 1) → its builder's parts. */
export function terrainParts(
  r: TerrainReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, TERRAIN_KINDS, 'rock');
  const color = finishColor(r, ['surface'], kind === 'tyre' ? '#5a5644' : '#7d786c');
  const k = H / Math.max(1e-6, p.h);
  if (kind === 'tyre')
    return tyre(Math.max(p.w, p.d) * k, H, color, finishColor(r, ['soil'], '#4a3a2c'));
  if (kind === 'stump')
    return stump(Math.max(p.w, p.d) * k, H, color, finishColor(r, ['cut'], '#b99a6b'));
  return (kind === 'log' ? log : rock)(H, p.d * k, color, p.w * k);
}
