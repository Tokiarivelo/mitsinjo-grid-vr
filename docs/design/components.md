# Components

Props are specs, not final signatures. Colors/radii: tokens.md. Layout: shell.md.
Types: `SimStatus = ready|modified|running|complete|error`; `SectorId = health|water|school|households|market`; `Priority = critical|high|medium|low`; `StrategyId = proportional|essential_first|balanced`.
Common: every interactive element has hover, active, disabled, focus-visible (2px energy-cyan ring), icon-only buttons need aria-label.

## AppShell

- Props: children, copilotOpen, onCopilotToggle. Composes Sidebar, Header, CopilotPanel. Layout: shell.md.

## Sidebar

- Props: activeRoute, status: SimStatus, collapsed?. Items/routes: shell.md.
- States: expanded, collapsed (rail), drawer (<1280).

## Header

- Props: title, subtitle?, breadcrumb?, status: SimStatus, onReset, onCopilotToggle. Contains ScenarioSelector.
- Reset disabled when status=ready and unmodified.

## CopilotPanel

- Props: open, onClose, messages, suggestedPrompts, pending: boolean, error?: string.
- Header "Mitsinjo Copilot" + `AI EXPLANATION` label; scroll list of ChatMessage/ToolActivity; suggested prompts when empty; input (Enter send, Shift+Enter newline).
- States: empty, streaming/pending, error (copy: states-copy.md), AI unavailable (input disabled). Violet accent only here.

## MetricCard

- Props: variant: solar|battery|demand|essential; label; value: string|number; unit; delta?: {value, direction, label}; caption?; icon?; status?: normal|warning|critical; loading?; empty?.
- Variant accent: solar=solar-amber, battery=battery-green (warning/critical by soc), demand=energy-cyan, essential=critical-red only when threshold crossed else battery-green.
- Value in display/mono; unit muted. States: loading skeleton, empty ("--" + hint), warning, critical (label + icon, not color alone).

## StatusBadge

- Props: variant: ready|running|complete|warning|critical|simulated|ai; label?; icon?; size: sm|md.
- Restrained fill (~12% tint), readable text; `simulated` = neutral outline "SIMULATED DATA"; `ai` = violet "AI-GENERATED"; running may show subtle spinner (static under reduced motion).

## EnergyBar

- Props: label; sectorId?; valuePct (0-100); servedKwh?; demandKwh?; priority?; status?: full|partial|critical; showValues?; empty? (no run yet: "—", empty track, no status text).
- Row: icon, name, bar, `%` mono, status label. Fill: battery-green >=target, warning-amber partial, critical-red critical sector shortfall. role="progressbar" with aria-valuenow and text label.

## ScenarioSelector

- Props: scenarios: {id, name, description}[]; value; modified: boolean; onChange.
- Keyboard-accessible listbox; shows name + short description; "Modified" indicator dot+text when modified. Changing scenario while modified asks to discard (ConfirmProposalDialog style confirm).

## SimControl

- Props: label; value; unit; min; max; step; onChange; error?; description?; kind: slider|input|select.
- Shows current value beside label; "min-max unit" hint; aria-valuemin/max/now. Invalid: message naming field and fix; never silently clamp without telling.
- Controls (from source): solar multiplier, battery capacity, initial SoC, demand adjustment, duration, scenario, strategy.

## InsightCard

- Props: title; text; evidenceRef: string (result field path or label); actionLabel?; onAction?; origin: computed|ai.
- origin=ai shows `AI-GENERATED` badge + violet edge; computed uses neutral. Only render when condition true in results.

## ChatMessage

- Props: role: user|assistant|evidence|error; content; sections?: {happened, evidence, whyItMatters, exploreNext}; evidence?: {label, value, unit, field}[]; onRetry?.
- User: right, surface-elevated. Assistant: violet-edged, `AI EXPLANATION`; four sections in order What happened / Computed evidence / Why it matters / Explore next. Evidence rows are mono, neutral (computed), never violet. Error: retry action.

## ToolActivity

- Props: label (e.g. "Reading current scenario"); state: running|done|failed.
- Small inline row, mono; render only for tools that actually executed.

## BuildingPanel

