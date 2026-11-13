# Mitsinjo Grid VR: Rural Solar Microgrid Simulation, AI Dispatch & Immersive VR Control

[![CI Status](https://github.com/Tokiarivelo/mitsinjo-grid-vr/actions/workflows/ci.yml/badge.svg)](https://github.com/Tokiarivelo/mitsinjo-grid-vr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15_App_Router-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Vitest-242_Tests_Passing-green)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E_Green-darkgreen)](https://playwright.dev/)

> **VR CONTROL (this fork):** this repository extends Mitsinjo Grid with immersive control of the whole microgrid in VR — walk the 3D village twin on Meta Quest, operate the EMS dispatch shelter and feeder breakers by hand, approve the AI dispatcher's proposals in place, and compare shedding strategies without leaving VR. Base project: [Tokiarivelo/mitsinjo-grid](https://github.com/Tokiarivelo/mitsinjo-grid). Status: in progress — the desktop demo path (solar drop → strategy comparison → AI explanation → computed evidence) keeps working unchanged.
>
> **⚠️ SIMULATED DATA NOTICE**: All energy metrics, solar generation curves, battery state-of-charge figures, and load balances presented in this system are synthetic and generated for simulation, educational, and decision-support purposes. They do not represent real-time measurements from physical microgrid hardware.

**Public Production Deployment**: [https://mitsinjo-grid.vercel.app](https://mitsinjo-grid.vercel.app)  
**Demo Video (2:53, YouTube)**: [https://youtu.be/GSu96kD7HRw](https://youtu.be/GSu96kD7HRw) · production plan in [video/VIDEO_PLAN.md](video/VIDEO_PLAN.md)  
[![Mitsinjo Grid demo video (2:53), click to watch on YouTube](docs/images/demo-thumbnail.jpg)](https://youtu.be/GSu96kD7HRw)

**Documentation**: [docs/](docs/) · [docs/assumptions.md](docs/assumptions.md) · [docs/demo-script.md](docs/demo-script.md) · [docs/known-limitations.md](docs/known-limitations.md) · [benchmarks/](benchmarks/) · [tests/](tests/) (integration)

**Manual test scenarios (539 checks, page by page, with screenshots)**: [docs/test-scenarios/](docs/test-scenarios/README.md): try every screen yourself, each check written as `action → expected result`.  
[![539 manual test scenarios across 8 pages: click through Mitsinjo Grid yourself](docs/images/test-scenarios-banner.jpg)](docs/test-scenarios/README.md)

### Hackathon submission at a glance

- **Provenance**: built 100 % from scratch during the Meta Global AI Hackathon 2026 window (first commit Oct 26, 2026); no pre-existing code.
- **Track**: Build for Your World · **Team**: solo (Indie Developer).
- **Bonus prizes targeted**: Best Agentic Use-Case (copilot tool loop + Autonomous AI dispatch mode with a guarded, logged, undoable action loop) · Best Creative Build (photo → SAM outlines → 3D village objects refined stage by stage by Muse Spark).
- **Not a 1-prompt wrapper**: every number comes from a deterministic TypeScript energy engine (1-hour steps, invariant checks, 3 shedding strategies); the LLM can only call engine tools, must cite the simulation run ID of each figure it quotes, and any grid action needs human approval (or the guarded autonomous mode). See [benchmarks/](benchmarks/) for the strategy A/B results.
- **Use of Meta products** (all at runtime, server-side):

  | Model                                         | Role                                                                                                         |
  | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | **Muse Spark** (Meta Model API)               | Copilot: tool calling over the engine, grounded explanations, scenario drafting, photo → appliance detection |
  | **SAM 3.1**                                   | Outlines each detected appliance and scenery object on the uploaded photo                                    |
  | **Muse Image**                                | 2D facade drawings that seed the 3D models; illustrated FR/MG load-shedding posters                          |
  | **Muse Wonder**                               | Final check and re-refinement stage of the 3D model loop                                                     |
  | **Muse Voice**                                | Chat voice input transcription (EN / FR / MG)                                                                |
  | **Muse Glimmer 30B** (open weights, optional) | Local step in the fallback chain Meta → Glimmer → offline mock (`GLIMMER_BASE_URL`, vLLM / Ollama)           |

- **Run it**: `docker compose up -d --build` → http://localhost:3000, offline mock by default (no key); live Meta models with your own key = 2 lines in `.env`. Steps, mock vs live, a 5-minute tour: [§ 8 Run It](#8-run-it-judges-start-here).

---

## 1. Problem: The Rural Microgrid Lifeline Dilemma

In off-grid rural communities across Madagascar and Sub-Saharan Africa, small solar-plus-storage microgrids (typically 30–50 kWp solar PV + 100–150 kWh battery storage) are the sole lifeline for essential civic and economic infrastructure.

When sudden monsoon cloud cover, severe weather, or high peak demands strike, battery reserves deplete rapidly. Traditional microgrid controllers rely on **naive proportional load shedding**, reducing power equally across all circuits by percentage.

Under proportional shedding, a severe deficit reduces power to the **Health Clinic** at the exact same rate as street markets and domestic lighting. An unexpected deficit can cut power to the clinic's vaccine refrigeration cold chain, incubator, and emergency lighting, risking catastrophic loss of life and supplies.

**Mitsinjo Grid** addresses this challenge with:

1. **Deterministic Microgrid Simulation**: Pure TypeScript simulation engine running identical, mathematically proven energy balance logic in under 3 ms on both client and server.
2. **Strategy Comparison Lab**: Direct quantitative comparison between proportional allocation, lexicographic essential-first priority, and balanced distribution. A parameters panel edits solar drop, demand, battery, per-sector priorities and power caps; all strategies re-run automatically.
3. **Meta AI Copilot**: Grounded AI assistant utilizing Meta Muse Spark with tool calling to inspect grid state, run counterfactual simulations, and provide evidence-backed dispatch recommendations.
4. **3D Village Digital Twin & Dispatch Controller**: Interactive spatial visualization of power flows, battery states, and infrastructure health. Golden-hour stylized village with an EMS dispatch controller shelter, real-time feeder breakers, continuous intensity-scaled lighting (street lamps, market garlands, window glow ∝ served kW), electron particle flow speeds ∝ power, and a fullscreen interactive 2D topology/circuit diagram with 100–400% zoom.
5. **Lifeline Survival Power (Courant de survie)**: Prevents total blackout across connected village sectors during supply deficits by guaranteeing minimum essential power floors (health 0.3 kW, water 0.2 kW, households 0.4 kW, school 0.1 kW, market 0.1 kW) with emergency failover prioritizing healthcare refrigeration and drinking water pumping.
6. **Complete Localization**: Zero static text, featuring full English, French, and native Malagasy (`MG`) translations with 100% key parity.
7. **Spatial Equipment Integration & Grid Derivations**: Add and position custom appliances or infrastructure into the 3D digital twin. Equipment blends organically with the village through automated tree clearings, draped red laterite yards, and catenary cable derivations supported by wooden utility poles (spaced $\le 4.5\text{ m}$) routing to branch lines or directly to the Central Dispatch EMS, complete with 2D schematic branches and animated electron particle flows.

---

## 2. Target Users & Personas

- **Local Microgrid Operators**: Rural technicians who need clear, jargon-free explanations of why load shedding is occurring and actionable guidance on how to preserve hospital power.
- **Village Energy Committees & Community Councils**: Local leaders in Madagascar seeking equitable, transparent trade-offs between household lighting, agricultural water pumping, and emergency health reserves.
- **Microgrid Engineers & Humanitarian Planners**: Practitioners modeling mini-grid resilience under climate shocks before deploying physical hardware.

---

## 3. Canonical Demo Path

The platform is designed around a single, robust demonstration path that highlights the interplay between physical energy balance and AI reasoning:

```text
[ 1. Weather Shock ]       40% solar drop at 13:00 (2 h) on a low battery; reserve (20%) is reached at 23:00.
         │
         ▼
[ 2. Strategy Lab ]        Proportional shedding cuts the Health Clinic below its essential need at 23:00.
         │                 Essential-First priority reroutes power, guaranteeing 100% lifeline coverage.
         ▼
[ 3. Meta AI Copilot ]     Operator asks "Why is the clinic receiving less energy?".
         │                 Copilot calls get_grid_state() & compare_strategies(), diagnosing the root cause.
         ▼
[ 4. Computed Evidence ]   AI streams structured evidence (with exact Simulation Run IDs) and
                           issues an interactive proposal to adopt the Essential-First strategy.
```

---

## 4. Architecture

```mermaid
flowchart TD
    subgraph Client ["Client Browser (Next.js 15 + React 19)"]
        UI["UI Layer\nTailwind 4 + shadcn/ui"]
        Store["Zustand Simulation Store\nClient State & Caching"]
        R3F["3D Digital Twin\nReact Three Fiber + Drei"]
        Charts["Analytics Charts\nRecharts"]
        i18n["next-intl\nEN / FR / MG"]
    end

    subgraph EnginePkg ["@mitsinjo/engine (Pure TypeScript)"]
        Sim["simulate() &\ncompare()"]
        Invariants["Invariants Verifier\nε = 1e-9"]
        Schemas["Zod Schemas\n(Source of Truth)"]
    end

    subgraph Server ["Server Backend (Next.js API Routes)"]
        Route["/api/copilot\nSSE Streaming & Rate Limiting"]
        Loop["Copilot Agent Loop\nMulti-turn Tool Calling"]
        Tools["Copilot Tools\nget_grid_state, compare_strategies..."]
        MetaProvider["Meta Muse Spark\nOpenAI-compatible Chat API"]
        MockProvider["Deterministic Mock\nOffline / Fallback Provider"]
    end

    UI --> Store
    Store --> Sim
    Sim --> Invariants
    Store --> R3F
    Store --> Charts
    UI --> i18n

    UI -- "SSE Chat Query" --> Route
    Route --> Loop
    Loop --> Tools
    Tools --> Sim
    Loop -- "Tool Calling" --> MetaProvider
    MetaProvider -. "Fallback / Offline" .-> MockProvider
    Route -- "Text & Tool Streams" --> UI
```

### Core Architecture Principles

- **Engine Isolation**: `@mitsinjo/engine` has zero browser, React, or network dependencies. The exact same code runs synchronously in client state hooks (<3 ms) and inside the server-side Copilot tool executor.
- **Invariants Enforcement**: Energy conservation ($\sum P_{\text{in}} = \sum P_{\text{out}}$), battery capacity ceilings, and minimum SoC reserves are verified on every single hour step ($t \in [0, 23]$).
- **Grounding & Guardrails**: The LLM Copilot is mathematically sandboxed. It can never fabricate energy metrics; all numbers are fetched dynamically via tool calls to the engine.

---

## 5. Visual Tour

| Screen                              | Description                                                                                                                                                                                                                                    | Mockup / Screenshot                                                      |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| **Overview** (`/overview`)          | Incident screen: is the clinic at risk today, engine-computed impact (outage hour, hours, kWh), one CTA to the copilot, and essential coverage rings per strategy.                                                                             | [`design/stitch/overview.png`](design/stitch/overview.png)               |
| **Live Simulation** (`/simulation`) | 24-hour simulation runner with interactive sliders, 3D village digital twin, hourly telemetry table, timeline scrubber, and a simulated fire alarm (« Report a fire » → sector cut at once, red banner + snackbar, fire in 3D / 2D / circuit). | [`design/stitch/live-simulation.png`](design/stitch/live-simulation.png) |
| **Strategy Lab** (`/strategies`)    | Side-by-side comparison matrix of Proportional vs. Essential-First vs. Balanced strategies with delta highlights and decision summaries.                                                                                                       | [`design/stitch/strategy-lab.png`](design/stitch/strategy-lab.png)       |
| **AI Copilot** (`/copilot`)         | Streaming conversational copilot with 4-part structured reasoning, verifiable simulation IDs, and interactive one-click proposal cards.                                                                                                        | [`design/stitch/copilot.png`](design/stitch/copilot.png)                 |
| **Scenarios** (`/scenarios`)        | Scenario library featuring pre-tuned community benchmarks: Baseline, Cloudy Afternoon, High Evening Demand, Battery Constraint, Essential Stress, Meter Anomaly and Village Fire (scripted market → water pumps fire).                         | [`design/stitch/scenarios.png`](design/stitch/scenarios.png)             |

---

## 6. Real vs. Simulated vs. Estimated

To maintain strict scientific and ethical integrity, Mitsinjo Grid explicitly categorizes all data:

| Category                | Status         | Details                                                                                                                                                                                         |
| :---------------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulation Data**     | **Synthetic**  | Hourly solar irradiance profiles, battery state-of-charge curves, and sector power demands are generated by mathematical models tuned to Malagasy solar coordinates ($\approx 3.1\text{ PSH}$). |
| **Physical Quantities** | **Modeled**    | Battery charging/discharging efficiency ($95\%$), power ceilings ($\pm 25\text{ kW}$), and reserve limits ($20\%$) follow standard LiFePO4 commercial energy storage specifications.            |
| **Estimated Values**    | **Calculated** | Critical shortfall energy ($\text{kWh}$), coverage percentages ($\%$), and unmet hours are calculated deterministically by `@mitsinjo/engine`.                                                  |
| **AI Text**             | **Advisory**   | Explanations generated by Meta Muse Spark are advisory decision-support statements. The AI cannot execute hardware commands directly; all proposals require human operator confirmation.        |

_For complete modeling formulas and boundary conditions, see [docs/assumptions.md](docs/assumptions.md)._

---

## 7. Technology Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, Server Components, Route Handlers).
- **Frontend**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/) (`@theme` tokens), [shadcn/ui](https://ui.shadcn.com/) (custom restyled).
- **3D Visualization**: [React Three Fiber](https://r3f.docs.pmnd.rs/) (Three.js) + [@react-three/drei](https://github.com/pmndrs/drei) + [@react-three/postprocessing](https://github.com/pmndrs/react-postprocessing) (high tier). CC0 assets: [Kenney](https://kenney.nl) models, [Poly Haven](https://polyhaven.com) HDRI (`apps/web/public/3d/CREDITS.md`).
- **Data Analytics**: [Recharts](https://recharts.org/) (responsive SVG charts with dark-mode styling).
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) with client-side persistence and scenario caching.
- **Validation**: [Zod](https://zod.dev/) schemas defining simulation contracts and tool I/O.
- **Internationalization**: [next-intl](https://next-intl-docs.vercel.app/) supporting English (`EN`), Français (`FR`), and Malagasy (`MG`).
- **AI & LLM**: Meta Muse Spark API (`muse-spark-*`) with automatic offline deterministic fallback (`LLM_PROVIDER=mock`).
- **Testing**: [Vitest](https://vitest.dev/) (242 unit and property tests), [Playwright](https://playwright.dev/) (end-to-end demo path).

---

## 8. Run It (judges: start here)

Two ways to run the app. Both start in **offline mock mode** (no key, deterministic, recorded sample answers),
and switch to the **live Meta models** with one variable plus your own key.

### Option A: Docker (no Node or pnpm needed)

```bash
git clone https://github.com/Tokiarivelo/mitsinjo-grid-vr.git
cd mitsinjo-grid-vr
docker compose up -d --build        # or: make docker-up
```

Open **http://localhost:3000**. Logs: `docker compose logs -f web` · stop: `docker compose down`.
Port 3000 busy? `HOST_PORT=8080 docker compose up -d --build` → http://localhost:8080.

### Option B: Node + pnpm

Requires **Node.js ≥ 20.12** (22 LTS recommended) and **pnpm 10** (`corepack enable` installs the pinned
version, 12.18.0).

```bash
git clone https://github.com/Tokiarivelo/mitsinjo-grid-vr.git
cd mitsinjo-grid-vr
corepack enable                     # provides pnpm 12.18.0
pnpm install                        # or: make install
cp .env.example .env                # offline mock by default
pnpm dev                            # or: make dev
```

Open **http://localhost:3000** (`PORT` in `.env`). `make dev-mock` forces mock mode whatever `.env` says.

### Use the live Meta models (your own key)

1. Get a Meta Model API key at [dev.meta.ai](https://dev.meta.ai).
2. In the root `.env` (create it with `cp .env.example .env`), set exactly two lines:

   ```ini
   LLM_PROVIDER=meta
   META_API_KEY=<your key>
   ```

3. Restart: `pnpm dev` (Option B), or `docker compose up -d --build` (Option A; compose reads the same
   root `.env`).

Never commit `.env` (it is git-ignored). With an empty key the app runs the offline mock; a failing live call
also falls back to it instead of crashing. Spend guard: `META_SPEND_CAP_USD` (default 15 USD per chat session; over it → mock).

### Mock vs live: what changes

| Feature                                                                                   | Offline mock (default)                                         | Live Meta (`LLM_PROVIDER=meta`)                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Engine, strategies, 3D / Topology / Circuit views, 7-day scenarios, Autonomous AI actions | identical (deterministic engine, no AI)                        | identical                                                                    |
| Copilot answers, tool calls, evidence                                                     | scripted answers on the demo questions, real engine numbers    | Muse Spark (Muse Wonder for deep reasoning)                                  |
| Voice input                                                                               | scripted transcript                                            | Muse Voice                                                                   |
| Photo → objects                                                                           | sample detections, labelled "Demo detections (offline sample)" | Muse Spark (names) + SAM 3.1 (outlines)                                      |
| 2D facade → 3D model                                                                      | 3D from the object's outline                                   | Muse Image (facade) → Muse Spark (parts, stages) → Muse Wonder (final check) |

Provenance for keyless judging: the demo video shows the live Meta calls; [`benchmarks/`](benchmarks/) holds
the engine results.

### Try it in 5 minutes

1. **Solar drop:** pick the scenario **Cloudy Afternoon (-40%)** in the header, open **Live Simulation**,
   press play; switch **View mode**: 3D Scene · Topology · Circuit.
2. **Compare:** **Strategy Lab** → Proportional vs Essential first (clinic coverage, unserved energy).
3. **Ask:** **AI Copilot** → _"Why does the clinic get less energy?"_ → answer with **Computed evidence**
   and its `SIM-…` run id.
4. **Let the AI drive:** **Dispatch mode** (header) → **Autonomous AI** → **Live Simulation** → play →
   **Event Log** → **Take back control**.
5. **Photo → 3D → village:** **Village editor** → **Use the sample room**, or choose the street photo
   [`video/images/demo-photo-bourton.jpg`](video/images/demo-photo-bourton.jpg) (used in the video) → select an
   object → **3D model** → **Configure Load & Insert** → **Insert into simulation**.

Every screen is labelled `SIMULATED DATA`: no real grid is measured or controlled.

### Optional services (not needed to judge)

| Variable(s)                          | Without it                                        | Docs                                                       |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL` (Neon Postgres)       | works, but kept in server memory only (see below) | [docs/setup/env.md](docs/setup/env.md)                     |
| `R2_*` (Cloudflare R2)               | generated images are kept in the page only        | [docs/setup/cloudflare-r2.md](docs/setup/cloudflare-r2.md) |
| `GLIMMER_BASE_URL` (local Glimmer)   | fallback chain is Meta → mock                     | [.env.example](.env.example)                               |
| `NEXT_PUBLIC_BRIDGE_URL`, `BRIDGE_*` | the physical scale-model panel stays hidden       | [docs/bridge.md](docs/bridge.md)                           |

**Database (optional, Neon Postgres).** It stores the copilot chat sessions and their summaries, the
custom multi-day scenarios (**My Custom Scenarios**, drafted in chat or imported), and the Autonomous AI
**Event Log** with its narrations. Without `DATABASE_URL` all of it still works for the whole demo, held in the
server's memory: it is lost when the server restarts (`pnpm dev` / `docker compose` restart), and on a
serverless host each instance has its own memory, so the deployed site uses Neon. To keep data locally, put a
Neon (or any Postgres) URL in the root `.env`:

```ini
DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require        # pooled, read by the app
DATABASE_URL_UNPOOLED=postgresql://<user>:<password>@<host>/<db>?sslmode=require # direct, preferred by make db-migrate
```

Tables are created automatically on the first database call (or `make db-migrate`). The other `PG*` /
`POSTGRES_*` lines of `.env.example` come from the Vercel–Neon integration and are not read by the app.

Every variable, with what reads it and its allowed values: [.env.example](.env.example). Local vs Vercel
checklist: [docs/setup/env.md](docs/setup/env.md). `.env` (root) and `apps/web/.env.local` are both read;
`apps/web/.env.local` wins, and a shell variable wins over both.

### Troubleshooting

- **Port already in use:** `PORT=3005 pnpm dev` (Option B) or `HOST_PORT=8080 …` (Option A).
- **Copilot answers look scripted:** `LLM_PROVIDER` is not `meta`, the key is empty or invalid, or the spend
  cap is reached. Check the server log (`[copilot:meta] …` lines mean live calls).
- **Changed `.env` but nothing changed:** restart `pnpm dev`; with Docker, rerun `docker compose up -d --build`.
- **No 3D (old GPU / no WebGL):** the app shows the 2D schematic instead; everything else works.
- **`pnpm: command not found`:** run `corepack enable` (ships with Node), or `npm i -g pnpm@12.18.0`.

### Benchmarks

```bash
make bench   # engine latency + strategy A/B on all 8 scenarios → benchmarks/engine.json
```

Results and how to read them: [benchmarks/README.md](benchmarks/README.md). A full 24 h day runs in about
0.5 ms and a three-strategy comparison stays under 4 ms p95. Under Severe Weather Stress, essential-first
serves the health clinic 75.5 % of its demand, against 71.9 % with proportional shedding.

The hourly results (8 scenarios × 3 strategies × 24 h) plus the copilot evals are published as a
Hugging Face dataset (CC-BY-4.0, simulated data):
[mitsinjo-grid-dispatch-benchmark](https://huggingface.co/datasets/Tokiarivelo/mitsinjo-grid-dispatch-benchmark)
— rebuild with `make hf-dataset`, upload with `make hf-publish`.

### For developers

`make help` lists every command.

```bash
# Start development server on http://localhost:$PORT (PORT in .env, default 3000)
make dev

# Run development server with deterministic offline mock LLM
make dev-mock

# Stop the dev server on $PORT for good (killing next-server alone: next dev respawns it)
make dev-stop

# /village VR check in the IWER emulator: wrist menu, scan and shoot in the 360° rooms, walk between rooms (dev server running, ffmpeg)
make vr-probe

# Apply pending Neon migrations (also automatic on the app's first DB call; no DATABASE_URL → no-op)
make db-migrate

# Run full quality check suite (typecheck + lint + 242 tests + i18n parity)
make check

# Cross-package integration tests (tests/): published benchmarks/engine.json still matches the engine
make test-integration

# Run the 3D shape golden set (5 street photos, 300 ms math budget)
make test-shape

# 3D shape report: scores + contact sheet (photo | flat | ¾) → test-results/shape-report/
# (synthetic table + « Real » table from the local captures in __fixtures__/shape/real/)
make shape-report
# Colour under a shadow, litSurface on vs off: painted on the real photos + real walls in shadow (no API call)
make shadow-photos   # once: downloads the 8 shadowed-wall photos (Wikimedia Commons) into the local fixtures
make shadow-compare
# One real photo per family the real set lacked (tank, panel, bush, animal, person, building), then capture each
make family-photos   # once: Wikimedia Commons → local fixtures (ids and labels in __fixtures__/shape/family-photos.json)
make shape-capture PHOTO=apps/web/src/server/perception/__fixtures__/shape/real/photos/cow.jpg ID=cow LABEL=zebu
# Free-parts call on live Spark, first prompt vs Muse cards (costs API calls; IDS limits the run)
make eval-parts PROMPT=1,2 IDS=pump,fan
# Which SAM word outlines a capture? best box IoU per word, photo and crop (costs SAM calls)
make sam-probe ID=utility-pole CONCEPTS="pole,utility pole"
# Rubric judge (Muse Wonder) on the real captures, intact vs damaged → calibration (costs API calls)
make shape-judge            # REPLAY=1: stored answers only, no API call
# Kit eval on live Spark, two prompt versions in one table (costs API calls)
make eval-shape PROMPT=1,2
# Views → 3D on your own drawings (PQ-T69): offline with the front + one side; a missing view is drawn by Muse Image (API cost)
make views-3d FRONT=front.png RIGHT=right.png OUT=test-results/views
make views-3d FRONT=front.png RIGHT=right.png BACK=back.png LEFT=left.png OUT=test-results/views LABEL='stone house'

# Real 3D viewer shots of those recipes, dark + light (dev server running, API stubbed)
make shape-shots
# Improvement chip shots (running + finalised), desktop + mobile, dark + light
make improve-shot

# Run Playwright end-to-end test suite
make e2e

# Run production build
make build

# 3D budgets per quality tier (server running; -gpu = real GPU fps)
make scene-audit
make scene-audit-gpu

# Physical scale model (docs/maquette-physique.md, settings: docs/bridge.md): bridge + fake ESP32
make bridge                     # BRIDGE_MODE=twin make bridge → sensors feed the engine
make bridge-sim                 # c = cloud over the sun lamp, q = quit
# Deployed site: open /simulation?bridge=ws://localhost:8787 (add &bridgeToken=… if BRIDGE_TOKEN is set)
NEXT_PUBLIC_BRIDGE_URL=ws://localhost:8787 make dev-mock   # /simulation → Controls → Physical scale model
```

---

## 9. Environment Variables

All variables live in **one root `.env`** (`cp .env.example .env`); `apps/web/.env.local` also works and wins,
a shell variable wins over both. Every one is optional: with an empty `.env` the app runs fully offline.
**Judges need at most two:** `LLM_PROVIDER=meta` and `META_API_KEY` (§ 8). Never commit `.env`.
Template with comments: [.env.example](.env.example) · local vs Vercel: [docs/setup/env.md](docs/setup/env.md).

### Web server

| Variable    | Needed for | Default | Meaning                                                                |
| ----------- | ---------- | ------- | ---------------------------------------------------------------------- |
| `PORT`      | -          | `3000`  | `pnpm dev` / `make dev` port, also used by Playwright and `make shots` |
| `HOST_PORT` | Docker     | `3000`  | host port mapped to the container's 3000 (`PORT` is ignored in Docker) |

### Copilot and Meta models (server-only)

| Variable                  | Needed for  | Default                     | Meaning                                                                                             |
| ------------------------- | ----------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`            | live AI     | `mock`                      | `mock` (offline, scripted) · `meta` (Meta Model API) · `glimmer` (local model first)                |
| `META_API_KEY`            | live AI     | empty                       | your key from [dev.meta.ai](https://dev.meta.ai); empty → mock. **Secret**                          |
| `META_BASE_URL`           | -           | `https://api.meta.ai/v1`    | Meta Model API base URL                                                                             |
| `META_MODEL`              | -           | `muse-spark-1.3`            | copilot chat + tool calling (Muse Spark)                                                            |
| `META_VOICE_MODEL`        | -           | `muse-voice-transcribe-1.0` | voice input transcription (WAV)                                                                     |
| `META_VISION_MODEL`       | -           | `muse-spark-1.3`            | reads photos: names appliances / buildings, 3D parts and stages                                     |
| `META_SEGMENT_MODEL`      | -           | `sam-3.1`                   | outlines each detected object (SAM)                                                                 |
| `META_IMAGE_MODEL`        | -           | `muse-image-1.0`            | 2D facade drawings, shedding posters                                                                |
| `META_REFINE_MODEL`       | -           | `muse-wonder-1.0`           | final check + re-refinement of the 3D model (falls back to `META_VISION_MODEL`)                     |
| `META_JUDGE_MODEL`        | -           | `muse-wonder-1.0`           | rubric judge of the 3D models (`make shape-judge`, offline only)                                    |
| `META_SPEND_CAP_USD`      | -           | `15`                        | estimated Meta spend allowed per chat session; over it → mock; `0` = no paid call                   |
| `META_PREFER_CONTRIBUTOR` | -           | `true`                      | prefer Spark `*-contributor` ids (≈ 12× cheaper, Meta trains on them); `false` for real user data   |
| `GLIMMER_BASE_URL`        | local model | empty                       | OpenAI-compatible URL (Ollama `http://localhost:11434/v1`, vLLM); set → chain Meta → Glimmer → mock |
| `GLIMMER_MODEL`           | local model | `muse-glimmer-30b`          | model id served locally                                                                             |
| `GLIMMER_API_KEY`         | local model | empty                       | only if the local server asks for one. **Secret**                                                   |

### Database: Neon Postgres (optional, details in § 8)

| Variable                                                                             | Needed for                | Default | Meaning                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                       | data kept across restarts | empty   | pooled URL read by the app (chats, custom scenarios, Event Log); empty → server memory. **Secret** |
| `DATABASE_URL_UNPOOLED`                                                              | `make db-migrate`         | empty   | direct URL, preferred for migrations. **Secret**                                                   |
| `PGHOST` `PGHOST_UNPOOLED` `PGUSER` `PGDATABASE` `PGPASSWORD`, `POSTGRES_*` (8 vars) | -                         | empty   | written by the Vercel–Neon integration; **not read by the app**                                    |

### Media storage: Cloudflare R2 (optional)

| Variable                                                      | Needed for               | Default               | Meaning                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | keeping generated images | empty (all 3 or none) | saves facades / posters with the session; empty → images stay in the page only. **Secrets**; guide: [docs/setup/cloudflare-r2.md](docs/setup/cloudflare-r2.md) |
| `R2_BUCKET_NAME`                                              | R2                       | `mitsinjo-grid-media` | bucket name                                                                                                                                                    |
| `R2_PUBLIC_URL`                                               | R2                       | empty                 | public bucket URL (r2.dev or custom domain)                                                                                                                    |

### Physical scale model: `make bridge` (optional, local only; details: [docs/bridge.md](docs/bridge.md))

| Variable                                               | Default                                | Meaning                                                                              |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_BRIDGE_URL`                               | empty                                  | browser → bridge WebSocket (`ws://localhost:8787`); empty → scale-model panel hidden |
| `BRIDGE_MODE`                                          | `twin`                                 | `replay` (engine drives the model) · `twin` (model sensors feed the engine)          |
| `BRIDGE_SCENARIO` · `BRIDGE_STRATEGY`                  | `cloudy_afternoon` · `essential_first` | scenario and strategy the bridge runs                                                |
| `BRIDGE_WS_PORT`                                       | `8787`                                 | bridge WebSocket port                                                                |
| `BRIDGE_EMBEDDED_BROKER`                               | `true`                                 | in-process MQTT broker; `false` → use `MQTT_URL`                                     |
| `MQTT_PORT` · `MQTT_URL`                               | `1883` · empty                         | broker port / external broker URL                                                    |
| `MQTT_USERNAME` · `MQTT_PASSWORD`                      | empty                                  | MQTT login (both or none, same in the firmware). **Secrets**                         |
| `BRIDGE_TOKEN`                                         | empty                                  | ≥ 16 chars; set → only `?bridgeToken=` browsers may send commands. **Secret**        |
| `HW_POWER_SCALE` · `HW_TIME_SCALE` · `HW_LUX_FULL_SUN` | `4000` · `20` · `20000`                | 1 W model = 4 kW simulated · 1 simulated hour = 20 s · lux under the lamp            |

### Tooling (not the app)

| Variable                   | Read by                        | Meaning                                                      |
| -------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `BENCH_OUT` · `BENCH_RUNS` | `make bench`                   | report path (set by the Makefile) · runs per measure (`200`) |
| `STITCH_API_KEY`           | Stitch MCP (Claude Code)       | design-tool key, exported by `make claude`. **Secret**       |
| `VERCEL_OIDC_TOKEN`        | Vercel CLI (`vercel env pull`) | written by Vercel; not read by the app. **Secret**           |

---

## 10. Deployment

The project is configured for continuous deployment on [Vercel](https://vercel.com/):

- **Continuous Deployment**: Only pushes and merges to `main` trigger production deployments.
- **Zero Secret Exposure**: All keys are injected through Vercel Project Environment Variables. No secrets are committed to the Git repository.
- **Vercel env vars**: what to set (and what not to) in [docs/setup/env.md](docs/setup/env.md).

```bash
make deploy-link   # Link clone to Vercel project (once per machine)
make deploy        # Manual production deployment from clean origin/main
```

---

## 11. Known Limitations & Roadmap

### Known Limitations (see [docs/known-limitations.md](docs/known-limitations.md))

- **Simulation Time Horizon**: Each day is a discrete 24-hour cycle at 1-hour resolution ($t \in [0, 23]$). Multi-day runs (weather workflow, max 7 days) only carry battery SoC over; weather is a fixed daily solar factor, not a forecast.
- **Electrical Dynamics**: Single-phase aggregate real-power balance. Reactive power ($kVAR$), voltage drop along distribution lines, and frequency regulation are omitted.
- **Hardware Acceleration**: the `High` 3D tier targets ≥ 30 fps on a discrete GPU; integrated GPUs fall back to `Low` (≥ 45 fps target) automatically. In headless Linux CI without a hardware GPU, software rasterization (SwiftShader) is used (`make scene-audit`; `make scene-audit-gpu` on a real GPU).
- **All simulated**: every watt, incident and observation demo runs on the deterministic engine or `LLM_PROVIDER=mock` unless Meta keys are set; nothing is measured from, or controls, a live village (see §6).
- **Autonomous AI Dispatch Scope**: In Autonomous AI mode, actions apply automatically according to engine-computed policies and the Village Constitution. It operates strictly within simulated virtual grid models (or replay/twin telemetry on the experimental physical scale-model bridge); it never triggers irreversible or un-monitored high-voltage switching on real community hardware.
- **Natural Language Multi-Day Scenarios**: Scenarios drafted via chat are capped at 7 days and discrete 1-hour resolution. Extreme weather changes or complex concurrent incidents outside the engine catalog are mapped onto deterministic parametric equivalents.
- **Malagasy voice**: transcription and readout depend on the browser / Meta Voice; MG readout stays silent when no Malagasy voice is installed, and MG speech is not yet validated live.
- **No Meta TTS**: answer readout uses the browser SpeechSynthesis voice, not a Meta speech model.

### Stretch Features (shipped, simulated only)

- **Autonomous AI Dispatch Mode & Event Log (PA)**: 3-level dispatch toggle (`Manual`, `Assisted`, `Autonomous AI`). In Autonomous mode, the engine continuously detects grid incidents (fires, overload, battery reserve drops, solar surplus), evaluates multi-hour candidate trajectories, and applies actions autonomously without human approval. Hard guardrails enforce the Village Constitution (Health Clinic lifeline never cut) and anti-oscillation limits (max 2 actions/hour, no counter-actions in < 2h). Full auditability through a hash-sealed Event Log (FNV-1a integrity hash, not cryptographic; `Neon` database + offline fallback), CSV/JSON export, automated shift reports, and one-tap "Take back control" (≥ 44px) returning control immediately to manual. Clicking "Why?" on any action links directly to Copilot with an evidence-grounded prompt.
- **Natural Language Multi-Day Scenario Drafting (PA-8)**: Describe multi-day stress scenarios directly in natural language (EN, FR, MG, e.g. "jour 1 : nuageux, jour 2 : pluvieux, jour 3 : beau temps + école en feu"). Multilingual deterministic regex extractor and Meta Muse Spark `draft_scenario` tool generate structured `ScenarioDraft` objects, detect missing slots, and render an interactive draft card in chat with suggested response pills. Once completed, compute an engine preview and launch directly into 24h simulation or multi-day workflow in manual or autonomous mode, with persistent draft storage in Neon.
- **PX Anomaly Signal**: optional per-sector `meterReadings`; a persistent gap > 25 % vs the expected profile for ≥ 2 h raises `ANOMALY_TO_VERIFY` (a signal to verify, never a fraud or fault conclusion). Synthetic `meter_anomaly` scenario.
- **Weather Workflow**: chain up to 7 days with weather pills (sunny, partly cloudy, cloudy, rainy, storm); each day scales solar and starts from the previous day's battery charge; day strip and playback follow the days; the 3D village shows each day's sky (overcast, clouds, rain, storm lightning) and a weather change re-runs the engine at once.
- **Live Sector Load & Small Factory**: on `/simulation` (Buildings tab) a slider per sector scales its load ×0–3 and a button connects or disconnects it; each change re-runs the engine at once (3D, metrics, charts follow, even during playback). A small factory sector ships disconnected by default; adding another consumer sector follows the checklist in `docs/engine-spec.md`.
- **PY Sector Control Proposals**: hourly `sectorCaps` and priority overrides the copilot can only _propose_; the user confirms, the engine recomputes. No real equipment control. Each decision locks the card and is posted in the chat; cutting the clinic needs a second confirmation.
- **Village editor (`/village`, in progress)**: add a photo (or the sample room); Muse Spark finds the appliances and SAM outlines them (offline mock without a key); hover to highlight, tap or keyboard to select. Houses, cars, trees and other scenery are outlined too, marked « No load ». The live village (3D / 2D) stays visible beside the photo. Each object, scenery included, gets a 3D model (Spark recipe fitted to the photo, else its outline) and its own colour (photo box + list border). « Add to the simulation »: « AI estimate » (AI type + engine catalog power + suggested sector) or « Manual » (type, sector, watts within the catalog range, quantity); engine preview (peak kW, kWh per day), then « Insert into simulation » re-runs every strategy (« In simulation » chip, update or remove). Power never comes from the AI. Inserted appliances show in the 3D village (marker by their building, glowing while they run), as « n added » on the 2D diagram, and in « Appliances in the simulation » (on /village and the /simulation Buildings tab: remove, edit). Free placement: each object goes anywhere on the village map (minimap in the form, or drag its marker in 3D); its load stays on one feeder (nearest building by default, overridable). Also reachable from an image attached in the chat. A house with a validated 2D facade is rebuilt from it piece by piece (walls, roof, openings with glazed double doors, lintels, chimney caps), then improved stage by stage by Muse Spark against the drawing; stages that miss the first 60 s go on in the background (no time limit: it always waits for Meta) with a progress chip and a « Cancel » button on the viewer, and the model only ever gets closer to the drawing. Cars, appliances, solar panels, trees and poles built from their 2D view get the same loop with their own stages (body → glass → wheels → details, body → doors → details, body → cells, trunk → crown, body → head), scored part by part on the drawings; wheels show rims and panels their cell grid.
- **Long chats & voice**: older turns are folded into a number-free summary (auto-compaction); the chat microphone records in any modern browser, shows a live frequency spectrum of the voice while recording, and transcribes with Meta Voice (offline mock without a key). Answers can be read aloud (summary only, browser voice of the app language) and hands-free mode auto-sends on silence; a spoken fire order opens the report dialog pre-filled.
- **Copilot: fire, vision, visuals**: reporting a fire from the chat or `/simulation` cuts that sector at once (safety) with an alert banner, and the copilot explains the cut from engine incidents (restoring needs an approved proposal). A sky photo becomes editable observations, then an engine proposal (cloud cover → solar drop). The copilot also draws the evening village and FR/MG shedding posters: the picture is AI-generated, the hours overlaid in HTML come from the engine, exportable as PNG.

### Future Roadmap

- **VR control room (this fork)**: browser-delivered VR (WebXR) targeting Meta Quest — walkable village twin, hand-operated EMS dispatch shelter and feeder breakers, in-place copilot proposal approvals, and strategy comparison inside VR. Same deterministic engine, same simulated-data guarantees.
- **/village VR test space**: without a real headset (desktop or IWER emulator), the VR view is a walkable 360° tour of six real rooms plus an outdoor walk (terrace with solar panels, street of houses, garden, tree-lined road, forest; CC0 photos, walk for real: hold ↑/W/Z or the stick, the floor slides under you with parallax, walk onto a floor arrow to go through to the next place); scans photograph the view you aim at. On a real Quest the webcam stays (flat screen).
- **Hardware Gateway (SCADA/IoT)**: MQTT / Modbus TCP ingestion adapters for physical microgrid telemetry in Madagascar.

---

## 12. Submission & Verification

- **Hackathon**: Meta AI Hackathon (Solo Project)
- **Tag**: `v1.0.0`
- **License**: [MIT](LICENSE) © 2026 Tokiarivelo
- **Video credits**: background music « Passion » by Luke Bergs & AgusAlvarez (publisher: Free To Use Music, 2025), free to use with no license or rights required; file in [`video/audio/music/`](video/audio/music/). Demo photo [`video/images/demo-photo-bourton.jpg`](video/images/demo-photo-bourton.jpg): « Bourton-on-the-Water » by Bin im Garten, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Bourton-on-the-Water_2010_PD_09.JPG), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (resized; the 2D facade and 3D model made from it are shared under the same license). Narration voice: Kokoro TTS (open-weight, run locally, voice `am_puck`). Sound effects are generated with ffmpeg; all footage is the running app. Plan: [`video/VIDEO_PLAN.md`](video/VIDEO_PLAN.md).
