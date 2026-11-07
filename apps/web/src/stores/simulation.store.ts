import { create } from 'zustand';
import {
  type Comparison,
  type InputPatch,
  type ScenarioId,
  type SectorId,
  type SimulationInput,
  type StrategyId,
  type WeatherId,
  type Workflow,
  type WorkflowComparison,
  type BridgeState,
  type DispatchMode,
  type DispatchLogEntry,
  type Narration,
  type ScenarioEvent,
  dispatchLogHash,
  scenarios,
  compareWorkflow,
  applyPatch,
  activeFires,
  generateChaosWorkflow,
  MAX_WORKFLOW_DAYS,
} from '@mitsinjo/engine';
import { type ScenarioDraft, draftToWorkflow } from '@/lib/scenario-draft';
import {
  carryFiresOver,
  clearWorkflowFires,
  dayEvents,
  reportWorkflowFire,
} from '@/lib/day-events';

export type SimStatus = 'ready' | 'running' | 'complete' | 'modified' | 'error';
export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'stopped';
/** Where the input comes from: a scenario edited in the app, or the physical scale model (PH). */
export type InputSource = 'scenario' | 'device';

/** One approved change (K4): the input and strategy just before it, to restore on undo. */
export interface AppliedChange {
  /** Id of the approved proposal. */
  id: string;
  /** `workflow` too when the change touched it (a restore clears day fires). */
  before: { input: SimulationInput; strategy: StrategyId; workflow?: Workflow };
}

/** Approved changes kept for undo (oldest dropped first). */
export const CHANGE_HISTORY_MAX = 20;

/** What the scale-model bridge sends that the store needs to re-run the same engine call. */
export type DeviceRun = Pick<BridgeState, 'scenarioId' | 'patch' | 'strategy' | 'simHour'> &
  Partial<Pick<BridgeState, 'scale'>>;

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface SimulationState {
  scenarioId: ScenarioId;
  input: SimulationInput;
  status: SimStatus;
  isPlaying: boolean;
  playbackStatus: PlaybackStatus;
  playbackSpeed: PlaybackSpeed;
  /** Comparison of the day under the cursor (`dayIndex`) of the weather workflow. */
  results: Partial<Comparison>;
  /** Weather of each simulated day, in order. One sunny day = the plain 24 h simulation. */
  workflow: Workflow;
  workflowResults: WorkflowComparison;
  dayIndex: number;
  activeStrategy: StrategyId;
  selectedSector: SectorId | null;
  timeIndex: number;
  error: string | null;
  source: InputSource;
  /** Real length of one simulated hour on the scale model (ms), from its `timeScale`; null = unknown. */
  deviceHourMs: number | null;
  /** Approved changes of this session, oldest first. Cleared by loadScenario, reset and the scale model. */
  changeHistory: AppliedChange[];
  /** Dispatch mode (PA): manual operator control, assisted proposals, or autonomous AI execution. */
  dispatchMode: DispatchMode;
  /** Chronological event log of detections and actions (PA). */
  dispatchLog: DispatchLogEntry[];

  // Actions
  loadScenario: (scenarioId: ScenarioId) => void;
  patchInput: (patch: InputPatch) => void;
  run: (strategies?: readonly StrategyId[]) => void;
  reset: () => void;
  selectStrategy: (strategy: StrategyId) => void;
  selectSector: (sector: SectorId | null) => void;
  setTimeIndex: (timeIndex: number) => void;
  applyProposal: (patch?: InputPatch, strategy?: StrategyId) => void;
  /**
   * Fire reported in a sector (M2-T2, safety exception): adds a fire event from the shown hour to the end of
   * the day and re-runs the engine at once, no approval. A sector already burning at that hour is left as is.
   */
  reportFire: (sector: SectorId) => void;
  /** applyProposal + records the state before it, so `undoLastChange` can restore it. */
  approveChange: (id: string, patch?: InputPatch, strategy?: StrategyId) => void;
  /** Restores the input and strategy from before the last approved change, re-runs the engine. Returns its id. */
  undoLastChange: () => string | null;
  /** Follow the scale model: scenario + measured patch, its strategy and hour; runs the engine. */
  applyDeviceRun: (run: DeviceRun) => void;
  /** Stop following the scale model (the last input stays, editable). */
  releaseDevice: () => void;

  // Dispatch Actions (PA)
  setDispatchMode: (mode: DispatchMode) => void;
  /** Immediately restore full manual control (one-tap take back control). */
  takeBackControl: () => void;
  appendDispatchLog: (entry: DispatchLogEntry | DispatchLogEntry[]) => void;
  clearDispatchLog: () => void;
  updateDispatchLogNarration: (id: string, narration: Narration) => void;

  // Weather workflow actions
  addWorkflowDay: (weather?: WeatherId, events?: ScenarioEvent[]) => void;
  removeWorkflowDay: (day: number) => void;
  setDayWeather: (day: number, weather: WeatherId) => void;
  setDayIndex: (day: number) => void;
  /** Replaces the workflow with a seeded chaos sequence of weather and incidents (PA-T6c). */
  loadChaosWorkflow: (seed?: number, days?: number) => void;
  /**
   * Replaces simulation and workflow with a chat-drafted multi-day scenario (PA-T8f),
   * runs the engine and starts playback from day 1, 00:00 (the "launch" buttons).
   */
  loadDraft: (draft: ScenarioDraft, mode?: DispatchMode) => void;
  /** Next playback hour; rolls over to the next workflow day, then loops to day 1. */
  advancePlayback: () => void;

  // Playback Actions
  play: () => void;
  pause: () => void;
  stop: () => void;
  restart: () => void;
  togglePlay: () => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
}

