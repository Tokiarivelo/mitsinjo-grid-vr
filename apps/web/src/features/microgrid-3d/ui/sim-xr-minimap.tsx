'use client';

import { memo, useMemo, useRef } from 'react';
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
import {
  BIG_MAP_RADIUS,
  bigMapPoint,
  headingAngle,
  horizontalHeading,
  MAP_PIN_RADIUS,
  MAP_PINS,
  MAP_TILT,
  MINI_MAP_OFFSET,
  MINI_MAP_RADIUS,
  miniMapPoint,
  pinTone,
  type MapPinId,
} from '../utils/sim-xr-minimap';
import { HoloButton, useOpenInFront } from './sim-xr-holo';

/** Frame-loop scratch (no allocation per frame). */
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _uv: [number, number] = [0, 0];
const _f: [number, number] = [0, -1];
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const TONES = {
  green: HOLO.green,
  amber: HOLO.amber,
  red: HOLO.red,
  cyan: HOLO.cyan,
  violet: HOLO.violet,
} as const;

/** Shared geometries: one disc, one ring, one arrow for every map. */
const discGeo = new THREE.CircleGeometry(1, 48);
const ringGeo = new THREE.RingGeometry(0.94, 1, 64);
const arrowGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 1);
  s.lineTo(0.7, -0.8);
  s.lineTo(0, -0.4);
  s.lineTo(-0.7, -0.8);
  s.closePath();
  return new THREE.ShapeGeometry(s);
})();

function toneOf(id: MapPinId, buildings: Record<SectorId, BuildingSceneModel>): string {
  return TONES[pinTone(id === 'dispatcher' ? 'dispatcher' : buildings[id].statusColor)];
}

/**
 * Map surface: a dark glass disc with a cyan rim (drawn over the scene). Everything on it is
 * `transparent` too: opaque meshes are drawn before transparent ones whatever their renderOrder,
 * so the glass would cover them.
 */