- Props: sectorId; name; category; priority; demandKwh; servedKwh; unservedKwh; coveragePct; status: full|partial|critical; explanation?; onClose.
- Anchored panel (desktop) or drawer (<768). Rows: demand, allocated, supplied %, unmet, priority, status badge, short explanation. Values illustrative only until bound (e.g. Clinic 8.0 / 7.2 / 90% / 0.8 kWh is example).
- Esc closes; focus returns to scene.

## ConfirmProposalDialog

- Props: open; proposal: {summary, changes: {field, from, to, unit}[]}; valid: boolean; validationErrors?; onApprove; onReject.
- Modal (radius 20). Shows AI-proposed scenario diff validated against schema; Approve (primary) disabled if invalid; Reject (ghost). Never auto-applies. Label `AI-PROPOSED`.
- Clinic guard (K6, `clinic-guard-warning.tsx`): unsafe patch → critical-red alert block above the engine block, Approve
  turns `danger`; first click arms (border solid, label "Confirm: cut the clinic"), second click approves.
- Layout follows the card width (`@container`): narrow (chat panel) → one diff column, Approve / Reject stacked full
  width (≥ 44 px); wide → grid + buttons in a row. After a decision: `DecisionBadge` (Approved green / Rejected neutral),
  no buttons, diff from the decision snapshot (`ProposalDiffList` muted).
- Per-line approval (K3, `useProposalSelection`): 2+ lines → hint line + a checkbox per row (whole row is the label,
  ≥ 44 px, `aria-label` « Apply: <setting> »), all checked at first; unchecked rows dim. Engine block and clinic guard
  follow the checked lines (recomputed with `proposalImpact`); Approve reads « Approve selected (n) » when lines are
  left out and is disabled when none is checked. `ProposalSkippedList` shows the left-out lines (« Not applied
  (unchecked) », dimmed) on the decided card and on the decision message.

## Chat extras (copilot)

- `ProposalDecisionMessage`: posted after Approve / Reject / Undo, `role="status"`; green (approved) or neutral
  (rejected, undone), title + one line, proposal id + time, the settings concerned. `onUndo` → secondary « Undo last
  change » button (≥ 44 px, full width when narrow), only on the last approved change still applied.
- Fallback note: amber `role="note"` above an answer that came from the offline copilot, text per reason.
- `EvidenceTable`: one engine result (channel / value). Last one shown; earlier ones in a `<details>` « Show all
  evidence (n) » (summary ≥ 44 px, chevron rotates when open).
- `RetryAnswer`: secondary « Retry » (≥ 44 px, full width when narrow) under the last answer or error; on a redone
  answer a muted note « Answer redone below (Retry). »
- Follow-up suggestions (`SuggestedPrompts variant="compact"`): one horizontally scrollable line, hidden while answering.
  `fires` prop: fire questions first, `tone: 'incident'` chips (flame, critical-red border), header « About the fire ».
- Microphone: tap to record, tap to stop (spinner while transcribing); text lands in the input, editable. Errors
  (unsupported, denied, failed, empty) show inline in amber, dismissible. Auto-scroll only while the reader is at the bottom.
- Playback line: when the copilot ran `control_playback`, a cyan `role="status"` pill (clock icon) « Time cursor moved
  to 18:00 » / « Playback paused »… above the answer.
- `ChatComposer` (`useChatComposer` state): input + attach / sketch / mic / send; `variant` `card` (tab) or `terminal`;
  an attached image chip has « Find appliances » (scan icon, ≥ 40 px) → `VisionDialog`.
