# About the project — Mitsinjo Grid VR

Paste everything below the line into the « About the project » field (Markdown + LaTeX).

---

## Inspiration

In off-grid villages in Madagascar, a single solar array and a battery power everything: the clinic's vaccine fridge, the water pump, the school, the homes, the market. When a cloud passes or the evening peak arrives, someone has to decide **who keeps the power**. Today that decision is made on flat dashboards, far from the place it affects.

I wanted two things at once. First, to let anyone **stand inside the village** and see the consequence of a choice: the lights of the homes fading, the clinic staying lit. Second, to make the village **easy to build**: instead of modelling every appliance by hand, you simply look at the real world, point at an object, and it becomes a 3D model that joins the grid.

That became the line of the project: **Point at the world. Build it. Power it.**

## What it does

- **Scan the space in VR.** In a Meta Quest headset (or the Meta Immersive Web Emulator), you look around a 360° space and the AI finds and outlines the objects around you.
- **Object → 2D views → 3D.** Pick an object and a 3D studio opens around you with its 2D views (front, sides, back, top). A view is wrong? Ask for a change by text or voice. Validate, and the 3D model is built piece by piece, then opens in a 360° maker lab where you can turn it, select parts, resize them and see through them.
- **Insert it into the village, without taking the headset off.** The same XR session switches from the lab to the microgrid village; the new object is placed, wired to a feeder, and its load joins the simulation.
- **Walk freely, then control the power.** Explore the village by day with a map, fast-forward to the evening peak, and use the dispatch controller's mixing desk: cut the homes and watch their windows and the feeder's electrons fade, bring them back, try to cut the clinic — refused, because the village's rules protect it.

## How I built it

**Stack.** Next.js 15, React 19, TypeScript (strict), React Three Fiber + Drei on Three.js, WebXR `immersive-vr` (`local-floor`), Zustand + Zod, next-intl (English, French, Malagasy), Vitest and Playwright. Development and the demo capture run against the **Meta Immersive Web Emulator**, driven headless, so the whole VR path is testable without a headset.

**Meta models in the app (server-side).**

| Step     | Model                                                               |
| -------- | ------------------------------------------------------------------- |
| Detect   | **Muse Spark** names the objects, **SAM 3.1** outlines them         |
| 2D views | **Muse Image** draws each view (front, sides, back, top)            |
| 3D kit   | **Muse Spark**, guided by **skill cards** and **specialist agents** |
| Voice    | **Muse Voice** transcribes requests (EN / FR / MG)                  |

A skill card is a short block of expert knowledge loaded before the question (how to look at a car, what a sofa always has, which mistakes this pipeline makes). The facade specialist and a critic agent check and correct the result. The geometry itself is **computed** from the views (silhouettes, measured colours, part masks), not written freely by a model, so every model can be scored and improved.

**The energy engine.** One rule shapes the project: every number comes from `@mitsinjo/engine`, a pure, deterministic TypeScript simulator with 1-hour steps, $t \in [0, 23]$. The 3D scene, the UI and the AI never compute energy values. Solar production follows

$$P_{\text{solar}}(t) = P_{\text{peak}} \times \text{profile}(t) \times \prod_k w_k(t)$$

the battery state of charge evolves as

$$E(t+1) = E(t) + \max(P_b, 0)\,\eta_{ch} - \frac{\max(-P_b, 0)}{\eta_{dis}}, \qquad \eta_{ch} = \eta_{dis} = 0.95$$

and when supply is short, sectors are served by priority, with a **lifeline floor** that keeps the clinic and the water pump alive first. Invariants are checked at every step to $\varepsilon = 10^{-9}$.

**Light that tells the truth.** In VR, a building's light follows what the engine actually serves it:

$$L_{\text{building}} = \frac{\text{served}_s}{\text{demand}_s}$$

eased over about half a second, so cutting or restoring a sector reads as a fade, never a jump. The electrons on each feeder slow down and dim the same way.

**One session from lab to village.** The lab and the village live in the same XR session behind a holographic shell, so inserting an object and walking next to it never breaks immersion. For the demo objects of the 360° tour (a baroque sofa, a cottage, a white estate car), I also modelled reference views and 3D models in Blender, by code, from the tour photos.

## Challenges I faced

- **Making generated 3D look real.** A single photo is ambiguous: hidden sides, perspective, occlusion. Going through 2D views first (validated by the user) and computing the geometry from them made the results inspectable and fixable instead of a black box.
- **VR readability.** Panels must be readable, reachable and never block the view. The dispatch desk opens in front of you and then stays fixed in the world, so you can turn your head to the houses and see the consequence of your action.
- **Comfort and performance on Quest.** Instanced and merged meshes, two quality tiers, eased lights instead of per-frame updates, and a budget on draw calls and triangles.
- **Time inside VR.** The village clock does not run inside an immersive session, so moving from day to evening needed its own design: a fast-forward to the evening peak.
- **Trust.** The AI never invents energy numbers; every action on the grid can be undone, the clinic cannot be cut, and all text exists in English, French and Malagasy with key parity checked in CI.
- **Solo, in a few days.** Testing VR without a headset meant automating everything: the emulator is driven by scripts that walk, aim, press buttons and record the session.

## What I learned

- **Presence changes the decision.** Watching the homes go dark while the clinic stays lit explains "essential first" better than any chart.
- **Constrain the AI, then trust it.** "The engine computes, the AI perceives, explains and proposes" is what makes the copilot credible.
- **Vision needs a loop, not a leap.** Detect → outline → 2D views → 3D, each step visible and correctable, works far better than photo-to-mesh in one shot.
- **Spatial UI is its own craft.** Where a panel opens, how big a button is, how fast a light fades: in VR these details decide whether people understand.

## What's next

Hand tracking for grabbing breakers and parts, real Quest field tests with operators, a Malagasy-first voice mode, multiplayer village councils, and a growing library of objects that the community can scan and share.
