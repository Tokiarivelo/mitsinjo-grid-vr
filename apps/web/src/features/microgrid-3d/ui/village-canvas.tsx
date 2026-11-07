'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import type { WebGLRenderer } from 'three';
import { SECTOR_IDS, type Priority, type SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { useSimulationStore } from '@/stores';
import { fmtKw } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useShaderWarmup, type WarmupTarget } from '../hooks/use-shader-warmup';
import type {
  ApplianceMarkerSceneModel,
  BatteryStatusColor,
  BuildingSceneModel,
  CameraPreset,
  SceneModel,
} from '../types';
import { useMarkerDrag } from '../hooks/use-marker-drag';
import { useMoveMarker } from '../hooks/use-move-marker';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { usePerfFlag } from '../hooks/use-perf-flag';
import { useInView } from '../hooks/use-in-view';
import { useContextLoss } from '../hooks/use-context-loss';
import { useFeederLabels } from '../hooks/use-feeder-labels';
import { useSceneQuality, type SceneQuality } from '../hooks/use-scene-quality';
import { isSoftwareRenderer } from '../utils/webgl';
import { createSceneStats, sampleSceneStats, type SceneStatsSample } from '../utils/scene-stats';
import { applyOvercast, skyPalette } from '../utils/sky-palette';
import { WEATHER_ATMOSPHERE } from '../utils/weather-atmosphere';
import { SUN_AZIMUTH_RAD } from '../utils/landscape';
import type { SectorStateOverride } from '../utils/placed-models-geometry';
import { usePlacedClearings } from '../hooks/use-site-zones';
import { accessPathClearings, accessPaths } from '../utils/access-paths';
import { SceneStatsProbe } from './scene-stats-probe';
import { VillageTerrain } from './terrain';
import { PlacedYards } from './placed-yards';
import { SolarArray } from './solar-array';
import { BatteryUnit } from './battery-unit';
import { DispatchControllerUnit } from './dispatch-controller-unit';
import { FeederTags } from './feeder-tags';
import { ApplianceMarkers, MarkerDragGhost } from './appliance-markers';
import { DistributionLines } from './distribution-lines';
import { VillageBuildings } from './buildings';
import { CameraController } from './camera-controller';
import { SkyBackdrop } from './sky-backdrop';
import { Vegetation } from './vegetation';
import { Vehicles } from './vehicles';
import { PostEffects } from './post-effects';
import { QualityProbe } from './quality-probe';
import { FireEffects } from './fire-effects';
import { WeatherEffects } from './weather-effects';
import { BakedContactShadows, ResumeOnVisible, ShadowBake } from './render-control';
import { VillageScenePlaceholder } from './scene-placeholder';
import { CanvasCreationBoundary } from './canvas-creation-boundary';

export const SUNSET_HDRI_URL = '/3d/sunset_512.hdr';

/**
 * Marker select + drag (PP-T5). Lives inside the Canvas: `useMarkerDrag` needs the R3F context
 * for the camera and orbit controls. Every page that shows the village (/village, /simulation,
 * the overview preview) shares this wiring and the same input store.
 */
function DraggableApplianceMarkers({
  markers,
  selectedSector,
  tagOf,
  priorityLabels,
  aiBadgeLabel,
  htmlPortal,
  tier,
  sectorStatuses,
}: {
  markers: ApplianceMarkerSceneModel[];
  selectedSector: SectorId | null;
  tagOf: (m: ApplianceMarkerSceneModel) => string;
  priorityLabels?: Record<Priority, string>;
  aiBadgeLabel?: string | undefined;
  htmlPortal?: RefObject<HTMLElement | null>;
  tier?: 'high' | 'low';
  sectorStatuses?: Partial<Record<SectorId, SectorStateOverride>>;
}) {
  const moveMarker = useMoveMarker();
  const { selectedId, dragId, ghostRef, bindMarker, toggleSelect } = useMarkerDrag({
    onCommit: moveMarker,
  });
  return (
    <>
      <ApplianceMarkers
        markers={markers}
        selectedSector={selectedSector}
        tagOf={tagOf}
        {...(priorityLabels ? { priorityLabels } : {})}
        {...(aiBadgeLabel ? { aiBadgeLabel } : {})}
        onSelectMarker={toggleSelect}
        htmlPortal={htmlPortal}
        selectedId={selectedId}
        dragId={dragId}
        bindMarker={bindMarker}
        tier={tier}
        sectorStatuses={sectorStatuses}
      />
      <MarkerDragGhost ghostRef={ghostRef} visible={dragId !== null} />
    </>
  );
}

