'use client';

import { memo, Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SHAPE_STEPS, type ShapeStep } from '@/lib/object-shape';
import { useTranslations } from '@/lib/i18n';
import type { ViewSlide, XrExtractStage } from '../../utils/xr-extract';
import { StudioEnvironment } from '../object-editor-3d';
import type { PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText, useHoloImage, useHoloImageMaterial } from './holo-ui';
import { HOLO } from './holo-style';
import { useSlideText } from './holo-views-carousel';
import { STUDIO_COLUMN_POSITION, STUDIO_COLUMN_YAW } from './xr-layout';

/** Pedestal top under the panel anchor (m), shared by the build stage and the lab. */
export const PEDESTAL_DROP = 0.25;
export const STUDIO_CANCEL_ID = 'holo:studio-cancel';

/**
 * The 3D studio room (VS-T24): dark dome, grid floor, studio lights. Shown as soon as the viewer
 * says « Extract in 3D » and kept through the views, the build and the lab, so the extraction
 * happens in one place. Static, one material each (cheap on Quest).
 */
export const StudioRoom = memo(function StudioRoom() {
  return (
    <group name="xr-studio-room">
      <mesh renderOrder={-1}>
        <sphereGeometry args={[7, 32, 16]} />
        <meshBasicMaterial color={HOLO.dome} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <gridHelper args={[14, 56, HOLO.cyan, HOLO.gridDim]} position={[0, 0.001, 0]} />
      <Suspense fallback={null}>
        <StudioEnvironment />
      </Suspense>
    </group>
  );
});

