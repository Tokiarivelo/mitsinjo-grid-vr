import {
  APPLIANCE_CATALOG,
  SECTOR_IDS,
  HORIZON_H,
  type Appliance,
  type InputPatch,
  type SectorCap,
  type SectorId,
} from '@mitsinjo/engine';
import { withSectorCap } from '@/features/strategy-lab/utils/sector-caps';
import type { SceneModel } from '../types';

/**
 * The dispatcher's mixing desk in VR (VS-T34), pure: one fader per sector (its kW limit), one per
 * appliance wired straight to the dispatcher (`connectionMode: 'ems'`, its duty), and the battery's
 * master fader (its reserve). Every move becomes an engine input patch from the shown hour to the
 * end of the day; the engine computes what is served. Nothing is applied here.
 */

/** A fader at or above this level means « no limit » (the top notch). */
export const FADER_FULL = 0.98;
/** Battery reserve bounds on the master fader (% SoC kept back). */
export const RESERVE_MIN_PCT = 5;
export const RESERVE_MAX_PCT = 90;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const hourOf = (hour: number) => Math.max(0, Math.min(HORIZON_H - 1, Math.floor(hour)));

/** A sector fader: full scale = what the sector asks now (or its limit, if higher). */
export interface SectorFader {
  /** kW at the top of the fader; 0 = nothing to send (fader disabled). */
  scaleKw: number;
  /** 0–1 fader position. */
  level: number;
  /** The sector's active limit, null = none (fader at the top). */
  limitKw: number | null;
  cut: boolean;
}

export function sectorFader(demandKw: number, cap: SectorCap | null): SectorFader {
  const scaleKw = Math.max(demandKw, cap?.maxKw ?? 0);
  const limitKw = cap ? cap.maxKw : null;
  const level = limitKw === null || scaleKw <= 0 ? 1 : clamp01(limitKw / scaleKw);
  return { scaleKw, level, limitKw, cut: limitKw === 0 };
}

/**
 * The fader moved to `level` on a sector: a limit of `level × scaleKw` from the shown hour, or no
 * limit at the top notch. Null when nothing would change.
 */
export function sectorLevelPatch(
  sector: SectorId,
  level: number,
  scaleKw: number,
  caps: readonly SectorCap[] | undefined,
  hour: number
): InputPatch | null {
  const current = caps?.find((c) => c.sector === sector) ?? null;
  if (clamp01(level) >= FADER_FULL) {
    return current ? { sectorCaps: withSectorCap(caps, sector, null) } : null;
  }
  if (scaleKw <= 0) return null;
  const maxKw = round1(clamp01(level) * scaleKw);
  const fromHour = hourOf(hour);
  if (current && current.maxKw === maxKw && current.fromHour <= fromHour) return null;
  return { sectorCaps: withSectorCap(caps, sector, { maxKw, fromHour, toHour: HORIZON_H }) };
}

/** The duty profile an appliance runs at full level: its category's (inserted lines carry none). */
function baseDuty(a: Appliance): readonly number[] {
  return APPLIANCE_CATALOG[a.category].hourlyDuty;
}

/** Appliance fader position at `hour`: its duty against its category's (1 = as catalogued). */
export function applianceLevel(a: Appliance, hour: number): number {
  const t = hourOf(hour);
  const base = baseDuty(a)[t] ?? 0;
  const duty = a.hourlyDuty?.[t] ?? base;
  if (base <= 0) return duty > 0 ? 1 : a.hourlyDuty ? 0 : 1;
  return clamp01(duty / base);
}

/**
 * The fader of one appliance moved to `level`: its duty becomes `level ×` its category's from the
 * shown hour (earlier hours unchanged); the top notch back on a plain profile drops the override.
 * Null when the appliance is unknown or nothing would change.
 */
export function applianceLevelPatch(
  appliances: readonly Appliance[] | undefined,
  id: string,
  level: number,
  hour: number
): InputPatch | null {
  const list = appliances ?? [];
  const target = list.find((a) => a.id === id);
  if (!target) return null;
  const t0 = hourOf(hour);
  const base = baseDuty(target);
  const k = clamp01(level) >= FADER_FULL ? 1 : clamp01(level);
  const duty = base.map((b, t) =>
    t < t0 ? (target.hourlyDuty?.[t] ?? b) : Math.round(b * k * 1000) / 1000
  );
  const plain = duty.every((d, t) => d === base[t]);
  const next: Appliance = { ...target };
  if (plain) delete next.hourlyDuty;
  else next.hourlyDuty = duty;
  const same =
    JSON.stringify(next.hourlyDuty ?? null) === JSON.stringify(target.hourlyDuty ?? null);
  if (same) return null;
  return { appliances: list.map((a) => (a.id === id ? next : a)) };
}

/** Master fader → battery reserve: up = more of the battery dispatched (lower reserve). */
export function reserveOfLevel(level: number): number {
  return Math.round(RESERVE_MAX_PCT - clamp01(level) * (RESERVE_MAX_PCT - RESERVE_MIN_PCT));
}

/** Battery reserve → master fader position (inverse of `reserveOfLevel`). */
export function levelOfReserve(minSocPct: number): number {
  return clamp01((RESERVE_MAX_PCT - minSocPct) / (RESERVE_MAX_PCT - RESERVE_MIN_PCT));
}

/** The master fader moved: the new battery reserve, null when unchanged. */
export function reserveLevelPatch(level: number, minSocPct: number): InputPatch | null {
  const next = reserveOfLevel(level);
  return next === Math.round(minSocPct) ? null : { minSocPct: next };
}

export interface MixerBatteryStrip {
  /** Engine: state of charge at the shown hour (%). */
  socPct: number;
  /** Input: reserve kept back (%). */
  minSocPct: number;
  /** Master fader position (`levelOfReserve`). */
  level: number;
}

export interface MixerSectorStrip {
  sector: SectorId;
  fader: SectorFader;
  /** Engine: what the sector is served at the shown hour (kW). */
  servedKw: number;
}

export interface MixerApplianceStrip {
  id: string;
  name: string;
  /** Fader position 0–1 (its duty against its category's). */
  level: number;
  /** Engine: its load at the shown hour (kW). */
  kwNow: number;
}

/**
 * The desk's strips: the battery, the six sectors, then every appliance wired straight to the
 * dispatcher (`connectionMode: 'ems'`, added from /village) — new ones join on their own.
 */
export function dispatchMixerStrips(
  model: Pick<SceneModel, 'battery' | 'buildings' | 'appliances' | 'timeIndex'>,
  caps: readonly SectorCap[] | undefined,
  appliances: readonly Appliance[] | undefined,
  minSocPct: number
): {
  mixerBattery: MixerBatteryStrip;
  mixerSectors: MixerSectorStrip[];
  mixerAppliances: MixerApplianceStrip[];
} {
  const byId = new Map((appliances ?? []).map((a) => [a.id, a]));
  return {
    mixerBattery: { socPct: model.battery.socPct, minSocPct, level: levelOfReserve(minSocPct) },
    mixerSectors: SECTOR_IDS.map((sector) => ({
      sector,
      fader: sectorFader(
        model.buildings[sector].demandKw,
        caps?.find((c) => c.sector === sector) ?? null
      ),
      servedKw: model.buildings[sector].servedKw,
    })),
    mixerAppliances: model.appliances.flatMap((m) => {
      const a = m.connectionMode === 'ems' ? byId.get(m.id) : undefined;
      return a
        ? [{ id: m.id, name: m.name, level: applianceLevel(a, model.timeIndex), kwNow: m.kwNow }]
        : [];
    }),
  };
}
