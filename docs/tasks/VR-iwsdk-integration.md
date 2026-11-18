# VR-IW — Intégration progressive d'IWSDK (Immersive Web SDK, Meta)

Demande (2026-11-18) : intégrer IWSDK. Choix utilisateur : **progressif** — on garde Next.js + R3F et notre
pipeline XR, on remplace nos briques maison par les paquets IWSDK autonomes (sans `World` IWSDK, qui
posséderait son propre renderer). Doc : MCP Meta VR `documentation/iwsdk/guides/overview.md` (IWSDK v1.1).

Paquets (épinglés, `apps/web`) : `@iwsdk/xr-input` 1.1.0, `@iwsdk/locomotor` 1.1.0, `three-mesh-bvh` 0.9.1
(pair de locomotor). Types : `@iwsdk/xr-input` tire `@pmndrs/pointer-events`, qui augmente `Object3D` de three
et casse tout le typage → import via le shim `microgrid-3d/utils/iwsdk-xr-input.{js,d.ts}` (types minimaux).

## IW-T1 — Mains et manettes IWSDK (visuels)

- [x] `utils/iwsdk-input.ts` : un `XRInputManager` par renderer, rig `xrOrigin` sous le dernier parent
      (scène ou rig caméra mis à l'échelle), tick une fois par `XRFrame`, pointeurs IWSDK (ray / grab /
      touch) **coupés** : `XRBlasterController` et `setupXRHandsAndControllers` restent la seule entrée.
- [x] `xr-input-models.ts` réécrit sur IWSDK (main contour façon Quest, manette du profil d'entrée) ;
      les fabriques three (`three-xr-factories`) et la peau maison sont retirées ; repli (sphères,
      manette grise) jusqu'au chargement ; modèles sur le calque « entrées » (VS-T30).
- [x] Tests `xr-input-models.test.ts` (faux manager : un par renderer, pointeurs coupés, rig, tick unique,
      chargement par côté, calque).
- [x] Contour de main IWSDK cyan 3 mm (`IWSDK_HAND_OUTLINE`) : le blanc 1,2 mm par défaut disparaissait
      sur la photo claire de /village ; côté main lu sur l'événement `connected` de three (l'extension
      IWE garde les manettes listées en mode mains).
- [x] Vérif émulateur (2026-11-18) : manettes IWSDK, aucun second laser (MCP IWER) ; mains IWSDK
      visibles, sphères masquées (capture headless). Les sphères vues dans Chromium avec l'extension
      IWE sont celles de l'extension elle-même, pas les nôtres.
- [ ] `make vr-probe` complet (expire à l'étape vues 2D, `scripts/vr-village-probe.mjs:282`) ; Vérif émulateur : `make vr-probe` + MCP IWER (Chromium, recharger l'onglet puis accepter IWE) —
      mains et manettes IWSDK visibles, **pas de second laser / curseur IWSDK**, sélection toujours unique.
      Si un rayon IWSDK s'affiche malgré `toggleSubPointer(false)` : masquer `xrOrigin.raySpaces.*` enfants
      non-modèles dans `tickIwsdkInput`.
- [ ] `/simulation` (camera-controller, rig mis à l'échelle VS-T33) : mains à la bonne taille/position.
- [ ] Casque : 72 Hz tenus, draw calls (`?perf=1`) ; `docs/vr-immersion-guide.md` + `docs/performance.md`.

## IW-T2 — Locomotion IWSDK (`@iwsdk/locomotor`)

- [ ] `Locomotor` (worker off d'abord : `useWorker: false`) sur le sol du studio / de la visite :
      `addEnvironment(sol)`, stick gauche → `slide(dir)`, `update(delta)` dans `useFrame`, position du
      joueur → offset de l'espace de référence (comme `xr-rig.ts` `snapTurn`).
- [ ] Téléportation en arc (`requestHitTest` + `sampleParabolicCurve` pour l'arc visuel), stick droit ↑.
- [ ] Remplacer `studio-walk.tsx` (pas de 80 cm bornés) et `tour.ground.step` ; garder le pas de 80 cm
      (micro-gestes main) ; confort Meta (pas de mouvement forcé, vignette si besoin).
- [ ] Tests (pur : direction tête → slide ; bornes du studio) + `make vr-probe`.

## IW-T3 — Pointeurs IWSDK (à évaluer, risqué)

- [ ] Étudier si `MultiPointer` (`@pmndrs/pointer-events`) peut remplacer le laser de `XRBlasterController`
      sans double sélection (règle /village : une seule source d'entrée). Ne pas faire sans mesure.

## Fin

- [ ] `.claude/skills/vr-immersion/SKILL.md` : la règle « pas de migration IWSDK » devient « paquets IWSDK
      autonomes autorisés (xr-input, locomotor), pas de `World` » ; `docs/architecture.md` (deps XR).
- [ ] Scénarios `test-scenarios/06-village.md` (mains/manettes, déplacement) ; PR, merge.
