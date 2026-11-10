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

- [x] Ajouter le bouton d'entrée VR (« Voir en VR ») dans le bandeau de commande de `VillageEditorPage` (`features/vision-insert/ui/village-editor-page.tsx`), à côté du badge `SIMULATED DATA`.
- [x] Réutiliser le hook `useWebXR` (`features/microgrid-3d/hooks/use-webxr.ts`) et l'émulateur IWER automatique.
- [x] Conditionner l'affichage : masqué si WebXR non supporté (hors dev), bouton avec état actif cyan en session.
- [x] Monter le composant conteneur `VillageXRViewport` en plein écran lorsque `xrActive` est vrai.
- [x] Clés i18n : `features.visionInsert.vrEnter`, `vrExit`, `vrUnsupported` (EN, FR, MG).
- [x] **Done when :** En `make dev-mock`, le bouton lunettes est visible sur `/village` ; un clic ouvre la session immersive IWER sans erreur console ; un clic sur Quitter restaure la vue studio 2D.

### VS-T2 : Pièce d'atelier 3D & Bouton spatial dans les airs (Spatial Air-Button)

- [x] Créer la scène 3D de l'atelier virtuel `VillageXRStudio` (`features/vision-insert/ui/xr/village-xr-studio.tsx`) : sol discret, éclairage studio softbox (`buildStudioScene`), ombres de contact.
- [x] Créer le composant `<SpatialAirButton />` :
  - Mesh 3D flottant positionné à hauteur des yeux (`position={[0, 1.4, -1.2]}`).
  - Bordure émissive cyan (`TOKEN_HEX.energyCyan`), pulsation idle avec `useFrame`.
  - Texte 3D ou icône spatiale projetée (ex: icône Scan / « Scanner la pièce »).
  - Gestion des états : `idle` (prêt à scanner), `scanning` (animation de chargement / ondes radar), `completed` (nombre d'objets détectés).
- [x] Détection d'interaction : survol au pointeur laser et clic gâchette (`selectstart`).
- [x] **Done when :** Le bouton flotte de façon stable devant l'utilisateur en VR ; il réagit visuellement au survol du curseur et déclenche un callback au clic.

### VS-T3 : Moteur de capture & Projection spatiale des détections (Spatial Vision Pipeline)

- [x] Créer le hook `useSpatialVisionSession` / pipeline de détection spatiale :
  - Déclenchement de la capture : snapshot du viewport WebGL (`gl.domElement.toDataURL()`) ou image témoin `/samples/vision-room.jpg`.
  - Appel vers `POST /api/vision` (ou mock via `server/perception/mock.ts` en `dev-mock`).
  - Réception des `ApplianceDetection[]` avec leurs coordonnées normalisées `box: { x, y, w, h }`.
- [x] Algorithme de projection 2D $\rightarrow$ 3D (`spatial-projection.ts`) :
  - Conversion des coordonnées de boîte normalisées en positions 3D $(x, y, z)$ réparties sur un arc devant l'utilisateur ($z \approx -1.8\text{ m}$ à $-2.5\text{ m}$).
  - Calcul de la taille de boîte englobante 3D adaptée au volume réel estimé de l'appareil.
- [x] Tests unitaires Vitest pour `spatial-projection.ts` (vérification de la distribution spatiale et des bornes sans chevauchement).
- [x] **Done when :** Un clic sur le bouton spatial lance la détection et génère une liste d'objets positionnés dans l'espace 3D avec leurs coordonnées calculées.

### VS-T4 : Contrôleur Blaster, Réticules de visée & Raycast de Tir

- [x] Créer le composant `<XRBlasterController />` (`features/vision-insert/ui/xr/xr-blaster-controller.tsx`) :
  - Écoute du contrôleur WebXR actif (`renderer.xr.getController(0)`).
  - Rayon laser visible partant de la manette (ou du centre caméra en mode souris émulateur).
  - Boucle de raycast Three.js (`useFrame`) testant les intersections avec les cibles enregistrées.
- [x] Créer le composant de cible holographique `<HoloDetectionTarget />` :
  - Boîte filaire 3D cyan translucide englobant l'objet détecté.
  - Étiquette 3D avec nom localisé de l'appareil (ex: _« Réfrigérateur »_, _« Téléviseur »_).
  - État `hovered` (la boîte devient ambre/or et émet de légères vibrations haptiques sur la manette).
- [x] Mécanique de tir au laser :
  - Événement `selectstart` : tir d'un faisceau d'énergie rapide vers le point d'impact.
  - Effet visuel d'impact : flash blanc, onde de choc circulaire, particules d'impact cyan.
  - Notification sonore discrète ou feedback visuel d'impact validé.
- [x] **Done when :** L'utilisateur peut viser chaque boîte d'objet avec son pointeur, la boîte s'illumine en survol, et presser la gâchette / cliquer déclenche un tir avec effet d'impact sur la cible.

### VS-T5 : Matérialisation procédurale & Animation 3D in-situ (Spawn & Morphing)

- [x] Créer le composant `<SpawnedObject3D />` (`features/vision-insert/ui/xr/spawned-object-3d.tsx`) :
  - Intègre le générateur de géométrie procédurale existant `recipeMesh` / `silhouetteMesh` (`object-geometry.ts`).
  - Déclenche l'appel de raffinement `POST /api/vision/shape` (ou génère la recette par défaut de l'archétype d'appareil).
- [x] Séquence d'animation d'apparition (_Spawn Sequence_) :
  - $t_0 \rightarrow t_{300\text{ms}}$ : Implosion de la cible holographique filaire.
  - $t_{300\text{ms}} \rightarrow t_{800\text{ms}}$ : Matérialisation des arêtes d'encre (_ink wireframe_ cyan/vert).
  - $t_{800\text{ms}} \rightarrow t_{1400\text{ms}}$ : Extrusion du volume plein avec rebond élastique (_spring scale_ de 0 à 1).
  - $t_{1400\text{ms}}+$ : Application des textures PBR, ombres de contact au sol (`ContactShadows`), badge de puissance (ex: _« 150 W »_).
- [x] Interaction post-génération : possibilité d'activer/désactiver l'appareil ou de l'ajouter directement au microgrid simulé du village.
- [x] **Done when :** Le tir sur une cible déclenche la métamorphose et l'objet 3D final apparaît avec son animation et reste ancré au sol de la pièce.

### VS-T6 : Scénarios de test, Accessibilité, Parité i18n & Gate-out

- [x] Documenter le scénario manuel dans `test-scenarios/06-village.md` (scénarios V196 à V200).
- [x] Tests automatisés :
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/spatial-projection.test.ts`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/spatial-air-button.test.tsx`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/holo-detection-target.test.tsx`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/power-connection-beam.test.tsx`
  - `apps/web/src/features/vision-insert/ui/xr/__tests__/village-xr-viewport.test.tsx`
  - `apps/web/src/features/vision-insert/__tests__/village-editor-page.test.tsx`
- [x] Exécuter `make check-i18n` pour garantir 100 % de parité sur les nouvelles clés (EN, FR, MG).
- [x] Exécuter `tsc --noEmit` (typecheck 0 erreur).
- [x] Mettre à jour `HANDOFF.md` et cocher les tâches.

### VS-T7 : Raccordement au Réseau dans les Airs & Synchronisation Jumeau Numérique (In-Air Grid Connect)

- [x] Ajouter l'action de raccordement / déconnexion au réseau directement dans l'espace 3D :
  - Viser et tirer sur un appareil déjà matérialisé bascule son état de raccordement au microgrid.
  - Viser affiche l'action contextuelle localisée : _« ⚡ Visez et tirez pour raccorder (+150 W) »_ ou _« ⚡ Visez et tirez pour déconnecter »_.
- [x] Intégrer les stores `@mitsinjo/engine` :
  - `useSimulationAppliances().upsert()` ajoute la charge calculée (`APPLIANCE_CATALOG`) au secteur suggéré (`suggestSector`).
  - `usePlacedModelsStore.getState().upsert()` enregistre la recette 3D (`activeRecipe`) avec échelle réaliste (`sceneScale`).
- [x] Retour visuel 3D immersif :
  - Conduit d'énergie courbe `<PowerConnectionBeam />` reliant l'appareil à la jonction centrale du village.
  - Anneau d'aura énergétique vert émeraude (`#22c55e`) à la base avec pulsation active.
  - Carte holographique 3D mise à jour avec statut _« ✓ Raccordé au réseau (+150 W) »_.
- [x] **Done when :** Tirer sur un meuble matérialisé le raccorde au microgrid, fait jaillir le conduit d'énergie vert 3D et incrémente le compteur d'appareils de la simulation sans quitter l'immersion VR.

### VS-T8 : Tableau de bord HUD Holo dans les Airs (Diegetic Microgrid HUD)

- [x] Créer le composant `<VillageSpatialHUD />` positionné en flottement diégétique (`[-0.95, 1.55, -1.2]`, orienté vers le joueur).
- [x] Créer `spatial-hud-texture.ts` : canvas 2D haute définition avec :
  - Jauge Batterie SoC (%) et indicateur état
  - Puissance Solaire instantanée (kW)
  - Charge Village totale (kW)
  - Notification transitoire lors du raccordement d'un appareil (ex: `+180 W [Réfrigérateur] Raccordé`)
  - Bouton interactif pour minimiser / déployer le panneau
- [x] Connecter au store `@mitsinjo/engine` et `useSimulationAppliances()`
- [x] Ajouter les clés i18n dans `en.json`, `fr.json`, `mg.json` (`make check-i18n`)
- [x] Tests unitaires Vitest pour le HUD et sa texture.
- [x] **Done when :** En immersion VR, le tableau de bord holographique affiche en direct la batterie, le solaire et la charge, et réagit instantanément lorsqu'un appareil est raccordé ou déconnecté au laser.

### VS-T9 : Spatial Audio 3D Panner (Positionnement spatialisé des effets sonores)

- [ ] Utiliser `PannerNode` pour positionner les sons selon les coordonnées 3D réelles `[x, y, z]` des impacts et du blaster.
- [ ] Synchroniser l'écouteur Web Audio avec la caméra WebXR.
- [ ] Tests et validation audio.

### VS-T10 : Écran Panoramique Webcam Live & Atmosphère 360° (Live Camera Screen & Surroundings)

- [x] Créer le composant `<LiveWebcamBackdrop />` (`features/vision-insert/ui/xr/live-webcam-backdrop.tsx`).
- [x] Stream vidéo temps réel webcam via `navigator.mediaDevices.getUserMedia` et texture vidéo Three.js (`THREE.VideoTexture`).
- [x] Projection sur écran cylindrique incurvé (arc panoramique de 130°, rayon 4.5m) en face de l'opérateur.
- [x] Élimination du vide noir 360° : dôme céleste d'atelier de rayon 24m (`#081022`), anneau d'horizon ambiant et sol étendu.
- [x] Fallback automatique sur la pièce témoin haute définition `/samples/vision-room.jpg` en l'absence de webcam ou sous émulateur.
- [x] Capture instantanée du flux vidéo actif au clic du bouton spatial aérien pour la détection perception.
- [x] Clés de traduction localisées (`vrLiveWebcam`, `vrVirtualRoom`, `vrCameraStandby`) avec parité 100 % (`make check-i18n`).
- [x] Tests unitaires Vitest pour le backdrop webcam et la gestion du flux.
- [x] **Done when :** En immersion VR, la webcam affiche le flux vidéo en direct devant l'utilisateur, l'espace 360° est entouré d'une atmosphère studio sans aucun vide noir, et le scan s'effectue directement sur l'image vue.

### VS-T11 : Tir direct sur les objets de la vidéo webcam (alignement, entrées, confort)

- [x] Géométrie partagée de l'écran webcam (`webcam-screen.ts`) : bord bas au sol, point 3D d'un pixel, pixel visé par un rayon.
- [x] Cibles posées sur l'objet vu dans la vidéo ; modèle 3D qui sort de l'image vers l'utilisateur (≤ 0,9 m).
- [x] Tir sur la vidéo sans scan préalable → scan → l'objet sous le tir devient 3D (un seul geste).
- [x] Une seule source d'entrée (`XRBlasterController`) : `selectstart` seulement, pincement natif des mains, plus de double tir souris / gâchette / pincement.
- [x] Panneaux sous la ligne des yeux à ~1 m (`xr-layout.ts`) ; mains en sphères cyan, index compactés (`updateHandMesh`).
- [x] `make vr-probe` : vérification dans l'émulateur IWER (manettes + mains + webcam simulée).
- [x] **Done when :** dans l'émulateur, viser le frigo de la vidéo et tirer le transforme en 3D ; un 2ᵉ tir le raccorde ; pincement main et manette gauche fonctionnent.

---

## Exit criteria

- [x] Sur desktop dev (`make dev-mock`), le bouton « Voir en VR » apparaît sur `/village` via l'émulateur Meta IWER.
- [x] Dans la session VR, le bouton spatial 3D flotte devant l'utilisateur et pulse doucement.
- [x] Cliquer sur le bouton déclenche le scan et fait apparaître les cibles holographiques des objets détectés.
- [x] Le rayon laser suit les mouvements de la souris (ou du contrôleur), survolant et verrouillant les cibles.
- [x] Tirer sur une cible détruit le réticule et fait apparaître le modèle 3D animé in-situ.
- [x] Tirer sur un modèle 3D matérialisé le raccorde ou le déconnecte du microgrid avec câble d'énergie 3D dynamique.
- [x] Quitter la session VR restaure proprement la page 2D sans fuite de contexte WebGL ni erreur console.
- [x] `make check-i18n` passe à 100 % et les tests unitaires sont verts.

### VS-T12 : Miniature 3D tournante et manipulable devant l'utilisateur

- [x] Le modèle tiré vole de la vidéo vers un socle à ~0,55 m, sous les yeux (`miniatureSlot`), en miniature de 22 cm.
- [x] Rotation automatique (`turntable.ts`), arrêtée en main et 1,5 s après le relâcher.
- [x] Saisie au select maintenu (gâchette, pincement, clic) ; mouvement de la manette / main / souris → rotation.
- [x] Tap sur la miniature = raccorder / déconnecter ; `make vr-probe` raccorde le frigo par sa miniature.
- [x] **Done when :** dans l'émulateur, frigo, ventilateur et TV deviennent des miniatures devant soi qui tournent ; tap sur le frigo le raccorde.

### VS-T13 : Menu au poignet (boutons flottants masqués à l'entrée)

- [x] Aucun panneau flottant à l'entrée ; petit bouton sur le poignet gauche (main : joint `wrist`, manette : poignée gauche, sinon bas-gauche de la vue).
- [x] Doigt de l'autre main, laser, pincement ou souris sur le bouton → ouvre / ferme le menu (bouton de scan, guide, HUD).
- [x] Menu dans le monde à 0,9 m, sous les yeux, suivi différé (recentrage après ~35° de rotation ou 35 cm de déplacement).
- [x] Bouton de scan inactif menu fermé ; bouton qui pulse quand un événement arrive menu fermé.
- [x] **Done when :** `make vr-probe` → 8 PASS (menu fermé à l'entrée, ouvert puis fermé depuis le poignet, sans scan).

### VS-T14 : Espace de test 360° navigable (photos réelles, hors vrai casque)

- [x] Écran webcam plat (`ImageSurface`) au lieu de l'écran cylindrique ; étiquettes jamais coupées.
- [x] Émulateur / PC : 6 pièces réelles en 360° (`tour/`), flèches au sol, ↑/W/Z, stick, fondu entre pièces.
- [x] Scan = photo de la vue centrée sur la visée ; tir direct sur la photo ; vérité terrain mock (`expected`).
- [x] Page web masquée pendant l'immersion émulée (`data-xr-emulated`).
- [x] **Done when :** `make vr-probe` → 11 PASS (loft, scan du frigo, flèche → hall, ↑ → séjour) ; « MARRY » lisible à l'endroit.
- [ ] Vérifier sur un vrai Quest que la webcam plate garde le tir aligné.
