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

- [x] `studio-locomotion.ts` : `Locomotor` synchrone sur un disque de sol (rayon + 8 m, coupole 7 m),
      stick gauche → `slide`, rayon 2,4 m tenu, pas de 80 cm → `teleport` ; repli sur notre calcul tant
      que le moteur n'est pas prêt. Tests avec le vrai moteur (`studio-locomotion.test.ts`).
- [x] Arc : stick droit ↑ maintenu = viser (`aim on`), relâché = se téléporter ; IWSDK prend l'axe +Z de
      la manette (parabole à rebours) → direction inversée dans `aim()`. Visite 360° et /simulation :
      ↑ reste un pas (`aimAsStep`). Légende `visionInsert.vrControls.legendStickTurn` mise à jour.
- [x] `make vr-probe` : vérifs téléportation après l'ouverture du studio (le studio tourne à ~1 image/s
      sous SwiftShader : la capture `3c` expire, même sans IWSDK — préexistant).
- Visite 360° : pas de géométrie (photo) → garde sa marche et ses pas (`tour.ground.step`), décidé
  le 2026-11-18. Studio : vignette de confort non ajoutée (téléportation instantanée, glissement à
  1,4 m/s comme avant).

## IW-T3 — Pointeurs IWSDK (à évaluer, risqué) — non fait (2026-11-18)

Laissé de côté : nos lasers (`XRBlasterController`) restent la seule entrée sur /village ; brancher
`MultiPointer` risquerait une double sélection, sans gain mesuré.

- [ ] Étudier si `MultiPointer` (`@pmndrs/pointer-events`) peut remplacer le laser de `XRBlasterController`
      sans double sélection (règle /village : une seule source d'entrée). Ne pas faire sans mesure.

## Fin

- [x] `.claude/skills/vr-immersion/SKILL.md` : la règle « pas de migration IWSDK » devient « paquets IWSDK
      autonomes autorisés (xr-input, locomotor), pas de `World` » ; `docs/architecture.md` (deps XR).
- [ ] Scénarios `test-scenarios/06-village.md` (mains/manettes, déplacement) ; PR, merge.
