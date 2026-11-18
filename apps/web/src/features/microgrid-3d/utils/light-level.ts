import type { BuildingSceneModel } from '../types';
import { glowFromIntensity } from './scene-palette';
import { lampLevel } from './sim-xr-place';

/**
 * How bright a building's windows and lamps are (0..1) from what the engine serves it: the same
 * coverage rule as the rooms you enter (`lampLevel`), so a sector capped to half its demand glows
 * at half. Unpowered, cut, unserved or burning: dark. Without a coverage figure, the load intensity
 * (at least 0.65 so a lit house reads as lit).
 */
export function buildingLightLevel(model: BuildingSceneModel): number {
  const hasPower =
    model.connected &&
    model.servedKw > 0.05 &&
    model.status !== 'unserved' &&
    model.status !== 'disconnected' &&
    (model.coveragePct === null || model.coveragePct > 0) &&
    !model.onFire;
  if (!hasPower) return 0;
  if (model.coveragePct === null) return Math.max(0.65, glowFromIntensity(model.intensity));
  return lampLevel(model.coveragePct, model.servedKw);
}
