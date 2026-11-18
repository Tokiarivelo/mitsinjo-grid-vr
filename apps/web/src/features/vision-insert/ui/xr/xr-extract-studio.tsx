'use client';

import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
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
import {
  buildLabRoom,
  drawContactShadow,
  drawPegboard,
  LAB_COLORS,
  LAB_ROOM,
  LAB_SIGN_SHADOW,
  type LabMaterialKey,
} from '../../utils/lab-room';

/** Pedestal top under the panel anchor (m), shared by the build stage and the lab. */
export const PEDESTAL_DROP = 0.25;
export const STUDIO_CANCEL_ID = 'holo:studio-cancel';
export const STUDIO_TO_LAB_ID = 'holo:studio-to-lab';

/**
 * The 3D studio room (VS-T24, VS-T50): a real maker lab around the viewer — white walls, a bench with
 * resin printers and machines, a fume-extraction arm, a pegboard with tools, shelves, a steel sink, and
 * the lab's name on the wall. Shown from « Extract in 3D » through the views, the build and the lab.
 * Static and merged per material (`buildLabRoom`): about ten draw calls; matte Lambert surfaces under one
 * hemisphere light, so only the built model uses PBR (Quest fill rate).
 */
/** Share of the studio environment light on the room (the model keeps the full light: it stays the hero). */
const LAB_ENV = 0.42;

export const StudioRoom = memo(function StudioRoom() {
  const t = useTranslations('features.visionInsert.vrLab');
  const room = useMemo(() => buildLabRoom(), []);
  const pegboard = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawPegboard(ctx, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1.4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  const shadowTex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawContactShadow(ctx, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const sign = t('sign');
  const signTex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 384;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.font = '300 300px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LAB_SIGN_SHADOW;
    ctx.fillText(sign, 26, 206);
    ctx.fillStyle = LAB_COLORS.pegboard;
    ctx.fillText(sign, 16, 192);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [sign]);
  useEffect(
    () => () => {
      Object.values(room).forEach((g) => g?.dispose());
      pegboard?.dispose();
      signTex?.dispose();
      shadowTex?.dispose();
    },
    [room, pegboard, signTex, shadowTex]
  );
  // Matte PBR lit by the studio environment map (no extra light): depth and soft reflections, ~10 draws.
  const mat = (key: LabMaterialKey) => {
    switch (key) {
      case 'orange':
        return (
          <meshStandardMaterial
            color={LAB_COLORS.orange}
            roughness={0.25}
            transparent
            opacity={0.85}
          />
        );
      case 'glass':
        return (
          <meshStandardMaterial
            color={LAB_COLORS.glass}
            roughness={0.05}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        );
      case 'lamp':
        return <meshBasicMaterial color={LAB_COLORS.lamp} toneMapped={false} />;
      case 'shadow':
        return (
          <meshBasicMaterial
            color={LAB_COLORS.shadow}
            alphaMap={shadowTex ?? undefined}
            transparent
            depthWrite={false}
          />
        );
      case 'pegboard':
        return (
          <meshStandardMaterial
            map={pegboard ?? undefined}
            roughness={0.85}
            envMapIntensity={LAB_ENV}
          />
        );
      case 'steel':
        return <meshStandardMaterial color={LAB_COLORS.steel} metalness={0.9} roughness={0.32} />;
      case 'dark':
        return (
          <meshStandardMaterial
            color={LAB_COLORS.dark}
            roughness={0.45}
            envMapIntensity={LAB_ENV}
          />
        );
      case 'floor':
        return (
          <meshStandardMaterial
            color={LAB_COLORS.floor}
            roughness={0.35}
            envMapIntensity={LAB_ENV}
          />
        );
      default:
        return (
          <meshStandardMaterial
            color={LAB_COLORS[key]}
            roughness={key === 'counter' ? 0.5 : 0.85}
            envMapIntensity={key === 'wall' ? LAB_ENV * 0.8 : LAB_ENV}
            side={key === 'wall' ? THREE.DoubleSide : THREE.FrontSide}
          />
        );
    }
  };
  return (
    <group name="xr-studio-room">
      {(Object.keys(room) as LabMaterialKey[]).map((key) => (
        <mesh
          key={key}
          geometry={room[key]}
          name={`xr-lab-${key}`}
          renderOrder={key === 'glass' ? 3 : key === 'shadow' ? 1 : 0}
        >
          {mat(key)}
        </mesh>
      ))}
      {signTex && (
        <mesh position={[-2.9, 2.0, -LAB_ROOM.halfDepth + 0.04]} name="xr-lab-sign">
          <planeGeometry args={[1.2, 0.45]} />
          <meshBasicMaterial map={signTex} transparent depthWrite={false} />
        </mesh>
      )}
      <Suspense fallback={null}>
        <StudioEnvironment />
      </Suspense>
    </group>
  );
});

/**
 * Photo-studio light on the model in the lab (VS-T50): a warm key from the front right and a cool rim
 * from behind, like the 2D editor's two lights, so a model reads as a solid object, not a flat drawing.
 * Point lights without shadows (two lights, no extra pass), placed around the pedestal.
 */
export function LabStageLights() {
  return (
    <group name="xr-lab-stage-lights">
      <pointLight
        position={[0.7, 0.9, 0.8]}
        intensity={2.2}
        distance={3}
        decay={1.4}
        color={LAB_COLORS.lamp}
      />
      <pointLight
        position={[-0.4, 0.8, -0.9]}
        intensity={1.6}
        distance={3}
        decay={1.4}
        color={LAB_COLORS.glass}
      />
    </group>
  );
}

/** Glowing pedestal (top at the group origin). */
export function StudioPedestal({ radius = 0.3 }: { radius?: number }) {
  // Soft contact shadow on the plate (same gradient as the room's): grounds the model.
  const shadowTex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawContactShadow(ctx, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => shadowTex?.dispose(), [shadowTex]);
  return (
    <group name="xr-studio-pedestal">
      {shadowTex && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} renderOrder={1}>
          <circleGeometry args={[radius * 0.85, 48]} />
          <meshBasicMaterial
            color={LAB_COLORS.shadow}
            alphaMap={shadowTex}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}
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
  /** Model already built: « 3D lab » turns the desks to it (VS-T31). */
  onToLab?: () => void;
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
  onToLab,
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
      {!building && onToLab && (
        <HoloButton
          registry={registry}
          id={STUDIO_TO_LAB_ID}
          label={t('vrStudio.toLab')}
          tip={t('vrStudio.toLabTip')}
          icon="go"
          width={0.3}
          height={0.08}
          position={[0, -0.11, 0.006]}
          color={HOLO.violet}
          distance={1.4}
          hovered={hoveredId === STUDIO_TO_LAB_ID}
          onSelect={onToLab}
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
