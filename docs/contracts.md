# Contracts — single source of truth

Implement as Zod in `packages/engine/src/schemas/`; export inferred types from `index.ts`.
Changing a field = update this file + schema + tests in the same commit.

## Units

- Horizon 24 h, step `stepH = 1` h → per-step power in **kW** (average) equals energy in **kWh** for that step.
- Power fields end with `Kw`, energy fields `Kwh`, percentages `Pct` (0–100), ratios 0–1 (no suffix).
- `batteryKw` > 0 = charging, < 0 = discharging.

## Ids

```ts
type SectorId = 'health' | 'water' | 'school' | 'households' | 'market' | 'industry'; // SECTOR_IDS
type Priority = 'critical' | 'high' | 'medium' | 'low';
type StrategyId = 'proportional' | 'essential_first' | 'balanced'; // balanced = stretch
type SimStatus = 'ready' | 'modified' | 'running' | 'complete' | 'error';
type ScenarioId =
  | 'baseline'
  | 'cloudy_afternoon'
  | 'high_demand'
  | 'battery_constraint'
  | 'essential_stress'
  | 'meter_anomaly'
  | 'village_fire'
  | 'overload_evening';
```

```ts
// PV vision insert (schemas/appliance.ts)
type ApplianceCategory =
  | 'fridge'
  | 'freezer'
  | 'tv'
  | 'lamp'
  | 'fan'
  | 'laptop'
  | 'phone_charger'
  | 'radio'
  | 'water_pump'
  | 'rice_mill'
  | 'sewing_machine'
  | 'welder'
  | 'fridge_vaccine'
  | 'computer'
  | 'other'; // APPLIANCE_CATEGORIES
interface ApplianceSpec {
  category: ApplianceCategory;
  defaultW: number;
  minW: number;
  maxW: number; // W, min ≤ default ≤ max
  hourlyDuty: number[];
} // 24 values 0–1 (HourlyDutySchema)
interface Appliance {
  id: string; // 1–64, unique in the list
  name: string; // 1–40 (trimmed)
  category: ApplianceCategory;
  sector: SectorId;
  watts: number; // one unit, within APPLIANCE_CATALOG[category] minW–maxW
  quantity: number; // int 1–50
  hourlyDuty?: number[]; // 24 values 0–1, default = catalog profile
  position?: { x: number; z: number }; // PP-T1: scene units, |x|,|z| ≤ 110 (terrain box); visual only, ignored by the load model and the input hash
}
```

## Input

```ts
interface SectorConfig {
  id: SectorId;
  label: string;
  priority: Priority;
  criticalShare: number; // 0–1, part of demand that is critical (health 0.8, others lower)
  profileKw: number[]; // length 24, hourly demand kW
  flexible: boolean; // shiftable load (water pump) — used only by stretch features
  meterReadings?: number[]; // length 24, optional measured demand override
  lifelineKw?: number; // ≥ 0, survival power floor (kW; defaults in DEFAULT_LIFELINE_KW)
  loadMultiplier?: number; // 0–3, live load factor on profileKw (absent = 1, 0 = not connected)
}
interface BatteryConfig {
  capacityKwh: number;
  initialSocPct: number;
  minSocPct: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  chargeEff: number;
  dischargeEff: number; // 0–1
}
interface SolarConfig {
  peakKw: number;
  profile: number[];
} // profile length 24, 0–1
type ScenarioEvent =
  | { type: 'solar_drop'; startHour: number; durationH: number; factor: number } // factor 0.6 = −40 %
  | {
      type: 'demand_spike';
      sector: SectorId | 'all';
      startHour: number;
      durationH: number;
      factor: number;
    }
  | { type: 'fire'; sector: SectorId; startHour: number; durationH: number }; // F1: sector at 0 kW, beats caps + floor
interface SectorCap {
  sector: SectorId;
  maxKw: number; // ≥ 0
  fromHour: number; // 0–23
  toHour: number; // 1–24, fromHour < toHour
}
interface SimulationInput {
  scenarioId: ScenarioId | 'custom';
  horizonH: 24;
  stepH: 1;
  solar: SolarConfig;
  battery: BatteryConfig;
  sectors: SectorConfig[];
  events: ScenarioEvent[];
  demandMultiplier: number; // global, 0.5–2
  sectorCaps?: SectorCap[];
  strategyParams?: {
    balancedWeights?: Record<Priority, number>;
    lifeline?: { enabled: boolean }; // default enabled
  };
  appliances?: Appliance[]; // ≤ MAX_APPLIANCES (30); absent = none (PV)
}
```

Validation bounds (Zod, reject — never silently clamp): `peakKw 0–500`, `capacityKwh 1–2000`,
`initialSocPct/minSocPct 0–100` with `min < initial`, effs `0.5–1`, `factor 0–3`,
`startHour 0–23`, `startHour + durationH ≤ 24`, `durationH 1–24`, exactly `SECTOR_IDS.length` (6) sectors with unique ids, `sector.loadMultiplier 0–3`,
`sector.lifelineKw ≥ 0` (defaults: health 0.3, water 0.2, school 0.1, households 0.4, market 0.1, industry 0),
`sectorCaps` `maxKw 0–500`, `fromHour 0–23`, `toHour 1–24`, `fromHour < toHour`,
`strategyParams.balancedWeights` weights 0–10, at least one > 0 (defaults 4/3/2/1),
`strategyParams.lifeline.enabled` boolean (default true).

## Result

```ts
type SectorMode = 'full' | 'limited' | 'lifeline' | 'off';

interface SectorStep {
  demandKw: number;
  servedKw: number;
  criticalDemandKw: number;
  criticalServedKw: number;
  lifelineServedKw: number;
  mode: SectorMode;
}
interface StepResult {
  t: number; // hour index 0–23
  solarKw: number;
  demandKw: number;
  servedKw: number;
  unservedKw: number;
  batteryKw: number;
  socPct: number;
  curtailedKw: number;
  sectors: Record<SectorId, SectorStep>;
}
interface SectorMetrics {
  demandKwh: number;
  servedKwh: number;
  unservedKwh: number;
  coveragePct: number;
}
interface Metrics {
  demandKwh: number;
  servedKwh: number;
  unservedKwh: number;
  criticalDemandKwh: number;
  criticalUnservedKwh: number;
  criticalUnmetHours: number;
  criticalCoveragePct: number; // essential-services coverage shown in UI (from criticalShare, all sectors)
  lifelineCoveragePct: number; // % of sector-hours where the cap-aware lifeline floor is held
  affectedSectors: SectorId[]; // sectors with unservedKwh > ε
  solarKwh: number;
  curtailedKwh: number;
  socStartPct: number;
  socEndPct: number;
  socMinPct: number;
  violations: number; // must be 0; engine self-checks invariants
  perSector: Record<SectorId, SectorMetrics>;
}
type WarningCode =
  | 'CRITICAL_UNMET'
  | 'SECTOR_PARTIAL'
  | 'RESERVE_REACHED'
  | 'CURTAILMENT'
  | 'ANOMALY_TO_VERIFY'
  | 'SECTOR_CAPPED'
  | 'LIFELINE_SHORTFALL'
  | 'FIRE_ISOLATION'; // sector cut by a fire event (one range per sector)
interface SimWarning {
  code: WarningCode;
  sector?: SectorId;
  fromHour: number;
  toHour: number;
}
interface SimulationResult {
  id: string; // 'SIM-' + first 6 hex of inputHash+strategy, stable
  inputHash: string; // deterministic hash of canonical JSON input
  strategy: StrategyId;
  steps: StepResult[]; // length 24
  metrics: Metrics;
  warnings: SimWarning[];
  engineVersion: string;
}
type Comparison = Record<StrategyId, SimulationResult>; // only strategies requested
```

### Weather workflow & Chaos mode (multi-day, PA-T6c, PA-T8a)

```ts
type WeatherId = 'sunny' | 'partly_cloudy' | 'cloudy' | 'rainy' | 'storm';
type WorkflowDay = { weather: WeatherId; events?: ScenarioEvent[] };
type Workflow = WorkflowDay[]; // 1..MAX_WORKFLOW_DAYS (7)
type WorkflowTotals = {
  demandKwh;
  servedKwh;
  unservedKwh;
  criticalUnservedKwh;
  criticalUnmetHours;
  solarKwh;
  socStartPct;
  socEndPct;
  socMinPct;
  violations;
}; // sums; SoC start=day 1, end=last day, min=over all days
type WorkflowDayResult = {
  day: number;
  weather: WeatherId;
  events?: ScenarioEvent[];
  result: SimulationResult;
};
type WorkflowResult = {
  strategy: StrategyId;
  days: WorkflowDayResult[];
  totals: WorkflowTotals;
};
type WorkflowComparison = Record<StrategyId, WorkflowResult>; // only strategies requested

// Chaos mode generator (PA-T6c): pure deterministic Mulberry32 PRNG
function generateChaosWorkflow(options: {
  seed: number;
  days?: number;
  weathers?: readonly WeatherId[];
  maxIncidentsPerDay?: number;
}): Workflow;
```

Store (`useSimulationStore`): `workflow` (default `[{ weather: 'sunny' }]` = plain 24 h run), `workflowResults`,
`dayIndex`; `results` is always the comparison of day `dayIndex`. Actions `addWorkflowDay`, `removeWorkflowDay`,
`setDayWeather` (re-run at once when the run was `complete`, else → `modified`; same for add/remove), `setDayIndex`, `advancePlayback` (hour +1, rolls over to next day, loops to day 1).
`source: 'scenario' | 'device'` (PH): `applyDeviceRun({ scenarioId, patch, strategy, simHour })` loads the scenario,
applies the bridge patch, sets the strategy and hour, one-day workflow, then `run()` → `source = 'device'`,
`deviceHourMs = scale.timeScale × 1000` (null without `scale`); selectors `selectFollowsDevice`, `selectDeviceHourMs`;
`releaseDevice()` and `loadScenario` set `source = 'scenario'`.

