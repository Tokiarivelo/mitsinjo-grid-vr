# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-18 · **By:** Claude Code · **Branch:** `fix/vercel-icon-retry` (from `main` a1f15844), merged into `main`.

## NEXT

1. Check on the Vercel deploy: sidebar logo (animated GIF), and a 3D generation that used to hit « Task timed out after 300 seconds » (scenarios V545, T42).
2. Screen check of the end of phase on `/village`, live Meta (contributor model): V533–V544.
3. Repair `make gen-evals` / `make hf-dataset`: `jiti` not installed in the workspace.

## Done (this session)

- Logo: the sun wears a VR headset (all icon sizes, favicons). Sidebar shows `public/logo-vr.gif` (headset appears / vanishes with sparkles), static `icon-192.png` under reduced motion. The broken icon came from `next/image` on `/icon.png`, which is the `app/icon.png` metadata route: Vercel's optimizer answered 404.
- Server retry: `server/retry.ts` `withRetry` (3 retries, 1/2/4 s backoff, stops on abort). Used by `PerceptionClient.run` (transient errors) and `museImage` (transient + empty answer).
- Faces: after the retries a Muse Image failure is a 500 (no silent placeholder). Face route `maxDuration` 300.
- Shape route: own deadline `SHAPE_DEADLINE_MS` (280 s) aborts stalled Meta calls, sends an outline `timeout` result.
- Lab (web): `RetryPrompt` (« Retry? » Yes / No) + `CancelGenerationButton` on the main 2D view, each face and the 3D outline fallback. Hooks: `useFacade2d().cancel`, `useFacadeFaces().cancel(face)`.
- VR: carousel Yes / No on a failed view, « Stop » while drawing; lab asks « Retry the 3D? » (reducer event `rebuild` lab → build). `useXrExtract` gains `stopView`, `retryShape`.

## Decisions

- Logo sources were made with a one-off sharp script (SVG headset over the old PNG), not kept as a make target.
- Golden / recon tests time out under the full parallel run but pass alone (pre-existing).

## Checks

- tsc clean, eslint clean on touched files, `make check-i18n` green, targeted tests 60/60, the 9 flaky suites 71/71 alone.
