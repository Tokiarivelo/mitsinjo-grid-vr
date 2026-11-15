'use client';

import { memo, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import type { PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText } from './holo-ui';
import { HOLO } from './holo-style';
import type { ImageSurface } from './webcam-screen';
import { anchorAhead, type PanelAnchor } from './xr-layout';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Where the viewer looks now, as a level panel anchor (`anchorAhead`). Recomputed only when `key`
 * changes (a panel opens): the panel then stays still in the world (Meta: static once shown).
 */
export function usePanelAnchor(key: string | null): PanelAnchor | null {
  const camera = useThree((s) => s.camera);
  return useMemo(() => {
    if (key === null) return null;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    return anchorAhead([_eye.x, _eye.y, _eye.z], [_dir.x, _dir.y, _dir.z]);
  }, [key, camera]);
}

/** Group placed on an anchor, facing the viewer, scaling in on open (fade-in, no pop). */
export function AnchoredPanel({
  anchor,
  children,
  name,
}: {
  anchor: PanelAnchor;
  children: ReactNode;
  name: string;
}) {
  const ref = useRef<THREE.Group>(null);
  const age = useRef(0);
  useFrame((_, delta) => {
    age.current = Math.min(1, age.current + delta / 0.25);
    const k = age.current;
    ref.current?.scale.setScalar(0.7 + 0.3 * k * (2 - k));
  });
  return (
    <group
      ref={ref}
      name={name}
      position={anchor.position}
      rotation={[0, -anchor.yaw, 0]}
      scale={0.7}
    >
      {children}
    </group>
  );
}

/** Basis rotation of an image surface (its right, up and normal), for planes laid on it. */
function surfaceQuaternion(s: ImageSurface): THREE.Quaternion {
  const r = new THREE.Vector3(...s.right);
  const u = new THREE.Vector3(...s.up);
  const n = new THREE.Vector3().crossVectors(r, u).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, n));
}

/**
 * « Analysing the view… » (VS-T18): a frame over the analysed area with a sweep band running down
 * it, corner brackets and the status text in its middle; gone once the outlines arrive.
 */
export const HoloScanProgress = memo(function HoloScanProgress({
  surface,
}: {
  surface: ImageSurface;
}) {
  const t = useTranslations('features.visionInsert');
  const quaternion = useMemo(() => surfaceQuaternion(surface), [surface]);
  const n = useMemo(() => new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion), [quaternion]);
  // A little in front of the photo, slightly smaller so it keeps the area's angular size.
  const k = 0.96;
  const position: [number, number, number] = [
    surface.center[0] + n.x * 0.05,
    surface.center[1] + n.y * 0.05,
    surface.center[2] + n.z * 0.05,
  ];
  const spec = useMemo(
    () => ({
      accent: HOLO.cyan,
      lines: [
        { text: t('vrScanAnalyzing'), size: 72, weight: 700 as const },
        { text: t('vrScanAnalyzingSub'), size: 44, weight: 400 as const },
      ],
    }),
    [t]
  );
  const w = surface.width * k * 0.72;
  const h = surface.height * k * 0.72;
  return (
    <group name="holo-scan-progress" position={position} quaternion={quaternion}>
      <HoloFrame width={w} height={h} active backplate={false} />
      <HoloText spec={spec} width={Math.min(1.4, w * 0.6)} height={Math.min(0.35, w * 0.15)} />
    </group>
  );
});

export interface ExtractDialogProps {
  anchor: PanelAnchor;
  registry: PanelRegistry;
  hoveredId: string | null;
  name: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const EXTRACT_YES_ID = 'holo:extract-yes';
export const EXTRACT_NO_ID = 'holo:extract-no';

/** « Extract « Fridge » to 3D? » with Extract / Cancel (VS-T19). */
export const HoloExtractDialog = memo(function HoloExtractDialog({
  anchor,
  registry,
  hoveredId,
  name,
  description,
  onConfirm,
  onCancel,
}: ExtractDialogProps) {
  const t = useTranslations('features.visionInsert.vrExtract');
  const spec = useMemo(
    () => ({
      glass: false,
      accent: HOLO.amber,
      lines: [
        { text: t('title', { name }), size: 60, weight: 700 as const },
        ...(description ? [{ text: description, size: 38, weight: 400 as const }] : []),
        { text: t('sub'), size: 34, weight: 400 as const, color: HOLO.cyan },
      ],
    }),
    [t, name, description]
  );
  return (
    <AnchoredPanel anchor={anchor} name="holo-extract-dialog">
      <HoloFrame width={0.7} height={0.4} color={HOLO.amber} />
      <HoloText spec={spec} width={0.64} height={0.22} position={[0, 0.07, 0.003]} />
      <HoloButton
        registry={registry}
        id={EXTRACT_YES_ID}
        label={t('yes')}
        color={HOLO.amber}
        width={0.3}
        height={0.09}
        position={[-0.17, -0.12, 0.006]}
        hovered={hoveredId === EXTRACT_YES_ID}
        onSelect={onConfirm}
      />
      <HoloButton
        registry={registry}
        id={EXTRACT_NO_ID}
        label={t('no')}
        width={0.3}
        height={0.09}
        position={[0.17, -0.12, 0.006]}
        hovered={hoveredId === EXTRACT_NO_ID}
        onSelect={onCancel}
      />
    </AnchoredPanel>
  );
});
