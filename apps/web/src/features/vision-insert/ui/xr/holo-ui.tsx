'use client';

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useHoloPanel, type HoloPanelHandlers, type PanelRegistry } from './holo-panel';
import {
  createHoloFrameMaterial,
  holoCardTexture,
  HOLO,
  type HoloCardSpec,
  type HoloFrameMaterial,
} from './holo-style';

type Vec3 = [number, number, number];

/** Glowing frame plane (scan lines, corner brackets); `active` adds the sweep band. */
export const HoloFrame = memo(function HoloFrame({
  width,
  height,
  color = HOLO.cyan,
  hovered = false,
  active = false,
  opacity = 1,
  position,
  panelRef,
  backplate = true,
}: {
  width: number;
  height: number;
  color?: string;
  hovered?: boolean;
  active?: boolean;
  opacity?: number;
  position?: Vec3;
  panelRef?: (o: THREE.Object3D | null) => void;
  /** Dark glass behind the light (normal blending): text stays readable over a bright photo. */
  backplate?: boolean;
}) {
  const material = useMemo(
    () => createHoloFrameMaterial(width, height, color),
    [width, height, color]
  );
  // Uniforms are mutated through a ref in the frame loop (the memo'd material stays immutable).
  const live = useRef<HoloFrameMaterial | null>(null);
  useEffect(() => {
    live.current = material;
    return () => material.dispose();
  }, [material]);
  useFrame((state, delta) => {
    const m = live.current;
    if (!m) return;
    const u = m.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    // Ease the hover glow (no jump, Meta: clear hover state).
    u.uHover.value += ((hovered ? 1 : 0) - u.uHover.value) * Math.min(1, delta * 12);
    u.uActive.value = active ? 1 : 0;
    u.uOpacity.value = opacity;
  });
  return (
    <group position={position}>
      {backplate && (
        <mesh renderOrder={1} position={[0, 0, -0.001]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            color={HOLO.dome}
            transparent
            opacity={BACKPLATE_OPACITY * opacity}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <mesh ref={panelRef} material={material} renderOrder={2}>
        <planeGeometry args={[width, height]} />
      </mesh>
    </group>
  );
});

/** Backplate opacity: dark enough for AA-like text contrast on a white wall, still see-through. */
const BACKPLATE_OPACITY = 0.82;

/** Text card plane (canvas texture, redrawn only when its text changes). */
export const HoloText = memo(function HoloText({
  spec,
  width,
  height,
  position,
  opacity = 1,
}: {
  spec: HoloCardSpec;
  width: number;
  height: number;
  position?: Vec3;
  opacity?: number;
}) {
  const ratio = width / height;
  const texture = useMemo(
    () =>
      holoCardTexture({
        width: 1024,
        height: Math.max(64, Math.round(1024 / ratio)),
        ...spec,
      }),
    [spec, ratio]
  );
  return (
    <mesh position={position} renderOrder={3}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
});

export interface HoloButtonProps extends HoloPanelHandlers {
  registry: PanelRegistry | undefined;
  /** Panel id (`holo:` prefix), also the studio hover id. */
  id: string;
  label: string;
  sub?: string;
  width?: number;
  height?: number;
  position?: Vec3;
  hovered?: boolean;
  color?: string;
  /** Disabled: dimmed and not hittable. */
  disabled?: boolean;
  /** Pressed / on state (toggle). */
  on?: boolean;
  children?: ReactNode;
}

/**
 * Holographic button: frame + label, a registered panel (tap = `onSelect`). Size ≥ 6 cm on its
 * short side (Meta: ≥ 3° hit target at ray distance).
 */
export const HoloButton = memo(function HoloButton({
  registry,
  id,
  label,
  sub,
  width = 0.26,
  height = 0.08,
  position,
  hovered = false,
  color = HOLO.cyan,
  disabled = false,
  on = false,
  onSelect,
  onDrag,
  onDragEnd,
}: HoloButtonProps) {
  const ref = useHoloPanel(disabled ? undefined : registry, id, {
    ...(onSelect ? { onSelect } : {}),
    ...(onDrag ? { onDrag } : {}),
    ...(onDragEnd ? { onDragEnd } : {}),
  });
  const spec = useMemo<HoloCardSpec>(
    () => ({
      glass: false,
      accent: color,
      lines: [
        { text: label, size: sub ? 46 : 54, weight: 700, color: on ? color : HOLO.ink },
        ...(sub ? [{ text: sub, size: 32, weight: 400 as const, color: HOLO.ink }] : []),
      ],
    }),
    [label, sub, color, on]
  );
  return (
    <group position={position}>
      <HoloFrame
        width={width}
        height={height}
        color={color}
        hovered={hovered && !disabled}
        active={on}
        opacity={disabled ? 0.35 : 1}
        panelRef={ref}
      />
      <HoloText
        spec={spec}
        width={width * 0.94}
        height={height * 0.9}
        position={[0, 0, 0.002]}
        opacity={disabled ? 0.4 : 1}
      />
    </group>
  );
});

export type HoloImageState = 'none' | 'loading' | 'ready' | 'error';

/**
 * Texture of a drawn view (data URL or stored file URL), freed when the URL changes or on unmount.
 * A stored file needs CORS for WebGL; when it fails the slide says so (`error`).
 */
export function useHoloImage(url: string | undefined): {
  texture: THREE.Texture | null;
  state: HoloImageState;
} {
  const [loaded, setLoaded] = useState<{
    url: string;
    texture: THREE.Texture | null;
    ok: boolean;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let texture: THREE.Texture | null = null;
    texture = loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (alive) setLoaded({ url, texture: t, ok: true });
      },
      undefined,
      () => {
        if (alive) setLoaded({ url, texture: null, ok: false });
      }
    );
    return () => {
      alive = false;
      texture?.dispose();
    };
  }, [url]);
  if (!url) return { texture: null, state: 'none' };
  if (loaded?.url !== url) return { texture: null, state: 'loading' };
  return { texture: loaded.texture, state: loaded.ok ? 'ready' : 'error' };
}
