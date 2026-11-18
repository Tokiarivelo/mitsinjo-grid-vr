# Significant updates during the competition — Mitsinjo Grid VR

Paste everything below the line into the « Adapted or Significantly Updated Experiences » field (≈ 240 words).

---

Mitsinjo Grid started as a **web** decision-support twin for a solar microgrid: an energy engine, a strategy lab, an AI copilot and a 3D village you orbited with a mouse. During the competition I rebuilt it as a **Meta Quest VR experience**:

- **Immersive mode (WebXR `immersive-vr`)**, developed and tested with the Meta Immersive Web Emulator: controller pointing, comfort turns and steps, a walkable village at standing scale.
- **Scan the world in VR:** look around a 360° space; the AI finds and outlines objects (SAM 3.1 + Muse Spark).
- **3D studio around you:** an object's 2D views (Muse Image) on floating panels, with a per-view chat (text or voice) to redraw a view before building.
- **360° maker lab:** the 3D model rises from its card onto a pedestal; select parts, resize them, X-ray view, undo.
- **Lab → village in the same session:** place the object on a holographic village table, add it to the simulation, and walk next to it, without taking the headset off.
- **Power control in VR:** sector panels and a dispatch mixing desk; lights and feeder electrons fade in proportion to the energy served; the clinic cannot be cut.
- **Village map, evening peak, reduced-motion and two quality tiers** for Quest performance.
- **Realistic objects:** detailed 2D views and 3D models for the tour's sofa, house and car.

**Demo video:** [YouTube link]
**Try it:** https://mitsinjo-grid-vr.vercel.app/simulation (« View in VR ») · https://mitsinjo-grid-vr.vercel.app/village (« View in VR immersion »)
**Code and changelog:** https://github.com/Tokiarivelo/mitsinjo-grid-vr (commit history, `docs/tasks/VR-village-spatial-shoot.md`)
