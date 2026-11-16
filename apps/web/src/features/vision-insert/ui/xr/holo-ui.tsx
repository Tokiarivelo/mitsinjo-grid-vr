'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useHoloPanel, type HoloPanelHandlers, type PanelRegistry } from './holo-panel';
import { holoIconTexture, type HoloIcon } from './holo-icons';
import {
  createHoloFrameMaterial,
  createHoloImageMaterial,
  holoCardTexture,
  holoTextPx,
  HOLO,
  HOLO_TEXT_DMM,
  HOLO_VIEW_DISTANCE,
  type HoloCardSpec,
  type HoloFrameMaterial,
  type HoloImageMaterial,
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
  /** Line icon left of the label. */
  icon?: HoloIcon;
  /** What a press does, shown in the hover popover under the label. */
  tip?: string;
  /** Distance (m) the button is read from: sets the label size in dmm. */
  distance?: number;
  children?: ReactNode;
}

/** Popover over a pointed button: wide enough for the label at title size and a 2-row tip. */
const POPOVER_W = 0.5;
const POPOVER_GAP = 0.025;
/** Popover a little toward the viewer, so the button's frame never cuts it. */
const POPOVER_Z = 0.05;

/** Hover popover height (m): label row, plus 2 tip rows when there is a tip. */
export function popoverHeight(distance: number, tip: boolean): number {
  const row = (dmm: number) => (dmm / 1000) * distance * 1.3;
  return row(HOLO_TEXT_DMM.title) + (tip ? 2 * row(HOLO_TEXT_DMM.body) : 0) + 0.04;
}

/**
 * Holographic button: frame + icon + label, a registered panel (tap = `onSelect`). Size ≥ 6 cm on
 * its short side (Meta: ≥ 3° hit target at ray distance). The label is sized in dmm for
 * `distance`. Pointed at, a popover above it repeats the label large with what it does (`tip`):
 * low or small buttons stay readable.
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
  icon,
  tip,
  distance = HOLO_VIEW_DISTANCE,
  onSelect,
  onDrag,
  onDragEnd,
  axis,
}: HoloButtonProps) {
  const ref = useHoloPanel(disabled ? undefined : registry, id, {
    ...(onSelect ? { onSelect } : {}),
    ...(onDrag ? { onDrag } : {}),
    ...(onDragEnd ? { onDragEnd } : {}),
    ...(axis ? { axis } : {}),
  });
  const iconSize = icon ? Math.min(height * 0.6, width * 0.3) : 0;
  const textW = width * 0.94 - (icon ? iconSize + 0.012 : 0);
  const ink = on ? color : HOLO.ink;
  const spec = useMemo<HoloCardSpec>(
    () => ({
      glass: false,
      accent: color,
      lines: [
        {
          text: label,
          size: holoTextPx(sub ? HOLO_TEXT_DMM.body : HOLO_TEXT_DMM.label, textW * 0.9, distance),
          weight: 700,
          color: ink,
        },
        ...(sub
          ? [
              {
                text: sub,
                size: holoTextPx(HOLO_TEXT_DMM.caption, textW * 0.9, distance),
                weight: 400 as const,
                color: HOLO.ink,
              },
            ]
          : []),
      ],
    }),
    [label, sub, color, ink, textW, distance]
  );
  const iconTex = useMemo(() => (icon ? holoIconTexture(icon, ink) : null), [icon, ink]);
  const shown = hovered && !disabled;
  const popH = popoverHeight(distance, Boolean(tip));
  const popover = useMemo<HoloCardSpec | null>(
    () =>
      shown
        ? {
            accent: color,
            lines: [
              {
                text: label,
                size: holoTextPx(HOLO_TEXT_DMM.title, POPOVER_W, distance),
                weight: 700,
              },
              ...(tip
                ? [
                    {
                      text: tip,
                      size: holoTextPx(HOLO_TEXT_DMM.body, POPOVER_W, distance),
                      weight: 400 as const,
                      color,
                    },
                  ]
                : []),
            ],
          }
        : null,
    [shown, label, tip, color, distance]
  );
  return (
    <group position={position}>
      <HoloFrame
        width={width}
        height={height}
        color={color}
        hovered={shown}
        active={on}
        opacity={disabled ? 0.35 : 1}
        panelRef={ref}
      />
      {iconTex && (
        <mesh position={[-width * 0.47 + iconSize / 2 + 0.01, 0, 0.002]} renderOrder={3}>
          <planeGeometry args={[iconSize, iconSize]} />
          <meshBasicMaterial
            map={iconTex}
            transparent
            opacity={disabled ? 0.4 : 1}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <HoloText
        spec={spec}
        width={textW}
        height={height * 0.9}
        position={[icon ? (width * 0.94 - textW) / 2 : 0, 0, 0.002]}
        opacity={disabled ? 0.4 : 1}
      />
      {popover && (
        <HoloText
          spec={popover}
          width={POPOVER_W}
          height={popH}
          position={[0, height / 2 + POPOVER_GAP + popH / 2, POPOVER_Z]}
        />
      )}
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

/**
 * Hologram material of a drawn view (`createHoloImageMaterial`) showing `texture` with a `rim`
 * colour, its scan lines animated each frame, freed on unmount. The memo'd material stays
 * immutable: uniforms are mutated through a ref inside this hook; `setFocus` (0–1, safe in a
 * frame loop) dims a view out of focus.
 */
export function useHoloImageMaterial(
  texture: THREE.Texture | null,
  rim: string
): { material: THREE.ShaderMaterial; setFocus: (focus: number) => void } {
  const material = useMemo(() => createHoloImageMaterial(null), []);
  const live = useRef<HoloImageMaterial | null>(null);
  useEffect(() => {
    live.current = material;
    return () => {
      live.current = null;
      material.dispose();
    };
  }, [material]);
  useEffect(() => {
    const m = live.current;
    if (!m) return;
    m.uniforms.uMap.value = texture;
    m.needsUpdate = true;
  }, [material, texture]);
  useEffect(() => {
    live.current?.uniforms.uRim.value.set(rim);
  }, [material, rim]);
  useFrame((state) => {
    if (live.current) live.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  const setFocus = useCallback((focus: number) => {
    if (live.current) live.current.uniforms.uFocus.value = focus;
  }, []);
  return { material, setFocus };
}