function MapDisc({ radius }: { radius: number }) {
  return (
    <>
      <mesh geometry={discGeo} scale={radius} renderOrder={40}>
        <meshBasicMaterial
          color={HOLO.dome}
          transparent
          opacity={0.78}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={ringGeo} scale={radius} renderOrder={41}>
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.9}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

function Dot({ radius, color, order = 42 }: { radius: number; color: string; order?: number }) {
  return (
    <mesh geometry={discGeo} scale={radius} renderOrder={order}>
      <meshBasicMaterial
        color={color}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function Arrow({ size, order = 45 }: { size: number; order?: number }) {
  return (
    <mesh geometry={arrowGeo} scale={size} renderOrder={order}>
      <meshBasicMaterial
        color={HOLO.ink}
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
 * GTA-like map of the /simulation VR village (VS-T37): a small heading-up disc low on the right
 * of the view (lazy-follows the walker, never head-locked) shows where you are; a trigger on it
 * opens the big hologram map in front, where a building or the dispatcher opens its controls.
 */
export const SimXrMinimap = memo(function SimXrMinimap(props: SimXrMinimapProps) {
  return props.open ? <BigMap {...props} /> : <MiniMap {...props} />;
});

const MiniMap = memo(function MiniMap({ buildings, onOpen }: SimXrMinimapProps) {
  const t = useTranslations('features.simulation.vrMap');
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const pins = useRef<Array<THREE.Object3D | null>>([]);
  const pose = useMemo(() => createMenuPose(), []);
  const age = useRef(-1);
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

  useFrame((_, delta) => {
    const g = group.current;
    const rig = camera.parent;
    if (!g || !rig) return;
    // Lazy follow in the rig's space (felt metres: the rig carries the half-scale, VS-T33).
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
    menuPointToWorld(pose, 1, MINI_MAP_OFFSET, _local);
    rig.updateMatrixWorld();
    _local.applyMatrix4(rig.matrixWorld);
    rig.matrixWorld.decompose(_head, _q, _scale);
    _qYaw.setFromAxisAngle(UP, -pose.yaw);
    _qTilt.setFromAxisAngle(RIGHT, MAP_TILT * 0.6);
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

    // Blips: heading-up around the walker (world position and horizontal heading).
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir);
    horizontalHeading(_dir.x, _dir.z, _f);
    MAP_PINS.forEach((p, i) => {
      const o = pins.current[i];
      if (!o) return;
      miniMapPoint(_head.x, _head.z, _f[0], _f[1], p.x, p.z, _uv);
      o.position.set(_uv[0], _uv[1], 0.002);
    });
  });

  return (
    <group ref={group} name="sim-xr-minimap">
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
      <MapDisc radius={MINI_MAP_RADIUS} />
      {MAP_PINS.map((p, i) => (
        <group
          key={p.id}
          ref={(o) => {
            pins.current[i] = o;
          }}
        >
          <Dot radius={p.id === 'dispatcher' ? 0.011 : 0.01} color={toneOf(p.id, buildings)} />
        </group>
      ))}
      <group position={[0, 0, 0.003]}>
        <Arrow size={0.016} />
      </group>
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
    </group>
  );
});

const BigMap = memo(function BigMap({ buildings, onClose, onSelect }: SimXrMinimapProps) {
  const t = useTranslations('features.simulation.vrMap');
  const tPanel = useTranslations('features.simulation.vrSector');
  const tSectors = useTranslations('sectors');
  const tTags = useTranslations('features.simulation.villageTags');
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const you = useRef<THREE.Group>(null);
  const youArrow = useRef<THREE.Group>(null);
  // Opens once in front of the walker, sized with the rig (does not follow the head).
  useOpenInFront(group, 'map');

  const header = useMemo(
    () =>
      holoCardTexture({
        width: 1024,
        height: 240,
        align: 'center',
        accent: HOLO.cyan,
        lines: [
          { text: t('title'), size: 64, weight: 700, color: HOLO.cyan },
          { text: t('hint'), size: 30, weight: 400 },
        ],
      }),
    [t]
  );
  const labels = useMemo(
    () =>
      MAP_PINS.map((p) =>
        holoCardTexture({
          width: 384,
          height: 96,
          align: 'center',
          lines: [
            {
              text: p.id === 'dispatcher' ? tTags('controllerTitle') : tSectors(p.id),
              size: 40,
              weight: 700,
              color: toneOf(p.id, buildings),
            },
          ],
        })
      ),
    [tSectors, tTags, buildings]
  );
  const youLabel = useMemo(
    () =>
      holoCardTexture({
        width: 192,
        height: 64,
        align: 'center',
        glass: false,
        lines: [{ text: t('you'), size: 36, weight: 700, color: HOLO.ink }],
      }),
    [t]
  );

  useFrame(() => {
    const y = you.current;
    const a = youArrow.current;
    if (!y || !a) return;
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir);
    horizontalHeading(_dir.x, _dir.z, _f);
    bigMapPoint(_head.x, _head.z, _uv);
    y.position.set(_uv[0], _uv[1], 0.004);
    a.rotation.set(0, 0, headingAngle(_f[0], _f[1]));
  });

  return (
    <group ref={group} name="sim-xr-bigmap">
      <mesh position={[0, 0.2, 0]} renderOrder={40}>
        <planeGeometry args={[0.9, 0.211]} />
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
        position={[0.36, 0.36, 0.002]}
        size={[0.2, 0.08]}
      />
      <group position={[0, -0.12, 0]} rotation={[MAP_TILT, 0, 0]}>
        <MapDisc radius={BIG_MAP_RADIUS} />
        {MAP_PINS.map((p, i) => {
          const [u, v] = bigMapPoint(p.x, p.z, [0, 0]);
          const select = () => onSelect(p.id);
          return (
            <group key={p.id} position={[u, v, 0.002]}>
              <mesh
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
                <meshBasicMaterial
                  color={toneOf(p.id, buildings)}
                  transparent
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
              <mesh position={[0, MAP_PIN_RADIUS + 0.035, 0.001]} renderOrder={44}>
                <planeGeometry args={[0.24, 0.06]} />
                <meshBasicMaterial
                  map={labels[i]}
                  transparent
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            </group>
          );
        })}
        <group ref={you}>
          <group ref={youArrow}>
            <Arrow size={0.03} order={46} />
          </group>
          <mesh position={[0, -0.045, 0]} renderOrder={46}>
            <planeGeometry args={[0.09, 0.03]} />
            <meshBasicMaterial
              map={youLabel}
              transparent
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
});
