# Immersion WebXR sur /village : Détection Spatiale dans les Airs & Tir/Génération 3D

> **Statut :** En production / Implémenté & Validé  
> **Cible :** Route `/village` (Village Studio / Vision Insert)  
> **Technologies :** WebXR, Three.js, React Three Fiber (R3F), Meta IWER 2.8.0 (Émulateur Quest 3), Web Audio API, `@mitsinjo/engine`  
> **Environnement de test :** Émulateur desktop (100 % sans casque via Play Mode) et casque physique Meta Quest (Quest 3 / 3S / Pro)

---

## 1. Résumé exécutif

| Question                                    | Statut           | Détails                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Est-ce techniquement possible ?**         | **OUI (Validé)** | L'ensemble du cycle (bouton 3D dans l'espace, capture, détection IA, raycast de tir laser, apparition procédurale 3D, raccordement au microgrid) s'appuie sur des technologies WebXR standardisées et fonctionne in-situ. |
| **Faisable avec l'émulateur seulement ?**   | **OUI à 100 %**  | Grâce au preset Meta Quest 3 de **Meta IWER 2.8.0** intégré dans le projet (`dev-xr-emulator.ts`), le déplacement, la visée laser et la gâchette se testent au clavier/souris sans casque physique.                       |
| **Mode hors-ligne / développement**         | **Garanti**      | Compatible avec `make dev-mock` : les détections et shapes 3D s'exécutent en local sans clé API externe requise.                                                                                                          |
| **Synchronisation simulation micro-réseau** | **Active**       | Les tirs en VR sur les appareils générés injectent/retirent dynamiquement les charges dans le moteur de calcul `@mitsinjo/engine` avec animation de conduit d'énergie 3D (`PowerConnectionBeam`).                         |

---

## 2. Parcours utilisateur & Cycle d'interaction

```mermaid
flowchart TD
    A["1. L'utilisateur clique sur 'Voir en VR' (/village)"] --> B["2. Entrée en session WebXR immersive-vr"]
    B --> C["3. Un bouton spatial flotte dans les airs ('Scanner la pièce')"]
    C --> D["4. Clic dans l'air (gâchette / pinch) → Capture & Analyse Vision"]
    D --> E["5. Des cibles holographiques 3D apparaissent autour des objets détectés"]
    E --> F["6. L'utilisateur vise l'objet dans la vidéo et tire (laser blaster)"]
    B --> F2["Raccourci : tirer sur un objet de la vidéo sans scan préalable"]
    F2 --> D
    F --> G["7. Impact lumineux + Audio FX → Génération procédurale du modèle 3D"]
    G --> H["8. L'objet 3D final apparaît et s'anime à l'emplacement exact dans la pièce"]
    H --> I["9. Deuxième tir : Raccordement au microgrid + Conduit d'énergie 3D + notice"]
```

---

## 3. Décomposition technique des phases & Checklists

### Phase 1 : Bouton spatial "dans les airs" (Diegetic Spatial UI)

- **Défi WebXR :** Les balises HTML standards du DOM (`<button>`, `<div>`, `<Html>` de Drei) ne sont pas projetées en stéréo dans le casque VR.
- **Architecture :**
  - Un composant 3D Three.js pur (`<SpatialAirButton />`) suspendu dans le champ de vision (coordonnées relatives tête : `[0, 1.45, -1.2]` m).
  - Plaque holographique translucide en verre sombre, bordure cyan brillante (`TOKEN_HEX.energyCyan`), pulsation lumineuse d'attente.
  - Interaction : survol par le pointeur laser du contrôleur XR, puis appui sur la gâchette (`selectstart`).
  - Synthétiseur audio Web Audio API pour le bip radar lors du scan.

#### Checklist Phase 1 :

- [x] Conteneur WebXR dédié (`VillageXRViewport`) avec cycle de vie `useWebXR`.
- [x] Détection et émulateur automatique Meta IWER 2.8.0 preset Quest 3.
- [x] Composant 3D `<SpatialAirButton />` flottant à hauteur d'yeux avec canvas texture 2D haute résolution.
- [x] États visuels : `idle`, `scanning` (radar rotatif), `completed`.
- [x] Effet audio procédural de chirp radar sans fichier externe (`xr-audio-fx.ts`).
- [x] Raycast interactif gâchette / souris (`selectstart`) sur le bouton spatial.

---

### Phase 2 : Détection en temps réel sans upload classique (Spatial Vision Pipeline)

- **Mécanismes de capture :**
  1. **En direct / Émulateur :** Capture vidéo live via `navigator.mediaDevices.getUserMedia({ video: true })` avec bascule automatique sur image d'échantillon `/samples/vision-room.jpg`.
  2. **Sur casque réel (Meta Quest Browser) :** Capture de l'environnement virtuel ou webcam USB/caméra autorisée.
