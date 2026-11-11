# Performance & fluidity

Goal: every interaction feels instant. The engine is cheap (< 10 ms), so slowness can only come from
React re-renders, chart redraws, 3D, or bundle size. Fix those before optimising math.

## 1. Budgets (checked in P8 with `/perf-audit`)

| Metric                                                | Budget                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| First-load JS per route (gz, excluding lazy 3D chunk) | ≤ 180 KB                                        |
| LCP /overview (desktop, prod build)                   | ≤ 2.0 s                                         |
| INP while dragging a slider                           | ≤ 100 ms                                        |
| `compare()` all strategies                            | ≤ 10 ms                                         |
| `sweep()` 20 points across all strategies             | ≤ 50 ms                                         |
| 3D `low` tier (integrated GPU)                        | ≥ 45 fps · draw calls < 150 · triangles ≤ 150 k |
| 3D `high` tier (default, discrete GPU)                | ≥ 30 fps · draw calls < 400 · triangles ≤ 800 k |
| Copilot first token visible                           | ≤ 2 s after send (activity shown at once)       |
| Lighthouse performance (desktop)                      | ≥ 90                                            |
| Shape math per object (`runObjectShape`, no API)      | ≤ 300 ms (`make test-shape`, strict)            |
| Shape request (`/api/vision/shape`, with Meta)        | ≤ 45 s (60 s server timeout)                    |
| Shape recipe                                          | ≤ 12 parts · ≤ 5 k triangles                    |
| Shape score (`scoreRecipe`, critic/replay only)       | outside the math budget, ~100 ms                |

## 2. Fluid slider → result loop

- Slider `onValueChange` updates a **local draft** (instant thumb); `onValueCommit` → `patchInput()` → `run()`.
  Optional live preview: throttle `run()` with `requestAnimationFrame` (one run per frame max).
- Wrap `run()` result commit in `startTransition` so input stays responsive while charts/3D update.
- No fake loading spinner: the engine is synchronous and instant; show `SIMULATION COMPLETE` directly.
- Engine stays on the main thread. Move it to a Web Worker only if the bench test exceeds 16 ms (`make bench` → `benchmarks/engine.json`; today < 4 ms p95 for 3 strategies).

## 3. React rendering

- Zustand: narrow selectors per component; `useShallow` for multi-field reads; derived values in
  memoized selectors (`stores/selectors.ts`) — never recompute arrays inside render.
- Results are replaced immutably (new object per run) so selectors compare by reference.
- Split big screens into leaf components that each subscribe to their own slice.
- Enable React Compiler (`babel-plugin-react-compiler`, `experimental.reactCompiler`) to drop manual `memo`.
- Server Components for static parts (Scenarios descriptions, assumptions text, shell chrome).

## 4. Charts (Recharts)

- `isAnimationActive={false}` for data updated by sliders; animate only first mount.
- Data arrays built once per result in a selector (24 points — tiny); fixed `height`, `ResponsiveContainer` with `debounce={100}`.
- Lazy-load chart components per route with `next/dynamic` when below the fold.

## 5. 3D

Rules in `.claude/rules/three.md`. Two quality tiers (`useSceneQuality`, toggle in the 3D card):

- `high` (default): HDRI env light, sun shadow map (2048, near trees only, baked: see below), N8AO +
  bloom + ACES grade (`@react-three/postprocessing`, 2× MSAA), dense forest (2 000 trees),
  `dpr={[1, 1.5]}`.
- `low`: no post-processing, one baked `ContactShadows`, 520 low-detail trees (high 2000), `dpr={[1, 1.25]}`.
  Placed object models keep their recipe shape (light assemblies); past `PLACED_LOW_TRIANGLES` (40 k)
  the remaining ones become one box each (`utils/placed-models-geometry.ts`).
- Ink outline (PT-4/6, `utils/ink-effect.ts`): depth-only post effect (no normal pass), merged into the existing
  `EffectPass` → +0 draw calls, +0 render targets. Village high tier only: strength 0.35, silhouettes only,
  fades out from 22 to 45 units (`scene-ink` token). GPU audit: fps and draw calls unchanged.
