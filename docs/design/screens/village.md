# /village — Village editor (PV)

Purpose: turn a photo into appliances the operator can add to the simulated village. AI finds and outlines;
the engine catalog gives power (never the AI). Sidebar + MobileNav entry « Village editor ».

- Intro card: scan icon, « Add appliances from a photo » + one-line purpose, `SIMULATED DATA` badge.
- No photo: dashed drop zone (drag & drop), primary « Choose a photo » (JPEG/PNG/WebP), secondary « Use the sample room »
  (`/samples/vision-room.jpg`). Wrong type → inline red alert, no call.
- Photo: `DetectionCanvas` (components.md) left; aside « Selected appliance » right (460–540 px on desktop, stacks under on < lg):
  Studio workbench with tabbed inspector (`[Active Object]`, `[Installed Appliances (N)]`, `[Microgrid Twin]`) to eliminate vertical scroll fatigue.
  Selected object has sub-tabs: `[3D Twin & Elevation]` (3D model + facade + 6 angles) and `[Load & Placement]` (power settings, minimap, 24h curve, CTA).
  « 3D model » is built on demand (user, 2026-11-01): selecting shows a kept model or « Not built yet », so picking to
  adjust a box costs no Spark call. 2D facade first (user, 2026-11-02): « Imagine 2D facade » (Muse Image) → « Validate
  & Generate 3D » is the only way to build; there is no direct 3D button, and the 6-angle preview validates only once a
  facade exists. The validated facade (`facadeUrl` + `facadeKey`) goes to Spark as a second image beside the crop
  (`describeShape` / `describeParts`) to refine windows, doors, roof and parts; the crop keeps size, pose and colours.
  Each object keeps its own facade (reset on a new photo); « Regenerate » reuses it; a new facade asks Spark again.
  On a house, SAM also reads the facade's windows and doors: they place the model's openings (PR-2.22).
  A house or building whose facade SAM can read is rebuilt from it (PR-2.23): walls, hip / gable roof, chimneys,
  door and windows at the facade's places and proportions, depth from a Muse Image side view; ≈ 45–60 s.
  Viewer on `.viewer-studio` (radial backdrop `--theme-viewer-center/edge`, lighter than dark objects in dark theme), rim
  light from behind + one baked contact shadow. Studio look (PT): softbox environment, soft bevelled edges on every
  body (box, hull, cylinder, cone, prism, silhouette), clearcoat on painted / plastic / tile / glass / metal, ink
  outline in `text-primary` (light in dark theme, dark in light theme); fades in once shaders are compiled.
  « 3D model »: title + badge (violet « AI shape » = Spark recipe; grey « Outline shape » = fallback + one-line why (Meta did not answer / AI shape unusable) + « Try the AI shape again »), viewer
  `h-72 sm:h-80 xl:h-96` on `bg-canvas-sunken` (orbit + zoom, no pan), « Drag to turn · pinch or scroll to zoom », « Parts seen on the photo: Wheels 2/2 · Windows 1/3 ⚠ not built: 2 » (AI shape with SAM part masks or parts listed by the kit, PQ-T37; every SAM word of the Muse cards has a `model3dPart` label, any other listed word is counted under « Other parts 1/2 », never a raw key; warning icon `warning-amber`, text body colour), question « Not sure what this is. Pick the closest: » with two 44 px choices « Choose Vehicle » / « Choose Cabinet or appliance » (`FamilyQuestion`, `bg-surface-elevated` card, row that wraps on a phone, only when `ObjectShape.ask`; the pick rebuilds the model with that family as the hint, PQ-T41), hint « Object too small on the photo… » / « Photo blurred… » with an `ImageOff` icon when `conditions` say so (PQ-T7), display tweaks
  (PV-T11b: size slider 50–200 %, tint picker, reset — visual only, per object). Loading: spinner line +
  Improvement chip (PG-T18) over the viewer while background stages run: « Improving: stage n/4 — Roof » + progress bar + stage score before → after (unchanged: « Stage already matches the drawing (n %) » at the gate, « No better change found (n %) » otherwise), then « Model finalised » / « Improvement stopped: <cause> », fades after 4 s (`aria-live=polite`); the model swaps in each improved stage.
  live AI steps (violet box: « Extracting the object » → « Muse Spark imagines the parts » with seconds → « Fitting the parts »,
  done = green check, wait hint 15–40 s) + skeleton. Outline note per reason (Meta error + « Cause: HTTP n », timeout, spend cap,
  server unreachable, unusable). No WebGL: note, photo stays the reference. One Spark call per object per photo (kept on reselect).
  « Add to the simulation » (PV-T11/T12, under the 3D block, `ApplianceInsertPanel`): toggle « AI estimate » (violet) / « Manual »
  (cyan), note, fields name · type · position · feeder line · power per unit (catalog range under it, red when out) · quantity (1 column on
  mobile and lg aside, 2 on sm / xl), engine preview line, cyan « Insert into simulation » (« Update » + « Remove » once in),
  green status « In the simulation: strategies re-computed. ». Scenery: note « no load by default ». List row chip « In simulation ».
  Engine preview line + 24 h load-curve bars (PV-T11b, engine values, text summary for screen readers).
  Free placement (PV-P, PI): position = « Ring around the building » by default or « Place on the map » (`PlaceMinimap`,
  components.md); feeder line = the sector select, preset to the nearest building (« Nearest: … », « Auto » to follow again).
  Grid connection (PI-T8): choice between « On feeder branch (recommended) » and « Direct to Dispatch EMS » with D1 load reminder.
  The minimap displays the central Dispatch EMS shelter, placed object keep-out clearings, and catenary derivation lines.