- **Traitement & Réticules spatiaux :**
  - L'image capturée est envoyée à `POST /api/vision` (ou mockperception en `dev-mock`).
  - `spatial-projection.ts` projette chaque boîte 2D sur **l'écran webcam incurvé, à l'endroit où l'objet apparaît dans la vidéo** (géométrie partagée `webcam-screen.ts`) : le cadre holographique se pose sur l'objet vu depuis l'œil (25 cm devant l'écran), et le modèle 3D sort de l'image sur la même ligne de visée à 1,6 m de l'œil (côté max 0,9 m).
  - Cibles `<HoloDetectionTarget />` : cadre filaire cyan animé, étiquette textuelle billboard 3D (ex: _"Réfrigérateur · 180W"_), collider invisible.

#### Checklist Phase 2 :

- [x] Méthode `captureLiveOrSample()` combinant webcam locale et fallback `/samples/vision-room.jpg`.
- [x] Hook ou session de détection connectée à l'API de vision perception.
- [x] Algorithme de projection spatiale 2D $\rightarrow$ 3D (`spatial-projection.ts`) alignée sur l'objet dans la vidéo (`webcam-screen.ts`).
- [x] Composant `<HoloDetectionTarget />` avec double boîte filaire cyan, texture canvas billboard et gestion du hover.
- [x] Tests unitaires pour `spatial-projection.ts` et `<HoloDetectionTarget />`.

---

### Phase 3 : Visée & Tir sur l'objet ("Laser Blaster")

- **Mécanique de visée et visualisation corporelle :**
  - Contrôleur WebXR actif (`renderer.xr.getController(0)`) avec rayon laser continu visible en temps réel.
  - Modèle 3D de manette **Meta Quest Touch Controller** complet (manche, tête, anneau de suivi et gâchette index).
  - Modèle 3D de main **Hand Tracking 25 articulations** (poignet, paume, phalanges index, majeur, annulaire, auriculaire et pouce) s'adaptant dynamiquement au mode mains nues.
  - Réticule d'impact (pip dot) projeté à la distance exacte d'intersection avec les cibles.
  - Raycaster Three.js en boucle `useFrame` testant les intersections cibles.
  - Unprojection souris desktop intégrée (`_raycaster.setFromCamera`) pour viser et cliquer directement sur les boutons 3D sans casque.
- **Menu au poignet (VS-T13) :** à l'entrée, aucun panneau flottant. Un petit bouton (Ø 4,4 cm, étiquette « Menu » / « Fermer »)
  est porté sur le poignet gauche (joint `wrist` en suivi des mains, poignée gauche avec manettes ; sans entrée gauche
  suivie, en bas à gauche de la vue). Le doigt de l'autre main, le laser, le pincement ou la souris l'ouvre / le ferme.
  Le menu (bouton de scan, guide, « Fermer ») apparaît à 0,9 m devant, 32 cm sous les yeux, dans le monde (règle Meta : menu
  lancé _depuis_ le poignet, jamais accroché au poignet ; ≥ 0,8 m pour le rayon) et **suit la personne en différé**
  (`wrist-menu.ts`, `updateLazyFollow`) : il reste immobile, puis se recentre en douceur si l'on tourne la tête
  de plus de ~35° ou si l'on s'éloigne de plus de 35 cm. Fermé, le bouton pulse en orange à chaque nouvel événement.
- **Source d'entrée unique :** `XRBlasterController` gère manettes, mains, doigt et souris. Les composants (bouton, cibles, panneaux) n'ont plus de `onClick` R3F propre (un clic tirait deux fois).
- **Visée sur la vidéo :** le rayon coupe l'écran webcam → point image $(u, v)$ → la plus petite boîte de détection qui le contient (une prise sur une table gagne sur la table). Hors de toute boîte : avant tout scan, le tir lance le scan puis transforme en 3D l'objet sous ce point ; après un scan, notification « Aucun objet détecté à cet endroit ».
- **Action de tir :**
  - Un tir par appui : `selectstart` seulement (gâchette, ou pincement natif des mains). Le rayon des mains est celui du système (`getController(i)`), pas un rayon poignet → index ; plus de détection de pincement maison (elle doublait le tir).
  - Flash blanc, onde de choc circulaire cyan, retour haptique `hapticActuators.pulse()` sur la manette qui a tiré.
  - Sons synthétisés procéduraux pour le tir et l'impact (`playLaserShootSound()`, `playTargetHitSound()`).

#### Checklist Phase 3 :