Fire (M2): engine `activeFires(events, t): FireEvent[]`, `effectiveSectorCaps(input)` = caps + one 0 kW cap per fire.
Store `reportFire(sector)` adds `{ type: 'fire', sector, startHour: timeIndex, durationH: 24 − timeIndex }` and re-runs at
once. On a multi-day workflow the fire goes on the days instead (`reportWorkflowFire`, `lib/day-events`): shown day from
`timeIndex`, every later day 0–24 h, earlier days untouched; `clearFires` also removes these day fires (undo restores them).
A fire lasts until restored: at midnight on the playback (`advancePlayback`), every fire still burning at 23 h burns
0–24 h on the next day shown (`carryFiresOver`; single day looping → the input fire becomes 0–24 h; last day → day 1 too).
Scene, alerts and autopilot read `dayEvents(input.events, workflow, dayIndex)` (`toSceneModel({ events })`); fire alert key `fire:<sector>` (safety exception: no approval, not in `changeHistory`; no-op if that sector already burns). `BuildingSceneModel.onFire`
= burning at the shown hour; `feederTone` → `critical-red`, 2D wire `cut`.

3D `SceneModel.appliances: ApplianceMarkerSceneModel[]` (PV-T13) `{ id, name, category, sector, quantity, watts, kwNow /*engine profile at t*/, running, position /*ground y*/, feeder /*building anchor*/, tag? /*PT-11: { priority (its sector's), statusColor, inAlert } = applianceTagState(m, buildings[sector])*/ }`;
`position` = free placement when set (clamped + snapped, PP-T3), else the building ring; `feeder` anchors the thin cable link to the sector building.
Placed 3D models (PI-T1, web visual store only, zero engine change):
`PlacedModel { applianceId: string, recipe: ObjectRecipe, yaw?: number, scale?: number, archetype?: KitArchetype }`
in visual store `usePlacedModelsStore` (`apps/web/src/stores/placed-models.store.ts`), persisted in localStorage (`mitsinjo:placed-models`) with try/catch.
Pruned after each simulation input change (microtask) to `liveApplianceIds(state)` = current appliances + those in `changeHistory` (undo brings the model back). Appliances themselves are not persisted, so models do not survive a reload in practice.
Helpers:
`sceneScale(archetype, proportions)` → target scene scale (house ≈ 3.8, vehicle ≈ 2.4, cabinet/fridge ≈ 1.0, machine/pump ≈ 0.9).
`footprint(recipe, scale, yaw)` → `{ radius: number, box: FootprintBox }`.
Rendering (PI-T2): `buildPlacedModelsGeometry` merges all placed models into a single `BufferGeometry` (≤ +2 draw calls budget for up to 30 objects), sits on `terrainHeight` at the footprint's lowest point; on a slope (> 0.04) it stands on a plinth (one instanced batch) reaching the highest point; reflects departure states (dimmed if unserved or not drawing power, fiery red alert if sector on fire); rebuilt only when `placedGeometryKey` changes. Un-modeled appliances fall back to standard instanced markers.
Dynamic site zones (PI-T3): `siteZones(placed)` (pure, tested, single source of truth for keep-out zones) = `KEEP_OUT_ZONES` (static 6 sector buildings, solar, battery, bus, pond) + one circle per placed object (`radius = emprise + marge par archétype`, via `ARCHETYPE_CLEARING_MARGIN`). `applianceZoneItems(lines | markers, placedModels)` turns positioned lines into zone inputs; `readSiteZones()` / `useSiteZones()` / `usePlacedClearings(markers)` (`microgrid-3d/hooks/use-site-zones`) read them from the stores. Marker drag (`useMoveMarker`), the insert draft (`setPosition`) and `PlaceMinimap` (`zones`, `excludeId`: shows placed objects, warns when the cursor is on an obstacle) snap with `snapAwayFromBuildings(pos, clearance, { zones, excludeId })`, the line's own zone excluded: objects cannot be placed on a building footprint, pond, path corridor or another placed object (pushed towards nearest free edge). The 6 sector building positions and radii never move.
Tree clearing (PI-T4): Vegetation instances inside dynamic placed clearings (`dynamicPlacedZones(placed)`) are masked to scale 0 in the InstancedMesh without regenerating the forest. Trees restore immediately when the object is removed.
Laterite yards (PI-T5): Draped red laterite yard under each placed object (`GROUND_HEX.laterite`, plus an access track to the nearest path, irregular border via `fbm2d`), draped over the relief (+3 cm, zero z-fighting) and merged into a single BufferGeometry (≤ +1 draw call budget).
Tap point & derivation routing (PI-T6): `tapPoint(position, sector, mode, options)`: in mode `branch` (default), taps the closest utility pole along the line of its sector or the sector building itself if closer; in mode `ems` (D1), taps Dispatch EMS (`BUS_POSITION`). Evaluates obstacles in `siteZones(placed)`: if direct path is blocked, contours around obstacles with a corner pole waypoint (`contourWaypoint`) or selects an alternate candidate on the branch; a service drop straight from the building up to 6.5 scene units (no detour) generates 0 intermediate utility poles (`needsPoles: false`, `poles: []`). Pure visual geometry, zero engine change.
Appliance derivation lines & utility poles (PI-T7): `buildApplianceDerivations(appliances, buildings, { placedModels, zones })` (`tap-point.ts`). Derivation cables re-use `routeCable` (catenary sag, pole spacing ≤ 4.5, anchors at `ANCHOR_HEIGHT`). Intermediate poles are instanced with the network poles (`Instances`), added to `mapPolesToSectors` with the appliance's `sectorId`, and their street lamps follow feeder intensity (unserved/cut = dark, served = lit). Legacy straight wire disappears from `ApplianceMarkers` (`showStraightFeederLinks: false`). `ElectronFlow` follows the derivation when the appliance is active (`kwNow > NO_LOAD_KW`). Merged into `lines.applianceDerivations` and `lines.appliancePoles` (zero additional draw calls).
Grid connection selection UI (PI-T8): `ApplianceDraft.connectionMode` and `PlacedModel.connectionMode: 'branch' | 'ems'` (defaults to `'branch'`). In `ApplianceInsertPanel` (selector shown only when the object has a 3D model, `canConnect`: the mode is stored on its `PlacedModel`; objects without one stay on `'branch'`), operator selects between « On feeder branch (recommended) » and « Direct to Dispatch EMS » with accessible toggle buttons (`role="group"`, `aria-pressed`, min 44px tap targets). Reminder displays the sector that bears the load (D1: direct EMS connects visually to `BUS_POSITION`, load remains accounted on `sector`). Full i18n parity in EN, FR, MG; 3D marker drag recalculates clearings, draped yards and derivation poles on commit (`pointerup`), keeping frame rate smooth without per-frame geometry rebuilds.
2D diagram sector card adds « n added » when appliances feed the sector (`appliancesPerSector`).
2D diagram & minimap branch depiction (PI-T9): `applianceBranchRoute(sector, mode, variant, layout, slot)` (`diagram-layout.ts`; `slot` from `applianceBranchSlots(appliances)`: rank among appliances of the same sector, or among all direct-EMS ones, capped at `APPLIANCE_BRANCH_SLOTS` = 3 so extra appliances share the last node) routes 2D appliance derivation lines cleanly in both `topology` and `circuit` views. In mode `'branch'`, wires branch off the feeder line of the sector; in mode `'ems'`, wires connect directly from the EMS controller (`layout.boxes.controller`). Lines render via `FlowWire` with animated electron pulses when active, red break mark when cut/fire, and idle tone when off, ending at a styled terminal circle with title and connection metadata. `appliancePills(appliances, variant, layout)` (`appliance-pills.ts`) gives each line a named card box + route (topology: nearest free spot clear of boxes and wires, first `MAX_TOPOLOGY_PILLS` = 12; circuit: beside its card); lines without a card keep the `applianceBranchRoute` stub. On `PlaceMinimap`, the central Dispatch EMS shelter is marked at `BUS_POSITION = [0, 0, 1]`, and placed objects display their derivation path, tap connection point, utility poles, and obstacle-avoidance corner waypoints matching 3D visual geometry.
3D `SceneModel.weather: WeatherId` (from `toSceneModel({ weather })`, default `sunny`): drives sky, clouds and rain only.

### 3D and 2D SceneModel Controller & Intensity Lighting (PL-T5, PL-T9..PL-T13)

```ts
type ControllerMode = 'normal' | 'rationing' | 'lifeline_only';
type BreakerState = 'closed' | 'limited' | 'open';
type WireState = 'flow' | 'lifeline' | 'cut' | 'idle';

interface FeederSceneModel {
  mode: SectorMode;
  servedKw: number;
  intensity: number; // 0..1 relative to peak served kW of the sector
  share: number; // 0..1 of the kW the controller dispatches this hour (bar segment width only)
  breaker: BreakerState;
}

interface ControllerSceneModel {
  mode: ControllerMode;
  feeders: Record<SectorId, FeederSceneModel>;
}

interface SectorPole {
  x: number;
  z: number;
  sectorId: SectorId | null;
}
```

`SceneModel.controller: ControllerSceneModel` (pure display mapping from `toSceneModel`, shared across 3D digital twin and 2D single-line circuit / topology diagram). Camera preset `'controller'` frames the shelter at `BUS_POSITION`.
Every sector cable starts at `feederExitPosition(id)` (one riser per feeder on the controller roof, ordered west → east by `FEEDER_EXIT_X`); the hub cable ends at `BUS_INLET_POSITION`. Display tone of a feeder = `feederTone(feeder, building)` (`utils/feeder-tone.ts`), shared by the 3D LEDs/risers/tags and both diagrams. `DiagramLayout` adds `feederTags` (kW tag box per feeder), `wires.controllerToBus` (topology: hub → EMS → bus) and `enclosure` (circuit: EMS switchboard around bus bar + breakers).

**Intensity-Driven Lighting (PL-T9..PL-T13):**

