'use client';

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SectorCap, SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { fmtKw, fmtPct } from '@/lib/format';
import { holoCardTexture, HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import type { BuildingSceneModel } from '../types';
import type { SectorPowerAction } from '../utils/sector-power';
import { POWER_STEP_KW } from '../utils/sector-power';
import { BTN_H, BTN_W, HoloButton, useOpenInFront, type PanelButton } from './sim-xr-holo';

/** Panel size (m): info card on top, two rows of buttons under it. */
const PANEL_W = 1.0;
const INFO_H = 0.46;
const BTN_GAP = 0.035;

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
  const group = useRef<THREE.Group>(null);

  // Opens facing the walker (yaw only), placed once per sector: it does not follow the head.
  useOpenInFront(group, sector, pose);

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
