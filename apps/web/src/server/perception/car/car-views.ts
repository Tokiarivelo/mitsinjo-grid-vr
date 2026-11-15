import 'server-only';

import { DRAWING_BACKGROUND } from '../facade-specialist';

/**
 * The drawings of a vehicle (PQ-T76, user 2026-11-14): a car is drawn from its PROFILE first (its
 * length, wheels and windows are there), then its front, back, view from above and underside, each
 * from the profile and the views already drawn. The left side is not drawn: it is the right one
 * mirrored. Every prompt keeps the conventions the reconstruction reads: the profile with the front
 * to the RIGHT of the image, the views from above and below with the front at the BOTTOM.
 */

export const CAR_FACES = ['front', 'back', 'top', 'bottom'] as const;
export type CarFace = (typeof CAR_FACES)[number];

/**
 * Drawn with flat light: no ground shadow (it merges with the tyres), no reflections. A function:
 * `facade-specialist` imports this module, its background is read once both are loaded.
 */
const carStyle = () =>
  `Clean technical illustration with flat even light: no ground, no cast shadow under the vehicle, no reflections of the surroundings, the paint in its own colour. The whole vehicle centred on a ${DRAWING_BACKGROUND}, no text, no dimension lines.`;

/** Asked with the photo crop: whatever the angle of the photo, the drawing is the profile. */
export const CAR_PROFILE_FROM_PHOTO =
  'Draw exactly the vehicle inside the clear rectangle of the reference photo: same model, body shape, proportions, colours, wheels, windows and details. The photo may show its front, its back or a three-quarter view: redraw it all the same as a true SIDE PROFILE, its right side seen straight on at mid-height, its FRONT pointing to the RIGHT of the image, its full length visible with both axles, every horizontal line perfectly horizontal, no vanishing point and no second face receding to the side. Complete the parts hidden by people, plants or other vehicles. Do not draw the background or anything else from the photo.';

/** The first drawing of a vehicle: its right-side profile (with the photo: `CAR_PROFILE_FROM_PHOTO`). */
export function buildCarProfilePrompt(label: string, fromPhoto: boolean): string {
  const base = `Orthographic side elevation (profile) of a complete vehicle, ${label}. Straight-on view of its right side at mid-height, its front pointing to the RIGHT of the image, the whole length with both wheels touching the same ground line, the side windows, door lines, lamps and bumpers, unoccluded. ${carStyle()}`;
  return fromPhoto ? `${base} ${CAR_PROFILE_FROM_PHOTO}` : base;
}

const CAR_FACE_ASK: Record<CarFace, string> = {
  front:
    'Draw the FRONT view of the very same vehicle, seen straight on from in front at headlight height (orthographic, no perspective, perfectly symmetrical): the same total height as the profile with the roof, bonnet, bumper and wheels at the same heights; its real width (a car is a little wider than it is high, the wing mirrors sticking out on both sides); the windscreen, headlights, grille, bumper, number plate and both front tyres at the bottom.',
  back: 'Draw the REAR view of the very same vehicle, seen straight on from behind at lamp height (orthographic, no perspective, perfectly symmetrical): the same heights as the profile and the same width as the front view; the rear window, tail lights, boot lid or tailgate, bumper, number plate and both rear tyres at the bottom.',
  top: "Draw the very same vehicle seen from DIRECTLY ABOVE, looking straight down (plan view, orthographic, no perspective). Its length runs from the top of the image to the bottom (never lying sideways): its FRONT at the BOTTOM of the image, its rear at the top. Its length is the profile's length, its width the front view's width; the bonnet, windscreen, roof, rear window and boot seen from above, the wing mirrors on both sides.",
  bottom:
    'Draw the very same vehicle seen from DIRECTLY BELOW, looking straight up at its underside (orthographic, no perspective). Its length runs from the top of the image to the bottom: its FRONT at the BOTTOM of the image, its rear at the top. Same length and width as the view from above; the floor pan, the four tyres, the axles, the exhaust and the fuel tank, in dark greys, the edges of the body in its paint colour.',
};

/**
 * Prompt of one view of a vehicle. `known` = images sent as references: the profile first, then
 * the views already drawn. `userPrompt` = the operator's own details.
 */
export function buildCarFacePrompt(
  face: CarFace,
  label: string,
  { known = 1, userPrompt }: { known?: number; userPrompt?: string } = {}
): string {
  const refs =
    known > 1
      ? `The first reference image is the side profile of one ${label} (its front to the right), the ${known - 1} other${known > 2 ? 's are' : ' is'} the same vehicle already drawn from another side: every view must agree.`
      : `The reference image is the side profile of one ${label}, its front pointing to the right.`;
  let prompt = `${refs} ${CAR_FACE_ASK[face]} Same model, same proportions, same colours, materials and details, same drawing style and scale. ${carStyle()}`;
  const extra = userPrompt?.trim();
  if (extra) prompt += ` Additional required features: ${extra}.`;
  return prompt;
}
