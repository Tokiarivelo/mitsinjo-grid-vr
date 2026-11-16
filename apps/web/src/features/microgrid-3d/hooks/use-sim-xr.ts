'use client';

import { useXrInputsShown } from '../utils/xr-inputs-shown';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SectorId } from '@mitsinjo/engine';
import { useSimulationStore } from '@/stores';
import type { XrControlAction } from '@/features/vision-insert/ui/xr/xr-controls';
import type { SceneModel } from '../types';
import { bodyBlocked, type WalkGrid } from '../utils/walk-grid';
import { doorSpot, interiorSpawn, type XrSpot } from '../utils/sim-xr-place';
import type { InputPatch } from '@mitsinjo/engine';
import {
  breaksConstitution,
  sectorPowerPatch,
  type SectorPowerAction,
} from '../utils/sector-power';
import {
  applianceLevelPatch,
  reserveLevelPatch,
  sectorFader,
  sectorLevelPatch,
} from '../utils/dispatch-mixer';

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
  const appliances = useSimulationStore((s) => s.input.appliances);
  const minSocPct = useSimulationStore((s) => s.input.battery.minSocPct);
  const runEngine = useSimulationStore((s) => s.run);
  const approveChange = useSimulationStore((s) => s.approveChange);
  const undoLastChange = useSimulationStore((s) => s.undoLastChange);
  const canUndo = useSimulationStore((s) => s.changeHistory.length > 0);

  const [panel, setPanelState] = useState<SectorId | null>(null);
  /** The dispatcher's mixing desk is open (VS-T34); one panel at a time. */
  const [mixer, setMixer] = useState(false);
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
    setPanelState(null);
    setMixer(false);
    setInside(null);
    setPlace(null);
    setRefused(null);
    setHelp(true);
  }
  const setPanel = useCallback((sector: SectorId | null) => {
    setPanelState(sector);
    if (sector) setMixer(false);
  }, []);
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
    [xrActive, onSelectSector, setPanel]
  );

  /** Dispatcher label or unit clicked in VR: its mixing desk (VS-T34). */
  const openMixer = useCallback(() => {
    setPanelState(null);
    setMixer(true);
  }, []);
  const closeMixer = useCallback(() => setMixer(false), []);

  const goToDoor = useCallback(
    (sector: SectorId) => {
      const grid = walkGridRef.current;
      teleport(doorSpot(sector, grid ? (x, z) => bodyBlocked(grid, x, z) : undefined), false);
      setInside(null);
      setPanel(null);
    },
    [teleport, setPanel]
  );

  const enter = useCallback(
    (sector: SectorId) => {
      teleport(interiorSpawn(), true);
      setInside(sector);
      setPanel(null);
    },
    [teleport, setPanel]
  );

  const exit = useCallback(() => {
    if (inside) goToDoor(inside);
  }, [inside, goToDoor]);

  /**
   * One operator action → one undoable engine run, refused (with `refusedAs` shown) when it would
   * break the village constitution.
   */
  const apply = useCallback(
    (id: string, patch: InputPatch | null, refusedAs: SectorId) => {
      if (!patch) return;
      if (breaksConstitution(patch)) {
        setRefused(refusedAs);
        return;
      }
      setRefused(null);
      approveChange(`${id}-${Date.now()}`, patch);
    },
    [approveChange]
  );

  const power = useCallback(
    (sector: SectorId, action: SectorPowerAction) => {
      const building = model.buildings[sector];
      const patch = sectorPowerPatch(action, sector, caps, building.servedKw, model.timeIndex);
      apply(`vr-power-${sector}-${action}`, patch, sector);
    },
    [model, caps, apply]
  );

  /** Mixing desk (VS-T34): a sector fader released at `level`. */
  const mixSector = useCallback(
    (sector: SectorId, level: number) => {
      const building = model.buildings[sector];
      const { scaleKw } = sectorFader(
        building.demandKw,
        caps?.find((c) => c.sector === sector) ?? null
      );
      apply(
        `vr-mix-${sector}`,
        sectorLevelPatch(sector, level, scaleKw, caps, model.timeIndex),
        sector
      );
    },
    [model, caps, apply]
  );
  /** Mixing desk: a sector's « Cut » / « On » (same patches as the building panel). */
  const cutSector = useCallback(
    (sector: SectorId, cut: boolean) => power(sector, cut ? 'cut' : 'restore'),
    [power]
  );
  /** Mixing desk: an appliance wired to the dispatcher, released at `level` (0 = cut). */
  const mixAppliance = useCallback(
    (id: string, level: number) => {
      const sector = appliances?.find((a) => a.id === id)?.sector;
      if (!sector) return;
      apply(`vr-mix-${id}`, applianceLevelPatch(appliances, id, level, model.timeIndex), sector);
    },
    [appliances, model.timeIndex, apply]
  );
  /** Mixing desk: the battery master fader → its reserve. */
  const mixReserve = useCallback(
    (level: number) => {
      const patch = reserveLevelPatch(level, minSocPct);
      if (patch) approveChange(`vr-mix-reserve-${Date.now()}`, patch);
    },
    [minSocPct, approveChange]
  );
  /** Mixing desk: « Start the battery & dispatch » = the first engine run of the day. */
  const startDispatch = useCallback(() => runEngine(), [runEngine]);

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
        if (mixer) setMixer(false);
        else if (panel) setPanel(null);
        else if (inside) exit();
      }
    },
    [mixer, panel, inside, exit, setPanel]
  );

  return {
    panel,
    setPanel,
    mixer,
    openMixer,
    closeMixer,
    mixSector,
    cutSector,
    mixAppliance,
    mixReserve,
    startDispatch,
    minSocPct,
    appliances,
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
