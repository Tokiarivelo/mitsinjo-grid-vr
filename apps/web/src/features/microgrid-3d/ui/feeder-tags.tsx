'use client';

import { type RefObject, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { SECTOR_IDS, type SectorId } from '@mitsinjo/engine';
import { fmtKw } from '@/lib/format';
import type { BuildingSceneModel, LineFlowSceneModel, StatusColor } from '../types';
import { pointAlongCable, routeCable } from '../utils/cable-route';
import { hasFeederTag, NO_LOAD_KW } from '../utils/feeder-tone';
import { FeederChip } from './dispatch-share-bar';

/**
 * Where each tag sits along its cable (0 = controller, 1 = building). Art-directed so
 * no tag lands over the battery yard behind the controller or on a building label.
 */
export const FEEDER_TAG_T: Record<SectorId, number> = {
  water: 0.5,
  households: 0.45,
  school: 0.82,
  market: 0.45,
  health: 0.45,
  industry: 0.42,
};

/** Tag height above the cable, so the chip never hides the wire it labels. */
const TAG_LIFT = 0.45;

export interface FeederTagsProps {
  lines: Record<SectorId, LineFlowSceneModel>;
  buildings: Record<SectorId, BuildingSceneModel>;
  tones: Record<SectorId, StatusColor>;
  titles: Record<SectorId, string>;
  htmlPortal?: RefObject<HTMLElement | null> | null;
}

/** One chip per connected feeder: the kW the EMS controller sends down that cable. */
export function FeederTags({ lines, buildings, tones, titles, htmlPortal }: FeederTagsProps) {
  const anchors = useMemo(() => {
    const out = {} as Record<SectorId, [number, number, number]>;
    for (const id of SECTOR_IDS) {
      const line = lines[id];
      const [x, y, z] = pointAlongCable(routeCable(line.from, line.to).points, FEEDER_TAG_T[id]);
      out[id] = [x, y + TAG_LIFT, z];
    }
    return out;
  }, [lines]);

  if (htmlPortal === null) return null;

  return (
    <group name="feeder-tags">
      {SECTOR_IDS.filter((id) => hasFeederTag(buildings[id])).map((id) => (
        <Html
          key={id}
          position={anchors[id]}
          center
          distanceFactor={20}
          portal={htmlPortal as RefObject<HTMLElement>}
          zIndexRange={[9, 0]}
          className="pointer-events-none select-none"
        >
          <FeederChip
            id={id}
            kwLabel={fmtKw(buildings[id].servedKw)}
            tone={tones[id]}
            coveragePct={buildings[id].demandKw > NO_LOAD_KW ? buildings[id].coveragePct : null}
            title={titles[id]}
          />
        </Html>
      ))}
    </group>
  );
}
