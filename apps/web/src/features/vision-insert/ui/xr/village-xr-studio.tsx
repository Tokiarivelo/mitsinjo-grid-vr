'use client';

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { localLabel, type ApplianceDetection } from '@/lib/vision';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { fitRecipe } from '@/lib/object-shape';
import { sceneScale, usePlacedModelsStore } from '@/stores';
import { useSimulationAppliances } from '../../hooks/use-simulation-appliances';
import { aiDraft, applianceIdFor, toAppliance } from '../../utils/appliance-draft';
import { projectDetectionsTo3D, type SpatialTarget } from './spatial-projection';
import { SpatialAirButton } from './spatial-air-button';
import { HoloDetectionTarget } from './holo-detection-target';
import { SpawnedObject3D } from './spawned-object-3d';
import { XRBlasterController } from './xr-blaster-controller';
import { playGridConnectSound, playGridDisconnectSound } from './xr-audio-fx';
import { VillageSpatialHUD } from './village-spatial-hud';

export interface VillageXRStudioProps {
  detections: ApplianceDetection[];
  isScanning: boolean;
  onTriggerScan: () => void;
  onSelectAppliance?: (id: string) => void;
  photoKey?: string;
}

/**
 * Village XR Studio Scene.
 * Immersive 3D room with lighting, in-air spatial scan button, holographic target boxes,
 * laser blaster interaction, and procedural 3D model materialization in-situ.
 */
export const VillageXRStudio = memo(function VillageXRStudio({
  detections,
  isScanning,
  onTriggerScan,
  onSelectAppliance,
  photoKey,
}: VillageXRStudioProps) {
  const { locale } = useAppLocale();
  const t = useTranslations('features.visionInsert');
  const { list: simulationAppliances, upsert, remove } = useSimulationAppliances();
  const [materializedIds, setMaterializedIds] = useState<Set<string>>(() => new Set());
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [recentEvent, setRecentEvent] = useState<string | null>(null);
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyEvent = useCallback((msg: string) => {
    if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
    setRecentEvent(msg);
    eventTimerRef.current = setTimeout(() => {
      setRecentEvent(null);
    }, 4500);
  }, []);

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

  // Convert 2D detections to 3D spatial target slots
  const targets = useMemo<SpatialTarget[]>(() => {
    return projectDetectionsTo3D(detections);
  }, [detections]);

  const handleShootTarget = useCallback(
    (id: string) => {
      // 1. If not yet materialized, first laser shot materializes procedural 3D model
      if (!materializedIds.has(id)) {
        setMaterializedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        onSelectAppliance?.(id);
        return;
      }

      // 2. If already materialized, subsequent shot toggles microgrid connection
      const target = targets.find((t) => t.id === id);
      if (!target) return;

      const applianceId = applianceIdFor(photo, id);
      const isConnected = connectedIds.has(id);
      const title = localLabel(target.detection, locale) || target.detection.label;
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
              w: target.dimensions[0],
              h: target.dimensions[1],
              d: target.dimensions[2],
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
      materializedIds,
      targets,
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

  const status = isScanning ? 'scanning' : targets.length > 0 ? 'detected' : 'idle';

  return (
    <group name="village-xr-studio-root">
      {/* 1. Studio Lighting */}
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[-3, 4, -2]} intensity={0.4} color="#7dd3fc" />

      {/* 2. Studio Floor Platform & Grid Markings */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -1.5]} receiveShadow>
        <circleGeometry args={[5, 48]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} metalness={0.15} />
      </mesh>

      {/* Subtle floor grid ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1.5]}>
        <ringGeometry args={[2.1, 2.15, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.25} />
      </mesh>

      {/* 3. In-Air Interactive Spatial Button */}
      <SpatialAirButton
        status={status}
        detectedCount={targets.length}
        onTriggerScan={onTriggerScan}
        position={[0, 1.45, -1.2]}
      />

      {/* 4. Diegetic Holographic Telemetry HUD (VS-T8) */}
      <VillageSpatialHUD
        position={[-0.95, 1.55, -1.2]}
        rotation={[0.05, 0.45, 0]}
        recentEvent={recentEvent}
      />

      {/* 5. Holographic Detection Targets */}
      {targets.map((target) => (
        <HoloDetectionTarget
          key={target.id}
          target={target}
          hovered={hoveredTargetId === target.id}
          isMaterialized={materializedIds.has(target.id)}
          isConnected={connectedIds.has(target.id)}
          onHoverChange={(id, hovered) => setHoveredTargetId(hovered ? id : null)}
          onShootTarget={handleShootTarget}
        />
      ))}

      {/* 5. Materialized 3D Models */}
      {targets
        .filter((t) => materializedIds.has(t.id))
        .map((target) => (
          <SpawnedObject3D
            key={`spawned-${target.id}`}
            target={target}
            isConnected={connectedIds.has(target.id)}
          />
        ))}

      {/* 6. XR Blaster Controller Raycasting & Particle Effects */}
      <XRBlasterController
        targets={targets}
        materializedIds={materializedIds}
        connectedIds={connectedIds}
        onHoverTarget={setHoveredTargetId}
        onShootTarget={handleShootTarget}
      />
    </group>
  );
});