- `DetectionCanvas` (`features/vision-insert`, PV-T7): photo + SVG overlay (`viewBox 0 0 1`, one path per detection: SAM
  outline or box). Each object its own colour (`utils/mark-color`: golden-angle hue + 3 lightness steps, `--mark` from
  `--theme-mark-s/l` per theme), same colour on its list row border; hover/focus = stronger fill + label chip, selected = thicker
  stroke + fill and tinted row (outline repeated on top, no pointer). Paint order biggest first (`utils/stacking`): a small box
  under a big one stays clickable; a click picks the smallest box there, a 2nd click on the same spot the one under it.
  Edit handles (draw / adjust) sit outside the shape so a tiny box can still be dragged. Pointer: hover/tap on the
  photo; keyboard + screen readers: the « Appliances found (n) » list below (buttons ≥ 44 px, focus = same highlight).
  States: loading (dimmed photo + status + « Cancel the analysis »), refining (outlines coming, cancel keeps the boxes), ready, empty, error + retry, cancelled (« Analysis cancelled. » + retry). Violet « AI perception ·
  to verify » tag; demo note when the mock answered. Category shown only when it differs from the label.
  PV-T8 (`onSendShapes`, optional): « Draw missing objects » → `DrawOverlay` on the photo (role application, touch-none,
  pointer capture) + `DrawPanel` below. Tools: Rectangle · Free hand · Magnetic lasso (snaps to the strongest edge within
  3 % of the photo, Sobel on a ≤ 320 px copy, `useEdgeMap`; canvas blocked → draws freely + note). Several shapes before
  sending (≤ 10 per send); each stays editable: drag = move, 4 corner handles (44 px hit area) = resize, keyboard arrows /
  Shift + arrows / Delete, « Add a box » (centred). Per shape: « What is it? (optional) » free text, trash. « Send the
  object / objects (n) » → objects listed at once (dashed, « Added by you », « Identifying… »), then named by the model.
  Also in the error state; ≤ 30 per photo (button disabled + note).
  Zoom (user request 2026-10-31, `usePhotoZoom`, `ZoomControls`): − / « 100 % » / + above the photo (1 · 1.5 · 2 · 3 · 4×,
  44 px buttons). The photo sits in a `max-h-[60vh]` scroll box (bars, wheel, touch pan); its width is fitted (tall photos
  ≤ 60 vh, so overlays match) × zoom, every layer stays in photo fractions. Zooming keeps the view centre (or the box being
  adjusted). While drawing or adjusting on a zoomed photo: hand toggle « Move the photo » (`aria-pressed`) = the drawing
  layer lets pointers through to pan. `onAdjustBox` (optional): « Adjust the box of {label} » for the selected object (AI
  or drawn, not while identifying) → the box in the same editor (drag, corners, arrows / Shift + arrows), amber panel
  Save / Cancel; saved box → `adjusted: true`, SAM outline dropped, « Adjusted » chip in the list.
- `VisionDialog`: portal to `body` (glass panels trap fixed overlays), bottom sheet on mobile / centred card ≥ sm,
  runs detection on open, Esc closes, footer shows the selected appliance (insert comes in V4).
  (`❯` prompt, short placeholder). `ModelPicker` `{models, value, onChange, size: md|sm|terminal}`: one select for both.
- `CopilotTerminal`: full-screen glass chat (`GlassPanel`), same conversation as the tab via `CopilotProvider` /
  `useSharedCopilot`; title bar (dots, title, AI badge, new session, close), model line, log, terminal composer.
  Modals (lightbox, sketch) render outside the glass (`backdrop-filter` would trap `fixed`).

## Fire alarm (`features/fire-alert`, M2-T2)

- `ReportFireControl` (`variant` `hud` | `panel`): danger button « Report a fire » (Flame) → sector list (≥ 44 px rows,
  burning ones disabled « On fire ») → `reportFire(sector)` at the shown hour, no approval. In every view's HUD (3D,
  Topology, Circuit, full screen too) and at the top of the « Telemetry & Controls » deck.
- `FireAlertBanner`: big red `role="alert"` card while a fire burns (flame pulse, « FIRE: <sectors> cut off », since when,
  « Simulated alarm » tag, links « See the village » / « Ask the copilot »). Sticky at the top of every page (`FireAlertLayer`
  in `AppShell`); `compact` one-line version inside the viewport (shows in full screen).
- `FireSnackbars`: bottom right (above the mobile nav), one `role="alert"` card per fire that just started (reported or reached
  on the timeline), hides after 10 s or on « × » (44 px); shows again if the fire ends and comes back.
- 2D diagrams: burning sector card = 2 px critical-red border + glow + « On fire » flame badge; its wire shows the cut mark.

## GlassPanel

- Props: className (position / size); innerClassName; glow? (default on). Outer `relative isolate`, blurred
  ai-violet → energy-cyan glow behind; inner `bg-surface/40 backdrop-blur-2xl` + `shadow-glass-glow` token, 28 px radius.
