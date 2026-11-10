'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useTranslations } from '@/lib/i18n';
import { renderView, uFrontFacing, yawPitchOf, type CaptureView, type Vec3 } from './equirect';
import { entryU, TOUR_ROOMS, type TourRoomId } from './tour-data';
import {
  arrowAt,
  isWalkKey,
  keyWalkAxes,
  stepWalk,
  stickWalkAxes,
  tourExpectedDetections,
  tourScale,
  TOUR_ARROW_REACH,
  TOUR_EYE,
  TOUR_SPHERE_RADIUS,
  TOUR_WALK_SPEED,
  type Ground,
  type TourArrow,
  type WalkAxes,
} from './tour-nav';
import { isDevXREmulated } from '@/features/microgrid-3d';
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
  /** Floor arrows of the room (from the tour state); their positions follow the walk. */
  arrows: TourArrow[];
  /** Place asked for (arrow shot, or walked onto): walk to its arrow, then through it. */
  pending: TourRoomId | null;
  onArrive: (room: TourRoomId, uFront: number) => void;
  /** Walked onto a floor arrow: go through to that place. */
  onWalk: (to: TourRoomId) => void;
  /** Hovered id from the input controller (`tour-link:<room>`). */
  hoveredId?: string | null;
  /** Gives the parent the scan function of the current room. */
  onRegisterCapture: (fn: ((view: CaptureView) => TourCapture | null) | null) => void;
}