- [x] Contrôleur `<XRBlasterController />` avec rayon laser continu et reticule d'impact dynamique.
- [x] Modèle 3D complet de manette Touch (`createControllerGripModel()`) et main articulée 25 articulations (`createHandMesh()`).
- [x] Support unprojecté direct à la souris pour navigation desktop sur écran plat.
- [x] Détection des intersections temps réel via `THREE.Raycaster`.
- [x] Effets de tir : décharge de projectile, onde de choc sphérique et flash lumineux.
- [x] Effets sonores procéduraux Web Audio API (`playLaserShootSound`, `playTargetHitSound`).
- [x] Impulsion haptique sur contrôleur XR physique (`gamepad.hapticActuators`).
- [x] Tests unitaires pour le contrôleur blaster et les effets audio.

---

### Phase 4 : Génération et apparition du modèle 3D in-situ (Spawn & Morphing)

- **Appel de génération :**
  - Génération de géométrie procédurale via `recipeMesh` / `silhouetteMesh` (`object-geometry.ts`) à l'échelle de la scène.
- **Miniature 3D à portée de main (VS-T12) :**
  - Le modèle sort de l'objet dans la vidéo et vole en 0,7 s jusqu'à un socle devant l'utilisateur
    (`miniatureSlot` dans `xr-layout.ts` : ~0,55 m, sous les yeux, à droite puis à gauche, 6 par rangée).
  - Miniature de 22 cm (plus grand côté, proportions gardées), anneau de socle cyan / vert si raccordée.
  - Elle tourne seule (`turntable.ts`, ~12 s par tour) ; pas d'ombre de contact (cible de rendu en plus = FFR/MSAA cassés).
- **Manipulation (spécs « grab » Meta : objet laissé en place, cinématique, un seul geste « select ») :**
  - Gâchette, pincement ou clic **maintenu** sur la miniature → prise ; tourner / déplacer la manette ou la main
    (ou glisser la souris) la fait tourner (lacet + inclinaison ≤ 60°) ; relâcher → elle reprend sa rotation après 1,5 s.
  - **Tap** (relâché sans rotation, < 0,15 rad, en moins de 1,2 s) → raccorde / déconnecte l'appareil.
  - Un pincement la main posée sur la miniature (origine du rayon dedans) la saisit aussi.
  - Carte au-dessus (VS-T32, `miniature-label.tsx`) : nom, état (raccordée ou non), aide « Gâchette : raccorder /
    débrancher · Grip : tourner », et « Ranger » qui enlève la miniature (la simulation ne change pas). Une notice
    le dit aussi quand elle apparaît (en sortant du labo).

#### Checklist Phase 4 :

- [x] Composant `<SpawnedObject3D />` liant les recettes d'archetypes (`ObjectRecipe`).
- [x] Séquence temporelle élastique de matérialisation in-situ.
- [x] Anneau d'aura émissif au socle (plus d'ombres de contact en XR).
- [x] Miniature tournante à portée de main, saisie et rotation manette / main / souris, tap = raccorder.
- [x] Maintien de l'ancrage spatial et interaction continue avec le blaster.
- [x] Tests de rendu et de mise à l'échelle pour objets multiples.

---

### Phase 5 : Raccordement au Réseau dans les Airs (In-Air Grid Connect & Power Beams)

- **Interaction de raccordement en VR :**
  - Tirer sur un objet 3D déjà matérialisé bascule son état de raccordement électrique sans quitter la VR.
  - Étiquette holographique dynamique : _« ⚡ Visez et tirez pour raccorder (+180 W) »_ / _« ⚡ Visez et tirez pour déconnecter »_.
- **Conduit d'énergie 3D & Jumeau numérique :**
  - Conduit d'énergie en tube Catmull-Rom (`<PowerConnectionBeam />`) avec impulse lumineuse le long du câble vers le centre du village.
  - Synchronisation en direct avec le moteur `@mitsinjo/engine` (`useSimulationAppliances().upsert()`) et `usePlacedModelsStore`.
  - Sons procéduraux de connexion / déconnexion au réseau (`playGridConnectSound()`, `playGridDisconnectSound()`).

#### Checklist Phase 5 :

- [x] Bascule d'état connecté / déconnecté par tir laser sur l'objet matérialisé.
- [x] Texture holographique interactive indiquant le wattage et l'action de raccordement.
- [x] Câble d'énergie 3D courbe `<PowerConnectionBeam />` avec matériau émissif animé.
- [x] Synchronisation avec les stores de simulation (`useSimulationAppliances`, `usePlacedModelsStore`).
- [x] Effets sonores de connexion et déconnexion électrique.
- [x] Parité i18n 100 % sur `en.json`, `fr.json`, `mg.json` (`make check-i18n`).

---

