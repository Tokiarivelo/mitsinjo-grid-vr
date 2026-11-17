'use client';

import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { APPLIANCE_CATALOG, type ApplianceCategory } from '@mitsinjo/engine';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { isAppliance, localDescription, localLabel } from '@/lib/vision';
import type { SpatialTarget } from './spatial-projection';
import { HoloText } from './holo-ui';
import { HOLO, type HoloCardSpec } from './holo-style';

export interface HoloDetectionTargetProps {
  target: SpatialTarget;
  hovered: boolean;
  isMaterialized: boolean;
  isConnected?: boolean;
  /** A dialog or the views carousel is open: the outline fades back. */
  dimmed?: boolean;
  /** A panel is open in front: no label card (the panel names the object). */
  hideLabel?: boolean;
}

/** Label card size (m) at 1.6 m from the eye; grown with distance so it reads the same. */
const LABEL_W = 0.5;
const LABEL_H = 0.17;

/** Line loop + translucent fill of one outline ring (world points). */
function ringGeometries(ring: [number, number, number][], uv: Array<[number, number]>) {
  const flat = new Float32Array(ring.flatMap((p) => p));
  const line = new THREE.BufferGeometry();
  line.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  const fill = new THREE.BufferGeometry();
  fill.setAttribute('position', new THREE.BufferAttribute(flat.slice(), 3));
  try {
    const faces = THREE.ShapeUtils.triangulateShape(
      uv.map(([u, v]) => new THREE.Vector2(u, -v)),
      []
    );
    fill.setIndex(faces.flat());
  } catch {
    fill.setIndex([]);
  }
  return { line, fill };
}

/**
 * Object outlined on the scanned view (VS-T18), like the photo upload: its SAM outline (else its
 * box) traced in light on the 360° photo, a faint fill that brightens on hover, and, only while the
 * laser is on it (VS-T42), a billboard card above it with its name and the model's brief description. Hover and shots come from
 * `XRBlasterController` (image point under the laser), no collider of its own.
 */
export const HoloDetectionTarget = memo(function HoloDetectionTarget({
  target,
  hovered,
  isMaterialized,
  isConnected = false,
  dimmed = false,
  hideLabel = false,
}: HoloDetectionTargetProps) {
  const { locale } = useAppLocale();
  const t = useTranslations('features.visionInsert');
  const { detection, position, id, outline, outlineUv, labelAnchor } = target;

  const labelScale = Math.max(
    1,
    Math.hypot(labelAnchor[0], labelAnchor[1] - 1.6, labelAnchor[2]) / 1.6
  );
  const watts = useMemo(() => {
    const cat = (detection.category ?? 'other') as ApplianceCategory;
    return APPLIANCE_CATALOG[cat]?.defaultW ?? 150;
  }, [detection.category]);

  const title = localLabel(detection, locale) || detection.label;
  const appliance = isAppliance(detection);
  const description =
    localDescription(detection, locale) ??
    (appliance ? t(`categories.${detection.category}`) : t('noLoad'));
  const hint = !isMaterialized
    ? t('vrExtractHint')
    : isConnected
      ? hovered
        ? t('vrShootToDisconnect')
        : t('vrGridStatusConnected', { watts })
      : hovered
        ? t('vrShootToConnect', { watts })
        : t('vrGridStatusNotConnected');

  const accent = isConnected ? HOLO.green : hovered ? HOLO.amber : HOLO.cyan;
  const spec = useMemo<HoloCardSpec>(
    () => ({
      accent,
      align: 'left',
      lines: [
        { text: title, size: 58, weight: 700, color: hovered ? HOLO.amber : HOLO.ink },
        { text: description, size: 40, weight: 400 },
        { text: hint, size: 34, weight: 600, color: accent },
      ],
    }),
    [accent, title, description, hint, hovered]
  );

  // One line and one fill material for every ring of the object (shared, animated together).
  const materials = useMemo(
    () => ({
      line: new THREE.LineBasicMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
      fill: new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }),
    []
  );
  useEffect(
    () => () => {
      materials.line.dispose();
      materials.fill.dispose();
    },
    [materials]
  );
  useEffect(() => {
    materials.line.color.set(accent);
    materials.fill.color.set(accent);
  }, [materials, accent]);

  const rings = useMemo(
    () => outline.map((ring, i) => ringGeometries(ring, outlineUv[i] ?? [])),
    [outline, outlineUv]
  );
  useEffect(
    () => () =>
      rings.forEach((r) => {
        r.line.dispose();
        r.fill.dispose();
      }),
    [rings]
  );

  // Breathing light along the outline; brighter and steady on hover.
  useFrame((state) => {
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2.4);
    const k = dimmed ? 0.25 : 1;
    materials.line.opacity = k * (hovered ? 1 : 0.55 + 0.35 * pulse);
    materials.fill.opacity = k * (hovered ? 0.28 : 0.06 + 0.04 * pulse);
  });

  return (
    <group name={`holo-target-${id}`}>
      {!isMaterialized &&
        rings.map((r, i) => (
          <group key={i} name="holo-outline">
            <lineLoop geometry={r.line} material={materials.line} renderOrder={2} />
            <mesh geometry={r.fill} material={materials.fill} renderOrder={1} />
          </group>
        ))}

      {/* Under a dialog / the carousel the card would cover it (both draw without depth). The
          analysed outlines stay bare: the name card shows only under the laser (VS-T42). */}
      {!hideLabel && (hovered || isMaterialized) && (
        <Billboard
          position={
            isMaterialized
              ? [position[0], position[1] + 0.12 * labelScale, position[2]]
              : [labelAnchor[0], labelAnchor[1] + 0.12 * labelScale, labelAnchor[2]]
          }
          scale={labelScale}
          follow
        >
          <HoloText spec={spec} width={LABEL_W} height={LABEL_H} />
        </Billboard>
      )}
    </group>
  );
});