- Inserted 3D models & derivations (PI-T1..T10, live preview and /simulation):
  3D models merged into a single BufferGeometry (≤ +2 draw calls); each placed object rests in an automatic tree clearing (PI-T4)
  with a draped red laterite yard (`GROUND_HEX.laterite`, radius ≥ 2, irregular border via `fbm2d`, draped at `terrainHeight + 0.03`, faces up, PI-T5)
  and a red laterite track from the yard to the nearest village path (`utils/access-paths`, +4 cm, same draw call); trees on both are cleared.
  Realistic catenary derivation cables with wooden utility poles (spaced ≤ 4.5 m, PI-T7) connect the object to its branch line or
  directly to the Dispatch EMS shelter (`BUS_POSITION`), avoiding obstacles (buildings, pond, other models) via corner waypoints (PI-T6).
  On 2D topology and circuit diagrams (PI-T9), the derivation branches cleanly with animated electron flow matching active power,
  ending on a named card (status dot, name, engine kW; click selects its sector). Topology places it in the nearest free spot
  (`appliancePills`, first 12 lines); circuit cards are narrower and the appliance cards sit beside them (2 per row, EMS ones above).
  Press + drag moves the marker on the terrain (ghost preview, orbit frozen, commit on release); tree clearing, yard, and derivation
  poles recalculate smoothly on commit (`pointerup`). Removing an object restores the trees and terrain immediately.
- Right column (lg 460–540 px, under on mobile): tabbed Studio Inspector (`[Active Object]`, `[Installed Appliances]`, `[Microgrid Twin]`) so the current village state stays instantly accessible without infinite scrolling.
- Every object has its own outline colour, repeated as its row border in « Objects found »; scenery (house, car, tree…) has a lighter
  fill and a « No load » chip; selected = thicker outline.
- Missing objects (PV-T8): « Draw missing objects » under the photo → rectangle, free hand or magnetic lasso, several shapes,
  each movable / resizable until sent, optional « What is it? » text → « Send the objects (n) »: listed at once after the AI
  objects (« Added by you », « Identifying… »), then named and sorted by the vision model, outline refined by SAM. Removable.
- Photo zoom (− / 100 % / +, pan by scrolling or the hand toggle while drawing) and « Adjust the box » on the selected object
  (AI box moved / resized, then saved) — `components.md` § DetectionCanvas.
- States: loading / refining / ready / empty / error + retry (states-copy.md « vision »). Mobile: one column, `pb-20`.
- 3D Studio (PQ-T77, every model: house, car, drawn hull, parts recipe; built without mockup): « Full screen »
  (maximize icon, top right of the 3D viewer, ready model only) opens a full-viewport overlay (`fixed inset-0`, `bg-canvas`,
  browser full screen when allowed, Esc closes). Top toolbar (scrolls sideways on mobile, 44 px targets, icon + label ≥ md,
  `aria-label` always): tools Select (Q) · Move (G) · Rotate (R) · Scale (S); view Textured · Solid · Wireframe · X-ray;
  camera Front (1) · Right (3) · Top (7) · Back · Left · Bottom · Perspective (5) · Frame selected (F); Hide (H) · Show all
  (Alt+H) · Isolate (/); Undo (Ctrl+Z) · Redo (Ctrl+Shift+Z) · Reset all; Close. Canvas: grid floor + axes, orbit + pan,
  gizmo (Move / Rotate / Scale) on the selected piece; a click selects a piece, empty space deselects. Right panel
  (lg 320 px; under the canvas on mobile, max 45 vh, scrolls) « Layers »: one row per piece of the model (slot or material,
  translated name) — eye (visible), lock (no select / no gizmo), name, opacity 5–100 %; selected row = cyan border. Under the
  selected row: « Mask » (Photoshop-style layer mask, a box in model shares): Add mask · enabled toggle · Invert (hide inside)
  · six range sliders X / Y / Z min–max · Delete mask; « Transform »: numeric move / rotate / scale + reset. Edits are kept in
  the recipe (`recipe.pieces`): they follow the model to the village (baked: transforms, hidden pieces, masks; opacity is
  studio-only) and the Blender export. States: no piece → hint; locked piece → gizmo hidden. Dark + light tokens only.
  PQ-T78: on a car each window, tyre and wheel is its own layer (« Glass 1 », « Tyres 3 »…, key `studio.pieceItem`).
- Surface editor (PQ-T71, drawn models only), under the 3D display tweaks: chips Roof / Front / Right side / Back / Left side (or a click on the model), « Drawing | Material », material select, colour (tint of the drawing, or colour of the material), « Undo my changes ». A house read by its specialist (PQ-T72) wears swatches of its drawings repeated on the walls and the roof (« Material » active, the whole drawing never painted on its walls); « Drawing » brings the whole drawing back on a surface. Touch targets 44 px, chips scroll sideways on mobile. The look is kept with the model when it is added to the simulation. 2D faces panel: four cards (right, back, left, top view). A vehicle (PQ-T76, detected from its archetype) is drawn from its profile: the 2D view is « 2D Profile » (« Imagine 2D profile »), its four cards are front, back, top view and underside, and the hint says the left side is the right one mirrored.
