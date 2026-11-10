import type { ApplianceDetection } from '@/lib/vision';
import type { PanoBox } from './equirect';

/**
 * Walkable 360° test space of the /village VR immersion (emulator / desktop, not on a real
 * headset): six rooms of one real photo studio, then outside through the hall window: a
 * terrace with solar panels, a street of houses, a house front, a garden, a tree-lined road
 * and two forest stops (Poly Haven CC0, `public/tour/CREDITS.md`). Outdoor places are
 * different real sites linked as one walk. Links and object boxes were drawn by hand on the
 * equirect photos (image fractions).
 */
export type TourRoomId =
  | 'hall'
  | 'loft'
  | 'bedroom'
  | 'bath'
  | 'salon'
  | 'lounge'
  | 'terrace'
  | 'street'
  | 'house'
  | 'garden'
  | 'avenue'
  | 'forest'
  | 'woods';

export interface TourLink {
  to: TourRoomId;
  /** Image column of the doorway / direction the arrow points to. */
  u: number;
}

/** A real object of the photo: ground truth for the offline detector (`make dev-mock`). */
export interface TourObject extends Pick<
  ApplianceDetection,
  'label' | 'labels' | 'category' | 'kind' | 'scenery'
> {
  id: string;
  box: PanoBox;
}

export interface TourRoom {
  id: TourRoomId;
  src: string;
  links: TourLink[];
  objects: TourObject[];
}

export const TOUR_START: TourRoomId = 'loft';
/** Image column faced on first entry (loft: kitchen and fridge ahead). */
export const TOUR_START_U = 0.8;

const obj = (
  id: string,
  label: string,
  fr: string,
  mg: string,
  category: ApplianceDetection['category'],
  u0: number,
  v0: number,
  u1: number,
  v1: number
): TourObject => ({ id, label, labels: { fr, mg }, category, box: { u0, v0, u1, v1 } });

/** Scenery (house, car, tree…): outlined and selectable, no load (`kind: 'scenery'`). */
const scene = (
  id: string,
  label: string,
  fr: string,
  mg: string,
  scenery: NonNullable<ApplianceDetection['scenery']>,
  u0: number,
  v0: number,
  u1: number,
  v1: number
): TourObject => ({
  ...obj(id, label, fr, mg, 'other', u0, v0, u1, v1),
  kind: 'scenery',
  scenery,
});

const TREE = ['Tree', 'Arbre', 'Hazo'] as const;
const HOUSE = ['House', 'Maison', 'Trano'] as const;
const CAR = ['Car', 'Voiture', 'Fiara'] as const;

