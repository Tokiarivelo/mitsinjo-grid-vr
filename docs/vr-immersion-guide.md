# Guide d'immersion VR & 3D — Mitsinjo Grid

Guide complet pour lancer, afficher en plein écran, contrôler et explorer l'immersion WebXR sur `/simulation` (village 3D du micro-réseau solaire), **sur PC sans casque (émulation)** ou **dans un casque VR autonome (Meta Quest)**.

> **Tâche associée :** `docs/tasks/VR-village-view.md` · **Guide de test & CI :** `docs/vr-testing-guide.md` · **Scénarios manuels :** `test-scenarios/02-simulation.md` (S119–S123).

---

## 1. Pourquoi l'immersion apparaît dans un « petit modal au centre » et comment l'afficher en vrai plein écran ?

Si en lançant la VR vous voyez la scène confinée dans une petite boîte ou un modal au centre de votre écran, cela s'explique par deux réglages très simples :

### Passage automatique en plein écran dès le clic VR

Désormais, **dès que vous cliquez sur le bouton « Voir en VR »**, l'application active automatiquement le mode plein écran pour que le village 3D remplisse 100 % de votre écran. Lorsque vous quittez la session VR (bouton « Quitter la VR » ou geste système du casque), l'application quitte automatiquement le plein écran et restaure l'affichage normal de la page.

