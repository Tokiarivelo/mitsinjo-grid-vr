import { compileSpec, partsBounds, resolveSilhouettes, type PartSpec } from '../../furniture';
import type { ObjectRecipe } from '@/lib/object-shape';
import { skinOf } from '../../recipe-box';
import { runTeam, type AskTeamTool, type SpecialistTeam, type TeamRef } from '../team';
import { bedParts, BED_TEAM } from './bed';
import type { FurnitureBrief, FurnitureReading, FurnitureView } from './furniture';
import { seatParts, SEAT_TEAM } from './seat';
import { storageParts, STORAGE_TEAM } from './storage';
import { tableParts, TABLE_TEAM } from './table';
import { textileParts, TEXTILE_TEAM } from './textile';
import { fixtureParts, FIXTURE_TEAM } from './fixture';

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
  // PQ-T90.
  textile: { team: TEXTILE_TEAM, parts: textileParts },
  fixture: { team: FIXTURE_TEAM, parts: fixtureParts },
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

/** Fit passes: a builder whose outline overruns the asked width or depth is rebuilt this many times. */
const FIT_PASSES = 2;

/**
 * The builder's parts of a reading (metres, named by concept). Builders add arms, frames or feet
 * outside the width and depth they are given: the built outline is measured and the asked
 * proportions corrected by the overrun (width and depth over height), so the model's outline
 * matches the measured one.
 */
export function furnitureParts(
  id: FurnitureTeamId,
  reading: FurnitureReading<unknown>,
  proportions: Proportions
): PartSpec[] {
  const build = FURNITURE_TEAMS[id].parts as (r: AnyReading, p: Proportions) => PartSpec[];
  let ask = proportions;
  let parts = build(reading as AnyReading, ask);
  for (let i = 0; i < FIT_PASSES && parts.length; i++) {
    const [bw, bh, bd] = partsBounds(parts).dims;
    const fix = (want: number, got: number, asked: number) =>
      asked * ((want / proportions.h) * (bh / got));
    const next = {
      w: fix(proportions.w, bw, ask.w),
      h: ask.h,
      d: fix(proportions.d, bd, ask.d),
    };
    if (Math.abs(next.w - ask.w) < 1e-3 * ask.h && Math.abs(next.d - ask.d) < 1e-3 * ask.h) break;
    ask = next;
    parts = build(reading as AnyReading, ask);
  }
  return parts;
}

/**
 * The object's outline for the builders' `silhouette` parts (a curtain, a rock, a log): the SAM
 * contour's rings in fractions of the detection box (x right, y down, `silhouetteRings`) and the
 * box's width over height in pixels. Its contour only, never its pixels.
 */
export interface PartsOutline {
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  aspect: number;
}

const UNIT_BOX = { x: 0, y: 0, w: 1, h: 1 };

/**
 * A reading → the model: the builder's parts as a recipe (largest side = 1), its `silhouette`
 * parts cut from `outline` when given (else left boxes), wearing `atlas` (the validated drawings,
 * `lib/face-atlas.ts` layout) on its named parts when given. Null when the builder gives nothing.
 */
export function furnitureModel(
  id: FurnitureTeamId,
  reading: FurnitureReading<unknown>,
  proportions: Proportions,
  atlas?: string,
  outline?: PartsOutline
): ObjectRecipe | null {
  const built = furnitureParts(id, reading, proportions);
  if (!built.length) return null;
  const { parts } =
    outline && outline.rings.length
      ? resolveSilhouettes({ parts: built }, outline.rings, UNIT_BOX, outline.aspect)
      : { parts: built };
  const { recipe, concepts } = compileSpec({ parts });
  return atlas ? { ...recipe, skin: skinOf(recipe, concepts, atlas) } : recipe;
}
