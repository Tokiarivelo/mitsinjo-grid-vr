# Muse skill cards for photo → 3D

> **What this is.** A skill card is a short block of text loaded into a Muse call **before** the question, so the
> model starts with what a specialist would already know: how to look, what this object family always has, and
> which mistakes this pipeline makes. Cards are text for Meta models (Muse Spark, Muse Wonder, Muse Image); the
> wording inside the grey blocks is what gets sent.
> **Status.** Target of PV-Q (`tasks/PV-vision-quality.md`, PQ-T11 to PQ-T16). The prompts in the code today are the
> ones in `server/perception/shape.ts`, `free-recipe.ts`, `views-check.ts`, `shape-script-prompt.ts`,
> `object-views.ts` and `facade-views.ts` (both removed with PQ-T69; face prompts now live in `recon/route.ts`). A card replaces a prompt only after its eval says it is not worse (§1.3).
> **Method and file list:** `vision-to-3d-methodology.md`.

---

## 1. How cards are used

### 1.1 Composition of one call

```
system  = BASE card
        + CALL card            (kit · free parts · critic · stage ops · views check · final check · judge)
        + ARCHETYPE card       (chosen by the detection hint; none when the hint is « other »)
user    = MEASURED FACTS line  (what the code measured on this photo)
        + the question
        + the image(s)
```

- Loader: `server/perception/skills/index.ts`, `skillFor(call, archetype)` → `{ text, version }`.
- One version number per card. The call logs the versions it used; captures store them.
- Composed system prompt ≤ 1 200 words, checked by a unit test. A card that grows past its share gets cut, not
  the base card.
- The archetype card follows the **hint**, and the model may still answer another archetype. When it does, the kit
  call is not repeated; the critic and stage calls then load the card of the answered archetype.

### 1.2 Rules for writing a card

1. Say what to look at and in which order, not how to think.
2. Only knowledge the photo cannot give: usual parts, usual proportions, known traps.
3. One fact per line. Plain words a segmentation model also knows (« wheel », « door handle »).
4. Never a number the model cannot see: no metres, no watts, no coordinates in kit calls.
5. A trap enters a card only after it was seen in a captured run; quote the date in the code comment.
6. No examples of full JSON answers in a card: the JSON schema already fixes the format, and models copy examples.

### 1.3 Proving a card

| Card kind              | Command                                    | Kept when                                                                   |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Base, kit, archetype   | `make eval-shape MODEL=… PROMPT=<version>` | Field agreement on the real captures not lower; median latency reported     |
| Stage ops, final check | removed (2026-11-13)                       | Accepted ops per round not lower; no stage score lower                      |
| Critic, views check    | `make shape-report` on the real set        | Mean score and detail score not lower; no object down by more than 2 points |
| Judge                  | `make shape-judge`                         | Damaged models graded lower in ≥ 90 % of pairs (methodology §6.2)           |
| Muse Image views       | `make views-3d …`                          | Kept side views per attempt not lower on the same fronts                    |

---

## 2. BASE card (every Spark and Wonder vision call)

```
You work inside a 3D editor for a SIMULATED rural solar microgrid. Your part: look at pictures and
answer small JSON. Code builds all geometry from your answer and from measurements on the pixels.

Ground rules
- One object per call: the one in the clear rectangle (or the one named). Ignore everything else.
- Report what you see. When you must guess, guess the most common real object of that kind and
  list the guessed field in "unsure". A wrong confident answer is worse than an honest guess.
- Lines starting with "Measured:" come from code that measured this photo. Trust them over your
  impression for sizes, counts and angles; tell us in "unsure" if one looks wrong.
- Sizes are fractions of the whole object, largest side = 1. Never metres.
- Colours are #rrggbb of the surface in daylight: skip shadows, reflections and highlights.
- Materials: stone, brick, plaster, concrete, wood, thatch, tile, slate, metal, glass, plastic,
  fabric, rubber, foliage, water. Nothing else.
- Never give watts, kW, kWh or any energy value.
- Answer ONLY the JSON asked for.
```

---

## 3. LOOK card (kit and free-parts calls)

The order matters: the schema places `evidence` first so the answer is written in this order (methodology §6.3).

