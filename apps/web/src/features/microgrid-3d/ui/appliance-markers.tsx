'use client';

import { useEffect, useMemo, type RefObject } from 'react';
import { Instance, Instances, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_APPLIANCES, type Priority, type SectorId } from '@mitsinjo/engine';
import { ApplianceIcon } from '@/components/ui/appliance-icon';
import { SECTOR_ICON_BG_CLASS, SECTOR_TEXT_CLASS } from '@/components/ui/sector-icon';
import { fmtKw } from '@/lib/format';
import { usePlacedModelsStore } from '@/stores';
import type { ApplianceMarkerSceneModel } from '../types';
import { MARKER_PLINTH_HEX, STATUS_HEX, TOKEN_HEX } from '../utils/scene-palette';
import { APPLIANCE_FOCUS_SCALE } from '../utils/camera-focus';
import { BADGE_DISTANCE_FACTOR, badgeY, beaconY, SceneBadge } from './scene-badge';
import { PlacedDrawnModelMesh } from './placed-drawn-model';
import {
  buildPlacedModelsGeometry,
  placedGeometryKey,
  type PlacedModelItem,
  type SectorStateOverride,
} from '../utils/placed-models-geometry';

/** Tags for every marker up to this count; above, only the selected sector's (scene stays readable). */
export const MARKER_TAGS_ALL_MAX = 6;

const PLINTH: [number, number, number] = [0.46, 0.12, 0.46];
const BODY: [number, number, number] = [0.32, 0.5, 0.32];
/** Status beacon radius: the buildings' beacon, scaled to a small object. */
const BEACON_R = 0.1;

/** Beacon colour: the status hue, above 1 so bloom gives it the buildings' halo. */
const BEACON_COLORS = new Map<string, THREE.Color>();
function beaconColor(m: ApplianceMarkerSceneModel): THREE.Color {
  const status = m.tag?.statusColor ?? (m.running ? 'battery-green' : 'idle');
  let c = BEACON_COLORS.get(status);
  if (!c) {
    c = new THREE.Color(STATUS_HEX[status]).multiplyScalar(2);
    BEACON_COLORS.set(status, c);
  }
  return c;
}

export interface ApplianceMarkersProps {
  markers: ApplianceMarkerSceneModel[];
  selectedSector: SectorId | null;
  /** Badge title per marker (name, × quantity), already translated. */
  tagOf: (m: ApplianceMarkerSceneModel) => string;
  /** Translated priority names; the badge's bottom line shows the sector's (PT-11e). */
  priorityLabels?: Record<Priority, string>;
  /** Small "AI" tag on every badge while the AI dispatches alone. */
  aiBadgeLabel?: string;
  /** Badge click: toggle this marker's selection. */
  onSelectMarker?: (id: string) => void;
  htmlPortal?: RefObject<HTMLElement | null> | null;
  /** Click-selected marker: ring + tag highlight (PP-T5). */
  selectedId?: string | null;
  /** Marker being dragged: its instance hides while the ghost shows (PP-T5). */
  dragId?: string | null;
  /** Drag handlers per marker id; empty = markers stay inert. */
  bindMarker?: (id: string) => {
    onClick?: (e: ThreeEvent<MouseEvent>) => void;
    onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  };
  tier?: 'high' | 'low';
  sectorStatuses?: Partial<Record<SectorId, SectorStateOverride>>;
  /**
   * Deprecated in PI-T7: straight lines are replaced by real catenary derivation cables in DistributionLines.
   * Only rendered if explicitly requested (defaults to false).
   */
  showStraightFeederLinks?: boolean;
}

/**
 * Inserted appliances (PV-T13, PI-T2):
 * - If the appliance has a 3D recipe (PI-T1), renders its real 3D model merged into ONE draw call,
 *   sitting on terrainHeight with slope plinth if needed, reflecting departure states.
 * - Otherwise renders standard instanced markers (plinth + cyan/idle box).
 * - Total draw calls for 30 objects remains ≤ +2 draw calls.
 */
