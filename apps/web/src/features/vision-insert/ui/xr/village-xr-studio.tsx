'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { localDescription, localLabel, type ApplianceDetection } from '@/lib/vision';
import type { XrExtract } from '../../hooks/use-xr-extract';
import { useElapsedSeconds } from '../../hooks/use-elapsed-seconds';
import { createPanelRegistry } from './holo-panel';
import {
  HoloBuildPanel,
  HoloExtractDialog,
  HoloScanProgress,
  usePanelAnchor,
} from './holo-extract-panels';
import { HoloViewsCarousel } from './holo-views-carousel';
import { XrObjectLab } from './xr-object-lab';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { fitRecipe } from '@/lib/object-shape';
import { sceneScale, usePlacedModelsStore } from '@/stores';
import { useSimulationAppliances } from '../../hooks/use-simulation-appliances';
import { aiDraft, applianceIdFor, toAppliance } from '../../utils/appliance-draft';
import { projectDetectionsTo3D, type SpatialTarget } from './spatial-projection';
import { SpatialAirButton } from './spatial-air-button';
import { HoloDetectionTarget } from './holo-detection-target';
import { SpawnedObject3D } from './spawned-object-3d';
import { AIR_BUTTON_ID, XRBlasterController, type MiniatureHandle } from './xr-blaster-controller';
import { createTurntable, type Turntable } from './turntable';
import { playGridConnectSound, playGridDisconnectSound, playSnapSound } from './xr-audio-fx';
import { VillageSpatialHUD } from './village-spatial-hud';
import { LiveWebcamBackdrop } from './live-webcam-backdrop';
import { SpatialInteractionGuide } from './spatial-interaction-guide';
import { pickTargetAtUv, screenHitFromRay, WEBCAM_SCREEN } from './webcam-screen';
import { PanoramaTour } from './tour/panorama-tour';
import { usePanoramaTour } from './tour/use-panorama-tour';
import { photoRay } from './tour/grounded';
import { PhotoAnchored } from './tour/photo-anchored';
import { TOUR_EYE } from './tour/tour-nav';
import { yawPitchOf } from './tour/equirect';
import { MENU_GUIDE_OFFSET, MENU_SCAN_OFFSET, miniatureSlot } from './xr-layout';
import { createWristMenu, WRIST_BUTTON_ID } from './wrist-menu';
import { createAimReadout } from './xr-blaster-controller';
import { XrAimHint, XrControlLegend } from './xr-control-hints';
import { XrControlsDriver } from './xr-controls-driver';
import { SNAP_TURN, snapshotSources, STEP_DISTANCE, type XrControlAction } from './xr-controls';
import { snapTurn } from './xr-rig';
import type { AimHintContext } from './xr-aim-hint';
import { WristMenuButton, WristMenuPanel } from './xr-wrist-menu';

export interface VillageXRStudioProps {
  detections: ApplianceDetection[];
  isScanning: boolean;
  onTriggerScan: (capturedUrl?: string) => void;
  onSelectAppliance?: (id: string) => void;
  photoKey?: string;
  /**
   * Walkable 360° test space of real photos instead of the webcam wall (VS-T14): on by default
   * off a real headset (desktop preview, IWER emulator).
   */
  tourMode?: boolean;
  /**
   * 3D extraction (VS-T19–T22): a shot on an object asks « Extract to 3D? », then the 2D views
   * carousel, the build and the 3D lab. Absent → the shot makes a quick miniature (VS-T5).
   */
  extract?: XrExtract;
  /** Photo the objects were found on (the lab model reads its size). */
  imageUrl?: string | null;
}

const _gaze = new THREE.Vector3();
/** While a dialog, the views or the lab are up, nothing behind them takes a shot. */
const NO_TARGETS: SpatialTarget[] = [];
const NO_MINIATURES: Array<MiniatureHandle & { target: SpatialTarget }> = [];
const NO_HOTSPOTS: [] = [];

/**
 * Village XR Studio Scene.
 * Immersive 3D room with lighting, a wrist button that opens the menu (scan button, guide,
 * HUD) in front of the viewer, holographic target boxes, laser blaster interaction, and
 * procedural 3D model materialization in-situ.
 */
/** The button legends show this long after entering, then a stick click brings them back. */
const HELP_ON_ENTRY_MS = 25000;

