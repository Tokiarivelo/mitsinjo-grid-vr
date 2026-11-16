'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SectorId } from '@mitsinjo/engine';
import { useTranslations } from '@/lib/i18n';
import { fmtKw, fmtPct } from '@/lib/format';
import { holoCardTexture, HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import type {
  MixerApplianceStrip,
  MixerBatteryStrip,
  MixerSectorStrip,
} from '../utils/dispatch-mixer';
import { BTN_H, BTN_W, HoloButton, useOpenInFront } from './sim-xr-holo';

/** Strip layout (m): name card, fader track, cut button, one strip per channel. */
const STRIP_W = 0.13;
const STRIP_GAP = 0.016;
const TRACK_H = 0.34;
const CARD_H = 0.13;
const CUT_H = 0.06;
const HEADER_H = 0.17;
/** Appliance strips shown; the others stay on the 2D panel. */
export const MAX_APPLIANCE_STRIPS = 6;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const knobY = (level: number) => -TRACK_H / 2 + clamp01(level) * TRACK_H;
/** Fader level under the laser: its local height on the track (centre = 0) → 0 bottom … 1 top. */
export const faderLevelAt = (localY: number) => clamp01((localY + TRACK_H / 2) / TRACK_H);

export interface SimXrDispatchPanelProps {
  battery: MixerBatteryStrip;
  hasResult: boolean;
  sectors: MixerSectorStrip[];
  appliances: MixerApplianceStrip[];
  refused: boolean;
  canUndo: boolean;
  onStart: () => void;
  onReserve: (level: number) => void;
  onSector: (sector: SectorId, level: number) => void;
  onSectorCut: (sector: SectorId, cut: boolean) => void;
  onAppliance: (id: string, level: number) => void;
  onUndo: () => void;
  onClose: () => void;
}

/**
 * One vertical fader (DJ style): hold the trigger on it and slide up or down, the knob and the
 * lit bar follow the laser (`userData.onDrag`, xr-hands); the release sends the level once
 * (`onCommit`), the engine re-runs. Mutates the meshes while dragging, no React state.
 */
const MixerFader = memo(function MixerFader({
  id,
  level,
  tone,
  disabled,
  onCommit,
}: {
  id: string;
  level: number;
  tone: string;
  disabled?: boolean;
  onCommit: (level: number) => void;
}) {
  const knob = useRef<THREE.Mesh>(null);
  const fill = useRef<THREE.Mesh>(null);
  const live = useRef(level);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  const show = (l: number) => {
    live.current = l;
    // `?.position`: only three.js objects move (a DOM test render has none).
    if (knob.current?.position) knob.current.position.y = knobY(l);
    if (fill.current?.position) {
      fill.current.scale.y = Math.max(1e-3, l);
      fill.current.position.y = -TRACK_H / 2 + (l * TRACK_H) / 2;
    }
  };
  useEffect(() => show(level));

  const userData = useMemo(
    () =>
      disabled
        ? { xrUi: true }
        : {
            xrUi: true,
            onDrag: (p: THREE.Vector3) => show(faderLevelAt(p.y)),
            onDragEnd: () => commit.current(live.current),
          },
    [disabled]
  );

  return (
    <group>
      {/* Hit area and slot: wider than it looks, so the laser keeps it while sliding. */}
      <mesh name={`sim-xr-fader-${id}`} renderOrder={30} userData={userData}>
        <planeGeometry args={[STRIP_W * 0.9, TRACK_H + 0.05]} />
        <meshBasicMaterial
          color={HOLO.pedestal}
          transparent
          opacity={0.55}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.001]} renderOrder={31}>
        <planeGeometry args={[0.008, TRACK_H]} />
        <meshBasicMaterial color={HOLO.gridDim} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh ref={fill} position={[0, 0, 0.0015]} renderOrder={31}>
        <planeGeometry args={[0.014, TRACK_H]} />
        <meshBasicMaterial
          color={tone}
          transparent
          opacity={disabled ? 0.3 : 0.85}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={knob} name={`sim-xr-knob-${id}`} position={[0, 0, 0.002]} renderOrder={32}>
        <planeGeometry args={[STRIP_W * 0.7, 0.028]} />
        <meshBasicMaterial
          color={disabled ? HOLO.gridDim : HOLO.ink}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});

