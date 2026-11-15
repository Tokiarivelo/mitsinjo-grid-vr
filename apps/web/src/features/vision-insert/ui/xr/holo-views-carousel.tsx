'use client';

import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { snapIndex, type ViewSlide } from '../../utils/xr-extract';
import { useHoloPanel, type PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText, useHoloImage } from './holo-ui';
import { createHoloImageMaterial, HOLO, type HoloImageMaterial } from './holo-style';
import { AnchoredPanel } from './holo-extract-panels';
import { CAROUSEL_SPACING, SLIDE_SIZE, slidePose, type PanelAnchor } from './xr-layout';

/** Slides further than this from the focused one are not drawn (overdraw on Quest). */
const SLIDE_SHOWN = 2.3;
const EASE = 9;

export const VIEWS_IDS = {
  prev: 'holo:views-prev',
  next: 'holo:views-next',
  validate: 'holo:views-validate',
  redraw: 'holo:views-redraw',
  build: 'holo:views-build',
  cancel: 'holo:views-cancel',
  slide: (id: string) => `holo:slide-${id}`,
} as const;

interface SlideProps {
  slide: ViewSlide;
  index: number;
  offset: MutableRefObject<number>;
  registry: PanelRegistry;
  hovered: boolean;
  label: string;
  statusText: string;
  /** Status when the drawing exists but WebGL could not load it (stored file without CORS). */
  imageErrorText: string;
  onTap: (index: number) => void;
  onDrag: (dx: number) => void;
  onDragEnd: () => void;
}

/** One drawn view on the arc: its image as a hologram (or a placeholder while it draws). */
const Slide = memo(function Slide({
  slide,
  index,
  offset,
  registry,
  hovered,
  label,
  statusText,
  imageErrorText,
  onTap,
  onDrag,
  onDragEnd,
}: SlideProps) {
  const group = useRef<THREE.Group>(null);
  const { texture, state } = useHoloImage(slide.imageUrl);
  const material = useMemo(() => createHoloImageMaterial(null), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    (material as HoloImageMaterial).uniforms.uMap.value = texture;
    material.needsUpdate = true;
  }, [material, texture]);
  const accent = slide.validated ? HOLO.green : HOLO.cyan;
  useEffect(() => {
    (material as HoloImageMaterial).uniforms.uRim.value.set(accent);
  }, [material, accent]);
  const panelRef = useHoloPanel(registry, VIEWS_IDS.slide(slide.id), {
    onSelect: () => onTap(index),
    onDrag,
    onDragEnd,
  });

  // Placed on the arc every frame from the shared scroll offset (no React render).
  useFrame((st) => {
    const g = group.current;
    if (!g) return;
    const rel = index - offset.current;
    g.visible = Math.abs(rel) <= SLIDE_SHOWN;
    if (!g.visible) return;
    const pose = slidePose(rel);
    g.position.set(...pose.position);
    g.rotation.set(0, pose.yaw, 0);
    const u = (material as HoloImageMaterial).uniforms;
    u.uTime.value = st.clock.elapsedTime;
    u.uFocus.value = pose.focus;
  });

  const showImage = state === 'ready' && texture;
  const caption = useMemo(
    () => ({
      glass: false,
      accent,
      lines: [
        { text: label, size: 56, weight: 700 as const },
        {
          text: state === 'error' ? imageErrorText : statusText,
          size: 40,
          weight: 600 as const,
          color: state === 'error' ? HOLO.amber : accent,
        },
      ],
    }),
    [accent, label, statusText, state, imageErrorText]
  );
  return (
    <group ref={group} name={`holo-slide-${slide.id}`}>
      {showImage ? (
        <mesh ref={panelRef} material={material} renderOrder={2}>
          <planeGeometry args={[SLIDE_SIZE, SLIDE_SIZE]} />
        </mesh>
      ) : (
        <HoloFrame
          width={SLIDE_SIZE}
          height={SLIDE_SIZE}
          active={slide.status === 'generating'}
          hovered={hovered}
          panelRef={panelRef}
          color={slide.status === 'error' ? HOLO.red : HOLO.cyan}
        />
      )}
      {showImage && hovered && (
        <HoloFrame
          width={SLIDE_SIZE + 0.02}
          height={SLIDE_SIZE + 0.02}
          hovered
          backplate={false}
          position={[0, 0, -0.002]}
        />
      )}
      <HoloText
        spec={caption}
        width={SLIDE_SIZE}
        height={0.09}
        position={[0, SLIDE_SIZE / 2 + 0.06, 0.003]}
      />
    </group>
  );
});

export interface HoloViewsCarouselProps {
  anchor: PanelAnchor;
  registry: PanelRegistry;
  hoveredId: string | null;
  slides: ViewSlide[];
  /** Main view of a vehicle is its profile. */
  vehicle: boolean;
  canBuild: boolean;
  onRedraw: (id: ViewSlide['id']) => void;
  onToggleValidated: (id: ViewSlide['id']) => void;
  onBuild: () => void;
  onCancel: () => void;
}

