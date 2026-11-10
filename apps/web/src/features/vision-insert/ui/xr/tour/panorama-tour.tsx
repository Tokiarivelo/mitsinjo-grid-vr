'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useTranslations } from '@/lib/i18n';
import { renderView, uFrontFacing, yawPitchOf, type CaptureView } from './equirect';
import { entryU, TOUR_ROOMS, type TourRoomId } from './tour-data';
import {
  tourArrows,
  tourExpectedDetections,
  TOUR_EYE,
  TOUR_SPHERE_RADIUS,
  walkTarget,
  type TourArrow,
} from './tour-nav';
import type { ApplianceDetection } from '@/lib/vision';
import { getPillLabelTexture } from '../wrist-menu-texture';

export interface TourCapture {
  url: string;
  expected: ApplianceDetection[];
}

export interface PanoramaTourProps {
  room: TourRoomId;
  /** Image column straight ahead; null until the first frame sets it from the head. */
  uFront: number | null;
  /** Room asked for (arrow, stick, key); the tour fades out, swaps, then calls `onArrive`. */
  pending: TourRoomId | null;
  onArrive: (room: TourRoomId, uFront: number) => void;
  /** "Walk forward" (stick or key): the arrow closest to the gaze. */
  onWalk: (to: TourRoomId) => void;
  /** Hovered id from the input controller (`tour-link:<room>`). */
  hoveredId?: string | null;
  /** Gives the parent the scan function of the current room. */
  onRegisterCapture: (fn: ((view: CaptureView) => TourCapture | null) | null) => void;
}

const FADE_OUT = 0.18;
const FADE_IN = 0.28;
const WALK_COOLDOWN_MS = 900;
const CAPTURE_W = 1280;
const CAPTURE_H = 720;

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Same mapping as `equirect.ts` (yaw 0 = -Z, right = +u). Texture flipY: GL v = 1 - image v.
const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float uFront;
  uniform float fade;
  varying vec3 vDir;
  const float TAU = 6.28318530718;
  const float PI = 3.14159265359;
  void main() {
    vec3 d = normalize(vDir);
    float u = fract(uFront + atan(d.x, -d.z) / TAU);
    float v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI;
    vec3 c = texture2D(map, vec2(u, 1.0 - v)).rgb;
    gl_FragColor = vec4(c * (1.0 - fade), 1.0);
    #include <colorspace_fragment>
  }
