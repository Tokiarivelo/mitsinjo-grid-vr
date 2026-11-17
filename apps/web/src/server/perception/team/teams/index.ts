import { compileSpec, type PartSpec } from '../../furniture';
import type { ObjectRecipe } from '@/lib/object-shape';
import { skinOf } from '../../recipe-box';
import { runTeam, type AskTeamTool, type SpecialistTeam, type TeamRef } from '../team';
import { bedParts, BED_TEAM } from './bed';
import type { FurnitureBrief, FurnitureReading, FurnitureView } from './furniture';
import { seatParts, SEAT_TEAM } from './seat';
import { storageParts, STORAGE_TEAM } from './storage';
import { tableParts, TABLE_TEAM } from './table';

/**
 * The furniture teams (PQ-T89) and what each reading builds: the team, then its builder from the
 * reading and the measured proportions. `furnitureModel` makes the recipe and, with the validated
 * drawings' atlas, puts them on its named parts (`ObjectRecipe.skin`, VS-T43): seat, backrest,
 * legs… are the model's pieces, wearing the drawings.
 */

type Proportions = ObjectRecipe['proportions'];
// The builders take their own reading; the map erases it (each id goes with its own team).
type AnyReading = FurnitureReading<never>;
type AnyTeam = SpecialistTeam<string, FurnitureBrief, FurnitureReading<unknown>, FurnitureView>;

export const FURNITURE_TEAMS = {
  seat: { team: SEAT_TEAM, parts: seatParts },
  table: { team: TABLE_TEAM, parts: tableParts },
  storage: { team: STORAGE_TEAM, parts: storageParts },
  bed: { team: BED_TEAM, parts: bedParts },
} as const;

export type FurnitureTeamId = keyof typeof FURNITURE_TEAMS;

export const isFurnitureTeam = (id: string | null | undefined): id is FurnitureTeamId =>
  !!id && Object.hasOwn(FURNITURE_TEAMS, id);

/** A furniture team's reading of the front and side drawings cut to the object (live or replayed). */
export type ReadFurniture = (
  team: FurnitureTeamId,
  label: string,
  images: ReadonlyArray<string>,
  signal?: AbortSignal
) => Promise<FurnitureReading<unknown> | null>;

/** The live teams as a `ReadFurniture`: one client call factory per team (`teamAsk`). */
export const liveReadFurniture =
  (askFor: (team: TeamRef) => AskTeamTool<string>): ReadFurniture =>
  async (id, label, images, signal) => {
    const { team } = FURNITURE_TEAMS[id];
    const views: FurnitureView[] = images.length > 1 ? ['front', 'side'] : ['front'];
    const { reading } = await runTeam(team as unknown as AnyTeam, askFor(team), {
      label,
      views,
      images,
      ...(signal ? { signal } : {}),
    });
    return reading;
  };

/** The builder's parts of a reading (metres, named by concept). */
export function furnitureParts(
  id: FurnitureTeamId,
  reading: FurnitureReading<unknown>,
  proportions: Proportions
): PartSpec[] {
  const build = FURNITURE_TEAMS[id].parts as (r: AnyReading, p: Proportions) => PartSpec[];
  return build(reading as AnyReading, proportions);
}

/**
 * A reading → the model: the builder's parts as a recipe (largest side = 1), wearing `atlas` (the
 * validated drawings, `lib/face-atlas.ts` layout) on its named parts when given. Null when the
 * builder gives nothing.
 */
export function furnitureModel(
  id: FurnitureTeamId,
  reading: FurnitureReading<unknown>,
  proportions: Proportions,
  atlas?: string
): ObjectRecipe | null {
  const parts = furnitureParts(id, reading, proportions);
  if (!parts.length) return null;
  const { recipe, concepts } = compileSpec({ parts });
  return atlas ? { ...recipe, skin: skinOf(recipe, concepts, atlas) } : recipe;
}