export function cloneInput(input: SimulationInput): SimulationInput {
  return JSON.parse(JSON.stringify(input)) as SimulationInput;
}

export const INITIAL_SCENARIO_ID: ScenarioId = 'baseline';

export const DEFAULT_WORKFLOW: Workflow = [{ weather: 'sunny' }];

const ALL_STRATEGIES: readonly StrategyId[] = ['proportional', 'essential_first', 'balanced'];

/** Per-strategy results of one workflow day (empty when that day was not simulated). */
export function dayComparison(
  workflowResults: WorkflowComparison,
  dayIndex: number
): Partial<Comparison> {
  const out: Partial<Comparison> = {};
  for (const [strategy, wf] of Object.entries(workflowResults) as [
    StrategyId,
    WorkflowComparison[StrategyId],
  ][]) {
    const day = wf?.days[dayIndex];
    if (day) out[strategy] = day.result;
  }
  return out;
}

function clampDay(day: number, days: number): number {
  return Math.max(0, Math.min(days - 1, Math.floor(day)));
}

export const initialSimulationData = {
  scenarioId: INITIAL_SCENARIO_ID,
  input: cloneInput(scenarios[INITIAL_SCENARIO_ID].input),
  status: 'ready' as SimStatus,
  isPlaying: false,
  playbackStatus: 'idle' as PlaybackStatus,
  playbackSpeed: 1 as PlaybackSpeed,
  results: {} as Partial<Comparison>,
  workflow: DEFAULT_WORKFLOW,
  workflowResults: {} as WorkflowComparison,
  dayIndex: 0,
  activeStrategy: 'proportional' as StrategyId,
  selectedSector: null as SectorId | null,
  timeIndex: 12,
  error: null as string | null,
  source: 'scenario' as InputSource,
  deviceHourMs: null as number | null,
  changeHistory: [] as AppliedChange[],
  dispatchMode: 'manual' as DispatchMode,
  dispatchLog: [] as DispatchLogEntry[],
};

export function resetSimulationStore() {
  useSimulationStore.setState({
    ...initialSimulationData,
    input: cloneInput(scenarios[INITIAL_SCENARIO_ID].input),
    workflow: DEFAULT_WORKFLOW,
    changeHistory: [],
    dispatchMode: 'manual',
    dispatchLog: [],
  });
}

/**
 * Runs the engine when the current input has no up-to-date result.
 * Returns false when there is still no result (run failed): playback must not start.
 */
function ensureResults(get: () => SimulationState): boolean {
  const { status, results, run } = get();
  if (status !== 'complete' || Object.keys(results).length === 0) run();
  return get().status === 'complete';
}

/** An input edit invalidates the run. */
function modifiedState() {
  return {
    status: 'modified' as SimStatus,
    isPlaying: false,
    playbackStatus: 'idle' as PlaybackStatus,
    error: null,
  };
}

/**
 * Applies a workflow edit. When the run was up to date, the engine re-runs at once so the
 * new weather shows in the solar output and the 3D scene; otherwise the run stays modified.
 */
