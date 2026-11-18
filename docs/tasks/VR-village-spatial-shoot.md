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

> Retiré en VS-T32 (panneau jugé encombrant) : les événements passent par la notice `XrEventToast`.

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

### VS-T15 : Espace extérieur (maisons, arbres, forêt) & contrôles de l'émulateur

- [x] 7 lieux extérieurs réels CC0 reliés depuis la fenêtre du hall : terrasse (panneaux solaires), rue, maison, jardin, allée d'arbres, forêt, sous-bois.
- [x] Vérité terrain : maisons, voitures, arbres en décor (`scenery`) ; panneaux solaires, lampadaire, applique en objets.
- [x] Panneaux IWER DevUI de retour (`installDevUI`) ; bouton « Quitter l'immersion VR » visible pendant la session émulée.
- [x] **Done when :** `make vr-probe` → 14 PASS (promenade terrasse → forêt, DevUI monté, bouton de sortie présent).

### VS-T16 : Marcher pour de vrai dans l'espace 360°

- [x] Photo posée au sol (sol + mur, parallaxe) : marche continue clavier (↑/W/Z, S, A/Q/D) et stick, dans un disque autour du point de prise de vue.
- [x] Marcher sur une flèche (ou tirer dessus = y marcher) → traversée en fondu enchaîné vers le lieu suivant, sans écran noir.
- [x] Confort : vitesse constante, vignette en marche, pas de balancement de tête dans un vrai casque.
- [x] Extension « Immersive Web Emulator » reconnue comme émulateur (visite 360° au lieu de la webcam).
- [x] **Done when :** `make vr-probe` → 15 PASS (↑ maintenu : la flèche se rapproche puis séjour).
- [ ] Vrai Quest : confort de la marche continue (vignette), réglage du mur par pièce si la parallaxe paraît fausse.

---

## Extraction 3D en immersion (VS-T17 → VS-T22)

Parcours : menu du poignet → « Analyser la vue » → balayage holographique → contours SAM posés sur la vue 360° avec
nom + brève description → tir sur un objet → « Extraire en 3D ? » → vue 2D et faces en carrousel holographique
(glisser gauche / droite) à valider → construction 3D → laboratoire 3D immersif, édition en temps réel.
Style : hologramme futuriste (cyan / ambre, lignes de balayage, coins lumineux, additif), panneaux à ~1,1 m
(portée rayon Meta 0,8–3 m), cibles ≥ 6 cm (≥ 3°), défilement = pincer-glisser n'importe où sur le contenu.

### VS-T17 : Brève description par le modèle vision

- [x] `ApplianceDetection.description` (EN) + `descriptions.{fr,mg}` (≤ 90 caractères), demandés au modèle de détection ; `localDescription()`.
- [x] Mock : descriptions des objets de la pièce d'exemple ; sans description → nom + catégorie (repli).
- [x] **Done when :** `/api/vision` renvoie une description par objet (mock et Meta), tests de parsing verts.

### VS-T18 : Analyse en cours & contours holographiques sur la vue

- [x] « Analyser la vue » ferme le menu ; balayage holographique (barre de scan, coins, « Analyse de la vue… ») sur la zone analysée.
- [x] Contour SAM (ou boîte) de chaque objet posé sur la photo 360°, voile au survol, étiquette nom + description au-dessus.
- [x] **Done when :** après l'analyse, chaque objet est contouré et décrit ; le survol l'illumine.

### VS-T19 : Dialogue « Extraire en 3D ? » & panneaux holographiques

