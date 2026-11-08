'use client';

import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useTranslations } from '@/lib/i18n';
import { getSpatialAirButtonTexture } from './spatial-air-button-texture';
import { playScanRadarSound } from './xr-audio-fx';

export interface SpatialAirButtonProps {
  status: 'idle' | 'scanning' | 'detected';
  detectedCount: number;
  onTriggerScan: () => void;
  /** In-air 3D coordinates. Default: [0, 1.45, -1.2] */
  position?: [number, number, number];
}

/**
 * 3D Floating Interactive Option in the air (Spatial Air Beacon & Action Button).
 * Placed in front of the user at eye level in the virtual room.
 * Responds to WebXR controller laser raycast and mouse clicks in desktop emulator.
 */
export const SpatialAirButton = memo(function SpatialAirButton({
  status,
  detectedCount,
  onTriggerScan,
  position = [0, 1.45, -1.2],
}: SpatialAirButtonProps) {
  const t = useTranslations('features.visionInsert');
  const [hovered, setHovered] = useState(false);

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
      {/* Interactive Raycast Hitbox Capsule */}
      <mesh
        visible={false}
        position={[0, 0, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          playScanRadarSound();
          onTriggerScan();
        }}
      >
        <boxGeometry args={[0.7, 0.45, 0.3]} />
        <meshBasicMaterial />
      </mesh>

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
            wireframe={status === 'scanning'}
          />
        </mesh>

        <mesh ref={ring1Ref}>
          <torusGeometry args={[0.07, 0.003, 8, 28]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.7} />
        </mesh>

        <mesh ref={ring2Ref}>
          <torusGeometry args={[0.095, 0.003, 8, 28]} />
          <meshBasicMaterial color={hovered ? '#ffffff' : accentColor} transparent opacity={0.5} />
        </mesh>
      </group>

      {/* Facing 2D/3D Billboard Info Card */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh position={[0, -0.06, 0]}>
          <planeGeometry args={[0.56, 0.24]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
});
