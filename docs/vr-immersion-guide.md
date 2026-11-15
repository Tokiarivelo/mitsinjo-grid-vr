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

En mode développement desktop, Mitsinjo Grid installe automatiquement le runtime émulé **Meta IWER** au chargement de la page, et son overlay **DevUI** (`@iwer/devui`) au clic sur « Entrer en VR » seulement : la DevUI embarque son propre Three.js (0.184, l'app tourne en 0.174), et la charger avec chaque page 3D mettait deux Three.js dans le navigateur (« Multiple instances of Three.js being imported », plantages occasionnels de `/village`). Cet émulateur ouvre un panneau de contrôle flottant et une fenêtre miroir rectangulaire (« Headset Viewport ») au centre :

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

2. **Marcher dans le village (VSIM-T1/T2, mêmes commandes que `/village`) :**
   - **Manettes :** stick gauche = marcher dans la direction du regard ; stick droit ←/→ = pivoter de 30° d'un
     coup (autour de la tête, avec un petit son), ↑/↓ = un pas de 0,8 m. Plus de rotation continue (confort).
   - **Mains :** pouce glissé ←/→ = pivoter, avant / arrière = un pas.
   - **Clavier (PC) :** `Z`/`W`/`↑` avancer, `S`/`↓` reculer, `Q`/`A`/`←` et `D`/`→` de côté, `Shift` = courir.
   - **On ne traverse plus les objets :** maisons, école, clinique, troncs d'arbres, panneaux, véhicules et
     modèles posés arrêtent la marche ; on glisse le long des murs. Buissons, herbes et petits rochers se
     traversent. Grille construite depuis la scène à l'entrée (`utils/walk-grid.ts`).
   - **Suivi du relief :** les pieds restent collés au sol (`terrainHeight`).

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

## 5. Tableau récapitulatif des commandes (`/simulation`)

Mêmes boutons que `/village` (§ 6) ; seul A/X change de rôle (pas d'analyse ici). Les légendes s'affichent
au-dessus de chaque manette 25 s à l'entrée, puis d'un clic de stick.

| Action                               | Manettes Meta Quest                  | Mains                        | PC (clavier / souris)           |
| :----------------------------------- | :----------------------------------- | :--------------------------- | :------------------------------ |
| **Marcher**                          | Stick gauche                         | —                            | `Z Q S D` / `W A S D` / flèches |
| **Pivoter de 30°**                   | Stick droit ← / →                    | Pouce glissé ← / →           | Regard à la souris (émulateur)  |
| **Un pas de 0,8 m**                  | Stick droit ↑ / ↓                    | Pouce glissé avant / arrière | —                               |
| **Sélectionner** (étiquette, bouton) | Gâchette                             | Pincer                       | Clic gauche                     |
| **Étiquettes du village**            | A / X                                | Tap du pouce                 | Balise flottante à l'entrée     |
| **Retour**                           | B / Y : ferme le panneau, sinon sort | —                            | « Fermer ✕ » / « Sortir »       |
| **Aide (légendes)**                  | Clic sur un stick                    | —                            | —                               |
| **Quitter la VR**                    | Bouton Meta                          | Geste système                | « Quitter la VR »               |

### Piloter l'énergie d'un bâtiment (VSIM-T3/T4)

1. Visez l'étiquette d'un bâtiment (ou le bâtiment) et sélectionnez : un **panneau holographique** s'ouvre
   devant vous avec ce que le moteur lui sert (kW servis / demandés, couverture) et sa limite.
2. **« − 0,5 kW » / « + 0,5 kW »** : limite la puissance entrante de l'heure affichée à minuit ;
   **« Couper tout »** : 0 kW ; **« Rétablir »** : plus de limite ; **« Annuler »** : défait le dernier changement.
   Chaque action relance le moteur (limite de secteur, `sectorCaps`) : tout le village le voit.
   La **clinique n'est jamais coupée** (constitution du village) : « Refusé ».
3. **« Aller à la porte »** : vous place devant l'entrée. **« Entrer »** : vous êtes dans la pièce (maison,
   classe, salle de soins, local pompe, étal, atelier) ; les lampes et appareils brillent selon la couverture,
   tout s'éteint si on coupe. Le même panneau est au mur ; **« Sortir »**, la porte ou B/Y vous ramènent dehors.
4. La limite porte sur le **secteur** (« Ménages » = toutes les maisons d'habitation), comme dans le moteur.

---

## 6. Commandes de l'immersion `/village` (visite 360°, détection, extraction 3D) — VS-T23

Un seul principe partout : **on vise, on valide** (gâchette, pincement ou clic). Une **bulle ambre** près du
bout du laser dit ce que fera la validation (« Gâchette · Extraire « Réfrigérateur » en 3D », « Pincer · Aller à
Cuisine »…). Une **carte légende** au-dessus de chaque manette ou main liste ses boutons : affichée 12 s à
l'entrée, puis rappelée d'un clic de stick ou du bouton **Menu › « Afficher l'aide des commandes »** (Meta :
laisser rappeler l'aide depuis un menu, VS-T24).

### 6.1 Manettes Touch

| Bouton               | Manette gauche                                                             | Manette droite                               |
| :------------------- | :------------------------------------------------------------------------- | :------------------------------------------- |
| **Gâchette** (index) | Valider ce qui est visé                                                    | Valider ce qui est visé                      |
| **Grip** (majeur)    | Attraper / faire tourner un modèle 3D                                      | Attraper / faire tourner un modèle 3D        |
| **Stick**            | Marcher (glisse dans le sens du stick)                                     | ←/→ : pivoter de 30° · ↑/↓ : un pas de 0,8 m |
| **X / A**            | Analyser la vue (comme le bouton)                                          | Analyser la vue                              |
| **Y / B**            | Retour : annuler le dialogue, quitter le labo, sinon ouvrir/fermer le menu | idem                                         |
| **Clic du stick**    | Afficher / masquer les légendes                                            | Afficher / masquer les légendes              |

- Le stick droit tenu répète le pivot / le pas toutes les 0,6 s ; relâcher sous 30 % pour réarmer.
- Chaque pivot / pas joue un petit son ; le pivot se fait autour de la tête (pas de dérive).
- Retour : vibration haptique et son à chaque tir, survol et validation.

### 6.2 Mains nues (suivi des mains)

| Geste                                               | Effet                                    |
| :-------------------------------------------------- | :--------------------------------------- |
| **Pincer** (pouce + index) en visant                | Valider (bouton, objet, flèche, panneau) |
| **Pincer et tenir** puis tourner                    | Faire défiler le carrousel des vues      |
| **Pouce glissé ← / →** sur l'index                  | Pivoter de 30°                           |
| **Pouce glissé avant / arrière**                    | Un pas de 0,8 m en avant / en arrière    |
| **Tap du pouce** sur l'index                        | Analyser la vue                          |
| **Regarder son poignet gauche** et pincer le bouton | Ouvrir le menu poignet                   |

Les gestes de pouce (microgestes) n'existent que si le navigateur les expose (Quest Browser récent, IWER) ;
sinon le pincement suffit pour tout (bouton « Analyser », flèches au sol, menu).

### 6.3 Navigateur PC (souris, clavier, émulateur IWER)

| Action                          | Comment                                                                                 |
| :------------------------------ | :-------------------------------------------------------------------------------------- |
| Viser / valider                 | Survol + **clic gauche**, aussi pendant la session émulée (bouton du poignet, panneaux) |
| Marcher dans la visite 360°     | **↑ ↓ ← →**, **W A S D** ou **Z Q S D** (souris au-dessus de la scène)                  |
| Changer de lieu                 | Marcher sur la flèche au sol, ou la viser et valider                                    |
| Manettes / mains de l'émulateur | Barre DevUI : bascule ✋ / 🎮 ; panneaux `Controller [L/R]` (A, B, X, Y, Trig, Stick)   |
| Bouger une manette              | Cliquer dessus → gizmo (flèches = déplacer, anneaux = tourner) ou champs Pos / Rot      |

Sous Linux, `Alt + clic` est souvent pris par le bureau : utilisez le gizmo ou la souris directe.
La DevUI d'IWER dessine son propre canvas plein écran par-dessus la scène : la souris est donc écoutée sur la
page (un clic sur ce canvas vise la scène avec la caméra de l'œil XR) ; un clic sur un panneau HTML ou un glisser
de gizmo ne tire jamais.
Glisser le carrousel des vues ou tourner un modèle à la souris garde le geste pour lui : la DevUI (qui tourne
le casque émulé quand on glisse dans le vide) ne reçoit rien, la vue reste fixe. Glisser dans le vide tourne
toujours la vue.
Pilotage scripté (MCP IWER ou `remote.dispatch`) : voir [`vr-iwer-tools.md`](vr-iwer-tools.md).

### 6.4 Déroulé type

1. **Analyser** (bouton en l'air, A/X ou tap du pouce) : barre de progression, puis contour complet + description
   au-dessus de chaque objet de la partie visible (bande de 180° × 112°).
2. Marcher : les contours restent **collés aux objets** (ils sont posés sur la photo, pas devant les yeux).
3. **Viser un objet et valider** → « Extraire en 3D ? » → _Extraire_ / _Annuler_ (ou B/Y pour annuler).
4. **Studio 3D** (VS-T24) : dès « Extraire en 3D », la vue 360° laisse place au studio (dôme, grille, socle).
   Au centre le carrousel des vues 2D (glisser, flèches, ou viser la vue voisine) ; **à droite** une colonne
   hologramme liste la génération (chaque vue, puis chaque étape 3D avec ses secondes) au-dessus de l'objet en
   **miniature** tournante sur un petit socle. « Valider et construire la 3D » → l'hologramme passe sur le socle
   central ; le **labo 3D s'ouvre tout seul** au même endroit quand le modèle est prêt : grip pour attraper /
   tourner, B/Y pour en sortir.
5. **Marcher dans le studio** (VS-T25) : stick gauche (glisse, relatif à la tête), stick droit ↑/↓ ou swipe du
   pouce (un pas de 80 cm), molette de la souris dans l'émulateur (25 cm par cran) ; la marche réelle marche aussi.
   Le studio glisse à l'inverse (dôme, carrousel, colonne, labo ensemble, rayon 2,4 m) et reprend sa place à la
   sortie : l'espace de référence XR, la visite et le mur webcam ne bougent pas. Vues 2D de 0,6 m (~27°).
6. **Émulateur, mode Play** (pointeur verrouillé) : la DevUI tourne le casque — manettes comprises — à chaque
   mouvement de souris. Pendant qu'une manette tient le carrousel ou un modèle, ce mouvement est intercepté
   (`window`, phase de capture) et tourne l'objet tenu, pas la vue (comme sur un casque, Meta « one-point
   manipulation »). Hors mode Play, clic gauche = gâchette du regard, clic droit glissé = tourner la tête.

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
| **Je ne sais plus quel bouton fait quoi (`/village`)**      | Les légendes se masquent après 12 s.                                                                  | Cliquez un stick, ou Menu › « Afficher l'aide des commandes » : les cartes légende réapparaissent au-dessus des manettes / mains.                        |
| **Mes touches clavier ne font pas bouger la caméra**        | Le curseur n'est pas verrouillé dans le mode FPS.                                                     | Cliquez sur **Play Mode** dans l'overlay DevUI, puis cliquez dans la fenêtre 3D pour verrouiller le pointeur.                                            |
| **Le clavier avance de travers (clavier français AZERTY)**  | Les raccourcis par défaut de l'émulateur sont en QWERTY (WASD).                                       | Utilisez **W/A/S/D**, ou cliquez sur le menu de mapping clavier de DevUI pour réassigner **Z/Q/S/D**.                                                    |
| **Le bouton « Voir en VR » n'apparaît pas**                 | WebXR requiert obligatoirement un contexte sécurisé (`localhost` ou HTTPS).                           | Vérifiez que l'URL commence bien par `http://localhost:...` ou `https://...`. En HTTP avec une adresse IP locale, WebXR est désactivé par le navigateur. |
| **Écran noir ou figé après une modification de code (HMR)** | Le rechargement à chaud (Hot Module Replacement) réinitialise le contexte WebGL en pleine session XR. | Rafraîchissez simplement la page dans votre navigateur (`Ctrl + R` ou `F5`) et relancez la session VR.                                                   |
