# Mitsinjo Grid VR — Built With + Try It Out

## Built with (tags — 25/25, copy-paste ready)

```text
TypeScript, Next.js, React, React Three Fiber, Three.js, WebXR, Tailwind CSS,
shadcn/ui, Zustand, Zod, Recharts, next-intl, Vitest, Playwright, Turborepo,
pnpm, Node.js, Meta Muse Spark, SAM 3.1, Muse Image, Muse Wonder, Muse Voice,
Docker, Vercel, GitHub Actions
```

## Built with (stack summary)

- **Languages:** TypeScript (strict), Markdown + LaTeX docs (EN/FR/MG)
- **Frameworks:** Next.js 15 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Zustand, Zod, Recharts, next-intl
- **3D & VR:** Three.js, React Three Fiber + Drei, WebXR `immersive-vr` (`local-floor` / `bounded-floor`, Meta IWER emulator for desktop dev)
- **Energy engine:** `@mitsinjo/engine` — pure deterministic TypeScript, 1-hour steps, invariants at $\varepsilon = 10^{-9}$
- **Meta AI APIs (server-side):** Muse Spark (copilot tool calls + vision), SAM 3.1 (segmentation), Muse Image (facades), Muse Wonder (3D refinement), Muse Voice (transcription)
- **Testing & quality:** Vitest, Playwright, Prettier, GitHub Actions CI, 100% i18n key-parity checks
- **Platforms & infra:** Node.js, pnpm + Turborepo, Docker Compose, Vercel

## Try it out (links)

| Label                        | URL                                          |
| ---------------------------- | -------------------------------------------- |
| Live app (web)               | https://mitsinjo-grid.vercel.app             |
| 3D village + live simulation | https://mitsinjo-grid.vercel.app/simulation  |
| Village editor (photo → 3D)  | https://mitsinjo-grid.vercel.app/village     |
| Source code (GitHub)         | https://github.com/Tokiarivelo/mitsinjo-grid |
| Demo video (2:53)            | https://youtu.be/GSu96kD7HRw                 |

**Run locally (offline mock, no key needed):**

```bash
git clone https://github.com/Tokiarivelo/mitsinjo-grid.git
cd mitsinjo-grid
docker compose up -d --build
# → http://localhost:3000
```

**VR note:** the one-tap `immersive-vr` entry lives on branch `feat/vr-village-view`
(WebXR + emulator). Deploy a preview from that branch (or run it locally with a
headset / emulator) to try the headset path; `main` serves the full web twin.

---

## Hackathon form answers

### Team / Organization name

**Hazavana Labs** — _hazavana_ means "light" in Malagasy.

Display as: "Mitsinjo Grid VR: Solar Village Twin" created by Hazavana Labs.
Solo indie developer.

### Adapted experience — significant updates (175/250 words)

Mitsinjo Grid began as a web-based AI decision-support twin (Meta Global AI Hackathon): a deterministic energy engine, strategy lab, grounded copilot and a 3D village you orbited with mouse or touch. For this VR competition we rebuilt the experience around presence. New during the competition period: one-tap WebXR immersive-vr entry from the live simulation viewport, opening on a standing-scale diorama overlook with roomscale tracking (local-floor / bounded-floor); an XR-aware camera controller that hands the camera to the headset on entry and restores the 2D view on exit; a Meta Quest 3 emulation setup (IWER + DevUI) so the session runs in desktop development with zero emulator code shipped to production; VR enter/exit UI fully translated (EN/FR/MG); and a dedicated XR test suite covering session support detection, viewpoint snapping and viewport integration. The scene's readability language — light tracking served kW, particle flow tracking power — carries over, so the grid state reads instantly at diorama scale. The photo-to-3D pipeline and grounded copilot from the original build now feed the same twin you can stand inside.

### Release channel URL (WebXR → hosted URL)

```text
https://mitsinjo-grid.vercel.app/simulation
```

Main entry: https://mitsinjo-grid.vercel.app — headset path via a preview deploy of
branch `feat/vr-village-view` (see VR note above).

### Meta VR capabilities used

- **WebXR `immersive-vr` sessions** (three.js `renderer.xr`), opened from a user gesture on the village viewport.
- **Roomscale tracking** via `local-floor` + `bounded-floor` session features, from a standing-scale diorama viewpoint.
- **Meta Quest 3** as reference device: developed against IWER `metaQuest3` emulation, runs in Quest Browser.
- **Meta AI Model APIs** (server-side, feeding the twin): Muse Spark (copilot + vision), SAM 3.1, Muse Image, Muse Wonder, Muse Voice.

### Hand interactions

Not yet implemented — current state, honestly: the VR session is look-around observation from the standing-scale viewpoint; every grid action (strategy switch, proposal approval, fire report) runs through the translated 2D UI before or after the session. No hand-tracking or controller input is wired today. Planned implementation, in this order: (1) controller `select` events raycast against feeders and sector markers — point at a breaker to isolate it, at a building to focus it; (2) grabbable feeder isolation (squeeze-and-pull motion); (3) hand-tracking pinch as an alternative `select` where the runtime exposes it. The XR-aware camera and viewpoint snapping above are the foundation this lands on.

### Excited about the future of VR (104/150 words)

VR turns abstract systems into places you can stand inside — and places create responsibility. Watching a clinic go dark at diorama scale makes an energy decision feel human in a way no dashboard can. I'm excited for headsets to become field tools, not just gaming rigs: a village technician walking her own grid, a council debating trade-offs around a shared twin, a student learning power systems by rewiring a village with her hands. As WebXR, hand tracking and on-device AI converge, the barrier between a simulation and a place disappears — and decisions about real infrastructure get made with presence, not just numbers.

### Target launch date

Already live on web (https://mitsinjo-grid.vercel.app). VR milestone with
controller/hand interactions targeted **March 2027** as a public WebXR release;
Quest Store submission under evaluation.
