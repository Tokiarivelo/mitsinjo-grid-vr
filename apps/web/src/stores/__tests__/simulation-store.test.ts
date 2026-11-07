import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchLogHash, type SimulationInput } from '@mitsinjo/engine';
import { resetSimulationStore, useSimulationStore } from '../simulation.store';
import {
  selectActiveMetrics,
  selectActiveResult,
  selectActiveSteps,
  selectActiveStrategy,
  selectActiveWarnings,
  selectComparison,
  selectHasResults,
  selectInput,
  selectIsModified,
  selectIsPlaying,
  selectPlaybackStatus,
  selectScenarioId,
  selectSectorMetrics,
  selectStatus,
  selectStepAtTime,
  selectTimeIndex,
  selectDispatchMode,
  selectDispatchLog,
} from '../selectors';

describe('useSimulationStore & selectors (P4-T1)', () => {
  beforeEach(() => {
    resetSimulationStore();
  });

  it('initializes with default baseline preset, ready status, and empty results', () => {
    const state = useSimulationStore.getState();
    expect(selectScenarioId(state)).toBe('baseline');
    expect(selectStatus(state)).toBe('ready');
    expect(selectIsModified(state)).toBe(false);
    expect(selectHasResults(state)).toBe(false);
    expect(selectActiveStrategy(state)).toBe('proportional');
    expect(selectActiveResult(state)).toBeUndefined();
    expect(selectActiveMetrics(state)).toBeNull();
    expect(selectActiveSteps(state)).toEqual([]);
    expect(selectActiveWarnings(state)).toEqual([]);
    expect(selectTimeIndex(state)).toBe(12);
  });

  it('loads another scenario and resets state to ready with empty results', () => {
    const store = useSimulationStore.getState();
    store.loadScenario('cloudy_afternoon');

    const updated = useSimulationStore.getState();
    expect(selectScenarioId(updated)).toBe('cloudy_afternoon');
    expect(selectStatus(updated)).toBe('ready');
    expect(selectHasResults(updated)).toBe(false);
    expect(selectInput(updated).battery.initialSocPct).toBe(35);
    expect(selectInput(updated).events).toHaveLength(1);
  });

  it('patches input and marks status as modified', () => {
    const store = useSimulationStore.getState();
    store.patchInput({ solarDropPct: 30, dropStartHour: 12, dropDurationH: 3 });

    const updated = useSimulationStore.getState();
    expect(selectStatus(updated)).toBe('modified');
    expect(selectIsModified(updated)).toBe(true);
    expect(selectInput(updated).events.some((e) => e.type === 'solar_drop')).toBe(true);
  });

  it('resets modified scenario back to pristine preset', () => {
    const store = useSimulationStore.getState();
    store.loadScenario('cloudy_afternoon');
    store.patchInput({ solarDropPct: 50 });
    expect(useSimulationStore.getState().status).toBe('modified');

    useSimulationStore.getState().reset();
    const resetState = useSimulationStore.getState();
    expect(selectStatus(resetState)).toBe('ready');
    expect(selectScenarioId(resetState)).toBe('cloudy_afternoon');
    expect(selectInput(resetState).battery.initialSocPct).toBe(35);
  });

  it('runs simulation, populates results, and sets status to complete', () => {
    const store = useSimulationStore.getState();
    store.run(['proportional', 'essential_first']);

    const updated = useSimulationStore.getState();
    expect(selectStatus(updated)).toBe('complete');
    expect(selectHasResults(updated)).toBe(true);

    const comparison = selectComparison(updated);
    expect(comparison.proportional).toBeDefined();
    expect(comparison.essential_first).toBeDefined();

    const activeResult = selectActiveResult(updated);
    expect(activeResult).toBeDefined();
    expect(activeResult?.strategy).toBe('proportional');
    expect(activeResult?.steps).toHaveLength(24);

    const metrics = selectActiveMetrics(updated);
    expect(metrics).not.toBeNull();
    expect(metrics?.violations).toBe(0);

    const steps = selectActiveSteps(updated);
    expect(steps).toHaveLength(24);

    const stepAtNoon = selectStepAtTime(updated, 12);
    expect(stepAtNoon).not.toBeNull();
    expect(stepAtNoon?.t).toBe(12);

    const healthMetrics = selectSectorMetrics('health')(updated);
    expect(healthMetrics).not.toBeNull();
    expect(healthMetrics?.demandKwh).toBeGreaterThan(0);
  });

  it('verifies demo-hero contrast via store on cloudy_afternoon', () => {
    const store = useSimulationStore.getState();
    store.loadScenario('cloudy_afternoon');
    store.run(['proportional', 'essential_first']);

    const updated = useSimulationStore.getState();
    const results = selectComparison(updated);

    const prop = results.proportional!;
    const ess = results.essential_first!;

    expect(prop.metrics.criticalUnservedKwh).toBeGreaterThan(0);
    expect(ess.metrics.criticalUnservedKwh).toBe(0);
    expect(ess.metrics.criticalCoveragePct).toBe(100);
  });

  it('clamps timeIndex between 0 and 23', () => {
    const store = useSimulationStore.getState();
    store.setTimeIndex(42);
    expect(selectTimeIndex(useSimulationStore.getState())).toBe(23);

    store.setTimeIndex(-5);
    expect(selectTimeIndex(useSimulationStore.getState())).toBe(0);

    store.setTimeIndex(15.7);
    expect(selectTimeIndex(useSimulationStore.getState())).toBe(15);
  });

  it('updates playbackSpeed via setPlaybackSpeed', () => {
    const store = useSimulationStore.getState();
    expect(store.playbackSpeed).toBe(1);

    store.setPlaybackSpeed(0.5);
    expect(useSimulationStore.getState().playbackSpeed).toBe(0.5);

    store.setPlaybackSpeed(0.25);
    expect(useSimulationStore.getState().playbackSpeed).toBe(0.25);
  });

  it('selects active strategy and sector', () => {
    const store = useSimulationStore.getState();
    store.selectStrategy('essential_first');
    expect(selectActiveStrategy(useSimulationStore.getState())).toBe('essential_first');

    store.selectSector('health');
    expect(useSimulationStore.getState().selectedSector).toBe('health');
  });

  it('applyProposal applies patch, runs simulation, and sets status to complete', () => {
    const store = useSimulationStore.getState();
    store.applyProposal({ solarDropPct: 40 });

    const updated = useSimulationStore.getState();
    expect(selectStatus(updated)).toBe('complete');
    expect(selectHasResults(updated)).toBe(true);
    expect(selectInput(updated).events.some((e) => e.type === 'solar_drop')).toBe(true);
  });

  describe('approved change history (M1-T4)', () => {
    it('approve then undo restores the initial input and strategy', () => {
      const initial = structuredClone(selectInput(useSimulationStore.getState()));
      const store = useSimulationStore.getState();
      store.approveChange('p1', { solarDropPct: 40 }, 'essential_first');

      let state = useSimulationStore.getState();
      expect(state.changeHistory.map((c) => c.id)).toEqual(['p1']);
      expect(state.activeStrategy).toBe('essential_first');
      expect(state.input).not.toEqual(initial);

      expect(state.undoLastChange()).toBe('p1');
      state = useSimulationStore.getState();
      expect(state.input).toEqual(initial);
      expect(state.activeStrategy).toBe('proportional');
      expect(state.changeHistory).toEqual([]);
      expect(selectStatus(state)).toBe('complete');
    });

    it('undoes changes last-first and returns null when nothing is left', () => {
      const store = useSimulationStore.getState();
      store.approveChange('p1', { solarDropPct: 40 });
      const afterFirst = structuredClone(useSimulationStore.getState().input);
      store.approveChange('p2', { solarDropPct: 70 });

      expect(useSimulationStore.getState().undoLastChange()).toBe('p2');
      expect(useSimulationStore.getState().input).toEqual(afterFirst);
      expect(useSimulationStore.getState().undoLastChange()).toBe('p1');
      expect(useSimulationStore.getState().undoLastChange()).toBeNull();
    });

    it('plain applyProposal is not recorded; loadScenario and reset clear the history', () => {
      const store = useSimulationStore.getState();
      store.applyProposal({ solarDropPct: 40 });
      expect(useSimulationStore.getState().changeHistory).toEqual([]);

      store.approveChange('p1', { solarDropPct: 40 });
      store.reset();
      expect(useSimulationStore.getState().changeHistory).toEqual([]);

      store.approveChange('p2', { solarDropPct: 40 });
      store.loadScenario('baseline');
      expect(useSimulationStore.getState().changeHistory).toEqual([]);
    });

    it('a failed change is not recorded', () => {
      const store = useSimulationStore.getState();
      store.approveChange('bad', { solarDropPct: 500 } as never);
      expect(useSimulationStore.getState().changeHistory).toEqual([]);
    });
  });

  it('controls simulation playback with play, pause, stop, and restart', () => {
    const store = useSimulationStore.getState();
    expect(selectIsPlaying(store)).toBe(false);
    expect(selectPlaybackStatus(store)).toBe('idle');

    // 1. Play from initial state triggers run and sets isPlaying
    store.play();
    let state = useSimulationStore.getState();
    expect(selectStatus(state)).toBe('complete');
    expect(selectIsPlaying(state)).toBe(true);
    expect(selectPlaybackStatus(state)).toBe('playing');

    // 2. Pause preserves time and sets isPlaying to false
    state.setTimeIndex(15);
    store.pause();
    state = useSimulationStore.getState();
    expect(selectIsPlaying(state)).toBe(false);
    expect(selectPlaybackStatus(state)).toBe('paused');
    expect(selectTimeIndex(state)).toBe(15);

    // 3. Stop resets time to 0 and stops playback
    store.stop();
    state = useSimulationStore.getState();
    expect(selectIsPlaying(state)).toBe(false);
    expect(selectPlaybackStatus(state)).toBe('stopped');
    expect(selectTimeIndex(state)).toBe(0);

    // 4. Restart sets time to 0 and begins playback
    state.setTimeIndex(18);
    store.restart();
    state = useSimulationStore.getState();
    expect(selectIsPlaying(state)).toBe(true);
    expect(selectPlaybackStatus(state)).toBe('playing');
    expect(selectTimeIndex(state)).toBe(0);

    // 5. TogglePlay flips playback state
    store.togglePlay();
    expect(selectIsPlaying(useSimulationStore.getState())).toBe(false);
    store.togglePlay();
    expect(selectIsPlaying(useSimulationStore.getState())).toBe(true);

    // 6. Play wraps to 0 if at end of cycle (hour 23)
    useSimulationStore.getState().setTimeIndex(23);
    store.play();
    expect(selectTimeIndex(useSimulationStore.getState())).toBe(0);
  });

  it('does not start playback when the run fails', () => {
    useSimulationStore.setState({
      input: { broken: true } as unknown as SimulationInput,
      status: 'modified',
    });
    useSimulationStore.getState().play();
    let state = useSimulationStore.getState();
    expect(selectStatus(state)).toBe('error');
    expect(selectIsPlaying(state)).toBe(false);

    useSimulationStore.getState().restart();
    state = useSimulationStore.getState();
    expect(selectIsPlaying(state)).toBe(false);
  });

  describe('dispatch mode & log (PA-T3a)', () => {
    it('initializes with manual dispatchMode and empty dispatchLog', () => {
      const state = useSimulationStore.getState();
      expect(selectDispatchMode(state)).toBe('manual');
      expect(selectDispatchLog(state)).toEqual([]);
    });

    it('sets dispatch mode to assisted or autonomous', () => {
      const store = useSimulationStore.getState();
      store.setDispatchMode('assisted');
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('assisted');

      store.setDispatchMode('autonomous');
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('autonomous');
    });

    it('takeBackControl immediately restores manual mode', () => {
      const store = useSimulationStore.getState();
      store.setDispatchMode('autonomous');
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('autonomous');

      store.takeBackControl();
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('manual');
    });

    it('appends entries to dispatchLog and clearDispatchLog clears them', () => {
      const store = useSimulationStore.getState();
      const entry = {
        id: 'test-1',
        day: 0,
        hour: 14,
        mode: 'autonomous' as const,
        origin: 'ai' as const,
        action: { kind: 'alert_only' as const },
        hash: 'abc1234567890def',
      };
      store.appendDispatchLog(entry);
      expect(selectDispatchLog(useSimulationStore.getState())).toHaveLength(1);
      expect(selectDispatchLog(useSimulationStore.getState())[0]?.id).toBe('test-1');

      store.clearDispatchLog();
      expect(selectDispatchLog(useSimulationStore.getState())).toHaveLength(0);
    });

    it('loadScenario and reset restore dispatchMode to manual and clear dispatchLog', () => {
      const store = useSimulationStore.getState();
      store.setDispatchMode('autonomous');
      store.appendDispatchLog({
        id: 'test-1',
        day: 0,
        hour: 14,
        mode: 'autonomous' as const,
        origin: 'ai' as const,
        action: { kind: 'alert_only' as const },
        hash: 'hash1',
      });

      store.loadScenario('village_fire');
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('manual');
      expect(selectDispatchLog(useSimulationStore.getState())).toHaveLength(0);

      store.setDispatchMode('autonomous');
      store.reset();
      expect(selectDispatchMode(useSimulationStore.getState())).toBe('manual');
      expect(selectDispatchLog(useSimulationStore.getState())).toHaveLength(0);
    });

    it('updateDispatchLogNarration sets the narration and re-seals the hash (PA-T5a)', () => {
      const store = useSimulationStore.getState();
      const draft = {
        id: 'narr-1',
        day: 0,
        hour: 14,
        mode: 'autonomous' as const,
        origin: 'ai' as const,
        action: { kind: 'alert_only' as const },
      };
      store.appendDispatchLog({ ...draft, hash: dispatchLogHash(draft) });

      store.updateDispatchLogNarration('narr-1', { text: 'Alert at 14:00.', source: 'llm' });
      const [entry] = selectDispatchLog(useSimulationStore.getState());
      expect(entry?.narration?.text).toBe('Alert at 14:00.');
      expect(entry?.hash).toBe(dispatchLogHash(entry!));
      expect(entry?.hash).not.toBe(dispatchLogHash(draft));
    });

    it('loadDraft sets workflow with per-day events and switches dispatch mode (PA-T8f)', () => {
      const store = useSimulationStore.getState();
      store.loadDraft(
        {
          days: [
            { day: 1, weather: 'cloudy' },
            { day: 2, weather: 'rainy' },
            {
              day: 3,
              weather: 'sunny',
              events: [
                {
                  type: 'fire',
                  sector: 'school',
                  startHour: 10,
                  durationH: 14,
                },
              ],
            },
          ],
        },
        'autonomous'
      );

      const next = useSimulationStore.getState();
      expect(next.dispatchMode).toBe('autonomous');
      expect(next.workflow).toHaveLength(3);
      expect(next.workflow[0]?.weather).toBe('cloudy');
      expect(next.workflow[1]?.weather).toBe('rainy');
      expect(next.workflow[2]?.weather).toBe('sunny');
      expect(next.workflow[2]?.events).toHaveLength(1);
      expect(next.workflow[2]?.events?.[0]?.type).toBe('fire');
      expect(next.dayIndex).toBe(0);
      expect(next.timeIndex).toBe(0);
    });

    it('loadDraft runs the engine and starts playback so the launch is visible (regression)', () => {
      useSimulationStore.getState().loadDraft(
        {
          days: [
            { day: 1, weather: 'rainy' },
            { day: 2, weather: 'sunny' },
          ],
        },
        'autonomous'
      );
      const next = useSimulationStore.getState();
      expect(next.status).toBe('complete');
      expect(next.workflow).toHaveLength(2);
      expect(Object.keys(next.results).length).toBeGreaterThan(0);
      expect(next.isPlaying).toBe(true);
      expect(next.playbackStatus).toBe('playing');
      expect(next.dispatchMode).toBe('autonomous');
    });
  });
});