### Phase 6 : Tableau de bord HUD Holo dans les Airs (Diegetic In-Air Telemetry HUD)

> Retiré en VS-T32 : plus de HUD dans le menu ; une notice (`XrEventToast`) affiche les événements quelques secondes.

- **Vision :** Afficher un tableau de bord holographique flottant dans le champ de vision périphérique (`[-1.25, 1.55, -1.4]` m), orienté vers le joueur, affichant en temps réel les données de la simulation du micro-réseau sans quitter la VR :
  - Niveau de batterie (%) avec barre de jauge lumineuse et indicateur de charge/décharge.
  - Production solaire instantanée (kW).
  - Charge totale demandée (kW) et équilibre net.
  - Compteur d'appareils raccordés in-situ.
  - Notification transitoire lors du tir de raccordement (ex: _« +180 W · Réfrigérateur raccordé »_).
  - Bouton interactif pour réduire / développer le HUD.

#### Checklist Phase 6 :

- [x] Créer le composant 3D `<VillageSpatialHUD />` (`features/vision-insert/ui/xr/village-spatial-hud.tsx`).
- [x] Créer le générateur de texture canvas haute résolution pour le HUD (`spatial-hud-texture.ts`).
- [x] Connecter le HUD aux données en direct du microgrid (`useSimulationStore`).
- [x] Afficher les jauges d'énergie (Batterie %, Solaire kW, Demande kW, Bilan Net).
- [x] Afficher un toast/badge d'impact électrique transitoire lors de l'ajout/retrait d'un équipement.
- [x] Ajouter les clés de traduction i18n en FR, EN et MG avec vérification `make check-i18n`.
- [x] Tests unitaires Vitest pour le HUD et sa texture.

---

### Phase 7 : Audio spatial 3D & Contrôles Avancés (Spatial Panner & Haptics)

- **Vision :** Spatialiser l'audio Web Audio avec `PannerNode` ou `THREE.PositionalAudio` pour localiser précisément les bruits de tir, d'impact et de bourdonnement électrique dans l'espace 3D selon la position relative de l'écouteur.

#### Checklist Phase 7 :

- [ ] Associer l'écouteur audio Web Audio à la caméra WebXR (`camera.matrixWorld`).
- [ ] Spatialiser les sons de tir et d'impact avec des coordonnées 3D réelles `[x, y, z]`.
- [ ] Ajouter une boucle sonore d'énergie douce (hum électrique) le long du faisceau `<PowerConnectionBeam />`.
- [ ] Tests unitaires et validation audio.

---

### Phase 8 : Écran Panoramique Studio à Focus Plat & Prévention du Vertige (Anti-Vertigo Planar Cinema Screen)

- **Vision :** Afficher le décor d'atelier et la webcam sans déformation sphérique pour éliminer les nausées de mouvement et le conflit vestibulaire :
  - **Géométrie actuelle (`WEBCAM_SCREEN`, VS-T14) :** écran **plat** (`ImageSurface` : centre, axes droite/haut, largeur, hauteur), 4,2 m de haut (16:9), centre à 2,6 m devant, **bord bas posé au sol**. L'ancien écran courbe (rayon 8,5 m) déformait la vidéo en cylindre ; `screenHitFromRay` est maintenant une intersection rayon-plan. Le menu du poignet (bouton de scan, guide, HUD) s'ouvre sous la ligne des yeux à 0,9 m et la pastille caméra est à ~1 m (`xr-layout.ts`) : le centre de la vidéo reste dégagé.
  - _Historique —_ **Focus central plat ($R = 11{,}5\text{ m}$) :** Courbure géante centrée à $4{,}2\text{ m}$ devant le regard. La flèche de courbure sur les $6\text{ m}$ centraux est $< 38\text{ cm}$, offrant une vue optiquement 100 % plane où les lignes horizontales ne sont pas déformées en œil de poisson.
  - **Grand angle panoramique étendu ($153^\circ$) :** Arc horizontal de $153^\circ$ (`thetaLength = Math.PI * 0.85`), permettant à l'utilisateur de tourner la tête librement de gauche à droite pour inspecter les cibles périphériques sans sentiment d'enfermement.
  - **Suppression du dôme sphérique 360° :** Remplacé par un mur architectural droit sombre (`name="studio-backdrop-wall"`, `<planeGeometry args={[26, 9]} />`) et un sol étendu stable (`circleGeometry args={[9, 48]}`), assurant un ancrage gravitationnel solide.
  - **Texture vidéo GPU directe & Fallback HD :** Utilise `THREE.VideoTexture` pour le flux matériel et fallback instantané sur `/samples/vision-room.jpg`.
  - **Capture d'image instantanée :** Enregistre la frame active au clic du bouton spatial pour analyse par perception IA.