`;

const _dir = new THREE.Vector3();

/**
 * Walkable 360° test space (VS-T14): real photos of six rooms on a sphere around the viewer,
 * Street View-like floor arrows to the next rooms, blink fade between rooms (Meta comfort:
 * teleport with a fade, no smooth motion). Drawn last with no depth write, so panels, labels
 * and targets in front of it are never cut.
 */
export const PanoramaTour = memo(function PanoramaTour({
  room,
  uFront,
  pending,
  onArrive,
  onWalk,
  hoveredId = null,
  onRegisterCapture,
}: PanoramaTourProps) {
  const t = useTranslations('features.visionInsert');
  const { gl, camera } = useThree();
  const texturesRef = useRef(new Map<TourRoomId, THREE.Texture>());
  const fadeRef = useRef(1);
  const pixelsRef = useRef<{ room: TourRoomId; data: ImageData } | null>(null);
  const lastWalkRef = useRef(0);
  const arrowsRef = useRef<TourArrow[]>([]);
  const onWalkRef = useRef(onWalk);
  onWalkRef.current = onWalk;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          uFront: { value: 0 },
          fade: { value: 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(TOUR_SPHERE_RADIUS, 64, 32), []);

  const texture = (id: TourRoomId): THREE.Texture => {
    const cached = texturesRef.current.get(id);
    if (cached) return cached;
    const tex = new THREE.TextureLoader().load(TOUR_ROOMS[id].src);
    tex.colorSpace = THREE.SRGBColorSpace;
    // No mipmaps: the u seam (fract) would show a line of the smallest mip.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    texturesRef.current.set(id, tex);
    return tex;
  };

  // Keep the current room and its neighbours loaded; free the rest (4K photos).
  useEffect(() => {
    const keep = new Set<TourRoomId>([room, ...TOUR_ROOMS[room].links.map((l) => l.to)]);
    for (const id of keep) texture(id);
    for (const [id, tex] of texturesRef.current) {
      if (keep.has(id)) continue;
      tex.dispose();
      texturesRef.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(
    () => () => {
      for (const tex of texturesRef.current.values()) tex.dispose();
      texturesRef.current.clear();
      material.dispose();
      geometry.dispose();
    },
    [material, geometry]
  );

  const arrows = useMemo(
    () => (uFront === null ? [] : tourArrows(TOUR_ROOMS[room], uFront)),
    [room, uFront]
  );
  arrowsRef.current = arrows;

  // Scan photo of the current room: what the viewer sees through `view`.
  useEffect(() => {
    if (uFront === null) {
      onRegisterCapture(null);
      return;
    }
    onRegisterCapture((view) => {
      const tex = texturesRef.current.get(room);
      const img = tex?.image as HTMLImageElement | undefined;
      if (!img || !img.width) return null;
      try {
        if (pixelsRef.current?.room !== room) {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0);
          pixelsRef.current = { room, data: ctx.getImageData(0, 0, img.width, img.height) };
        }
        const out = document.createElement('canvas');
        out.width = CAPTURE_W;
        out.height = CAPTURE_H;
        const octx = out.getContext('2d');
        if (!octx) return null;
        const frame = octx.createImageData(CAPTURE_W, CAPTURE_H);
        renderView(pixelsRef.current.data, frame, view, uFront);
        octx.putImageData(frame, 0, 0);
        return {
          url: out.toDataURL('image/jpeg', 0.88),
          expected: tourExpectedDetections(TOUR_ROOMS[room], uFront, view),
        };
      } catch {
        return null;
      }
    });
    return () => onRegisterCapture(null);
  }, [room, uFront, onRegisterCapture]);

  // Keyboard walk (desktop / emulator): ↑, W or Z (AZERTY).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'w', 'W', 'z', 'Z'].includes(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      camera.getWorldDirection(_dir);
      const to = walkTarget(arrowsRef.current, yawPitchOf([_dir.x, _dir.y, _dir.z]).yaw);
      if (to) onWalkRef.current(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera]);

  useFrame((_, delta) => {
    camera.getWorldDirection(_dir);
    const headYaw = yawPitchOf([_dir.x, _dir.y, _dir.z]).yaw;
    const current = texturesRef.current.get(room) ?? texture(room);

    // First frame: face the start view.
    if (uFront === null) {
      if (current.image) onArrive(room, uFrontFacing(entryU(TOUR_ROOMS[room], null), headYaw));
      material.uniforms.fade!.value = 1;
      return;
    }

    // Thumbstick forward on any controller = walk to the arrow ahead.
    const session = gl.xr?.getSession?.();
    if (session && !pending) {
      const now = performance.now();
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes;
        const y = axes && axes.length >= 4 ? axes[3]! : (axes?.[1] ?? 0);
        if (y < -0.75 && now - lastWalkRef.current > WALK_COOLDOWN_MS) {
          lastWalkRef.current = now;
          const to = walkTarget(arrowsRef.current, headYaw);
          if (to) onWalkRef.current(to);
          break;
        }
      }
    }

    // Blink: fade out, swap once the next photo is loaded, fade in.
    if (pending) {
      fadeRef.current = Math.min(1, fadeRef.current + delta / FADE_OUT);
      const next = texture(pending);
      if (fadeRef.current >= 1 && next.image) {
        const from = room;
        onArrive(pending, uFrontFacing(entryU(TOUR_ROOMS[pending], from), headYaw));
      }
    } else if (current.image) {
      fadeRef.current = Math.max(0, fadeRef.current - delta / FADE_IN);
    }
    material.uniforms.map!.value = current;
    material.uniforms.uFront!.value = uFront;
    material.uniforms.fade!.value = fadeRef.current;
  });

  return (
    <group name="panorama-tour">
      <mesh
        geometry={geometry}
        material={material}
        position={TOUR_EYE}
        renderOrder={1000}
        frustumCulled={false}
        name="panorama-sphere"
      />
      {arrows.map((a) => (
        <TourArrowMark
          key={a.id}
          arrow={a}
          hovered={hoveredId === a.id}
          label={t('tourGoTo', { room: t(`tourRoom_${a.to}`) })}
        />
      ))}
    </group>
  );
});

const ARROW_SHAPE = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.26);
  s.lineTo(0.22, 0.02);
  s.lineTo(0.12, 0.02);
  s.lineTo(0.12, -0.2);
  s.lineTo(-0.12, -0.2);
  s.lineTo(-0.12, 0.02);
  s.lineTo(-0.22, 0.02);
  s.closePath();
  return s;
})();

/** Street View-like chevron on the floor, pointing to the next room, with its name above. */
const TourArrowMark = memo(function TourArrowMark({
  arrow,
  hovered,
  label,
}: {
  arrow: TourArrow;
  hovered: boolean;
  label: string;
}) {
  const labelTex = useMemo(() => getPillLabelTexture(label, hovered, 512), [label, hovered]);
  const color = hovered ? '#c084fc' : '#e0f2fe';
  return (
    <group position={arrow.position} name={`tour-arrow-${arrow.to}`}>
      {/* Flat on the floor; local +Y of the shape points away from the viewer. */}
      <group rotation={[-Math.PI / 2, 0, -arrow.yaw]}>
        <mesh scale={hovered ? 1.2 : 1}>
          <shapeGeometry args={[ARROW_SHAPE]} />
          <meshBasicMaterial color={color} transparent opacity={0.92} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.002]}>
          <ringGeometry args={[0.3, 0.34, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      </group>
      <Billboard position={[0, 0.45, 0]}>
        <mesh>
          <planeGeometry args={[0.56, 0.12]} />
          <meshBasicMaterial map={labelTex} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
});
