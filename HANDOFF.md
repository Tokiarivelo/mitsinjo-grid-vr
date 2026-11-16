# HANDOFF — read first, overwrite at end of session (≤40 lines)

**Updated:** 2026-11-16 · **By:** Claude Code · **Branch:** `feat/vs-t27-face-chat-lemur-bot` (pushed; stacked
on `fix/vs-t25-studio-text-pot-highlights`, which has no PR yet). Tasks VS-T27, VS-T28 in
`docs/tasks/VR-village-spatial-shoot.md`.

## NEXT

1. Run `make vr-probe` with `make dev-mock` (the dev server ran `LLM_PROVIDER=meta`: the real 3D build missed
   the probe's 240 s wait, so the lab and village-table steps didn't run in the emulator yet).
2. Open the PRs: VS-T25/T26 branch first, then this one (after `make rebase-main`); play V434–V442 by hand.
3. Headset: Quest Browser voice = system keyboard dictation (no Web Speech API there): check it.

## Done this session

- **VS-T27:** AI chat left of the 2D views carousel (`holo-face-chat.tsx`): history per view (`utils/face-chat.ts`,
  bot line settles only after the view was seen drawing), holo keyboard (`utils/xr-keyboard.ts`, UV keys),
  voice (`use-voice-input.ts`, fallback `use-system-keyboard.ts`), « Send » = redraw with details. Robot
  ring-tailed lemur head (`lemur-bot.tsx`, gaze/blink in `utils/lemur-bot.ts`): original design, not a film
  character. Probe: chat keys → send → bot « done » PASS.
- **VS-T28:** village hologram table in the lab (`holo-village-table.tsx`, `utils/village-holo.ts`): place by
  UV, page placement rules, feeder cable, insert via the new shared `hooks/use-appliance-insert.ts` (web
  `ApplianceInsert` uses it too), « Go to the simulation » ends the XR session then pushes `/simulation`.
- **Fix:** a shot that starts the analysis no longer opens « Extract to 3D? » by itself (studio mode);
  regression test in `village-xr-studio.test.tsx`, probe check « the analysis alone asks nothing » PASS.

## Decisions

- Bot replies are the drawing's status (i18n), never generated text. One request at a time.
- No Neon migration, no HF dataset change.

## Open

- `make check`: green except the `recon` time-budget test under full-suite load (passes alone).
- Probe: « wrist menu closed on entry » failed in the last 3 runs; not investigated (no change here touches the wrist menu).
- Uncommitted, not mine: `scripts/iwer-bridge-stop.sh` (orphaned bridges), left as is.