- Used by the copilot terminal and the full-screen controls drawer. Content inside should not add its own opaque card.

## TimelineScrubber

- Props: timeIndex; onTimeChange; stepResult?; hasResults?; isPlaying; play/pause/stop/restart handlers;
  followsDevice?; deviceHourMs?; compact?; onToggleCompact?.
- `onToggleCompact` adds a minimize / expand button (`aria-expanded`). `compact` = one bar: transport, hour, slider
  (slider on its own line on phones); no title, tick labels or hour telemetry.

## Button

- Props: variant: primary|secondary|ghost|danger; size: sm|md; loading?; disabled?; icon?; children.
- primary: solar-amber bg, dark text. secondary: surface + border. ghost: transparent, text-secondary. danger: critical-red, destructive only.
- States: hover, active, disabled, focus-visible, loading (spinner + label retained, aria-busy).
- Links styled as buttons: `<Link className={buttonVariants({ variant, size })}>`; never nest `<Button>` in `<Link>`.

## EmptyState

- Props: title; description; actionLabel?; onAction?; icon?; tone?: neutral|error.
- Copy per case: states-copy.md. Always offers a next action when one exists.

## ChartCard

- Props: title; subtitle?; unit; legend?; summary: string (text alt); empty?: boolean; loading?; children (Recharts).
- Transparent chart bg, minimal grid, muted axes, units on axes, tooltips with exact value + definition. Empty state required. Colors per tokens.md; kW and kWh never on one unshared axis.

## ConditionControlsGrid

- Props: controls (from `useConditionControls(input, status, onPatch)`); fields? (subset, in order); showDescriptions?.
- Columns follow its own width (`@container`: 1 → `@md` 2 → `@3xl` 3), so it fits narrow drawers; `SimControlsPanel` too.
- Used by SimControlsPanel, AssumptionsInspector and StrategyParamsPanel; validation via `usePatchValidation`.

## StrategyParamsPanel / SectorRuleRow

- Panel props: input; status; isModified; onPatch; onReset; defaultOpen?. Collapsible header button (aria-expanded) with StatusBadge.
- Row props: sector; cap?; onPriorityChange; onCapChange(cap | null). Native select + number inputs, ≥ 44 px; invalid cap → `role="alert"` message.

## ApplianceCurveChart (PV-T11b)

- Props: curve (24 kW values), peakKw, dailyKwh. Compact 120 px Recharts bars (cyan, hour ticks every 6 h,
  kW tooltip), title + screen-reader summary of the same peak/daily numbers. Lives in the insert panel.

## ObjectDisplayControls (PV-T11b)

- Props: scale, tint (null = measured), onScale, onTint, onReset. Size slider 50–200 % with % readout, native
  colour picker, reset button shown only once tweaked. Viewer-local state, per object; never stored.

## Free placement (PV-P)

- `PlaceMinimap` (`features/vision-insert`, PP-T4, VS-T39): top-down village SVG drawn like the /simulation map
  (shared `MAP_FEATURES` / `MAP_PINS`): paddy, lake and pond, laterite roads and paths, one named dot per sector
  building (current feeder cyan), the EMS shelter, a north arrow. Opens on the village (±40 units); « Whole terrain »
  toggle (`aria-pressed`, 44 px) shows ±115 (auto when the spot is out of the village); marks and names keep their
  on-screen size at both zooms (text halo on `stroke-canvas-sunken`). `role="application"`, labelled + help line (`minimapLabel`, `minimapHelp`), crosshair cursor.
  Click / tap places; arrows move the cursor (Shift = ×5), Enter / Space places; screen-reader live readout of the
  cursor (`cursorAt`). Rounded panel on `bg-canvas-sunken`, cyan focus ring; full width down to 320 px.
- Marker select + drag (`features/microgrid-3d`, PP-T5): click a marker = select (flat ground ring + cyan tag
  border, click again = deselect); press + move past 4 px = drag on the terrain (the instance hides, a translucent
  cyan ghost follows the pointer, orbit stays off until release); release commits, pointer-cancel aborts cleanly.
  The feeder follows the nearest building unless the operator overrode it. Touch: pointer events, no scroll trap.