- **3D Windows & Market Lights:** `glowFromIntensity(intensity)` (`utils/scene-palette.ts`) replaces discrete status lookup with a continuous curve: 0 → black/off (zero load or unserved), ~0.25 → faint warm glow at lifeline floor, 1 → full radiant light. Multiplied by `lampGlow` (sky time-of-day).
- **3D Street Lamps:** `mapPolesToSectors(lines)` (`utils/cable-route.ts`) maps utility poles to their powering sector feeder. Unserved/cut feeders shut off pole street lamps (black); lifeline feeders dim them; trunk poles (no feeder) stay lit while the bus is energized. Single instanced draw call (`pole-lamps`).
- **3D Particles (`ElectronFlow`):** Speed, electron count/density, and bloom emissivity scale with line flow kW via `flowFactor(flowKw)` (`utils/scene-palette.ts`, saturates at `FLOW_SATURATION_KW`). Cut lines have zero particles.
- **2D Diagrams (`GridDiagram`, `FlowWire`, `SectorCard`):** Core and halo stroke width & opacity scale with feeder intensity. Lifeline mode is represented by amber dashed line (`strokeDasharray="4 4"`). Cut lines are neutral grey (`text-text-muted`, dashed, no electrons). Building cards render `servedKw / demandKw`, mode badges (`full`, `limited`, `lifeline`, `off`), and intensity-driven glow halos via semantic `@theme` tokens. All text labels follow 100% key parity in EN/FR/MG. Reduced motion halts electron flow in both 2D and 3D.

### Sensitivity sweep

```ts
type SweepParam = 'solarDropPct' | 'demandMultiplier' | 'initialSocPct';
interface SweepConfig {
  param: SweepParam;
  from: number;
  to: number;
  step: number; // point count between 1 and 20
}
interface SweepPoint {
  value: number;
  metrics: Partial<Record<StrategyId, Metrics>>;
}
type SweepResult = SweepPoint[]; // length ≤ 20
```

## Engine public API (`@mitsinjo/engine`)

```ts
simulate(input: SimulationInput, strategy: StrategyId): SimulationResult
compare(input: SimulationInput, strategies?: StrategyId[]): Comparison
compareLifelineCoverage(comparison: Comparison): LifelineComparisonSummary
strategyOutcomes(input: SimulationInput): Record<StrategyId, StrategyOutcome> // rounded rows of benchmarks/engine.json (BENCH_STRATEGIES)
sweep(input: SimulationInput, config: SweepConfig, strategies?: StrategyId[]): SweepResult // ≤ 20 points

Points use the same mapping as `applyPatch`; both range ends are validated, so an invalid range (e.g. `initialSocPct ≤ minSocPct`) throws `ZodError`.
applyWeather(input: SimulationInput, weather: WeatherId): SimulationInput // solar profile × WEATHER_SOLAR_FACTOR
simulateWorkflow(input: SimulationInput, workflow: Workflow, strategy: StrategyId): WorkflowResult // throws ZodError
compareWorkflow(input: SimulationInput, workflow: Workflow, strategies?: StrategyId[]): WorkflowComparison
parseInput(raw: unknown): SimulationInput             // throws ZodError
applyPatch(input: SimulationInput, patch: InputPatch): SimulationInput
isSectorConnected(sector: SectorConfig): boolean     // loadMultiplier !== 0
connectedSectors(input): SectorConfig[] · connectedSectorIds(input): SectorId[]
getSolarDrop(input: SimulationInput): { pct; startHour; durationH } // defaults 12 h / 3 h (DEFAULT_DROP_*) when no drop
scenarios: Record<ScenarioId, { title: string; description: string; input: SimulationInput }>
STRATEGIES: Record<StrategyId, { label: string; rule: string }>
// Dispatch display state (shared by 3D, 2D and the scale model)
breakerFromMode(mode: SectorMode): BreakerState      // lifeline → limited · full/limited → closed · off → open
feederModeAt(input, result, hour, sector): SectorMode // disconnected → 'off'
controllerModeAt(input, result, hour): ControllerMode
flowLevel(flowKw: number): number                    // 0–1, saturates at FLOW_SATURATION_KW (3); web alias flowFactor
feederTone({ connected, demandKw, servedKw, breaker }): FeederTone // 'ok'|'warning'|'critical'|'idle'; web maps to StatusColor
// Physical scale model (PH)
scaleTelemetry(samples: TelemetrySample[], scale: HardwareScale, base: SimulationInput): InputPatch
toHardwareCommand(input, result, hour, scale, seq?): HardwareCommand
feederNominalKw(scale, sector): number               // nominalW × powerScale / 1000
DEFAULT_HARDWARE_SCALE                               // powerScale 4000, timeScale 20, luxFullSun 20000
TIME_SCALE_PRESETS                                   // [60, 20, 10, 5] s per simulated hour (app speed buttons)
// Appliances (PV)
APPLIANCE_CATALOG: Record<ApplianceCategory, ApplianceSpec> // read-only
applianceProfileKw(appliance: Appliance): number[]  // 24 kW: watts × quantity × duty / 1000
applianceSummary(appliance): { peakKw, dailyKwh }  // insert preview (PV-T11): max hour, sum of 24 h
sectorApplianceKw(appliances?): Partial<Record<SectorId, number[]>> // summed per sector
```

### Physical scale model (PH, `schemas/hardware.ts`)

```ts
type ControllerMode = 'normal' | 'rationing' | 'lifeline_only'; // ControllerModeSchema
type BreakerState = 'closed' | 'limited' | 'open'; // BreakerStateSchema
interface HardwareScale {
  powerScale: number; // 1–100000; 4000 → 1 W model = 4 kW simulated
  timeScale: number; // 1–3600; 20 → 1 simulated hour = 20 s
  luxFullSun: number; // > 0; reference lux = clear-sky hour
  nominalW: Record<SectorId, number>; // 0–50 W at 100 % duty, all sectors required
}
interface ChannelReading {
  mV: number;
  mA: number;
}
interface TelemetryFrame {
  v: 1;
  deviceId: string;
  seq: number;
  uptimeMs: number;
  lux: number;
  pv: ChannelReading;
  battery: ChannelReading; // safety only, never the grid SoC
  feeders: Record<SectorId, ChannelReading>; // served current (check only, never demand)
  requests: Record<SectorId, number>; // 0–1 demand request (switch / potentiometer)
}
interface TelemetrySample {
  simHour: number; // 0–23, set by the bridge
  lux: number;
  requests: Partial<Record<SectorId, number>>;
}
interface HardwareCommand {
  v: 1;
  seq: number;
  simHour: number;
  mode: ControllerMode;
  socPct: number;
  batteryKw: number; // engine values
  feeders: Record<
    SectorId,
    { duty: number; breaker: BreakerState; flow: number; tone: FeederTone }
  >; // duty, flow 0–1
}
// apps/bridge → web over WebSocket: { type: 'state', state: BridgeState } every second
// Zod: BridgeStateSchema / BridgeMessageSchema / BridgeModeSchema in schemas/hardware.ts (shared by bridge and web)
interface BridgeState {
  v: 1;
  mode: 'replay' | 'twin';
  scenarioId: ScenarioId;
  strategy: StrategyId;
  day: number;
  simHour: number;
  patch: InputPatch; // apply to scenarios[scenarioId].input and re-run to get the same numbers
  deviceOnline: boolean; // a valid frame in the last 5 s
  scale: HardwareScale;
  command: HardwareCommand;
}
// bridge → web (BridgeMessageSchema): { type: 'state', state: BridgeState } each second
//   | { type: 'access', control: boolean } once per connection (false = read-only, commands ignored)
// connection URL ?token=<BRIDGE_TOKEN> → control; no BRIDGE_TOKEN set → everyone controls
// web → bridge (BridgeClientMessageSchema):
//   { type: 'cloud', on: boolean } → MQTT mitsinjo/v1/cloud (servo over the sun lamp)
//   { type: 'speed', timeScale: number } → new pace from the current hour (no jump); next state confirms it
```

MQTT topics: `mitsinjo/v1/telemetry` (device → bridge), `mitsinjo/v1/command` (bridge → device),
`mitsinjo/v1/cloud` (bridge → device).

`scaleTelemetry`, measured hour h: `solarProfile[h] = base.profile[h] × clamp(mean lux / luxFullSun, 0, 1)`;
`meterReadings[s][h] = computeProfileDemandKw(s, h) × mean request`. Unmeasured hours keep the base profile and the
expected demand. `toHardwareCommand`: `duty = clamp(servedKw / feederNominalKw, 0, 1)`, `breaker = breakerFromMode`,
`flow = flowLevel(servedKw)`, `mode = controllerModeAt`, `socPct` from the step.

## Copilot tools (LLM-facing; args validated with Zod server-side)

