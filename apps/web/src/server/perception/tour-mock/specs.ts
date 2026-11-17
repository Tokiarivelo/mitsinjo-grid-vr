import { INDOOR_SPECS } from './specs-indoor';
import { EXTRA_SPECS } from './specs-extra';
import { OUTDOOR_SPECS } from './specs-outdoor';
import type { TourSpec } from './spec';

/** Rooms of the tour that are outdoors: their plants grow in the ground (no pot, VS-T46). */
export const OUTDOOR_ROOMS = ['terrace', 'street', 'house', 'garden', 'avenue', 'forest', 'woods'];

/** A spec with its outdoor plants marked `ground` (the pot reader saw railings and dry twigs). */
export function grounded(id: string, spec: TourSpec): TourSpec {
  const outdoor = OUTDOOR_ROOMS.some((r) => id.startsWith(`${r}-`));
  return outdoor && spec.kind === 'plant'
    ? { ...spec, hints: { ...spec.hints, ground: true } }
    : spec;
}

/** Every tour object's hand-built model (VS-T41, VS-T42 extras), by tour object id (`tour-data.ts`). */
export const TOUR_SPECS: Readonly<Record<string, TourSpec>> = Object.fromEntries(
  Object.entries({ ...INDOOR_SPECS, ...OUTDOOR_SPECS, ...EXTRA_SPECS }).map(([id, spec]) => [
    id,
    grounded(id, spec),
  ])
);
