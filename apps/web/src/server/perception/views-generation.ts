import 'server-only';

import sharp from 'sharp';
import type { ObjectRecipe, ShapeTarget } from '@/lib/object-shape';
import { CANONICAL_ANGLES, type CanonicalAngle, type ImaginedAngleView } from '@/lib/object-shape';
import { archetypeOf } from '@/lib/object-kit';
import { renderFlat, type FlatView } from './flat-render';

/** Canonical views for the 6 angles of 2D imagination. */
export const CANONICAL_FLAT_VIEWS: Record<
  CanonicalAngle,
  { view: FlatView; deg: number; labelKey: string }
> = {
  front: { view: { yaw: 0, pitch: 0 }, deg: 0, labelKey: 'angleFront' },
  left: { view: { yaw: Math.PI / 2, pitch: 0 }, deg: 90, labelKey: 'angleLeft' },
  back: { view: { yaw: Math.PI, pitch: 0 }, deg: 180, labelKey: 'angleBack' },
  right: { view: { yaw: -Math.PI / 2, pitch: 0 }, deg: 270, labelKey: 'angleRight' },
  top: { view: { yaw: 0, pitch: (82 * Math.PI) / 180 }, deg: 0, labelKey: 'angleTop' },
  three_quarter: {
    view: { yaw: (35 * Math.PI) / 180, pitch: (20 * Math.PI) / 180 },
    deg: 35,
    labelKey: 'angleThreeQuarter',
  },
};

/** Anatomical descriptions and key features per archetype and angle. */
export function getAngleAnatomy(
  archetype: string,
  angle: CanonicalAngle
): { description: string; features: string[] } {
  switch (archetype) {
    case 'vehicle':
      switch (angle) {
        case 'front':
          return {
            description:
              'Front view with aerodynamic hood, headlights, grille, and windshield rake.',
            features: [
              'Front radiator grille',
              'Twin glass headlights',
              'Bumper protection rail',
              '30° sloped windshield rake',
            ],
          };
        case 'left':
          return {
            description: 'Left side profile showing wheelbase, roofline, doors, and wheel arches.',
            features: [
              'Compact vehicle profile',
              'Front & rear wheel arches',
              'Rubber tires with stance',
              'Side window greenhouse',
            ],
          };
        case 'right':
          return {
            description: 'Right side profile confirming bilateral symmetry and body clearance.',
            features: [
              'Symmetrical side profile',
              'Ground clearance height',
              'Side window pillar line',
              'Undercarriage chassis plane',
            ],
          };
        case 'back':
          return {
            description: 'Rear view with sloped fastback window, boot lid, taillights, and bumper.',
            features: [
              'Sloped rear fastback window',
              'Twin vertical taillights',
              'Trunk and boot line',
              'Rear bumper rail',
            ],
          };
        case 'top':
          return {
            description:
              "Bird's-eye overhead view showing roof contour, hood curvature, and wheel track.",
            features: [
              'Full roof panel curvature',
              'Front hood taper',
              'Windshield slope depth',
              'Wheel track width',
            ],
          };
        case 'three_quarter':
          return {
            description:
              'Three-quarter volumetric perspective showing full 3D spatial form and depth.',
            features: [
              'Complete 3D volume',
              'Realistic ground clearance',
              'Reflective studio lighting',
              'Proportional vehicle balance',
            ],
          };
      }
      break;

    case 'house':
    case 'building':
      switch (angle) {
        case 'front':
          return {
            description:
              'Front facade showing entry door, ground/upper floor windows, and roofline.',
            features: [
              'Entry door with lintel',
              'Symmetrical window bays',
              'Stone masonry base',
              'Eaves line',
            ],
          };
        case 'left':
        case 'right':
          return {
            description: 'Side gable elevation showing roof pitch angle and wall depth.',
            features: [
              'Gable triangle apex',
              'Overhanging roof eaves',
              'Verge overhang',
              'Masonry depth',
            ],
          };
        case 'back':
          return {
            description: 'Rear facade showing upper windows and stone wall course.',
            features: [
              'Rear facade wall',
              'Upper floor windows',
              'Roof ridge line',
              'Drainage eave',
            ],
          };
        case 'top':
          return {
            description: 'Overhead roof plan view showing slate/tile slopes and chimney ridge.',
            features: [
              'Pitched roof slopes',
              'Central roof ridge',
              'Chimney stack',
              'Perimeter eaves',
            ],
          };
        case 'three_quarter':
          return {
            description: 'Three-quarter architectural perspective showing facade and gable depth.',
            features: [
              'Volumetric house form',
              'Roof pitch to wall scale',
              'Window recess depth',
              'Ground footprint',
            ],
          };
      }
      break;

    case 'tree':
      switch (angle) {
        case 'top':
          return {
            description: 'Overhead view showing radial canopy branch spread and foliage density.',
            features: [
              'Radial foliage spread',
              'Canopy crown density',
              'Natural organic asymmetry',
            ],
          };
        case 'three_quarter':
          return {
            description: 'Three-quarter organic view showing layered canopy depth and trunk taper.',
            features: [
              'Multi-tier canopy volume',
              'Trunk taper and roots',
              'Organic foliage clusters',
            ],
          };
        default:
          return {
            description:
              'Lateral view showing trunk elevation, branch bifurcation, and crown spread.',
            features: ['Bark trunk column', 'Foliage canopy mass', 'Realistic tree proportions'],
          };
      }

    default:
      switch (angle) {
        case 'top':
          return {
            description: 'Overhead plan view showing object footprint and top surface.',
            features: ['Top surface plane', 'Footprint outline', 'Perimeter bounds'],
          };
        case 'three_quarter':
          return {
            description: 'Three-quarter view displaying depth, height, and width together.',
            features: ['Full 3D volume', 'Studio illumination', 'Material surface finish'],
          };
        default:
          return {
            description: `${angle.toUpperCase()} elevation view displaying proportions and outline.`,
            features: ['Primary bounding silhouette', 'Surface material look', 'Spatial alignment'],
          };
      }
  }
}

