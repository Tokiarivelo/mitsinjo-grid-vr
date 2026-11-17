'use client';

import { memo, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { holoCardTexture, HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import { holoIconTexture, type HoloIcon } from '@/features/vision-insert/ui/xr/holo-icons';

/**
 * Shared pieces of the /simulation VR panels (VSIM-T3 sector panel, VS-T34 dispatcher desk):
 * a holographic button and the « opens in front of the walker » placement.
 */

/** Default button size (m). */
export const BTN_W = 0.31;
export const BTN_H = 0.1;
/** Where a panel opens in front of the walker (m ahead, m below the eyes, as felt). */
const AHEAD = 1.2;
const BELOW_EYES = 0.18;

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();

export interface PanelButton {
  id: string;
  label: string;
  onPress: () => void;
  tone?: string;
  disabled?: boolean;
  /** Icon-only button: the line icon centred, the label kept as the mesh's accessible name. */
  icon?: HoloIcon;
}

/** One holographic button: tap with the trigger, a pinch or the mouse (xr-hands raycast). */
export const HoloButton = memo(function HoloButton({
  button,
  position,
  size = [BTN_W, BTN_H],
}: {
  button: PanelButton;
  position: [number, number, number];
  /** Width, height (m); the label texture keeps its aspect. */
  size?: [number, number];
}) {
  const [hover, setHover] = useState(false);
  const tone = button.disabled ? HOLO.ink : (button.tone ?? HOLO.cyan);
  const [w, h] = size;
  const map = useMemo(
    () =>
      holoCardTexture({
        width: 512,
        height: Math.round((512 * h) / w),
        align: 'center',
        accent: tone,
        lines: button.icon
          ? []
          : [
              {
                text: button.label,
                size: Math.min(54, Math.round((512 * h) / w) * 0.33),
                weight: 700,
                color: tone,
              },
            ],
      }),
    [button.label, button.icon, tone, w, h]
  );
  const iconMap = useMemo(
    () => (button.icon ? holoIconTexture(button.icon, tone) : null),
    [button.icon, tone]
  );
  const iconSize = Math.min(w, h) * 0.62;
  const press = () => {
    if (!button.disabled) button.onPress();
  };
  return (
    <mesh
      name={`sim-xr-button-${button.id}`}
      position={position}
      scale={hover && !button.disabled ? 1.06 : 1}
      renderOrder={31}
      userData={{ onSelect: press, xrUi: true }}
      onClick={(e) => {
        e.stopPropagation();
        press();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial
        map={map}
        transparent
        opacity={button.disabled ? 0.45 : 1}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
      {iconMap && (
        <mesh position={[0, 0, 0.002]} renderOrder={32} raycast={() => null}>
          <planeGeometry args={[iconSize, iconSize]} />
          <meshBasicMaterial
            map={iconMap}
            transparent
            opacity={button.disabled ? 0.45 : 1}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </mesh>
  );
});

/**
 * Places `group` once per `key`: on `pose` (a room wall) when given, else in front of the walker
 * facing them (yaw only, it does not follow the head), sized with the walker's rig scale (VS-T33).
 */
export function useOpenInFront(
  group: RefObject<THREE.Group | null>,
  key: unknown,
  pose?: { position: [number, number, number]; yaw: number }
): void {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    if (pose) {
      g.position.set(...pose.position);
      g.rotation.set(0, pose.yaw, 0);
      g.scale.setScalar(1);
      return;
    }
    const s = camera.parent?.scale.x ?? 1;
    g.scale.setScalar(s);
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize();
    g.position.set(
      _head.x + _dir.x * AHEAD * s,
      _head.y - BELOW_EYES * s,
      _head.z + _dir.z * AHEAD * s
    );
    g.rotation.set(0, Math.atan2(-_dir.x, -_dir.z), 0);
  }, [group, key, pose, camera]);
}
