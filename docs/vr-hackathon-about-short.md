# Mitsinjo Grid VR: Solar Village Twin (short version)

> Walk through a solar village in VR, turn photos into 3D equipment, see power flow live, and let AI keep the clinic powered.

## Inspiration

In off-grid Madagascar, one solar array and battery power the clinic, water pump, homes and schools. Cloudy-day controllers shed load proportionally — the clinic goes dark as fast as market stalls. We wanted to stand inside the grid and ask an AI why.

## What it does

An immersive 3D village twin with one-tap WebXR entry, where light and power flows follow the simulation live. Photos become connected 3D loads; an AI copilot explains risks and proposes fixes you approve.

## How we built it

We built it on Next.js 15 + React Three Fiber over a deterministic TypeScript engine that owns every number — nothing else computes energy. Each hour step balances $\text{servedKw} = \text{solarKw} - \text{batteryKw} - \text{curtailedKw}$ with invariants at $\varepsilon=10^{-9}$. Muse Spark drives the copilot via engine tools with run-ID citations.

Photo-to-3D: Spark detects, SAM 3.1 outlines, Muse Image draws a facade, a procedural kit rebuilds the mesh (checked by Wonder), wired in with poles and cables.

## Challenges we ran into

Grounding the LLM — early drafts invented kWh, fixed by tool-only numbers with run-ID citations. Each photo-to-3D stage stays previewable; VR reads via light ∝ served kW.

## Accomplishments that we're proud of

A copilot that can't lie about numbers, one-tap WebXR entry, and photo-to-grid in five inspectable stages — in three languages.

## What we learned

Presence changes decisions — a dark clinic in 3D beats any table. Constraints make AI trustworthy: engine computes, AI perceives, explains, proposes.

## What's next for Mitsinjo Grid VR: Solar Village Twin

Grabbable breakers in VR, multiplayer village councils, live meter bridges, and Malagasy-first voice mode.
