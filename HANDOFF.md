# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t34-dispatcher-mixer` ← `feat/vs-t33-xr-query-scale` ←
`feat/vs-t31-desk-turn` ← `feat/vs-t29-chat-readable-voice-level` (PR #20, open). Tasks VS-T29–T34 in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Headset: V450–V458 (desk turn comfort 1.1 s, menu « Close », miniature card), then V442, V444–V449, S133–S135.
   Check Quest Browser opens /simulation's VR session without a new gesture after « Go to the simulation ».
2. Quest Browser voice = system keyboard dictation (no Web Speech API): the level meter needs the mic there too.
3. PR #15 (`feat/pq-q4`, Q4 surfaces & light) stays open: main rewrote the perception pipeline, needs a port.

## Done this session

- **VS-T34:** dispatcher label / shelter in /simulation VR → mixing desk (`sim-xr-dispatch-panel.tsx`): battery
  master (reserve, « Start the battery & dispatch » = first run), sector faders (kW cap, Cut / On), one fader per
  appliance wired to the dispatcher (`ems`, auto-listed); laser drag (`utils/xr-drag.ts` in `xr-hands.ts`);
  patches in `utils/dispatch-mixer.ts`; shared `ui/sim-xr-holo.tsx`. Probe: mixer steps in `make vr-sim-probe`.
- **VS-T33:** `?immersion=vr` on /simulation and /village, `&lab=2d|3d` at the studio desks
  (`microgrid-3d/utils/immersion-query.ts`, `hooks/use-immersion-query.ts`; reload reopens); « Go to the
  simulation » → `/simulation?immersion=vr`. Sim VR rig scaled 0.5 in the half-scale village (eyes ≈ 0.8 m), 1:1
  in rooms (`utils/xr-walk.ts`); ← / → turn the head from the keyboard while walking (touchpad off while typing).
- **VS-T29–T32:** readable panels and icons, voice meter, controllers / hands / lasers, desks turntable (2D ↔ 3D
  lab), menu « Close », miniature card — details in `docs/tasks/VR-village-spatial-shoot.md`.
- Probes: `make vr-probe`, `make vr-sim-probe` (+ felt step, eye height, keyboard turn, mixer).

## Decisions

- Scale the viewer, not the village: the scene stays as is; speed, steps, laser, sector panel follow the rig scale.
- Hand-off lives in memory (zustand): a reload drops it (the URL param now re-asks for VR, at the usual viewpoint). No Neon migration, no HF dataset change.

## Open

- `make vr-sim-probe` (software GL) has crashed the page at a different step each run (wall, Enter).

- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
- Commits need the GPG key unlocked (signing on).
