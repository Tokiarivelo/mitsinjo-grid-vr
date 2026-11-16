# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t31-desk-turn`, stacked on
`feat/vs-t29-chat-readable-voice-level` (PR #20, open). Tasks VS-T29–T32 in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Headset: V450–V458 (desk turn comfort 1.1 s, menu « Close », miniature card), then V442, V444–V449, S133–S135.
   Check Quest Browser opens /simulation's VR session without a new gesture after « Go to the simulation ».
2. Quest Browser voice = system keyboard dictation (no Web Speech API): the level meter needs the mic there too.
3. PR #15 (`feat/pq-q4`, Q4 surfaces & light) stays open: main rewrote the perception pipeline, needs a port.

## Done this session

- **VS-T32:** telemetry HUD removed (event line → `xr-event-toast.tsx`, 4.5 s notice); scan crystal above the
  card (`AIR_CRYSTAL_Y`); command guide wraps in a holo card; menu « Close » (`MENU_CLOSE_OFFSET`); miniature
  card with state, help and « Put away » (`miniature-label.tsx`, `dismissMiniature`).
- **VS-T31 desks:** 2D lab and 3D lab back to back on a turntable round the viewer (`studio-desks.tsx`,
  `deskTurnAngle` / `deskYaw` / `deskPivot`); « Validate & build » turns right → left; « 2D lab » (far left of
  the lab) / « 3D lab » (generation column, once built) go back and forth (`toViews` / `toLab`).
- **VS-T29:** text in dmm (`holoTextPx`, `HOLO_TEXT_DMM`); `HoloButton` icons + hover popover (`tip`); chat
  voice level meter (`holo-voice-meter.tsx`, `lib/voice-analyser.ts`); village table buttons above the table;
  « Go to the simulation » enters VR next to the object (`microgrid-3d/utils/xr-handoff.ts`).
- **VS-T30:** controllers no longer clipped (`XrInputsLayer`, 5 cm near plane); hands / controllers hideable
  (stick held 0.8 s or Menu button); lasers coloured against what they hit (`xr-ray-contrast.ts`).
- Probes: `make vr-probe` (desks round trip, menu Close, Put away), `make vr-sim-probe`.

## Decisions

- Hand-off lives in memory (zustand): a reload drops it. No Neon migration, no HF dataset change.
- Putting a miniature away leaves the simulation untouched (it only clears the miniature in reach).

## Open

- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
- Commits need the GPG key unlocked (signing on); VS-T31 is staged, VS-T32 unstaged until then.
