'use client';

import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import {
  createMenuPose,
  menuPointToWorld,
  menuSpawnScale,
  placeWristButton,
  updateLazyFollow,
  WRIST_BUTTON_RADIUS,
  yawOfDirection,
  type WristMenu,
  type WristXR,
} from './wrist-menu';
import { getWristIconTexture, getWristLabelTexture } from './wrist-menu-texture';

// Frame-loop scratch objects (no allocation per frame).
const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

export interface WristMenuButtonProps {
  menu: WristMenu;
  open: boolean;
  hovered?: boolean;
  /** A new event (connected, disconnected…) arrived while the menu is closed: pulse. */
  alert?: boolean;
}

/**
 * Small button worn on the left wrist (hand tracking: `wrist` joint; controllers: left grip).
 * Desktop / no left input: bottom-left of the view. Pressed through XRBlasterController
 * (other hand's fingertip, laser, pinch or mouse), never by an R3F onClick.
 */
export const WristMenuButton = memo(function WristMenuButton({
  menu,
  open,
  hovered = false,
  alert = false,
}: WristMenuButtonProps) {
  const t = useTranslations('features.visionInsert');
  const { gl, camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const handednessRef = useRef<[string | null, string | null]>([null, null]);

  // Which input is the left one: from the XR `connected` events (data = XRInputSource).
  useEffect(() => {
    const xr = gl?.xr as unknown as
      { getController?: (i: number) => THREE.XRTargetRaySpace } | undefined;
    if (!xr?.getController) return;
    const offs: Array<() => void> = [];
    for (const i of [0, 1] as const) {
      const space = xr.getController(i);
      const onConnected = (e: { data?: XRInputSource }) => {
        handednessRef.current[i] = e.data?.handedness ?? null;
      };
      const onDisconnected = () => {
        handednessRef.current[i] = null;
      };
      space.addEventListener('connected', onConnected);
      space.addEventListener('disconnected', onDisconnected);
      offs.push(() => {
        space.removeEventListener('connected', onConnected);
        space.removeEventListener('disconnected', onDisconnected);
      });
    }
    return () => offs.forEach((off) => off());
  }, [gl]);

  const icon = useMemo(() => getWristIconTexture(open), [open]);
  const label = useMemo(
    () => getWristLabelTexture(open ? t('vrWristMenuClose') : t('vrWristMenuOpen'), open),
    [open, t]
  );

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const wearer = placeWristButton(
      gl?.xr as unknown as WristXR | undefined,
      handednessRef.current,
      camera,
      _v
    );
    menu.button.copy(_v);
    menu.buttonVisible = true;
    menu.wearer = wearer;

    if (g.parent) g.parent.worldToLocal(_v);
    g.position.copy(_v);
    camera.getWorldPosition(_eye);
    g.lookAt(_eye);
    g.scale.setScalar(hovered ? 1.18 : 1);

    if (ringRef.current) {
      const pulse = alert ? 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 8) : 0;
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = hovered
        ? 0.95
        : 0.55 + pulse * 0.4;
    }
  });

  useEffect(
    () => () => {
      menu.buttonVisible = false;
      menu.wearer = null;
    },
    [menu]
  );

  const accent = open ? '#c084fc' : alert ? '#f59e0b' : '#38bdf8';

  return (
    <group ref={groupRef} name="wrist-menu-button">
      <mesh>
        <circleGeometry args={[WRIST_BUTTON_RADIUS, 32]} />
        <meshBasicMaterial map={icon} toneMapped={false} transparent />
      </mesh>
      <mesh ref={ringRef} position={[0, 0, -0.001]}>
        <ringGeometry args={[WRIST_BUTTON_RADIUS, WRIST_BUTTON_RADIUS * 1.35, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <mesh position={[0, WRIST_BUTTON_RADIUS * 2.1, 0]}>
        <planeGeometry args={[0.08, 0.02]} />
        <meshBasicMaterial map={label} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
});

export interface WristMenuPanelProps {
  menu: WristMenu;
  /** Local position of the scan button inside the panel (its world position goes to `menu.scan`). */
  scanOffset?: [number, number, number];
  children: ReactNode;
}

/**
 * The opened menu: world-locked in front of the viewer, below eye level, lazy-following
 * (stays still, re-centres when the viewer turns or walks away). Fades/scales in on open.
 */
export const WristMenuPanel = memo(function WristMenuPanel({
  menu,
  scanOffset = [0, 0, 0],
  children,
}: WristMenuPanelProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const pose = useMemo(() => createMenuPose(), []);
  const ageRef = useRef(-1);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    const yaw = yawOfDirection(_dir.x, _dir.z);
    const first = ageRef.current < 0;
    ageRef.current = first ? 0 : ageRef.current + delta;
    updateLazyFollow(pose, _eye.x, _eye.y, _eye.z, yaw, delta, first);

    const scale = menuSpawnScale(ageRef.current);
    menuPointToWorld(pose, scale, scanOffset, menu.scan);

    _v.set(pose.x, pose.y, pose.z);
    if (g.parent) g.parent.worldToLocal(_v);
    g.position.copy(_v);
    g.rotation.set(0, -pose.yaw, 0);
    g.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} name="wrist-menu-panel">
      {children}
    </group>
  );
});
