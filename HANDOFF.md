# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t36-follow-dock` ← `feat/vs-t35-placed-objects-i18n` ← `feat/vs-t34-dispatcher-mixer` ← `feat/vs-t33-xr-query-scale` ←
`feat/vs-t31-desk-turn` ← `feat/vs-t29-chat-readable-voice-level` (PR #20, open). Tasks VS-T29–T38 in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Headset: S158–S161 (VS-T38 map follows, roads, laser), S154–S157 (VS-T37 map), S151–S152 (close ✕, left laser; ← / → swap reverted), V463–V466 (VS-T36 follow dock, « Go to the simulation » fixed; `make vr-handoff-probe` not run yet), S146–S150 (VS-T35 tags, size, night), V450–V458 (desk turn comfort 1.1 s, menu « Close », miniature card), then V442, V444–V449, S133–S135.
   Check Quest Browser opens /simulation's VR session without a new gesture after « Go to the simulation ».
2. Quest Browser voice = system keyboard dictation (no Web Speech API): the level meter needs the mic there too.
3. PR #15 (`feat/pq-q4`, Q4 surfaces & light) stays open: main rewrote the perception pipeline, needs a port.

## Done this session

- **VS-T37:** /simulation VR map: GTA-like mini map low right (`sim-xr-minimap.tsx`), tap → big hologram map, a pin
  opens the sector panel / mixing desk. `make vr-sim-map-probe` passes.
- **VS-T36:** floating « Menu » and « Leave / Back to the studio » moved to a low follow dock
  (`FOLLOW_DOCK_Y`/`_X` in `wrist-menu.ts`, ~34° down, ±0.48 m): no longer over the lab panels / table, no stolen clicks. « Go to the simulation » stayed on /village
  (VS-T33 replaceState cancelled the push): `leaveImmersionFor` freezes the left page's URL.
- **VS-T35:** inserted objects labelled like the village: on screen past 6 markers (`taggedMarkers`), badges at
  the buildings' size; in immersion a 3D tag each (`ImmersionTag`, same switch, shown at start). Lit like the
  village (dark at night only: `duskDarkness`, `placedDim`, `drawnTint`), sized from proportions (`sceneScale`,
  `ARCHETYPE_HEIGHT_M`, stored scale dropped). Immersion tags all translated (`villageTags`). `make placed-shot`.

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

## Decisions

- Scale the viewer, not the village: the scene stays as is; speed, steps, laser, sector panel follow the rig scale.
- Hand-off lives in memory (zustand): a reload drops it (the URL param now re-asks for VR, at the usual viewpoint). No Neon migration, no HF dataset change.

## Open

- `make vr-sim-probe` (software GL) is flaky: last run failed mixer / turn / Enter steps (frames too slow), passes vary run to run.
- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
- Commits need the GPG key unlocked (signing on).
