'use client';

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useTranslations } from '@/lib/i18n';
import { getSpatialAirButtonTexture } from './spatial-air-button-texture';
import { MENU_SCAN_OFFSET } from './xr-layout';

export interface SpatialAirButtonProps {
  status: 'idle' | 'scanning' | 'detected';
  detectedCount: number;
  /** Position inside the wrist menu. Default: MENU_SCAN_OFFSET. */
  position?: [number, number, number];
  /** External hover state driven by WebXR laser pointer raycast */
  isHovered?: boolean;
}

/**
 * Scan button (Spatial Air Beacon & Action Button), shown inside the wrist menu once the
 * viewer opens it from the wrist button.
 * Pressed through XRBlasterController (laser, pinch, fingertip or mouse), the single input source.
 */
export const SpatialAirButton = memo(function SpatialAirButton({
  status,
  detectedCount,
  position = MENU_SCAN_OFFSET,
  isHovered = false,
}: SpatialAirButtonProps) {
  const t = useTranslations('features.visionInsert');
  const hovered = isHovered;

  const groupRef = useRef<THREE.Group>(null);
  const crystalRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);

  const texts = useMemo(() => {
    let subtitle = t('vrAirButtonSubtitle');
    if (status === 'scanning') {
      subtitle = t('vrAirButtonScanning');
    } else if (status === 'detected') {
      subtitle = t('vrAirButtonDetected', { count: detectedCount });
    }

    return {
      title: t('vrAirButtonTitle'),
      subtitle,
      badge:
        status === 'scanning'
          ? '⚡ AI SCANNING'
          : status === 'detected'
            ? '🎯 TARGETS ACQUIRED'
            : '✨ VR VISION',
    };
  }, [t, status, detectedCount]);

  const texture = useMemo(
    () => getSpatialAirButtonTexture(status, hovered, texts),
    [status, hovered, texts]
  );

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;

    // 1. Gentle floating bob in the air
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(time * 2.0) * 0.04;
    }

    // 2. Spinning central holographic crystal
    if (crystalRef.current) {
      const speed = status === 'scanning' ? 5.0 : hovered ? 3.5 : 1.6;
      crystalRef.current.rotation.y += delta * speed;
      crystalRef.current.rotation.x = Math.sin(time * 1.8) * 0.2;
    }

    // 3. Counter-rotating concentric rings
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * 1.4;
      ring1Ref.current.rotation.x = Math.sin(time) * 0.3;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z -= delta * 1.1;
      ring2Ref.current.rotation.y = Math.cos(time * 1.2) * 0.3;
    }
  });

  const accentColor =
    status === 'scanning'
      ? '#c084fc'
      : status === 'detected'
        ? '#4ade80'
        : hovered
          ? '#7dd3fc'
          : '#38bdf8';

  return (
    <group ref={groupRef} position={position} name="spatial-air-button-group">
      {/* Floating Holographic Crystal Header */}
      <group position={[0, 0.16, 0]}>
        <mesh ref={crystalRef}>
          <octahedronGeometry args={[0.045, 0]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={hovered || status === 'scanning' ? 1.4 : 0.7}
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>

        {/* Concentric orbital rings */}
        <mesh ref={ring1Ref}>
          <ringGeometry args={[0.065, 0.072, 32]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={ring2Ref}>
          <ringGeometry args={[0.088, 0.094, 32]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Diegetic Billboard Holo Card */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[0.62, 0.38]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={0.96}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Outer glowing halo border */}
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[0.64, 0.4]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={hovered ? 0.35 : 0.12}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </Billboard>
    </group>
  );
});