#### Checklist Phase 8 :

- [x] Créer le composant `<LiveWebcamBackdrop />` (`features/vision-insert/ui/xr/live-webcam-backdrop.tsx`).
- [x] Focus central plan anti-vertige (rayon $11{,}5\text{ m}$, distance $4{,}2\text{ m}$, sagitta $< 38\text{ cm}$).
- [x] Grand angle horizontal étendu à $153^\circ$ pour balayage libre gauche/droite.
- [x] Élimination du dôme sphérique au profit d'un mur architectural droit (`#081022`) et sol stable.
- [x] Stream vidéo temps réel webcam via `THREE.VideoTexture` et fallback HD `/samples/vision-room.jpg`.
- [x] Capture instantanée du flux vidéo actif au clic du bouton spatial aérien.
- [x] Clés de traduction localisées (`vrLiveWebcam`, `vrVirtualRoom`, `vrCameraStandby`) avec parité 100 %.
- [x] Tests unitaires Vitest pour le backdrop webcam et la gestion du flux.

---

### Phase 9 : Espace de test 360° navigable (VS-T14, émulateur et PC)

- **Quand :** hors vrai casque (pas de session XR, ou émulateur IWER `isDevXREmulated()`), la webcam est remplacée par une visite de **6 pièces réelles** (photos équirectangulaires 4K, Poly Haven CC0, `public/tour/CREDITS.md`) : loft cuisine, hall, chambre, salle de bain, salon, séjour, reliées en boucle. Sur un vrai Quest, la webcam (écran plat) reste.
- **Rendu :** sphère r = 9 m centrée sur l'œil (`TOUR_EYE` 1,6 m), shader équirect (`tour/equirect.ts`, lacet 0 = −Z, u croît vers la droite), dessinée en dernier sans écriture de profondeur : panneaux, étiquettes et cibles ne sont jamais coupés. Pièce courante + voisines chargées, les autres libérées.
- **Dehors (VS-T15) :** par la fenêtre du hall (« Aller : Terrasse ») : terrasse avec champ de panneaux solaires, rue de maisons, façade de maison, jardin, allée d'arbres, forêt et sous-bois (7 lieux réels CC0, reliés en une promenade, `public/tour/outdoor/`). Maisons, voitures, arbres = décor (`kind: 'scenery'`, sans charge) ; panneaux solaires, lampadaire, applique = objets.
- **Marcher pour de vrai (VS-T16) :** photo « posée au sol » (shader : sol à 1,6 m sous l'œil + mur à 4 m dedans, 14 m dehors) : en s'éloignant du point de prise de vue, le sol glisse sous les pieds et le proche bouge plus que le lointain (parallaxe ; la tête dans le casque aussi). Maintenir ↑ / W / Z (S recule, A / Q / D de côté, flèches clavier) ou le stick = marche continue à 1,4 m/s dans la direction du regard, dans un disque de 2,1 m (4 m dehors). Clavier sur PC : seulement pointeur sur la scène (sinon la page défile) ; Play Mode de l'émulateur (pointeur verrouillé) : l'émulateur déplace lui-même le casque. Marcher sur une flèche au sol (ou la viser et tirer/cliquer : on y marche) = traverser : l'ancienne photo continue d'avancer pendant que la suivante arrive de derrière (fondu enchaîné 0,75 s, pas de noir). On arrive dos à la porte d'où l'on vient. Confort : vitesse constante, vignette pendant la marche (plus forte dans un vrai casque), balancement de tête seulement hors vrai casque. Les contours restent collés aux objets en marchant : ils sont posés sur la photo elle-même (`tour/grounded.ts` : même mur + sol que le shader, `PhotoAnchored` les décale de −offset), et la visée passe par `photoRay` (le rayon du monde → le point de la photo touché). Pas d'avancement (VS-T23) : `PhotoGround.step` (stick droit ↑/↓, geste de pouce) glisse de 0,8 m à 3,2 m/s. Limite : la photo s'étire si l'on va loin du point (d'où le disque).
- **Regarder (PC sans session) :** glisser = tourner la tête (`OrbitControls`, pas de zoom/pan), boutons zoom = champ de vision 30–90°, clic sans glisser (≤ 6 px) = tir.
- **Scanner (VS-T18) :** bouton en l'air, A/X ou tap du pouce → une **bande équirectangulaire 180° × 112,5°** (2048×1280, 16:10, `captureViewAt` `projection: 'equirect'`, lacet / tangage linéaires) centrée sur la visée : toute la partie visible est analysée d'un coup. Les cibles sont posées sur une sphère de 3 m (`surfaceFromStrip`, `ImageSurface.strip`) puis projetées au sol de la photo (`spatial-projection` option `ground`). Le contour SAM couvre l'objet entier (un canapé à moitié dans la bande est contouré en entier). Un objet tiré avant le scan est résolu à la fin du scan.
- **Vérité terrain hors ligne :** chaque pièce porte des objets délimités à la main sur la photo (`tour-data.ts`) ; `tourExpectedDetections` les projette dans la photo du scan et les envoie dans `expected` à `/api/vision` (mock seulement).
- **Page web masquée en immersion émulée :** `markEmulatedImmersion` pose `data-xr-emulated` sur `<html>` ; `[data-app-root]` passe en `visibility: hidden` sauf le canvas. Le bouton « Quitter l'immersion VR » reste visible en haut à droite (`EmulatedXRExit`, porté sur `<body>` au-dessus de la couche plein écran d'IWER, z 999).
- **Panneaux de l'émulateur :** l'overlay DevUI s'installe par `device.installDevUI(DevUI)` (pas `new DevUI(device)` : IWER ne monte alors jamais les panneaux Controller [L]/[R], Play Mode, gizmos). Installation unique partagée par les appels concurrents (effets React doublés en dev).

