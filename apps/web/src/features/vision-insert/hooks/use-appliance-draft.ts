'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  applianceProfileKw,
  applianceSummary,
  type Appliance,
  type ApplianceCategory,
  type AppliancePosition,
  type SectorId,
} from '@mitsinjo/engine';
import type { ApplianceDetection } from '@/lib/vision';
import {
  clampToTerrain,
  nearestSector,
  PLACEMENT_CLEARANCE,
  snapAwayFromBuildings,
} from '@/features/microgrid-3d/utils/placement';
import { readSiteZones } from '@/features/microgrid-3d/hooks/use-site-zones';
import {
  aiDraft,
  clampWatts,
  fromAppliance,
  sameDraft,
  toAppliance,
  wattsRange,
  type ApplianceDraft,
  type ConnectionMode,
} from '../utils/appliance-draft';
import { usePlacedModelsStore } from '@/stores/placed-models.store';

/** `ai` = AI category + engine catalog power · `manual` = the operator's values (still catalog-bounded). */
export type DraftSource = 'ai' | 'manual';

interface DraftState {
  key: string;
  draft: ApplianceDraft;
  source: DraftSource;
}

function initial(
  key: string,
  detection: ApplianceDetection,
  name: string,
  existing?: Appliance,
  id?: string
): DraftState {
  const ai = aiDraft(detection, name);
  const connMode = id ? usePlacedModelsStore.getState().models[id]?.connectionMode : undefined;
  if (!existing)
    return {
      key,
      draft: { ...ai, ...(connMode ? { connectionMode: connMode } : {}) },
      source: 'ai',
    };
  const draft = fromAppliance(existing, connMode ?? 'branch');
  return { key, draft, source: sameDraft(draft, ai) ? 'ai' : 'manual' };
}

/**
 * Load line of the selected object before « Insert into simulation » (PV-T11). Starts from the AI estimate
 * (or the line already in the simulation); any edit switches to `manual`. `appliance` = engine-valid line
 * or null, `summary` = engine preview (peak kW, kWh per day). A new object starts a new draft.
 */
export function useApplianceDraft(
  id: string,
  detection: ApplianceDetection,
  name: string,
  existing?: Appliance
) {
  const key = `${id}|${existing ? 'in' : 'out'}`;
  const [state, setState] = useState<DraftState>(() => initial(key, detection, name, existing, id));
  // New object (or inserted / removed elsewhere): start again, without an effect round-trip.
  const current = state.key === key ? state : initial(key, detection, name, existing, id);
  if (current !== state) setState(current);

  const edit = useCallback(
    (change: (d: ApplianceDraft) => ApplianceDraft) =>
      setState((s) => ({ ...s, draft: change(s.draft), source: 'manual' })),
    []
  );

  const setName = useCallback((v: string) => edit((d) => ({ ...d, name: v })), [edit]);
  /** Feeder override (PP-T4): an explicit choice sticks, even when the position moves. */
  const setSector = useCallback(
    (v: SectorId) => edit((d) => ({ ...d, sector: v, feederAuto: false })),
    [edit]
  );
  /**
   * Free placement (PP-T4, PI-T3): normalized onto the terrain and out of buildings, paths, pond and
   * other placed objects (this line's own zone excluded); feeder follows unless overridden.
   */
  const setPosition = useCallback(
    (v: AppliancePosition | null) =>
      edit((d) => {
        if (!v) return { ...d, position: null };
        const position = snapAwayFromBuildings(clampToTerrain(v), PLACEMENT_CLEARANCE, {
          zones: readSiteZones(),
          excludeId: id,
        });
        return { ...d, position, sector: d.feederAuto ? nearestSector(position) : d.sector };
      }),
    [edit, id]
  );
  /** Back to the automatic feeder (nearest to the placed position, when set). */
  const useNearestFeeder = useCallback(
    () =>
      edit((d) => ({
        ...d,
        feederAuto: true,
        ...(d.position ? { sector: nearestSector(d.position) } : {}),
      })),
    [edit]
  );
  const setConnectionMode = useCallback(
    (v: ConnectionMode) => edit((d) => ({ ...d, connectionMode: v })),
    [edit]
  );
  /** Electric or not (VS-T40): a non-electric object gets no load, pole or cable. */
  const setElectric = useCallback((v: boolean) => edit((d) => ({ ...d, electric: v })), [edit]);
  const setWatts = useCallback((v: number) => edit((d) => ({ ...d, watts: v })), [edit]);
  const setQuantity = useCallback((v: number) => edit((d) => ({ ...d, quantity: v })), [edit]);
  const setCategory = useCallback(
    (v: ApplianceCategory) => edit((d) => ({ ...d, category: v, watts: clampWatts(v, d.watts) })),
    [edit]
  );
  const applyAiEstimate = useCallback(
    () => setState((s) => ({ ...s, draft: aiDraft(detection, name), source: 'ai' })),
    [detection, name]
  );
  const setManual = useCallback(() => setState((s) => ({ ...s, source: 'manual' })), []);

  const appliance = useMemo(() => toAppliance(id, current.draft), [id, current.draft]);
  const summary = useMemo(() => (appliance ? applianceSummary(appliance) : null), [appliance]);
  /** 24 h engine curve (kW) for the usage-hours chart; null while the draft is invalid. */
  const curve = useMemo(() => (appliance ? applianceProfileKw(appliance) : null), [appliance]);

  return {
    /** Engine line id of this draft (its own site zone is excluded while placing). */
    id,
    draft: current.draft,
    source: current.source,
    range: wattsRange(current.draft.category),
    appliance,
    summary,
    curve,
    setName,
    setCategory,
    setSector,
    setConnectionMode,
    setElectric,
    setPosition,
    useNearestFeeder,
    setWatts,
    setQuantity,
    applyAiEstimate,
    setManual,
  };
}

export type ApplianceDraftState = ReturnType<typeof useApplianceDraft>;
