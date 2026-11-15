# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-15 · **By:** Claude Code · **Branch:** `feat/vsim-controls-houses` (stacked on PR #17
`feat/vs-t17-xr-extract`); the shape stream (PQ-T67–T82) lives on `feat/pq-t76-cars`.

## NEXT

1. Merge PR #17 (VS-T17–T23, /village extraction + controls), then rebase this branch on `main` and open its PR
   (VSIM-T1–T4 + VS-T24).
2. Play V412–V416 on a headset / the emulator by hand (carousel drag no longer turns the view).
3. Shape stream (other branch): plants PQ-T82 live re-runs, then the PQ phase PR.

## Done this session

- **/village VS-T24:**
  - Mouse clicks reach the scene during the emulated session: the IWER DevUI full-screen canvas used to
    swallow them (wrist « Menu », « Extract in 3D / Cancel »). The mouse is listened on the document
    (capture), aimed with the XR eye camera (`xrEyeAt`), never through HTML panels.
  - A drag that grabbed a panel or a model keeps its events, so the DevUI no longer turns the view.
  - Menu › « Show / Hide the controls help » (Meta: recall help from a menu); legends 12 s on entry, smaller.
  - « Extract in 3D » opens the studio room (`xr-extract-studio.tsx`): carousel in the centre, generation
    column + turning miniature on the right, hologram on the pedestal while building, and the lab opens by
    itself when the model is ready (`HoloBuildPanel` and « Enter the 3D lab » removed). Shared hooks:
    `useHoloImageMaterial`, `useSlideText`. `make vr-probe` 28/28 (lamp check accepts « range hood »).
- **/simulation (VSIM-T1–T4, earlier, committed):** /village control map, walls stop the walker, holo power
  panel per building (undo via `approveChange`), rooms; panel buttons (`userData.xrUi`) win the select ray
  over a wall it crosses first; `make vr-sim-probe` 19/19.

## Decisions

- Power control is per **sector** (engine `sectorCaps`); direct VR power actions apply via `approveChange`.
- The studio shares the extraction's anchor: the question, studio and lab open in one place.
- Emulator mouse hover never overrides what a controller laser aims at.

## Open

- `make vr-probe` depends on live Muse calls (2D views, Spark build): waits are 240 s; a slow call cascades.
- /simulation probe on software GL is slow (minutes).
- Not played on a headset: S125–S132, V400–V416.