/**
 * 2D views to validate (VS-T20), as a hologram carousel: the main view, then each face drawn
 * beside it, one slide each on an arc round the viewer. Drag anywhere on a slide sideways (held
 * trigger / pinch / mouse) or use the arrows to see the others; tap a side slide to bring it in.
 * Under the slide in focus: validate it (faces), redraw it, and « Validate & build 3D ».
 */
export const HoloViewsCarousel = memo(function HoloViewsCarousel({
  anchor,
  registry,
  hoveredId,
  slides,
  vehicle,
  canBuild,
  onRedraw,
  onToggleValidated,
  onBuild,
  onCancel,
}: HoloViewsCarouselProps) {
  const t = useTranslations('features.visionInsert');
  const [focus, setFocus] = useState(0);
  const offset = useRef(0);
  const dragging = useRef(false);
  const count = slides.length;
  const focused = Math.min(focus, count - 1);
  const current = slides[focused];

  useFrame((_, delta) => {
    if (dragging.current) return;
    offset.current += (focused - offset.current) * Math.min(1, delta * EASE);
  });

  const onDrag = useMemo(
    () => (dx: number) => {
      dragging.current = true;
      // Content follows the pointer: turning right pulls the previous slide in.
      offset.current = Math.max(
        -0.4,
        Math.min(count - 0.6, offset.current - dx / CAROUSEL_SPACING)
      );
    },
    [count]
  );
  const onDragEnd = useMemo(
    () => () => {
      dragging.current = false;
      setFocus(snapIndex(offset.current, count));
    },
    [count]
  );
  const go = (d: number) => setFocus((f) => snapIndex(f + d, count));

  const nameOf = (s: ViewSlide) =>
    s.id === 'main'
      ? vehicle
        ? t('facade2dTabVehicle')
        : t('facade2dTab')
      : t(`faces.${s.id}` as 'faces.side');
  const statusOf = (s: ViewSlide) =>
    s.status === 'generating'
      ? t('vrViews.drawing')
      : s.status === 'error'
        ? t('vrViews.error')
        : s.status === 'idle'
          ? t('vrViews.waiting')
          : s.validated
            ? t('vrViews.validated')
            : t('vrViews.toCheck');

  const header = useMemo(
    () => ({
      glass: false,
      lines: [
        { text: t('vrViews.title'), size: 60, weight: 700 as const },
        {
          text: `${t('vrViews.hint')} · ${t('vrViews.count', { n: focused + 1, total: count })}`,
          size: 38,
          weight: 400 as const,
          color: HOLO.cyan,
        },
      ],
    }),
    [t, focused, count]
  );

  const y1 = -SLIDE_SIZE / 2 - 0.08;
  const y2 = y1 - 0.11;
  const isMain = current?.id === 'main';
  const ready = current?.status === 'ready';
  return (
    <AnchoredPanel anchor={anchor} name="holo-views-carousel">
      <HoloText spec={header} width={0.9} height={0.13} position={[0, SLIDE_SIZE / 2 + 0.2, 0]} />
      {slides.map((s, i) => (
        <Slide
          key={s.id}
          slide={s}
          index={i}
          offset={offset}
          registry={registry}
          hovered={hoveredId === VIEWS_IDS.slide(s.id)}
          label={nameOf(s)}
          statusText={statusOf(s)}
          imageErrorText={t('vrViews.imageError')}
          onTap={setFocus}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
        />
      ))}
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.prev}
        label="◀"
        width={0.09}
        height={0.09}
        position={[-0.32, y1, 0.01]}
        hovered={hoveredId === VIEWS_IDS.prev}
        disabled={focused === 0}
        onSelect={() => go(-1)}
      />
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.validate}
        label={
          isMain
            ? t('vrViews.mainValidated')
            : current?.validated
              ? t('facesUnvalidate')
              : t('facesValidate')
        }
        width={0.25}
        height={0.09}
        position={[-0.12, y1, 0.01]}
        color={HOLO.green}
        on={Boolean(current?.validated)}
        hovered={hoveredId === VIEWS_IDS.validate}
        disabled={isMain || !ready}
        onSelect={() => current && onToggleValidated(current.id)}
      />
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.redraw}
        label={t('facesRegenerate')}
        width={0.2}
        height={0.09}
        position={[0.12, y1, 0.01]}
        hovered={hoveredId === VIEWS_IDS.redraw}
        disabled={!current || current.status === 'generating'}
        onSelect={() => current && onRedraw(current.id)}
      />
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.next}
        label="▶"
        width={0.09}
        height={0.09}
        position={[0.32, y1, 0.01]}
        hovered={hoveredId === VIEWS_IDS.next}
        disabled={focused >= count - 1}
        onSelect={() => go(1)}
      />
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.build}
        label={t('vrViews.build')}
        width={0.42}
        height={0.09}
        position={[-0.1, y2, 0.01]}
        color={HOLO.amber}
        hovered={hoveredId === VIEWS_IDS.build}
        disabled={!canBuild}
        onSelect={onBuild}
      />
      <HoloButton
        registry={registry}
        id={VIEWS_IDS.cancel}
        label={t('vrExtract.no')}
        width={0.2}
        height={0.09}
        position={[0.24, y2, 0.01]}
        hovered={hoveredId === VIEWS_IDS.cancel}
        onSelect={onCancel}
      />
    </AnchoredPanel>
  );
});
