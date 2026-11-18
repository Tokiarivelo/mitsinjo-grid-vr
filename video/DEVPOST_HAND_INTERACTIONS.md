# Hand interactions — Mitsinjo Grid VR

Paste everything below the line into the « Describe how Hand Interactions are implemented » field.

---

Mitsinjo Grid VR can be used with **hands only**, no controllers needed. The WebXR session requests the `hand-tracking` feature, and one explicit input map (`xr-controls.ts`, following Meta's input and locomotion guidelines) gives hands and Touch controllers the same actions. Both hands use the same gestures.

**Pinch to select.** A ray leaves each hand; a pinch selects whatever it points at: an object in the 360° scan, a button on a holographic panel, a 2D view, a part of the model in the lab, the village table, a slider on the dispatch mixing desk.

**Pinch and hold to manipulate.** Holding the pinch turns a model or a miniature, and drags the carousel of 2D views around you.

**Wrist menu.** A small button sits on the left hand's `wrist` joint. Touch it with a fingertip, or point and pinch, and the menu (scan, guide, help) opens in world space in front of you, at ray distance. As Meta recommends, it spawns from the wrist but is not attached to it: it stays still and only re-centres when you turn or walk away.

**Hands-first navigation.** With hands, a small navigation pad appears low in the view: pinch it to snap-turn 30° or take an 80 cm step. When the browser exposes thumb microgestures, a swipe left or right turns, a swipe forward or back steps, and a tap analyses the view.

**Comfort and clarity.** Hit targets are larger than the visual buttons, panels open in front of you and stay put, a hover highlight shows what the ray is on, and the hand models can be hidden while the rays stay.

The hand paths were developed and tested with the Meta Immersive Web Emulator's hand input.
