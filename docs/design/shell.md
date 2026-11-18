# AppShell

Zones: Sidebar | Header over Workspace | optional CopilotPanel. Tokens: see tokens.md. Components: see components.md.

```
+--------+--------------------------------------+----------+
|Sidebar |Header (68)                           |          |
| 232    +--------------------------------------+ Copilot  |
|        |Workspace (scrolls, padding 24)       |  360     |
|        |                                      |          |
+--------+--------------------------------------+----------+
```

## Sidebar (232px, surface, border-right)

- Brand: geometric sun/network mark (readable at 24x24), "Mitsinjo Grid" (display, medium), label `SIMULATION LAB` (mono, muted).
- Nav (icon + text label; no oversized icons, no pill shapes):

| Label           | Route       |
| --------------- | ----------- |
| Overview        | /overview   |
| Live Simulation | /simulation |
| Strategy Lab    | /strategies |
| Scenarios       | /scenarios  |
| AI Copilot      | /copilot    |

- VR quick entry (the showcase) above the nav: full-width `vr` button (filled energy-cyan, glow) « Enter VR » +
  hint « Photo → 3D model, in the headset » → `/village?immersion=vr`; icon only on the folded rail; hidden on /village.
- Active item: brighter surface (surface-hover), 2px energy-cyan left edge, text-primary.
- Footer: sim status (StatusBadge), `SIMULATED DATA` badge, Settings and Docs links.
- Fold (xl+): « Collapse sidebar » button (panel icon, 44 px) in the brand row → 64 px icon rail: brand and footer hidden
  (theme + language stay in the header), nav icons centred, name as tooltip and for screen readers; « Expand sidebar » unfolds.
  Choice kept in this browser (`localStorage mitsinjo_sidebar_collapsed`, `useSidebarCollapsed`). Mobile drawer unchanged.

## Header (68px, canvas-raised, border-bottom; "instrument panel")

- Left: page title (display), breadcrumb if useful, context subtitle.
- Right, in order: « Enter VR » (`VrQuickLink`, `vr` button variant, icon only under `sm`, 40 px; hidden on /village), ScenarioSelector, sim status StatusBadge, Reset button (secondary), copilot toggle (icon button, aria-label "Toggle AI copilot", violet when open), profile only if auth exists.
- Status values (from sim status):

| status   | Label               |
| -------- | ------------------- |
| ready    | READY               |
| modified | SCENARIO MODIFIED   |
| running  | SIMULATING          |
| complete | SIMULATION COMPLETE |
| error    | SIMULATION ERROR    |

- Must always read as simulation status, not real plant status; keep `SIMULATED` visible (sidebar footer or header).

## CopilotPanel slot

- 360px (340-380), right, surface, border-left; collapsible to give workspace room. Spec: components.md CopilotPanel; content: screens/copilot.md.
- On /copilot the chat is the main workspace; hide the panel there.

## Workspace

- Scrolls independently; padding 24; cards resize without clipping; min-w-0 on grid children.

## Breakpoints

| Width                                                             | Behavior                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| >=1280                                                            | Full sidebar, large 3D, metric cards in one row, optional persistent copilot                                                                                                                                          |
| 768-1279                                                          | Sidebar collapsible (icon rail or drawer); fewer metric columns; copilot as drawer; simplified 3D controls                                                                                                            |
| <768                                                              | Compact top bar; nav drawer; stacked metric cards; controls in expandable sections; simplified 3D with touch controls; 2D list of essentials; copilot full-height drawer or dedicated view; building detail as drawer |
| Never shrink the desktop layout into a miniature; reflow instead. |