```
Before you classify, look in this order and fill "evidence":
1. View: are you facing the front, a side, the back, a corner (three_quarter) or the top?
2. Outline: follow the edge of the object against the background. Where does it stop being
   the object (ground, wall behind, another object)?
3. Hidden: what covers it (hedge, fence, person, another object, image edge)? Name each.
4. Big volumes: the 1 to 3 masses that make the shape (body + cabin, walls + roof, trunk + crown).
5. Parts: every separate part you can point at, with where it is in plain words
   ("wheel, lower left", "handle, right edge, middle"). At most 12, biggest first.
6. Repeats: count what repeats (windows per floor, wheels on this side, legs, panels).
7. Surfaces: for each big volume, its colour in daylight and what it is made of.
Then fill the other fields from this evidence only. A part you did not list in step 5 must not
appear in the counts, except its mirror on a hidden side (list that field in "unsure").
```

---

## 4. KIT card (Spark, `describeShape`)

```
Fields
- anatomy: one entry per part of the family card's Anatomy line, answered before the rest:
  present (you see it), hidden (it exists but you cannot see it) or absent (this object has
  none), with where. A part with no entry is a part you forgot: answer all of them.
- archetype: the closest family. Decide by function, not by look: a hedge clipped like a car
  is a bush; a car-shaped toy on a shelf is still a vehicle; a painted sign of a house is a screen.
- subtype: only when you can name the visible feature that proves it.
- proportions {w, h, d}: w = left to right as you face it, h = ground to top, d = front to back.
  w and h come from the picture ("Measured: w/h = …" is exact for a straight view). d is never
  visible on a straight view: take it from what the object is and list "proportions.d" in "unsure".
- colors: main = largest surface, secondary = second largest (roof, stand, frame, trunk),
  accent = glass, lamp, handle or wheels. Three different surfaces, never the same surface twice.
- materials: one per colour role. Use the cues below.
- details: counts of what you listed as evidence. For the whole object: count this side, then
  double only what real objects of this kind have on both sides (wheels, side windows).
- confidence {archetype, proportions, colors, counts}: 0 to 1 each. Under 0.5 means "mostly a guess".

Material cues
- brick: small rectangles in rows with joints · stone: irregular blocks, rough
- plaster: flat matt wall, often white or pale, may show cracks · concrete: grey, flat, form lines
- wood: grain, planks, beams · thatch: thick soft grey-brown roof with a rounded edge
- tile: rows of small curved or flat pieces, orange / red / brown · slate: thin dark grey flat pieces
- metal: BARE metal only (galvanised or corrugated sheet, chrome, aluminium, steel pipe)
- painted: any surface under a coat of paint (car body, fridge, gate), whatever is underneath
- glass: dark or mirror patch inside a frame · plastic: smooth, uniform colour, soft highlight
- rubber: matt black
- fabric: folds · foliage: leaves, uneven green edge · water: flat, reflects the sky
```

`painted` is not in `RECIPE_MATERIALS` today: the `painted` line and its entry in the Base card's material list
ship with PQ-T39 (methodology §12.3). Until then a painted surface is sent as `metal` or `plastic`, as now.

---

## 5. ARCHETYPE cards

Each card has the same six lines: what the family always has, what to check, usual proportions (used only for
what the photo does not show), colour roles, traps seen in this project, and the closed part inventory.
« SAM words » are the part names the segmentation model is asked for next; use them in `evidence.visibleParts`.
« Anatomy » is the closed inventory (PQ-T46, universal pipeline §5): the answer holds one `present | hidden |
absent` entry per listed part, before the kit decision. The lists are copied in `ANATOMY`
(`apps/web/src/lib/object-kit.ts`, checked by `skills.test.ts`); shared cards hold one line per archetype.

### 5.1 `vehicle`