| Tool                 | Args                                                                                        | Returns                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_grid_state`     | `{ hourly?: boolean }`                                                                      | `{ scenarioId, input summary, metrics of active strategy, resultId, hourly?, highlights? }`                                                               |
| `run_scenario`       | `{ scenarioId?, patch?: InputPatch, strategy }` (patch `appliances` replaces the list)      | `{ resultId, metrics, warnings, appliances: { count, dailyKwh, peakKw, perSector } }`                                                                     |
| `compare_strategies` | `{ strategies?: StrategyId[] }` (on current input)                                          | `{ [strategy]: { resultId, metrics } }` (evidence includes lifelineCoveragePct)                                                                           |
| `get_sector_metrics` | `{ sector: SectorId, strategy?: StrategyId }` (default: active)                             | `SectorMetrics & { priority, hourly: {t,demandKw,servedKw}[], appliances: { count, dailyKwh, peakKw, lines[] } }`                                         |
| `get_incidents`      | `{ hour?: 0–23, strategy?: StrategyId }` (defaults: app hour, active)                       | `{ count, incidents: [{ sector, startHour, endHour, status, unservedKwh }] }` (read-only; restore via `propose_change`)                                   |
| `simulate_week`      | `{ days: [{ weather: sunny\|partly_cloudy\|cloudy\|rainy\|storm }]×1–7, strategy? }`        | `{ days: [{ day, weather, resultId, unservedKwh, criticalUnservedKwh, socEndPct }], totals, plan: { strategy, worstDay } }` (battery carries over; M7-T2) |
| `get_battery_story`  | `{ hour?: 0–23, strategy? }` (default: emptiest hour, active strategy)                      | `{ hour, socPct, peak: { hour, socPct }, solar/demand/discharged/unservedKwhSincePeak, unservedBySector[] }` (M7-T3)                                      |
| `propose_change`     | `{ patch?: InputPatch, strategy?: StrategyId, reason: string }` (≥ 1 of patch/strategy)     | `{ proposalId, impact: ChangeImpact, appliances, applianceKwhDelta? }` — **not applied**; UI asks user                                                    |
| `control_playback`   | `{ action: 'play'\|'pause'\|'stop'\|'restart'\|'seek', hour?: 0–23 }` (`seek` needs `hour`) | `{ status: 'applied_in_app', action, hour?, note }` + SSE `control`; view only                                                                            |

`control_playback` is the one tool the app runs without approval: it only moves the 24 h playback / time cursor
(`applyPlaybackControl` → store `play/pause/stop/restart/setTimeIndex`; seek pauses first). Inputs, strategy and
results never change, so it is not a "mutation" in the `propose_change` sense.

`get_grid_state({hourly:true})` adds `hourly: {t, solarKw, demandKw, socPct}[24]` (engine steps, rounded) and `highlights
{ peakSolarKw, peakSolarHour, peakDemandKw, peakDemandHour, lowestSocPct, lowestSocHour }` (picked from the steps), also in
evidence. Charts in answers must use these values.

`ChangeImpact` (engine `changeImpact(before, after)`, schema `ChangeImpactSchema`): `{ beforeResultId, afterResultId,
strategyBefore, strategyAfter, socMinPctBefore/After, unservedKwhBefore/After, sectors: Partial<Record<SectorId,
{ servedKwhBefore, servedKwhAfter, servedKwhDelta, offHoursBefore, offHoursAfter }>> }`. `propose_change` computes it
on the current input + active strategy vs the patched input + proposed strategy (`proposalImpact` in
`lib/proposal-impact.ts`, shared with the dialog), rounds to 2 decimals, keeps only sectors that change, and emits the same numbers as `evidence` (`socMinPctBefore`, `<sector>_servedKwhDelta`, …).
Unsafe patch → tool data also has `clinicGuard: ClinicGuardReason[]` (engine `clinicGuard(patch)`, schema
`ClinicGuardReasonSchema` = `cap_zero | disconnected | floor_zero | lifeline_off`); the dialog recomputes it from the patch.
Inserted loads (PV-T14, `summarizeAppliances` in `tools.ts`, engine `applianceSummary` + `sectorApplianceKw`):
`run_scenario` reports the simulated input's `{ count, dailyKwh, peakKw, perSector: { count, dailyKwh, peakKw } }`;
`get_sector_metrics` reports its sector's `{ count, dailyKwh, peakKw, lines: [{ id, name, category, quantity, watts,
peakKw, dailyKwh }] }`; `propose_change` reports the after-list plus `applianceKwhDelta` (after − before, only when
the patch touches `appliances`). Evidence, only when lines exist: `applianceCount`, `applianceKwh`, `appliancePeakKw`,
`<sector>_applianceKwh`, `<sector>_appliancePeakKw`, `<sector>_applianceCount`, `applianceKwhDelta`.
Partial approval (K3, `features/copilot/utils/proposal-parts.ts`): `proposalPartIds(proposal)` = one id per dialog line
(`strategy`, `priorities.<s>`, `sectorCaps.<i>`, `solarDropPct`, `dropWindow`, `demandMultiplier`, `batteryCapacityKwh`,
`initialSocPct`, `minSocPct`, `lifeline.enabled`, `lifeline.kw.<s>`, `sectorLoads.<s>`, `clearFires.<s>` (M2-T4)),
same order as `useProposalDiff`.
`pickProposal(proposal, checkedIds): { patch?, strategy? }` keeps the checked lines plus patch fields with no line.

```ts
interface InputPatch {
  // all optional; LLM-safe subset
  solarProfile?: number[]; // length 24, 0–1 → replaces solar.profile (measured by the scale model, PH)
  solarDropPct?: number; // 0–90 → adds/replaces a solar_drop event
  dropStartHour?: number;
  dropDurationH?: number;
  demandMultiplier?: number; // 0.5–2
  batteryCapacityKwh?: number;
  initialSocPct?: number;
  minSocPct?: number;
  priorities?: Partial<Record<SectorId, Priority>>;
  sectorCaps?: SectorCap[];
  meterReadings?: Partial<Record<SectorId, number[]>>;
  criticalShares?: Partial<Record<SectorId, number>>; // 0–1
  balancedWeights?: Partial<Record<Priority, number>>; // 0–10, at least one > 0
  lifeline?: { enabled?: boolean; kw?: Partial<Record<SectorId, number>> }; // 0–2 kW
  sectorLoads?: Partial<Record<SectorId, number>>; // 0–3 → loadMultiplier (1 removes it, 0 disconnects)
  appliances?: Appliance[]; // replaces the list; [] removes the field (hash unchanged)
  clearFires?: SectorId[]; // non-empty → removes the fire events of these sectors (restore, M2-T4)
}
```

## Copilot HTTP

`POST /api/copilot` body `{ messages: {role:'user'|'assistant', content:string, media?: {type, url, key?}[]}[] /*≤ 40: those not in the summary*/, input: SimulationInput, strategy?, model?, locale?, sessionId?, hour? /*0–23, shown hour: village image + "now" for caps (system note)*/, summary?: string /*≤ 4000*/, summarizedCount?: int /*payload messages before `messages`*/, retry?: boolean /*same question again; question not saved twice*/ }`.
Client `ChatMessageData.retried?: boolean` = answer redone by Retry (kept on screen, left out of the payload)
→ `text/event-stream` events:
`activity {tool, sector?, label}` (UI translates `tool`; `label` is English, logs only) · `delta {text}` · `evidence {resultId, fields: Record<string, number|string>}` ·
`proposal {proposalId, patch?, strategy?, reason, impact?: ChangeImpact}` · `error {code, reason?, message}` · `done {}` ·
`model {model, modality, reason}` (modality `chat|reasoning|vision|image`; a second `model` event announces a switch to Wonder) · `image {imageUrl, caption}` ·
`media {kind:'village_tonight'|'shedding_poster', imageUrl, caption, overlay: {cuts: {sector, fromHour, toHour, unservedKwh}[]}|null, resultId}` (M5-T1; `village_tonight` overlay is null) ·
`video {videoUrl, caption}` · `chart {type:'line'|'bar'|'area', title?, series[], data[]}` ·
`perception {kind:'segment', concept, count, boxCoverage, instances[{box, confidence?, outline?}], imageUrl, imageWidth, imageHeight, source, model, fallback?}` (M8-T1: the lightbox overlays instances as masks) ·
`perception {kind:'analyze', summary, observations[{label, value, unit?, confidence}], model, source}` (M4-T2) ·
`council {question, rounds, agents[{sector, reason, patch, impact: ChangeImpact, mock}], verdict: {pick, synthesis, mock}}` (M7-T1) ·
`control {action, hour?}` (playback command from `control_playback`; client applies it, `ChatMessageData.control` shows a cyan line) ·
`summary {text, summarizedCount}` (history folded into the summary; client sends only later messages, session stores both).
`error.code = PROVIDER_FALLBACK` carries `reason: 'spend_cap' | 'provider_error' | 'timeout'` (UI: amber note on that answer).

Operator decision (chat message `role: 'decision'`, saved via `POST /api/copilot/sessions/:id`): `ProposalDecision
{ proposalId, status: 'approved'|'rejected'|'undone', items: {id?, label, current, proposed}[] /*snapshot as shown, checked lines*/,
skipped?: same[] /*lines unchecked (K3), not applied*/, patch?, strategy? /*what was applied*/ }`.
Approved with `skipped` → the model text adds « Lines the operator left out (NOT applied): … ».
Sent to the model as a user turn `[Operator decision] APPROVED|REJECTED|UNDID proposal <id>…`.
Store (K4): `changeHistory: { id, before: { input, strategy } }[]` (≤ 20, oldest first). `approveChange(id, patch?, strategy?)` =
`applyProposal` + records the state before it (only if the run succeeds); `undoLastChange(): id | null` restores it and re-runs.
Cleared by `loadScenario`, `reset`, `applyDeviceRun`. Plain `applyProposal` (sector sliders) is not recorded; an undo also
drops later slider edits (it restores the whole input). Session GET adds `summary?, summarizedCount?`.

`POST /api/voice` multipart `{ audio: WAV ≤ 2 MB (≈ 60 s 16 kHz mono), locale?, sessionId? }` → `{ text, durationMs, source:
'meta'|'mock', fallback? }`; 400 missing, 413 too big, 415 not WAV. Audio is not stored.

`POST /api/vision` multipart `{ image: JPEG|PNG|WebP ≤ 12 MB (sent as picked, or shrunk to ≤ 2560 px JPEG by the client above 3.5 MB for the 4.5 MB host body limit; the server rotates it per EXIF, fits ≤ 1280 px, re-encodes JPEG q85 with sharp, `server/perception/prepare-image.ts`), sessionId?, expected? }` → `text/event-stream`:
`vision_detections { phase: 'boxes'|'outlines', detections: ApplianceDetection[], refined? /*outlines only*/, source, model, fallback? }`
(boxes as soon as Muse answers; outlines after SAM, Meta only) · `vision_error { code: 'VISION_FAILED', message }` · `done {}`.
400 missing, 413 too big, 415 not an image. Meta + R2: the photo is uploaded once to `vision/<ts>-<rand>.<ext>`
(`hostVisionImage`) and Muse + SAM get the link (`VisionImage {url, inlineUrl?}`); Meta failure → one retry inline (base64).
R2 off or mock mode: base64 only, nothing stored. Mock: `MOCK_DETECTIONS`, drawn in `public/samples/vision-room.jpg`; `expected` (JSON `ExpectedDetectionsSchema` = `ApplianceDetection[]` ≤ 40, 400 `Invalid expected` if malformed) replaces mock answers only, never Meta's (`withExpectedDetections`): the /village 360° tour sends the hand-labelled objects seen in its scan photo (VS-T14).
Shared Zod (client + server): `@/lib/vision` (`NormBoxSchema`, `ApplianceDetectionSchema`, `VisionDetectionsEventSchema`).
`ApplianceDetection.label` = English name from the model (also SAM's text prompt) or the operator's text; `labels?: { fr?, mg? }` =
same name translated by the model in the same call; the page shows `localLabel(d, locale)` (switching language needs no new call).
`ApplianceDetection` adds `kind?: 'appliance'|'scenery'` (absent = appliance) and `scenery?: 'building'|'vehicle'|'tree'|'plant'|'person'|'animal'|'water'|'other'`;
scenery is outlined and selectable, no load until the operator inserts it (`category: 'other'` by default, PV-T11).
Vision lines in the store: `Appliance.id = vision-<photoKey(photo)>-<detection id>` (≤ 64; `photoKey` = FNV-1a of the photo data URL),
inserted / updated / removed with `applyProposal({ appliances })` (whole list, immediate re-run). Appliances come first in the list.
`manual?: true` = object the operator drew (PV-T8), listed after the AI ones, ≤ 30 per photo. `adjusted?: true` = box corrected by
the operator (`useVisionSession.adjustBox(id, box)`, per photo; wins over later model answers, outline dropped). Multipart field `regions?` =
JSON `VisionRegion[]` (1–10, `{ id, points: [x,y][] (3–400, 0–1, closed polygon), hint? ≤ 40 }`) → identify only those shapes:
`vision_regions { phase: 'boxes'|'outlines', results: { regionId, detection? /*id = regionId, manual: true*/ }[], source, model,
fallback? }` (no `vision_detections`). Client: `useVisionSession.sendShapes(shapes, fallbackLabel)` shows each shape at once
(`shapeToDetection`: operator text or fallback label, `category: 'other'`, the drawn outline), then takes the model's label /
kind / category / box; drawn outline kept until SAM sends one. Failure → `identifyFailed`, the shape keeps the operator text.
`POST /api/vision/shape` (PV-T9) multipart `{ image (same rules and normalization as /api/vision, shared
`server/perception/vision-request.ts`), target: JSON ShapeTarget { id, label, category, scenery?, box, outline? (SAM path ≤ SHAPE_OUTLINE_MAX chars) }, sessionId? }` → `text/event-stream`:
`shape_step { step: 'crop'|'model'|'fit'|'check' }` (live, `SHAPE_STEPS`; `check` = AI views check, PV-H, shown only once it starts) · `shape_stage { jobId?, phase: 'first'|'background', index, total, stage: 'massing'|'roof'|'openings'|'accessories' /*house*/ | 'body'|'glass'|'wheels'|'doors'|'cells'|'trunk'|'crown'|'head'|'details' /*objects from their 2D view, PG-T20*/ | 'final' /*last, background only: Muse Wonder checks and re-refines the whole model, PG-T24*/, state: 'running'|'done', before?, after? /*0–1*/, stop?, kinds? /*part kinds the stage works on, on `running`: the viewer frames and outlines them*/, recipe? /*model after a kept patch*/, seq? /*job events*/ }` (facade houses, PG-T17) · `shape_result { shape: ObjectShape, jobId? /*stages left for the background*/ }` · then, with a `jobId`, background `shape_stage` events until `shape_stages_done { jobId, status: 'done'|'stopped', cause?: 'timeout'|'error'|'aborted' }` (no overall limit: always waits for Meta, stops only on « Cancel » = `DELETE` / closing the resumed request, cause `aborted`, PG-T18), or `shape_stages_checkpoint { jobId, checkpoint }` when the request nears the serverless limit (`SHAPE_FUNCTION_MS` 300 s, `maxDuration`; a round starts only with `STAGE_ROUND_RESERVE_MS` left, the slice ends `STAGE_SLICE_MARGIN_MS` before the cut) · `done`. `checkpoint` (`StageCheckpointSchema`, server `stage-checkpoint.ts`, opaque to the browser): `{ v: 1, label, loop: { kind: 'views', archetype, front, side, frontUrl, sidePng } | { kind: 'facade', front: Elevation, facadeUrl? }, all, stages, round, stalls, recipe }`. `POST /api/vision/shape/stages { checkpoint, sessionId? }` → SSE `shape_stages_resumed { jobId }`, then the same `shape_stage` events until `shape_stages_done` or the next checkpoint (the hook loops until done); 400 invalid, 413 > `STAGE_CHECKPOINT_MAX`; `STAGE_MAX_STALLS` slices in a row without a finished round → `stopped` / `timeout`. `GET /api/vision/shape/stages?job=&from=<seq>` → same SSE from that event (resume a dropped stream), `DELETE ?job=` cancels (204), 400 bad id, 404 unknown / expired (10 min, in memory; the hook shows it as cause `lost`, model kept);
`ObjectShape { detectionId, mode: 'recipe'|'silhouette', recipe? /*recipe only*/, reason? /*silhouette only: 'provider_error'|
'spend_cap'|'malformed'|'no_body'|'timeout' (Spark past SHAPE_TIMEOUT_MS = 60 s)|'network' (browser side)*/, source, model,
fallback?, detail? /*'http_429', 'timeout', 'offline'…*/, fit?: { iou: 0–1 } /*PF-T6, computed: silhouette vs SAM outline, panel « Matches the photo outline: 82% »*/, imaginedViews?: ImaginedAngleView[6] /*PR-0.7, flat renders of the final recipe at the 6 canonical angles*/, partMasks?: PartMask[] /*PR-2.5, SAM parts on the crop: { concept /*wheel, window, door, chimney, lamp*/, box /*crop fractions*/, outline? } (vehicle/house/lamp_post only, ≤ 8 per concept, meta-only, absent when skipped)*/, kit?: ObjectKit /*PR-0.6, Spark's kit behind the recipe (meta-only; the critic patches it)*/, outline?: string /*PR-0.6, SAM outline used for fit+score (fetched ones included)*/ }`; 400 (JSON) missing / invalid target. One Spark critic round below score 70 with ≥ 20 s left (PR-0.6: `shapeWithCritic`, `criticizeShape`, patch → re-fit → keep-if-rises; mock/skipped without Meta). Views recipes: `checkViews(sheetUrl, question) → { check: { missing: { part, view: 'front'|'side', color?, material? }[] (≤ 4), redrawSide } | null }` (PV-H, `views-check.ts`; mock → null), ≤ 2 rounds within 90 s. Facade houses: `proposeShapeOps(sheetUrl, question) → { ops: unknown[] | null }` (PG-T15, optional on the backend; mock → `[]`), each op checked by `compileScript`. `withViews` (route: always true) gates `imaginedViews`; without it the route returns the recipe alone.
`POST /api/vision/views` (PR-0.7) same multipart in → JSON `{ ok: true, views: ImaginedAngleView[6], detectionId }` (no Spark call: archetype template + measured colours + box proportions); `ImaginedAngleView { angle: 'front'|'back'|'left'|'right'|'top'|'three_quarter', labelKey, angleDeg, description, imageUrl /*256² PNG data URL, studio backdrop*/, features: string[] }`.
Client state: `{ status, shape?, step?, startedAt?, viewsStatus, views? }`; `peek(target)` on select (kept shape and preview, or idle), `requestViews` on « Preview 6 angles » (cached per `shapeKey`, a failure falls back to idle), `requestShape` on « Generate » or « Validate & Generate 3D »; only lasting answers are cached (`keepShape`), failures are asked again.
`ObjectRecipe { proportions: {w,h,d} (largest = 1), parts: { shape: 'box'|'cylinder'|'sphere'|'cone'|'prism'|'extrude'|'lathe'|'hip', at: [x,y,z] (−0.6…0.6),
size: [x,y,z] (0.01–1), axis?: 'x'|'y'|'z', apex? /*prism ridge x, 0–1 of its width*/, ridge? /*hip only: ridge along x, share of its width (0 pyramid, 1 side gable), measured on the 2D facade*/, clip? /*hip only (PG-T22): half-hip, the ends stand as vertical gables up to this share of the roof height (0–0.9, `HIP_CLIP_MAX`), read on the front roof outline (`gableShare`)*/, points? /*extrude or hull (PR-2.1, PV-H): closed ring in unit space, 3–64 pts, server-built, never from Spark*/, section? /*hull only (PV-H): side ring [z (+ = front), y], 3–64 pts; hull = points along z ∩ section along x (visual hull of the 2D view and its drawn side)*/, profile? /*lathe only (PR-2.3): [radius 0–0.5, y] 2–32 pts, y never decreases*/, color: '#rrggbb', material?: RECIPE_MATERIALS /*stone, brick, plaster, concrete, wood, thatch, tile, slate, metal, glass, plastic, fabric, rubber, foliage, water; AI*/, front?: true, kind?: 'wall'|'roof'|'chimney'|'door'|'window'|'plinth'|'step'|'frame' /*PV-G, set by the facade builder; elevation score + 3D opening look*/ | 'body'|'wheel'|'light'|'bumper'|'grille'|'handle'|'display'|'cell'|'trunk'|'crown'|'head' /*PG-T20, set by the views builders (`viewsRecipe`, `roundViewRecipe`→`tagRoundParts`); the view stages score and edit by kind*/, timber?: { posts: number[], rails: number[] } /*wall only, ≤ 12 each, shares 0–1 (x from left, y from ground to eave), SAM « timber beam » on the drawing; the 3D view draws the beams cut around openings*/, grid?: [cols, rows] /*solar cells (`kind: 'cell'`, PG-T21): cell lines drawn by the 3D view; window/door panes 1–6 each, PG-T8: the 3D view expands each opening into frame, glass or leaf at the bottom of a reveal cut in its host wall (PG-T11), bars and window sill (not counted in the budget); thatch roofs get an eave roll (PG-T12)*/, leaves?: 1|2, glazed?: 0–0.8 /*door top share glazed, panes from grid*/, panels?: 0–4 /*raised panels per leaf*/, sill?: boolean /*window default on*/, lintel?: boolean, cap?: boolean /*chimney*/, bulge?: 0–0.3 /*roof eave roll radius, share of roof height; thatch default 0.08, 0 = none*/, rim?: boolean /*wheel, PG-T21: metal rim disc on its outer face, 3D view only*/ /*PG-T10 assemblies: the 3D view expands each into boxes; past MAX_TRIANGLES 5 k it drops bars, panels, lintels; the flat render scores the plain component*/, status? /*PR-2.15: 'measured'|'estimated'|'inferred'|'unknown', computed, absent on older shapes*/ }[] (1–12 from Spark / photo path, ≤ 32 `MAX_COMPONENTS`(alias`MAX_BUILT_PARTS`) for server-built facade and views recipes; hidden-side deduced parts included /*PR-2.16: back facade, end windows, rear door; status inferred, low yaw only*/; measured house walls arrive segmented around their openings with the leaf centred in its hole /*PR-2.17, overlays only when the strips do not fit; vehicles keep overlays*/), source?: 'kit'|'free'|'facade'|'views' /*facade = house rebuilt from the measured 2D elevations; views = any other object (VIEW_HULL_ARCHETYPES) rebuilt as a hull of its validated 2D view + Muse Image side, then checked by Spark (`checkViews`); no photo critic round for either*/, yaw? /*radians ±π/3, measured PF-T5, + = right end farther*/, edits via `applyEdit(archetype, recipe, { node, param, value, unit?, scale? }, evidence?)`/*PR-2.18, pure: openings re-tile their wall, strips/wall-node rejected, edited nodes estimated; UI wiring out*/, swatches?: Partial<Record<RecipeMaterial, string>> /*PR-1.5, 64 px tileable data URL ≤ 8 kB per material*/, dimStatus?: { eave? /*houses*/, depth?, yaw?, scale? } /*PR-2.15, same 4 statuses, panel « Dimensions : … »*/, coverage?: { concept, seen, built }[] /*PQ-T37, computed: SAM part masks on the object per concept vs parts built; panel « Parts seen on the photo »*/, conditions?: { widthPx, heightPx, sharpness? /*low|medium|high*/, exposure? /*low|medium|high = clipped share*/, hidden? /*0–1, needs an outline*/, view? /*front|three_quarter|side*/ } /*PQ-T7, computed by`photo-conditions.ts`: facts line « Measured: » of the kit question, colour confidence, panel hint when the object is < 150 px or blurred*/ }`: object centred, x right, y up, z to the camera,
in fractions of its own size. Shared Zod + `fitRecipe(recipe, boxAspect, yaw = 0)` (with a yaw: `w·cos + d·sin = aspect·h`), `recipeIssue`, `frontPartIndex`, `silhouetteRings` in `@/lib/object-shape`; no power value.
Spark answers `ObjectKit { archetype: KIT_ARCHETYPES (cabinet…house, building, tree…other), subtype? /*free label, lower_snake_32: picks the template branch — vehicle sedan/van/pickup/motorbike/vintage, house variants; the critic may patch it (PR-0.6)*/, proportions {w,h,d}, colors { main, secondary,
accent: '#rrggbb' }, materials?: { main?, secondary?, accent? } /*RECIPE_MATERIALS, unknown dropped*/, partMaterials?: { roof?, walls?, frame?, plinth?, chimney?, door? } /*PG-T5, RECIPE_MATERIALS read on the 2D drawing, wins over the role material for that part*/, details?: { windows?, doors?, wheels?, legs?, floors?, chimney?, units? /*houses in a row, 1–8*/, plinth?: boolean, timberFrame?: boolean, panes?: [cols, rows] /*1–6 each; PV-G, read by Spark on the drawing, used by the facade builder when SAM misses them (parts then `status: 'inferred'`)*/ }, roof?: KitRoof }` (`@/lib/object-kit`;
`KitRoof { eave, gables: { x0, x1, peak, top }[1–6] }` in box fractions, y down, measured on the SAM outline by `server/perception/roofline.ts`, never from Spark → one `prism` per gable); `kitToRecipe(kit)` → `ObjectRecipe` (pure, ≤ 12 parts; each part takes its role's colour and material). Viewer: `recipeMesh` = one geometry, one group per material (`surface-look.ts` `SURFACE_LOOK` roughness / metalness, `painted` when none); panel lists `recipeMaterials` as AI.

**Evidence (PQ-T12, `lib/object-kit.ts`, kit prompt 2 only: `kitJsonSchema(2)`; prompt 1 is not offered these fields):** `ObjectKit.evidence?` `{ view?: front|side|back|three_quarter|top, outline?, hiddenBy?[≤6], volumes?[≤3], visibleParts?[≤12, SAM words], repeats?: Record<string, int>, unsure?[≤12] }` and `confidence?` `{ archetype?, proportions?, colors?, counts? }` (0–1), written before the other fields; both optional, answers of kit prompt 1 stay valid. `unsure` or a confidence under ½ makes fusion lean on the measurement (`modelDoubts`, `ledByMeasurement`: half-way to full trust); `visibleParts` feed `notBuilt` / `ObjectShape.coverage` (PQ-T37) through `listedConcept` (place after the comma dropped, plural read as singular, « front wheels » = `wheel`). The panel names a part by `partLabelKey(concept)` under `model3dPart` (« side mirror » → `side_mirror`); a concept without a label is summed under `model3dPartOther`.

`ShapeScript { proportions, ops: ShapeOp[] (≤ 256), source?, yaw? }` (`@/lib/shape-script`, PG-T13): a model as typed ops on named components (`ComponentId` /^[a-z][a-z0-9_.-]{0,31}$/), never code. `ShapeOp` = `add {id, part: RecipePart, parent?}` · `set {id, at?, size?, color?, material?, grid?, leaves?, glazed?, panels?, sill?, lintel?, cap?, bulge?, ridge?, clip?, apex?}` · `remove {id}` (children too) · `attach {id, parent, face: front|back|left|right|top, u, v}` · `cut {id, wall, kind: window|door, face = front, u, v, w, h, …options}` (u, v centre and w, h size as 0–1 shares of the wall face) · `repeat {id, count 2–8, axis, step}` (copies `id.2…`) · `material {id, material, color?}`. `compileScript(script, { locked?, lockedFrom? }) → { recipe | null, components: {id, part, parent?}[], dropped: {index, reason: invalid|unknown_id|duplicate_id|unknown_parent|locked|budget|out_of_bounds|not_a_wall, id?}[], adjusted: id[] }`: pure, never throws, ≤ `MAX_COMPONENTS`; constraints: an opening stays inside its parent wall face, a chimney's foot inside the roof's height. `recipeToScript(recipe)` (PG-T14): one `add` per part named by kind (`window.2`), openings parented to the wall; compiles back to the same recipe. `runShapeStages({ seed, stages: {id, kinds, gate}[], score: (recipe, stage) → {stage, overall}, propose: (ctx) → Promise<unknown[]>, budgetMs, maxRounds = 3, onStage?, canEdit?: (component) → boolean /*house: `houseCanEdit`, side-wall openings locked*/ }) → { script, recipe, stages: {id, before, after, rounds, kept, stop: gate|no_gain|rounds|timeout|error|skipped /*`ShapeStageStop`; `rounds` also = breadth-first share, see copilot.md*/, dropped}[], overall }` (`server/perception/shape-stages.ts`, PG-T16): monotone, locks every component outside the stage's kinds. Each round's patch goes through `microPatch` (`stage-steps.ts`): every op tried alone (a `set` with `at`/`size` also at ½ and ¼ step, `STAGE_STEP_SHARES`), kept greedily when it raises the stage score without lowering the overall one, or the whole patch when better (≤ `STAGE_MAX_TRIES` scores per round); a stage stops after `STAGE_MAX_MISSES` = 2 rounds without gain (an empty answer stops at once), the retry gets `ctx.feedback: RoundFeedback { round, kept, trials: OpTrial { op, id?, outcome: kept|worse|no_effect|dropped, share?, reason?, fields }[], refused }`. Stage capture (PG-T22, `server/perception/stage-capture.ts`): `StageCapture { version: 1, id, capturedAt, model, promptVersion, label, front: Elevation, seed: ObjectRecipe /*no swatches*/, answers: {stage, round, ops: unknown[] | null, seconds}[] }`, file `<id>.stages.json` (written by `make facade-e2e … ID=`, replayed offline by `make eval-stages`; local, gitignored). The front elevation score counts a side-wall opening (`sideFacing`: thin along x) as wall, never as a built opening. View stages (PG-T20, `server/perception/view-stages.ts`): `VIEW_STAGES[archetype]` (vehicle body → glass → wheels → details; cabinet / machine / screen / tank / fan body → doors → details; panel body → cells; tree / bush trunk → crown; lamp post / pole body → head; animal / person / other body), `scoreViews(recipe, {front, side}, stages) → { stages: 0–1 per stage, measured: stage ids with drawn parts, silhouette, overall = mean(silhouette, measured part stages), counts }`: body = silhouette IoU (same render as `viewIou`), a part stage = greedy box IoU between the SAM part boxes on the drawings (`CONCEPT_KIND` maps concepts to kinds) and the visible boxes of the model's parts of that kind, Σ IoU / max(drawn, built); a stage nothing was drawn for is 1 and not run. `viewStageLoop` (views path, after the AI check, budget = `VIEWS_TOTAL_MS` − 4 s) streams the same `shape_stage` events and background job as the house. `proposeShapeOps(imageUrl, question, signal?, sheet?: 'elevation'|'views', opts?: { refine?: boolean })`: `views` = the 2 × 2 views sheet (prompt v3: `set` takes `clip`); `refine` = final stage, asked of `META_REFINE_MODEL` (Wonder), one retry on `META_VISION_MODEL` on failure. `withFinalStage(stages, score)` appends `{ id: 'final', kinds: every earlier kind, gate: FINAL_GATE = 1 }` scored on the whole model (stage = overall). Colours (PG-T22): `measureKitColors(px, archetype, { plaster? })` — half-timbered house walls (`wallTimber`) take the lightest big wall group, not plaster + beams averaged.
`ShapeResult.kit?` (Meta only): the server rebuilds the recipe with colours measured on the photo (`measureKitColors`, PF-T2) and, for `house`/`building` with an outline, the roofline (`withMeasuredRoof`, PF-T3; a pitched building becomes `house`) and the houses / windows of a row (`withMeasuredRepetition`, `server/perception/repetition.ts`, PF-T4: units = gables if ≥ 2, else edge period on the roof band, else Spark; `units` ≥ 2 without a roof → one even gable per house); straight-edged archetypes (house, building, cabinet, machine, vehicle, screen) get `yaw` from `server/perception/perspective.ts` (PF-T5: Sobel → Hough → TLS segments → seeded RANSAC vanishing points; focal from two orthogonal VPs, else 0.8 × long side; |yaw| < 6° → 0; < 8 lines → none); `kit` is not sent to the browser. With an outline, `fitSilhouette` (`server/perception/silhouette-fit.ts`, PF-T6) then fits θ = {width, depth, yaw, eave} by Nelder–Mead (`nelder-mead.ts`, ≤ 150 evals, ΔJ < 1e-3) on `J = 1 − IoU + 0.5·chamfer + 0.02·prior`, 128-px orthographic raster; house count stays as measured, yaw only refined (pull 1/rad², free only when PF-T5 measured one). Perspective: a vanishing point needs its lines ≥ 10 % of the box height apart at the box centre (`lineSpread`); houses with a roof are read below the eave. Colours sampled on a 96² pixel budget, outline-edge pixels dropped. Golden set: `server/perception/__fixtures__/shape`, `make test-shape`. Fusion (`fusion.ts`, PF-T7): `confidence.colors(pixels)` (½ at 64 px → 1 at 1000), `.repetition(R)` (½ at 0.35 → 1 at 0.65), `.perspective(inliers)` (½ at 8 → 1 at 24), `.fit(iou)` (0 at 0.4 → 1 at 0.8); value = prior + c·(measured − prior) (colours in linear light, Spark yaw prior 0), counts measured when c ≥ ½; `mixRecipe(fitted, start, c)`.
Client: `useObjectShape().requestShape(photo, target & { adjusted? }, sessionId?, force?)` + `retry()` (box in the cache key once adjusted) → `{ status: 'idle'|'loading'|'ready', shape? }`; a network or
HTTP failure also ends in `silhouette` (`reason: 'provider_error'`), never an error state. Answers kept per `shapeKey` (id, label,
category) until `clear()` (new photo); offline silhouettes are not kept. /village passes `VILLAGE_SCOPE` to `useVisionSession`, `useObjectShape` and `useFacade2d` (`useKeptState` / `useKeptRef`, `hooks/use-kept-state.ts`): photo, objects, selection, adjusted boxes, facades, 3D models and inspector tabs live in a module store, so leaving the page and coming back keeps them and asks nothing again; running requests go on; a new photo drops them; not kept across reloads. Viewer geometry: `features/vision-insert/utils/object-geometry.ts`. Nothing is stored (crop sent inline).
SSE parsing for every client stream: `@/lib/sse` (`parseSseChunk`, `readSseStream`).

Model-switch tools (Zod in `server/copilot/model-tools.ts`, results go back to the model):
`generate_image {scene:'current_village'|'custom', prompt? /*custom*/, caption?}` → `{ok, model, caption, shownState?:{hour, sky, battery, sectors}}` + `image` event · `segment_image {concept}` →
`{concept, count, boxCoverage, model, source, note}` + `perception` event · `analyze_image {question}` (M4-T2, on the attached photo) →
`{question, summary, observations: {label, value, unit?, confidence}[], model, source, note}` + `perception` event · `escalate_deep_reasoning {reason}` → `{ok, model}` + `model` event ·
`generate_visual {kind:'village_tonight'|'shedding_poster', resultId}` (M5-T1) → `{ok, model, kind, resultId, caption, overlay}` + `media` event ·
`convene_council {question, maxRounds?}` (M7-T1) → `{ok, rounds, agents[{sector, reason, unservedKwhAfter, ownServedKwhDelta, mock}], pick, synthesis}` + `council` event.
Invalid args or failure → `{error}`.

## Perception (`server/perception`, Zod in `schemas.ts`)

Observations, never energy values: any number must become an `InputPatch` proposal before the engine uses it.
Pure converter (M4-T3, `lib/observation-to-patch.ts`, no LLM): `cloud_cover` % → `solarDropPct` (0–90, max wins);
`shaded_panel`/`dusty_panel` % → all-day `solarDropPct` + 0/24 window (M8-T2; cloud vs panel: max wins, ties go all-day);
`meter_reading` kW + sector → `meterReadings` (24 identical hours); anything else → `unmapped[]` with a reason.
Cloud track → profile (M8-T4, `lib/cloud-track-to-profile.ts`, no LLM): `[{t, cloud01}]` → 24 `solarProfile`
values (`base[h] × (1 − cloud)`, hourly frame average, carry-forward, rounded 3 dp). The frame analysis
(video pipeline + maquette camera feed, S4) does not exist yet; the converter is the half it will feed.
Every result carries `{ source: 'meta'|'mock', model, fallback?: 'provider_error'|'spend_cap'|'not_configured', failure? }`
(`failure` with `provider_error`: `timeout`|`aborted`|`http_<status>`|`network`, from `failureOf`).

```ts
Transcript { text; durationMs; turns: { startMs; endMs; text; speaker? }[] }
VisionResult { summary; observations: { label; value: number|string|boolean; unit?; confidence /*0–1*/ }[] }
SegmentResult { concept; imageWidth; imageHeight; instances: { box:{x1,y1,x2,y2}; confidence?; outline? /*SVG path 0–1*/ }[]; count; boxCoverage /*0–1*/ }
// PV: appliances on a photo. Labels + geometry only, never watts (the engine catalog gives power).
DetectionResult { detections: { id /*det-n*/; label /*1–40*/; category: ApplianceCategory; confidence? /*0–1*/;
  box: { x; y; w; h } /*image fractions 0–1, top-left*/; outline? /*SVG path, 0–1*/ }[] /*≤ 20*/ }