Vous pouvez toujours basculer le plein écran manuellement à tout moment grâce au bouton **« Plein écran »** (icône rectangle d'agrandissement à côté des lunettes).

### Cause 2 : L'overlay de prévisualisation de l'émulateur Meta IWER (sur PC)

En mode développement desktop, Mitsinjo Grid charge automatiquement l'émulateur **Meta IWER DevUI** (`@iwer/devui`). Cet émulateur ouvre un panneau de contrôle flottant et une fenêtre miroir rectangulaire (« Headset Viewport ») au centre :

- Vous pouvez redimensionner cette fenêtre miroir en tirant ses coins ou masquer les panneaux latéraux d'outils.
- Vous pouvez basculer votre navigateur en plein écran complet avec la touche **`F11`** de votre clavier.

### Dans un vrai casque VR (Meta Quest 2 / 3 / Pro)

Dans le casque via Meta Quest Browser, **il n'y a aucun modal ni encadrement** : dès que vous cliquez sur le bouton « Voir en VR », le navigateur cède la place à un environnement virtuel **à 360° stéréoscopique à l'échelle 1:1**, vous plaçant directement au niveau du sol au cœur du village.

---

## 2. Échelle humaine 1:1, Point de spawn et Confort vestibulaire

### Échelle 1:1 vs Vue Diorama

Dans Three.js et l'API WebXR :

- **1 unité 3D = 1 mètre physique réel.**
- Les cases traditionnelles mesurent environ **3 à 4 mètres** de haut.
- Les étals du marché mesurent **2,5 mètres**.
- Les acacias et ravenalas mesurent **6 à 10 mètres**.
- Le conteneur de batterie BESS et le shelter du contrôleur mesurent **2,8 mètres**.

Lorsqu'un casque WebXR initialise l'espace `'local-floor'`, la hauteur du sol physique de l'utilisateur correspond au niveau de référence du rig. Vos yeux sont automatiquement placés à votre hauteur naturelle debout (généralement **1,65 m à 1,75 m** au-dessus du sol).

> [!NOTE]
> **Pourquoi le point de vue initial semblait-il gigantesque ?**  
> Initialement, le point d'entrée VR était positionné à $Y = 20\text{ m}$ (vue diorama aérienne), plaçant la tête à plus de 21 mètres d'altitude, soit la hauteur d'un immeuble de 7 étages !  
> Désormais, le point de spawn immersif vous place **au niveau du sol du village ($Y = 0$) sur l'allée centrale**, avec les cases, les étals et les équipements à taille humaine 1:1 tout autour de vous.

### Horizon plat et prévention du vertige (Règle d'or VR)

- L'axe vertical du rig de la caméra est **strictement aligné sur le vecteur de gravité $(0, 1, 0)$** avec un roulis (_roll_) et un tangage (_pitch_) verrouillés à $0^\circ$.
- Lorsque vous tournez la souris ou la tête à 360°, **l'horizon et le sol restent 100 % plats**. Il n'y a plus aucun basculement latéral (_Dutch tilt_), éliminant tout conflit visuo-vestibulaire et prévenant les vertiges et nausées.

---

## 3. Comment contrôler l'immersion (Marcher, Regarder, Utiliser les mains et manettes)

### Comprendre l'émulateur Meta IWER DevUI (sur PC)

Lorsque vous lancez l'immersion sur PC sans casque physique, l'émulateur **Meta IWER DevUI** affiche plusieurs éléments interactifs :

1. **Les fenêtres `Hand [L]` et `Hand [R]` / `Controller [L]` et `Controller [R]` :**
   - Ces panneaux permettent de simuler les mains ou les manettes physiques Meta Quest.
   - Les repères 3D au centre de votre vision (axes rouge = $X$, vert = $Y$, bleu = $Z$ et cubes transparents) représentent les positions des mains dans l'espace virtuel.
   - Vous pouvez basculer entre le mode Mains nues (_Hand Tracking_) et le mode Manettes (_Touch Controllers_) via les icônes de la barre d'outils supérieure de l'émulateur.

2. **Marcher dans le village (Système de Locomotion) :**
   Vous pouvez vous déplacer librement à pied sur les chemins de terre rouge du village :
   - **Au clavier (PC) :**
     - **Avancer :** Touche **`Z`** (clavier français AZERTY) ou **`W`** (clavier QWERTY) ou **`Flèche Haut`**.
     - **Reculer :** Touche **`S`** ou **`Flèche Bas`**.
     - **Pas latéral gauche (Strafe) :** Touche **`Q`** (AZERTY) ou **`A`** (QWERTY) ou **`Flèche Gauche`**.
     - **Pas latéral droite :** Touche **`D`** ou **`Flèche Droite`**.
     - **Courir / Vitesse accélérée :** Maintenir la touche **`Shift`**.
   - **Aux manettes VR / Joysticks de l'émulateur :**
     - **Joystick Gauche (Stick [L]) :** Pousser vers le haut pour avancer, vers le bas pour reculer, vers les côtés pour le pas latéral.
     - **Joystick Droit (Stick [R]) :** Rotation horizontale fluide ou par paliers.
   - **Suivi automatique du relief :** Pendant votre marche, vos pieds restent automatiquement collés au relief du sol (`terrainHeight`), que vous marchiez sur la place plate ou montiez vers les collines boisées.

3. **Orienter le regard (Tourner la tête) :**
   - **Sur PC :** Cliquez dans la vue 3D avec le bouton gauche de la souris et glissez pour orienter la tête à 360°.
   - **Dans un casque VR :** Tournez simplement la tête dans la vraie vie.

---

## 4. Ce que vous pouvez tester et observer dans l'immersion 3D

La scène 3D de Mitsinjo Grid n'est pas un simple décor statique : elle est reliée directement aux calculs physiques du moteur `@mitsinjo/engine`. Voici tout ce que vous pouvez explorer :

### 1. Le flux des électrons en temps réel (Lignes de distribution)

- Approchez-vous des poteaux électriques et des lignes aériennes reliant la station centrale aux différents quartiers.
- **Particules lumineuses en mouvement :** Des impulsions d'électrons circulent visuellement le long des câbles.
- **Vitesse et intensité proportionnelles :** Plus un secteur consomme de kilowatts (kW), plus les particules circulent vite et brillent intensément. Si un secteur est coupé, la ligne s'éteint et le flux s'arrête net.

### 2. Le générateur photovoltaïque (`SolarArray`) et la chute solaire

- Déplacez-vous jusqu'au champ de panneaux solaires inclinés.
- Admirez les matériaux réalistes antireflet et les ombres portées douces sur le sol latéritique rouge.
- **Test de la chute solaire (_Solar Drop_) :**
  - Déclenchez une chute d'ensoleillement (passage nuageux ou panne de string PV via la simulation).
  - Observez la chute de puissance affichée et le ralentissement immédiat du flux partant du champ solaire.

### 3. L'unité de stockage par batteries BESS (`BatteryUnit`)

- Rendez-vous devant l'abri conteneurisé des batteries de stockage.
- **Jauge LED de niveau de charge (SoC %) :**
  - **Vert fluo pulsé :** La batterie est en charge rapide pendant les pics de production solaire.
  - **Ambre / Orange :** La batterie prend le relais et se décharge pour alimenter le village (en soirée ou lors d'une chute solaire).
  - **Rouge clignotant :** Alerte critique, le niveau de charge passe sous le seuil de réserve vital (< 20 %).

### 4. Le Dispatch Controller central & EMS (`DispatchControllerUnit`)

- Inspectez le cœur névralgique du réseau : le shelter de distribution.
- Observez les départs des différents feeders vers les quartiers.
- **Indicateur de mode :** Visualisez si le réseau tourne sous arbitrage manuel ou sous **Dispatch Autonome IA (Mode PA)**.

### 5. La hiérarchie des secteurs et le délestage de charge

Baladez-vous dans les différents quartiers du village pour comparer leur statut :

- **Dispensaire / Maternité (Priorité P0 - Vitale) :** Bâtiment sanitaire prioritaire. Même lors des crises sévères, ses lampes restent allumées et sa ligne sous tension.
- **École primaire (P1) :** Éclairage et ventilation maintenus tant que la réserve moyenne le permet.
- **Marché communal & Artisans (P2) :** Déconnecté en premier en cas de déficit d'énergie prolongé.
- **Quartiers résidentiels (P3) :** Foyers villageois.
- **Comportement visuel du délestage :** Lorsqu'un secteur est délesté par l'algorithme, ses lampadaires s'éteignent, les toits s'assombrissent et la ligne d'alimentation correspondante s'arrête.

### 6. Effets d'urgence et départ d'incendie (`FireEffects`)

- Activez un scénario d'incident avec feu ou court-circuit.
- Observez les colonnes de fumée volumétrique et les flammes 3D dynamiques au-dessus du secteur touché.
- **Isolation d'urgence :** Constatez que l'EMS coupe instantanément l'alimentation du secteur en feu pour éviter tout arc électrique et protéger les secours.

### 7. Cycle Jour / Nuit et météo dynamique

- Faites avancer la timeline de 06:00 à 22:00 :
  - **Aube / Matin :** Lumière rasante dorée, brouillard matinal léger.
  - **Midi :** Soleil vertical intense, production solaire maximale, ombres courtes et nettes.
  - **Coucher de soleil (Sunset) :** Teintes orangées et pourpres sur les collines environnantes grâce au ciel HDRI dynamique.
  - **Nuit :** Tombée de l'obscurité, ciel étoilé, allumage automatique de la lueur des lampadaires (_lampGlow_) et des fenêtres des cases villageoises.
- **Conditions météo :** Pluie avec particules 3D tombantes, brume humide ou ciel limpide.

### 8. L'environnement rural malgache

- Observez les détails architecturaux traditionnels (cases sur pilotis, vérandas, toits en tôle et en chaume).
- Végétation locale générée de façon procédurale : **baobabs majestueux**, **arbres du voyageur (Ravenalas)**, acacias.
- Chemins en terre battue ocre, cours de village (_placed yards_), pirogues et véhicules de brousse.

### 9. Affichage télémétrique de performance VR

- Ajoutez le paramètre `?perf=1` à l'URL de votre navigateur (`http://localhost:3000/simulation?perf=1`).
- Un HUD compact s'affiche dans l'angle de la vue, indiquant les **FPS** (images par seconde), le nombre de **Draw Calls** et la géométrie active, vous permettant de surveiller la fluidité en temps réel.

---

## 5. Tableau récapitulatif des commandes

| Action souhaitée                    | Sur PC (Clavier / DevUI)                                           | Sur Casque VR (Meta Quest)                   |
| :---------------------------------- | :----------------------------------------------------------------- | :------------------------------------------- |
| **Passer en vrai plein écran**      | Bouton « Plein écran » HUD + touche `F11`                          | Automatique à 360° dans le casque            |
| **Lancer la session VR**            | Clic sur le bouton « Voir en VR » (lunettes)                       | Clic sur « Voir en VR » dans Quest Browser   |
| **Marcher / Avancer / Reculer**     | Touches **`Z` / `S`** (AZERTY) ou **`W` / `S`** (QWERTY) / Flèches | Pousser / tirer le joystick gauche           |
| **Pas latéraux (gauche/droite)**    | Touches **`Q` / `D`** (AZERTY) ou **`A` / `D`** (QWERTY)           | Déplacer le joystick gauche latéralement     |
| **Courir / Accélérer**              | Maintenir **`Shift`**                                              | Pousser le joystick à fond                   |
| **Tourner le regard**               | Déplacer la souris (clic gauche maintenu)                          | Tourner la tête librement à 360°             |
| **Viser un bouton / cible 3D**      | Survol direct à la souris OU visée laser IWER                      | Viser avec le faisceau laser cyan            |
| **Cliquer sur un bouton en l'air**  | Clic gauche souris OU `Alt` + Clic / `Espace` (IWER)               | Gâchette Index (Manette) ou Pincement (Main) |
| **Tirer sur une cible / Raccorder** | Clic gauche souris OU gâchette IWER                                | Gâchette Index (Manette) ou Pincement (Main) |
| **Quitter l'immersion VR**          | Clic sur **« Quitter la VR »**                                     | Bouton Oculus/Meta ou bouton Quitter         |

---

## 6. Interaction avec les boutons flottants dans les airs & Détection spatiale (`/village`)

Dans l'atelier immersif de détection spatiale (`/village`), l'interface utilisateur est entièrement **diégétique 3D** (flottante dans l'espace physique virtuel sans balise 2D HTML bloquée par le casque).

Voici les **4 modalités de contrôle** supportées selon votre équipement :

### 1. Meta Quest avec Manettes Touch (Touch Controllers)

- **Représentation visuelle :** La manette Touch droite/gauche apparaît dans votre main virtuelle sous forme d'un modèle 3D précis (anneau de suivi infrarouge, manche ergonomique, boutons primaires).
- **Visée :** Un faisceau laser continu cyan étincelant pointe depuis la tête de la manette vers l'avant, avec un réticule d'impact lumineux au point d'intersection.
- **Action de clic / Tir :** Pressez la **gâchette d'index** (_Index Trigger_) ou appuyez sur le **bouton A** (manette droite) / **bouton X** (manette gauche).
- **Retour sensoriel :** Une impulsion haptique vibrante (`gamepad.hapticActuators`) et un effet sonore spatialisé confirment l'activation.

### 2. Meta Quest avec Suivi des Mains (Hand Tracking / Mains nues)

- **Représentation visuelle :** Vos mains physiques réelles sont transposées dans la scène grâce à un squelette 3D articulé de **25 articulations** (poignet, paume, phalanges index, majeur, annulaire, auriculaire et pouce).
- **Visée :** Tendez votre index vers le bouton ou la cible flottante. Le faisceau laser cyan s'étire précisément depuis le bout de votre index.
- **Action de clic / Tir (Geste de pincement - Index Pinch) :** Joignez l'extrémité de votre pouce et de votre index dans les airs. Le geste est instantanément reconnu comme un `selectstart` WebXR et déclenche le scan ou le tir laser.

### 3. Navigateur PC avec l'Émulateur Meta Quest (IWER / DevUI)

- **Activation :** Ouvrez `/village` sur PC (l'émulateur Meta IWER 2.8.0 s'initialise automatiquement en mode développement). Cliquez sur **« Voir en VR »**.
- **Contrôle de la manette émulée :**
  - Maintenez la touche **`Alt`** du clavier pour orienter la **manette droite** avec votre souris.
  - Maintenez la touche **`Shift`** du clavier pour orienter la **manette gauche**.
  - Utilisez la **molette de la souris** pour avancer ou reculer la manette le long de l'axe de profondeur $Z$.
- **Action de clic / Tir :** Effectuez un **clic gauche de souris** ou appuyez sur la touche **`Espace`** pendant que le laser cible le bouton flottant « Scanner la pièce » ou une cible holographique.

### 4. Navigateur PC en Vue 3D classique (Hors VR ou Souris directe)

- **Visée directe à la souris :** Même sans casque VR ni manipulation des touches de manette IWER, déplacez simplement votre curseur de souris sur le bouton spatial flottant ou les cibles 3D.
- **Rétroaction immédiate :** Un raycaster unprojecte automatiquement la position de votre curseur depuis la caméra, mettant le bouton en surbrillance d'énergie.
- **Action de clic :** Un simple **clic gauche** sur le bouton flottant dans les airs lance immédiatement la détection visuelle.

---

## 7. Confort visuel et prévention du vertige : Écran panoramique à focus plat (`/village`)

### Pourquoi la vue sphérique provoquait-elle des vertiges ?

Lors des premières itérations de l'immersion webcam, la projection du décor s'appuyait sur un dôme sphérique complet à 360° (`sphereGeometry`) ou sur un cylindre refermé à petit rayon ($R = 4{,}8\text{ m}$, arc de $270^\circ$).  
Cette géométrie générait deux effets néfastes majeurs pour le système vestibulaire humain :

1. **Distorsion en œil de poisson (_Fish-Eye Warping_) :** Les lignes horizontales droites de la pièce physique (bureau, murs, sol) étaient artificiellement courbées vers le haut ou le bas dès que la tête bougeait.
2. **Accélération angulaire non linéaire :** Lorsqu'un utilisateur tournait la tête, les pixels périphériques défilaient à une vitesse angulaire différente de celle du centre, créant un conflit neurosensoriel immédiat entre ce que voient les yeux et ce que ressent l'oreille interne (nausée cinétique ou _VR sickness_).

### La solution : Écran de cinéma panoramique à focus plat & grand angle

L'architecture du composant `<LiveWebcamBackdrop />` a été entièrement refondue pour éliminer tout vertige :

```
             Zone centrale plate (sagitta < 38 cm sur 6 m de large)
                     [ - - - - - - - ÉCRAN - - - - - - - ]
                               \               /
                                \  Arc 153°   /
                                 \           /
                                  \         /
                                   \       /
                                    [  O  ]   <-- Opérateur à Z = 0
                                 Distance 4.2m
                                Rayon R = 11.5m
```

1. **Focus central parfaitement plat ($R = 11{,}5\text{ m}$) :**
   - Le cylindre de projection possède un rayon de courbure géant de **11,5 mètres**, avec un centre reculé de telle sorte que le devant de l'écran se situe à **4,2 mètres** devant vos yeux.
   - Sur les **6 mètres de largeur centrale** de votre champ de vision, la flèche de courbure (sagitta) est inférieure à **38 cm**. Pour l'œil humain, cette zone est optiquement **100 % plane** : les lignes d'horizon restent parfaitement droites, éliminant toute sensation de tangage ou d'écrasement.
2. **Grand angle horizontal élargi ($153^\circ$) :**
   - L'écran s'étend sur un arc horizontal de **$153^\circ$** (`thetaLength = Math.PI * 0.85`), offrant une vision périphérique continue d'un bout à l'autre sans déformation.
   - L'opérateur peut tourner la tête librement de gauche à droite pour inspecter les cibles 3D latérales avec un repère spatial panoramique stable.
3. **Suppression du dôme sphérique d'enfermement :**
   - Le dôme sphérique à 360° est remplacé par un mur architectural droit sombre (`name="studio-backdrop-wall"`, `<planeGeometry args={[26, 9]} />`) et une plateforme circulaire au sol (`circleGeometry args={[9, 48]}`).
   - Le sol virtuel reste solidement ancré sous vos pieds, prévenant toute perte d'équilibre.

---

## 8. Dépannage rapide (FAQ)

| Problème rencontré                                          | Explication                                                                                           | Action corrective                                                                                                                                        |
| :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La scène reste dans une petite boîte centrale**           | Le mode plein écran automatique a été bloqué par la politique du navigateur (ex. iframe).             | Cliquez directement sur l'icône **« Plein écran »** dans la barre HUD en haut à droite du viewport 3D pour forcer le plein écran.                        |
| **Mes touches clavier ne font pas bouger la caméra**        | Le curseur n'est pas verrouillé dans le mode FPS.                                                     | Cliquez sur **Play Mode** dans l'overlay DevUI, puis cliquez dans la fenêtre 3D pour verrouiller le pointeur.                                            |
| **Le clavier avance de travers (clavier français AZERTY)**  | Les raccourcis par défaut de l'émulateur sont en QWERTY (WASD).                                       | Utilisez **W/A/S/D**, ou cliquez sur le menu de mapping clavier de DevUI pour réassigner **Z/Q/S/D**.                                                    |
| **Le bouton « Voir en VR » n'apparaît pas**                 | WebXR requiert obligatoirement un contexte sécurisé (`localhost` ou HTTPS).                           | Vérifiez que l'URL commence bien par `http://localhost:...` ou `https://...`. En HTTP avec une adresse IP locale, WebXR est désactivé par le navigateur. |
| **Écran noir ou figé après une modification de code (HMR)** | Le rechargement à chaud (Hot Module Replacement) réinitialise le contexte WebGL en pleine session XR. | Rafraîchissez simplement la page dans votre navigateur (`Ctrl + R` ou `F5`) et relancez la session VR.                                                   |
