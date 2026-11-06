/**
 * Hugging Face dataset export: deterministic engine runs + copilot evals
 * → mitsinjo-grid-dispatch-benchmark/ (gitignored, published with `make hf-publish`).
 *
 * Usage: make hf-dataset [-- --out <dir> --repo <namespace/slug>] (no token needed)
 * Direct: pnpm --filter @mitsinjo/engine exec jiti ../../scripts/export-hf-dataset.ts
 *
 * Output (8 scenarios × 3 strategies × 24 h, engine is deterministic):
 * - scenarios.jsonl: one scenario input per line ({scenario, title, description, input})
 * - results.jsonl: one hourly step per line ({scenario, strategy, run_id, hour, …kW…, sectors})
 * - copilot_evals.jsonl: the committed synthetic copilot evals, one per line
 * - README.md: dataset card (CC-BY-4.0, SIMULATED DATA banner)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCH_STRATEGIES,
  ENGINE_VERSION,
  SECTOR_IDS,
  scenarios,
  simulate,
  type ScenarioId,
  type SectorId,
  type SimulationInput,
  type StepResult,
  type StrategyId,
} from '../packages/engine/src/index';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');
export const DATASET_SLUG = 'mitsinjo-grid-dispatch-benchmark';
export const DEFAULT_OUT_DIR = join(REPO_ROOT, DATASET_SLUG);
const EVALS_PATH = join(REPO_ROOT, 'apps/web/src/server/copilot/__tests__/eval.synthetic.json');
/** Fallback HF repo id used for the dataset-card links; override with HF_DATASET_REPO. */
export const DEFAULT_DATASET_REPO = `Tokiarivelo/${DATASET_SLUG}`;

/** Expected tools, mirrored from apps/web/scripts/gen-evals.ts (source of truth). */
const EVAL_TOOLS = [
  'get_grid_state',
  'run_scenario',
  'compare_strategies',
  'get_battery_story',
  'simulate_week',
  'get_sector_metrics',
  'get_incidents',
  'propose_change',
] as const;

export interface CopilotEval {
  id: string;
  prompt: string;
  expectTool: (typeof EVAL_TOOLS)[number];
  expectEvidence: boolean;
}