/** Glowing pedestal (top at the group origin). */
export function StudioPedestal({ radius = 0.3 }: { radius?: number }) {
  return (
    <group name="xr-studio-pedestal">
      <mesh position={[0, -0.04, 0]}>
        <cylinderGeometry args={[radius, radius * 1.13, 0.08, 48]} />
        <meshStandardMaterial color={HOLO.pedestal} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[radius * 1.03, radius * 1.1, 64]} />
        <meshBasicMaterial color={HOLO.cyan} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Hologram of the object being generated, standing on a pedestal and turning slowly: its drawn
 * main view once there, inside a wire cube while the 3D is being built (or nothing is drawn yet).
 */
export const HoloMiniature = memo(function HoloMiniature({
  imageUrl,
  size,
  building,
}: {
  imageUrl?: string;
  size: number;
  building: boolean;
}) {
  const { texture, state } = useHoloImage(imageUrl);
  const { material } = useHoloImageMaterial(texture, building ? HOLO.violet : HOLO.cyan);
  const spin = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * 0.6;
  });
  const image = state === 'ready' && texture;
  return (
    <group ref={spin} position={[0, size / 2 + 0.01, 0]} name="xr-studio-miniature">
      {image && (
        <mesh material={material} renderOrder={2}>
          <planeGeometry args={[size * 0.9, size * 0.9]} />
        </mesh>
      )}
      {(building || !image) && (
        <mesh>
          <boxGeometry args={[size * 0.8, size * 0.8, size * 0.8]} />
          <meshBasicMaterial
            color={building ? HOLO.violet : HOLO.cyan}
            wireframe
            transparent
            opacity={0.55}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});

const slideIcon = (s: ViewSlide) =>
  s.status === 'ready' ? '✓' : s.status === 'generating' ? '▸' : s.status === 'error' ? '!' : '·';

export interface HoloGenerationColumnProps {
  stage: XrExtractStage;
  name: string;
  slides: ViewSlide[];
  vehicle: boolean;
  step?: ShapeStep;
  seconds: number;
  registry: PanelRegistry;
  hoveredId: string | null;
  onCancel: () => void;
}

/**
 * Generation on the right of the studio (VS-T24): a hologram card listing the 2D views being
 * drawn, then the 3D build steps (crop → Spark → fit…, same steps as the 2D panel) with the
 * seconds of the current one, and under it the object as a turning miniature on a small pedestal.
 * Inside the studio's anchored group (viewer at +Z), turned toward the viewer.
 */
export const HoloGenerationColumn = memo(function HoloGenerationColumn({
  stage,
  name,
  slides,
  vehicle,
  step,
  seconds,
  registry,
  hoveredId,
  onCancel,
}: HoloGenerationColumnProps) {
  const t = useTranslations('features.visionInsert');
  const { nameOf, statusOf } = useSlideText(vehicle);
  const building = stage === 'build';
  const steps = SHAPE_STEPS.filter((s) => (s !== 'check' && s !== 'code') || step === s);
  const current = step ? steps.indexOf(step) : -1;
  const spec = useMemo(
    () => ({
      glass: false,
      accent: building ? HOLO.violet : HOLO.cyan,
      lines: [
        {
          text: building ? t('vrExtract.building', { name }) : t('vrStudio.viewsTitle', { name }),
          size: 52,
          weight: 700 as const,
        },
        ...(building
          ? steps.map((s, i) => ({
              text: `${i < current ? '✓' : i === current ? '▸' : '·'} ${t(`model3dStep.${s}`)}${
                i === current ? ` — ${t('model3dSeconds', { s: seconds })}` : ''
              }`,
              size: 36,
              weight: (i === current ? 700 : 400) as 400 | 700,
              color: i < current ? HOLO.green : i === current ? HOLO.cyan : HOLO.ink,
            }))
          : slides.map((s) => ({
              text: `${slideIcon(s)} ${nameOf(s)} — ${statusOf(s)}`,
              size: 34,
              weight: (s.status === 'generating' ? 700 : 400) as 400 | 700,
              color:
                s.status === 'ready'
                  ? HOLO.green
                  : s.status === 'generating'
                    ? HOLO.cyan
                    : s.status === 'error'
                      ? HOLO.amber
                      : HOLO.ink,
            }))),
      ],
    }),
    [t, name, building, steps, current, seconds, slides, nameOf, statusOf]
  );
  const main = slides[0]?.imageUrl;
  return (
    <group
      name="xr-studio-generation"
      position={STUDIO_COLUMN_POSITION}
      rotation={[0, -STUDIO_COLUMN_YAW, 0]}
    >
      <group position={[0, 0.17, 0]}>
        <HoloFrame width={0.46} height={0.44} color={building ? HOLO.violet : HOLO.cyan} active />
        <HoloText spec={spec} width={0.42} height={0.38} position={[0, 0, 0.003]} />
      </group>
      {building && (
        <HoloButton
          registry={registry}
          id={STUDIO_CANCEL_ID}
          label={t('vrExtract.no')}
          width={0.24}
          height={0.08}
          position={[0, -0.11, 0.006]}
          hovered={hoveredId === STUDIO_CANCEL_ID}
          onSelect={onCancel}
        />
      )}
      <group position={[0, -0.42, 0]}>
        <StudioPedestal radius={0.1} />
        <HoloMiniature {...(main ? { imageUrl: main } : {})} size={0.2} building={building} />
      </group>
    </group>
  );
});

/**
 * Centre of the studio while the 3D is built (VS-T24): the object's hologram on the lab pedestal,
 * where the model appears when the lab opens by itself.
 */
export const HoloBuildStage = memo(function HoloBuildStage({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string;
}) {
  const t = useTranslations('features.visionInsert');
  const header = useMemo(
    () => ({
      glass: false,
      lines: [
        { text: t('vrExtract.building', { name }), size: 60, weight: 700 as const },
        { text: t('vrStudio.buildSub'), size: 36, weight: 400 as const, color: HOLO.cyan },
      ],
    }),
    [t, name]
  );
  return (
    <group name="xr-studio-build">
      <HoloText spec={header} width={0.9} height={0.13} position={[0, 0.36, 0]} />
      <group position={[0, -PEDESTAL_DROP, 0]}>
        <StudioPedestal />
        <HoloMiniature {...(imageUrl ? { imageUrl } : {})} size={0.42} building />
      </group>
    </group>
  );
});