- Object editor (PT-5): its own `EffectComposer` (4× MSAA, half float) with Neutral tone mapping + ink 0.6;
  `frameloop="demand"` so it costs only when the view changes. Studio light = softbox scene baked once (PMREM).
- Shader warm-up (PT-7, `useShaderWarmup`): `gl.compile(scene, camera)` once per canvas, then our own poll of
  `program.isReady()` (parallel compile), canvas fades in when all are linked (≤ 1 s). Not `compileAsync`: three
  r174 reads `currentProgram.isReady()` unguarded, so a material disposed mid-compile threw `reading 'isReady'`. The ~1.2 s long task at village mount is scene building, not shaders (open).
- Auto-downgrade: a 3.5 s fps probe after the high tier mounts switches to `low` when the median
  is < 28 fps, unless the user picked a tier (saved in `localStorage`). `?quality=high|low`
  forces a tier (audits, screenshots). The probe gives up after 8 s (`MAX_PROBE_MS`) and downgrades
  if it could not collect enough frames.
- No GPU (software GL: SwiftShader, llvmpipe — headless CI, blocked drivers): start on `low` and
  keep electrons frozen (a software frame costs ~0.5 s; a continuous loop freezes the page).
- Camera: first placement is instant; preset tweens snap to target after 2 s of wall time, so the
  demand loop always stops, even at 1 fps. The focus orbit around a selected building keeps
  the demand loop running until the user drags or deselects; it is off on software GL.

- Render loop: the frame loop pauses (`frameloop="never"`) while the canvas is off-screen
  (`useInView`, IntersectionObserver) and resumes with one frame (`ResumeOnVisible`); the fps
  probe only runs on screen. Ambient motion (electrons, clouds, rain, lightning) asks for its next
  frame via `useAmbientFrame`, capped at 30 fps (`AMBIENT_FPS`) and merged into one frame per
  interval; camera tweens, orbit and drags keep the display rate.
- WebGL contexts: one cached capability probe per page (`getWebGLSupport`, context released);
  browsers keep ~16 contexts and drop the oldest, the scene. `make scene-audit` fails above 3.
  A real context loss shows the 3D placeholder and remounts the canvas (`useContextLoss`).
- Shadows: every caster is static, so `ShadowBake` sets `shadowMap.autoUpdate = false` and
  re-renders the map only when the sun or the scene model changes (not on every animated frame).

Key wins: `frameloop="demand"`, instancing (vegetation: one `InstancedMesh` per model part and
band), merged static parts (`utils/merge-parts`: windows, fences, lattice, market woodwork,
each vehicle), house clusters (`utils/house-geometry`: all homes in ≤ 5 meshes, per-house colors as vertex colors), shared materials, near/far vegetation bands (far trees: no shadow pass, low
detail), lazy chunk via `next/dynamic({ ssr:false })`, assets ≈ 0.5 MB (`public/3d`, meshopt; HDRI 512 × 256, 390 KB).

Measure: add `?perf=1` to `/simulation` or `/overview` for a live draw-call / fps readout
(sampled at 2 Hz from `gl.info`, whole frame incl. shadow and post passes). `make scene-audit`
(server running) checks both tiers against their budgets and saves
`design/shots/{simulation,overview}-3d{,-low}.png`. Default is SwiftShader (software GL): draw
calls and triangles are exact, fps is not a GPU number. `make scene-audit-gpu` runs the same
audit on the real GPU (meaningful fps).
In-scene `<Html>` labels take `portal` = a stable container ref so drei never re-targets
them after mount (re-targeting races React root unmounts and can leave a label empty).

- Weather effects add ≤ 2 draw calls (instanced clouds + one rain `LineSegments`) and animate on the GPU (one
  uniform per frame); they keep the frame loop running only while motion is allowed.
