import type { ApplianceDetection } from '@/lib/vision';
import type { PanoBox } from './equirect';

/**
 * Walkable 360° test space of the /village VR immersion (emulator / desktop, not on a real
 * headset): six rooms of one real photo studio (Poly Haven CC0, `public/tour/CREDITS.md`).
 * Links and object boxes were drawn by hand on the equirect photos (image fractions).
 */
export type TourRoomId = 'hall' | 'loft' | 'bedroom' | 'bath' | 'salon' | 'lounge';

export interface TourLink {
  to: TourRoomId;
  /** Image column of the doorway / direction the arrow points to. */
  u: number;
}

/** A real object of the photo: ground truth for the offline detector (`make dev-mock`). */
export interface TourObject extends Pick<ApplianceDetection, 'label' | 'labels' | 'category'> {
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
};

/** Image column to face when arriving through `from`: the way back is behind you. */
export function entryU(room: TourRoom, from: TourRoomId | null): number {
  const back = room.links.find((l) => l.to === from);
  return back ? (back.u + 0.5) % 1 : room.id === TOUR_START ? TOUR_START_U : 0.5;
}
