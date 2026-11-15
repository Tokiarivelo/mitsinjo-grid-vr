import {
  checkConstitution,
  clinicGuard,
  DEFAULT_CONSTITUTION,
  type InputPatch,
  type SectorCap,
  type SectorId,
} from '@mitsinjo/engine';
import { withSectorCap } from '@/features/strategy-lab/utils/sector-caps';

/** One press of « − / + » on the VR power panel (kW). */
export const POWER_STEP_KW = 0.5;

/** What the VR building panel asks for (VSIM-T3). */
export type SectorPowerAction = 'less' | 'more' | 'cut' | 'restore';

const round1 = (kw: number) => Math.round(kw * 10) / 10;

/**
 * The input patch for one power action on a sector, from the shown hour to the end of the day
 * (same window as the copilot's « now »). The engine computes the result; nothing is applied here.
 * `less` starts from the active limit, else from what the sector is served now; `more` raises an
 * active limit only; `cut` = limit 0 kW; `restore` removes the limit. Returns null when nothing
 * would change (already cut, no limit to raise or remove).
 */
export function sectorPowerPatch(
  action: SectorPowerAction,
  sector: SectorId,
  caps: readonly SectorCap[] | undefined,
  servedKw: number,
  hour: number
): InputPatch | null {
  const current = caps?.find((c) => c.sector === sector);
  const fromHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const window = { fromHour, toHour: 24 };
  const set = (maxKw: number): InputPatch => ({
    sectorCaps: withSectorCap(caps, sector, { maxKw: Math.max(0, round1(maxKw)), ...window }),
  });
  switch (action) {
    case 'less': {
      const base = current ? current.maxKw : servedKw;
      if (base <= 0) return null;
      return set(base - POWER_STEP_KW);
    }
    case 'more':
      return current ? set(current.maxKw + POWER_STEP_KW) : null;
    case 'cut':
      return current?.maxKw === 0 && current.fromHour <= fromHour ? null : set(0);
    case 'restore':
      return current ? { sectorCaps: withSectorCap(caps, sector, null) } : null;
  }
}

/** The limit shown on the panel: the sector's cap, if any. */
export function sectorCapOf(
  caps: readonly SectorCap[] | undefined,
  sector: SectorId
): SectorCap | null {
  return caps?.find((c) => c.sector === sector) ?? null;
}

/**
 * Hard rules a VR power action may not break (village constitution, clinic guard K6): the clinic is
 * never cut nor dropped below its off threshold. True = the panel refuses the action.
 */
export function breaksConstitution(patch: InputPatch): boolean {
  if (clinicGuard(patch).length > 0) return true;
  return checkConstitution(DEFAULT_CONSTITUTION, { patch }).violations.length > 0;
}
