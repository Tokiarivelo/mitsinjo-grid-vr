'use client';

import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { holoCardTexture, HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import {
  createMenuPose,
  menuPointToWorld,
  updateLazyFollow,
  yawOfDirection,
} from '@/features/vision-insert/ui/xr/wrist-menu';
import type { BuildingSceneModel } from '../types';
import { drawVillageMap } from '../utils/sim-xr-map-draw';
import {
  BIG_MAP_OFFSET,
  BIG_MAP_PX,
  BIG_MAP_RADIUS,
  BIG_MAP_RANGE,
  BIG_MAP_TILT,
  headingAngle,
  horizontalHeading,
  MAP_PIN_RADIUS,
  MAP_PINS,
  MAP_TILT,
  mapTransform,
  MINI_MAP_OFFSET,
  MINI_MAP_PX,
  MINI_MAP_RADIUS,
  MINI_MAP_RANGE,
  pinTone,
  type MapPinId,
} from '../utils/sim-xr-minimap';
import { HoloButton } from './sim-xr-holo';

/** Frame-loop scratch (no allocation per frame). */
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _local = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _f: [number, number] = [0, -1];
const _t: number[] = [0, 0, 0, 0, 0, 0];
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
/** Redraw the map once the walker moved this far (units) or turned this much (rad). */
const REDRAW_MOVE = 0.02;
const REDRAW_TURN = 0.01;

const TONES = {
  green: HOLO.green,
  amber: HOLO.amber,
  red: HOLO.red,
  cyan: HOLO.cyan,
  violet: HOLO.violet,
} as const;

const discGeo = new THREE.CircleGeometry(1, 64);

function toneOf(id: MapPinId, buildings: Record<SectorId, BuildingSceneModel>): string {
  return TONES[pinTone(id === 'dispatcher' ? 'dispatcher' : buildings[id].statusColor)];
}

/**
 * Lazy-follows the walker in the camera rig's space (felt metres: the rig carries the half-scale
 * village, VS-T33): still while you look around, re-centred when you turn away or walk off. Never
 * head-locked (Meta comfort). `tilt` leans it back toward the eyes.
 */
export function RigFollow({
  offset,
  tilt,
  name,
  children,
}: {
  offset: [number, number, number];
  tilt: number;
  name: string;
  children: ReactNode;
}) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const pose = useMemo(() => createMenuPose(), []);
  const age = useRef(-1);
  useFrame((_, delta) => {
    const g = group.current;
    const rig = camera.parent;
    if (!g || !rig) return;
    // Head heading in the rig's space (camera.quaternion is local to the rig).
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const first = age.current < 0;
    age.current = first ? 0 : age.current + delta;
    updateLazyFollow(
      pose,
      camera.position.x,
      camera.position.y,
      camera.position.z,
      yawOfDirection(_dir.x, _dir.z),
      delta,
      first
    );
    menuPointToWorld(pose, 1, offset, _local);
    rig.updateMatrixWorld();
    _local.applyMatrix4(rig.matrixWorld);
    rig.matrixWorld.decompose(_pos, _q, _scale);
    _qYaw.setFromAxisAngle(UP, -pose.yaw);
    _qTilt.setFromAxisAngle(RIGHT, tilt);
    _q.multiply(_qYaw).multiply(_qTilt);
    if (g.parent) {
      g.parent.updateMatrixWorld();
      g.parent.worldToLocal(_local);
      g.parent.getWorldQuaternion(_qParent);
      _q.premultiply(_qParent.invert());
    }
    g.position.copy(_local);
    g.quaternion.copy(_q);
    g.scale.setScalar(_scale.x);
  });
  return (
    <group ref={group} name={name}>
      {children}
    </group>
  );
}

/** Draws the map into its canvas and flags the texture for upload (frame loop). */
function paintMap(
  texture: THREE.Texture,
  ctx: CanvasRenderingContext2D,
  options: Parameters<typeof drawVillageMap>[1]
): void {
  drawVillageMap(ctx, options);
  texture.needsUpdate = true;
}

/**
 * The map disc: a canvas (roads, water, buildings, names, walker arrow) redrawn when the walker
 * moves or turns. Mini: heading-up. Big: north-up, its arrow turns with the head (VS-T38).
 */