```

## Visuals (`server/media/generate-image.ts`, M5-T1)

`buildVisualPrompt(kind, input, result, locale?)` → `{kind, prompt, overlay, caption}`. Pure, no LLM:
the prompt holds engine states as words and never a digit (tested); exact hours ride in
`overlay.cuts` for the HTML layer. `village_tonight` reuses the evening scene (`describeVillageScene`
at 20 h, overlay null); `shedding_poster` merges contiguous short hours per sector
(demand > 0.05 kW, shortfall > EPS) with `unservedKwh` rounded to 2 decimals.
`generate_visual` resolves `resultId` through the in-process `server/copilot/result-cache.ts`
(FIFO, 20 entries, filled by every engine tool incl. proposals); unknown id → `{error}`
telling the model to run a scenario first. Storage reuses the R2 media store
(`server/storage/media.ts`); the client consumes the `media` event (M5-T2/T3).
`day_comic` (M12-T3): one 4-panel strip from fixed hours (7/12/17/21); each panel reuses
`describeVillageScene` words (digit-free, ordinal words not numerals), the overlay carries
`panels: [{hour, sky, cuts}]` (cuts = real shortfall at that hour), rendered by
`DayComicBlock` with hour/state rows + PNG export.

## Constitution (`lib/constitution.ts`, M10-T2)

Rules stored as data, verified by pure code: `checkConstitution(rules, {patch?, strategy?,
floors?})` → `{violations: [{ruleId, reason}], unknownKinds}`. Three kinds: `never_cut`
(zero cap on the sector), `min_floor` (resulting floor below `kw`), `strategy_only`
(strategy off the list). Unknown kinds are reported aside and never block. Defaults
(`DEFAULT_CONSTITUTION`): clinic never cut, clinic floor ≥ 0.5 kW. `autopilotProposal`
checks every R1/R2 candidate and skips violators (falls through, else silence); the
human copilot flow keeps its double-confirmation override (M1-T2). `/simulation` deck
shows the rules in plain words (`ConstitutionCard`, EN/FR/MG).

## Autonomy envelope (`lib/envelope.ts`, M10-T3)

Operator-set permissions for what the AI may apply ALONE in simulation: `{strategyChange,
clinicFloor}`, both false by default (`ENVELOPE_OFF`). `withinEnvelope(envelope,
suggestion)` maps autopilot R1 → `strategyChange`, R2 → `clinicFloor`. In-envelope
suggestions auto-apply on new hours (history shows `accepted · auto`); outside-envelope
suggestions stay pending for the operator's tap. Opening the envelope never flips an
already-pending suggestion. Switches live on the deck autopilot card (EN/FR/MG).

## AI autonomous dispatch (`schemas/autonomy.ts` + `autonomy.ts`, PA)

```ts
type DispatchMode = 'manual' | 'assisted' | 'autonomous';
type IncidentKind = 'fire' | 'overload' | 'demand_surge' | 'reserve_low' | 'critical_forecast'
  | 'solar_surplus' | 'meter_anomaly' | 'lifeline_shortfall';
