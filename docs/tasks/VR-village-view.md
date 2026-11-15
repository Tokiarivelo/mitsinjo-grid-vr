# VR — Voir le village en VR (sans casque : émulation desktop)

**Read first:** `docs/design/3d-scene.md` · `docs/design/screens/live-simulation.md` ·
`docs/design/stitch-map.md` (ligne Live Simulation) · `docs/conventions.md` § Reuse
**Skills:** `/scene-3d` (scène R3F) · `/design-check` (gate in/out) · `/verify` (checks)

**Objectif.** Bouton « Voir en VR » dans le HUD du viewport 3D de /simulation :
session WebXR `immersive-vr` sur la scène village existante (three.js natif, zéro
nouvelle dép runtime). Sans casque, le dev desktop utilise l'émulation Meta
(IWER intégré dev-only, ou extension Immersive Web Emulator). Pas d'interactions
contrôleur dans ce lot (lot suivant).

**Règles intouchables :**

- WebXR = contexte sécurisé only (`navigator.xr` absent en HTTP non-localhost →
  bouton masqué, jamais de faux contrôle).
- En session XR : `frameloop="always"`, post-traitements OFF (EffectComposer
  casse le rendu stéréo), OrbitControls désactivés, caméra sur le point de vue
  diorama `XR_VIEWPOINT`, restaurée à la sortie.
- Scope strict : viewport /simulation uniquement, pas l'aperçu /overview.
- Labels drei `<Html>` invisibles dans le casque (limite connue, miroir desktop OK).

---

## Tâches

- [x] **VR-T1** Détection + session WebXR (`utils/xr-session.ts`, `hooks/use-webxr.ts`)
  - [x] `isImmersiveVRSupported()` null-safe (pas de `xr` / pas de `isSessionSupported` → false, jamais de throw)
  - [x] `enter` : `renderer.xr.enabled = true`, `requestSession('immersive-vr',
{ optionalFeatures: ['local-floor', 'bounded-floor'] })`, `setSession`
  - [x] `exit` : `session.end()` ; fin hors-bouton (geste système) resynchronisée via `session 'end'`
  - [x] Hook `{ status: 'checking'|'unsupported'|'supported'|'active', error, enter, exit }`
  - [x] **Done when** : tests Vitest (xr absent / refusé / supporté / cycle enter→end→exit,
        `requestSession` appelé avec le bon mode, erreur exposée sans throw).

- [x] **VR-T2** Câblage `VillageCanvas` (`ui/village-canvas.tsx`, `ui/camera-controller.tsx`)
  - [x] Props `rendererRef?` (rempli dans `onCreated`) et `xrActive?`
  - [x] `xrActive` → `frameloop="always"`, `<PostEffects/>` + `<QualityProbe/>` OFF,
        contrôles orbit désactivés, snap caméra sur `XR_VIEWPOINT`, restauration à la sortie
  - [x] **Done when** : tests (props exposées au canvas stub, viewpoint défini, pas de
        régression des tests scène existants).

- [x] **VR-T3** Bouton VR dans le HUD (`simulation/ui/village-viewport.tsx`)
  - [x] À côté du plein écran (groupe 3D only) : icône `Glasses`, pattern icon-button
        existant, `aria-pressed`/`aria-label`, masqué si `unsupported`
  - [x] Clés i18n `features.simulation.vrEnter` / `vrExit` (EN/FR/MG, parité `make check-i18n`)
  - [x] **Done when** : bouton visible si `immersive-vr` supporté (xr mocké), lance `enter`,
        affiche l'état actif ; invisible sinon ; gate-out 1440 + 390, dark + light.

- [x] **VR-T4** Émulation dev-only sans casque (`utils/dev-xr-emulator.ts`, devDeps `iwer` + `@iwer/devui`)
  - [x] `installDevXREmulator()` idempotent, import dynamique, dev-only (jamais en prod)
  - [x] Appelé par le hook avant la détection si pas de XR natif
  - [x] Test d'exécution `dev-xr-emulator.test.ts` : vrais packages, runtime installé,
        `immersive-vr` détecté, overlay DevUI dégradé proprement sans WebGL
  - [ ] **Done when** : `make dev` desktop sans extension affiche le bouton VR (gate-out live) ;
        doc fallback extension dans le scénario de test.

- [x] **VR-T5** Docs + gate-out
  - [x] Ligne stitch-map (built without mockup si pas de refresh Stitch)
  - [x] Scénarios S119–S123 dans `test-scenarios/02-simulation.md` (entrée/sortie VR émulée)
  - [x] Passe unique `viewport-vr-session.test.tsx` : bouton → enter → snap XR →
        sortie geste → retour caméra multi-trames → re-enter → exit bouton (moteur réel)
  - [x] **Done when** : `make check` vert (typecheck + lint 0 erreur + 2135 tests +
        i18n 3/3) ; gate-out static + note « live pending » (stitch-map).
  - [x] Guide complet `docs/vr-testing-guide.md` (chemins A/B/C, S119–S123, dépannage).

