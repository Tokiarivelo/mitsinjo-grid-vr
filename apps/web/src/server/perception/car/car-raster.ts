import { CAR_SLOTS, type CarMesh, type CarSlot } from '@/lib/car-mesh';
import { rasterMesh, type MeshRasterOptions } from '../recon/mesh-raster';

/**
 * Offline picture of a car mesh (PQ-T78), for the replays (`make car-replay` → `car-sheet.png`):
 * `rasterMesh` on the car's slots.
 */

export type CarRasterOptions = MeshRasterOptions<CarSlot>;
export type { RasterAtlas } from '../recon/mesh-raster';

/** The car as an sRGB picture (`size` × `size`, 3 bytes per pixel, white paper). */
export const rasterCar = (mesh: CarMesh, options: CarRasterOptions): Uint8Array =>
  rasterMesh(mesh, CAR_SLOTS, options);