type IncidentSeverity = 'info' | 'warning' | 'critical'; // SEVERITY_RANK: critical 0 → info 2
type Evidence = Record<string, number>; // engine values only, finite
interface Incident { kind; severity; day: 0–6; hour: 0–23; sector?: SectorId; evidence: Evidence }
type AutoActionKind = 'isolate_sector' | 'cap_sector' | 'shed_flexible' | 'switch_strategy'
  | 'raise_clinic_floor' | 'reserve_night' | 'shift_flexible' | 'restore_sector' | 'alert_only';
interface AutoAction { kind; sector?; patch?: InputPatch; strategy?: StrategyId; answers?: IncidentKind }
interface DispatchSnapshot { resultId; unservedKwh ≥ 0; criticalUnservedKwh ≥ 0; socEndPct 0–100 }
interface Narration { text: string /* 1–400 */; source: 'llm' | 'template' }
interface DispatchLogEntry { id; day; hour; mode: DispatchMode; origin: 'ai' | 'operator';
  incident?; action?; before?: DispatchSnapshot; after?: DispatchSnapshot; narration?; hash }
dispatchLogHash(entry): string   // fnv1a64(canonicalJson(entry without hash))
sortIncidents(incidents): Incident[] // severity, then day, then hour; no mutation
detectIncidents(input, result, hour, lookaheadH = 3, day = 0): Incident[] // pure detectors, sorted by severity
candidateActions(incident, input): AutoAction[] // pure generator for all incident kinds (PA-T2a)
simulateHorizon(input, strategy, startHour, endHour, initialStoredKwh): DispatchSnapshot // fast forward lookahead
checkAntiOscillation(action, hour, day, history): boolean // max 2 actions/h, no reversal in 2h, fire exception (PA-T2c)
decideDispatch(input, hour, strategy, incidents, rules?, history?, day?): DispatchDecision // evaluates candidates over horizon, drops constitution violations, selects best (PA-T2b)
```

`AutoAction` refinements: `switch_strategy` needs `strategy`; `alert_only` carries neither patch nor
strategy; every other kind needs `patch`; sector kinds (`isolate`, `cap`, `shed_flexible`,
`shift_flexible`, `restore`) need `sector`. `DispatchLogEntry` needs an incident or an action, and a
grid-changing action needs `before` and `after`. Stored in Neon: table `dispatch_log` (migration
`0004_dispatch_log`), client syncs via `POST /api/dispatch/log` (`GET ?limit=1..500`, default 100,
returns the latest lines oldest first).

Copilot in autonomous mode (`lib/dispatch-log.ts`, PA-T3c): `operatorAutoAction(input, proposal)` returns the
action a `propose_change` performs alone (`switch_strategy`, `cap_sector`, `raise_clinic_floor`), or `null` → the
usual Approve card: constitution violation (incl. lifeline floors), any `clearFires`, or no fitting kind.
The line has `origin: 'operator'`, full-day `before`/`after` (`resultSnapshot`) and the proposal reason as
`narration` (`source: 'llm'`, ≤ 400 chars); the UI labels operator origin via i18n.

Autonomous narration & shift reporting (`lib/dispatch-log.ts`, PA-T5):

- `POST /api/dispatch/narrate`: receives `{ entry: DispatchLogEntry, locale: 'fr'|'en'|'mg' }`, returns `{ narration: Narration, cached: boolean }`. Cached by `entry.hash:locale` in memory and Neon. Grounded with strict factual validation (`isNarrationFactual`: zero unproven numbers) + deterministic i18n template fallback (`formatTemplateNarration`). Spend-capped. `updateDispatchLogNarration(id, narration)` re-seals the entry hash (narration is hashed).
- `POST /api/copilot` body also takes `day?: 0–6` and `dispatchLog?: DispatchLogEntry[]` (≤ 200) for `get_dispatch_log`.
- `COPILOT_FILL_EVENT` (`@/lib/copilot-fill`): window event `{ prompt, autoSend? }` that fills the copilot composer; send it with `fillCopilotPrompt()`.
- Copilot tool `get_dispatch_log`: inspects `{ limit?, day?, hour?, sector?, severity?, origin? }`, returns filtered entries, summary counts, and avoided deficit metrics (`totalSavedKwh`).
- Shift summary report (`computeShiftReport(entries, day)`): aggregates incidents by severity, autonomous actions by kind, total and critical energy saved (`criticalSavedKwh`), final battery SoC, and notable interventions. Rendered via `ShiftReportDialog`.

## Meeting (`lib/meeting-priorities.ts`, `POST /api/meetings`, M10-T4)

Village meeting recording → diarized turns → social priorities → proposed patch. The route
takes a WAV (≤ 10 MB, ≈ 5 min), transcribes with `diarize: true`, and runs the deterministic
extractor: EN/FR/MG sector keywords (accent-insensitive, whole-word) + protect / mention /
deprioritize wants → `priorities` patch (`critical` / `high` / `low`), plus a 0.5 kW lifeline
floor for never-cut wants. Strongest want wins on conflict; sector-less turns are `unmapped`;
time notes (morning…) stay on the priorities, out of the patch. The client posts the result
as a chat `meeting` block (`MeetingPanel` uploader lives on full `/copilot` only); the
operator proposes from the block through the usual dialog (proposal ids `PROP-MEETING-*`).

## Local Glimmer (`server/copilot/providers/glimmer.ts`, M11-T1)

`GlimmerLlmProvider` speaks OpenAI-compatible `POST {GLIMMER_BASE_URL}/chat/completions` with
tools (vLLM, Ollama); `GLIMMER_MODEL` default `muse-glimmer-30b`, auth header only when
`GLIMMER_API_KEY` is set. Text only: attached media is dropped before sending. Fallback chain
in `loop.ts`: cloud → Glimmer → mock; the local step exists only when `GLIMMER_BASE_URL` is
set (else Meta → mock as before; injectable as `localProvider` for tests). A spent chat budget
does not block Glimmer (caller's signal); only the mock step emits `PROVIDER_FALLBACK`.
Glimmer is never billed and never spend-capped. `LLM_PROVIDER=glimmer` leads local
(`/api/copilot/models` serves `['auto', GLIMMER_MODEL]`); `pickChatModel` keeps the Glimmer id
when it is the only model so `setModel` never overwrites it with Spark's.

## Generators (M12-T2, D1 + D2)

`packages/engine/scripts/gen-scenarios.ts` (D1): Spark 1.2 writes scenario overlays on
baseline (`GeneratedScenarioSchema` in `src/scenarios/generated-schema.ts`: events + battery
tweaks + `{strategy, metric, op, value}` assertions); Zod-validated before writing, one retry
per brief, never writes invalid output. JSON lands in `src/scenarios/generated/` (outside the
`ScenarioId` enum and the registry — no contract change); the harness
`src/__tests__/generated.test.ts` simulates each on all 3 strategies (`violations == 0`) and
checks the assertions. Committed: `rainy_season`, `cyclone`, `village_festival`.
`apps/web/scripts/gen-evals.ts` (D2): Contributor writes synthetic `{prompt, expectTool,
expectEvidence}` evals (synthetic only — Contributor trains on inputs); the harness
`eval.synthetic.test.ts` runs each through the offline loop asserting the routed tool, the
4-section shape and `done`. Both run offline from deterministic templates by default
(`make gen-scenarios`, `make gen-evals`); `--live` variants need `META_API_KEY`. jiti runs the
scripts (tsx needs an IPC pipe, blocked in sandboxes).

## Scenario Draft & Chat Dispatch (PA-T8b..f, J9–J10)

### Types (`apps/web/src/lib/scenario-draft.ts`)

```ts
type ScenarioDraftEventType = 'fire' | 'solar_drop' | 'demand_spike';

