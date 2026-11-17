import type { KitArchetype } from '@/lib/object-kit';
import { CAR_TEAM } from '../car/car-tools';
import { HOUSE_TEAM } from '../house/house-tools';
import { PLANT_TEAM } from '../tree/plant-tools';

/**
 * Which specialist team reads which class of object (PQ-T87). A class without a team keeps its
 * current path (measured views, templates). New teams are added here and nowhere else.
 */
export const TEAM_BY_ARCHETYPE = {
  house: HOUSE_TEAM,
  building: HOUSE_TEAM,
  vehicle: CAR_TEAM,
  tree: PLANT_TEAM,
  bush: PLANT_TEAM,
} as const satisfies Partial<Record<KitArchetype, { id: string }>>;

export type RegisteredTeam = (typeof TEAM_BY_ARCHETYPE)[keyof typeof TEAM_BY_ARCHETYPE];
export type TeamId = RegisteredTeam['id'];

/** The team of an archetype; null = no team, the current path decides. */
export function teamFor(archetype: KitArchetype): RegisteredTeam | null {
  return (TEAM_BY_ARCHETYPE as Partial<Record<KitArchetype, RegisteredTeam>>)[archetype] ?? null;
}

/** The team's id for an archetype (`house`, `car`, `plant`), null without one. */
export const teamIdOf = (archetype: KitArchetype): TeamId | null => teamFor(archetype)?.id ?? null;