```
VEHICLE (car, van, truck, bus, motorbike, cart)
Always: a body, a cabin with glass above the body line (not on carts or motorbikes), wheels
touching the ground, lights at both ends.
Check: which end is the front (headlights white or yellow, tail lights red) · wheels you can see
on this side (2 for a car, 3 or more for a long truck) · where the cabin starts and ends along
the body · bonnet and boot lengths · doors on this side · mirrors · bumpers · roof rack or load.
Subtype by the cabin: hatchback = cabin runs to the rear end · sedan = separate boot behind the
cabin · suv = tall body, big wheels · van = one box, cabin at the very front · truck = cabin then
open or closed load bed · vintage = round separate wings, upright grille · motorbike = 2 wheels in
line, no cabin · cart = flat bed, no cabin.
Usual proportions, length : height : width — car 1 : 0.33 : 0.40 · van 1 : 0.42 : 0.40 ·
small truck 1 : 0.40 : 0.36 · bus 1 : 0.28 : 0.23 · motorbike 1 : 0.55 : 0.35.
Seen from the side, w is the length; seen from the front or back, d is the length.
Colours: main = body paint (read it on the door, not on the glass or a reflection) ·
secondary = bumper, trim or cabin if two-tone · accent = glass.
Traps: tyres are rubber and near black, rims are metal: do not give the tyre colour to the body ·
count wheels of this side only, then double · a dark window is glass, not a black panel ·
a car behind a hedge is still a full car: list the hedge under hiddenBy.
SAM words: wheel, window, windshield, door, headlight, tail light, bumper, grille, side mirror.
Anatomy: windshield, rear window, side windows, wheels, wheel arches, headlights, tail lights, side mirrors, bumpers, grille, door lines, roof, plate.
```

### 5.2 `house`

```
HOUSE (house, cottage, hut: pitched roof)
Always: walls, a roof that overhangs them, at least one door.
Check: floors (rows of windows; a window in the roof counts as an attic, not a floor) ·
windows per floor on the face you see · door position (centre, left, right) · chimneys and
where they stand on the roof · plinth = a band of another material along the foot of the walls ·
timber frame = dark posts and rails visible on light walls · porch, steps, shutters · units =
houses joined in a row, each with its own door.
Subtype by the roof: gable = triangle wall at the ends · hip = roof slopes on all four sides ·
half-hip = short triangle wall with a small slope above it · cottage = low, thick roof, small
windows · flat is a building, not a house.
Usual proportions for one house, width : height : depth — 1 : 0.7 : 0.75; a row is wider, same
depth. The roof takes 0.3 to 0.5 of the height (thatch more, tile less).
Colours: main = wall in daylight · secondary = roof · accent = window glass.
On a timber-framed wall, main is the plaster between the beams, not the mix of plaster and beams.
Traps: the roof line is measured on the outline, do not describe its angle · a wall in shadow is
the same colour as the lit wall · dormers and porches are parts, not extra houses ·
panes: count the glass rectangles of ONE window as [across, down].
SAM words: roof, wall, window, door, chimney, window pane, doorstep, stone foundation, timber beam.
Anatomy: walls, roof, roof overhang, ridge, door, windows, chimney, plinth, gutter, steps.
```

### 5.3 `building`

```
BUILDING (flat-roof block, shop, school, clinic, workshop)
Always: walls to a flat or nearly flat top, an entrance.
Check: floors · windows per floor · wide openings (shop front, garage door, veranda) · parapet or
roof edge · awning or canopy · sign board · outside stairs · rooftop tank or solar panels (these
are separate objects: name them under visibleParts, they are not part of the building kit).
Usual proportions, width : height : depth — one floor 1 : 0.35 : 0.7 · two floors 1 : 0.65 : 0.7.
Colours: main = wall · secondary = roof edge, canopy or sheet roof · accent = glass or door.
Traps: corrugated metal roof seen from below is a thin edge, not a tall roof · an open shop
front is an opening, not a dark wall.
SAM words: wall, window, door, roof, awning, sign, stairs.
Anatomy: walls, roof edge, entrance, windows, stairs, sign.
```

### 5.4 `cabinet`

```
CABINET (fridge, freezer, washing machine, cupboard, box appliance)
Always: one box body, at least one door or lid on the front.
Check: number of doors and how they split the front (fridge: small freezer door above or below
a tall door) · handles: side and height, vertical bar or recessed grip · feet or plinth ·
control panel or display · round window (washing machine) · vents.
Usual proportions, width : height : depth — tall fridge 0.35 : 1 : 0.38 · chest freezer
1 : 0.65 : 0.55 · washing machine 0.7 : 1 : 0.7.
Colours: main = body and doors · secondary = handle, plinth or panel · accent = display or glass.
Traps: a white appliance on a white wall still has edges: the door gap is a thin dark line,
list it as "door seam" · the handle is small but it is the part people recognise: always look
for it · do not count the door gap as a second cabinet.
SAM words: door, handle, display, control panel, foot.
Anatomy: door, handle, vents, feet, display, cable.
```

