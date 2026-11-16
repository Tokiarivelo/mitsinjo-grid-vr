'use client';

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { SectorCap, SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { fmtKw, fmtPct } from '@/lib/format';
import { holoCardTexture, HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import type { BuildingSceneModel } from '../types';
import type { SectorPowerAction } from '../utils/sector-power';
import { POWER_STEP_KW } from '../utils/sector-power';

/** Panel size (m): info card on top, two rows of buttons under it. */
const PANEL_W = 1.0;
const INFO_H = 0.46;
const BTN_W = 0.31;
const BTN_H = 0.1;
const BTN_GAP = 0.035;
/** Where the panel opens in front of the walker (m ahead, m below the eyes). */
const AHEAD = 1.2;
const BELOW_EYES = 0.18;

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();

interface PanelButton {
  id: string;
  label: string;
  onPress: () => void;
  tone?: string;
  disabled?: boolean;
}

/** One holographic button: tap with the trigger, a pinch or the mouse (xr-hands raycast). */
const HoloButton = memo(function HoloButton({
  button,
  position,
}: {
  button: PanelButton;
  position: [number, number, number];
}) {
  const [hover, setHover] = useState(false);
  const tone = button.disabled ? HOLO.ink : (button.tone ?? HOLO.cyan);
  const map = useMemo(
    () =>
      holoCardTexture({
        width: 512,
        height: 166,
        align: 'center',
        accent: tone,
        lines: [{ text: button.label, size: 54, weight: 700, color: tone }],
      }),
    [button.label, tone]
  );
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
      <planeGeometry args={[BTN_W, BTN_H]} />
      <meshBasicMaterial
        map={map}
        transparent
        opacity={button.disabled ? 0.45 : 1}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
});

export interface SimXrSectorPanelProps {
  sector: SectorId;
  building: BuildingSceneModel;
  cap: SectorCap | null;
  /** Inside the building's room: « Go outside » instead of « Enter », no close button. */
  inside: boolean;
  /** The last action was refused (village constitution). */
  refused: boolean;
  canUndo: boolean;
  /** Fixed pose (room wall); omitted = opens in front of the walker. */
  pose?: { position: [number, number, number]; yaw: number };
  onPower: (action: SectorPowerAction) => void;
  onEnter: () => void;
  onDoor: () => void;
  onExit: () => void;
  onUndo: () => void;
  onClose: () => void;
}

/**
 * The building's power panel in VR (VSIM-T3): what the engine serves it now, its limit, and
 * « − / + 0.5 kW », « Cut all » / « Restore », « Enter » / « Go to the door », « Undo ». Each action
 * re-runs the engine; the panel only shows engine numbers (SIMULATED DATA).
 */
export const SimXrSectorPanel = memo(function SimXrSectorPanel({
  sector,
  building,
  cap,
  inside,
  refused,
  canUndo,
  pose,
  onPower,
  onEnter,
  onDoor,
  onExit,
  onUndo,
  onClose,
}: SimXrSectorPanelProps) {
  const t = useTranslations('features.simulation.vrSector');
  const tSectors = useTranslations('sectors');
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);

  // Opens facing the walker (yaw only), placed once per sector: it does not follow the head.
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    if (pose) {
      g.position.set(...pose.position);
      g.rotation.set(0, pose.yaw, 0);
      g.scale.setScalar(1);
      return;
    }
    // Same size and reach as felt when the walker is shrunk for the half-scale village (VS-T33).
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
  }, [sector, pose, camera]);

  const cut = cap?.maxKw === 0;
  const info = useMemo(
    () =>
      holoCardTexture({
        width: 1024,
        height: 470,
        align: 'left',
        accent: HOLO.cyan,
        lines: [
          { text: tSectors(sector), size: 66, weight: 700, color: HOLO.cyan },
          { text: t('simulated'), size: 30, weight: 600, color: HOLO.amber },
          {
            text: t('served', {
              served: fmtKw(building.servedKw),
              demand: fmtKw(building.demandKw),
            }),
            size: 46,
            weight: 600,
          },
          { text: t('coverage', { pct: fmtPct(building.coveragePct, 0) }), size: 42 },
          {
            text: cap
              ? cut
                ? t('capCut', { from: cap.fromHour })
                : t('capActive', { kw: fmtKw(cap.maxKw), from: cap.fromHour })
              : t('capNone'),
            size: 42,
            color: cap ? HOLO.amber : HOLO.ink,
          },
          ...(refused ? [{ text: t('refusedClinic'), size: 38, color: HOLO.red }] : []),
        ],
      }),
    [t, tSectors, sector, building, cap, cut, refused]
  );

  const step = fmtKw(POWER_STEP_KW);
  const row1: PanelButton[] = [
    { id: 'less', label: t('less', { step }), onPress: () => onPower('less') },
    { id: 'more', label: t('more', { step }), onPress: () => onPower('more'), disabled: !cap },
    cap
      ? { id: 'restore', label: t('restore'), onPress: () => onPower('restore'), tone: HOLO.green }
      : { id: 'cut', label: t('cut'), onPress: () => onPower('cut'), tone: HOLO.red },
  ];
  const row2: PanelButton[] = inside
    ? [
        { id: 'exit', label: t('exit'), onPress: onExit, tone: HOLO.amber },
        { id: 'undo', label: t('undo'), onPress: onUndo, disabled: !canUndo },
      ]
    : [
        { id: 'enter', label: t('enter'), onPress: onEnter, tone: HOLO.amber },
        { id: 'door', label: t('door'), onPress: onDoor },
        { id: 'undo', label: t('undo'), onPress: onUndo, disabled: !canUndo },
      ];
  const rowY = (r: number) => -INFO_H / 2 - BTN_GAP - BTN_H / 2 - r * (BTN_H + BTN_GAP);
  const colX = (i: number, n: number) => (i - (n - 1) / 2) * (BTN_W + BTN_GAP);

  return (
    <group ref={group} name="sim-xr-panel">
      <mesh renderOrder={30}>
        <planeGeometry args={[PANEL_W, INFO_H]} />
        <meshBasicMaterial
          map={info}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {row1.map((b, i) => (
        <HoloButton key={b.id} button={b} position={[colX(i, row1.length), rowY(0), 0.002]} />
      ))}
      {row2.map((b, i) => (
        <HoloButton key={b.id} button={b} position={[colX(i, row2.length), rowY(1), 0.002]} />
      ))}
      {!inside && (
        <HoloButton
          button={{ id: 'close', label: t('close'), onPress: onClose }}
          position={[PANEL_W / 2 - BTN_W / 2, INFO_H / 2 + BTN_GAP + BTN_H / 2, 0.002]}
        />
      )}
    </group>
  );
});