- Object 3D viewer (/village, PR-1.1): studio light = one `RoomEnvironment` pre-filtered once per canvas
  (PMREM, 256² faces, disposed on unmount) + 2 directional lights; `frameloop="demand"` keeps it idle.
  Rounded boxes (PR-1.2): 300 triangles each, plain 12-triangle box under 0.005 radius; spheres 18 × 12 (396 triangles, PR-1.3);
  ≤ 5 k triangles per object. Surface maps (PR-1.4): 128² normal + roughness + shade per used material,
  generated in JS on first use (~1 ms each) and cached for the session.
- /village VR studio (WebXR): no extra render target in the eye pass (no `ContactShadows` on spawned
  models, no post-processing) so fixed foveation and MSAA stay on (Meta WebXR perf guidance). Blaster beams,
  pips and blast FX are Three objects built once and mutated in `useFrame`; hand joints are one
  `InstancedMesh` per hand, packed by `updateHandMesh`.
- Charts in a hidden tab are not mounted (Recharts can't measure a `display:none` parent).

## 6. Loading & navigation

- Fonts via `next/font` (self-hosted, `display: swap`, subsets latin) — no layout shift.
- Route `loading.tsx` with skeletons matching final layout (no CLS). `<Link prefetch>` default on.
- Store persists across routes (client store in root layout) → switching pages never re-runs simulation.
- Optional: persist last input in `localStorage` (try/catch) to restore the demo state on reload.

## 7. Copilot streaming

- SSE stream; render `activity` events immediately ("Running comparison…").
- Append deltas in a ref and flush to state once per animation frame (avoid per-token renders).
- Abort previous request on new send (`AbortController`); 20 s server budget; cache tool results by `inputHash`.

## 8. Build & deploy

- `next build` with Turbopack dev; `transpilePackages: ['@mitsinjo/engine']`; `optimizePackageImports: ['lucide-react','recharts','@react-three/drei']`.
- Static generation for every route (no request-time data except `/api/copilot`).
- Vercel: copilot route `runtime = 'nodejs'`, `maxDuration = 30`.
- Docker Compose (`compose.yaml` + `Dockerfile`, `make docker-up` / `docker-down` / `docker-logs`): one `web` service, `pnpm install --frozen-lockfile` → `next build` → `next start` on :3000 (host `HOST_PORT`, default 3000), healthcheck on `/overview`; root `.env` optional, `LLM_PROVIDER=mock` without it.

## /village 360° tour (VS-T14)

- Photos 4K (4096×2048 JPEG, sans mipmaps à cause de la couture u) : seules la pièce courante et ses voisines restent en mémoire GPU, les autres sont `dispose()`.
- Sphère dessinée en dernier (`renderOrder` 1000, `depthWrite: false`) : pas de surdessin derrière les panneaux, rien n'est coupé.
- Extérieur : 7 photos 4096×2048 JPEG q72 (0,7–2,3 Mo, feuillages lourds) ; même règle pièce courante + voisines (le jardin en a 4).
- Marche (VS-T16) : tout dans le shader de la sphère (intersection rayon / sol + mur, 2 textures seulement pendant la traversée), aucune géométrie ni allocation par image ; positions des flèches mutées sur place.
- Photo de scan (1280×720) calculée sur CPU au tir seulement (pixels de la pièce mis en cache), jamais par image.

- **Vertex AO (PQ-T27):** `vertex-ao.ts` bakes joint and ground shadow into the vertex colours once per recipe (both tiers); parts that cannot reach each other are skipped per part, 24 boxes build in well under 500 ms.
- **Shade map span (PQ-T35):** the shade map is 2 × 2 tiles (256² px, ≈ 256 kB RGBA per mapped surface, built once per session); normal and roughness maps stay 128².
- **Village families (PQ-T32):** placed models draw in one mesh per surface family (matt, gloss, glass, metal, plus glow while a lit appliance runs): ≤ 5 draw calls instead of 1, the look of glass and metal no longer flat.
- **Viewer shading (PQ-T33):** N8AO at half resolution and one 1024² soft shadow map in the object viewer, drawn on demand with the frame (`frameloop="demand"`), so nothing runs at rest.