const KEY_LIGHT_DISTANCE = 70;
/** Trees are cleared a bit past the yard so their canopies don't hang over it. */
const TREE_CANOPY_MARGIN = 0.8;
/** Smallest drawn yard (scene units): the red ground must show around a small object. */
const MIN_YARD_RADIUS = 2;

export interface VillageCanvasProps {
  model: SceneModel;
  selectedSector: SectorId | null;
  onSelectSector: (sector: SectorId | null) => void;
  cameraPreset?: CameraPreset;
  /** Select or focus on a camera preset (e.g. clicking the EMS controller). */
  onSelectPreset?: (preset: CameraPreset) => void;
  /** Bump to re-apply the current preset (reset camera after the user orbits). */
  cameraResetKey?: number;
  /** Inserted appliance to fly the camera to (bottom bar chip). */
  focusApplianceId?: string | null;
  /** Hand tool: drag pans the view instead of orbiting. */
  panMode?: boolean;
  /** Render tier override. Default: the shared tier from `useSceneQuality` (toggle + auto-downgrade). */
  quality?: SceneQuality;
  /** Filled with the R3F renderer on mount: the VR button needs it to open the XR session. */
  rendererRef?: RefObject<WebGLRenderer | null>;
  /** An XR session is presenting: continuous loop, no post-processing, orbit off, VR viewpoint. */
  xrActive?: boolean;
  className?: string;
}