/**
 * Generates the 6 canonical 2D imagined views (front, left, back, right, top, 3/4)
 * rendered from the 3D recipe with studio lighting and anatomical feature callouts.
 */
export async function generateImaginedViews(
  recipe: ObjectRecipe,
  target: Pick<ShapeTarget, 'label' | 'category' | 'scenery'>,
  photoAspect = 1,
  size = 256
): Promise<ImaginedAngleView[]> {
  const archetype = archetypeOf(target);
  const views: ImaginedAngleView[] = [];

  for (const angle of CANONICAL_ANGLES) {
    const config = CANONICAL_FLAT_VIEWS[angle];
    const flat = renderFlat(recipe, photoAspect, size, size, config.view);

    // Composite flat render onto a sleek dark studio background:
    const bgR = 26;
    const bgG = 29;
    const bgB = 36;
    const n = size * size;
    const out = new Uint8Array(n * 4); // RGBA

    for (let i = 0; i < n; i++) {
      const isForeground = flat.mask.data[i] === 1;
      const idx = i * 4;
      const rgbIdx = i * 3;
      if (isForeground) {
        out[idx] = flat.rgb[rgbIdx]!;
        out[idx + 1] = flat.rgb[rgbIdx + 1]!;
        out[idx + 2] = flat.rgb[rgbIdx + 2]!;
        out[idx + 3] = 255;
      } else {
        // Studio subtle radial shading
        const row = Math.floor(i / size);
        const col = i % size;
        const dx = (col - size / 2) / (size / 2);
        const dy = (row - size / 2) / (size / 2);
        const dist = Math.min(1, Math.hypot(dx, dy));
        const factor = 1 - dist * 0.25;

        out[idx] = Math.round(bgR * factor);
        out[idx + 1] = Math.round(bgG * factor);
        out[idx + 2] = Math.round(bgB * factor);
        out[idx + 3] = 255;
      }
    }

    const png = await sharp(Buffer.from(out.buffer), {
      raw: { width: size, height: size, channels: 4 },
    })
      .png()
      .toBuffer();

    const imageUrl = `data:image/png;base64,${png.toString('base64')}`;
    const anatomy = getAngleAnatomy(archetype, angle);

    views.push({
      angle,
      labelKey: config.labelKey,
      angleDeg: config.deg,
      description: anatomy.description,
      imageUrl,
      features: anatomy.features,
    });
  }

  return views;
}