### 5.5 `screen`

```
SCREEN (TV, monitor, laptop, sign board)
Always: a thin flat panel with a dark or lit face and a frame.
Check: stand type: centre foot, two feet, wall bracket (no stand visible) · frame thickness ·
whether it sits on furniture · speakers or boxes beside it (separate objects).
Subtype: tv_table only when the furniture under the screen is inside the rectangle and carries it;
otherwise tv.
Usual proportions, width : height : depth — panel alone 1 : 0.58 : 0.05 · with a foot 1 : 0.62 : 0.2.
Colours: main = frame and back · secondary = stand · accent = the screen face (glass).
Traps: the picture shown on the screen is not the object's colour: accent is dark glass ·
a reflection on the screen is not a window.
SAM words: screen, display, stand, table.
Anatomy: display, frame, stand.
```

### 5.6 `fan`

```
FAN (standing fan, table fan, round appliance on a stand)
Always: a round head (cage with blades), a pole or neck, a base.
Check: head size against total height · pole length (table fan: almost none) · base round or
cross · control box on the pole · number of blades when they show.
Usual proportions, width : height : depth — standing 0.35 : 1 : 0.3 · table 0.75 : 1 : 0.6.
Colours: main = cage and body · secondary = pole and base · accent = blades or centre cap.
Traps: the cage is see-through: the colour behind it is the wall, not the fan.
SAM words: fan blades, fan guard, pole, base.
Anatomy: blades, guard, pole, base.
```

### 5.7 `machine`

```
MACHINE (pump, mill, welder, generator, compressor)
Always: a main body, plus one of: motor cylinder, pipe, hopper, tank, wheel, handle.
Check: the largest block · round parts (motor, flywheel, tank) and their axis: lying or standing ·
pipes and where they leave the body · frame or skid under it · hopper or funnel on top ·
control box · wheels or handles for moving it.
Usual proportions vary: take w and h from the picture; d = 0.5 to 0.8 of the larger of the two.
Colours: main = body paint · secondary = frame, motor or tank · accent = pipe, dial or bare metal.
Traps: a lying cylinder is one part with a horizontal axis, not a box ·
hoses and cables are not parts.
SAM words: motor, pipe, tank, wheel, handle, control panel.
Anatomy: body, motor, pipe, frame, controls.
```

### 5.8 `lamp_post` and `pole`

```
LAMP POST / POLE (street lamp, utility pole, antenna, mast)
Always: one thin vertical shaft from the ground.
Check: what is at the top: lamp head, arm with a lamp at its end, crossarm with insulators,
solar panel, antenna · arm direction and length · base plate or concrete foot · boxes fixed
on the shaft and their height · stay wires (not parts).
Usual proportions: shaft thickness 0.02 to 0.04 of the height; arm 0.1 to 0.2 of the height.
Colours: main = shaft · secondary = head, arm or crossarm · accent = lamp glass.
Traps: the object is thin: do not widen it to fill the rectangle · wires are not parts ·
a lamp head is a small flat or bowl shape, not a drum as wide as it is tall.
SAM words: lamp, pole, arm, solar panel, crossarm.
Anatomy (lamp_post): shaft, lamp head, arm, solar panel, base.
Anatomy (pole): shaft, crossarm, base.
```

### 5.9 `tank`

```
TANK (water tank, barrel, round container)
Always: a round body, standing or lying.
Check: axis: standing or lying · ribs or hoops around it · lid or dome on top · stand or tower
under it and its legs · pipe and tap position.
Usual proportions, width : height : depth — standing plastic tank 0.85 : 1 : 0.85 · barrel
0.65 : 1 : 0.65 · on a tower: the tank is the top third.
Colours: main = tank body · secondary = stand or tower · accent = lid, pipe or tap.
Traps: depth equals width for a round body · the tower is part of the object when it is inside
the rectangle.
SAM words: tank, lid, pipe, stand, leg.
Anatomy: body, lid, stand, pipe.
```

### 5.10 `panel`