export const VillageXRStudio = memo(function VillageXRStudio({
  detections,
  isScanning,
  onTriggerScan,
  onSelectAppliance,
  photoKey,
  tourMode = false,
  extract,
  imageUrl,
}: VillageXRStudioProps) {
  const { camera, gl } = useThree();
  const tour = usePanoramaTour(tourMode);
  const { locale } = useAppLocale();
  const t = useTranslations('features.visionInsert');
  const { list: simulationAppliances, upsert, remove } = useSimulationAppliances();
  /** Shot objects, in the order they became 3D miniatures (= their pedestal slot). */
  const [materialized, setMaterialized] = useState<string[]>([]);
  const materializedIds = useMemo(() => new Set(materialized), [materialized]);
  /** Target of each shot object when it was shot: its miniature stays after leaving the room. */
  const shotTargetsRef = useRef(new Map<string, SpatialTarget>());
  /** Rotation of each miniature, mutated by the input controller in the frame loop. */
  const turntablesRef = useRef(new Map<string, Turntable>());
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  /** Holographic panels (dialog, carousel, lab) the input controller hits first. */
  const panels = useMemo(() => createPanelRegistry(), []);
  const stage = extract?.stage ?? 'idle';
  const modal = stage !== 'idle';
  /** Wrist menu: closed on entry; the wrist button toggles it (read by the input controller). */
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useMemo(() => {
    const m = createWristMenu(() => {
      m.open = !m.open;
      setMenuOpen(m.open);
    });
    return m;
  }, []);
  // Dev only: lets `make vr-probe` aim at the wrist button (same pattern as __IWER_DEVICE__).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_WRIST_MENU__?: unknown };
    w.__VR_WRIST_MENU__ = menu;
    return () => {
      delete w.__VR_WRIST_MENU__;
    };
  }, [menu]);
  const [recentEvent, setRecentEvent] = useState<string | null>(null);
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureFnRef = useRef<(() => string | null) | null>(null);
  /** A shot at the video before any detection: resolved once the scan it started ends. */
  const pendingShotRef = useRef<{ u: number; v: number; sawScan: boolean } | null>(null);

  const notifyEvent = useCallback((msg: string) => {
    if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
    setRecentEvent(msg);
    eventTimerRef.current = setTimeout(() => {
      setRecentEvent(null);
    }, 4500);
  }, []);

  /** Scan: the webcam frame, or in the 360° tour the view centred on the gaze (or `heading`). */
  const scanTour = useCallback(
    (heading?: { yaw: number; pitch: number }) => {
      let h = heading;
      if (!h) {
        camera.getWorldDirection(_gaze);
        h = yawPitchOf([_gaze.x, _gaze.y, _gaze.z]);
      }
      const shot = tour.scan(h.yaw, h.pitch);
      if (shot) onTriggerScan(shot.url);
      return shot;
    },
    [camera, tour, onTriggerScan]
  );

  const handleTriggerScan = useCallback(() => {
    // The menu closes so the outlines on the view stay clear (VS-T18).
    if (menu.open) menu.toggle();
    if (tourMode) {
      scanTour();
      return;
    }
    const frame = captureFnRef.current ? captureFnRef.current() : null;
    onTriggerScan(frame || undefined);
  }, [tourMode, scanTour, onTriggerScan, menu]);

  const photo = photoKey ?? 'vr-studio';

  // Identify which detected targets are currently connected to the simulation
  const connectedIds = useMemo(() => {
    const activeApplianceIds = new Set((simulationAppliances ?? []).map((a) => a.id));
    const set = new Set<string>();
    for (const d of detections) {
      const appId = applianceIdFor(photo, d.id);
      if (activeApplianceIds.has(appId) || activeApplianceIds.has(d.id)) {
        set.add(d.id);
      }
    }
    return set;
  }, [simulationAppliances, detections, photo]);

  // Convert 2D detections to 3D targets on the scanned image (webcam wall or tour scan photo).
  const surface = tourMode ? tour.surface : WEBCAM_SCREEN;
  const targets = useMemo<SpatialTarget[]>(() => {
    if (!surface) return [];
    // Tour: laid on the grounded photo itself, so outlines stay on the objects while walking.
    return projectDetectionsTo3D(
      detections,
      tourMode
        ? { screen: surface, eye: TOUR_EYE, ground: { wall: tour.wall, floor: TOUR_EYE[1] } }
        : {}
    );
  }, [detections, surface, tourMode, tour.wall]);
  const photoGround = tourMode ? tour.ground : undefined;

  const findTarget = useCallback(
    (id: string) => targets.find((tg) => tg.id === id) ?? shotTargetsRef.current.get(id),
    [targets]
  );

  const handleShootTarget = useCallback(
    (id: string) => {
      // 1. If not yet materialized, first laser shot materializes procedural 3D model
      const target = findTarget(id);
      if (!target) return;
      const title = localLabel(target.detection, locale) || target.detection.label;

      if (!materializedIds.has(id) && extract) {
        shotTargetsRef.current.set(id, target);
        extract.ask(id);
        return;
      }
      if (!materializedIds.has(id)) {
        shotTargetsRef.current.set(id, target);
        setMaterialized((prev) => (prev.includes(id) ? prev : [...prev, id]));
        notifyEvent(t('vrHudEventMaterialized', { name: title }));
        onSelectAppliance?.(id);
        return;
      }

      // 2. If already materialized, subsequent shot toggles microgrid connection

      const applianceId = applianceIdFor(photo, id);
      const isConnected = connectedIds.has(id);
      const draft = aiDraft(target.detection, title);
      const watts = draft.watts ?? 150;

      if (isConnected) {
        // Disconnect from microgrid
        playGridDisconnectSound();
        remove(applianceId);
        notifyEvent(t('vrHudEventDisconnected', { watts, name: title }));
      } else {
        // Connect to microgrid with catalog defaults
        playGridConnectSound();
        const appliance = toAppliance(applianceId, draft);
        if (appliance) {
          upsert(appliance);
          const archetype = defaultArchetype(
            target.detection.category,
            target.detection.scenery,
            target.detection.label
          );
          const fallbackKit: ObjectKit = {
            archetype,
            proportions: {
              w: target.spawnDimensions[0],
              h: target.spawnDimensions[1],
              d: target.spawnDimensions[2],
            },
            colors: { main: '#78909c', secondary: '#37474f', accent: '#00bcd4' },
            materials: { main: 'metal', secondary: 'glass', accent: 'plastic' },
          };
          const recipe = fitRecipe(kitToRecipe(fallbackKit), 1.0);
          usePlacedModelsStore.getState().upsert({
            applianceId,
            recipe,
            scale: sceneScale(archetype, recipe.proportions),
            archetype,
            connectionMode: 'branch',
          });
          notifyEvent(t('vrHudEventConnected', { watts, name: title }));
        }
      }

      onSelectAppliance?.(id);
    },
    [
      extract,
      materializedIds,
      findTarget,
      connectedIds,
      photo,
      locale,
      t,
      remove,
      upsert,
      notifyEvent,
      onSelectAppliance,
    ]
  );

  /** Shot at the webcam video outside every detection box. */
  const handleShootScreen = useCallback(
    (u: number, v: number) => {
      if (targets.length > 0 && !isScanning) {
        notifyEvent(t('vrHudEventNoObject'));
        return;
      }
      // Nothing detected yet: scan this frame, then turn the object under the shot into 3D.
      pendingShotRef.current = { u, v, sawScan: isScanning };
      if (!isScanning) handleTriggerScan();
    },
    [targets.length, isScanning, notifyEvent, t, handleTriggerScan]
  );

  /** 360° tour: a shot that hit no scanned photo scans the view centred on it. */
  const handleShootOutside = useCallback(
    (origin: THREE.Vector3, direction: THREE.Vector3) => {
      if (isScanning) return;
      // The photo point under the laser, seen from the photo spot (the viewer may have walked).
      const seen = photoRay(
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        tour.ground
      );
      const shot = scanTour(yawPitchOf(seen.dir));
      if (!shot) return;
      const hit = screenHitFromRay(
        new THREE.Vector3(...TOUR_EYE),
        new THREE.Vector3(...seen.dir),
        shot.surface
      );
      pendingShotRef.current = { u: hit?.u ?? 0.5, v: hit?.v ?? 0.5, sawScan: false };
    },
    [isScanning, scanTour, tour.ground]
  );

  // Walking to another room drops a shot waiting for its scan.
  useEffect(() => {
    pendingShotRef.current = null;
  }, [tour.room]);

  useEffect(() => {
    const pending = pendingShotRef.current;
    if (!pending) return;
    if (isScanning) {
      pending.sawScan = true;
      return;
    }
    if (!pending.sawScan) return;
    pendingShotRef.current = null;
    const hit = pickTargetAtUv(targets, pending.u, pending.v);
    if (hit) handleShootTarget(hit.id);
    else notifyEvent(t('vrHudEventNoObject'));
  }, [isScanning, targets, handleShootTarget, notifyEvent, t]);

  const miniatures = useMemo<Array<MiniatureHandle & { target: SpatialTarget }>>(() => {
    const byId = new Map(targets.map((tg) => [tg.id, tg]));
    const out: Array<MiniatureHandle & { target: SpatialTarget }> = [];
    materialized.forEach((id, index) => {
      const target = byId.get(id) ?? shotTargetsRef.current.get(id);
      if (!target) return;
      let turntable = turntablesRef.current.get(id);
      if (!turntable) {
        turntable = createTurntable();
        turntablesRef.current.set(id, turntable);
      }
      out.push({ id, position: miniatureSlot(index), turntable, target });
    });
    return out;
  }, [materialized, targets]);

  const status = isScanning ? 'scanning' : targets.length > 0 ? 'detected' : 'idle';

  // 3D extraction (VS-T19–T22): the object being extracted and where its panels open.
  const extractTarget = extract?.id ? findTarget(extract.id) : undefined;
  const extractName = extractTarget
    ? localLabel(extractTarget.detection, locale) || extractTarget.detection.label
    : '';
  const anchor = usePanelAnchor(
    stage === 'confirm' || stage === 'views' || stage === 'build' ? (extract?.id ?? null) : null
  );
  const building = extract?.shape.status === 'loading';
  const buildSeconds = useElapsedSeconds(extract?.shape.startedAt, building);
  const leaveLab = useCallback(() => {
    if (!extract?.id) return;
    const id = extract.id;
    const target = findTarget(id);
    if (target) shotTargetsRef.current.set(id, target);
    setMaterialized((prev) => (prev.includes(id) ? prev : [...prev, id]));
    notifyEvent(t('vrHudEventMaterialized', { name: extractName }));
    extract.exitLab();
  }, [extract, findTarget, notifyEvent, t, extractName]);

  // Controls (VS-T23): buttons, sticks and thumb gestures → turn, step, analyse, back, help.
  const tc = useTranslations('features.visionInsert.vrControls');
  /** Button legends on the controllers / hands: shown on entry, a stick click toggles them. */
  const [help, setHelp] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHelp(false), HELP_ON_ENTRY_MS);
    return () => clearTimeout(timer);
  }, []);
  const headRef = useRef(new THREE.Vector3());
  const handleControl = useCallback(
    (action: XrControlAction) => {
      switch (action.type) {
        case 'turn':
          camera.getWorldPosition(headRef.current);
          if (snapTurn(gl.xr, headRef.current, action.direction * SNAP_TURN)) playSnapSound();
          return;
        case 'step':
          if (!tourMode) return;
          tour.ground.step += action.direction * STEP_DISTANCE;
          playSnapSound();
          return;
        case 'analyse':
          if (!modal && !isScanning) handleTriggerScan();
          return;
        case 'back':
          // Back closes what is open, innermost first; with nothing open it toggles the menu.
          if (stage === 'lab') leaveLab();
          else if (modal) extract?.cancel();
          else menu.toggle();
          return;
        case 'help':
          setHelp((h) => {
            notifyEvent(tc(h ? 'helpHidden' : 'helpShown'));
            return !h;
          });
          return;
      }
    },
    [
      camera,
      gl,
      tourMode,
      tour.ground,
      modal,
      isScanning,
      handleTriggerScan,
      stage,
      leaveLab,
      extract,
      menu,
      notifyEvent,
      tc,
    ]
  );
  // Dev only: lets `make vr-probe` read the controls (help, live gamepads, view heading, hints).
  const { scene } = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_CONTROLS__?: unknown };
    w.__VR_CONTROLS__ = {
      help,
      sources: () => snapshotSources(gl.xr.getSession?.()?.inputSources ?? []),
      yaw: () => {
        const d = camera.getWorldDirection(new THREE.Vector3());
        return Math.atan2(d.x, -d.z);
      },
      shown: (name: string) => {
        let n = 0;
        scene.traverseVisible((o) => {
          if (o.name === name) n++;
        });
        return n;
      },
    };
    return () => {
      delete w.__VR_CONTROLS__;
    };
  }, [help, gl, camera, scene]);
  const aimOut = useMemo(() => createAimReadout(), []);
  const hintContext = useMemo<AimHintContext>(
    () => ({
      targetName: (id) => {
        const target = findTarget(id);
        return target ? localLabel(target.detection, locale) || target.detection.label : null;
      },
      isMaterialized: (id) => materializedIds.has(id),
      isConnected: (id) => connectedIds.has(id),
      placeOf: (id) =>
        id.startsWith('tour-link:') ? t(`tourRoom_${id.slice('tour-link:'.length)}`) : null,
      menuOpen,
      outsideAnalyses: tourMode && !modal && !isScanning,
      screenAnalyses: !modal && !isScanning && targets.length === 0,
    }),
    [
      findTarget,
      locale,
      materializedIds,
      connectedIds,
      t,
      menuOpen,
      tourMode,
      modal,
      isScanning,
      targets.length,
    ]
  );
  // Dev only: lets `make vr-probe` read the tour room, heading, floor arrows, the live walk
  // offset of the photo, the targets laid on it and the hovered one.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !tourMode) return;
    const w = window as Window & { __VR_TOUR__?: unknown };
    w.__VR_TOUR__ = {
      room: tour.room,
      uFront: tour.uFront,
      arrows: tour.arrows,
      ground: tour.ground,
      targets: targets.map((tg) => ({ id: tg.id, label: tg.detection.label, at: tg.position })),
      hovered: hoveredTargetId,
    };
    return () => {
      delete w.__VR_TOUR__;
    };
  }, [tourMode, tour.room, tour.uFront, tour.arrows, tour.ground, targets, hoveredTargetId]);

  // Dev only: lets `make vr-probe` follow the extraction.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_EXTRACT__?: unknown };
    w.__VR_EXTRACT__ = extract
      ? {
          stage: extract.stage,
          id: extract.id,
          slides: extract.slides.map((s) => `${s.id}:${s.status}${s.validated ? ':ok' : ''}`),
          canBuild: extract.canBuild,
          ready: extract.ready,
          anchor,
        }
      : null;
  }, [extract, anchor]);
  // Dev only: lets `make vr-probe` press a holographic button by id (same handler as a tap).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_PANELS__?: unknown };
    w.__VR_PANELS__ = panels;
    return () => {
      delete w.__VR_PANELS__;
    };
  }, [panels]);

  return (
    <group name="village-xr-studio-root">
      {/* 1. Studio Lighting */}
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#7dd3fc', '#0f172a', 0.6]} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[-3, 4, -2]} intensity={0.4} color="#7dd3fc" />

      {/* 2–3. Surroundings: walkable 360° real photos (VS-T14), or the live webcam wall + floor */}
      <group visible={stage !== 'lab'}>
        {tourMode ? (
          <PanoramaTour
            room={tour.room}
            uFront={tour.uFront}
            arrows={tour.arrows}
            pending={tour.pending}
            onArrive={tour.arrive}
            onWalk={tour.walk}
            hoveredId={hoveredTargetId}
            onRegisterCapture={tour.registerCapture}
            photo={tour.ground}
          />
        ) : (
          <>
            <LiveWebcamBackdrop
              onRegisterCapture={(fn) => {
                captureFnRef.current = fn;
              }}
            />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -1.5]} receiveShadow>
              <circleGeometry args={[5, 48]} />
              <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.15} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1.5]}>
              <ringGeometry args={[2.1, 2.15, 64]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.25} />
            </mesh>
          </>
        )}
      </group>

      {/* 4. Wrist button → menu (scan button, guide, HUD VS-T8), following the viewer */}
      <WristMenuButton
        menu={menu}
        open={menuOpen}
        hovered={hoveredTargetId === WRIST_BUTTON_ID}
        alert={!menuOpen && recentEvent !== null}
      />
      {menuOpen && (
        <WristMenuPanel menu={menu} scanOffset={MENU_SCAN_OFFSET}>
          <SpatialAirButton
            status={status}
            detectedCount={targets.length}
            position={MENU_SCAN_OFFSET}
            isHovered={hoveredTargetId === AIR_BUTTON_ID}
          />
          <SpatialInteractionGuide position={MENU_GUIDE_OFFSET} />
          <VillageSpatialHUD recentEvent={recentEvent} />
        </WristMenuPanel>
      )}

      {/* 6. Holographic Detection Targets, on the photo (they follow it while walking) */}
      <PhotoAnchored photo={photoGround}>
        {stage !== 'lab' &&
          targets.map((target) => (
            <HoloDetectionTarget
              key={target.id}
              target={target}
              hovered={!modal && hoveredTargetId === target.id}
              isMaterialized={materializedIds.has(target.id)}
              isConnected={connectedIds.has(target.id)}
              dimmed={modal && target.id !== extract?.id}
              hideLabel={modal}
            />
          ))}

        {/* 6b. « Analysing the view… » over the analysed area (VS-T18) */}
        {isScanning && surface && stage === 'idle' && <HoloScanProgress surface={surface} />}
      </PhotoAnchored>

      {/* 6c. 3D extraction: question, 2D views carousel, build, lab (VS-T19–T22) */}
      {extract && anchor && stage === 'confirm' && (
        <HoloExtractDialog
          anchor={anchor}
          registry={panels}
          hoveredId={hoveredTargetId}
          name={extractName}
          {...(extractTarget
            ? { description: localDescription(extractTarget.detection, locale) }
            : {})}
          onConfirm={extract.confirm}
          onCancel={extract.cancel}
        />
      )}
      {extract && anchor && stage === 'views' && (
        <HoloViewsCarousel
          anchor={anchor}
          registry={panels}
          hoveredId={hoveredTargetId}
          slides={extract.slides}
          vehicle={extract.slides.some((s) => s.id === 'bottom')}
          canBuild={extract.canBuild}
          onRedraw={extract.redraw}
          onToggleValidated={extract.toggleValidated}
          onBuild={extract.build}
          onCancel={extract.cancel}
        />
      )}
      {extract && anchor && stage === 'build' && (
        <HoloBuildPanel
          anchor={anchor}
          registry={panels}
          hoveredId={hoveredTargetId}
          name={extractName}
          {...(extract.shape.step ? { step: extract.shape.step } : {})}
          seconds={buildSeconds}
          ready={extract.ready}
          outlineOnly={extract.shape.shape?.mode !== 'recipe'}
          onEnterLab={extract.enterLab}
          onLater={extract.cancel}
        />
      )}
      {extract && stage === 'lab' && extract.shape.shape && extractTarget && imageUrl && (
        <XrObjectLab
          shape={extract.shape.shape}
          detection={extractTarget.detection}
          imageUrl={imageUrl}
          label={extractName}
          registry={panels}
          hoveredId={hoveredTargetId}
          onEditPieces={extract.editPieces}
          onExit={leaveLab}
        />
      )}

      {/* 7. 3D miniatures in reach: spin, hold to rotate, tap to connect */}
      {stage !== 'lab' &&
        miniatures.map((m) => (
          <SpawnedObject3D
            key={`spawned-${m.id}`}
            target={m.target}
            slot={m.position}
            turntable={m.turntable}
            hovered={hoveredTargetId === m.id}
            isConnected={connectedIds.has(m.id)}
          />
        ))}

      {/* Controls (VS-T23): what each select will do, button legends, buttons / sticks / thumbs */}
      <XrAimHint aim={aimOut} context={hintContext} />
      <XrControlLegend visible={help} />
      <XrControlsDriver onAction={handleControl} />

      {/* 6. XR Blaster Controller Raycasting & Particle Effects */}
      <XRBlasterController
        targets={modal ? NO_TARGETS : targets}
        menu={menu}
        miniatures={modal ? NO_MINIATURES : miniatures}
        panels={panels}
        onTapMiniature={handleShootTarget}
        onHoverTarget={setHoveredTargetId}
        onShootTarget={handleShootTarget}
        onTriggerScan={handleTriggerScan}
        onShootScreen={modal ? undefined : handleShootScreen}
        surface={modal ? null : surface}
        hotspots={modal ? NO_HOTSPOTS : tour.arrows}
        onHotspot={tour.walkThrough}
        onShootOutside={tourMode && !modal ? handleShootOutside : undefined}
        aimOut={aimOut}
        {...(photoGround ? { photo: photoGround } : {})}
      />
    </group>
  );
});
