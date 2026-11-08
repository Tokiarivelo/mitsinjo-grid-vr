# VR-S — Village VR Immersion : Détection Spatiale dans les Airs & Tir/Génération 3D

**Read first:** `docs/vr-village-spatial-detection.md` · `docs/tasks/VR-village-view.md` · `docs/tasks/PV-vision-insert.md` · `docs/contracts.md` § Vision & Shape · `docs/conventions.md` § Reuse  
**Skills:** `/scene-3d` (scène R3F & WebXR) · `/ui-feature` · `/verify` · `/design-check`

**Objectif.** Permettre à l'opérateur sur la page `/village` d'entrer en immersion WebXR (`immersive-vr`), de cliquer sur un bouton spatial flottant dans les airs (« Scanner la pièce ») pour déclencher la détection d'appareils, puis de viser et tirer sur les cibles holographiques au laser avec son contrôleur (ou souris en émulateur) pour faire apparaître et s'animer le modèle 3D de l'appareil in-situ.

**Règles intouchables :**

- **100 % testable en émulateur desktop :** Zéro matériel requis pour le dev ; utilise l'émulateur Meta IWER 2.8.0 preset `metaQuest3` (`useWebXR` + `dev-xr-emulator.ts`).
- **Zéro dépendance runtime superflue :** WebXR et contrôleurs gérés via Three.js natif (`renderer.xr`), aligné avec `VR-village-view.md`.
- **Zéro texte statique / i18n strict :** Toutes les étiquettes 3D, badges et boutons traduits via `next-intl` avec parité 100 % sur `en.json`, `fr.json` et `mg.json` (`make check-i18n`).
- **Mode hors-ligne garanti :** Fonctionne entièrement avec `make dev-mock` via `MOCK_DETECTIONS` et les générateurs de mesh locaux (`object-geometry.ts`).
- **Fluidité WebXR 72/90 FPS :** `frameloop="always"` en session XR, shaders légers, suppression des post-traitements 2D (`EffectComposer` OFF en VR).

---

## Tâches

### VS-T1 : Intégration WebXR dans `/village` (Socle & Entrée de session)

- [ ] Ajouter le bouton d'entrée VR (« Voir en VR ») dans le bandeau de commande de `VillageEditorPage` (`features/vision-insert/ui/village-editor-page.tsx`), à côté du badge `SIMULATED DATA`.
- [ ] Réutiliser le hook `useWebXR` (`features/microgrid-3d/hooks/use-webxr.ts`) et l'émulateur IWER automatique.
- [ ] Conditionner l'affichage : masqué si WebXR non supporté (hors dev), bouton avec état actif cyan en session.
- [ ] Monter le composant conteneur `VillageXRViewport` en plein écran lorsque `xrActive` est vrai.
- [ ] Clés i18n : `features.visionInsert.vrEnter`, `vrExit`, `vrUnsupported` (EN, FR, MG).
- [ ] **Done when :** En `make dev-mock`, le bouton lunettes est visible sur `/village` ; un clic ouvre la session immersive IWER sans erreur console ; un clic sur Quitter restaure la vue studio 2D.

### VS-T2 : Pièce d'atelier 3D & Bouton spatial dans les airs (Spatial Air-Button)