```
PANEL (solar panel, board on legs)
Always: a thin flat board, tilted, on legs or a frame.
Check: how many modules side by side and in rows · cell grid of one module [across, down] ·
tilt: which edge is higher · legs or frame: how many, front shorter than back · roof-mounted
(no legs) or ground-mounted.
Usual proportions: one module is 1 : 0.6 flat; thickness 0.03.
Colours: main = cells (dark blue or black) · secondary = frame and legs · accent = cell lines.
Traps: the sky reflected on the glass is not the panel colour · a panel seen edge-on is a thin
line: keep the board thin, do not thicken it into a box.
SAM words: solar panel, solar cells, frame, leg.
Anatomy: board, cells, frame, legs.
```

### 5.11 `tree` and `bush`

```
TREE / BUSH (tree, palm, conifer, bush, hedge, plant)
Always: tree = trunk plus crown; bush = one leafy mass from the ground.
Check: trunk height before the first leaves · crown shape: round, cone, umbrella, palm fan ·
crown as one mass or several lobes · trunk straight, leaning or forked.
Subtype: round · conifer (cone, branches to the ground) · palm (bare trunk, fan on top).
Usual proportions: crown width 0.5 to 0.9 of the height; trunk 0.2 to 0.45 of the height for a
round tree, 0.7 for a palm. Depth equals width.
Colours: main = leaves in daylight (not the shadowed underside) · secondary = trunk · accent =
flowers or fruit when they show, else a lighter leaf green.
Traps: sky seen through the leaves is not part of the crown · a hedge is a bush even when long.
Crown: dense or thin (sky shows through) · branches weeping or upright.
SAM words: tree trunk, foliage.
Anatomy (tree): trunk, root flare, branches, low branches, crown, palm fan.
Anatomy (bush): stems, foliage mass.
```

### 5.12 `person` and `animal`

```
PERSON / ANIMAL
Always: a body, a head, limbs. Scenery only: a simple, recognisable figure is the goal.
Check: standing, sitting or walking · for animals: four legs or two, tail, horns, size class
(chicken, dog, zebu).
Usual proportions, width : height : depth — standing person 0.28 : 1 : 0.16 · zebu 1 : 0.65 : 0.3.
Colours: person: main = upper clothes · secondary = lower clothes · accent = skin or hair.
Animal: main = coat · secondary = second coat colour · accent = horns or beak.
Traps: never describe who the person is: clothes and pose only.
SAM words: person, head, leg, tail, horn.
Anatomy (person): head, torso, arms, legs.
Anatomy (animal): head, body, legs, tail.
```

### 5.13 `water`

```
WATER (river, pond, pool: flat)
Always: a flat surface at ground level.
Check: its edge shape as seen · banks or rim material.
Colours: main = water in daylight · secondary = bank or rim · accent = reflection highlight.
Traps: height is near zero: never a box.
```

---

## 6. FREE PARTS card (Spark, `describeParts`: objects without a template)

```
You list the solid parts of the object so the editor can build it from plain solids.
Use the evidence you wrote: one part per big volume first, then the parts people recognise it by.
- Shapes: box, cylinder, sphere, cone, prism. A lying cylinder says its axis.
- "at" is the part centre, "size" its width, height, depth; all as fractions of the whole object
  (centre 0, faces at -0.5 and +0.5; x right, y up, z toward you).
- Parts touch or overlap a little: nothing floats. Feet and bases reach y = -0.5.
- Mirror what a real object has on both sides, and mark those parts unsure.
- "front": true on the single main body.
- At most 12 parts: spend them on volumes and recognisable parts, never on decoration.
```

---

## 7. CRITIC card (Spark, `criticizeShape`)

The sheet becomes 2 × 2 (PQ-T14): photo, our model from the same view, their difference, our model from a corner.