function MapSurface({
  size,
  radius,
  range,
  headingUp,
  buildings,
  names,
  you,
  pinHits,
}: {
  size: number;
  radius: number;
  range: number;
  headingUp: boolean;
  buildings: Record<SectorId, BuildingSceneModel>;
  names?: (id: MapPinId) => string;
  you?: string;
  /** Hit meshes to keep on their pins (big map), by MAP_PINS index. */
  pinHits?: { current: Array<THREE.Object3D | null> };
}) {
  const camera = useThree((s) => s.camera);
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { ctx: canvas.getContext('2d'), texture };
  }, [size]);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  // Anything that changes the drawing besides the walker (statuses, names) forces a redraw.
  const tone = useMemo(() => (id: MapPinId) => toneOf(id, buildings), [buildings]);
  const last = useRef<{
    x: number;
    z: number;
    a: number;
    tone: unknown;
    names: unknown;
  }>({ x: NaN, z: NaN, a: NaN, tone: null, names: null });

  useFrame(() => {
    const ctx = surface.ctx;
    if (!ctx) return;
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir);
    horizontalHeading(_dir.x, _dir.z, _f);
    const a = headingAngle(_f[0], _f[1]);
    const l = last.current;
    const moved =
      !(Math.abs(_head.x - l.x) < REDRAW_MOVE && Math.abs(_head.z - l.z) < REDRAW_MOVE) ||
      !(Math.abs(a - l.a) < REDRAW_TURN) ||
      l.tone !== tone ||
      l.names !== names;
    if (!moved) return;
    l.x = _head.x;
    l.z = _head.z;
    l.a = a;
    l.tone = tone;
    l.names = names;
    if (headingUp) mapTransform(_head.x, _head.z, _f[0], _f[1], size, range, _t);
    else mapTransform(_head.x, _head.z, 0, -1, size, range, _t);
    paintMap(surface.texture, ctx, {
      size,
      transform: _t,
      tone,
      ...(names ? { names } : {}),
      ...(you ? { you } : {}),
      arrow: headingUp ? 0 : a,
    });
    // Pins' hit areas follow their drawing (canvas px → disc metres, on the rim past range).
    const c = size / 2;
    MAP_PINS.forEach((p, i) => {
      const o = pinHits?.current[i];
      if (!o) return;
      let u = (_t[0]! * p.x + _t[2]! * p.z + _t[4]! - c) / c;
      let v = -(_t[1]! * p.x + _t[3]! * p.z + _t[5]! - c) / c;
      const r = Math.hypot(u, v);
      if (r > 0.94) {
        u *= 0.94 / r;
        v *= 0.94 / r;
      }
      o.position.set(u * radius, v * radius, 0.003);
    });
  });

  return (
    <mesh geometry={discGeo} scale={radius} renderOrder={40}>
      <meshBasicMaterial
        map={surface.texture}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface SimXrMinimapProps {
  buildings: Record<SectorId, BuildingSceneModel>;
  /** The big hologram map is open (the mini one hides meanwhile). */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** A pin of the big map: a sector's power panel or the dispatcher's mixing desk. */
  onSelect: (id: MapPinId) => void;
}

/**
 * GTA-like map of the /simulation VR village (VS-T37, VS-T38): a small heading-up disc on the far
 * right of the view shows where you are; a trigger on it opens the big hologram map in front,
 * which walks with you, centred on you, roads, paths and water drawn; a building or the dispatcher
 * on it opens its controls.
 */
export const SimXrMinimap = memo(function SimXrMinimap(props: SimXrMinimapProps) {
  return props.open ? <BigMap {...props} /> : <MiniMap {...props} />;
});

const MiniMap = memo(function MiniMap({ buildings, onOpen }: SimXrMinimapProps) {
  const t = useTranslations('features.simulation.vrMap');
  const caption = useMemo(
    () =>
      holoCardTexture({
        width: 256,
        height: 64,
        align: 'center',
        glass: false,
        lines: [{ text: t('mini'), size: 44, weight: 700, color: HOLO.cyan }],
      }),
    [t]
  );
  return (
    <RigFollow offset={MINI_MAP_OFFSET} tilt={MAP_TILT} name="sim-xr-minimap">
      <mesh
        name="sim-xr-minimap-open"
        geometry={discGeo}
        scale={MINI_MAP_RADIUS * 1.05}
        renderOrder={39}
        userData={{ xrUi: true, onSelect: onOpen }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
      <MapSurface
        size={MINI_MAP_PX}
        radius={MINI_MAP_RADIUS}
        range={MINI_MAP_RANGE}
        headingUp
        buildings={buildings}
      />
      <mesh position={[0, -MINI_MAP_RADIUS - 0.03, 0]} renderOrder={42}>
        <planeGeometry args={[0.16, 0.04]} />
        <meshBasicMaterial
          map={caption}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </RigFollow>
  );
});

const BigMap = memo(function BigMap({ buildings, onClose, onSelect }: SimXrMinimapProps) {
  const t = useTranslations('features.simulation.vrMap');
  const tPanel = useTranslations('features.simulation.vrSector');
  const tSectors = useTranslations('sectors');
  const tTags = useTranslations('features.simulation.villageTags');
  const pinHits = useRef<Array<THREE.Object3D | null>>([]);
  const names = useMemo(
    () => (id: MapPinId) => (id === 'dispatcher' ? tTags('controllerTitle') : tSectors(id)),
    [tSectors, tTags]
  );
  const header = useMemo(
    () =>
      holoCardTexture({
        width: 1024,
        height: 200,
        align: 'center',
        accent: HOLO.cyan,
        lines: [
          { text: t('title'), size: 64, weight: 700, color: HOLO.cyan },
          { text: t('hint'), size: 32, weight: 600 },
        ],
      }),
    [t]
  );
  const top = BIG_MAP_RADIUS * Math.cos(BIG_MAP_TILT);

  return (
    <RigFollow offset={BIG_MAP_OFFSET} tilt={0} name="sim-xr-bigmap">
      <mesh position={[0, top + 0.13, 0]} renderOrder={40}>
        <planeGeometry args={[1.0, 0.195]} />
        <meshBasicMaterial
          map={header}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <HoloButton
        button={{ id: 'map-close', label: tPanel('close'), onPress: onClose }}
        position={[0.42, top + 0.29, 0.002]}
        size={[0.2, 0.08]}
      />
      <group rotation={[BIG_MAP_TILT, 0, 0]}>
        <MapSurface
          size={BIG_MAP_PX}
          radius={BIG_MAP_RADIUS}
          range={BIG_MAP_RANGE}
          headingUp={false}
          buildings={buildings}
          names={names}
          you={t('you')}
          pinHits={pinHits}
        />
        {MAP_PINS.map((p, i) => {
          const select = () => onSelect(p.id);
          return (
            <mesh
              key={p.id}
              ref={(o) => {
                pinHits.current[i] = o;
              }}
              name={`sim-xr-map-pin-${p.id}`}
              geometry={discGeo}
              scale={MAP_PIN_RADIUS}
              renderOrder={43}
              userData={{ xrUi: true, onSelect: select }}
              onClick={(e) => {
                e.stopPropagation();
                select();
              }}
            >
              <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
    </RigFollow>
  );
});
