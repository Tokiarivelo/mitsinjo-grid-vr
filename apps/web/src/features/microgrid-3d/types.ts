import type { ApplianceMarkerSceneModel } from './utils/appliance-markers';
import type { SectorPole } from './utils/cable-route';
import type { SectorId, Priority, StrategyId, WeatherId, SectorMode } from '@mitsinjo/engine';

/** `unknown` = no simulation result for this step yet. */
/** `disconnected`: sector load set to 0 (e.g. the factory before it is connected). */
export type BuildingStatus = 'full' | 'partial' | 'unserved' | 'unknown' | 'disconnected';
export type StatusColor = 'battery-green' | 'warning-amber' | 'critical-red' | 'idle';
export type BatteryStatusColor = 'healthy' | 'warning' | 'critical';

import type { BreakerState, ControllerMode } from '@mitsinjo/engine';
export type { BreakerState, ControllerMode };

export interface FeederSceneModel {
  mode: SectorMode;
  servedKw: number;
  /** Intensity 0..1 relative to the sector's daily peak served kW from the engine result. */
  intensity: number;
  /** 0..1 share of what the controller dispatches this hour (0 when nothing is served). */
  share: number;
  breaker: BreakerState;
}

export interface ControllerSceneModel {
  mode: ControllerMode;
  feeders: Record<SectorId, FeederSceneModel>;
}

export interface BuildingSceneModel {
  id: SectorId;
  nameKey: string;
  position: [number, number, number];
  priority: Priority;
  demandKw: number;
  servedKw: number;
  unservedKw: number;
  /** Null when there is no result for this step. */
  coveragePct: number | null;
  status: BuildingStatus;
  statusColor: StatusColor;
  isCritical: boolean;
  /** False when the sector's load multiplier is 0 (not connected to the grid). */
  connected: boolean;
  /** Sector load multiplier from the input (× 0–3, default 1). */
  loadMultiplier: number;
  /** Intensity 0..1 relative to the sector's daily peak served kW from the engine result (PL-T9/PL-T12). */
  intensity: number;
  /** Feeder / sector mode from engine (PL-T12). */
  mode: SectorMode;
  /** A fire event burns in this sector at the shown hour (F1): the engine cut it to 0 kW. */
  onFire: boolean;
  /** True when the sector is on fire or has an active critical incident (PA-T4c). */
  inAlert?: boolean;
}

export interface SolarSceneModel {
  position: [number, number, number];
  peakKw: number;
  currentKw: number;
  glowIntensity: number; // 0 to 1
  isGenerating: boolean;
}

export interface BatterySceneModel {
  position: [number, number, number];
  capacityKwh: number;
  socPct: number;
  flowKw: number;
  isCharging: boolean;
  isDischarging: boolean;
  isIdle: boolean;
  statusColor: BatteryStatusColor;
}

export interface LineFlowSceneModel {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  flowKw: number;
  direction: 'forward' | 'backward' | 'idle';
  speed: number;
  color: string;
  /** Burning sector (F1): the line is isolated — red break mark in 3D/2D (M2-T3). */
  cut?: boolean;
}

export interface SceneModel {
  timeIndex: number;
  timeLabel: string;
  sunElevation: number; // in radians or degrees (0 at sunrise/sunset, 1 at noon, negative at night)
  sunIntensity: number; // 0 to 1 for scene directional light
  isDaytime: boolean;
  isModified: boolean;
  hasResult: boolean;
  strategy: StrategyId;
  /** Weather of the simulated day shown (sky, clouds, rain). Solar kW already reflects it. */
  weather: WeatherId;
  controller: ControllerSceneModel;
  solar: SolarSceneModel;
  battery: BatterySceneModel;
  buildings: Record<SectorId, BuildingSceneModel>;
  /** Appliances inserted from the village editor (PV-T13), next to their sector building. */
  appliances: ApplianceMarkerSceneModel[];
  lines: {
    solarToBattery: LineFlowSceneModel;
    batteryToBus: LineFlowSceneModel;
    busToSectors: Record<SectorId, LineFlowSceneModel>;
    /** Appliance derivations from tap points (PI-T7). */
    applianceDerivations?: LineFlowSceneModel[];
    /** Derivation utility poles mapped to their sector feeder (PI-T7). */
    appliancePoles?: SectorPole[];
  };
}

export type { ApplianceMarkerSceneModel, SectorPole };

export type CameraPreset =
  'village' | 'solar' | 'battery' | 'essential' | 'controller' | 'immersion';