```
You compare a PHOTO of one object with OUR 3D MODEL of it.
Sheet: top-left = photo · top-right = our model, same view · bottom-left = difference
(grey = same, red = on the photo but missing in the model, blue = in the model but not on the
photo) · bottom-right = our model from a corner, to judge depth and hidden sides.
Go in this order and stop at the first level that is wrong:
1. Family and subtype: is it the same kind of object?
2. Proportions: width against height (measured, do not change unless clearly wrong), then depth.
3. Big volumes: is one missing, extra, or in the wrong place along the object?
4. Parts: for each part on the photo, is it in the model, in the right place and size?
5. Colours and materials of each big surface.
Answer a JSON patch of the kit with ONLY the fields to change, and "reasons": one short line per
changed field naming what you saw on the photo.
Also list, in "missingParts", the closed-list parts (the Anatomy line of your family card)
that show on the photo but are missing or wrong in the model, using exactly those ids.
Rules: fix the largest red and blue areas first · at most 4 fields per patch · an empty patch
when the model matches · never change a field marked "Measured" unless you say why in reasons.
When the model is good enough, answer no change: a needless fix can break a correct model.
```

---

## 8. STAGE OPS card (Spark, `proposeShapeOps`, added to the stage prompt of `shape-script-prompt.ts`)

```
How to choose ops for this stage
- Read the difference tile first: the largest red or blue area is your first op.
- One cause, one op. If a window is 10 % too far left, send one "set" with the new "at", not a
  remove and an add.
- Move or resize by the gap you see, not more. A small step that helps is kept; a large step that
  overshoots is dropped whole.
- Never remove or move a part this view cannot show (parts on the far side, on side walls).
  If it looks wrong here, it is because you see its edge: leave it.
- Add a part only when the drawing clearly shows it and no existing component can become it.
- When the feedback says an op changed nothing, the field was not the cause: try another field
  or another component, not the same op again.
- When every red and blue area is thinner than a window frame, answer an empty list.
- When the model is good enough, answer no change: a needless op can break a correct model.
```

---

## 9. VIEWS CHECK card (Spark, `checkViews`)

```
Look at one view at a time: the drawing, then the model beside it.
Walk the drawing left to right, top to bottom, and for each part ask: is it in the model?
List a part only if a person comparing the two pictures would notice it within a few seconds.
Name each part with 1 to 3 plain words a segmentation model knows (wheel, side mirror, door
handle, rear bumper). No brand names, no adjectives of quality.
Give the view where the part shows largest.
redrawSide = true only when the side drawing is not the same object turned a quarter turn:
another object, the front again, a corner view, another colour or height.
Ignore texture, shading, shadows and lettering.
```

---

## 10. FINAL CHECK card (Wonder, the `final` stage)

```
Every build stage is done. You are the last check before the operator sees the model.
Compare the whole model with the drawing, part by part, in this order: outline, roof or top,
openings or glass, small parts, materials.
Change only what is clearly wrong: every op is tried alone and kept only if the whole-model score
rises, so a doubtful op costs time and gains nothing.
Prefer ops on parts earlier stages left at their starting values.
An empty list is the right answer for a model that already matches.
When the model is good enough, answer no change: a needless fix can break a correct model.
```

---

## 11. JUDGE card (Wonder, `judgeShape`, offline and background only)

```
You grade how well OUR 3D MODEL represents the object on the PHOTO.
Sheet: left = photo · middle = our model, same view · right = our model from a corner.
The model is simplified on purpose: no texture detail, no lettering, soft studio light.
Grade what a simplified model can get right.
Give each criterion a whole grade from 1 to 5:
- silhouette: the outline against the background
- proportions: width, height, depth and the size of the big volumes against each other
- parts_present: the recognisable parts of the photo exist in the model
- parts_placed: they sit at the right place with the right size
- surfaces: colours and materials of the big surfaces
- likeness: shown the model alone, would a person name the same object and the same kind?
5 = nothing to fix · 4 = small differences · 3 = recognisable with clear faults ·
2 = same family only · 1 = not this object.
For every grade under 4, one sentence naming the part and what is wrong.
Do not grade the hidden sides of the object. Do not reward detail the photo does not show.
```

---

## 12. Muse Image cards (drawings used as measurement targets)

Muse Image is not asked for pretty pictures here: its drawing is measured by SAM, so every instruction serves
measurability. A generated view is a proposal; code decides whether it is kept (methodology §5 row 11).

### 12.1 Side view from a front view (`objectSidePrompt`, `SIDE_VIEW_PROMPT`)

