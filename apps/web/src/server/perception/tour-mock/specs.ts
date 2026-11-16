import { INDOOR_SPECS } from './specs-indoor';
import { OUTDOOR_SPECS } from './specs-outdoor';
import type { TourSpec } from './spec';

/** Every tour object's hand-built model (VS-T41), by tour object id (`tour-data.ts`). */
export const TOUR_SPECS: Readonly<Record<string, TourSpec>> = { ...INDOOR_SPECS, ...OUTDOOR_SPECS };