export function VillageCanvas({
  model,
  selectedSector,
  onSelectSector,
  cameraPreset = 'village',
  onSelectPreset,
  cameraResetKey = 0,
  focusApplianceId = null,
  panMode = false,
  quality: qualityOverride,
  rendererRef,
  xrActive = false,
  className,
}: VillageCanvasProps) {
  const sceneQuality = useSceneQuality();
  const quality = qualityOverride ?? sceneQuality.quality;
  // Auto-downgrade only applies when the tier comes from the shared store and the user didn't pick it.
  const onSlowDevice =
    qualityOverride || sceneQuality.userChosen ? undefined : sceneQuality.autoDowngrade;
  const tSectors = useTranslations('sectors');
  const tPriorities = useTranslations('priorities');
  const tSim = useTranslations('features.simulation');
  const tDiagram = useTranslations('features.gridDiagram');
  const tDispatch = useTranslations('features.dispatch');
  const aiInControl = useSimulationStore((s) => s.dispatchMode === 'autonomous');
  const feeders = useFeederLabels(model);

  const reducedMotion = useReducedMotion();
  // A modified scenario shows the last result frozen: no flow animation.
  // Moving electrons need a continuous frame loop: off without a GPU (each software
  // frame costs ~0.5 s and would freeze the page); dots stay visible, frozen.
  const softwareGl = isSoftwareRenderer();
  const animate = !reducedMotion && !model.isModified && !softwareGl;
  // Shader warm-up (PT-7): the canvas fades in once its materials are compiled (≤ 1 s).
  const [warmTarget, setWarmTarget] = useState<WarmupTarget | null>(null);
  const warm = useShaderWarmup(warmTarget);
  const high = quality === 'high';

  const sectorStatuses = useMemo(() => {
    const map: Partial<Record<SectorId, SectorStateOverride>> = {};
    for (const [id, b] of Object.entries(model.buildings) as [SectorId, BuildingSceneModel][]) {
      map[id] = {
        unserved: b.status === 'unserved' || b.status === 'disconnected',
        onFire: b.onFire,
      };
    }
    return map;
  }, [model.buildings]);

  const clearings = usePlacedClearings(model.appliances);
  // Bare laterite yard big enough to read around small objects, plus a red track to the village
  // paths; trees on both are cleared.
  const yards = useMemo(
    () => clearings.map((k) => ({ ...k, r: Math.max(k.r, MIN_YARD_RADIUS) })),
    [clearings]
  );
  const tracks = useMemo(() => accessPaths(yards), [yards]);
  const treeClearings = useMemo(
    () => [
      ...yards.map((k) => ({ ...k, r: k.r + TREE_CANOPY_MARGIN })),
      ...accessPathClearings(tracks),
    ],
    [yards, tracks]
  );

  const sectorNames = Object.fromEntries(SECTOR_IDS.map((id) => [id, tSectors(id)])) as Record<
    SectorId,
    string
  >;

  const priorityLabels: Record<Priority, string> = {
    critical: tPriorities('critical'),
    high: tPriorities('high'),
    medium: tPriorities('medium'),
    low: tPriorities('low'),
  };

  const batteryStatusLabels: Record<BatteryStatusColor, string> = {
    healthy: tSim('batteryHealthy'),
    warning: tSim('batteryLow'),
    critical: tSim('batteryDepleted'),
  };
  const socLabel = (pct: string) => tSim('socValue', { pct });

  // Fixed parent for in-scene HTML labels, so drei's <Html> never re-targets after mount.
  const htmlPortal = useRef<HTMLDivElement>(null);
  // Off-screen canvas: stop the frame loop (no hidden 60 fps render while reading the page).
  const inView = useInView(htmlPortal);
  // Lost WebGL context → placeholder, then a fresh canvas (never a white box).
  const contextLoss = useContextLoss();

  // ?perf=1 -> draw calls / fps readout, sampled at 2 Hz (no per-frame React state).
  const perfEnabled = usePerfFlag();
  // Stable mutable counters shared with the in-canvas probe.
  const [stats] = useState(() => createSceneStats(0));
  const [perf, setPerf] = useState<SceneStatsSample | null>(null);
  useEffect(() => {
    if (!perfEnabled) return;
    sampleSceneStats(stats, performance.now()); // start a fresh window
    const id = window.setInterval(() => {
      const sample = sampleSceneStats(stats, performance.now());
      setPerf(sample);
      // Read by `make scene-audit`.
      (window as Window & { __mitsinjoScene?: SceneStatsSample }).__mitsinjoScene = sample;
    }, 500);
    return () => window.clearInterval(id);
  }, [perfEnabled, stats]);

  // Art-directed light for the selected hour (golden hour by day, moonlit night),
  // greyed by the day's weather (overcast sky, dim sun, thicker haze).
  const palette = useMemo(
    () =>
      applyOvercast(
        skyPalette(model.sunElevation, model.isDaytime),
        WEATHER_ATMOSPHERE[model.weather].overcast,
        model.isDaytime
      ),
    [model.sunElevation, model.isDaytime, model.weather]
  );
  // Clouds drift and rain falls whenever motion is allowed (even on a modified run).
  const weatherMotion = !reducedMotion && !softwareGl;
  const sunDirection = useMemo<[number, number, number]>(() => {
    const alt = (palette.sunAltitudeDeg * Math.PI) / 180;
    return [
      Math.cos(alt) * Math.sin(SUN_AZIMUTH_RAD),
      Math.sin(alt),
      -Math.cos(alt) * Math.cos(SUN_AZIMUTH_RAD),
    ];
  }, [palette.sunAltitudeDeg]);
  // Visible sun / sky glow: low on the horizon so the sunset reads in frame.
  const skySunDirection = useMemo<[number, number, number]>(() => {
    const alt = (palette.sunDisplayAltitudeDeg * Math.PI) / 180;
    return [
      Math.cos(alt) * Math.sin(SUN_AZIMUTH_RAD),
      Math.sin(alt),
      -Math.cos(alt) * Math.cos(SUN_AZIMUTH_RAD),
    ];
  }, [palette.sunDisplayAltitudeDeg]);
  const keyLightPos = useMemo<[number, number, number]>(
    () => [
      sunDirection[0] * KEY_LIGHT_DISTANCE,
      sunDirection[1] * KEY_LIGHT_DISTANCE,
      sunDirection[2] * KEY_LIGHT_DISTANCE,
    ],
    [sunDirection]
  );
  // Shadow casters are static: re-bake the sun shadow map only when light or data change.
  const shadowBakeKey = useMemo(() => [keyLightPos, model] as const, [keyLightPos, model]);
  // XR renders the headset pose every frame; otherwise render on demand (never off-screen).
  const frameloop = xrActive ? 'always' : inView ? 'demand' : 'never';

  return (
    <div
      ref={htmlPortal}
      // `isolate`: drei labels use z-index up to 16 777 271; keep them under the HUD and the copilot terminal.
      className={cn('relative isolate', className)}
      style={{ width: '100%', height: '100%' }}
    >
      {perfEnabled && perf && (
        <div className="absolute bottom-24 right-3 z-20 px-2 py-1 rounded-control bg-surface-elevated/90 border border-border text-[10px] font-mono text-text-secondary pointer-events-none">
          {tSim('perfOverlay', { calls: perf.calls, fps: perf.fps })}
        </div>
      )}
      {contextLoss.lost && <VillageScenePlaceholder className="absolute inset-0 z-10" />}
      {/* Creation can throw when the browser blocks new contexts: placeholder + bounded retries. */}
      <CanvasCreationBoundary key={contextLoss.epoch} onFail={contextLoss.reportCreationFailed}>
        <Canvas
          // Remount on tier change (shadow maps, MSAA and shaders differ) and after a lost context.
          key={`${quality}-${contextLoss.epoch}`}
          onCreated={({ gl, get, scene, camera }) => {
            contextLoss.attach(gl.domElement, () => get().internal.active);
            if (rendererRef) rendererRef.current = gl;
            setWarmTarget({ gl, scene, camera });
          }}
          className={cn(
            'transition-opacity duration-300 motion-reduce:transition-none',
            warm ? 'opacity-100' : 'opacity-0'
          )}
          camera={{ position: [2, 10.5, 28], fov: 42, near: 0.5, far: 1400 }}
          dpr={high ? [1, 1.5] : [1, 1.25]}
          frameloop={frameloop}
          shadows={high ? 'soft' : false}
          gl={{
            antialias: !high,
            powerPreference: softwareGl ? 'default' : 'high-performance',
            failIfMajorPerformanceCaveat: false,
          }}
          style={{ width: '100%', height: '100%', background: palette.horizon }}
        >
          <fog
            attach="fog"
            args={[palette.fog, 48 * palette.fogScale, (high ? 210 : 170) * palette.fogScale]}
          />

          <hemisphereLight args={[palette.hemiSky, palette.hemiGround, palette.hemiIntensity]} />
          <directionalLight
            position={keyLightPos}
            color={palette.sun}
            intensity={palette.keyIntensity}
            castShadow={high}
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.09}
            shadow-camera-left={-34}
            shadow-camera-right={34}
            shadow-camera-top={34}
            shadow-camera-bottom={-34}
            shadow-camera-near={10}
            shadow-camera-far={160}
          />
          {/* Cool sky fill from the opposite side keeps shadows readable. */}
          <directionalLight
            position={[-40, 30, 40]}
            color="#8fa3d9"
            intensity={palette.hemiIntensity * 0.45}
          />

          <SkyBackdrop palette={palette} sunDirection={skySunDirection} detail={quality} />
          <WeatherEffects
            weather={model.weather}
            isDaytime={model.isDaytime}
            quality={quality}
            animate={weatherMotion}
            palette={palette}
            sunDirection={skySunDirection}
          />
          <FireEffects buildings={model.buildings} quality={quality} animate={weatherMotion} />

          <Suspense fallback={null}>
            <Environment files={SUNSET_HDRI_URL} environmentIntensity={palette.envIntensity} />
          </Suspense>

          <VillageTerrain quality={quality} />
          <PlacedYards clearings={yards} paths={tracks} />
          <Suspense fallback={null}>
            <Vegetation quality={quality} clearings={treeClearings} />
            <Vehicles />
            {/* Inside the casters' Suspense so the first bake includes the loaded trees. */}
            {high && <ShadowBake bakeKey={shadowBakeKey} />}
          </Suspense>
          <ResumeOnVisible />

          <SolarArray
            model={model.solar}
            nameLabel={tSim('solarArray')}
            outputLabel={`${tSim('liveOutput')} : ${fmtKw(model.solar.currentKw)}`}
            htmlPortal={htmlPortal}
          />
          <BatteryUnit
            model={model.battery}
            statusLabels={batteryStatusLabels}
            socLabel={socLabel}
            nameLabel={tSim('bessBattery')}
            htmlPortal={htmlPortal}
          />
          <DispatchControllerUnit
            model={model.controller}
            tones={feeders.tones}
            totalServedKw={model.lines.batteryToBus.flowKw}
            modeLabel={tDiagram(`controller.mode.${model.controller.mode}`)}
            feederTitles={feeders.titles}
            hasResult={model.hasResult}
            onFocus={() => onSelectPreset?.('controller')}
            nameLabel={tDiagram('controller.shortTitle')}
            htmlPortal={htmlPortal}
          />
          {model.hasResult && (
            <FeederTags
              lines={model.lines.busToSectors}
              buildings={model.buildings}
              tones={feeders.tones}
              titles={feeders.titles}
              htmlPortal={htmlPortal}
            />
          )}
          {perfEnabled && <SceneStatsProbe stats={stats} />}
          <DistributionLines
            lines={model.lines}
            feeders={model.controller.feeders}
            animate={animate}
            lampGlow={palette.lampGlow}
            halo={high}
          />
          <DraggableApplianceMarkers
            markers={model.appliances}
            selectedSector={selectedSector}
            tagOf={(m) => tSim('applianceBadgeTitle', { name: m.name, quantity: m.quantity })}
            priorityLabels={priorityLabels}
            aiBadgeLabel={aiInControl ? tDispatch('aiBadge') : undefined}
            htmlPortal={htmlPortal}
            tier={quality}
            sectorStatuses={sectorStatuses}
          />
          <VillageBuildings
            buildings={model.buildings}
            selectedSector={selectedSector}
            onSelectSector={onSelectSector}
            sectorNames={sectorNames}
            priorityLabels={priorityLabels}
            disconnectedLabel={tDiagram('status.disconnected')}
            aiBadgeLabel={aiInControl ? tDispatch('aiBadge') : undefined}
            htmlPortal={htmlPortal}
            lampGlow={palette.lampGlow}
          />

          {/* No post-processing in XR: EffectComposer breaks stereo rendering. */}
          {!xrActive &&
            (high ? (
              <>
                <PostEffects />
                {/* Probe only on screen: a paused loop would starve it and force a downgrade. */}
                {onSlowDevice && inView && <QualityProbe onSlow={onSlowDevice} />}
              </>
            ) : (
              // Low tier: one baked contact shadow instead of real-time shadow maps.
              <BakedContactShadows />
            ))}

          <CameraController
            preset={cameraPreset}
            resetKey={cameraResetKey}
            xrActive={xrActive}
            focusSector={selectedSector}
            focusPoint={model.appliances.find((a) => a.id === focusApplianceId)?.position ?? null}
            panMode={panMode}
            autoRotate={!softwareGl}
            reducedMotion={reducedMotion}
            damping={high && !reducedMotion}
          />
        </Canvas>
      </CanvasCreationBoundary>
    </div>
  );
}