export function ApplianceMarkers({
  markers,
  selectedSector,
  tagOf,
  priorityLabels,
  aiBadgeLabel,
  onSelectMarker,
  htmlPortal,
  selectedId = null,
  dragId = null,
  bindMarker,
  tier = 'high',
  sectorStatuses,
  showStraightFeederLinks = false,
}: ApplianceMarkersProps) {
  const placedModels = usePlacedModelsStore((s) => s.models);
  const shown = useMemo(
    () => (dragId ? markers.filter((m) => m.id !== dragId) : markers),
    [markers, dragId]
  );

  // Split into 3D modeled appliances and standard box markers
  const modeledMarkers = useMemo(
    () => shown.filter((m) => Boolean(placedModels[m.id])),
    [shown, placedModels]
  );
  const standardMarkers = useMemo(
    () => shown.filter((m) => !placedModels[m.id]),
    [shown, placedModels]
  );

  const placedItems = useMemo<PlacedModelItem[]>(
    () =>
      modeledMarkers.map((m) => {
        const p = placedModels[m.id]!;
        return {
          id: m.id,
          sector: m.sector,
          running: m.running,
          position: m.position,
          recipe: p.recipe,
          scale: p.scale,
          yaw: p.yaw,
          archetype: p.archetype,
        };
      }),
    [modeledMarkers, placedModels]
  );

  // Rebuild the merged mesh only when what it draws changes (not on every scene-model refresh).
  const geometryKey = placedGeometryKey(placedItems, sectorStatuses, tier);
  const { modelsGeometry, plinths, modelBounds, drawn } = useMemo(
    () => buildPlacedModelsGeometry(placedItems, sectorStatuses, tier),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometryKey covers every input
    [geometryKey]
  );
  useEffect(() => () => modelsGeometry?.dispose(), [modelsGeometry]);

  // One LineSegments2 for every marker→building link: a single draw call (PP-T3 budget).
  const feederLinks = useMemo(
    () =>
      shown.flatMap((m) => {
        const h = modelBounds[m.id]?.height ?? PLINTH[1] + BODY[1];
        return [
          new THREE.Vector3(m.position[0], m.position[1] + h, m.position[2]),
          new THREE.Vector3(m.feeder[0], m.feeder[1], m.feeder[2]),
        ];
      }),
    [shown, modelBounds]
  );

  if (markers.length === 0) return null;
  const running = standardMarkers.filter((m) => m.running);
  const idle = standardMarkers.filter((m) => !m.running);
  const tagged =
    shown.length <= MARKER_TAGS_ALL_MAX ? shown : shown.filter((m) => m.sector === selectedSector);
  const selected = selectedId ? shown.find((m) => m.id === selectedId) : undefined;
  const topOf = (m: ApplianceMarkerSceneModel) => modelBounds[m.id]?.height ?? PLINTH[1] + BODY[1];
  const selectedRadius = selected ? (modelBounds[selected.id]?.radius ?? 0.35) : 0.35;

  return (
    <group name="appliance-markers">
      {showStraightFeederLinks && (
        <Line
          segments
          points={feederLinks}
          color={TOKEN_HEX.idle}
          lineWidth={1}
          transparent
          opacity={0.55}
        />
      )}

      {/* 1. Placed 3D models (PI-T2): single merged mesh for all objects */}
      {modelsGeometry && (
        <mesh name="placed-appliance-models" geometry={modelsGeometry} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.7} metalness={0.2} />
        </mesh>
      )}

      {/* Models that wear their drawings (PQ-T71): one mesh each, capped (`PLACED_DRAWN_MAX`) */}
      {drawn.map((model) => (
        <PlacedDrawnModelMesh key={model.id} model={model} />
      ))}

      {/* Plinths under models on sloped ground: one instanced draw call */}
      {plinths.length > 0 && (
        <Instances limit={MAX_APPLIANCES} name="placed-model-plinths" castShadow receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={MARKER_PLINTH_HEX} roughness={0.8} />
          {plinths.map((p, idx) => (
            <Instance key={`plinth-${idx}`} position={p.position} scale={p.size} />
          ))}
        </Instances>
      )}

      {/* Invisible hit targets for placed models (click/drag support) */}
      {modeledMarkers.map((m) => {
        const bounds = modelBounds[m.id];
        const h = bounds?.height ?? 1.0;
        const r = bounds?.radius ?? 0.5;
        return (
          <mesh
            key={`hit-${m.id}`}
            position={[m.position[0], m.position[1] + h / 2, m.position[2]]}
            visible={false}
            {...bindMarker?.(m.id)}
          >
            <cylinderGeometry args={[r, r, h, 8]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>
        );
      })}

      {/* 2. Standard box markers (for appliances without 3D recipes) */}
      {standardMarkers.length > 0 && (
        <Instances limit={MAX_APPLIANCES} name="appliance-plinths" castShadow receiveShadow>
          <boxGeometry args={PLINTH} />
          <meshStandardMaterial color={MARKER_PLINTH_HEX} roughness={0.8} />
          {standardMarkers.map((m) => (
            <Instance
              key={m.id}
              position={[m.position[0], m.position[1] + PLINTH[1] / 2, m.position[2]]}
              {...bindMarker?.(m.id)}
            />
          ))}
        </Instances>
      )}
      {running.length > 0 && (
        <Instances limit={MAX_APPLIANCES} name="appliance-running" castShadow>
          <boxGeometry args={BODY} />
          <meshStandardMaterial
            color={TOKEN_HEX.energyCyan}
            emissive={TOKEN_HEX.energyCyan}
            emissiveIntensity={1.4}
            roughness={0.4}
            toneMapped={false}
          />
          {running.map((m) => (
            <Instance
              key={m.id}
              position={[m.position[0], m.position[1] + PLINTH[1] + BODY[1] / 2, m.position[2]]}
              {...bindMarker?.(m.id)}
            />
          ))}
        </Instances>
      )}
      {idle.length > 0 && (
        <Instances limit={MAX_APPLIANCES} name="appliance-idle" castShadow>
          <boxGeometry args={BODY} />
          <meshStandardMaterial color={TOKEN_HEX.idle} roughness={0.6} />
          {idle.map((m) => (
            <Instance
              key={m.id}
              position={[m.position[0], m.position[1] + PLINTH[1] + BODY[1] / 2, m.position[2]]}
              {...bindMarker?.(m.id)}
            />
          ))}
        </Instances>
      )}

      {/* Status beacons: one instanced draw call for every tagged marker (PT-11d) */}
      {tagged.length > 0 && (
        <Instances limit={MAX_APPLIANCES} name="appliance-beacons">
          <sphereGeometry args={[BEACON_R, 16, 12]} />
          <meshBasicMaterial toneMapped={false} />
          {tagged.map((m) => (
            <Instance
              key={`beacon-${m.id}`}
              position={[m.position[0], m.position[1] + beaconY(topOf(m)), m.position[2]]}
              color={beaconColor(m)}
            />
          ))}
        </Instances>
      )}

      {/* Status badges, the same as the sector buildings' (PT-11) */}
      {tagged.map((m) => (
        <SceneBadge
          key={m.id}
          position={[m.position[0], m.position[1] + badgeY(beaconY(topOf(m))), m.position[2]]}
          htmlPortal={htmlPortal}
          zIndexRange={[8, 0]}
          distanceFactor={BADGE_DISTANCE_FACTOR * APPLIANCE_FOCUS_SCALE}
          icon={
            <ApplianceIcon
              category={m.category}
              className={`w-3.5 h-3.5 shrink-0 ${SECTOR_TEXT_CLASS[m.sector]}`}
            />
          }
          iconClassName={SECTOR_ICON_BG_CLASS[m.sector]}
          title={tagOf(m)}
          {...(aiBadgeLabel ? { aiBadgeLabel } : {})}
          statusColor={m.tag?.statusColor ?? (m.running ? 'battery-green' : 'idle')}
          {...(m.tag && priorityLabels
            ? { priority: m.tag.priority, priorityLabel: priorityLabels[m.tag.priority] }
            : {})}
          metric={fmtKw(m.kwNow, 2)}
          selected={m.id === selectedId}
          alert={Boolean(m.tag?.inAlert)}
          {...(onSelectMarker ? { onClick: () => onSelectMarker(m.id) } : {})}
          dataId={m.id}
        />
      ))}

      {/* Selection ring */}
      {selected && (
        <mesh
          name="appliance-selection-ring"
          rotation-x={-Math.PI / 2}
          position={[selected.position[0], selected.position[1] + 0.03, selected.position[2]]}
        >
          <ringGeometry args={[selectedRadius + 0.05, selectedRadius + 0.17, 40]} />
          <meshBasicMaterial
            color={TOKEN_HEX.energyCyan}
            toneMapped={false}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Drag preview (PP-T5): a translucent plinth + body at the pointer's ground point. The hook moves
 * `ghostRef` imperatively (no setState per frame); `visible` flips only when the drag starts/ends.
 */
export function MarkerDragGhost({
  ghostRef,
  visible,
}: {
  ghostRef: RefObject<THREE.Group | null>;
  visible: boolean;
}) {
  return (
    <group name="appliance-drag-ghost" ref={ghostRef} visible={visible}>
      <mesh position={[0, PLINTH[1] / 2, 0]}>
        <boxGeometry args={PLINTH} />
        <meshBasicMaterial
          color={TOKEN_HEX.energyCyan}
          toneMapped={false}
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, PLINTH[1] + BODY[1] / 2, 0]}>
        <boxGeometry args={BODY} />
        <meshBasicMaterial
          color={TOKEN_HEX.energyCyan}
          toneMapped={false}
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
