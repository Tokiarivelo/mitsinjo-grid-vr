'use client';

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { localLabel } from '@/lib/vision';
import type { SpatialTarget } from './spatial-projection';
import { getHoloTargetTexture } from './holo-target-texture';

export interface HoloDetectionTargetProps {
  target: SpatialTarget;
  hovered: boolean;
  isMaterialized: boolean;
  onHoverChange: (id: string, isHovered: boolean) => void;
  onShootTarget: (id: string) => void;
}

/**
 * 3D Holographic Detection Target Box with floating Billboard tag and hit cylinder.
 * Changes glow on hover / lock-on; triggers shooting impact on trigger pull or click.
 */
export const HoloDetectionTarget = memo(function HoloDetectionTarget({
  target,
  hovered,
  isMaterialized,
  onHoverChange,
  onShootTarget,
}: HoloDetectionTargetProps) {
  const { locale } = useAppLocale();
  const t = useTranslations('features.visionInsert');
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const { detection, position, dimensions, hitRadius, id } = target;

  const title = useMemo(() => {
    return localLabel(detection, locale) || detection.label;
  }, [detection, locale]);

  const category = useMemo(() => {
    return detection.category || 'other';
  }, [detection]);

  const texture = useMemo(() => {
    return getHoloTargetTexture(hovered, isMaterialized, {
      title,
      category,
      powerHint: '150 W',
      actionHint: t('vrShootHint'),
    });
  }, [hovered, isMaterialized, title, category, t]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    if (ringRef.current && !isMaterialized) {
      ringRef.current.rotation.z += delta * (hovered ? 3.0 : 1.0);
      const s = 1.0 + Math.sin(time * (hovered ? 5.0 : 2.0)) * 0.08;
      ringRef.current.scale.set(s, s, s);
    }
  });

  const accentColor = isMaterialized ? '#4ade80' : hovered ? '#f59e0b' : '#38bdf8';

  return (
    <group ref={groupRef} position={position} name={`holo-target-${id}`}>
      {/* Invisible Interactive Click & Raycast Collider */}
      {!isMaterialized && (
        <mesh
          visible={false}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHoverChange(id, true);
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            onHoverChange(id, false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onShootTarget(id);
          }}
        >
          <sphereGeometry args={[hitRadius * 1.3, 12, 12]} />
          <meshBasicMaterial />
        </mesh>
      )}

      {/* Hologram Box Wireframe (visible prior to materialization) */}
      {!isMaterialized && (
        <group>
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(...dimensions)]} />
            <lineBasicMaterial
              color={accentColor}
              transparent
              opacity={hovered ? 0.95 : 0.65}
              linewidth={hovered ? 2 : 1}
            />
          </lineSegments>

          {/* Pulsing Target Lock Ring in the center */}
          <mesh ref={ringRef} position={[0, 0, 0]}>
            <torusGeometry args={[hitRadius * 0.7, 0.005, 8, 24]} />
            <meshBasicMaterial color={accentColor} transparent opacity={hovered ? 0.9 : 0.5} />
          </mesh>

          {/* Vertical Anchor Stalk down to ground (y = 0) */}
          <mesh position={[0, -position[1] / 2, 0]}>
            <cylinderGeometry args={[0.002, 0.002, position[1], 6]} />
            <meshBasicMaterial color={accentColor} transparent opacity={0.35} />
          </mesh>

          {/* Ground Footprint Ring */}
          <mesh position={[0, -position[1] + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.08, 0.12, 20]} />
            <meshBasicMaterial color={accentColor} transparent opacity={0.4} />
          </mesh>
        </group>
      )}

      {/* 3D Facing Billboard Information Tag (Hovering above the target) */}
      <Billboard
        position={[0, dimensions[1] / 2 + 0.22, 0]}
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        <mesh>
          <planeGeometry args={[0.5, 0.22]} />
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
});