export interface HfDatasetStats {
  outDir: string;
  scenarios: number;
  strategies: number;
  hours: number;
  results: number;
  evals: number;
  engineVersion: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Reads the committed synthetic evals, validating the gen-evals schema by hand (no zod here). */
export function readCopilotEvals(path: string = EVALS_PATH): CopilotEval[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`);
  return raw.map((item, i) => {
    const where = `${path}[${i}]`;
    if (!isRecord(item)) throw new Error(`${where}: expected an object`);
    if (typeof item.id !== 'string' || !/^syn-\d+$/.test(item.id))
      throw new Error(`${where}.id: expected "syn-<n>"`);
    if (typeof item.prompt !== 'string' || item.prompt.length < 10 || item.prompt.length > 300)
      throw new Error(`${where}.prompt: expected 10..300 chars`);
    if (
      typeof item.expectTool !== 'string' ||
      !(EVAL_TOOLS as readonly string[]).includes(item.expectTool)
    )
      throw new Error(`${where}.expectTool: expected one of ${EVAL_TOOLS.join('|')}`);
    if (typeof item.expectEvidence !== 'boolean')
      throw new Error(`${where}.expectEvidence: expected a boolean`);
    return item as unknown as CopilotEval;
  });
}

interface ScenarioRow {
  scenario: ScenarioId;
  title: string;
  description: string;
  input: SimulationInput;
}

function scenarioRow(id: ScenarioId): ScenarioRow {
  const def = scenarios[id];
  return { scenario: id, title: def.title, description: def.description, input: def.input };
}

interface ResultRow {
  scenario: ScenarioId;
  strategy: StrategyId;
  run_id: string;
  engine_version: string;
  hour: number;
  solar_kw: number;
  demand_kw: number;
  served_kw: number;
  unserved_kw: number;
  battery_kw: number;
  soc_pct: number;
  curtailed_kw: number;
  sectors: Record<
    SectorId,
    { demand_kw: number; served_kw: number; critical_served_kw: number; mode: string }
  >;
}

function resultRow(
  scenario: ScenarioId,
  strategy: StrategyId,
  runId: string,
  step: StepResult
): ResultRow {
  const sectors = Object.fromEntries(
    SECTOR_IDS.map((id) => {
      const s = step.sectors[id];
      if (s === undefined) throw new Error(`missing sector ${id} at hour ${step.t}`);
      return [
        id,
        {
          demand_kw: r3(s.demandKw),
          served_kw: r3(s.servedKw),
          critical_served_kw: r3(s.criticalServedKw),
          mode: s.mode,
        },
      ];
    })
  ) as ResultRow['sectors'];
  return {
    scenario,
    strategy,
    run_id: runId,
    engine_version: ENGINE_VERSION,
    hour: step.t,
    solar_kw: r3(step.solarKw),
    demand_kw: r3(step.demandKw),
    served_kw: r3(step.servedKw),
    unserved_kw: r3(step.unservedKw),
    battery_kw: r3(step.batteryKw),
    soc_pct: r2(step.socPct),
    curtailed_kw: r3(step.curtailedKw),
    sectors,
  };
}

function datasetReadme(
  repo: string,
  stats: { scenarios: number; results: number; evals: number }
): string {
  return `---
license: cc-by-4.0
tags:
- energy
- microgrid
- synthetic
- benchmark
---

# Mitsinjo Grid — dispatch benchmark

> **SIMULATED DATA** — every number in this dataset is produced by a deterministic TypeScript energy
> model of a fictional Malagasy village microgrid. No real meters, no real people, no personal data.

Hourly dispatch results for ${stats.scenarios} scenarios × 3 load-shedding strategies
(\`proportional\`, \`essential_first\`, \`balanced\`), plus the synthetic copilot evaluation prompts.
Source: [Tokiarivelo/mitsinjo-grid](https://github.com/Tokiarivelo/mitsinjo-grid) —
reproduce with \`make bench && make gen-evals && make hf-dataset\`.

## Files

| File | Rows | Content |
| ---- | ---- | ------- |
| \`scenarios.jsonl\` | ${stats.scenarios} | One scenario input per line: \`scenario\`, \`title\`, \`description\`, \`input\` (24 h horizon, 1 h steps, 6 sectors, 120 kWh battery unless the scenario says otherwise) |
| \`results.jsonl\` | ${stats.results} | One hourly step per line: \`scenario\`, \`strategy\`, \`run_id\` (engine \`SIM-…\` id), \`engine_version\`, \`hour\` (0–23), kW flows (\`solar_kw\`, \`demand_kw\`, \`served_kw\`, \`unserved_kw\`, \`battery_kw\` signed, \`curtailed_kw\`), \`soc_pct\`, and per-sector \`demand_kw\` / \`served_kw\` / \`critical_served_kw\` / \`mode\` |
| \`copilot_evals.jsonl\` | ${stats.evals} | Synthetic copilot prompts: \`id\`, \`prompt\`, \`expectTool\` (engine tool the copilot should call), \`expectEvidence\` (whether the answer must cite computed numbers) |

Day-level metrics (coverage %, unserved kWh) are derived by summing the hourly rows; see
[\`benchmarks/\`](https://github.com/Tokiarivelo/mitsinjo-grid/tree/main/benchmarks) for the
reference strategy A/B report.

## License

CC-BY-4.0. If you use this dataset, please link back to \`https://huggingface.co/datasets/${repo}\`.
`;
}

/** Builds the dataset folder. Pure function of the engine + the committed evals file. */
export function exportHfDataset(
  outDir: string = DEFAULT_OUT_DIR,
  repo: string = process.env.HF_DATASET_REPO || DEFAULT_DATASET_REPO
): HfDatasetStats {
  const evals = readCopilotEvals();
  const scenarioIds = Object.keys(scenarios) as ScenarioId[];
  const scenarioLines = scenarioIds.map((id) => JSON.stringify(scenarioRow(id)));

  const resultLines: string[] = [];
  for (const scenario of scenarioIds) {
    for (const strategy of BENCH_STRATEGIES) {
      const result = simulate(scenarios[scenario].input, strategy);
      if (result.steps.length !== 24) {
        throw new Error(`${scenario}/${strategy}: expected 24 steps, got ${result.steps.length}`);
      }
      for (const step of result.steps) {
        resultLines.push(JSON.stringify(resultRow(scenario, strategy, result.id, step)));
      }
    }
  }

  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'scenarios.jsonl'), `${scenarioLines.join('\n')}\n`);
  writeFileSync(join(out, 'results.jsonl'), `${resultLines.join('\n')}\n`);
  writeFileSync(
    join(out, 'copilot_evals.jsonl'),
    `${evals.map((e) => JSON.stringify(e)).join('\n')}\n`
  );
  const stats: HfDatasetStats = {
    outDir: out,
    scenarios: scenarioIds.length,
    strategies: BENCH_STRATEGIES.length,
    hours: 24,
    results: resultLines.length,
    evals: evals.length,
    engineVersion: ENGINE_VERSION,
  };
  writeFileSync(join(out, 'README.md'), datasetReadme(repo, stats));
  return stats;
}

function parseArgs(argv: string[]): { outDir: string; repo: string } {
  let outDir = DEFAULT_OUT_DIR;
  let repo = process.env.HF_DATASET_REPO || DEFAULT_DATASET_REPO;
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--out' && next) {
      outDir = next;
      i++;
    } else if (argv[i] === '--repo' && next) {
      repo = next;
      i++;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: make hf-dataset [-- --out <dir> --repo <namespace/slug>]');
      process.exit(0);
    }
  }
  return { outDir, repo };
}

if (process.argv[1]?.endsWith('export-hf-dataset.ts')) {
  const { outDir, repo } = parseArgs(process.argv.slice(2));
  const s = exportHfDataset(outDir, repo);
  console.log(
    `[hf-dataset] ${s.scenarios} scenarios × ${s.strategies} strategies × ${s.hours} h = ${s.results} result rows + ${s.evals} evals → ${s.outDir} (engine v${s.engineVersion})`
  );
}
