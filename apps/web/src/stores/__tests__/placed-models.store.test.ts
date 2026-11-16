import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  simulate,
  compare,
  scenarios,
  type Appliance,
  type SimulationInput,
} from '@mitsinjo/engine';
import type { ObjectRecipe } from '@/lib/object-shape';
import { resetSimulationStore, useSimulationStore } from '../simulation.store';
import {
  footprint,
  liveApplianceIds,
  loadStoredModels,
  VILLAGE_UNITS_PER_M,
  sceneScale,
  usePlacedModelsStore,
  withoutDrawings,
  PLACED_MODELS_STORAGE_KEY,
  type PlacedModel,
} from '../placed-models.store';

const SAMPLE_RECIPE: ObjectRecipe = {
  proportions: { w: 1, h: 0.6, d: 0.5 },
  parts: [
    {
      shape: 'box',
      at: [0, 0, 0],
      size: [1, 1, 1],
      color: '#336699',
    },
  ],
};

describe('placed-models.store (PI-T1)', () => {
  beforeEach(() => {
    usePlacedModelsStore.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    usePlacedModelsStore.getState().clear();
    localStorage.clear();
  });

  describe('sceneScale', () => {
    it('scales houses to match village houses (~3.8)', () => {
      expect(sceneScale('house')).toBe(3.8);
      expect(sceneScale('building')).toBe(4.0);
    });

    it('scales vehicles realistically (~2.4)', () => {
      expect(sceneScale('vehicle')).toBe(2.4);
    });

    it('scales fridges / cabinets to ~1m (~1.0 unit)', () => {
      expect(sceneScale('cabinet')).toBe(1.0);
      expect(sceneScale('fridge')).toBe(1.0);
    });

    it('scales pumps and machines to ~0.9', () => {
      expect(sceneScale('machine')).toBe(0.9);
      expect(sceneScale('water_pump')).toBe(0.9);
    });

    it('stands an object at its typical height from its proportions (VS-T35)', () => {
      // A fridge (1.8 m) as tall as it is drawn: 0.9 scene units for a height-1 recipe.
      expect(sceneScale('cabinet', { w: 0.46, h: 1, d: 0.45 })).toBeCloseTo(
        1.8 * VILLAGE_UNITS_PER_M
      );
      // A wide house keeps the village's height (4 m), not its width, as the largest side.
      const s = sceneScale('house', { w: 1, h: 0.61, d: 0.83 });
      expect(s * 0.61).toBeCloseTo(4 * VILLAGE_UNITS_PER_M, 2);
    });

    it('grows a slim object until its width is plausible for its kind', () => {
      // Pump fixture: h 1, w 0.25 → 0.8 m tall would make it 0.2 m wide (< 0.3 m machine width).
      const s = sceneScale('machine', { w: 0.25, h: 1, d: 0.18 });
      expect((s * 0.25) / VILLAGE_UNITS_PER_M).toBeCloseTo(0.3, 2);
    });

    it('keeps the fixed largest side for flat water and unsized kinds', () => {
      expect(sceneScale('water', { w: 1, h: 0.04, d: 0.8 })).toBe(2.5);
      expect(sceneScale('other', { w: 1, h: 1, d: 1 })).toBe(1.0);
    });

    it('falls back safely for unknown archetypes', () => {
      expect(sceneScale(undefined)).toBe(1.0);
      expect(sceneScale('unknown_type')).toBe(1.0);
    });
  });

  describe('footprint', () => {
    it('computes bounding box and radius with scale 1', () => {
      const fp = footprint(SAMPLE_RECIPE, 1, 0);
      expect(fp.box.width).toBeCloseTo(1.0, 2);
      expect(fp.box.depth).toBeCloseTo(0.5, 2);
      expect(fp.radius).toBeCloseTo(Math.hypot(0.5, 0.25), 2);
    });

    it('scales bounds proportionally with scale factor', () => {
      const fp = footprint(SAMPLE_RECIPE, 2.0, 0);
      expect(fp.box.width).toBeCloseTo(2.0, 2);
      expect(fp.box.depth).toBeCloseTo(1.0, 2);
      expect(fp.radius).toBeCloseTo(Math.hypot(1.0, 0.5), 2);
    });

    it('swaps width and depth with 90 degree yaw', () => {
      const fp = footprint(SAMPLE_RECIPE, 1.0, Math.PI / 2);
      expect(fp.box.width).toBeCloseTo(0.5, 2);
      expect(fp.box.depth).toBeCloseTo(1.0, 2);
      expect(fp.radius).toBeCloseTo(Math.hypot(0.5, 0.25), 2);
    });
  });

  describe('store CRUD and localStorage persistence', () => {
    it('upserts and retrieves placed models', () => {
      const model: PlacedModel = {
        applianceId: 'vision-p1-fridge1',
        recipe: SAMPLE_RECIPE,
        yaw: 0.1,
        scale: 1.0,
        archetype: 'cabinet',
      };

      usePlacedModelsStore.getState().upsert(model);
      expect(usePlacedModelsStore.getState().getModel('vision-p1-fridge1')).toEqual(model);

      // Verify localStorage was updated
      const raw = localStorage.getItem(PLACED_MODELS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toMatchObject({
        'vision-p1-fridge1': {
          applianceId: 'vision-p1-fridge1',
          scale: 1.0,
        },
      });
    });

    it('drops the legacy derived scale on load, so the scene re-sizes from proportions', () => {
      localStorage.setItem(
        PLACED_MODELS_STORAGE_KEY,
        JSON.stringify({ a: { applianceId: 'a', recipe: SAMPLE_RECIPE, scale: 3.8 } })
      );
      const loaded = loadStoredModels();
      expect(loaded.a).toBeDefined();
      expect(loaded.a!.scale).toBeUndefined();
    });

    it('removes placed models', () => {
      const model: PlacedModel = {
        applianceId: 'vision-p1-fridge1',
        recipe: SAMPLE_RECIPE,
      };

      usePlacedModelsStore.getState().upsert(model);
      expect(usePlacedModelsStore.getState().getModel('vision-p1-fridge1')).toBeDefined();

      usePlacedModelsStore.getState().remove('vision-p1-fridge1');
      expect(usePlacedModelsStore.getState().getModel('vision-p1-fridge1')).toBeUndefined();
    });

    it('syncWithAppliances prunes models no longer in the active list', () => {
      usePlacedModelsStore.getState().upsert({
        applianceId: 'app1',
        recipe: SAMPLE_RECIPE,
      });
      usePlacedModelsStore.getState().upsert({
        applianceId: 'app2',
        recipe: SAMPLE_RECIPE,
      });

      usePlacedModelsStore.getState().syncWithAppliances(['app1']);
      expect(usePlacedModelsStore.getState().getModel('app1')).toBeDefined();
      expect(usePlacedModelsStore.getState().getModel('app2')).toBeUndefined();
    });
  });

  describe('Engine Invariance (Non-negotiable rule)', () => {
    it('simulation results and hashes are identical with and without placed 3D models', () => {
      const pump: Appliance = {
        id: 'vision-photo1-pump1',
        name: 'Irrigation Pump',
        category: 'water_pump',
        sector: 'water',
        watts: 750,
        quantity: 2,
        position: { x: 5, z: -5 },
      };

      const input: SimulationInput = {
        ...scenarios.baseline.input,
        appliances: [pump],
      };

      // 1. Run engine without placed model
      const resultBefore = simulate(input, 'proportional');
      const compareBefore = compare(input, ['proportional', 'essential_first']);

      // 2. Put 3D placed model in web store
      usePlacedModelsStore.getState().upsert({
        applianceId: pump.id,
        recipe: SAMPLE_RECIPE,
        yaw: 0.5,
        scale: 1.2,
        archetype: 'machine',
      });

      // 3. Run engine again
      const resultAfter = simulate(input, 'proportional');
      const compareAfter = compare(input, ['proportional', 'essential_first']);

      // 4. Exact equality verification
      expect(resultAfter.metrics).toEqual(resultBefore.metrics);
      expect(resultAfter.inputHash).toBe(resultBefore.inputHash);
      expect(resultAfter.id).toBe(resultBefore.id);
      expect(resultAfter.steps).toEqual(resultBefore.steps);
      expect(compareAfter.proportional?.metrics).toEqual(compareBefore.proportional?.metrics);
      expect(compareAfter.proportional?.inputHash).toBe(compareBefore.proportional?.inputHash);
      expect(compareAfter.essential_first?.metrics).toEqual(compareBefore.essential_first?.metrics);
      expect(compareAfter.essential_first?.inputHash).toBe(
        compareBefore.essential_first?.inputHash
      );
    });
  });

  describe('pruning with the simulation (syncWithAppliances wiring)', () => {
    const pump: Appliance = {
      id: 'vision-p1-pump',
      name: 'Pump',
      category: 'water_pump',
      sector: 'water',
      watts: 750,
      quantity: 1,
    };
    const insertPumpWithModel = () => {
      useSimulationStore.getState().applyProposal({ appliances: [pump] });
      usePlacedModelsStore.getState().upsert({ applianceId: pump.id, recipe: SAMPLE_RECIPE });
    };

    beforeEach(() => resetSimulationStore());

    it('liveApplianceIds = current appliances + those an undo can restore', () => {
      const s = useSimulationStore.getState();
      expect(
        liveApplianceIds({ input: { ...s.input, appliances: [pump] }, changeHistory: [] })
      ).toEqual([pump.id]);
      expect(
        liveApplianceIds({
          input: { ...s.input, appliances: [] },
          changeHistory: [
            {
              id: 'c1',
              before: { input: { ...s.input, appliances: [pump] }, strategy: 'proportional' },
            },
          ],
        })
      ).toEqual([pump.id]);
    });

    const settle = () => new Promise<void>((r) => queueMicrotask(r));

    it('loading a scenario drops models of appliances that are gone', async () => {
      insertPumpWithModel();
      await settle();
      expect(usePlacedModelsStore.getState().getModel(pump.id)).toBeDefined();
      useSimulationStore.getState().loadScenario('baseline');
      await settle();
      expect(usePlacedModelsStore.getState().getModel(pump.id)).toBeUndefined();
    });

    it('keeps the model while an undo can bring the appliance back', async () => {
      insertPumpWithModel();
      useSimulationStore.getState().approveChange('rm', { appliances: [] });
      await settle();
      expect(usePlacedModelsStore.getState().getModel(pump.id)).toBeDefined();
      useSimulationStore.getState().undoLastChange();
      await settle();
      expect(useSimulationStore.getState().input.appliances?.map((a) => a.id)).toEqual([pump.id]);
      expect(usePlacedModelsStore.getState().getModel(pump.id)).toBeDefined();
    });
  });
});

describe('withoutDrawings (PQ-T71)', () => {
  it('drops the drawings of every model and keeps everything else', () => {
    const drawn: PlacedModel = {
      applianceId: 'a',
      recipe: {
        ...SAMPLE_RECIPE,
        faces: {
          atlas: 'data:image/png;base64,AAAA',
          views: ['front'],
          hull: { grid: [4, 4, 4], boxes: [[0, 4, 0, 4, 0, 4]] },
        },
      },
      yaw: 0.2,
    };
    const out = withoutDrawings({ a: drawn });
    expect(out.a!.recipe.faces).toBeUndefined();
    expect(out.a!.recipe.parts).toEqual(SAMPLE_RECIPE.parts);
    expect(out.a!.yaw).toBe(0.2);
    expect(drawn.recipe.faces).toBeDefined();
  });
});