export const TOUR_ROOMS: Record<TourRoomId, TourRoom> = {
  loft: {
    id: 'loft',
    src: '/tour/studio/loft.jpg',
    links: [
      { to: 'hall', u: 0.07 },
      { to: 'bedroom', u: 0.37 },
    ],
    objects: [
      obj(
        'loft-fridge',
        'Fridge',
        'Réfrigérateur',
        'Vata fampangatsiahana',
        'fridge',
        0.834,
        0.506,
        0.853,
        0.598
      ),
      obj(
        'loft-ac',
        'Air conditioner',
        'Climatiseur',
        'Fampangatsiahana rivotra',
        'other',
        0.619,
        0.356,
        0.664,
        0.379
      ),
      obj(
        'loft-hood',
        'Pendant lamp',
        'Suspension',
        'Jiro mihantona',
        'lamp',
        0.919,
        0.44,
        0.938,
        0.49
      ),
    ],
  },
  hall: {
    id: 'hall',
    src: '/tour/studio/hall.jpg',
    links: [
      { to: 'loft', u: 0.17 },
      { to: 'lounge', u: 0.97 },
      { to: 'terrace', u: 0.5 },
    ],
    objects: [
      obj(
        'hall-letters',
        'Light-up letters',
        'Lettres lumineuses',
        'Litera mazava',
        'lamp',
        0.71,
        0.51,
        0.94,
        0.62
      ),
      obj(
        'hall-ac',
        'Air conditioner',
        'Climatiseur',
        'Fampangatsiahana rivotra',
        'other',
        0.578,
        0.366,
        0.609,
        0.385
      ),
      obj(
        'hall-fireplace',
        'Electric fireplace',
        'Cheminée électrique',
        'Fatana elektrika',
        'other',
        0.281,
        0.54,
        0.341,
        0.62
      ),
    ],
  },
  bedroom: {
    id: 'bedroom',
    src: '/tour/studio/bedroom.jpg',
    links: [
      { to: 'loft', u: 0.05 },
      { to: 'bath', u: 0.37 },
    ],
    objects: [
      obj(
        'bedroom-vanity',
        'Vanity mirror lights',
        'Miroir lumineux',
        'Fitaratra misy jiro',
        'lamp',
        0.631,
        0.48,
        0.672,
        0.55
      ),
      obj(
        'bedroom-softbox',
        'Studio light',
        'Projecteur de studio',
        'Jiro studio',
        'lamp',
        0.825,
        0.51,
        0.9,
        0.64
      ),
    ],
  },
  bath: {
    id: 'bath',
    src: '/tour/studio/bath.jpg',
    links: [
      { to: 'bedroom', u: 0.95 },
      { to: 'salon', u: 0.2 },
    ],
    objects: [
      obj(
        'bath-ceiling-1',
        'Ceiling light',
        'Plafonnier',
        'Jiro amin’ny valindrihana',
        'lamp',
        0.338,
        0.168,
        0.36,
        0.194
      ),
      obj(
        'bath-ceiling-2',
        'Ceiling light',
        'Plafonnier',
        'Jiro amin’ny valindrihana',
        'lamp',
        0.163,
        0.27,
        0.175,
        0.29
      ),
    ],
  },
  salon: {
    id: 'salon',
    src: '/tour/studio/salon.jpg',
    links: [
      { to: 'bath', u: 0.03 },
      { to: 'lounge', u: 0.62 },
    ],
    objects: [
      obj(
        'salon-chandelier',
        'Chandelier',
        'Lustre',
        'Jiro kristaly',
        'lamp',
        0.259,
        0.356,
        0.306,
        0.456
      ),
      obj(
        'salon-ceiling',
        'Ceiling light',
        'Plafonnier',
        'Jiro amin’ny valindrihana',
        'lamp',
        0.431,
        0.181,
        0.464,
        0.2
      ),
    ],
  },
  lounge: {
    id: 'lounge',
    src: '/tour/studio/lounge.jpg',
    links: [
      { to: 'salon', u: 0.18 },
      { to: 'hall', u: 0.73 },
    ],
    objects: [
      obj(
        'lounge-sconce-1',
        'Wall lamp',
        'Applique murale',
        'Jiro amin’ny rindrina',
        'lamp',
        0.284,
        0.465,
        0.294,
        0.48
      ),
      obj(
        'lounge-sconce-2',
        'Wall lamp',
        'Applique murale',
        'Jiro amin’ny rindrina',
        'lamp',
        0.326,
        0.465,
        0.334,
        0.48
      ),
      obj(
        'lounge-ceiling',
        'Ceiling light',
        'Plafonnier',
        'Jiro amin’ny valindrihana',
        'lamp',
        0.616,
        0.169,
        0.647,
        0.198
      ),
      obj('lounge-fireplace', 'Fireplace', 'Cheminée', 'Fatana', 'other', 0.28, 0.51, 0.345, 0.59),
    ],
  },
  terrace: {
    id: 'terrace',
    src: '/tour/outdoor/terrace.jpg',
    links: [
      { to: 'hall', u: 0.57 },
      { to: 'street', u: 0.33 },
      { to: 'garden', u: 0.92 },
    ],
    objects: [
      obj(
        'terrace-solar',
        'Solar panels',
        'Panneaux solaires',
        'Takelaka masoandro',
        'other',
        0.155,
        0.535,
        0.25,
        0.595
      ),
      scene('terrace-house', ...HOUSE, 'building', 0.43, 0.27, 0.81, 0.72),
      scene('terrace-car', ...CAR, 'vehicle', 0.04, 0.55, 0.073, 0.585),
      scene('terrace-cypress', ...TREE, 'tree', 0.82, 0.28, 0.87, 0.75),
    ],
  },
  street: {
    id: 'street',
    src: '/tour/outdoor/street.jpg',
    links: [
      { to: 'terrace', u: 0.115 },
      { to: 'house', u: 0.86 },
    ],
    objects: [
      scene('street-car-white', ...CAR, 'vehicle', 0.505, 0.51, 0.627, 0.61),
      scene('street-car-black', ...CAR, 'vehicle', 0.459, 0.5, 0.517, 0.55),
      scene('street-house-1', ...HOUSE, 'building', 0.52, 0.37, 0.6, 0.5),
      scene('street-house-2', ...HOUSE, 'building', 0.605, 0.35, 0.75, 0.5),
      scene('street-house-3', ...HOUSE, 'building', 0.755, 0.38, 0.82, 0.5),
      scene('street-house-4', ...HOUSE, 'building', 0.87, 0.42, 0.92, 0.5),
      scene('street-tree', ...TREE, 'tree', 0.29, 0.32, 0.4, 0.5),
      obj(
        'street-lamp',
        'Street light',
        'Lampadaire',
        'Jiro an-dalambe',
        'lamp',
        0.815,
        0.4,
        0.825,
        0.5
      ),
    ],
  },
  house: {
    id: 'house',
    src: '/tour/outdoor/house.jpg',
    links: [
      { to: 'street', u: 0.15 },
      { to: 'garden', u: 0.87 },
    ],
    objects: [
      scene('house-front', ...HOUSE, 'building', 0.33, 0.19, 0.8, 0.6),
      obj(
        'house-wall-lamp',
        'Wall lamp',
        'Applique murale',
        'Jiro amin’ny rindrina',
        'lamp',
        0.613,
        0.385,
        0.625,
        0.42
      ),
      scene('house-tree-1', ...TREE, 'tree', 0.03, 0.25, 0.15, 0.53),
      scene('house-tree-2', ...TREE, 'tree', 0.16, 0.38, 0.24, 0.52),
      scene('house-tree-3', ...TREE, 'tree', 0.955, 0.28, 0.02, 0.5),
    ],
  },
  garden: {
    id: 'garden',
    src: '/tour/outdoor/garden.jpg',
    links: [
      { to: 'house', u: 0.35 },
      { to: 'avenue', u: 0.75 },
      { to: 'terrace', u: 0.05 },
      { to: 'woods', u: 0.55 },
    ],
    objects: [
      scene('garden-house', ...HOUSE, 'building', 0.32, 0.45, 0.39, 0.49),
      scene('garden-palm', 'Palm tree', 'Palmier', 'Rofia', 'tree', 0.455, 0.34, 0.52, 0.5),
      scene('garden-big-tree', ...TREE, 'tree', 0.58, 0.25, 0.7, 0.6),
      scene('garden-pine', ...TREE, 'tree', 0.8, 0.1, 0.88, 0.6),
    ],
  },
  avenue: {
    id: 'avenue',
    src: '/tour/outdoor/avenue.jpg',
    links: [
      { to: 'garden', u: 0.79 },
      { to: 'forest', u: 0.3 },
    ],
    objects: [
      scene('avenue-pine', ...TREE, 'tree', 0.36, 0.1, 0.52, 0.57),
      scene('avenue-tree-left', ...TREE, 'tree', 0.16, 0.19, 0.27, 0.55),
      scene('avenue-tree-right', ...TREE, 'tree', 0.7, 0.26, 0.78, 0.52),
      scene('avenue-tree-back', ...TREE, 'tree', 0.0, 0.1, 0.1, 0.58),
    ],
  },
  forest: {
    id: 'forest',
    src: '/tour/outdoor/forest.jpg',
    links: [
      { to: 'avenue', u: 0.09 },
      { to: 'woods', u: 0.54 },
    ],
    objects: [
      scene('forest-tree-1', ...TREE, 'tree', 0.19, 0.08, 0.25, 0.6),
      scene('forest-tree-2', ...TREE, 'tree', 0.69, 0.15, 0.78, 0.7),
      scene('forest-rock', 'Rock', 'Rocher', 'Vato', 'other', 0.24, 0.6, 0.31, 0.7),
    ],
  },
  woods: {
    id: 'woods',
    src: '/tour/outdoor/woods.jpg',
    links: [
      { to: 'forest', u: 0.4 },
      { to: 'garden', u: 0.93 },
    ],
    objects: [
      scene('woods-tree', ...TREE, 'tree', 0.72, 0.12, 0.82, 0.5),
      scene('woods-plant', 'Plant', 'Plante', 'Zavamaniry', 'plant', 0.59, 0.27, 0.63, 0.45),
    ],
  },
};

/** Image column to face when arriving through `from`: the way back is behind you. */
export function entryU(room: TourRoom, from: TourRoomId | null): number {
  const back = room.links.find((l) => l.to === from);
  return back ? (back.u + 0.5) % 1 : room.id === TOUR_START ? TOUR_START_U : 0.5;
}