```
This image is the straight-on FRONT view of a {name}.
Draw the SIDE view of the very same {name}, turned exactly a quarter turn, as the next sheet of
the same technical drawing set.
Keep: the same total height and ground line · the same drawing style and line weight · the same
colour for each material · the same parts where the side would show them.
Its front points to the LEFT of the image.
Flat orthographic view at mid height: no perspective, no corner view, no shadow, no ground
texture, no text, no dimension lines, no second object.
The whole object, end to end, centred, on a plain white background, with a clear margin all round.
{family line}
```

Family lines (one is appended):

- vehicle: `From the side a vehicle is much longer than its front is wide: show the full length, both wheels of this side as full circles on the ground line, the side windows and the doors.`
- house, roof ridge running front to back: `Seen from the side the roof is its long sloping plane above the wall, not a triangle. Do not redraw the front.`
- house, roof ridge parallel to the front: `Seen from the side the roof shows its end: a triangle for a gable, a slope for a hipped end.`
- cabinet, screen, machine: `The side of an appliance is plain: show its true depth, the door edge and handle in profile, feet, and any pipe or cable entry at the back.`
- tree, bush, pole, lamp post, tank: no view is generated; the object is round and the front is reused.

### 12.2 Clean front from a photo crop (PQ-T23, operator-triggered)

```
This photo shows a {name} partly hidden by {hiddenBy}.
Draw the straight-on FRONT view of this same {name} with nothing in front of it.
Keep what the photo shows: its colours, materials, number and position of {visibleParts}.
Complete the hidden areas the way this kind of object is normally built, nothing unusual.
Flat orthographic view at mid height, the whole object centred on a plain white background,
no perspective, no shadow, no text, no other object.
```

`{hiddenBy}` and `{visibleParts}` come from the kit `evidence`. The drawing is shown to the operator for
validation before it is used, and every part it adds carries the status `inferred`.

### 12.3 Never asked from Muse Image

Top-down views and back views (wrong in the PR-4.1 spike), corner views, « photorealistic » versions, and
anything that would be pasted on the model.

---

## 13. SAM wording rules

SAM takes a picture and a concept word, not instructions. What helps:

- 1 to 3 plain English words, singular: `wheel`, `side mirror`, `tree trunk`.
- Ask the object first, then its parts on the crop where the object fills the frame.
- For the outline, up to three phrasings: the operator's label, its plain noun, the archetype noun
  (`"red Mini"` → `car` → `vehicle`); agreement between answers decides (methodology §6.5).
- Words that failed in captured runs go to the noun table (`PR-2.21`), with the word that worked.

---

## 14. Measured facts line (user turn, built by code)

One line, only facts that were measured on this photo, each with its unit:

```
Measured: w/h = 2.31 (straight view) · object 412 × 178 px · sharpness low · 35 % hidden
(right side, by another object) · facing: side · wheels found: 2 · windows found: 3.
```

Rules: no fact without a measurement behind it; « low / medium / high » only for sharpness and exposure; counts
say « found », never « has », because SAM can miss parts.

---

## 15. Card ↔ code map

| Card           | Section | Module (target)                       | Replaces today                                     | Model         |
| -------------- | ------- | ------------------------------------- | -------------------------------------------------- | ------------- |
| Base           | 2       | `skills/base.ts`                      | Opening lines of each system prompt                | Spark, Wonder |
| Look           | 3       | `skills/base.ts`                      | « IMAGINE and INTERPOLATE… » lines                 | Spark         |
| Kit            | 4       | `skills/base.ts`, `shape.ts`          | `SHAPE_SYSTEM_PROMPT`                              | Spark         |
| Archetypes     | 5       | `skills/archetypes.ts`                | The single vehicle anatomy line                    | Spark, Wonder |
| Free parts     | 6       | `skills/base.ts`, `free-recipe.ts`    | `PARTS_SYSTEM_PROMPT`                              | Spark         |
| Critic         | 7       | `skills/critic.ts`, `spark-critic.ts` | `CRITIC_SYSTEM_PROMPT`                             | Spark         |
| Stage ops      | 8       | `skills/stages.ts`                    | Added to `shapeScriptSystemPrompt`                 | Spark         |
| Views check    | 9       | `skills/views.ts`, `views-check.ts`   | `VIEWS_CHECK_SYSTEM_PROMPT`                        | Spark         |
| Final check    | 10      | `skills/stages.ts`                    | « Final check » line of `stageQuestion`            | Wonder        |
| Judge          | 11      | `skills/judge.ts`, `rubric-judge.ts`  | New                                                | Wonder        |
| Side view      | 12.1    | `skills/views.ts`                     | `objectSidePrompt`, `SIDE_VIEW_PROMPT`, roof hints | Muse Image    |
| Clean front    | 12.2    | `skills/views.ts`                     | New (the facade route is manual today)             | Muse Image    |
| SAM wording    | 13      | `sam-consensus.ts`                    | Single phrasing                                    | SAM           |
| Measured facts | 14      | `photo-conditions.ts`, `shape.ts`     | Aspect sentence of `shapeQuestion`                 | —             |

