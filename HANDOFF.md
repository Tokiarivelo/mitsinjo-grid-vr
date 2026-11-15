# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `feat/vsim-controls-houses` (stacked on PR #17
`feat/vs-t17-xr-extract`); the shape stream (PQ-T67–T82) lives on `feat/pq-t76-cars`.

## NEXT

1. Merge PR #17 (VS-T17–T23, /village extraction + controls), then rebase this branch on `main` and open its PR.
2. Shape stream (other branch): plants PQ-T82 live re-runs, then the PQ phase PR.

## Done this session

- **/village (PR #17):** extraction to 3D in VR (scan strip 180°, full outlines that stay on the object while
  walking, « Extract in 3D? » → views carousel → build → 3D lab); panels tap reliably (4° drag slop);
  controls rewrite VS-T23 (snap turn, step, A/X analyse, B/Y back, legends, aim hint, thumb gestures).
  Docs: `docs/vr-immersion-guide.md` § 6, `docs/vr-iwer-tools.md`. `make vr-probe` 25/25, `make vr-iwer-tools` 31/31.
- **/simulation (this branch, VSIM-T1–T4):** same control map as /village; walls stop the walker
  (`utils/walk-grid.ts`, grid from scene triangles, bushes < 1.2 m walked through); label / building →
  holo power panel (`sim-xr-sector-panel.tsx`): − / + 0.5 kW, Cut all / Restore, Undo via `approveChange`
  (sector caps, engine run), clinic never cut; « Go to the door », « Enter » a room (`sim-xr-interior.tsx`)
  lit by the engine coverage. Fix: XR controllers were never tracked on /simulation (created after the
  session) → `primeXrInputs` at canvas creation. `make vr-sim-probe`.

## Decisions

- Power control is per **sector** (engine `sectorCaps`), « Households » = all homes (user choice).
- « Enter » = teleport into a modelled room off-map (y −60), plus a door spot outside (user: both).
- Direct VR power actions are human actions: applied at once through `approveChange` (undoable), not proposals.

## Open

- /simulation probe on software GL is slow (minutes); screenshots may be skipped there.
- Microgestures only where the browser exposes them; R2 facade images may need CORS for WebGL.
- Not played on a headset: S125–S132, V400–V411.