function commitWorkflow(
  set: (partial: Partial<SimulationState>) => void,
  get: () => SimulationState,
  patch: Pick<SimulationState, 'workflow'> & Partial<Pick<SimulationState, 'dayIndex'>>
) {
  if (get().status === 'complete') {
    set(patch);
    get().run();
    return;
  }
  set({ ...modifiedState(), ...patch });
}

type SetState = (partial: Partial<SimulationState>) => void;
type GetState = () => SimulationState;

/** New input (and strategy) + engine re-run on every workflow day. Throws if the engine fails. */
function commitInput(set: SetState, get: GetState, input: SimulationInput, strategy: StrategyId) {
  set({ input, activeStrategy: strategy, status: 'running', error: null });
  const workflowResults = compareWorkflow(input, get().workflow, ALL_STRATEGIES);
  set({
    workflowResults,
    results: dayComparison(workflowResults, get().dayIndex),
    status: 'complete',
    error: null,
  });
}

function failRun(set: SetState, err: unknown, fallback: string) {
  set({
    status: 'error',
    error: err instanceof Error ? err.message : fallback,
    isPlaying: false,
    playbackStatus: 'idle',
  });
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  ...initialSimulationData,

  loadScenario: (scenarioId: ScenarioId) => {
    const preset = scenarios[scenarioId];
    if (!preset) {
      set({
        error: `Unknown scenario: ${scenarioId}`,
        status: 'error',
        isPlaying: false,
        playbackStatus: 'idle',
      });
      return;
    }
    set({
      scenarioId,
      source: 'scenario',
      input: cloneInput(preset.input),
      status: 'ready',
      isPlaying: false,
      playbackStatus: 'idle',
      results: {},
      workflowResults: {},
      dayIndex: 0,
      error: null,
      changeHistory: [],
      dispatchMode: 'manual',
      dispatchLog: [],
    });
  },

  patchInput: (patch: InputPatch) => {
    try {
      const patched = applyPatch(get().input, patch);
      set({ ...modifiedState(), input: patched });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Invalid patch',
        status: 'error',
        isPlaying: false,
        playbackStatus: 'idle',
      });
    }
  },

  run: (strategies?: readonly StrategyId[]) => {
    const activeStrategies: readonly StrategyId[] =
      strategies && strategies.length > 0 ? strategies : ALL_STRATEGIES;

    set({ status: 'running', error: null });
    try {
      const { input, workflow } = get();
      const workflowResults = compareWorkflow(input, workflow, activeStrategies);
      const dayIndex = clampDay(get().dayIndex, workflow.length);
      set({
        workflowResults,
        results: dayComparison(workflowResults, dayIndex),
        dayIndex,
        status: 'complete',
        error: null,
      });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Simulation failed',
        isPlaying: false,
        playbackStatus: 'idle',
      });
    }
  },

  reset: () => {
    const currentScenario = get().scenarioId;
    const preset = scenarios[currentScenario] ?? scenarios[INITIAL_SCENARIO_ID];
    set({
      input: cloneInput(preset.input),
      status: 'ready',
      isPlaying: false,
      playbackStatus: 'idle',
      results: {},
      workflowResults: {},
      dayIndex: 0,
      error: null,
      changeHistory: [],
      dispatchMode: 'manual',
      dispatchLog: [],
    });
  },

  selectStrategy: (strategy: StrategyId) => {
    set({ activeStrategy: strategy });
  },

  selectSector: (sector: SectorId | null) => {
    set({ selectedSector: sector });
  },

  setTimeIndex: (timeIndex: number) => {
    const clamped = Math.max(0, Math.min(23, Math.floor(timeIndex)));
    set({ timeIndex: clamped });
  },

  applyProposal: (patch?: InputPatch, strategy?: StrategyId) => {
    try {
      const patched =
        patch && Object.keys(patch).length > 0 ? applyPatch(get().input, patch) : get().input;
      // A restore also puts out the fires reported on workflow days.
      if (patch?.clearFires?.length) {
        set({ workflow: clearWorkflowFires(get().workflow, patch.clearFires) });
      }
      commitInput(set, get, patched, strategy ?? get().activeStrategy);
    } catch (err) {
      failRun(set, err, 'Failed to apply proposal');
    }
  },

  reportFire: (sector: SectorId) => {
    const { input, timeIndex, activeStrategy, workflow, dayIndex } = get();
    const events = dayEvents(input.events, workflow, dayIndex);
    if (activeFires(events, timeIndex).some((f) => f.sector === sector)) return;
    try {
      if (workflow.length > 1) {
        // Several days: the fire starts now and keeps burning on the next days (not every day
        // from this hour, which made it vanish each night and come back at the same hour).
        set({ workflow: reportWorkflowFire(workflow, dayIndex, sector, timeIndex) });
        commitInput(set, get, input, activeStrategy);
        return;
      }
      const fire = {
        type: 'fire' as const,
        sector,
        startHour: timeIndex,
        durationH: 24 - timeIndex,
      };
      commitInput(set, get, { ...input, events: [...input.events, fire] }, activeStrategy);
    } catch (err) {
      failRun(set, err, 'Failed to report the fire');
    }
  },

  approveChange: (id: string, patch?: InputPatch, strategy?: StrategyId) => {
    const { input, activeStrategy, changeHistory, workflow } = get();
    const entry: AppliedChange = {
      id,
      before: {
        input: cloneInput(input),
        strategy: activeStrategy,
        ...(patch?.clearFires?.length ? { workflow } : {}),
      },
    };
    get().applyProposal(patch, strategy);
    if (get().status !== 'complete') return;
    set({ changeHistory: [...changeHistory, entry].slice(-CHANGE_HISTORY_MAX) });
  },

  undoLastChange: () => {
    const { changeHistory } = get();
    const last = changeHistory[changeHistory.length - 1];
    if (!last) return null;
    set({
      input: cloneInput(last.before.input),
      activeStrategy: last.before.strategy,
      ...(last.before.workflow ? { workflow: last.before.workflow } : {}),
      changeHistory: changeHistory.slice(0, -1),
    });
    get().run();
    return last.id;
  },

  applyDeviceRun: ({ scenarioId, patch, strategy, simHour, scale }: DeviceRun) => {
    try {
      const base = cloneInput(scenarios[scenarioId].input);
      const input = Object.keys(patch).length > 0 ? applyPatch(base, patch) : base;
      set({
        scenarioId,
        source: 'device',
        deviceHourMs: scale ? scale.timeScale * 1000 : null,
        input,
        activeStrategy: strategy,
        // The model runs one day at a time: plain 24 h comparison, cursor on the model's hour.
        workflow: DEFAULT_WORKFLOW,
        dayIndex: 0,
        timeIndex: simHour,
        changeHistory: [],
        isPlaying: false,
        playbackStatus: 'idle',
      });
      get().run();
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Invalid scale model data',
        isPlaying: false,
        playbackStatus: 'idle',
      });
    }
  },

  releaseDevice: () => {
    set({ source: 'scenario' });
  },

  setDispatchMode: (mode: DispatchMode) => {
    set({ dispatchMode: mode });
  },

  takeBackControl: () => {
    set({ dispatchMode: 'manual' });
  },

  appendDispatchLog: (entry: DispatchLogEntry | DispatchLogEntry[]) => {
    const next = Array.isArray(entry) ? entry : [entry];
    if (next.length === 0) return;
    set((state) => ({
      dispatchLog: [...state.dispatchLog, ...next],
    }));
    if (typeof fetch === 'function') {
      fetch('/api/dispatch/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  },

  clearDispatchLog: () => {
    set({ dispatchLog: [] });
    if (typeof fetch === 'function') {
      fetch('/api/dispatch/log', { method: 'DELETE' }).catch(() => {});
    }
  },

  updateDispatchLogNarration: (id: string, narration: Narration) => {
    set((state) => ({
      // Narration is part of the hashed entry: re-seal so the integrity hash stays valid.
      dispatchLog: state.dispatchLog.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e, narration };
        return { ...next, hash: dispatchLogHash(next) };
      }),
    }));
  },

  play: () => {
    if (!ensureResults(get)) return;
    const { timeIndex, dayIndex, workflow } = get();
    const atEnd = timeIndex >= 23 && dayIndex >= workflow.length - 1;
    if (atEnd) get().setDayIndex(0);
    set({
      isPlaying: true,
      playbackStatus: 'playing',
      timeIndex: timeIndex >= 23 ? 0 : timeIndex,
    });
  },

  pause: () => {
    set({
      isPlaying: false,
      playbackStatus: 'paused',
    });
  },

  stop: () => {
    get().setDayIndex(0);
    set({
      isPlaying: false,
      playbackStatus: 'stopped',
      timeIndex: 0,
    });
  },

  restart: () => {
    if (!ensureResults(get)) return;
    get().setDayIndex(0);
    set({ timeIndex: 0, isPlaying: true, playbackStatus: 'playing' });
  },

  addWorkflowDay: (weather?: WeatherId, events?: ScenarioEvent[]) => {
    const { workflow } = get();
    if (workflow.length >= MAX_WORKFLOW_DAYS) return;
    const next = weather ?? workflow[workflow.length - 1]?.weather ?? 'sunny';
    commitWorkflow(set, get, {
      workflow: [
        ...workflow,
        {
          weather: next,
          ...(events && events.length > 0 ? { events } : {}),
        },
      ],
    });
  },

  loadChaosWorkflow: (seed?: number, days?: number) => {
    const chaosSeed = seed ?? Math.floor(Date.now() % 100000);
    const chaosWorkflow = generateChaosWorkflow({ seed: chaosSeed, days: days ?? 3 });
    commitWorkflow(set, get, {
      workflow: chaosWorkflow,
      dayIndex: 0,
    });
  },

  loadDraft: (draft: ScenarioDraft, mode?: DispatchMode) => {
    const { workflow, startSocPct, strategy, dispatchMode } = draftToWorkflow(draft);
    const targetMode = mode ?? draft.dispatchMode ?? dispatchMode ?? 'manual';
    const currentInput = get().input;
    const patchedInput: SimulationInput = {
      ...cloneInput(currentInput),
      scenarioId: 'custom',
      battery: {
        ...currentInput.battery,
        initialSocPct: startSocPct,
      },
    };

    set({
      scenarioId: 'baseline',
      source: 'scenario',
      input: patchedInput,
      activeStrategy: strategy,
      dispatchMode: targetMode,
      dispatchLog: [],
      changeHistory: [],
      dayIndex: 0,
      timeIndex: 0,
      isPlaying: false,
      playbackStatus: 'idle',
      status: 'ready',
      error: null,
    });

    commitWorkflow(set, get, {
      workflow,
      dayIndex: 0,
    });
    // Launch = run + play: without it the page opens on a stale "modified" run and nothing moves,
    // so the autonomous dispatcher never sees an hour tick.
    get().play();
  },

  removeWorkflowDay: (day: number) => {
    const { workflow, dayIndex } = get();
    if (workflow.length <= 1 || day < 0 || day >= workflow.length) return;
    const nextWorkflow = workflow.filter((_, i) => i !== day);
    commitWorkflow(set, get, {
      workflow: nextWorkflow,
      dayIndex: clampDay(day < dayIndex ? dayIndex - 1 : dayIndex, nextWorkflow.length),
    });
  },

  setDayWeather: (day: number, weather: WeatherId) => {
    const { workflow } = get();
    if (day < 0 || day >= workflow.length || workflow[day]?.weather === weather) return;
    commitWorkflow(set, get, {
      workflow: workflow.map((d, i) => (i === day ? { weather } : d)),
    });
  },

  setDayIndex: (day: number) => {
    const { workflow, workflowResults } = get();
    const dayIndex = clampDay(day, workflow.length);
    set({ dayIndex, results: dayComparison(workflowResults, dayIndex) });
  },

  advancePlayback: () => {
    const { timeIndex, dayIndex, workflow, setDayIndex, input, activeStrategy } = get();
    if (timeIndex < 23) {
      set({ timeIndex: timeIndex + 1 });
      return;
    }
    const nextDay = dayIndex + 1 < workflow.length ? dayIndex + 1 : 0;
    // A fire burns until the sector is restored: one still burning at 23 h goes on past midnight.
    const carried = carryFiresOver(input, workflow, dayIndex, nextDay);
    if (carried) {
      try {
        set({ workflow: carried.workflow });
        commitInput(set, get, carried.input, activeStrategy);
      } catch (err) {
        failRun(set, err, 'Failed to carry the fire over midnight');
        return;
      }
    }
    setDayIndex(nextDay);
    set({ timeIndex: 0 });
  },

  togglePlay: () => {
    if (get().isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  setPlaybackSpeed: (playbackSpeed: PlaybackSpeed) => {
    set({ playbackSpeed });
  },
}));