## 4. Commandes (VS-T23) et extraction 3D

Tableaux complets (manettes, mains, PC) : [`vr-immersion-guide.md` § 6](vr-immersion-guide.md) ; outils de
l'émulateur : [`vr-iwer-tools.md`](vr-iwer-tools.md).

- **Carte unique** (`xr-controls.ts`, lue chaque image par `XrControlsDriver`, fronts montants seulement) :
  gâchette / pincement = valider · grip = attraper · stick gauche = marcher · stick droit ←/→ = pivot 30°
  (`xr-rig.ts`, `getOffsetReferenceSpace` autour de la tête), ↑/↓ = pas de 0,8 m · A/X = analyser · B/Y = retour
  (annuler le dialogue, quitter le labo, sinon menu) · clic de stick = légendes. Mains : microgestes de pouce
  (← / → pivot, avant / arrière pas, tap analyser) quand le navigateur les expose.
- **Aide visible** : bulle ambre au bout du laser (`xr-aim-hint.ts` + `XrAimHint`, ce que fera la validation,
  texte redessiné seulement si la cible change) et carte légende sur chaque manette / main (`XrControlLegend`,
  attachée à `getControllerGrip(i)`, affichée 25 s à l'entrée).
- **Panneaux** (`holo-panel.ts`) : un bouton tape toujours ; un panneau glissable ne devient glisser qu'au-delà
  de 4° de rotation nette depuis l'appui (le tremblement de la main ne mange plus les clics « Extraire » /
  « Annuler »). Fond sombre opaque derrière chaque cadre (`HoloFrame backplate`), étiquettes masquées pendant
  un dialogue.
- **Extraction** : tir sur un objet → « Extraire en 3D ? » → vues 2D en carrousel → construction → labo 3D
  (VS-T19 → T22, `docs/tasks/VR-village-spatial-shoot.md`).
- **Chat IA des vues 2D** (VS-T27, `holo-face-chat.tsx`) : à gauche du carrousel (miroir de la colonne de
  génération, ~1,4 m), l'historique de la vue en focus (opérateur cyan, bot IA violet, libellé « MODIF. IA »),
  un champ écrit au clavier holo (`utils/xr-keyboard.ts` : un seul plan, touche lue sur l'UV du rayon, AZERTY
  en français, touche survolée surlignée sans redessin) ou à la voix (`use-voice-input.ts`, Web Speech API ;
  sans elle, Quest Browser : clavier système WebXR et sa dictée, `use-system-keyboard.ts`), puis « Envoyer ».
  Envoyer = redessiner cette vue avec la demande comme détails (même appel que le panneau 2D web) ; le bot
  répond par l'état du dessin (`utils/face-chat.ts`, réponse seulement après avoir vu la vue se redessiner),
  jamais un texte inventé. Une seule demande à la fois (aucune pendant qu'une vue se dessine). Tête de maki
  robot en haut à droite (`lemur-bot.tsx`, ~11 draw calls) : suit le curseur du laser (yeux puis tête,
  bornés), cligne des yeux sur un rythme fixe (`utils/lemur-bot.ts`), antenne en queue annelée ambre qui
  pulse pendant un dessin.
- **Hologramme du village dans le labo** (VS-T28, `holo-village-table.tsx`) : à droite des outils, une table
  ronde du cœur du village (30 unités, `utils/village-holo.ts`) inclinée vers l'utilisateur : chemins, étang,
  bâtiments (un `InstancedMesh`), objets déjà placés (points ambre). Viser la table + gâchette pose l'objet
  (point lu sur l'UV du disque, puis le placement de la page : sur le terrain, hors bâtiments / chemins,
  départ le plus proche) avec son câble de dérivation (`tapPoint`) ; « Insérer dans la simulation » = le même
  appel que le panneau web (`hooks/use-appliance-insert.ts` : ligne + modèle 3D édité, moteur relancé) ;
  « Aller à la simulation » demande l'entrée VR à `/simulation` (`microgrid-3d/utils/xr-handoff.ts`, en
  mémoire), termine la session XR puis ouvre `/simulation` : la vue 3D ouvre sa session seule et place
  l'utilisateur à 2,5 m de l'objet ajouté, côté centre du village, face à lui (`standNear`). Un casque qui
  refuse une session sans nouveau geste garde la demande : « Voir en VR » arrive alors au même endroit.
  Titre, état et boutons de la table sont debout au-dessus de son bord éloigné, à hauteur des yeux (VS-T29).
