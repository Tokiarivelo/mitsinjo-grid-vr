'use client';

import { type ReactNode, type RefObject, useMemo, useState } from 'react';
import * as THREE from 'three';
import { SECTOR_IDS, type Priority, type SectorId } from '@mitsinjo/engine';
import { SECTOR_ICON_BG_CLASS, SectorIcon } from '@/components/ui/sector-icon';
import { fmtPct } from '@/lib/format';
import type { BuildingSceneModel } from '../types';
import { STATUS_HEX, TOKEN_HEX, glowFromIntensity } from '../utils/scene-palette';
import { BODY_LAYOUT, BuildingBody } from './building-bodies';
import { badgeY, SceneBadge } from './scene-badge';

export interface VillageBuildingsProps {
  buildings: Record<SectorId, BuildingSceneModel>;
  selectedSector: SectorId | null;
  onSelectSector: (sector: SectorId | null) => void;
  sectorNames: Record<SectorId, string>;
  priorityLabels: Record<Priority, string>;
  /** Badge text for a sector at load 0 ("Not connected"). */
  disconnectedLabel: string;
  /** Small "AI" tag on every label while the AI dispatches alone (PA-T4c); hidden when unset. */
  aiBadgeLabel?: string;
  /** Stable DOM parent for labels (see VillageCanvas). */
  htmlPortal?: RefObject<HTMLElement | null>;
  /** Time-of-day lamp factor from the sky palette (dusk/night → 1, afternoon → low). */
  lampGlow?: number;
}

interface FrameLayout {
  ringInner: number;
  ledY: number;
}

interface BuildingFrameProps extends FrameLayout {
  id: SectorId;
  model: BuildingSceneModel;
  isSelected: boolean;
  onSelect: () => void;
  sectorName: string;
  priorityLabel: string;
  /** Shown instead of the coverage when the sector's load is 0. */
  disconnectedLabel: string;
  aiBadgeLabel?: string;
  htmlPortal?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

const SELECTED_RING_HEX = TOKEN_HEX.energyCyan;
const HOVER_RING_HEX = '#94a3b8';

function BuildingFrame({
  id,
  model,
  isSelected,
  onSelect,
  sectorName,
  priorityLabel,
  disconnectedLabel,
  aiBadgeLabel,
  ringInner,
  ledY,
  htmlPortal,
  children,
}: BuildingFrameProps) {
  const [hovered, setHovered] = useState(false);
  const { position, statusColor, coveragePct, priority } = model;
  // Brighter than 1 so the bloom pass gives the status beacon a halo.
  const beaconColor = useMemo(
    () => new THREE.Color(STATUS_HEX[statusColor]).multiplyScalar(2),
    [statusColor]
  );

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children}

      {(isSelected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[ringInner, ringInner + 0.25, 32]} />
          <meshBasicMaterial
            color={isSelected ? SELECTED_RING_HEX : HOVER_RING_HEX}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}

      {/* Alert Ground Ring (blinking in critical red, PA-T4c) */}
      {(model.inAlert || model.onFire) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[ringInner - 0.1, ringInner + 0.35, 32]} />
          <meshBasicMaterial color={TOKEN_HEX.criticalRed} transparent opacity={0.65} />
        </mesh>
      )}

      {/* Building Apex Status Beacon */}
      <mesh position={[0, ledY, 0]}>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshBasicMaterial color={beaconColor} toneMapped={false} />
      </mesh>

      {/* Floating status badge (shared with inserted objects, PT-11a) */}
      <SceneBadge
        position={[0, badgeY(ledY), 0]}
        htmlPortal={htmlPortal}
        icon={<SectorIcon sector={id} className="w-3.5 h-3.5" />}
        iconClassName={SECTOR_ICON_BG_CLASS[id]}
        title={sectorName}
        {...(aiBadgeLabel ? { aiBadgeLabel } : {})}
        statusColor={statusColor}
        priority={priority}
        priorityLabel={priorityLabel}
        metric={model.connected ? fmtPct(coveragePct, 0) : disconnectedLabel}
        selected={isSelected}
        alert={Boolean(model.inAlert || model.onFire)}
        onClick={onSelect}
        dataId={id}
      />
    </group>
  );
}

export function VillageBuildings({
  buildings,
  selectedSector,
  onSelectSector,
  sectorNames,
  priorityLabels,
  disconnectedLabel,
  aiBadgeLabel,
  htmlPortal,
  lampGlow = 1,
}: VillageBuildingsProps) {
  // Only start glowing when it begins to get dark (dusk / night: lampGlow > 0.45).
  // Zero in broad daylight (lampGlow <= 0.45).
  const duskThreshold = 0.45;
  const darkness = Math.max(0, Math.min(1, (lampGlow - duskThreshold) / 0.4));

  return (
    <group name="village-buildings">
      {SECTOR_IDS.map((id) => {
        const model = buildings[id];
        const isSelected = selectedSector === id;
        const hasPower =
          model.connected && model.servedKw > 0.05 && model.status !== 'unserved' && !model.onFire;
        const powerFactor = hasPower ? Math.max(0.65, glowFromIntensity(model.intensity)) : 0;
        const glow = darkness * powerFactor;

        return (
          <BuildingFrame
            key={id}
            id={id}
            model={model}
            isSelected={isSelected}
            onSelect={() => onSelectSector(isSelected ? null : id)}
            sectorName={sectorNames[id]}
            priorityLabel={priorityLabels[model.priority]}
            disconnectedLabel={disconnectedLabel}
            aiBadgeLabel={aiBadgeLabel}
            htmlPortal={htmlPortal}
            {...BODY_LAYOUT[id]}
          >
            <BuildingBody id={id} glow={glow} />
          </BuildingFrame>
        );
      })}
    </group>
  );
}
