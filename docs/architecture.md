# Architecture

## 1. Choice and why

**Light monorepo: pnpm workspace + Turborepo, one app + one pure package.**
Pattern: Turborepo, feature-sliced Next app, pages = imports only,
trimmed for a solo 10-day build: no NestJS, no DB, no Python, no shared-config package.

| Option                                        | Verdict     | Reason                                                                                      |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Single Next app, engine in `lib/`             | OK fallback | Fastest, but engine can leak React/DOM deps                                                 |
| **apps/web + packages/engine**                | **Chosen**  | Engine isolation enforced by package boundary; tested alone; same code runs client + server |
| Next + NestJS + Python                        | Rejected    | 3 runtimes, JSON contracts, deploy cost; no gain at this scale                              |
| Separate `ai-agent` / `shared-types` packages | Rejected    | One consumer each → merged (agent in `web/src/server`, types = engine Zod schemas)          |

## 2. Tree

```text
mitsinjo-grid/
├── CLAUDE.md  AGENTS.md  HANDOFF.md  README.md  LICENSE  .env.example
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
├── .github/workflows/ci.yml            # parallel jobs: static (format/typecheck/lint), tests ×3 shards, build, e2e
├── .github/actions/setup/              # shared CI setup: pnpm (packageManager), Node 22, frozen install
├── docs/                               # agent docs (see docs/README.md)
├── scripts/                            # shell helpers called by the Makefile (env.sh: load .env)
├── benchmarks/                         # engine.json (make bench) + README: latency, strategy A/B
├── tests/                              # @mitsinjo/tests — cross-package integration (make test-integration)
├── packages/
│   └── engine/                         # @mitsinjo/engine — pure TS, deps: zod only
│       └── src/
│           ├── schemas/                # Zod: input, result, tools (types inferred)
│           ├── model/                  # solar.ts, demand.ts, battery.ts, step.ts
│           ├── strategies/             # proportional.ts, essential-first.ts, balanced.ts, index.ts
│           ├── metrics/                # aggregate.ts, warnings.ts
│           ├── scenarios/              # baseline, cloudy-afternoon, … (typed presets)
│           ├── simulate.ts  compare.ts  hash.ts
│           ├── index.ts                # public API — the only import path
│           └── __tests__/
└── apps/
    ├── bridge/                         # local-only Node service for the physical scale model (PH):
    │                                   #   MQTT (embedded aedes broker) ⇄ engine ⇄ WebSocket :8787; never deployed
    └── web/                            # Next.js 15 App Router
        ├── e2e/                        # Playwright: demo-path.spec.ts, copilot-flows.spec.ts (M6-T2)
        └── src/
            ├── app/
            │   ├── layout.tsx  globals.css (@theme tokens)  page.tsx → redirect /overview
            │   ├── (lab)/layout.tsx    # AppShell
            │   ├── (lab)/{overview,simulation,strategies,scenarios,copilot,village}/page.tsx
            │   ├── design/page.tsx     # UI kit catalog (renders features/design-system)
            │   ├── api/copilot/route.ts
            │   ├── api/voice/route.ts  # chat microphone → transcribe (Meta Voice / mock)
            │   ├── api/vision/route.ts # photo → appliances (Muse boxes, SAM outlines / mock), SSE
            │   └── api/vision/shape/route.ts # selected object → 3D recipe (Spark) or silhouette fallback, JSON
            │   └── api/vision/shape/blender/route.ts # recipe → Blender Python script (download)
            ├── features/
            │   ├── overview/           # ui/ hooks/ utils/ __tests__/ index.ts
            │   ├── simulation/         # controls, run/reset, timeline
            │   ├── microgrid-3d/       # R3F scene, dynamic(ssr:false) + 2D fallback
            │   ├── strategy-lab/
            │   ├── scenarios/          # cards, assumptions, export summary
            │   ├── copilot/            # chat UI, useCopilot, proposal dialog
            │   ├── hardware-link/      # scale-model bridge link (WebSocket hook + panel), local only
            │   ├── vision-insert/      # /village editor + chat dialog: photo → appliance detection (PV), calls /api/vision
            │   └── design-system/      # /design UI kit catalog
            ├── components/{ui,layout,charts}/
            ├── stores/simulation.store.ts   # single source of UI state
            ├── server/copilot/         # server-only: provider, tools, prompts, loop, adaptive model router
            ├── server/perception/      # server-only: voice / vision / SAM clients (Meta + deterministic mock)
            │   └── recon/              # views → 3D (PQ-T69): pure math (views, palette, carve, recipe, score) + route.ts (drawing, naming)
            ├── server/media/           # server-only: engine result → image prompts + overlays (M5-T1, pure)
            ├── server/spend/           # server-only: estimated Meta spend per session, cap → mock
            ├── server/storage/         # server-only: R2 media (uploads, generated images), re-signed on session reopen
            ├── messages/{en,fr,mg}.json     # i18n copy (key parity enforced)
            └── lib/{env.ts,format.ts,utils.ts,i18n.tsx}
```

