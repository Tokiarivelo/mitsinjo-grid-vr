# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `fix/vs-t25-studio-text-pot-highlights` (pushed;
VS-T25 + VS-T26 in `docs/tasks/VR-village-spatial-shoot.md`).

## NEXT

1. Open the PR for this branch (VS-T25–T26) after `make rebase-main`; play V417–V428 in the emulator by hand.
2. Highlights misplaced after turning during an analysis (user report): not reproduced; the projection
   chain checks out. Need the exact repro (Play vs cursor mode, real Muse vs mock, during « refining »).
3. Shape stream (other branch): plants PQ-T82 live re-runs, then the PQ phase PR.

## Done this session

- **VS-T25:** hologram cards shrink every line together (no clipped titles); walk in the studio (left stick,
  80 cm steps, mouse wheel; `studio-walk.tsx`); Play-mode mouse turns the held carousel / model, not the view;
  bigger 2D views; potted plants keep their pot (`server/perception/tree/plant-pot.ts`, `PlantPot` in the plan).
- **VS-T26:**
  - Real articulated hand (`generic-hand`, skin + pale fresnel rim) and the runtime's controller model,
    from the WebXR input profiles CDN, simple models offline (`microgrid-3d/utils/xr-input-models.ts`).
    three's factories are re-exported from plain JS + a `.d.ts` (`three-xr-factories.*`): their typings
    pull three `src/` types and broke `tsc` project-wide.
  - Laser per Meta « Ray casting »: short fading beam (25 / 35 cm, 10 cm gap) + constant-angle cursor ring,
    white / `#001E78` at 83 % on press (`xr-ray-visual.ts`), on /village and /simulation.
  - Wrist « Menu » floats in the room in the emulator or with no left wrist (was head-locked, unreachable).
  - « Leave the studio » / « Back to the studio · name » (`FollowGroup`); the same object resumes its step
    and its lab (`away` in `utils/xr-extract.ts`).
  - Lab layers list scrolls with a vertical pinch-and-drag (panel `axis: 'y'`).

## Decisions

- No Neon migration (plant `pot` is an optional field of a JSONB plan); no HF dataset change.
- Emulator detection (`isDevXREmulated`) decides only where the Menu button sits.

## Open

- `make check`: green except the `recon` time-budget test under full-suite load (passes alone).
- Not played on a headset: S125–S132, V400–V428.
