'use client';

import { useXrInputsShown } from '../utils/xr-inputs-shown';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SectorId } from '@mitsinjo/engine';
import { useSimulationStore } from '@/stores';
import type { XrControlAction } from '@/features/vision-insert/ui/xr/xr-controls';
import type { SceneModel } from '../types';
import { bodyBlocked, type WalkGrid } from '../utils/walk-grid';
import { doorSpot, interiorSpawn, type XrSpot } from '../utils/sim-xr-place';
import {
  breaksConstitution,
  sectorPowerPatch,
  type SectorPowerAction,
} from '../utils/sector-power';

/** Button legends stay on screen this long after entering VR (then a stick click). */
export const SIM_HELP_ON_ENTRY_MS = 25000;
/** How long the « clinic is never cut » refusal shows (ms). */
const REFUSAL_MS = 4000;

export interface SimXrPlace {
  spot: XrSpot;
  interior: boolean;
  key: number;
}

/**
 * The /simulation VR session state (VSIM-T1–T4): the building panel that a label or building click
 * opens, the room you are in, teleports (door, room, back out), labels and button legends, and the
 * power actions — each one a normal engine run through `approveChange` (undoable), refused when it
 * would break the village constitution (the clinic is never cut).
 */
export function useSimXr({
  xrActive,
  model,
  onSelectSector,
}: {
  xrActive: boolean;
  model: SceneModel;
  onSelectSector: (sector: SectorId | null) => void;
}) {
  const caps = useSimulationStore((s) => s.input.sectorCaps);
  const approveChange = useSimulationStore((s) => s.approveChange);
  const undoLastChange = useSimulationStore((s) => s.undoLastChange);
  const canUndo = useSimulationStore((s) => s.changeHistory.length > 0);

  const [panel, setPanel] = useState<SectorId | null>(null);
  const [inside, setInside] = useState<SectorId | null>(null);
  const [place, setPlace] = useState<SimXrPlace | null>(null);
  const [labels, setLabels] = useState(true);
  const [help, setHelp] = useState(true);
  const [refused, setRefused] = useState<SectorId | null>(null);
  const walkGridRef = useRef<WalkGrid | null>(null);
  const placeKey = useRef(0);

  // Entering or leaving VR resets the session (state adjusted during render, no effect cascade).
  const [wasXr, setWasXr] = useState(xrActive);
  if (wasXr !== xrActive) {
    setWasXr(xrActive);
    setPanel(null);
    setInside(null);
    setPlace(null);
    setRefused(null);
    setHelp(true);
  }
  useEffect(() => {
    if (!xrActive) return;
    const id = window.setTimeout(() => setHelp(false), SIM_HELP_ON_ENTRY_MS);
    return () => window.clearTimeout(id);
  }, [xrActive]);

  useEffect(() => {
    if (!refused) return;
    const id = window.setTimeout(() => setRefused(null), REFUSAL_MS);
    return () => window.clearTimeout(id);
  }, [refused]);

  const teleport = useCallback((spot: XrSpot, interior: boolean) => {
    placeKey.current += 1;
    setPlace({ spot, interior, key: placeKey.current });
  }, []);

  /** Label or building clicked: the power panel in VR, the usual selection on screen. */
  const selectSector = useCallback(
    (sector: SectorId | null) => {
      if (!xrActive) return onSelectSector(sector);
      setPanel(sector);
    },
    [xrActive, onSelectSector]
  );

  const goToDoor = useCallback(
    (sector: SectorId) => {
      const grid = walkGridRef.current;
      teleport(doorSpot(sector, grid ? (x, z) => bodyBlocked(grid, x, z) : undefined), false);
      setInside(null);
      setPanel(null);
    },
    [teleport]
  );

  const enter = useCallback(
    (sector: SectorId) => {
      teleport(interiorSpawn(), true);
      setInside(sector);
      setPanel(null);
    },
    [teleport]
  );

  const exit = useCallback(() => {
    if (inside) goToDoor(inside);
  }, [inside, goToDoor]);

  const power = useCallback(
    (sector: SectorId, action: SectorPowerAction) => {
      const building = model.buildings[sector];
      const patch = sectorPowerPatch(action, sector, caps, building.servedKw, model.timeIndex);
      if (!patch) return;
      if (breaksConstitution(patch)) {
        setRefused(sector);
        return;
      }
      setRefused(null);
      approveChange(`vr-power-${sector}-${action}-${Date.now()}`, patch);
    },
    [model, caps, approveChange]
  );

  const undo = useCallback(() => {
    undoLastChange();
  }, [undoLastChange]);

  /**
   * A/X: labels · B/Y: close the panel, else leave the room · stick click: legends · stick held:
   * hands & controllers (VS-T30).
   */
  const onXrAction = useCallback(
    (a: XrControlAction) => {
      if (a.type === 'analyse') setLabels((v) => !v);
      else if (a.type === 'help') setHelp((v) => !v);
      else if (a.type === 'inputs') useXrInputsShown.getState().toggle();
      else if (a.type === 'back') {
        if (panel) setPanel(null);
        else if (inside) exit();
      }
    },
    [panel, inside, exit]
  );

  return {
    panel,
    setPanel,
    inside,
    place,
    labels,
    toggleLabels: useCallback(() => setLabels((v) => !v), []),
    help,
    refused,
    canUndo,
    caps,
    walkGridRef,
    selectSector,
    goToDoor,
    enter,
    exit,
    power,
    undo,
    onXrAction,
  };
}
