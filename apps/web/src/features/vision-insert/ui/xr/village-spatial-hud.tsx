'use client';

import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { useSimulationStore, selectInput, selectStepAtTime } from '@/stores';
import { useSimulationAppliances } from '../../hooks/use-simulation-appliances';
import { getSpatialHUDTexture } from './spatial-hud-texture';
import { HUD_POSITION, HUD_ROTATION } from './xr-layout';

export interface VillageSpatialHUDProps {
  /** 3D position [x, y, z] in VR world coordinates. Default: HUD_POSITION. */
  position?: [number, number, number];
  /** 3D Euler rotation [x, y, z]. Default: HUD_ROTATION (angled toward the viewer). */
  rotation?: [number, number, number];
  /** Optional transient event notification message (e.g. "+180 W · Fridge connected"). */
  recentEvent?: string | null;
}

/**
 * Diegetic Holographic Microgrid HUD in WebXR (VS-T8).
 * Floats in the air on the operator's left side, showing real-time battery SoC,
 * solar production, demand, and in-situ appliance load updates.
 */
export const VillageSpatialHUD = memo(function VillageSpatialHUD({
  position = HUD_POSITION,
  rotation = HUD_ROTATION,
  recentEvent = null,
}: VillageSpatialHUDProps) {
  const t = useTranslations('features.visionInsert');

  const [isExpanded, setIsExpanded] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Telemetry from simulation store
  const step = useSimulationStore((s) => selectStepAtTime(s));
  const input = useSimulationStore((s) => selectInput(s));
  const { list: appliances } = useSimulationAppliances();

  // Connected appliances count & wattage
  const connectedCount = appliances.length;
  const connectedWatts = useMemo(
    () => appliances.reduce((sum, a) => sum + (a.watts ?? 0) * (a.quantity ?? 1), 0),
    [appliances]
  );

  // Derived telemetry metrics
  const batterySocPct = step?.socPct ?? (input.battery.capacityKwh > 0 ? 82 : 0);
  const solarKw = step?.solarKw ?? input.solar.peakKw * 0.75;
  const demandKw = step?.demandKw ?? 8.4;
  const netKw = solarKw - demandKw;
  const netIsSurplus = netKw >= 0;

  const batteryStateText =
    (step?.batteryKw ?? 0) < -0.05
      ? 'Charge'
      : (step?.batteryKw ?? 0) > 0.05
        ? 'Décharge'
        : 'Équilibré';

  const netLabel = netIsSurplus
    ? t('vrHudNetSurplus', { kw: Math.abs(netKw).toFixed(1) })
    : t('vrHudNetDeficit', { kw: Math.abs(netKw).toFixed(1) });

  const textureSpec = useMemo(
    () => ({
      title: t('vrHudTitle'),
      batteryLabel: t('vrHudBattery'),
      batterySocPct,
      batteryStateText,
      solarLabel: t('vrHudSolar'),
      solarKw,
      demandLabel: t('vrHudDemand'),
      demandKw,
      netLabel,
      netIsSurplus,
      appliancesLabel: t('vrHudAppliances'),
      connectedCountText: t('vrHudConnectedCount', {
        count: connectedCount,
        watts: connectedWatts,
      }),
      recentEvent,
      toggleLabel: isExpanded ? t('vrHudMinimize') : t('vrHudExpand'),
      isExpanded,
      isHovered,
    }),
    [
      t,
      batterySocPct,
      batteryStateText,
      solarKw,
      demandKw,
      netLabel,
      netIsSurplus,
      connectedCount,
      connectedWatts,
      recentEvent,
      isExpanded,
      isHovered,
    ]
  );

  const texture = useMemo(() => getSpatialHUDTexture(textureSpec), [textureSpec]);

  // Subtle breathing levitation
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = position[1] + Math.sin(t * 1.1) * 0.012;
  });

  const planeWidth = 0.58;
  const planeHeight = isExpanded ? 0.42 : 0.14;

  return (
    <group ref={groupRef} position={position} rotation={rotation} name="village-spatial-hud">
      {/* Interactive HUD Surface Plane */}
      <mesh
        ref={meshRef}
        // Toggled by XRBlasterController's scene raycast (laser, pinch or mouse), never by
        // an R3F onClick too: both would fire on one click and cancel each other.
        userData={{ onSelect: () => setIsExpanded((prev) => !prev) }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setIsHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setIsHovered(false);
        }}
      >
        <planeGeometry args={[planeWidth, planeHeight]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.97}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* Frame backplate border with cyan emissive glow */}
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[planeWidth + 0.012, planeHeight + 0.012]} />
        <meshBasicMaterial
          color={isHovered ? '#38bdf8' : '#0284c7'}
          transparent
          opacity={isHovered ? 0.65 : 0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
});
