import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BENCH_STRATEGIES,
  ENGINE_VERSION,
  SECTOR_IDS,
  scenarios,
  simulate,
  type ScenarioId,
  type StrategyId,
  type StrategyOutcome,
} from '@mitsinjo/engine';
import { exportHfDataset } from '../../scripts/export-hf-dataset';

// The Hugging Face dataset (`make hf-dataset`) must be a faithful, deterministic export of the
// engine + the committed copilot evals, consistent with the published benchmarks/engine.json.

const EVALS = JSON.parse(
  readFileSync(
    new URL('../../apps/web/src/server/copilot/__tests__/eval.synthetic.json', import.meta.url),
    'utf8'
  )
) as { id: string; prompt: string; expectTool: string; expectEvidence: boolean }[];

interface Report {
  scenarios: { scenario: ScenarioId; outcome: Record<string, StrategyOutcome> }[];
}
const report = JSON.parse(
  readFileSync(new URL('../../benchmarks/engine.json', import.meta.url), 'utf8')
) as Report;

const outDir = mkdtempSync(join(tmpdir(), 'hf-dataset-'));
const stats = exportHfDataset(outDir);

const readLines = (name: string): Record<string, unknown>[] =>
  readFileSync(join(outDir, name), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('hf-dataset export', () => {
  it('writes exactly the four dataset files', () => {
    expect(readdirSync(outDir).sort()).toEqual([
      'README.md',
      'copilot_evals.jsonl',
      'results.jsonl',
      'scenarios.jsonl',
    ]);
    expect(stats).toMatchObject({ scenarios: 8, strategies: 3, hours: 24, results: 576 });
  });

  it('exports every scenario input unchanged', () => {
    const rows = readLines('scenarios.jsonl');
    expect(rows.map((r) => r.scenario).sort()).toEqual(Object.keys(scenarios).sort());
    for (const row of rows) {
      const id = row.scenario as ScenarioId;
      expect(row.input).toEqual(scenarios[id].input);
      expect(row.title).toBe(scenarios[id].title);
      expect(row.description).toBe(scenarios[id].description);
    }
  });

  it('exports hourly steps matching the engine, one row per scenario × strategy × hour', () => {
    const rows = readLines('results.jsonl');
    expect(rows).toHaveLength(8 * 3 * 24);
    const byKey = new Map(rows.map((r) => [`${r.scenario}/${r.strategy}/${r.hour}`, r]));
    for (const scenario of Object.keys(scenarios) as ScenarioId[]) {
      for (const strategy of BENCH_STRATEGIES) {
        const result = simulate(scenarios[scenario].input, strategy);
        for (const step of result.steps) {
          const row = byKey.get(`${scenario}/${strategy}/${step.t}`);
          expect(row).toBeDefined();
          expect(row?.run_id).toBe(result.id);
          expect(row?.engine_version).toBe(ENGINE_VERSION);
          expect(row?.solar_kw).toBeCloseTo(step.solarKw, 3);
          expect(row?.demand_kw).toBeCloseTo(step.demandKw, 3);
          expect(row?.served_kw).toBeCloseTo(step.servedKw, 3);
          expect(row?.unserved_kw).toBeCloseTo(step.unservedKw, 3);
          expect(row?.battery_kw).toBeCloseTo(step.batteryKw, 3);
          expect(row?.soc_pct).toBeCloseTo(step.socPct, 2);
          expect(row?.curtailed_kw).toBeCloseTo(step.curtailedKw, 3);
          const sectors = row?.sectors as Record<string, Record<string, number | string>>;
          for (const id of SECTOR_IDS) {
            const actual = sectors[id];
            const expected = step.sectors[id];
            if (actual === undefined || expected === undefined)
              throw new Error(`missing sector ${id}`);
            expect(actual.demand_kw).toBeCloseTo(expected.demandKw, 3);
            expect(actual.served_kw).toBeCloseTo(expected.servedKw, 3);
            expect(actual.critical_served_kw).toBeCloseTo(expected.criticalServedKw, 3);
            expect(actual.mode).toBe(expected.mode);
          }
        }
      }
    }
  });

  it('hourly unserved energy sums match the published benchmark report', () => {
    const rows = readLines('results.jsonl');
    const sums = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.scenario}/${row.strategy}`;
      sums.set(key, (sums.get(key) ?? 0) + (row.unserved_kw as number));
    }
    for (const { scenario, outcome } of report.scenarios) {
      for (const strategy of BENCH_STRATEGIES as readonly StrategyId[]) {
        expect(sums.get(`${scenario}/${strategy}`)).toBeCloseTo(outcome[strategy]!.unservedKwh, 1);
      }
    }
  });

  it('exports the committed copilot evals unchanged', () => {
    expect(readLines('copilot_evals.jsonl')).toEqual(EVALS);
  });

  it('ships a dataset card with license, tags and the simulated-data banner', () => {
    const readme = readFileSync(join(outDir, 'README.md'), 'utf8');
    expect(readme).toMatch(
      /^---\nlicense: cc-by-4\.0\ntags:\n- energy\n- microgrid\n- synthetic\n- benchmark\n---\n/
    );
    expect(readme).toContain('SIMULATED DATA');
    expect(readme).toContain('mitsinjo-grid-dispatch-benchmark');
  });
});