const FADE_IN = 0.28;
/** Walk-through: the old photo keeps moving forward while the next one comes in from behind. */
const CROSS_TIME = 0.75;
const CROSS_DIST = 1.1;
/** Eye height above the floor in the photos (m). */
const FLOOR = TOUR_EYE[1];
/** Head bob while walking (off a real headset: bobbing the world in VR is a comfort issue). */
const BOB_AMPLITUDE = 0.022;
const STEPS_PER_SECOND = 1.8;
const CAPTURE_W = 1280;
const CAPTURE_H = 720;

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Grounded panorama: the photo is projected on a floor plane and a wall around the spot where it
// was taken, so walking away from that spot slides the floor and shifts near things more than far
// ones (parallax). Same mapping as `equirect.ts` (yaw 0 = -Z, right = +u); flipY: GL v = 1 - v.
const FRAGMENT = /* glsl */ `
  uniform sampler2D mapA;
  uniform sampler2D mapB;
  uniform float uFrontA;
  uniform float uFrontB;
  uniform vec3 offA;
  uniform vec3 offB;
  uniform float wallA;
  uniform float wallB;
  uniform float mixB;
  uniform float fade;
  uniform float vignette;
  uniform vec3 eyeCenter;
  uniform vec3 camFwd;
  varying vec3 vWorld;
  const float TAU = 6.28318530718;
  const float PI = 3.14159265359;
  const float FLOOR = ${FLOOR.toFixed(2)};

  vec2 groundedUv(vec3 o, vec3 d, float wall, float uF) {
    float b = dot(o, d);
    float c = dot(o, o) - wall * wall;
    float t = -b + sqrt(max(b * b - c, 0.0));
    if (d.y < -1e-4) t = min(t, (-FLOOR - o.y) / d.y);
    vec3 p = normalize(o + t * d);
    float u = fract(uF + atan(p.x, -p.z) / TAU);
    float v = 0.5 - asin(clamp(p.y, -1.0, 1.0)) / PI;
    return vec2(u, 1.0 - v);
  }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    vec3 head = cameraPosition - eyeCenter;
    vec3 c = texture2D(mapA, groundedUv(head + offA, d, wallA, uFrontA)).rgb;
    if (mixB > 0.0) {
      vec3 cb = texture2D(mapB, groundedUv(head + offB, d, wallB, uFrontB)).rgb;
      c = mix(c, cb, mixB);
    }
    // Comfort vignette while moving: narrows the view edges, never the centre.
    float edge = 1.0 - smoothstep(0.5, 0.9, dot(d, camFwd));
    c *= (1.0 - fade) * (1.0 - vignette * edge);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const _dir = new THREE.Vector3();
const _head = new THREE.Vector3();

interface Cross {
  to: TourRoomId;
  uFront: number;
  start: Ground;
  fwd: Ground;
  t: number;
}

/**
 * Walkable 360° test space (VS-T14/16): real photos around the viewer, grounded on a floor so the
 * viewer really walks (keys, thumbstick, or walking in the room) instead of jumping between
 * spots. Walking onto a floor arrow (or shooting it) goes through to the next place: the photo
 * keeps moving forward while the next one blends in. Comfort: constant speed, vignette while
 * moving, no head bob in a real headset. Drawn last with no depth write, so panels, labels and
 * targets in front of it are never cut.
 */
export const PanoramaTour = memo(function PanoramaTour({
  room,
  uFront,
  arrows,
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
  const groundRef = useRef<Ground>([0, 0]);
  const crossRef = useRef<Cross | null>(null);
  /** Shown room after a walk-through, until the parent's props catch up. */
  const arrivedRef = useRef<{ room: TourRoomId; uFront: number } | null>(null);
  const motionRef = useRef({ speed: 0, phase: 0 });
  const heldRef = useRef(new Set<string>());
  const hoverRef = useRef(false);
  const arrowsGroupRef = useRef<THREE.Group>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          mapA: { value: null },
          mapB: { value: null },
          uFrontA: { value: 0 },
          uFrontB: { value: 0 },
          offA: { value: new THREE.Vector3() },
          offB: { value: new THREE.Vector3() },
          wallA: { value: 4 },
          wallB: { value: 4 },
          mixB: { value: 0 },
          fade: { value: 1 },
          vignette: { value: 0 },
          eyeCenter: { value: new THREE.Vector3(...TOUR_EYE) },
          camFwd: { value: new THREE.Vector3(0, 0, -1) },
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

  // Arrow spots relative to the photo spot, captured before the walk moves them.
  const bases = useMemo(() => arrows.map((a) => [...a.position] as Vec3), [arrows]);

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

  // Keys held = walking (↑↓←→, WASD, ZQSD). Desktop preview: only while the pointer is over the
  // scene, so arrow keys still scroll the page. Pointer locked (emulator Play Mode): the emulator
  // moves the headset itself with these keys, and walking onto arrows still works.
  useEffect(() => {
    const canvas = gl.domElement;
    const held = heldRef.current;
    const enter = () => (hoverRef.current = true);
    const leave = () => (hoverRef.current = false);
    const down = (e: KeyboardEvent) => {
      if (!isWalkKey(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!gl.xr?.isPresenting && !hoverRef.current) return;
      if (e.key.startsWith('Arrow')) e.preventDefault();
      held.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    const clear = () => held.clear();
    canvas.addEventListener('pointerenter', enter);
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      canvas.removeEventListener('pointerenter', enter);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      held.clear();
    };
  }, [gl]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    camera.getWorldDirection(_dir);
    const headYaw = yawPitchOf([_dir.x, _dir.y, _dir.z]).yaw;
    material.uniforms.camFwd!.value.copy(_dir);

    // Props catch up after a walk-through.
    const arrived = arrivedRef.current;
    if (arrived && arrived.room === room && arrived.uFront === uFront) arrivedRef.current = null;
    const shownRoom = arrivedRef.current?.room ?? room;
    const shownU = arrivedRef.current?.uFront ?? uFront;
    const current = texturesRef.current.get(shownRoom) ?? texture(shownRoom);

    // First frame: face the start view.
    if (shownU === null) {
      if (current.image) onArrive(room, uFrontFacing(entryU(TOUR_ROOMS[room], null), headYaw));
      material.uniforms.fade!.value = 1;
      return;
    }

    const scale = tourScale(TOUR_ROOMS[shownRoom]);
    const session = gl.xr?.getSession?.();
    const realHeadset = !!session && !isDevXREmulated();
    camera.getWorldPosition(_head);
    const head: Ground = [_head.x - TOUR_EYE[0], _head.z - TOUR_EYE[2]];
    const before = groundRef.current;
    let ground = before;
    const cross = crossRef.current;

    if (cross) {
      // Walk-through: old photo moves on, next one comes in from behind, then arrive.
      cross.t = Math.min(1, cross.t + delta / CROSS_TIME);
      const e = cross.t * cross.t * (3 - 2 * cross.t);
      ground = [
        cross.start[0] + cross.fwd[0] * CROSS_DIST * e,
        cross.start[1] + cross.fwd[1] * CROSS_DIST * e,
      ];
      material.uniforms.mapB!.value = texture(cross.to);
      material.uniforms.uFrontB!.value = cross.uFront;
      material.uniforms.wallB!.value = tourScale(TOUR_ROOMS[cross.to]).wall;
      material.uniforms.offB!.value.set(
        cross.fwd[0] * CROSS_DIST * (e - 1),
        0,
        cross.fwd[1] * CROSS_DIST * (e - 1)
      );
      material.uniforms.mixB!.value = e;
      if (cross.t >= 1) {
        crossRef.current = null;
        arrivedRef.current = { room: cross.to, uFront: cross.uFront };
        groundRef.current = [0, 0];
        material.uniforms.mixB!.value = 0;
        onArrive(cross.to, cross.uFront);
        // Next frame shows the new place at its photo spot.
        material.uniforms.mapA!.value = texture(cross.to);
        material.uniforms.uFrontA!.value = cross.uFront;
        material.uniforms.wallA!.value = tourScale(TOUR_ROOMS[cross.to]).wall;
        material.uniforms.offA!.value.set(0, 0, 0);
        return;
      }
    } else if (pending && !arrivedRef.current) {
      // Going to a place: walk to its arrow, then through it once the next photo is loaded.
      const i = arrows.findIndex((a) => a.to === pending);
      const target: Ground =
        i >= 0 ? [bases[i]![0] - TOUR_EYE[0], bases[i]![2] - TOUR_EYE[2]] : head;
      const dx = target[0] - (ground[0] + head[0]);
      const dz = target[1] - (ground[1] + head[1]);
      const dist = Math.hypot(dx, dz);
      if (dist > TOUR_ARROW_REACH) {
        const step = Math.min(dist, TOUR_WALK_SPEED * delta);
        ground = [ground[0] + (dx / dist) * step, ground[1] + (dz / dist) * step];
      } else if (texture(pending).image) {
        const fwd: Ground =
          dist > 1e-3 ? [dx / dist, dz / dist] : [Math.sin(headYaw), -Math.cos(headYaw)];
        crossRef.current = {
          to: pending,
          uFront: uFrontFacing(entryU(TOUR_ROOMS[pending], shownRoom), headYaw),
          start: ground,
          fwd,
          t: 0,
        };
      }
    } else if (!arrivedRef.current) {
      // Free walking: keys (unless the emulator owns them) and thumbsticks.
      const axes: WalkAxes =
        typeof document !== 'undefined' && document.pointerLockElement
          ? { forward: 0, strafe: 0 }
          : keyWalkAxes(heldRef.current);
      for (const source of session?.inputSources ?? []) {
        const stick = stickWalkAxes(source.gamepad?.axes);
        axes.forward += stick.forward;
        axes.strafe += stick.strafe;
      }
      ground = stepWalk(ground, axes, headYaw, delta, scale.walk);
      const onArrow = arrowAt(arrows, [ground[0] + head[0], ground[1] + head[1]]);
      if (onArrow) onWalk(onArrow.to);
    }
    groundRef.current = ground;

    // Step feel: bob (off a real headset) and a comfort vignette, from the walking speed.
    const motion = motionRef.current;
    const speed = Math.hypot(ground[0] - before[0], ground[1] - before[1]) / Math.max(delta, 1e-3);
    motion.speed += (speed - motion.speed) * Math.min(1, delta * 10);
    const moving = Math.min(1, motion.speed / TOUR_WALK_SPEED);
    motion.phase += delta * Math.PI * 2 * STEPS_PER_SECOND * moving;
    const bob = realHeadset ? 0 : BOB_AMPLITUDE * Math.abs(Math.sin(motion.phase)) * moving;
    material.uniforms.vignette!.value = moving * (realHeadset ? 0.7 : 0.4);

    // Arrows stay on the photo's floor: move them against the walk (the input controller reads
    // the same positions to aim at them).
    arrows.forEach((a, i) => {
      const b = bases[i];
      if (!b) return;
      a.position[0] = b[0] - ground[0];
      a.position[2] = b[2] - ground[1];
    });
    const group = arrowsGroupRef.current;
    if (group instanceof THREE.Object3D) {
      group.position.set(-ground[0], -bob, -ground[1]);
      group.visible = !crossRef.current;
    }

    if (current.image) fadeRef.current = Math.max(0, fadeRef.current - delta / FADE_IN);
    material.uniforms.mapA!.value = current;
    material.uniforms.uFrontA!.value = shownU;
    material.uniforms.wallA!.value = scale.wall;
    material.uniforms.offA!.value.set(ground[0], bob, ground[1]);
    if (!crossRef.current) material.uniforms.mixB!.value = 0;
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
      <group ref={arrowsGroupRef}>
        {arrows.map((a, i) => (
          <TourArrowMark
            key={a.id}
            arrow={a}
            position={bases[i] ?? a.position}
            hovered={hoveredId === a.id}
            label={t('tourGoTo', { room: t(`tourRoom_${a.to}`) })}
          />
        ))}
      </group>
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
  position,
  hovered,
  label,
}: {
  arrow: TourArrow;
  /** Spot on the photo's floor (the parent group follows the walk). */
  position: Vec3;
  hovered: boolean;
  label: string;
}) {
  const labelTex = useMemo(() => getPillLabelTexture(label, hovered, 512), [label, hovered]);
  const color = hovered ? '#c084fc' : '#e0f2fe';
  return (
    <group position={position} name={`tour-arrow-${arrow.to}`}>
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
