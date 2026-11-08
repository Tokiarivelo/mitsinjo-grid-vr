'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import type { ApplianceDetection } from '@/lib/vision';
import { projectDetectionsTo3D, type SpatialTarget } from './spatial-projection';
import { SpatialAirButton } from './spatial-air-button';
import { HoloDetectionTarget } from './holo-detection-target';
import { SpawnedObject3D } from './spawned-object-3d';
import { XRBlasterController } from './xr-blaster-controller';

export interface VillageXRStudioProps {
  detections: ApplianceDetection[];
  isScanning: boolean;
  onTriggerScan: () => void;
  onSelectAppliance?: (id: string) => void;
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
}: VillageXRStudioProps) {
  const [materializedIds, setMaterializedIds] = useState<Set<string>>(() => new Set());
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);

  // Convert 2D detections to 3D spatial target slots
  const targets = useMemo<SpatialTarget[]>(() => {
    return projectDetectionsTo3D(detections);
  }, [detections]);

  const handleShootTarget = useCallback(
    (id: string) => {
      setMaterializedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      onSelectAppliance?.(id);
    },
    [onSelectAppliance]
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

      {/* 4. Holographic Detection Targets */}
      {targets.map((target) => (
        <HoloDetectionTarget
          key={target.id}
          target={target}
          hovered={hoveredTargetId === target.id}
          isMaterialized={materializedIds.has(target.id)}
          onHoverChange={(id, hovered) => setHoveredTargetId(hovered ? id : null)}
          onShootTarget={handleShootTarget}
        />
      ))}

      {/* 5. Materialized 3D Models */}
      {targets
        .filter((t) => materializedIds.has(t.id))
        .map((target) => (
          <SpawnedObject3D key={`spawned-${target.id}`} target={target} />
        ))}

      {/* 6. XR Blaster Controller Raycasting & Particle Effects */}
      <XRBlasterController
        targets={targets}
        materializedIds={materializedIds}
        onHoverTarget={setHoveredTargetId}
        onShootTarget={handleShootTarget}
      />
    </group>
  );
});
