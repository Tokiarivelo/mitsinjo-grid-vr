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

Dans le casque via Meta Quest Browser, **il n'y a aucun modal ni encadrement** : dès que vous cliquez sur le bouton « Voir en VR », le navigateur cède la place à un environnement virtuel **à 360° stéréoscopique à l'échelle 1:1**, vous plaçant directement en surplomb du village.

---

## 2. Comment contrôler l'immersion (Avancer, Reculer, Regarder, Interagir)

### Option A : Sur PC sans casque (Émulateur IWER DevUI)

Deux façons de piloter le casque simulé :

#### 1. Le mode FPS / Déplacement libre (« Play Mode ») — _Le plus intuitif_

C'est le mode le plus simple pour vous déplacer comme dans un jeu vidéo :

1. Dans l'overlay DevUI qui s'affiche à l'écran, cliquez sur le bouton ou l'icône **« Play Mode »** (souvent symbolisé par une manette ou un clavier).
2. Cliquez sur la vue 3D : votre curseur de souris est capturé (**Pointer Lock**).
3. **Commandes de déplacement clavier :**
   - **Avancer :** Touche **`W`** (sur clavier QWERTY) ou **`Z`** (sur clavier AZERTY selon mapping).
   - **Reculer :** Touche **`S`**.
   - **Pas latéral gauche (Strafe) :** Touche **`A`** (QWERTY) ou **`Q`** (AZERTY).
   - **Pas latéral droite :** Touche **`D`**.
   - **Prendre de la hauteur (monter) :** Touche **`Espace`**.
   - **Descendre (altitude basse) :** Touche **`C`** ou **`Shift`**.
   - **Accélérer le déplacement :** Maintenir **`Shift`**.
4. **Orientation de la tête (Regard) :**
   - Bougez simplement la souris pour tourner la tête à 360°, lever les yeux vers le soleil ou regarder le sol.
5. **Libérer la souris / Quitter le Play Mode :**
   - Appuyez sur la touche **`Échap` (Esc)** pour récupérer votre curseur de souris.

> [!TIP]
> Si vos touches AZERTY ne répondent pas comme prévu, ouvrez le panneau de configuration des raccourcis (**Keyboard Mapping**) dans l'overlay DevUI pour réassigner Z/Q/S/D en quelques clics.

#### 2. Les curseurs précis des panneaux latéraux DevUI

Si vous voulez positionner la caméra à des coordonnées exactes :

- **Panneau Headset :** Déplacez manuellement les curseurs **Position (X, Y, Z)** (en mètres) et **Rotation (Yaw, Pitch, Roll)**.
- **Panneaux Controllers (Manette Gauche / Droite) :**
  - Ajustez la position des mains virtuelles.
  - Testez les boutons physiques simulés : _Trigger_ (gâchette), _Grip/Squeeze_ (prise en main), _Thumbstick_ (joystick directionnel), _Boutons A / B_ (droite) et _X / Y_ (gauche).
  - Poses de mains préenregistrées : _Point_ (pointer du doigt), _Fist_ (poing), _Relaxed_ (main ouverte), _Pinch_ (pincer).

#### 3. Pilotage automatique via l'Agent IA (MCP Bridge iwer)

Si le pont MCP `@iwer/extension-bridge` est activé, vous pouvez simplement demander à l'agent conversationnel :

- _« Place le casque à 5 mètres au-dessus du conteneur de batterie BESS »_
- _« Oriente la caméra vers les panneaux solaires à l'ouest »_

---

### Option B : Sur Casque Réel (Meta Quest 2 / 3 / Pro)

1. **Suivi physique réel (6DoF Roomscale) :**
   - Vous marchez physiquement dans votre pièce : la caméra se déplace exactement à votre rythme dans le village (1 unité 3D = 1 mètre réel).
   - Baissez-vous pour observer les câbles au sol, levez la tête pour inspecter les lignes aériennes.
2. **Joysticks des manettes Touch :**
   - Joystick gauche : translation (avancer, reculer, strafe).
   - Joystick droit : rotation angulaire par paliers (snap turn) ou fluide.
3. **Quitter la VR :**
   - Appuyez sur le bouton physique **Oculus / Meta** de la manette droite pour ouvrir le menu système Quest et quitter l'onglet WebXR, ou cliquez sur le bouton virtuel « Quitter la VR ».

---

## 3. Ce que vous pouvez tester et observer dans l'immersion 3D

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

## 4. Tableau récapitulatif des commandes

| Action souhaitée                   | Sur PC (DevUI / Play Mode)                                         | Sur Casque VR (Meta Quest)                 |
| :--------------------------------- | :----------------------------------------------------------------- | :----------------------------------------- |
| **Passer en vrai plein écran**     | Bouton « Plein écran » HUD + touche `F11`                          | Automatique à 360° dans le casque          |
| **Lancer la session VR**           | Clic sur le bouton « Voir en VR » (lunettes)                       | Clic sur « Voir en VR » dans Quest Browser |
| **Avancer / Reculer**              | Touches **`W` / `S`** (ou `Z`/`S`) en Play Mode                    | Pousser / tirer le joystick gauche         |
| **Pas latéraux (gauche/droite)**   | Touches **`A` / `D`** (ou `Q`/`D`) en Play Mode                    | Déplacer le joystick gauche latéralement   |
| **Monter / Descendre en altitude** | Touches **`Espace`** (monter) / **`Shift`** ou **`C`** (descendre) | Se baisser / se lever physiquement         |
| **Tourner le regard**              | Déplacer la souris (pointeur capturé)                              | Tourner la tête librement à 360°           |
| **Sortir du déplacement souris**   | Touche **`Échap` (Esc)**                                           | Geste système ou bouton Oculus             |
| **Quitter l'immersion VR**         | Clic sur **« Quitter la VR »**                                     | Bouton Oculus/Meta ou bouton Quitter       |

---

## 5. Dépannage rapide (FAQ)

| Problème rencontré                                          | Explication                                                                                           | Action corrective                                                                                                                                        |
| :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La scène reste dans une petite boîte centrale**           | Le mode plein écran automatique a été bloqué par la politique du navigateur (ex. iframe).             | Cliquez directement sur l'icône **« Plein écran »** dans la barre HUD en haut à droite du viewport 3D pour forcer le plein écran.                        |
| **Mes touches clavier ne font pas bouger la caméra**        | Le curseur n'est pas verrouillé dans le mode FPS.                                                     | Cliquez sur **Play Mode** dans l'overlay DevUI, puis cliquez dans la fenêtre 3D pour verrouiller le pointeur.                                            |
| **Le clavier avance de travers (clavier français AZERTY)**  | Les raccourcis par défaut de l'émulateur sont en QWERTY (WASD).                                       | Utilisez **W/A/S/D**, ou cliquez sur le menu de mapping clavier de DevUI pour réassigner **Z/Q/S/D**.                                                    |
| **Le bouton « Voir en VR » n'apparaît pas**                 | WebXR requiert obligatoirement un contexte sécurisé (`localhost` ou HTTPS).                           | Vérifiez que l'URL commence bien par `http://localhost:...` ou `https://...`. En HTTP avec une adresse IP locale, WebXR est désactivé par le navigateur. |
| **Écran noir ou figé après une modification de code (HMR)** | Le rechargement à chaud (Hot Module Replacement) réinitialise le contexte WebGL en pleine session XR. | Rafraîchissez simplement la page dans votre navigateur (`Ctrl + R` ou `F5`) et relancez la session VR.                                                   |
