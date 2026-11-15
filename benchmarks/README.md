# Benchmarks

All numbers below are **simulated data** produced by the deterministic engine (`@mitsinjo/engine`).
Raw report: [`engine.json`](engine.json). Re-run with `make bench` (writes `engine.json`; Node 24, 200 runs per measure).
Hourly dataset (8 scenarios × 3 strategies × 24 h + copilot evals, CC-BY-4.0):
[`Tokiarivelo/mitsinjo-grid-dispatch-benchmark`](https://huggingface.co/datasets/Tokiarivelo/mitsinjo-grid-dispatch-benchmark)
on Hugging Face — rebuild with `make hf-dataset`, upload with `make hf-publish`.
The same run is a Vitest test (`packages/engine/src/__tests__/benchmark.test.ts`): it fails if essential-first
ever serves the health clinic worse than proportional shedding, or if any strategy breaks an energy invariant.

## 1. Engine latency (one 24 h day, 6 sectors)

| Scenario                  | `simulate` median / p95 (ms) | `compare` 3 strategies median / p95 (ms) |
| ------------------------- | ---------------------------- | ---------------------------------------- |
| Sunny Baseline Day        | 0.54 / 1.14                  | 1.54 / 3.21                              |
| Cloudy Afternoon Deficit  | 0.57 / 1.12                  | 1.64 / 2.53                              |
| Evening Demand Spike      | 0.54 / 0.82                  | 1.58 / 2.02                              |
| Degraded Battery Bank     | 0.56 / 0.88                  | 1.59 / 1.93                              |
| Severe Weather Stress     | 0.52 / 0.60                  | 1.61 / 1.90                              |
| Synthetic Meter Anomaly   | 0.53 / 0.77                  | 1.55 / 3.09                              |
| Village Fire              | 0.67 / 1.01                  | 1.83 / 3.73                              |
| Evening Overload & Outage | 0.62 / 1.25                  | 1.73 / 2.08                              |

A full three-strategy comparison stays under 4 ms p95, so every slider move and every copilot tool call
re-runs the whole day instead of using cached or estimated numbers.

## 2. Strategy A/B: health clinic coverage (% of clinic demand served)

| Scenario                 | Proportional | Essential-first | Balanced | Gain vs proportional |
| ------------------------ | ------------ | --------------- | -------- | -------------------- |
| Cloudy Afternoon Deficit | 98.8         | **99.7**        | 99.5     | +0.9 pt              |
| Degraded Battery Bank    | 88.0         | **90.2**        | 90.2     | +2.2 pt              |
| Severe Weather Stress    | 71.9         | **75.5**        | 74.4     | +3.6 pt              |

Scenarios without a deficit before a fire or outage (baseline, demand spike, meter anomaly, fire, overload) serve
the clinic at 100 % with every strategy.

## 3. Strategy A/B: critical loads (all critical sectors)

| Scenario                 | Critical coverage % (P / EF / B) | Hours with critical demand unmet (P / EF / B) | Unserved kWh (all strategies) |
| ------------------------ | -------------------------------- | --------------------------------------------- | ----------------------------- |
| Cloudy Afternoon Deficit | 99.6 / 100 / 100                 | 1 / 0 / 0                                     | 1.17                          |
| Degraded Battery Bank    | 93.1 / 93.1 / 93.4               | 6 / 5 / 4                                     | 9.86                          |
| Severe Weather Stress    | 73.7 / 73.3 / 73.9               | 12 / 11 / 10                                  | 39.28                         |
| Village Fire             | 95.3 / 95.3 / 95.3               | 4 / 4 / 4                                     | 11.00                         |
| Evening Overload         | 99.2 / 99.2 / 99.2               | 2 / 2 / 2                                     | 3.00                          |

The total energy short is the same whatever the strategy: the strategy only decides **who** is short.
Essential-first moves the shortfall away from the clinic first; under Severe Weather Stress this costs other
critical loads 0.4 pt of coverage. Balanced gives the fewest hours with critical demand unmet. This trade-off
is exactly what the copilot explains, with the run IDs as evidence.

## 4. Copilot evals (offline, `LLM_PROVIDER=mock`)

`pnpm --filter web exec vitest run src/server/copilot/__tests__/eval` → **96 / 96 checks pass**
(45 scripted cases + a synthetic battery). Each case asserts the right tool call, a `SIM-` run ID in the
evidence and the four answer sections (What happened · Computed evidence · Why it matters · Explore next).
3D shape quality has its own golden set: `make test-shape` (IoU, colour, 300 ms budget) and `make views-3d` (one object from its 2D drawings).