- [x] **VR-T6** Rig caméra XR (correctif : la pose casque écrase le snap caméra, spawn dans les murs)
  - [x] Entrée XR : caméra parentée à un groupe rig sur `XR_VIEWPOINT` (-Z vers la cible),
        transform local identité ; sortie : détachée vers son parent d'origine, rig retiré
  - [x] Tests `camera-controller-xr` + `viewport-vr-session` alignés (monde sur viewpoint,
        visée cible, rig retiré à la sortie)
  - [ ] **Done when** : ré-entrée live → surplomb immédiat du village (S120).

- [x] **VR-T7** Création WebGL bloquée (console error `could not be created … was blocked`)
  - [x] `CanvasCreationBoundary` autour du `<Canvas>` (clé = epoch) + `reportCreationFailed`
        dans `useContextLoss` : placeholder + 3 remontages max, jamais de crash ni de boucle
  - [x] Tests `context-loss-hook` (cycle création) + `canvas-creation-boundary` (throw → null + report)
  - [x] **Done when** : `typecheck` 0 erreur, lint 0 erreur, tests ciblés verts.

## Commandes /village, murs, pouvoir sur chaque bâtiment (VSIM-T1 → T4)

- [x] **VSIM-T1** Mêmes commandes que `/village` (carte `xr-controls.ts` partagée, `XrControlsDriver`) :
      stick gauche = marcher, stick droit ←/→ = pivot 30° autour de la tête (`turnRigAboutHead`), ↑/↓ = pas de
      0,8 m · A/X = étiquettes · B/Y = retour (fermer le panneau, sortir de la pièce) · clic de stick = légendes
      (sur chaque manette, 25 s à l'entrée) · mains : pincer, gestes de pouce. Plus de rotation continue.
- [x] **VSIM-T2** On ne traverse plus les objets 3D : grille d'occupation (`utils/walk-grid.ts`) construite à
      l'entrée depuis les vrais triangles de la scène (bande 0,35–1,8 m au-dessus du sol), reconstruite après 3 s ;
      la marche glisse le long des murs, n'enferme jamais (départ dans un mur = libre).
- [x] **VSIM-T3** Clic sur l'étiquette (ou le bâtiment) en VR → panneau holo : servi / demandé / couverture
      (moteur), « − / + 0,5 kW », « Couper tout » / « Rétablir », « Entrer », « Aller à la porte », « Annuler ».
      Limite de secteur (`sectorCaps`, de l'heure affichée à 24 h) via `approveChange` (annulable) ; la clinique
      n'est jamais coupée (`clinicGuard` + constitution) → « Refusé ».
- [x] **VSIM-T4** « Entrer » → pièce modélisée du secteur (maison, classe, salle de soins, local pompe, étal,
      atelier) : lampes et appareils éclairés selon la couverture du moteur (noir si coupé), panneau au mur,
      murs qui retiennent, porte / « Sortir » / B-Y → devant la porte.
- [x] **Done when :** `make vr-sim-probe` vert ; tests `sim-xr-walk`, `sector-power`, `use-sim-xr` ; i18n EN/FR/MG.

## Notes de vérification (2026-11-06)

- `metavr ssim` (SpatialSim) écarté avec preuves : doc Meta « for 2D Android apps
  only » (`spatial-sim-overview`, 2026-11-03), pas de KVM dans le sandbox, disque
  à 97 %, loopback TCP bloqué (adb/in-app injoignables). Le routage `xrsim` ne
  s'applique pas non plus (pas d'app OpenXR native : projet web).
- Gate-out live impossible dans le sandbox (loopback bloqué vérifié ; build prod
  bloqué par Google Fonts derrière le proxy). Preuve live = S119–S123 sur la
  machine de l'opérateur (`make dev-mock`, IWER auto-installé).

## Exit criteria

- [ ] Sur Quest Browser (HTTPS) : le bouton apparaît et la session immersive démarre. (opérateur, S122)
- [ ] Sur desktop dev sans casque : le bouton apparaît via IWER et la session émulée démarre.
      (opérateur, S119–S120 ; install IWER + détection prouvées en test d'exécution)
- [ ] Sur desktop sans émulation / HTTP : pas de bouton, pas d'erreur console. (opérateur, S121)
- [x] `make check` vert (typecheck + lint + tests + i18n).