- **Lisibilité des panneaux** (VS-T29) : tailles de texte en dmm (1 dmm = 1 mm vu à 1 m ; Meta : 14 px
  minimum, 18 px confortable) converties en px de canevas pour la largeur du plan et la distance de lecture
  (`holoTextPx`, `HOLO_TEXT_DMM` : titre 30, libellé 24, texte 20, légende 16). `HoloButton` : icône en
  traits (`holo-icons.ts`, pas d'emoji) et, au survol, une bulle au-dessus qui répète le libellé en grand avec
  ce que fait le bouton (`tip`). Chat : boutons « Clavier » · « Dicter » · « Envoyer » avec icônes ; pendant
  la dictée, un graphe « Niveau de voix » dans le champ (`holo-voice-meter.tsx` : 28 barres d'un
  `InstancedMesh` sur les bandes du spectre du copilote, `lib/voice-analyser.ts` partagé avec le copilote).
- **Mains, manettes et lasers** (VS-T30, toutes les immersions) : les modèles de mains et de manettes
  (vrais modèles et substituts) sont sur leur propre calque de rendu (`XR_INPUT_LAYER`,
  `microgrid-3d/utils/xr-inputs-shown.ts`) ; `XrInputsLayer`, monté dans les deux canevas, l'allume ou
  l'éteint d'après le choix « mains et manettes » (stick maintenu 0,8 s, ou Menu › « Masquer mains et
  manettes » sur /village ; gardé dans le navigateur), et rapproche le plan proche à 5 cm pendant la session
  (celui de /simulation, 0,5 m, coupait les manettes à ~0,45 m des yeux : elles étaient invisibles). Un clic
  court sur le stick bascule toujours l'aide, au relâchement. Les lasers restent affichés et changent de
  couleur selon ce qui les entoure (`xr-ray-contrast.ts`) : couleur de la première surface touchée (matière ×
  texture au point touché, + émissif) ou du ciel, échantillonnée toutes les 4 images ; clair sur fond sombre,
  bleu nuit sur fond clair, avec un halo du ton opposé autour du faisceau et de l'anneau.

## 5. Architecture des fichiers & Modules

| Composant / Fichier             | Responsabilité                                                                                     | État |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| `village-xr-viewport.tsx`       | Conteneur plein écran R3F avec `renderer.xr.enabled = true`, frameloop adaptatif et rig caméra.    | [x]  |
| `village-xr-studio.tsx`         | Scène d'atelier 3D, orchestration de session, gestion des objets et liaison `@mitsinjo/engine`.    | [x]  |
| `spatial-air-button.tsx`        | Bouton 3D flottant avec pulsation lumineuse et texture interactive pour scanner.                   | [x]  |
| `spatial-air-button-texture.ts` | Générateur de texture canvas 2D haute résolution pour le bouton de scan spatial.                   | [x]  |
| `webcam-screen.ts`              | Géométrie de l'écran webcam : point 3D d'un pixel, pixel visé par un rayon, cible sous un pixel.   | [x]  |
| `xr-layout.ts`                  | Positions des panneaux dans le casque (contenu du menu, pastille caméra, socles miniatures).       | [x]  |
| `wrist-menu.ts`                 | Menu du poignet : état partagé, placement du bouton (main / manette / vue), suivi différé du menu. | [x]  |
| `xr-wrist-menu.tsx`             | Bouton du poignet (icône + étiquette) et panneau du menu qui suit l'utilisateur.                   | [x]  |
| `spatial-projection.ts`         | Algorithme de projection des boîtes 2D normalisées en coordonnées sphériques/arc 3D.               | [x]  |
| `holo-detection-target.tsx`     | Cible holographique 3D réactive au tir, avec texture billboard et mode raccordement.               | [x]  |
| `tour/grounded.ts`              | Photo posée au sol (`PhotoGround`) : point d'une direction, rayon du monde → point de la photo.    | [x]  |
| `tour/photo-anchored.tsx`       | Groupe qui suit la photo pendant la marche (contours fixes sur les objets).                        | [x]  |
| `xr-controls.ts`                | Carte des boutons / sticks / microgestes → actions (pivot, pas, analyser, retour, aide).           | [x]  |
| `xr-controls-driver.tsx`        | Lit les entrées XR chaque image et transmet les actions au studio.                                 | [x]  |
| `xr-rig.ts`                     | Pivot par paliers autour de la tête (espace de référence décalé).                                  | [x]  |
| `xr-aim-hint.ts`                | Texte « Gâchette · Extraire … » selon ce qui est visé et l'entrée.                                 | [x]  |
| `xr-control-hints.tsx`          | Bulle au bout du laser + cartes légende sur manettes / mains.                                      | [x]  |
| `holo-face-chat.tsx`            | Chat IA de la vue 2D en focus : historique, clavier holo, voix, « Envoyer », tête de maki-bot.     | [x]  |
| `holo-village-table.tsx`        | Table hologramme du village dans le labo : poser l'objet, l'insérer, aller à la simulation.        | [x]  |
| `lemur-bot.tsx`                 | Tête de maki robot : suit le curseur, cligne des yeux, antenne qui pulse pendant un dessin.        | [x]  |
| `holo-panel.ts`                 | Registre des panneaux holographiques : survol, tap, glisser (seuil 4°).                            | [x]  |
| `xr-blaster-controller.tsx`     | Rayon laser continu, réticule d'impact, raycast d'intersections et décharges de tir à la gâchette. | [x]  |
| `xr-audio-fx.ts`                | Synthétiseur procédural Web Audio API (tir, impact, radar, connexion/déconnexion réseau).          | [x]  |
| `spawned-object-3d.tsx`         | Miniature 3D : vol depuis la vidéo vers son socle, rotation auto, agrandie au survol / en main.    | [x]  |
| `turntable.ts`                  | État de rotation d'une miniature : rotation auto, prise, rotation, tap ou glissé au relâcher.      | [x]  |
| `power-connection-beam.tsx`     | Conduit d'énergie 3D courbe en tube Catmull-Rom reliant l'appareil au microgrid du village.        | [x]  |
| `village-spatial-hud.tsx`       | Tableau de bord télémétrique holographique flottant (Batterie, Solaire, Demande, Alertes).         | [x]  |
| `spatial-hud-texture.ts`        | Générateur de texture canvas pour le tableau de bord holographique dans les airs.                  | [x]  |
| `live-webcam-backdrop.tsx`      | Écran panoramique incurvé webcam live, atmosphère 360° et capture instantanée.                     | [x]  |

---

## 6. Vérifications et critères de succès

Vérification automatique dans l'émulateur (serveur dev lancé, ffmpeg requis) : `make vr-probe` (parcours complet, dont la marche avec contours fixes et l'extraction) et `make vr-iwer-tools` (outils IWER + commandes VS-T23) (webcam simulée = pièce d'exemple ; tir manette sur le frigo sans scan, raccordement, pincement main sur le ventilateur, manette gauche sur la TV ; captures dans `test-results/vr-probe/`). En dev, l'appareil IWER est exposé sur `window.__IWER_DEVICE__` (`remote.dispatch`, comme l'IWER MCP).

- [x] `make dev-mock` permet d'entrer en VR sur `/village` via l'émulateur IWER sans erreur console.
- [x] Le bouton 3D « Scanner la pièce » flotte dans le champ de vision et réagit au survol du curseur.
- [x] Le clic déclenche la détection et fait apparaître les cibles holographiques 3D dans l'espace.
- [x] Le rayon laser continu suit les mouvements de la manette/souris, avec réticule d'impact dynamique.
- [x] Tirer sur une cible détruit le réticule, émet un effet sonore et fait apparaître le modèle 3D animé in-situ.
- [x] Tirer sur un modèle 3D matérialisé le raccorde ou le déconnecte du microgrid avec conduit d'énergie 3D dynamique.
- [x] Tableau de bord diégétique HUD holographique flottant affichant en temps réel batterie, solaire, demande et notifications.
- [x] Les charges sont automatiquement répercutées dans la simulation `@mitsinjo/engine`.
- [x] Quitter la session VR restaure proprement la page 2D sans fuite de contexte WebGL ni erreur console.
- [x] `make check-i18n` passe à 100 % (EN, FR, MG).
- [x] 40/40 suites de tests vision-insert et 27/27 suites engine sont au vert.