/** Name card on top of a strip: name, then two short lines (engine values / setting). */
function StripCard({
  name,
  line1,
  line2,
  tone,
}: {
  name: string;
  line1: string;
  line2: string;
  tone: string;
}) {
  const map = useMemo(
    () =>
      holoCardTexture({
        width: 300,
        height: 300,
        align: 'center',
        accent: tone,
        lines: [
          { text: name, size: 40, weight: 700, color: tone },
          { text: line1, size: 32, weight: 600 },
          { text: line2, size: 30, weight: 600, color: HOLO.amber },
        ],
      }),
    [name, line1, line2, tone]
  );
  return (
    <mesh position={[0, TRACK_H / 2 + 0.035 + CARD_H / 2, 0.002]} renderOrder={31}>
      <planeGeometry args={[STRIP_W, CARD_H]} />
      <meshBasicMaterial
        map={map}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * The dispatcher's mixing desk in VR (VS-T34), opened from the dispatcher's label: a master strip
 * for the battery (start, reserve), one strip per sector (its kW limit, cut / on), one per appliance
 * wired straight to the dispatcher (added from /village, its level, cut / on). Shows engine numbers
 * only (SIMULATED DATA); every release or press is one undoable engine run.
 */
export const SimXrDispatchPanel = memo(function SimXrDispatchPanel({
  battery,
  hasResult,
  sectors,
  appliances,
  refused,
  canUndo,
  onStart,
  onReserve,
  onSector,
  onSectorCut,
  onAppliance,
  onUndo,
  onClose,
}: SimXrDispatchPanelProps) {
  const t = useTranslations('features.simulation.vrMixer');
  const tPanel = useTranslations('features.simulation.vrSector');
  const tSectors = useTranslations('sectors');
  const group = useRef<THREE.Group>(null);
  useOpenInFront(group, 'dispatch');

  const shownAppliances = appliances.slice(0, MAX_APPLIANCE_STRIPS);
  const hidden = appliances.length - shownAppliances.length;
  const strips = 1 + sectors.length + shownAppliances.length;
  const width = strips * STRIP_W + (strips - 1) * STRIP_GAP;
  const x = (i: number) => -width / 2 + STRIP_W / 2 + i * (STRIP_W + STRIP_GAP);
  const cutY = -TRACK_H / 2 - 0.035 - CUT_H / 2;
  const footY = cutY - CUT_H / 2 - 0.04 - BTN_H / 2;

  const header = useMemo(
    () =>
      holoCardTexture({
        width: 1400,
        height: 240,
        align: 'left',
        accent: HOLO.cyan,
        lines: [
          { text: t('title'), size: 56, weight: 700, color: HOLO.cyan },
          { text: tPanel('simulated'), size: 30, weight: 600, color: HOLO.amber },
          refused
            ? { text: tPanel('refusedClinic'), size: 32, weight: 600, color: HOLO.red }
            : { text: t('hint'), size: 30, weight: 400 },
          ...(hidden > 0
            ? [{ text: t('more', { count: hidden }), size: 28, color: HOLO.ink }]
            : []),
        ],
      }),
    [t, tPanel, refused, hidden]
  );
  const headerW = Math.max(width, 1.0);
  const headerY = TRACK_H / 2 + 0.035 + CARD_H + 0.03 + HEADER_H / 2;

  return (
    <group ref={group} name="sim-xr-dispatch-panel">
      <mesh position={[0, headerY, 0]} renderOrder={30}>
        <planeGeometry args={[headerW, HEADER_H]} />
        <meshBasicMaterial
          map={header}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <HoloButton
        button={{ id: 'mixer-close', label: tPanel('close'), onPress: onClose }}
        position={[headerW / 2 - BTN_W / 2, headerY + HEADER_H / 2 + 0.02 + BTN_H / 2, 0.002]}
      />

      {/* Master: the battery. Up = more of it dispatched (lower reserve). */}
      <group position={[x(0), 0, 0]}>
        <StripCard
          name={t('battery')}
          line1={t('soc', { pct: fmtPct(hasResult ? battery.socPct : null, 0) })}
          line2={t('reserve', { pct: fmtPct(battery.minSocPct, 0) })}
          tone={HOLO.green}
        />
        <MixerFader id="battery" level={battery.level} tone={HOLO.green} onCommit={onReserve} />
      </group>

      {sectors.map((s, i) => {
        const cut = s.fader.cut;
        const tone = cut ? HOLO.red : s.fader.limitKw !== null ? HOLO.amber : HOLO.cyan;
        return (
          <group key={s.sector} position={[x(1 + i), 0, 0]}>
            <StripCard
              name={tSectors(s.sector)}
              line1={t('served', { kw: fmtKw(hasResult ? s.servedKw : null) })}
              line2={
                cut
                  ? t('cutState')
                  : s.fader.limitKw !== null
                    ? t('limit', { kw: fmtKw(s.fader.limitKw) })
                    : t('noLimit')
              }
              tone={tone}
            />
            <MixerFader
              id={s.sector}
              level={s.fader.level}
              tone={tone}
              disabled={s.fader.scaleKw <= 0}
              onCommit={(level) => onSector(s.sector, level)}
            />
            <HoloButton
              button={{
                id: `mixer-${cut ? 'on' : 'cut'}-${s.sector}`,
                label: cut ? t('restore') : t('cut'),
                tone: cut ? HOLO.green : HOLO.red,
                onPress: () => onSectorCut(s.sector, !cut),
              }}
              position={[0, cutY, 0.002]}
              size={[STRIP_W, CUT_H]}
            />
          </group>
        );
      })}

      {shownAppliances.map((a, i) => {
        const off = a.level <= 0;
        const tone = off ? HOLO.red : HOLO.violet;
        return (
          <group key={a.id} position={[x(1 + sectors.length + i), 0, 0]}>
            <StripCard
              name={a.name}
              line1={t('direct', { kw: fmtKw(hasResult ? a.kwNow : null) })}
              line2={off ? t('cutState') : t('level', { pct: fmtPct(a.level * 100, 0) })}
              tone={tone}
            />
            <MixerFader
              id={a.id}
              level={a.level}
              tone={tone}
              onCommit={(l) => onAppliance(a.id, l)}
            />
            <HoloButton
              button={{
                id: `mixer-${off ? 'on' : 'cut'}-${a.id}`,
                label: off ? t('restore') : t('cut'),
                tone: off ? HOLO.green : HOLO.red,
                onPress: () => onAppliance(a.id, off ? 1 : 0),
              }}
              position={[0, cutY, 0.002]}
              size={[STRIP_W, CUT_H]}
            />
          </group>
        );
      })}

      <HoloButton
        button={{
          id: 'mixer-start',
          label: hasResult ? t('running') : t('start'),
          tone: HOLO.green,
          disabled: hasResult,
          onPress: onStart,
        }}
        position={[-(BTN_W + 0.03) / 2 - 0.12, footY, 0.002]}
        size={[BTN_W + 0.24, BTN_H]}
      />
      <HoloButton
        button={{ id: 'mixer-undo', label: tPanel('undo'), onPress: onUndo, disabled: !canUndo }}
        position={[(BTN_W + 0.03) / 2 + 0.12, footY, 0.002]}
      />
    </group>
  );
});