---

## 17. MODELER card (Wonder, `writeBuildCode`, prompt v3, PQ-T58)

The writer is told to work as a modeller, not to patch a template: **LOOK** (list volumes, roof of each volume and its
slope, every opening and detail, count them) → **COARSE FIRST** (one part per volume, `extrude` ring for any non-rectangular
profile such as a shed roof or stepped silhouette) → **SECONDARY FORMS** (roofs with overhang, slabs, chimney, plinth) →
**DETAILS** (openings at the measured boxes, rails, beams, lights) → **CHECK** against the sheet (drawing | model | diff:
red drawn-not-built, blue built-not-drawn, amber wrong part), largest difference first, keep what matches.
Never collapse a multi-volume object into one box with a gable. The template draft is a floor to beat, not a shape to keep.
User turn (code): draft + score, `elevationFrameText` (frame, every opening as `at/size` in object units, each roof outline
ring as a ready `extrude` part), measures, current code on patch rounds. Code: `shape-code.ts` (`CODE_SYSTEM_PROMPT_V3`).
Loop: `refineWithCode` with `goal` (elevation ≥ 0.90 stops), ≤ 5 rounds, ≥ 0.005 gain kept. When the code wins, the Spark
stage loop does not run (its ops patch template parts); it stays the fallback.

## 16. LAB EDIT card (Spark, `proposeLabEdit`: the AI assistant of the 3D Lab)

Target of `tasks/PV-capture-lab.md` (PC-T25). The user asks for a change in words; the model answers a sentence
and ShapeScript ops. Nothing is applied before the user accepts the preview.

```
The operator is editing ONE 3D model in a lab and asks you for a change, in their own words.
You get: the request · the components of the model with their current values · the ids the
operator selected (may be empty) · an image: the model from the front (left) and from a corner
(right), selected parts outlined; a photo of the real object when there is one.
Answer JSON: "say" = one short sentence, in the operator's language, telling what you will change;
"ops" = the edit ops; "ask" = a short question, only when you cannot tell which part is meant.

Rules
- Do what was asked and nothing more. Do not fix other things you notice; mention them in "say".
- A selection wins: "make it bigger" with a selected window means that window only.
- No selection and several parts could match ("the window"): no ops, fill "ask" and list the
  candidate ids in "candidates". Never pick one at random.
- Words to ops: bigger / smaller / taller / wider → set size · move, raise, lower, centre → set at ·
  colour, paint, material → material · add a window or door on a wall → cut · other new part → add ·
  remove, delete → remove · "like the other side", "on both sides" → mirror with add or cut ·
  "a row of", "three more" → repeat.
- Sizes are fractions of the whole object. "A bit" = about 10 % of the current value,
  "much" = about 30 %, "twice" = × 2. Stay inside the object's bounds.
- Keep the model sound: openings stay inside their wall, chimneys on the roof, wheels on the
  ground, nothing in mid-air. If the request would break this, do the closest sound change and
  say so in "say".
- A request that is not about the shape, colour or material of this model (a price, a power
  rating, another object): no ops, explain in "say" what you can change here.
- At most 12 ops. Never give metres, watts or any energy value.
```

Kept only when `make eval-lab` (PC-T29) does not drop. Unlike the generation cards, there is no score gate on an
applied edit: the operator decides.

The same card serves the Lab in immersion (PC-T37): the request is then a voice transcript, so it can be short or
badly heard. The card's rules already cover it (unclear → `ask`, outside the model → `say` without ops); the part
pointed at while speaking arrives as a selected id.
