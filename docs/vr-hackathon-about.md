# Mitsinjo Grid VR: Solar Village Twin

> Walk through a solar village in VR, turn photos into 3D equipment, see power flow live, and let AI keep the clinic powered.

## Inspiration

In off-grid villages in Madagascar, one 40 kWp solar array + 120 kWh battery is the lifeline for everything: the health clinic's vaccine fridge, the water pump, the school, homes, the market.

When a monsoon cloud hits, classic controllers shed load **proportionally** — the clinic goes dark at the same rate as market stalls. Operators see this on flat 2D dashboards, after the fact.

We asked: what if you could **stand inside the grid**? Walk the feeders, see the electrons slow down, watch the clinic flicker — and ask an AI, in your own language, "why is the clinic at risk, and what saves it?"

That is Mitsinjo Grid VR: an immersive digital twin where energy decisions become spatial, visible, and explainable.

## What it does

- **Immersive village twin:** golden-hour 3D village with clinic, water tower, school, homes, market, solar field and battery shelter. Light intensity, electron particles and breaker states follow the simulation live. One tap enters a WebXR `immersive-vr` session from a standing-scale viewpoint.
- **Photo → 3D by vision:** photograph any appliance or building, and it appears in the village as a connected 3D load with poles, cables and its own demand curve.
- **AI copilot:** grounded on the simulation engine. It never invents numbers — every figure cites a simulation run ID, and every grid action needs your approval.
- **Strategy lab:** compare Proportional vs Essential-First vs Balanced shedding side by side, and see which one keeps lifeline power through the night.

## How we built it

**Stack:** Next.js 15 + React 19 + TypeScript strict, React Three Fiber + Drei for the twin, WebXR `immersive-vr` (`local-floor` / `bounded-floor`, Meta IWER emulator for desktop dev), Zustand + Zod, Recharts, next-intl (EN/FR/MG), Vitest + Playwright.

**The rule that shapes everything:** numbers come **only** from `@mitsinjo/engine`, a pure deterministic TypeScript simulator (1-hour steps, $t \in [0,23]$). UI, 3D and LLM never compute energy values.

Per-step balance on a single-bus model:

$$\text{servedKw} = \text{solarKw} - \text{batteryKw} - \text{curtailedKw}$$

$$\text{solarKw}(t) = \text{peakKw} \times \text{profile}[t] \times \prod \text{weatherFactors}(t)$$

$$\text{storedKwh}(t+1) = \text{storedKwh}(t) + \max(\text{batteryKw},0)\cdot\eta_{ch} - \frac{\max(-\text{batteryKw},0)}{\eta_{dis}}$$

with $\eta_{ch}=\eta_{dis}=0.95$, invariants checked every step at $\varepsilon = 10^{-9}$.

Shedding strategies kick in when $\text{availableKw} < \text{demandKw}$. Proportional sheds everyone equally:

$$\text{served}_s(t) = \text{demand}_s(t) \times \min\left(1, \frac{\text{availableKw}(t)}{\text{demandKw}(t)}\right)$$

Essential-First serves tiers (critical → high → medium → low) in order, and a **lifeline floor** guarantees survival power first (health 0.3, water 0.2, households 0.4, school 0.1, market 0.1 kW, $\Sigma = 1.1$ kW).

**Meta models at runtime (server-side):** Muse Spark (copilot tool calls + vision detection), SAM 3.1 (object outlines on photos), Muse Image (2D facades seeding 3D models), Muse Wonder (final 3D refinement check), Muse Voice (chat transcription EN/FR/MG).

### Photo → 3D by image vision

1. **Detect** — Muse Spark vision lists appliances/buildings on the photo with confidence.
2. **Outline** — SAM 3.1 segments each object; outlines overlay the photo for verification.
3. **Facade** — Muse Image draws a clean orthographic 2D elevation from the crop.
4. **Reconstruct** — procedural kit (templates + primitives + photo measurements) builds the mesh; Muse Wonder checks and re-refines it.
5. **Connect** — the object lands in the village on a laterite yard with a catenary cable derivation on wooden poles ($\le 4.5$ m spacing) to the EMS, plus a 2D schematic branch and a live load curve.

Bad photo in, bad model out — so every stage is previewable and retryable before anything touches the grid.

## Challenges we ran into

- **Grounding the LLM:** early copilot drafts invented plausible kWh. Fix: tool-only numbers, mandatory run-ID citations, and a deterministic offline mock for tests and demos.
- **Photo → 3D quality:** single-view reconstruction is ambiguous. Fix: staged pipeline with outlines + facades as inspectable intermediates and a scored quality loop (shape report + contact sheet).
- **VR readability:** energy state must read at a glance in 3D. Fix: continuous light intensity ∝ served kW, particle speed ∝ power, red fire isolation that beats every strategy.
- **Performance:** full village + particles on low-end devices. Fix: instancing, tiered quality, budgets in `docs/performance.md`.
- **Trust across languages:** zero hardcoded strings, 100% EN/FR/MG key parity enforced in CI, AI text visually distinct from computed metrics, `SIMULATED DATA` on every screen.

## Accomplishments that we're proud of

- **A copilot that can't lie about numbers.** Every figure comes from the deterministic engine via tools and cites its simulation run ID — the exact thing early prototypes hallucinated.
- **One-tap WebXR.** The same village operators study on desktop opens as a standing-scale `immersive-vr` session, with a dev emulator so it runs with or without a headset.
- **Photo-to-grid in five inspectable stages.** Detection → outline → facade → mesh → wired connection, each previewable, so a bad photo never silently corrupts the grid.
- **Three languages, zero hardcoded strings.** Full EN/FR/MG parity enforced in CI, with AI text always visually distinct from computed metrics.

## What we learned

- **Presence changes decisions.** Watching the clinic go dark in 3D makes "essential-first" obvious in a way tables never do.
- **Constraints make AI trustworthy.** "Engine computes, AI perceives/explains/proposes" turned the copilot from a chatbot into a decision tool judges and operators believe.
- **Vision needs a loop, not a leap.** Photo → mesh in one shot fails; detect → outline → facade → mesh with a critic stage is what made it demoable.
- **Determinism is a feature.** Same seed, same numbers, client and server in <3 ms — that is what lets AI cite evidence instead of hallucinating it.

## What's next for Mitsinjo Grid VR: Solar Village Twin

Controller-driven breakers (grab a feeder to isolate it), multiplayer village councils in VR, live meter bridges for real pilots, and a Malagasy-first voice mode for hands-free operators.