interface ScenarioDraftFireEvent {
  type: 'fire';
  sector?: SectorId;
  startHour?: number; // 0–23
  durationH?: number; // 1–24
}

interface ScenarioDraftSolarDropEvent {
  type: 'solar_drop';
  dropPct?: number; // 0–90%
  startHour?: number;
  durationH?: number;
}

interface ScenarioDraftDemandSpikeEvent {
  type: 'demand_spike';
  sector?: SectorId | 'all';
  factor?: number; // 0.5–3.0
  startHour?: number;
  durationH?: number;
}

type ScenarioDraftEvent =
  ScenarioDraftFireEvent | ScenarioDraftSolarDropEvent | ScenarioDraftDemandSpikeEvent;

interface ScenarioDraftDay {
  day: number; // 1–7
  weather?: WeatherId;
  events?: ScenarioDraftEvent[];
}

interface ScenarioDraft {
  title?: string;
  days: ScenarioDraftDay[];
  startSocPct?: number; // 0–100
  strategy?: StrategyId;
  dispatchMode?: DispatchMode;
}

type MissingSlotKind =
  | 'day_out_of_bounds'
  | 'duplicate_weather'
  | 'missing_weather'
  | 'missing_fire_sector'
  | 'missing_fire_hour'
  | 'missing_spike_sector'
  | 'missing_spike_factor'
  | 'missing_drop_pct'
  | 'missing_drop_hour';

