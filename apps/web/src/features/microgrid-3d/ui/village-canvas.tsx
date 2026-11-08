'use client';

import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { WebGLRenderer } from 'three';
import { SECTOR_IDS, type Priority, type SectorId, type WeatherId } from '@mitsinjo/engine';
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
import { applyOvercast, skyPalette, type SkyPalette } from '../utils/sky-palette';
import { WEATHER_ATMOSPHERE } from '../utils/weather-atmosphere';
import {
  moonCoordinates,
  nightFactor,
  shortestHourDelta,
  sunCoordinates,
} from '../utils/celestial';
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
import { SkyBackdrop, SKY_RADIUS } from './sky-backdrop';
import { Vegetation } from './vegetation';
import { WindTurbines } from './wind-turbines';
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

interface CelestialLightingProps {
  timeIndex: number;
  isDaytime: boolean;
  weather: WeatherId;
  palette: SkyPalette;
  quality: 'high' | 'low';
  weatherMotion: boolean;
  nightProgress: number;
}

/**
 * Physical celestial lighting and sky orchestrator (06:00 to 18:00 day arc, 18:00 to 06:00 night arc):
 * - Sun sweeps from side (+X) at 06:00 -> overhead above camera (+Y, +Z) at 12:00 -> behind camera (+Z) at 18:00.
 * - Key light follows the exact same unit vector so shadows physically reflect the sun's trajectory.
 * - In useFrame, smoothly glides the sun and shadows at 60 FPS without React re-renders or allocations.
 */