Create folders when first needed, not up front.

## 3. Data flow

```text
 Controls / Scenario preset / Approved AI proposal
                │  SimulationInput (Zod-valid)
                ▼
     useSimulationStore.run()  ──►  engine.compare(input, strategies)  (client, <10 ms)
                │  results: Record<StrategyId, SimulationResult>
     ┌──────────┼──────────────┬──────────────┐
     ▼          ▼              ▼              ▼
 MetricCards  Charts      3D scene        Strategy Lab      ← all read the SAME result

 Chat ─► POST /api/copilot {messages, input} ─► server loop:
          LLM ⇄ tools (get_grid_state, run_scenario, compare_strategies, get_sector_metrics, propose_change)
          tools call engine server-side (re-compute from input, never trust client numbers)
       ◄─ stream: text + tool activity + evidence {resultId, fields} + optional proposal
 Proposal ─► ConfirmProposalDialog ─► user approves ─► store.setInput() ─► run()
```

Scale model (local, `docs/maquette-physique.md`):

```text
 ESP32 ─MQTT telemetry─► apps/bridge: BridgeSession → scaleTelemetry → simulate → toHardwareCommand
       ◄─MQTT command──┘          └─ WebSocket {type:'state', state: BridgeState} ─► web features/hardware-link
 web: useHardwareLink (reconnect 3 s) ─► store.applyDeviceRun ─► engine.compareWorkflow (numbers re-computed in the app)
```

## 4. Ownership boundaries

| Layer               | May                                       | May not                                                                                      |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/engine`   | compute all numbers, validate input       | import React/Next, fetch, read env                                                           |
| `stores/`           | hold input, status, results, selection    | compute energy values                                                                        |
| `features/*/ui`     | render props                              | call engine or store directly (use hooks)                                                    |
| `features/*/hooks`  | read store, call engine via store actions | fetch LLM except `copilot/hooks`, `vision-insert/hooks` (`/api/vision`, `/api/vision/shape`) |
| `server/copilot`    | call LLM + engine, validate tool args     | be imported by client code                                                                   |
| `server/perception` | report what a model heard / saw           | compute energy values, apply changes                                                         |
| `server/media`      | turn engine results into prompts/overlays | put numbers in prompts, call the LLM                                                         |
| 3D scene            | map result fields → visuals               | derive or interpolate energy values                                                          |
| `apps/bridge`       | place frames on the sim clock, I/O        | compute energy values (calls the engine)                                                     |

## 5. Store shape (summary; types in contracts.md)

`{ scenarioId, input, status, results, activeStrategy, selectedSector, timeIndex }`
actions: `loadScenario, patchInput, run, reset, selectStrategy, selectSector, setTimeIndex, applyProposal`.
`patchInput` sets `status='modified'`; `run` sets `complete`. Selectors live in `stores/selectors.ts`.

## 6. Deployment

Vercel project `mitsinjo-grid` (Next native, Node 22, root directory `apps/web`; pnpm installs the whole workspace,
the engine ships as TS source via `transpilePackages`). **Only `main` deploys:** a push to `main` → production;
`apps/web/vercel.json` `ignoreCommand` skips every other branch (no previews). Manual fallback: `make deploy`
(`scripts/deploy.sh`, refuses unless on a clean `main` equal to `origin/main`).
Env (Vercel → Production): `LLM_PROVIDER=meta|mock` (currently `mock`), `META_API_KEY`, `META_MODEL`, `META_BASE_URL`.
Copilot route: `runtime='nodejs'`, rate limit per IP (in-memory, demo-grade), timeout 20 s.