interface MissingSlot {
  kind: MissingSlotKind;
  day: number;
  eventIndex?: number;
  messageKey: string;
  suggestedResponses: Array<{ label: string; value: string | number }>;
}

interface ScenarioDraftPreview {
  worstDay: number;
  totalDeficitKwh: number;
  criticalUnservedKwh: number;
  dayDeficits: Array<{ day: number; deficitKwh: number }>;
}

interface ScenarioDraftPayload {
  draft: ScenarioDraft;
  missingSlots: MissingSlot[];
  isComplete: boolean;
  preview?: ScenarioDraftPreview;
}
```

### Pure Helpers & Invariants

- `missingSlots(draft: ScenarioDraft): MissingSlot[]`: Returns ordered missing slots requiring conversational clarification. A complete draft produces 0 missing slots.
- `applyDraftDefaults(draft: ScenarioDraft): ScenarioDraft`: Purely fills unspecified fields with standard defaults (fire duration to midnight `24 - startHour`, initial SoC 60%, strategy `proportional`, mode `manual`).
- `draftToWorkflow(draft: ScenarioDraft)`: Converts draft into engine `Workflow` (`WorkflowDay[]` with per-day `events`), `startSocPct`, `strategy`, and `dispatchMode`.

### Copilot Tool & SSE Event

- Copilot Tool `draft_scenario`: input `{ text: string, currentDraft?: ScenarioDraft }`. Extracts multi-day scenario structure (FR/EN/MG), merges with existing session draft, validates via `ScenarioDraftSchema`, and computes `missingSlots` plus `compareWorkflow` engine preview if complete.
- SSE Event `scenario_draft`: streams `ScenarioDraftPayload` to the client for live interactive rendering in `ScenarioDraftCard`.

### Neon Persistence (`apps/web/src/server/db/`)

- Migration `0005_scenario_drafts`:
  ```sql
  CREATE TABLE IF NOT EXISTS scenario_drafts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    draft JSONB NOT NULL,
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- API route: `GET /api/scenarios/drafts`, `POST /api/scenarios/drafts`, `DELETE /api/scenarios/drafts?id=:id`. In-memory fallback active when `DATABASE_URL` is unset.
