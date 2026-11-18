import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FaceName } from '@/lib/object-shape';

/**
 * Prepared answers of three 360° tour objects (VS-T52, offline mock only): realistic drawings of
 * every face and a glTF model, made in Blender from the tour photo (`video/blender/`, `make
 * prepared-models`). With no Meta model, these objects answer with them instead of their
 * hand-built recipe drawings; the recipe stays the model's footprint and size in the village.
 * Files: `public/models/prepared/<id>/` (`model.glb`, `front|right|back|left|top[|bottom].png`).
 */
export const PREPARED_IDS = ['hall-sofa', 'street-car-white', 'terrace-house'] as const;

const BASE = '/models/prepared';

function isPrepared(id: string): boolean {
  return (PREPARED_IDS as readonly string[]).includes(id);
}

/** Public URL of the prepared model of `id`, or null when it has none. */
export function preparedModelUrl(id: string): string | null {
  return isPrepared(id) ? `${BASE}/${id}/model.glb` : null;
}

/** File name of one view: the main view is a car's profile (`right`) and any other object's front. */
export function preparedViewKey(face: FaceName | 'main', vehicle: boolean): string {
  if (face === 'main') return vehicle ? 'right' : 'front';
  return face === 'side' ? 'right' : face;
}

/** The prepared drawing of one face (PNG), or null: not a prepared object, or no such view. */
export async function preparedDrawing(
  id: string,
  face: FaceName | 'main',
  vehicle: boolean
): Promise<Buffer | null> {
  if (!isPrepared(id)) return null;
  const file = join(process.cwd(), 'public', BASE, id, `${preparedViewKey(face, vehicle)}.png`);
  return readFile(file).catch(() => null);
}
