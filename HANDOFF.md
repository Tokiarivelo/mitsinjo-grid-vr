# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t29-chat-readable-voice-level` (from `main`
after PR #19 merge). Tasks VS-T29, VS-T30 in `docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Headset: play V442, V444–V449 and S133–S135 (lasers on bright sky / dark rooms, hide hands & controllers). Check that Quest Browser opens /simulation's VR session without a new
   gesture after « Go to the simulation » (else the « View in VR » button lands next to the object).
2. Quest Browser voice = system keyboard dictation (no Web Speech API): the level meter needs the mic there too.
3. PR #15 (`feat/pq-q4`, Q4 surfaces & light) stays open: main rewrote the perception pipeline, needs a port.

## Done this session

- PR #19 (VS-T25–T28) merged. Earlier fixes: Cancel under the floating Menu button, `make dev-mock` offline.
- **VS-T29 readable panels:** text sized in dmm for the reading distance (`holoTextPx`, `HOLO_TEXT_DMM`,
  Meta ≥ 14 px / 18 px comfortable); `layoutHoloCard` also shrinks a word wider than its card.
- `HoloButton`: line icons (`holo-icons.ts`), hover popover (label large + `tip`), label in dmm (`distance`).
- Chat: « Keyboard » · « Dictate » · « Send » with icons and tips; « Voice level » meter in the field while
  dictating (`holo-voice-meter.tsx`, mic tapped by `use-voice-input.ts`; `lib/voice-analyser.ts` shared
  with the copilot hook).
- Village table: title, status and buttons upright above the far edge at eye level.
- « Go to the simulation » → `/simulation` enters VR by itself next to the object (`microgrid-3d/utils/
xr-handoff.ts`, `standNear`; dev hook `__XR_HANDOFF__` for `make vr-sim-probe`).
- **VS-T30:** /simulation controllers were clipped by the camera's 0.5 m near plane → `XrInputsLayer` (both
  canvases) sets 5 cm while presenting. Hand / controller models on `XR_INPUT_LAYER`, shown / hidden by a stick
  held 0.8 s (click = help on release) or /village Menu button; choice in localStorage. Lasers: colour from the
  surface they meet (`xr-ray-contrast.ts`), opposite-tone halo.
- Probes: `make vr-probe` (table buttons above the table), `make vr-sim-probe` (controllers drawn, hold toggles).

## Decisions

- Hand-off lives in memory (zustand): a reload drops it. No Neon migration, no HF dataset change.

## Open

- `make check`: `recon` / chart time-budget tests flake under full-suite load (pass alone).