- [x] Registre de panneaux (`holo-panel.ts`) lu par `XRBlasterController` : survol, tir, glisser (source d'entrée unique conservée).
- [x] Tir sur un objet non extrait → dialogue holographique (Extraire en 3D / Annuler), le reste estompé.
- [x] **Done when :** tirer sur le frigo ouvre le dialogue ; Annuler le ferme sans appel réseau.

### VS-T20 : Vue 2D & faces en carrousel holographique

- [x] Extraire → vue 2D dessinée (Muse) puis les autres faces, une diapositive chacune, sur un arc devant soi.
- [x] Glisser (manette, main, souris) ou flèches → diapositive suivante ; Valider / Redessiner par face ; « Valider et construire la 3D ».
- [x] **Done when :** en `make dev-mock`, les 5 diapositives défilent, se valident, et lancent la 3D.

### VS-T21 : Construction 3D en immersion

- [x] Étapes du serveur (découpe → Spark → ajustement) en hologramme, puis « Entrer dans le labo 3D ».
- [x] **Done when :** le modèle prêt ouvre le labo d'un tir.

### VS-T22 : Laboratoire 3D immersif, édition en temps réel

- [x] Salle holographique (dôme sombre, grille, socle), modèle à ~1 m, saisie pour tourner.
- [x] Pièces : liste, sélection (tir sur la pièce ou la liste), masquer, échelle −/+, tourner 90°, opacité, modes d'affichage, annuler / rétablir, réinitialiser.
- [x] Chaque édition va à la recette à l'instant (`editPieces`) : la page 2D et le village la voient.
- [x] Quitter le labo → miniature de l'objet devant soi (raccordement inchangé).
- [x] **Done when :** `make vr-probe` : analyse → dialogue → faces → 3D → labo → une pièce masquée ; 0 erreur.

### VS-T23 : Commandes manettes & mains réécrites (lisibles, Meta)

- [x] Carte unique (`xr-controls.ts`) : gâchette / pincement valider · grip attraper · stick gauche marcher · stick droit ←/→ pivot 30°, ↑/↓ pas 0,8 m · A/X analyser · B/Y retour · clic de stick aide ; mains : microgestes de pouce (pivot, pas, tap = analyser).
- [x] Bulle « Gâchette · Extraire « Frigo » en 3D » au bout de chaque laser ; légende des boutons sur chaque manette / main (25 s à l'entrée, clic de stick).
- [x] Panneaux : un bouton tape toujours, glisser seulement au-delà de 4° nets (« Extraire en 3D / Annuler » ne ratent plus) ; contours fixes en marchant ; contour complet de l'objet (bande 180°).
- [x] Docs : `vr-immersion-guide.md` § 6 réécrit, `vr-iwer-tools.md` (outils IWER, index des boutons, microgestes).
- [x] **Done when :** `make vr-iwer-tools` 31/31 et `make vr-probe` vert.

### VS-T24 : Clics dans l'émulateur, aide à la demande, studio 3D dès l'extraction

- [x] Souris écoutée sur la page : le canvas de la DevUI IWER (par-dessus la scène) n'avale plus les clics (bouton du poignet, « Extraire en 3D / Annuler ») ; rayon de la caméra de l'œil XR, survol sans laser.
- [x] Glisser le carrousel / tourner un modèle à la souris ne fait plus tourner la vue émulée (geste gardé, phase de capture).
- [x] Menu poignet › « Afficher / Masquer l'aide des commandes » ; légendes 12 s à l'entrée, plus petites.
- [x] « Extraire en 3D » → studio (`xr-extract-studio.tsx`) : carrousel au centre, colonne de génération + miniature à droite, hologramme sur le socle pendant la construction, labo ouvert tout seul (plus de « Entrer dans le labo 3D »).
- [x] **Done when :** `make vr-probe` 28/28 (clics souris, studio, labo automatique).

### VS-T25 : Studio lisible, marche dans le studio, rotation sans tourner la vue

- [x] Cartes de texte hologramme : toutes les lignes rétrécissent ensemble quand le titre passe sur 2 lignes (« Construction 3D de « plante en pot » » n'est plus coupé en haut).
- [x] Mode Play de l'émulateur : tenir le carrousel / un modèle à la gâchette et bouger la souris tourne l'objet, plus la vue.
- [x] Marcher dans le studio : stick gauche, pas de 80 cm (stick droit ↑/↓, swipe du pouce), molette ; remis à zéro à la sortie.
- [x] Vues 2D plus grandes (0,6 m, espacées de 32°), colonne de génération décalée à droite.
- [x] Plante en pot : le pot dessiné est lu (`tree/plant-pot.ts`) et tourné sous la plante, posée sur la terre ; boîte à la hauteur du dessin (avant : pot coupé comme des racines, plante aplatie).

### VS-T26 : Vraies mains, vraies manettes, laser Meta, studio navigable

- [x] Main articulée réelle (`generic-hand`, peau + liseré) et modèle de manette du profil d'entrée (`microgrid-3d/utils/xr-input-models.ts`), repli hors ligne ; aussi sur `/simulation`.
- [x] Laser selon Meta « Ray casting » : faisceau court qui s'efface, curseur anneau à taille angulaire constante, blanc / bleu nuit à l'appui (`xr-ray-visual.ts`), sur `/village` et `/simulation`.
- [x] Menu poignet cliquable (main, laser, souris) et qui ne tourne plus avec la souris : bouton flottant dans l'émulateur ou sans poignet gauche suivi, latéralité lue sur la session.
- [x] Bouton « Quitter le studio » / « Revenir au studio » ; l'objet du labo est gardé tant qu'on n'en extrait pas un autre. (`away` dans `utils/xr-extract.ts`, `FollowGroup`).
- [x] Calques dans le labo immersif, liste défilable verticalement (comme le carrousel) : axe `y` des panneaux (`holo-panel.ts`), `clampScroll` / `rowShown` (`utils/xr-lab.ts`).
- [x] Annuler / réessayer l'analyse : web (`DetectionCanvas`, statut `cancelled`) et immersion (bouton flottant, B/Y) ; bouton Menu ouvert au regard + gâchette dans l'émulateur.

### VS-T27 : Chat IA par vue 2D dans le studio, clavier virtuel, voix, maki-bot

- [x] Chat à gauche du carrousel des vues 2D : historique par vue (principale + faces) de l'objet, bulles opérateur / bot IA distinctes, libellé « MODIF. IA » (`holo-face-chat.tsx`, `holo-chat-texture.ts`).
- [x] « Envoyer » redessine la vue en focus avec la demande (même appel que le panneau 2D web : détails + redessiner) ; le bot répond « en cours » puis « fait » / « échec » d'après l'état du dessin (`utils/face-chat.ts`).
- [x] Clavier holo (« Clavier » ou tap sur le champ) : un plan, touche par UV, AZERTY en français, Maj / Effacer / Vider, touche survolée surlignée (`utils/xr-keyboard.ts`).
- [x] Voix : Web Speech API (`use-voice-input.ts`) ; sans elle (Quest Browser), clavier système WebXR et sa dictée (`use-system-keyboard.ts`) ; sinon bouton désactivé avec message.
- [x] Tête de maki robot en haut à droite : suit le curseur, cligne des yeux, antenne en queue annelée qui pulse pendant un dessin (`lemur-bot.tsx`, `utils/lemur-bot.ts`).
- [ ] **Done when :** `make vr-probe` vert (chat : clavier, envoi, réponse du bot) ; joué au casque (dictée du clavier système).

### VS-T28 : Hologramme du village dans le labo, placer l'objet, aller à la simulation

- [x] Table hologramme du cœur du village à droite du labo (chemins, étang, bâtiments, objets déjà placés), inclinée vers l'utilisateur (`holo-village-table.tsx`, `utils/village-holo.ts`).
- [x] Viser + gâchette pose l'objet (placement de la page : terrain, hors bâtiments et chemins, départ le plus proche) ; câble vers son départ ; curseur sur la table.
- [x] « Insérer dans la simulation » : même appel que le panneau web, extrait dans `hooks/use-appliance-insert.ts` (ligne + modèle 3D édité dans le labo, moteur relancé) ; « Mettre à jour » ensuite.
- [x] « Aller à la simulation » (une fois inséré) : termine la session XR, ouvre `/simulation`.
- [ ] **Done when :** `make vr-probe` vert (table, pose, insertion) ; joué au casque.

### VS-T29 : Panneaux lisibles, icônes et bulles au survol, niveau de voix, arrivée en VR dans la simulation

- [x] Texte en dmm (`holoTextPx`, `HOLO_TEXT_DMM`) : boutons, champ, historique et titres du chat lisibles à 1,4 m (≥ 18 px Meta).
- [x] Icônes sur les boutons (`holo-icons.ts`) ; bulle au survol qui répète le libellé en grand + ce que fait le bouton (`HoloButton.tip`).
- [x] Graphe « Niveau de voix » dans le champ pendant la dictée (`holo-voice-meter.tsx`, `lib/voice-analyser.ts` partagé avec le copilote).
- [x] Table du village : titre, état et boutons au-dessus du bord éloigné, à hauteur des yeux (plus sous la table).
- [x] « Aller à la simulation » : `/simulation` entre seule en VR, à côté de l'objet ajouté (`utils/xr-handoff.ts`).
- [ ] **Done when :** `make vr-probe` + `make vr-sim-probe` verts ; joué au casque (entrée VR sans geste sur Quest à vérifier).

### VS-T30 : Mains et manettes visibles (et masquables), lasers de couleur adaptative

- [x] /simulation : mains et manettes coupées par le plan proche (0,5 m) → 5 cm pendant la session (`XrInputsLayer`).
- [x] Afficher / masquer mains et manettes partout : calque `XR_INPUT_LAYER`, stick maintenu 0,8 s, Menu › bouton sur /village, choix gardé.
- [x] Lasers : couleur selon l'environnement (`xr-ray-contrast.ts`) + halo du ton opposé, sur /village et /simulation.
- [ ] **Done when :** `make vr-probe` + `make vr-sim-probe` verts ; joué au casque (ciel clair, intérieur sombre).

### VS-T31 : Passage labo 2D → labo 3D en tournant les bureaux, et retour

- [x] « Valider et construire la 3D » : les bureaux tournent de droite à gauche (plateau centré sur le spectateur, `StudioDesks`), la salle reste fixe.
- [x] Labo 3D : bouton « Labo 2D » tout à gauche → retour aux vues 2D (rotation inverse), le modèle reste (`toViews`).
- [x] Labo 2D : bouton « Labo 3D » sous la carte de génération dès que le modèle existe (`toLab`).
- [ ] **Done when :** `make vr-probe` vert (aller-retour 2D ↔ 3D) ; joué au casque (confort de la rotation).

### VS-T32 : Menu et miniatures plus clairs

- [x] HUD « Télémétrie Microgrid » retiré du menu ; les événements (raccordé, masqué…) s'affichent 4,5 s dans une notice (`xr-event-toast.tsx`).
- [x] Bouton de scan : cristal et anneaux au-dessus de la carte (`AIR_CRYSTAL_Y`), ils ne cachent plus « Cibles acquises » ni le titre.
- [x] Guide des commandes : texte sur deux lignes dans la carte holo partagée (ne déborde plus).
- [x] Menu : bouton « Fermer » en haut à droite de la carte de scan (`MENU_CLOSE_OFFSET`).
- [x] Miniature : notice « gâchette raccorde, grip tourne, « Ranger » l'enlève » + carte au-dessus (nom, état, aide) avec « Ranger » (`miniature-label.tsx`).
- [ ] **Done when :** `make vr-probe` vert ; joué au casque.

### VS-T33 : Immersion dans l'URL, taille humaine et regard au clavier dans /simulation

- [x] `?immersion=vr` sur `/simulation` (VR ouverte ou demandée) et `/village` (immersion), `&lab=2d|3d` aux bureaux du labo (`utils/immersion-query.ts`, `hooks/use-immersion-query.ts`) ; « Aller à la simulation » ouvre `/simulation?immersion=vr` ; recharger l'URL rouvre l'immersion.
- [x] /simulation VR : rig réduit à 0,5 dans le village à demi-échelle (yeux ≈ 0,8 m, sous les murs de 1,3 m), 1:1 dans les pièces ; pas, vitesse, laser et panneau de secteur suivent (`utils/xr-walk.ts`).
- [x] Clavier : `←`/`→` tournent la tête (90°/s) pendant la marche (le pavé tactile d'un portable est coupé pendant la frappe) ; `A`/`Q`/`D` restent le pas de côté.
- [ ] **Done when :** `make vr-sim-probe` vert ; joué au casque (taille ressentie, confort).

### VS-T34 : Table de mixage du dispatcher en VR (/simulation)

- [x] Étiquette (ou abri) du dispatcher → table de mixage VR : tranche Batterie (réserve, « Lancer la batterie et dispatcher »), une tranche par secteur (limite kW, Couper / Allumer), une par appareil raccordé directement au dispatcher (`connectionMode: 'ems'`, ajouté depuis /village, auto-ajouté).
- [x] Curseurs « DJ » : glisser au laser (`utils/xr-drag.ts`, `xr-hands.ts`), moteur relancé au relâchement, annulable ; clinique jamais coupée.
- [x] Patches moteur purs et testés (`utils/dispatch-mixer.ts`) ; bouton holo et placement partagés (`ui/sim-xr-holo.tsx`).
- [ ] **Done when :** `make vr-sim-probe` vert (table, couper / allumer, refus clinique) ; glisser joué au casque.

### VS-T35 : Objets insérés étiquetés, éclairés et dimensionnés comme le village (/simulation)

- [x] Tout traduit : étiquettes 3D de l'immersion (solaire, batterie, dispatcher, éoliennes, lac, « En veille »), noms par défaut du solaire et de la batterie retirés (`features.simulation.villageTags`, `villageTypes.appliance`).
- [x] Écran : au-delà de 6 objets, chaque objet inséré avec son modèle depuis /village garde son badge (`taggedMarkers`) ; badges à la taille de ceux des bâtiments.
- [x] Immersion (écran et VR) : une étiquette 3D par objet inséré (`ImmersionTag`, couleur de son secteur), sous le même interrupteur « Types de village & Étiquettes » (affiché au départ).
- [x] Lumière du village : objet non alimenté tel quel le jour, assombri seulement la nuit (`duskDarkness`, `placedDim`, `drawnTint`) ; finition des murs du village (rugosité 0.68, métal 0.05).
- [x] Taille selon les proportions (`sceneScale`) : hauteur type de son genre (`ARCHETYPE_HEIGHT_M`, village au ½ : `VILLAGE_UNITS_PER_M` 0.5) gardée dans sa plage réelle de largeur ; l'ancienne échelle stockée est ignorée au chargement.
- [x] `make placed-shot` : réfrigérateur, TV, ventilateur et pompe réels posés dans /simulation, captures écran et immersion.
- [ ] **Done when :** vu au casque (étiquettes, taille, nuit).

### VS-T36 : Boutons suiveurs dans un dock bas (studio /village)

- [x] Le bouton flottant « Menu » (sans poignet gauche, émulateur) et « Quitter le studio / Revenir au studio » descendent dans un dock bas du cadre suiveur (`FOLLOW_DOCK_Y` −0.3 m, ~34° sous le regard, `FOLLOW_DOCK_X` ±0.48 m) : ils ne couvrent plus les panneaux du labo, la table du village ni le panneau de placement, et n'interceptent plus leurs clics.
- [x] Hors du menu ouvert (carte de scan, guide, boutons) ; test `xr-layout.test.ts` « follow dock ».
- [x] Régression VS-T33 corrigée : « Aller à la simulation » restait sur /village (la fin de session réécrivait l'URL `/village` par `replaceState`, ce qui annulait le `router.push`). `leaveImmersionFor(href)` gèle l'URL de la page quittée jusqu'à l'arrivée (10 s max) ; test `use-immersion-query.test.tsx`, `make vr-handoff-probe`.
- [x] /simulation VR : le clic d'un laser raycastait toute la scène en un appel ; un objet qui lève une erreur (câble `Line2`…) vidait le résultat → « Fermer ✕ » et le laser gauche sans effet. `pickUsable` (`xr-hands.ts`) teste chaque objet utilisable à part, pour le survol, le clic et le glisser.
- [x] ~~Flèches ← / → échangées~~ : annulé en VS-T38 (va-et-vient avec la rotation de tête de l'émulateur).
- [ ] **Done when :** vu au casque (V463–V466, S151–S153).

### VS-T37 : Carte du village dans la VR de /simulation (mini-carte style GTA + carte hologramme)

- [x] Mini-carte en bas à droite de la vue, cap en haut, centrée sur le marcheur ; secteurs (statut moteur) et dispatcher ; suivi paresseux, jamais collée à la tête.
- [x] Gâchette dessus → grande carte holographique devant soi (nord en haut, « Vous » + direction) ; un bâtiment ouvre son panneau de puissance, le dispatcher sa table de mixage ; « Fermer ✕ » / B/Y.
- [x] `utils/sim-xr-minimap.ts` (testé), `useSimXr` (`map`, `openMap`, `closeMap`, testé), textes `features.simulation.vrMap` (EN/FR/MG), `make vr-sim-map-probe` (4 étapes passent).
- [ ] **Done when :** vu au casque (S154–S157).

### VS-T38 : Carte qui suit, routes et eau, laser toujours visible (/simulation VR)

- [x] Carte dessinée sur texture (`utils/sim-xr-map-draw.ts`, testé) : routes et chemins, mare, lac, rizière, bâtiments, noms nets et droits.
- [x] Grande carte plus grande (rayon 0,55 m), presque droite, qui suit le marcheur et reste centrée sur lui ; flèche selon le regard.
- [x] Mini-carte tout à droite (~38°).
- [x] Laser : faisceau léger + pointe au repos, faisceau jusqu'à la cible, objets nouveaux visables en ~0,1 s (`xr-ray-visual.ts` `idle` / `reach`, `xr-hands.ts`).
- [x] Flèches ← / → remises dans leur sens d'origine.
- [x] Second clic sur l'étiquette / le bâtiment / le dispatcher d'origine : son menu se ferme (`useSimXr`).
- [x] Dev : l'extension Immersive Web Emulator ne lève plus `setPointerCapture` InvalidStateError ni « reading 'position' » (`guardEmulatorPointerCapture`).
- [ ] **Done when :** vu au casque (S158–S161).

### VS-T39 : Carte du village pour placer l'objet (/village web et labo VR), comme celle de /simulation

- [x] Carte web « Placer sur la carte » (`PlaceMinimap`) : routes et chemins, mare, lac, rizière, noms des bâtiments (desserte en cyan), abri EMS, flèche du nord ; vue « Village » par défaut, bouton « Tout le terrain ».
- [x] Table du village du labo VR (`HoloVillageTable`) : même dessin que la carte de /simulation (`drawVillageMap`, sans flèche du marcheur, noms 1,35×), desserte en vert ; visée / clic inchangés.
- [ ] **Done when :** vu à l'écran (V467–V470) et au casque (V471–V472).

### VS-T40 : Objet non électrique : pas de poteau ni de câble (/village web et labo VR)

- [x] Choix « Électrique · poteau et câble » / « Non électrique · sans poteau » (panneau d'insertion web et table du village du labo VR) ; décor = non électrique par défaut.
- [x] Non électrique = ligne moteur à profil horaire nul (`NO_LOAD_DUTY`, 0 kWh calculé) ; aucun piquage, poteau ni câble (scène, carte de placement, table VR), pas de branche au schéma électrique, jamais relié au dispatcher.
- [ ] **Done when :** vu à l'écran (V473–V476) et au casque (V477).

### VS-T41 : Mock IA de la visite 360° : contours, 3D, vues 2D fidèles aux photos (mode mock)

- [x] Contours tracés à la main des 46 objets de la visite (`tour-outlines.ts`, `make tour-trace` → `make tour-outlines`) ; la boîte de chaque objet en découle ; la détection attendue envoie le contour projeté dans la photo du scan.
- [x] Modèle construit à la main par objet (`server/perception/tour-mock/specs-*.ts`, en mètres ; plantes via `reconstructTree` sur le contour), couleurs mesurées pièce par pièce sur la photo (occultants écartés), score IoU / bord / ΔE (`make tour-mock` → `tour-mock.json` + planches `test-results/tour-mock/`).
- [x] Mode mock, objet de la visite : `/api/vision/shape` rend ce modèle (recette, masques de pièces, couverture, 6 angles), `/api/vision/views` ses angles, façade et faces = dessins du modèle sur papier blanc (voiture : profil d'abord).
- [x] Libellé corrigé : `loft-hood` = « Hotte de cuisine » (pas une suspension).
- [ ] Scores sous l'arrêt (IoU ≥ 0,85 et ΔE ≤ 8) : 1/46 ok, IoU moyen 0,77, 14 IoU ≥ 0,85, 22 ΔE ≤ 8 ; plafonniers vus de dessous plafonnés en ΔE (ombrage plat des faces basses), plantes en IoU (couronnes en sphères).
- [ ] **Done when :** vu à l'écran (L-scénarios VS-T41) et au casque.

### VS-T42 : Visite 360° : tous les objets indexés, 3D générées, noms seulement sous le laser

- [x] 113 objets ajoutés (159 au total) dans les 13 photos : meubles (canapés, lits, chaises, tabourets, tables, placards), plantes en pot et bouquets, rideaux, portes, fenêtres, miroirs, tapis ; dehors arbres, haies, clôtures, portail, garde-corps, pylône, rochers, troncs, pneus. Contours en coordonnées panorama (`outlines-src-2.mjs`).
- [x] Les contours analysés restent nus : la carte du nom ne s'affiche que sous le laser (ou une fois matérialisé), `holo-detection-target.tsx`.
- [x] 3D de chaque nouvel objet (`specs-extra.ts`) : pièces paramétriques (canapé, chaise, tabouret, lit, table, meuble, vitrage, porte, garde-corps, clôture).
- [x] Générateur affiné : pièce `silhouette` (le contour tracé comme face avant d'un hull, coupé à une bande, section au choix ; jamais les pixels) pour rideaux, rochers, troncs, fonds photo, pylône ; repli des plantes sur leur contour (couronne + tronc) quand `reconstructTree` lit mal (IoU < 0,45) ; cylindres couchés corrigés (taille = boîte monde).
- [x] Scores (159) : IoU moyen 0,76, 55 IoU ≥ 0,85, 75 ΔE ≤ 8. Sous 0,6 : surtout le mobilier ajouré (étagère métal, tabourets, chaises, pont, arches, garde-corps), dont le contour plein compte le fond vu à travers.
- [ ] **Done when :** vu à l'écran (V484–V488) et au casque.

### VS-T43 : Visite 360° : faces 2D tirées des photos, 3D habillée, calques par pièce (mode mock)

> Demande 2026-11-17 : 3D et faces 2D « le plus réalistes possible », fidèles aux photos (montage vidéo).
> Exception à « jamais la photo sur le modèle » accordée pour le **mock de la visite seulement** ; le chemin Meta la garde.

- [x] Face avant = l'objet découpé dans son panorama (contour resserré de 2 px, fond vu à travers écarté sur les pièces unies, reste comblé par les couleurs voisines), une tuile 512² par objet (`make tour-mock`, ou `make tour-skins` pour ne refaire que les faces → `tour-skins.json`).
- [x] Côtés, dos : objets fabriqués = bandes de bord de la face repliées (raccord aux deux coins), objets vivants (plantes, fleurs) = face enroulée (dos = face vue de derrière) ; atlas 3 × 2 (`tour-mock/skin.ts`).
- [x] 3D : les pièces du modèle portent les faces, projetées depuis la caméra de la photo (lacet et tangage de la prise de vue : un canapé vu de biais reçoit son vrai côté) ; dessus lus au-dessus de leur bord (`lib/face-skin.ts`, `ObjectRecipe.skin`) ; plantes : face avant comme peau (`plant.skin`).
- [x] Calques = pièces nommées (assise, pied, coussin…) dans le Studio 3D ; village et export Blender suivent.
- [x] Faces 2D : avant = la découpe photo sur papier blanc, autres faces et 6 angles imaginés = le modèle habillé rendu sous chaque angle.
- [ ] **Done when :** vu à l'écran (V496–V501) et au casque.

### VS-T44 : Visite 360° : faces imaginées sur toutes les faces, puis pièces 3D et assemblage (voitures d'abord)

> Demande 2026-11-17 : la voiture de la visite montrait la photo découpée en 2D et une caisse habillée de la photo en 3D.
> Chaque objet passe par les vues 2D imaginées de **toutes** ses faces, puis la génération des pièces 3D et leur assemblage,
> un objet à la fois, aussi réaliste qu'un rendu de jeu vidéo ou de film d'animation. Dessins faits **sans Muse** (demande).

- [x] Dessins imaginés de chaque face d'une voiture : profil, avant, arrière, dessus, gauche (profil retourné), papier bleu
      pour la lecture et blanc pour l'opérateur ; peinture laquée (ciel au-dessus de l'épaule, sol en dessous, reflet),
      vitres teintées avec reflets et sièges, jantes alliage et étriers, feux avec lentilles, rails de toit, chromes
      (`tour-mock/car-art.ts`, `make tour-car-art`).
- [x] Construites hors ligne par la chaîne réelle (lecture des vues → plan de voiture → pièces et assemblage habillés des
      dessins, `reconstructObject` sans appel Meta), tournées sur la photo (meilleur IoU du contour), stockées dans
      `tour-imagined.json` (`make tour-imagine`) ; `make tour-photo` sort la photo détourée d'un objet.
- [x] Voitures : `terrace-car` (citadine 5 portes, IoU 0,86 vs 0,75 à la main), `street-car-white` (break, 0,83 vs 0,79),
      `street-car-black` (monospace, 0,83 vs 0,75).
- [x] Réponse mock : la 3D = le plan de voiture habillé des dessins ; faces 2D et angles imaginés = les dessins (plus la photo).
- [x] Tous les autres objets de la visite (mobilier, plantes, maisons, rochers, lampadaires…) : chaque face imaginée
      (avant, droite, arrière, gauche, dessus, dessous) par un rendu « jeu vidéo / animation » de ses pièces, sans photo
      ni Muse (`tour-mock/imagined-shader.ts` : grain du bois, tissage, métal brossé, verre reflétant le ciel, feuillage,
      pierre, brique, tuiles ; lumière principale, ciel / sol, reflet, contre-jour, ombre de contact, tons filmiques ;
      contours encrés). Les six dessins cadrés sur la boîte du modèle font l'atlas que portent ses pièces
      (`skin.mode: 'box'` : chaque surface lit la face vers laquelle elle regarde, dessus et dessous compris) ; une plante
      porte sa face avant imaginée. Faces 2D et 6 angles = les mêmes rendus sur papier blanc (`imagine-faces.ts`).
- [x] Plantes précalculées (couronne lente : `make tour-imagine`) ; les autres imaginées à la demande, gardées en cache
      disque (`node_modules/.cache/tour-imagined/`, `make tour-faces` les prépare toutes).
- [ ] **Done when :** vu à l'écran (V502–V506) et au casque.

### VS-T45 : Immersion : « Ranger » cliquable, une seule carte par miniature, laser bien visible

> Retour 2026-11-17 (émulateur) : « Ranger » ne se cliquait pas, deux cartes se superposaient sur la miniature,
> le menu laissait le survol à l'objet sous le laser, et le laser et son curseur se voyaient mal.

- [x] Une carte par miniature : la carte de l'objet sur la photo ne s'affiche plus qu'au survol (avant : toujours
      une fois la miniature posée, par-dessus la carte de la miniature).
- [x] Survol : la dernière chose bougée l'emporte. La souris amenée sur le menu, un bouton ou « Ranger » prend
      le survol aux lasers immobiles et le garde tant qu'elle y reste (son propre curseur dans la vue casque) ;
      tourner une manette le rend au laser.
- [x] Laser plus visible : faisceau ~4 mm, curseur ~1° avec halo lumineux, s'illumine en mouvement, faisceau
      à 35 % quand il ne vise rien (`xr-ray-visual.ts`).
- [x] `make vr-probe` : une carte par miniature ; la souris sur « Ranger » le survole malgré le laser posé sur
      la miniature, et le clic la range.
- [ ] **Done when :** vu au casque (manettes et mains).

### VS-T47 : Labo sans menu, « Fermer » du menu cliquable, pas de miniature au retour du labo

> Retour 2026-11-17 (émulateur) : dans le labo, le menu cachait les panneaux et proposait « Analyser la vue
> actuelle » ; « Fermer » ne se cliquait pas ; au retour du labo, la miniature et sa carte cachaient
> « Revenir au studio », le laser visait l'objet derrière.

- [x] Pas de menu dans le studio (vues 2D, construction, labo) : ni bouton poignet ni panneau ; un menu
      ouvert se ferme en entrant.
- [x] « Fermer » à droite de la carte de scan, dans le champ de vision et hors du rayon de visée du bouton de
      scan (avant : au-dessus de la carte, hors champ, un tir à côté analysait la vue).
- [x] Quitter le labo ne pose plus de miniature dans la vue 360° (l'objet est dans le labo) : un avis dit
      que « Revenir au studio » le rouvre.
- [x] Souris (émulateur) : curseur et survol seulement sur l'interface (menu, boutons, panneaux, Menu),
      jamais sur les objets, miniatures ni flèches (réservés aux lasers), ni en Play mode (souris verrouillée).
      Avant : après une analyse la souris allumait un autre objet que les lasers, les contours clignotaient,
      et un 3ᵉ rond restait sur les murs.
- [ ] **Done when :** vu au casque (manettes et mains).

### VS-T46 : Visite 360° : extérieur plus fidèle (arbres, garde-corps, pylône) et toutes les faces générées

> Demande 2026-11-17 : générer toutes les faces des objets mock et affiner les 3D restantes, surtout la visite
> extérieure, pour des 3D fidèles à la photo en mode réaliste.

- [x] Plantes jugées sur ce que montre la 3D : le score de la visite, ses planches et les faces imaginées d'une plante
      rendent son maillage `plantMesh` (tronc, branches, feuillage en touffes, cartes de feuilles ; ton par carte,
      cœur et dessous de couronne plus sombres) et plus ses touffes de pièces (`tour-mock/plant-render.ts`).
- [x] Lecture des arbres : la photo détourée est aussi lue nettoyée (ciel vu à travers la couronne → vert voisin plus
      sombre, couronne en contre-jour teintée, tronc sous la couronne sans herbe ni ciel ; `plant-clean.ts`, lecture
      seulement, jamais posé sur le modèle) ; la meilleure des lectures est gardée. Couleurs de la plante mesurées sur
      la photo sans le ciel.
- [x] Plantes de l'extérieur en pleine terre (`PlantHints.ground`) : plus de pot inventé sous un cyprès ou un arbuste.
- [x] `garden-tree-1` (tronc d'eucalyptus seul) en colonne d'écorce ; `garden-tree-2` (chêne nu) en tronc, branches
      maîtresses et voile de rameaux ; garde-corps de la terrasse en fer forgé (`ironRailing` : barreaux en S,
      volutes, poteaux) ; pylône en treillis (`latticeTower`) ; couleurs du fer et de l'acier fixées.
- [x] Scores : plantes extérieures IoU moyen 0,69 → 0,77, ΔE 6,8 → 6,3, 1 → 9 à IoU ≥ 0,85 ; extérieur (73) IoU
      0,72 → 0,75, ΔE ≤ 8 : 42 → 48 ; visite (159) IoU ≥ 0,85 : 55 → 62, ΔE ≤ 8 : 75 → 81. Garde-corps et pylône
      plus bas en IoU (0,18 / 0,29) : le contour plein compte le ciel et la pelouse vus à travers le treillis.
- [x] Toutes les faces imaginées générées dans le cache (`make tour-faces`, version de rendu 2).
- [ ] Reste : ΔE des maisons blanches et des jardinières (15–30 : la couleur compensée de l'ombrage plafonne à 255),
      cyprès et pins sombres (IoU 0,58–0,68), `woods-bridge` (0,28, ajouré), lampadaire fin (0,53).
- [ ] **Done when :** vu à l'écran (V515–V520) et au casque.

## VS-T48 — Hands-first et assis (Meta VR Start : « tout le parcours sans manette »)

Doc Meta (MCP) : « WebXR Hands » — la main n'expose que le pincement (micro-gestes non garantis dans le
navigateur, pincement de paume gauche réservé au système) ; « Locomotion input maps » — mains = téléportation,
pivot 30°, pas de 80 cm, pas de glisse continue.

- [x] Bandeau de navigation pinçable (`xr-nav-pad.ts`) : pivoter ← / →, un pas ↑ / ↓, aide ; file d'actions lue
      par `XrControlsDriver`, donc mêmes effets que les sticks dans les deux mondes. Studio + visite
      (`xr-nav-pad-3d.tsx`) et `/simulation` (`sim-xr-nav-pad.tsx`), centré ≈ 20° sous la vue (champ étroit).
- [x] `HoloButton` (studio) `iconOnly` + `HoloButton` (simulation) `icon` ; icônes `up`, `down`, `turnLeft`,
      `turnRight`, `help` ; légende mains « Flèches sous la vue ».
- [x] `make vr-hands-probe` : /simulation et /village en mode mains seul (pivot, pas, aide, étiquette → panneau →
      couper / rétablir / fermer).
- [x] Bandeau affiché seulement quand les mains sont suivies (`handsOnly`, `use-hands-only.ts`) ; masqué avec une manette.
- [x] Studio /village vérifié en mode mains dans l'émulateur (`make vr-hands-probe` : 20/20, ids `holo:` du studio) ; casque plus tard.
- [x] Suivant : transition labo ↔ village dans la même session → VS-T49.

## VS-T49 — Labo ↔ village de la simulation dans la même session XR

Demande : plus de coupure de l'immersion entre le labo et la simulation ; passage façon labo 2D → 3D, dans
les deux sens, et un bouton de retour au labo. Doc Meta (MCP) : pas de navigation immersive entre pages.

- [x] `VillageWorld` extrait de `village-canvas.tsx` (scène, panneaux VR, caméra) ; `VillageCanvas` l'enveloppe ;
      `useSceneModelFor` / `useStoreSceneModel` partagés avec `/simulation`.
- [x] `/village` : « Aller à la simulation » dans le casque → `useXrWorld.go('village')`, sans fin de session ;
      coque de passage `xr-world-transition.tsx` (couvre puis s'effrite, spectateur immobile).
- [x] « Retour au labo » (`sim-xr-back-to-lab.tsx`) en bas à gauche, pastille masquer / afficher.
- [x] Labo suspendu, pas démonté : son état (cibles, miniatures, objet, place dans la visite) survit à l'aller-retour.
- [x] `CameraController` rend la caméra en cas de démontage en pleine session.
- [x] `make vr-world-probe` (IWER, mains) ; casque plus tard.

## VS-T50 — Le studio / labo 3D devient un vrai labo (360°)

Demande (2026-11-18) : remplacer le dôme sombre et la grille par un décor de labo réaliste, d'après une photo
de référence (labo de fabrication : murs blancs, établi, imprimantes à capot orange, bras d'aspiration,
panneau perforé, étagères, évier), visible tout autour de l'utilisateur.

- [x] `utils/lab-room.ts` : pièce 8,4 × 8,4 × 3 m construite une fois et fusionnée par matériau (≈ 11 draw
      calls) ; rien à moins de 2,4 m de l'utilisateur sous 2 m de haut (panneaux du studio libres) ; test.
- [x] `StudioRoom` (`xr-extract-studio.tsx`) : PBR mat éclairé par l'environnement du studio (part réduite,
      le modèle reste la vedette), ombres de contact, panneau perforé et enseigne en textures canvas
      (enseigne traduite : `vrLab.sign`).
- [ ] Casque : vérifier 72 Hz et le nombre de draw calls (`?perf=1`).

## VS-T51 — Modèle réaliste de bibliothèque dans le labo

Demande (2026-11-18) : montrer des modèles 3D réalistes. Un modèle généré ne peut pas égaler un modèle d'artiste ;
l'app propose donc, quand l'objet reconnu en a un, un modèle réaliste sous licence, présenté comme tel.

- [x] `lib/model-library.ts` : catalogue (canapé « Glam Velvet Sofa » © Wayfair, voiture « Car Concept »
      © Darmstadt Graphics Group, CC BY 4.0, Khronos glTF Sample Assets), correspondance EN/FR/MG ; test.
- [x] Labo VR : bouton « Realistic library model » ↔ « Back to the generated model » sous le socle, crédit et
      licence affichés avec le modèle (`library-model-3d.tsx`, `vrLab.library*`).
- [ ] Vues 2D rendues depuis le modèle de bibliothèque ; insertion du modèle de bibliothèque dans le village.

## VS-T52 — Réponses préparées réalistes (mode simulé) pour le canapé, la voiture et la maison

Demande (2026-11-18) : en démo hors ligne, les vues 2D et la 3D du canapé, de la voiture et de la maison doivent
ressembler aux objets de la photo 360°. Sans modèle Meta, ces trois objets répondent avec des dessins et un
modèle glTF faits dans Blender d'après la photo (réponses simulées, comme le reste du mode `mock`).

- [x] `video/blender/` (`make prepared-models`) : canapé baroque capitonné, break blanc, maison jaune aux portes
      bleues ; vues orthographiques sur le fond bleu pâle des dessins + GLB allégé → `public/models/prepared/<id>/`.
- [x] `tour-mock/prepared.ts` : dessins et `ObjectShape.modelUrl` de `hall-sofa`, `street-car-white`,
      `terrace-house` (mode simulé seulement, jamais d'une réponse Meta) ; test.
- [x] Labo VR et village : `GltfModel3D` affiche le modèle préparé (`PlacedModel.modelUrl`, palier haut ;
      le palier bas garde la recette) ; test.
- [ ] Outils de pièces du labo (sélection, taille, rayons X) sur un modèle préparé.
