import type { ApplianceDetection } from '@/lib/vision';
import { panoRingsBounds, type PanoBox, type PanoRing } from './equirect';
import { TOUR_OUTLINES } from './tour-outlines';

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
  /** The outline's bounds when it has one (VS-T41), else the hand-drawn box. */
  box: PanoBox;
  /** Hand-traced outline (`tour-outlines.ts`), sent as the detection's SAM-like outline. */
  outline?: ReadonlyArray<PanoRing>;
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
): TourObject => {
  const outline = TOUR_OUTLINES[id];
  const box = (outline && panoRingsBounds(outline)) ?? { u0, v0, u1, v1 };
  return { id, label, labels: { fr, mg }, category, box, ...(outline ? { outline } : {}) };
};

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
        'Range hood',
        'Hotte de cuisine',
        'Fanalana setroka',
        'other',
        0.919,
        0.44,
        0.938,
        0.49
      ),
      scene('loft-sofa', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.228, 0.555, 0.316, 0.665),
      scene(
        'loft-plant-1',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.195,
        0.53,
        0.236,
        0.655
      ),
      scene(
        'loft-plant-2',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.362,
        0.48,
        0.392,
        0.61
      ),
      scene(
        'loft-crate',
        'Crate table',
        'Caisse en bois',
        'Vata hazo',
        'other',
        0.36,
        0.57,
        0.388,
        0.61
      ),
      scene('loft-bed', 'Bed', 'Lit', 'Fandriana', 'other', 0.393, 0.55, 0.488, 0.675),
      scene('loft-pouf', 'Pouf', 'Pouf', 'Seza malemy', 'other', 0.475, 0.62, 0.508, 0.685),
      scene('loft-rug', 'Rug', 'Tapis', 'Tapia', 'other', 0.25, 0.6, 0.36, 0.75),
      scene(
        'loft-window-plants',
        'Planter',
        'Jardinière',
        'Vilia zavamaniry',
        'plant',
        0.49,
        0.56,
        0.522,
        0.6
      ),
      scene(
        'loft-radiator',
        'Radiator cover',
        'Cache-radiateur',
        'Fonon’ny fanafanana',
        'other',
        0.484,
        0.595,
        0.62,
        0.665
      ),
      scene('loft-window', 'Window', 'Fenêtre', 'Varavarankely', 'other', 0.5, 0.37, 0.61, 0.6),
      scene('loft-curtain', 'Curtain', 'Rideau', 'Ridao', 'other', 0.68, 0.36, 0.78, 0.66),
      scene('loft-wardrobe', 'Wardrobe', 'Placard', 'Lalimoara', 'other', 0, 0.37, 0.135, 0.66),
      scene(
        'loft-wall-cabinet',
        'Wall cabinet',
        'Meuble haut',
        'Vata mihantona',
        'other',
        0.858,
        0.44,
        0.892,
        0.5
      ),
      scene('loft-shelf', 'Shelves', 'Étagère', 'Talantalana', 'other', 0.93, 0.43, 0.99, 0.5),
      scene(
        'loft-counter',
        'Kitchen units',
        'Meubles de cuisine',
        'Fanaka an-dakozia',
        'other',
        0.855,
        0.53,
        0.997,
        0.62
      ),
      scene(
        'loft-island',
        'Kitchen island',
        'Îlot de cuisine',
        'Latabatra lakozia',
        'other',
        0.885,
        0.575,
        0.978,
        0.69
      ),
      scene(
        'loft-island-plant',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.928,
        0.51,
        0.96,
        0.585
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
      scene('hall-armchair', 'Armchair', 'Fauteuil', 'Seza be', 'other', 0.07, 0.555, 0.152, 0.745),
      scene('hall-door', 'Door', 'Porte', 'Varavarana', 'other', 0.14, 0.37, 0.212, 0.675),
      scene('hall-sofa', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.332, 0.565, 0.438, 0.65),
      scene(
        'hall-vase',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.31,
        0.495,
        0.34,
        0.54
      ),
      scene('hall-curtain-1', 'Curtain', 'Rideau', 'Ridao', 'other', 0.43, 0.365, 0.6, 0.66),
      scene('hall-curtain-2', 'Curtain', 'Rideau', 'Ridao', 'other', 0.6, 0.365, 0.705, 0.66),
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
      scene(
        'bedroom-shelf',
        'Shelves',
        'Étagère',
        'Talantalana',
        'other',
        0.15,
        0.395,
        0.232,
        0.63
      ),
      scene(
        'bedroom-drape',
        'Photo backdrop',
        'Fond photo',
        'Lamba fakana sary',
        'other',
        0.243,
        0.405,
        0.352,
        0.63
      ),
      scene('bedroom-chair-black', 'Chair', 'Chaise', 'Seza', 'other', 0.24, 0.54, 0.282, 0.655),
      scene('bedroom-chair-director', 'Chair', 'Chaise', 'Seza', 'other', 0.277, 0.53, 0.307, 0.63),
      scene('bedroom-chair-red', 'Chair', 'Chaise', 'Seza', 'other', 0.302, 0.55, 0.333, 0.625),
      scene('bedroom-door', 'Door', 'Porte', 'Varavarana', 'other', 0.365, 0.455, 0.4, 0.595),
      scene('bedroom-bed', 'Bed', 'Lit', 'Fandriana', 'other', 0.488, 0.535, 0.573, 0.625),
      scene(
        'bedroom-window',
        'Window',
        'Fenêtre',
        'Varavarankely',
        'other',
        0.56,
        0.425,
        0.632,
        0.6
      ),
      scene('bedroom-stool', 'Stool', 'Tabouret', 'Seza kely', 'other', 0.623, 0.555, 0.65, 0.65),
      scene(
        'bedroom-backdrop',
        'Photo backdrop',
        'Fond photo',
        'Lamba fakana sary',
        'other',
        0.678,
        0.36,
        0.815,
        0.6
      ),
      scene('bedroom-chair-blue', 'Chair', 'Chaise', 'Seza', 'other', 0.042, 0.525, 0.07, 0.6),
      scene('bedroom-stool-2', 'Stool', 'Tabouret', 'Seza kely', 'other', 0.07, 0.53, 0.096, 0.605),
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
      scene('bath-sofa', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.027, 0.52, 0.101, 0.65),
      scene(
        'bath-flowers-1',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.255,
        0.425,
        0.29,
        0.65
      ),
      scene('bath-armchair', 'Armchair', 'Fauteuil', 'Seza be', 'other', 0.29, 0.52, 0.346, 0.645),
      scene('bath-mirror-2', 'Mirror', 'Miroir', 'Fitaratra', 'other', 0.28, 0.42, 0.33, 0.6),
      scene(
        'bath-flowers-2',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.325,
        0.425,
        0.352,
        0.56
      ),
      scene(
        'bath-flowers-3',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.338,
        0.575,
        0.378,
        0.645
      ),
      scene('bath-mirror', 'Mirror', 'Miroir', 'Fitaratra', 'other', 0.463, 0.385, 0.556, 0.665),
      scene('bath-door', 'Door', 'Porte', 'Varavarana', 'other', 0.558, 0.35, 0.692, 0.665),
      scene('bath-chair', 'Chair', 'Chaise', 'Seza', 'other', 0.752, 0.555, 0.782, 0.65),
      scene(
        'bath-side-table',
        'Side table',
        'Guéridon',
        'Latabatra kely',
        'other',
        0.783,
        0.51,
        0.822,
        0.65
      ),
      scene(
        'bath-tub',
        'Bathtub',
        'Baignoire',
        'Koveta fandroana',
        'other',
        0.862,
        0.595,
        0.937,
        0.665
      ),
      scene(
        'bath-plant',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.913,
        0.55,
        0.952,
        0.62
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
      scene(
        'salon-arch',
        'Flower arch',
        'Arche fleurie',
        'Andohalambo voninkazo',
        'other',
        0.075,
        0.365,
        0.19,
        0.665
      ),
      scene('salon-sofa', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.224, 0.57, 0.322, 0.665),
      scene(
        'salon-side-table',
        'Side table',
        'Guéridon',
        'Latabatra kely',
        'other',
        0.316,
        0.575,
        0.337,
        0.635
      ),
      scene('salon-curtain-1', 'Curtain', 'Rideau', 'Ridao', 'other', 0.4, 0.37, 0.477, 0.66),
      scene('salon-curtain-2', 'Curtain', 'Rideau', 'Ridao', 'other', 0.6, 0.37, 0.64, 0.62),
      scene('salon-sofa-2', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.653, 0.585, 0.727, 0.65),
      scene(
        'salon-pampas-1',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.8,
        0.495,
        0.836,
        0.645
      ),
      scene(
        'salon-pampas-2',
        'Vase of flowers',
        'Vase de fleurs',
        'Vazy misy voninkazo',
        'plant',
        0.845,
        0.47,
        0.908,
        0.795
      ),
      scene('salon-stool', 'Stool', 'Tabouret', 'Seza kely', 'other', 0.827, 0.575, 0.851, 0.655),
      scene(
        'salon-backdrop',
        'Photo backdrop',
        'Fond photo',
        'Lamba fakana sary',
        'other',
        0.765,
        0.37,
        0.945,
        0.79
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
      scene('lounge-door', 'Door', 'Porte', 'Varavarana', 'other', 0.17, 0.445, 0.206, 0.6),
      scene(
        'lounge-mirror-1',
        'Mirror',
        'Miroir',
        'Fitaratra',
        'other',
        0.249,
        0.465,
        0.273,
        0.525
      ),
      scene(
        'lounge-mirror-2',
        'Mirror',
        'Miroir',
        'Fitaratra',
        'other',
        0.354,
        0.465,
        0.379,
        0.525
      ),
      scene('lounge-chaise', 'Sofa', 'Canapé', 'Seza lava', 'other', 0.31, 0.535, 0.4, 0.64),
      scene('lounge-rug', 'Rug', 'Tapis', 'Tapia', 'other', 0.293, 0.6, 0.405, 0.67),
      scene(
        'lounge-window-1',
        'Window',
        'Fenêtre',
        'Varavarankely',
        'other',
        0.463,
        0.42,
        0.523,
        0.625
      ),
      scene(
        'lounge-window-2',
        'Window',
        'Fenêtre',
        'Varavarankely',
        'other',
        0.668,
        0.425,
        0.702,
        0.605
      ),
      scene(
        'lounge-arch',
        'Flower arch',
        'Arche fleurie',
        'Andohalambo voninkazo',
        'other',
        0.79,
        0.43,
        0.872,
        0.6
      ),
      scene(
        'lounge-plant-1',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.893,
        0.48,
        0.917,
        0.615
      ),
      scene(
        'lounge-plant-2',
        'Potted plant',
        'Plante en pot',
        'Zavamaniry anaty vilia',
        'plant',
        0.943,
        0.52,
        0.977,
        0.63
      ),
      scene('lounge-chair', 'Chair', 'Chaise', 'Seza', 'other', 0.915, 0.55, 0.946, 0.625),
      scene(
        'lounge-painting',
        'Painting',
        'Tableau',
        'Sary hosodoko',
        'other',
        0.932,
        0.455,
        0.972,
        0.505
      ),
      scene(
        'lounge-screen',
        'Folding screen',
        'Paravent',
        'Efitra aforitra',
        'other',
        0.974,
        0.48,
        1.0,
        0.63
      ),
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
      scene('terrace-parasol', 'Parasol', 'Parasol', 'Elo', 'other', 0.436, 0.29, 0.501, 0.8),
      scene(
        'terrace-railing-1',
        'Railing',
        'Garde-corps',
        'Fefy vy',
        'other',
        0.025,
        0.55,
        0.33,
        0.8
      ),
      scene(
        'terrace-railing-2',
        'Railing',
        'Garde-corps',
        'Fefy vy',
        'other',
        0.705,
        0.57,
        0.99,
        0.8
      ),
      scene(
        'terrace-pylon',
        'Power pylon',
        'Pylône électrique',
        'Andry herinaratra',
        'other',
        0.112,
        0.41,
        0.128,
        0.5
      ),
      scene('terrace-tree-1', 'Tree', 'Arbre', 'Hazo', 'tree', 0, 0.4, 0.09, 0.56),
      scene('terrace-tree-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.325, 0.33, 0.395, 0.5),
      scene('terrace-cypress-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.395, 0.37, 0.432, 0.56),
      scene('terrace-cypress-3', 'Tree', 'Arbre', 'Hazo', 'tree', 0.965, 0.37, 1.0, 0.62),
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
      scene('street-fence', 'Fence', 'Clôture', 'Fefy', 'other', 0.0, 0.5, 0.37, 0.68),
      scene('street-gate', 'Gate', 'Portail', 'Vavahady', 'other', 0.08, 0.53, 0.152, 0.68),
      scene('street-hedge', 'Shrub', 'Arbuste', 'Kirihitra', 'plant', 0.17, 0.33, 0.29, 0.56),
      scene('street-house-5', 'House', 'Maison', 'Trano', 'building', 0.44, 0.39, 0.525, 0.5),
      scene('street-fence-2', 'Fence', 'Clôture', 'Fefy', 'other', 0.52, 0.5, 0.785, 0.575),
      obj(
        'street-lamp-2',
        'Street light',
        'Lampadaire',
        'Jiro an-dalambe',
        'lamp',
        0.437,
        0.405,
        0.452,
        0.5
      ),
      scene('street-tree-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.905, 0.37, 0.96, 0.5),
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
      scene(
        'house-planter-1',
        'Planter',
        'Jardinière',
        'Vilia zavamaniry',
        'other',
        0.318,
        0.585,
        0.397,
        0.69
      ),
      scene(
        'house-planter-2',
        'Planter',
        'Jardinière',
        'Vilia zavamaniry',
        'other',
        0.718,
        0.585,
        0.797,
        0.7
      ),
      scene('house-shrub-1', 'Shrub', 'Arbuste', 'Kirihitra', 'plant', 0.275, 0.29, 0.5, 0.6),
      scene('house-shrub-2', 'Shrub', 'Arbuste', 'Kirihitra', 'plant', 0.645, 0.26, 0.81, 0.6),
      obj(
        'house-wall-lamp-2',
        'Wall lamp',
        'Applique murale',
        'Jiro amin’ny rindrina',
        'lamp',
        0.494,
        0.385,
        0.503,
        0.43
      ),
      scene(
        'house-fountain',
        'Fountain',
        'Fontaine',
        'Loharano',
        'other',
        0.543,
        0.495,
        0.578,
        0.595
      ),
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
      scene('garden-tyre-1', 'Tyre', 'Pneu', 'Kodiarana', 'other', 0.78, 0.6, 0.857, 0.72),
      scene('garden-tyre-2', 'Tyre', 'Pneu', 'Kodiarana', 'other', 0.875, 0.66, 0.99, 0.8),
      scene('garden-tree-1', 'Tree', 'Arbre', 'Hazo', 'tree', 0.0, 0.2, 0.07, 0.65),
      scene('garden-tree-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.05, 0.2, 0.17, 0.55),
      scene('garden-shrub', 'Shrub', 'Arbuste', 'Kirihitra', 'plant', 0.185, 0.42, 0.255, 0.6),
      scene('garden-tree-3', 'Tree', 'Arbre', 'Hazo', 'tree', 0.715, 0.36, 0.82, 0.55),
      scene(
        'garden-log',
        'Fallen log',
        'Tronc tombé',
        'Vatan-kazo lavo',
        'other',
        0.685,
        0.5,
        0.74,
        0.56
      ),
      scene('garden-tree-4', 'Tree', 'Arbre', 'Hazo', 'tree', 0.965, 0.38, 1.0, 0.57),
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
      scene('avenue-pine-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.305, 0.2, 0.375, 0.56),
      scene('avenue-pine-3', 'Tree', 'Arbre', 'Hazo', 'tree', 0.8, 0.07, 0.93, 0.56),
      scene('avenue-bush', 'Shrub', 'Arbuste', 'Kirihitra', 'plant', 0.61, 0.42, 0.72, 0.56),
      scene('avenue-tree-small', 'Tree', 'Arbre', 'Hazo', 'tree', 0.465, 0.45, 0.487, 0.5),
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
      scene('forest-rock-2', 'Rock', 'Rocher', 'Vato', 'other', 0.562, 0.575, 0.597, 0.61),
      scene('forest-rock-3', 'Rock', 'Rocher', 'Vato', 'other', 0.585, 0.61, 0.637, 0.66),
      scene('forest-rock-4', 'Rock', 'Rocher', 'Vato', 'other', 0.0, 0.6, 0.05, 0.69),
      scene('forest-rock-5', 'Rock', 'Rocher', 'Vato', 'other', 0.955, 0.66, 1.0, 0.73),
      scene(
        'forest-log',
        'Fallen log',
        'Tronc tombé',
        'Vatan-kazo lavo',
        'other',
        0.28,
        0.45,
        0.385,
        0.5
      ),
      scene('forest-tree-3', 'Tree', 'Arbre', 'Hazo', 'tree', 0.375, 0.08, 0.42, 0.6),
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
      scene(
        'woods-bridge',
        'Footbridge',
        'Passerelle',
        'Tetezana hazo',
        'other',
        0.875,
        0.49,
        0.95,
        0.575
      ),
      scene('woods-fern', 'Fern', 'Fougère', 'Ampanga', 'plant', 0.745, 0.58, 0.83, 0.69),
      scene('woods-palm', 'Palm tree', 'Palmier', 'Rofia', 'plant', 0.15, 0.45, 0.22, 0.62),
      scene('woods-tree-2', 'Tree', 'Arbre', 'Hazo', 'tree', 0.27, 0.05, 0.33, 0.55),
    ],
  },
};

/** Image column to face when arriving through `from`: the way back is behind you. */
export function entryU(room: TourRoom, from: TourRoomId | null): number {
  const back = room.links.find((l) => l.to === from);
  return back ? (back.u + 0.5) % 1 : room.id === TOUR_START ? TOUR_START_U : 0.5;
}