function CelestialLighting({
  timeIndex,
  isDaytime,
  weather,
  palette,
  quality,
  weatherMotion,
  nightProgress,
}: CelestialLightingProps) {
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const fillLightRef = useRef<THREE.DirectionalLight>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight>(null);
  const sunGroupRef = useRef<THREE.Group>(null);
  const moonGroupRef = useRef<THREE.Group>(null);
  const skyUniformsRef = useRef<{
    uZenith: THREE.IUniform<THREE.Color>;
    uHorizon: THREE.IUniform<THREE.Color>;
    uGlow: THREE.IUniform<THREE.Color>;
    uSunDir: THREE.IUniform<THREE.Vector3>;
  } | null>(null);
  const cloudUniformsRef = useRef<{
    uSunDir: THREE.IUniform<THREE.Vector3>;
    uSunColor: THREE.IUniform<THREE.Color>;
    uSkyColor: THREE.IUniform<THREE.Color>;
    uGroundColor: THREE.IUniform<THREE.Color>;
    uSunGlow: THREE.IUniform<THREE.Color>;
  } | null>(null);
  const currentHourRef = useRef(timeIndex);

  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const playbackSpeed = useSimulationStore((s) => s.playbackSpeed);

  const sun = useMemo(() => sunCoordinates(timeIndex), [timeIndex]);
  const moon = useMemo(() => moonCoordinates(timeIndex), [timeIndex]);
  const activeDirection = isDaytime ? sun.keyDirection : moon.keyDirection;
  const initialKeyLightPos = useMemo<[number, number, number]>(
    () => [
      activeDirection[0] * KEY_LIGHT_DISTANCE,
      activeDirection[1] * KEY_LIGHT_DISTANCE,
      activeDirection[2] * KEY_LIGHT_DISTANCE,
    ],
    [activeDirection]
  );

  useLayoutEffect(() => {
    if (keyLightRef.current) {
      keyLightRef.current.position.set(...initialKeyLightPos);
    }
  }, [initialKeyLightPos]);

  useFrame((state, delta) => {
    if (!weatherMotion) return;
    const dt = Math.min(delta, 0.1);

    if (isPlaying) {
      // Continuous constant-speed rotation matching playback speed (2.0 hrs/sec at 1x)
      const speedMult = typeof playbackSpeed === 'number' && playbackSpeed > 0 ? playbackSpeed : 1;
      const hoursPerSec = speedMult * 2.0; // 500ms base tick = 2.0 hrs/sec
      currentHourRef.current = (((currentHourRef.current + dt * hoursPerSec) % 24) + 24) % 24;

      // Soft sync against store timeIndex to avoid accumulated drift
      const drift = shortestHourDelta(currentHourRef.current, timeIndex);
      if (Math.abs(drift) > 1.5) {
        currentHourRef.current = timeIndex;
      } else if (Math.abs(drift) > 0.05) {
        currentHourRef.current += drift * dt * 2.0;
      }
    } else {
      // Manual scrub or pause: silky smooth exponential ease-out to target hour
      const diff = shortestHourDelta(currentHourRef.current, timeIndex);
      if (Math.abs(diff) > 0.0005) {
        const step = diff * (1 - Math.exp(-dt * 12.0));
        currentHourRef.current = (((currentHourRef.current + step) % 24) + 24) % 24;
      } else {
        currentHourRef.current = timeIndex;
      }
    }

    const curHour = currentHourRef.current;
    const curIsDay = curHour >= 6 && curHour <= 18;
    const celestial = curIsDay ? sunCoordinates(curHour) : moonCoordinates(curHour);
    const [dx, dy, dz] = celestial.direction;

    // Update light position matching physical trajectory
    if (keyLightRef.current) {
      keyLightRef.current.position.set(
        dx * KEY_LIGHT_DISTANCE,
        dy * KEY_LIGHT_DISTANCE,
        dz * KEY_LIGHT_DISTANCE
      );
    }

    // Update sun disc position smoothly
    if (curIsDay && sunGroupRef.current) {
      sunGroupRef.current.position.set(
        dx * SKY_RADIUS * 0.9,
        dy * SKY_RADIUS * 0.9,
        dz * SKY_RADIUS * 0.9
      );
    }

    // Update moon disc position smoothly
    if (!curIsDay && moonGroupRef.current) {
      moonGroupRef.current.position.set(
        dx * SKY_RADIUS * 0.88,
        dy * SKY_RADIUS * 0.88,
        dz * SKY_RADIUS * 0.88
      );
    }

    // Compute dynamic, continuous color progression (sunrise -> midday -> sunset -> night)
    const curElevation = curIsDay ? Math.sin(((curHour - 6) / 12) * Math.PI) : 0;
    const curPalette = applyOvercast(
      skyPalette(curElevation, curIsDay),
      WEATHER_ATMOSPHERE[weather].overcast,
      curIsDay
    );

    // Smoothly update light colors & intensities
    if (keyLightRef.current) {
      keyLightRef.current.color.set(curPalette.sun);
      keyLightRef.current.intensity = curPalette.keyIntensity;
    }
    if (hemiLightRef.current) {
      hemiLightRef.current.color.set(curPalette.hemiSky);
      hemiLightRef.current.groundColor.set(curPalette.hemiGround);
      hemiLightRef.current.intensity = curPalette.hemiIntensity;
    }
    if (fillLightRef.current) {
      fillLightRef.current.intensity = curPalette.hemiIntensity * 0.45;
    }

    // Smoothly update sky & cloud uniforms
    if (skyUniformsRef.current) {
      skyUniformsRef.current.uSunDir.value.set(dx, dy, dz);
      skyUniformsRef.current.uZenith.value.set(curPalette.zenith);
      skyUniformsRef.current.uHorizon.value.set(curPalette.horizon);
      skyUniformsRef.current.uGlow.value.set(curPalette.sunGlow);
    }
    if (cloudUniformsRef.current) {
      cloudUniformsRef.current.uSunDir.value.set(dx, dy, dz);
      cloudUniformsRef.current.uSunColor.value.set(curPalette.sun);
      cloudUniformsRef.current.uSkyColor.value.set(curPalette.hemiSky);
      cloudUniformsRef.current.uGroundColor.value.set(curPalette.hemiGround);
      cloudUniformsRef.current.uSunGlow.value.set(curPalette.sunGlow);
    }

    const diff = shortestHourDelta(currentHourRef.current, timeIndex);
    if (isPlaying || Math.abs(diff) > 0.0005) {
      // 60 FPS real-time smooth shadow updates while in motion
      state.gl.shadowMap.needsUpdate = true;
      state.invalidate();
    }
  });

  return (
    <>
      <hemisphereLight
        ref={hemiLightRef}
        args={[palette.hemiSky, palette.hemiGround, palette.hemiIntensity]}
      />
      <directionalLight
        ref={keyLightRef}
        color={palette.sun}
        intensity={palette.keyIntensity}
        castShadow={quality === 'high'}
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
        ref={fillLightRef}
        position={[-40, 30, 40]}
        color="#8fa3d9"
        intensity={palette.hemiIntensity * 0.45}
      />

      <SkyBackdrop
        palette={palette}
        sunDirection={sun.displayDirection}
        moonDirection={moon.displayDirection}
        isDaytime={isDaytime}
        nightProgress={nightProgress}
        detail={quality}
        animate={weatherMotion}
        sunGroupRef={sunGroupRef}
        moonGroupRef={moonGroupRef}
        skyUniformsRef={skyUniformsRef}
      />
      <WeatherEffects
        weather={weather}
        isDaytime={isDaytime}
        quality={quality}
        animate={weatherMotion}
        palette={palette}
        sunDirection={isDaytime ? sun.displayDirection : moon.displayDirection}
        timeIndex={timeIndex}
        cloudUniformsRef={cloudUniformsRef}
      />
    </>
  );
}

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

  // Celestial trajectory: Sun arcs 0° to 180° by day, Moon arcs 0° to 180° by night.
  const sun = useMemo(() => sunCoordinates(model.timeIndex), [model.timeIndex]);
  const moon = useMemo(() => moonCoordinates(model.timeIndex), [model.timeIndex]);
  const nightProgress = useMemo(() => nightFactor(model.timeIndex), [model.timeIndex]);

  // Active key light: sun by day, moon by night (matches shadow casting to visible orb).
  const activeKeyDirection = model.isDaytime ? sun.keyDirection : moon.keyDirection;
  const keyLightPos = useMemo<[number, number, number]>(
    () => [
      activeKeyDirection[0] * KEY_LIGHT_DISTANCE,
      activeKeyDirection[1] * KEY_LIGHT_DISTANCE,
      activeKeyDirection[2] * KEY_LIGHT_DISTANCE,
    ],
    [activeKeyDirection]
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
          <CelestialLighting
            timeIndex={model.timeIndex}
            isDaytime={model.isDaytime}
            weather={model.weather}
            palette={palette}
            quality={quality}
            weatherMotion={weatherMotion}
            nightProgress={nightProgress}
          />
          <FireEffects buildings={model.buildings} quality={quality} animate={weatherMotion} />

          <Suspense fallback={null}>
            <Environment files={SUNSET_HDRI_URL} environmentIntensity={palette.envIntensity} />
          </Suspense>

          <VillageTerrain quality={quality} />
          <PlacedYards clearings={yards} paths={tracks} />
          <Suspense fallback={null}>
            <Vegetation quality={quality} clearings={treeClearings} />
            <WindTurbines />
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
