/**
 * Library models (VS-T51): realistic, licensed 3D models the app can show in place of a generated one when
 * the AI recognises the object (a sofa, a car). Never presented as generated: the lab shows the author and
 * the licence with it, and the generated model stays one tap away. Files in `public/models/library/`
 * (see its CREDITS.md).
 */

export interface LibraryModel {
  id: string;
  /** Public URL of the glTF binary. */
  url: string;
  /** Detection labels it answers (EN / FR / MG). */
  match: RegExp;
  /** Author and copyright, shown with the model. */
  credit: string;
  license: 'CC BY 4.0';
}

export const MODEL_LIBRARY: readonly LibraryModel[] = [
  {
    id: 'glam-velvet-sofa',
    url: '/models/library/glam-velvet-sofa.glb',
    match: /(?<!\p{L})(sofa|couch|settee|canap[ée]|seza)(?!\p{L})/iu,
    credit: 'Glam Velvet Sofa © 2021 Wayfair, LLC',
    license: 'CC BY 4.0',
  },
  {
    id: 'car-concept',
    url: '/models/library/car-concept.glb',
    match: /(?<!\p{L})(car|automobile|voiture|fiara)(?!\p{L})/iu,
    credit: 'Car Concept © 2024 Darmstadt Graphics Group GmbH',
    license: 'CC BY 4.0',
  },
];

/** The library model for a detection label, or null when the library has none. */
export function matchLibraryModel(label: string | null | undefined): LibraryModel | null {
  if (!label) return null;
  return MODEL_LIBRARY.find((m) => m.match.test(label)) ?? null;
}