- [ ] Créer la scène 3D de l'atelier virtuel `VillageXRStudio` (`features/vision-insert/ui/xr/village-xr-studio.tsx`) : sol discret, éclairage studio softbox (`buildStudioScene`), ombres de contact.
- [ ] Créer le composant `<SpatialAirButton />` :
  - Mesh 3D flottant positionné à hauteur des yeux (`position={[0, 1.4, -1.2]}`).
  - Bordure émissive cyan (`TOKEN_HEX.energyCyan`), pulsation idle avec `useFrame`.
  - Texte 3D ou icône spatiale projetée (ex: icône Scan / « Scanner la pièce »).
  - Gestion des états : `idle` (prêt à scanner), `scanning` (animation de chargement / ondes radar), `completed` (nombre d'objets détectés).
- [ ] Détection d'interaction : survol au pointeur laser et clic gâchette (`selectstart`).
- [ ] **Done when :** Le bouton flotte de façon stable devant l'utilisateur en VR ; il réagit visuellement au survol du curseur et déclenche un callback au clic.

### VS-T3 : Moteur de capture & Projection spatiale des détections (Spatial Vision Pipeline)

- [ ] Créer le hook `useSpatialVisionSession` (`features/vision-insert/hooks/use-spatial-vision-session.ts`) :
  - Déclenchement de la capture : snapshot du viewport WebGL (`gl.domElement.toDataURL()`) ou image témoin `/samples/vision-room.jpg`.
  - Appel vers `POST /api/vision` (ou mock via `server/perception/mock.ts` en `dev-mock`).
  - Réception des `ApplianceDetection[]` avec leurs coordonnées normalisées `box: [ymin, xmin, ymax, xmax]`.
- [ ] Algorithme de projection 2D $\rightarrow$ 3D (`spatial-projection.ts`) :
  - Conversion des coordonnées de boîte normalisées en positions 3D $(x, y, z)$ réparties sur un arc devant l'utilisateur ($z \approx -1.8\text{ m}$ à $-2.5\text{ m}$).
  - Calcul de la taille de boîte englobante 3D adaptée au volume réel estimé de l'appareil.
- [ ] Tests unitaires Vitest pour `spatial-projection.ts` (vérification de la distribution spatiale et des bornes sans chevauchement).
- [ ] **Done when :** Un clic sur le bouton spatial lance la détection et génère une liste d'objets positionnés dans l'espace 3D avec leurs coordonnées calculées.

### VS-T4 : Contrôleur Blaster, Réticules de visée & Raycast de Tir

- [ ] Créer le composant `<XRBlasterController />` (`features/vision-insert/ui/xr/xr-blaster-controller.tsx`) :
  - Écoute du contrôleur WebXR actif (`renderer.xr.getController(0)`).
  - Rayon laser visible partant de la manette (ou du centre caméra en mode souris émulateur).
  - Boucle de raycast Three.js (`useFrame`) testant les intersections avec les cibles enregistrées.
- [ ] Créer le composant de cible holographique `<HoloDetectionTarget />` :
  - Boîte filaire 3D cyan translucide englobant l'objet détecté.
  - Étiquette 3D avec nom localisé de l'appareil (ex: _« Réfrigérateur »_, _« Téléviseur »_).
  - État `hovered` (la boîte devient ambre/or et émet de légères vibrations haptiques sur la manette).
- [ ] Mécanique de tir au laser :
  - Événement `selectstart` : tir d'un faisceau d'énergie rapide vers le point d'impact.
  - Effet visuel d'impact : flash blanc, onde de choc circulaire, particules d'impact cyan.
  - Notification sonore discrète ou feedback visuel d'impact validé.
- [ ] **Done when :** L'utilisateur peut viser chaque boîte d'objet avec son pointeur, la boîte s'illumine en survol, et presser la gâchette / cliquer déclenche un tir avec effet d'impact sur la cible.

### VS-T5 : Matérialisation procédurale & Animation 3D in-situ (Spawn & Morphing)

- [ ] Créer le composant `<SpawnedObject3D />` (`features/vision-insert/ui/xr/spawned-object-3d.tsx`) :
  - Intègre le générateur de géométrie procédurale existant `recipeMesh` / `silhouetteMesh` (`object-geometry.ts`).
  - Déclenche l'appel de raffinement `POST /api/vision/shape` (ou génère la recette par défaut de l'archétype d'appareil).
- [ ] Séquence d'animation d'apparition (_Spawn Sequence_) :
  - $t_0 \rightarrow t_{300\text{ms}}$ : Implosion de la cible holographique filaire.
  - $t_{300\text{ms}} \rightarrow t_{800\text{ms}}$ : Matérialisation des arêtes d'encre (_ink wireframe_ cyan/vert).
  - $t_{800\text{ms}} \rightarrow t_{1400\text{ms}}$ : Extrusion du volume plein avec rebond élastique (_spring scale_ de 0 à 1).
  - $t_{1400\text{ms}}+$ : Application des textures PBR, ombres de contact au sol (`ContactShadows`), badge de puissance (ex: _« 150 W »_).
- [ ] Interaction post-génération : possibilité d'activer/désactiver l'appareil ou de l'ajouter directement au microgrid simulé du village.
- [ ] **Done when :** Le tir sur une cible déclenche la métamorphose et l'objet 3D final apparaît avec son animation et reste ancré au sol de la pièce.

### VS-T6 : Scénarios de test, Accessibilité, Parité i18n & Gate-out

- [ ] Documenter le scénario manuel dans `test-scenarios/06-vision-vr.md` (étapes pas à pas pour tester sur desktop avec l'émulateur IWER et sur casque Meta Quest).
- [ ] Tests automatisés :
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/spatial-projection.test.ts`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/spatial-air-button.test.tsx`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/xr-blaster-controller.test.tsx`
- [ ] Exécuter `make check-i18n` pour garantir 100 % de parité sur les nouvelles clés (EN, FR, MG).
- [ ] Exécuter `make check` (typecheck 0 erreur, lint 0 avertissement, suite de tests au vert).
- [ ] Mettre à jour `HANDOFF.md` et cocher les tâches.

---

## Exit criteria

- [ ] Sur desktop dev (`make dev-mock`), le bouton « Voir en VR » apparaît sur `/village` via l'émulateur Meta IWER.
- [ ] Dans la session VR, le bouton spatial 3D flotte devant l'utilisateur et pulse doucement.
- [ ] Cliquer sur le bouton déclenche le scan et fait apparaître les cibles holographiques des objets détectés.
- [ ] Le rayon laser suit les mouvements de la souris (ou du contrôleur), survolant et verrouillant les cibles.
- [ ] Tirer sur une cible détruit le réticule et fait apparaître le modèle 3D animé in-situ.
- [ ] Quitter la session VR restaure proprement la page 2D sans fuite de contexte WebGL ni erreur console.
- [ ] `make check` passe à 100 % (tests, lint, typecheck, i18n).
