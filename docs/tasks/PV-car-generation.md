# Génération 3D des voitures — brief de départ (pour un contexte neuf)

> Brief autonome. Lis d'abord `CLAUDE.md`, `HANDOFF.md`, puis ce fichier. N'ouvre les autres docs que si une
> étape ci-dessous les nomme. Branche de départ : `feat/pq-t74-house-quality` (PQ-T67 → PQ-T75, pas encore sur
> `main`) : crée ta branche depuis elle, `feat/pq-t76-cars`. Première tâche libre : **PQ-T76**.

## 1. Objectif

Obtenir pour une **voiture** la même qualité que pour une maison : photo → dessins 2D validés → modèle 3D
reconnaissable (carrosserie, vitres, roues, phares, couleur juste), dans le viewer `/village`, le village et
l'export Blender. Types à couvrir : berline, citadine / hatchback, SUV, 4x4, break, coupé, cabriolet, pick-up /
camion, minibus.

## 2. Ce qui existe (vérifié le 2026-11-14)

- **Archétype** `vehicle` (`lib/object-kit.ts` : détection par le libellé — car, sedan, suv, truck, voiture,
  fiara… ; gabarit paramétrique `vehicle`, sous-types sedan, hatchback, vintage, van, truck, deux-roues).
- **Chaîne par les vues** (PQ-T69, `server/perception/recon/`) : la même que les maisons jusqu'à la
  reconstruction — 4 élévations + vue de dessus dessinées par Muse Image, coque visuelle, classes de couleur,
  le modèle porte ses dessins (PQ-T70). Les rôles de pièces `wheel`, `wheel_arch`, `rim`, `windscreen`,
  `rear_window`, `grille`, `door_line`, `bumper` existent dans `lib/object-shape.ts` ; `mask-wheels.ts` lit des
  roues sur un masque.
- **Ce qui n'existe pas** : aucun équivalent du spécialiste maison. `recon/route.ts` n'appelle
  `readHousePlan` que pour `house` / `building` ; une voiture reste la coque des vues, sans plan de pièces
  (pas de `CarPlan`, pas de maillage dédié).
- **Prompt de la face avant** (`facade-specialist.ts`, cas `vehicle`) : il demande une élévation de **face**
  (calandre). Pour une voiture, la vue qui porte la forme est le **profil** : à vérifier en premier, c'est
  peut-être la cause principale d'un mauvais résultat.

Le modèle de la maison à réutiliser comme patron (ne pas le copier, en extraire ce qui est commun) :
`house/house-tools.ts` (pilote + spécialistes), `house/house-specialist.ts` (orchestration, délais, repli,
`patchReading`), `house/house-fit.ts` (lecture → repère modèle, mesures sur les pixels), `lib/house-plan.ts`
(schéma Zod), `lib/house-mesh.ts` (maillage pur), `features/vision-insert/utils/house-projection.ts` (rendu).

## 3. Outils (ne pas réinventer)

```bash
# Live : Muse Image dessine les vues depuis la photo (≈ 7–10 min, réseau Meta instable : une voiture à la fois)
make views-3d PHOTO=resources/refine-3d/sedan.jpg OUT=resources/refine-3d/c-sedan LABEL=car
# Rejeu hors ligne des vues déjà dessinées (gratuit, déterministe)
make views-3d FRONT=…/view-front.png RIGHT=…/view-right.png BACK=… LEFT=… TOP=… OUT=dir LABEL=car OFFLINE=1 MATERIALS=metal,glass
# Capture du vrai viewer (serveur de dev lancé : make dev ; port : make port)
SHOT_SCALE=2 SHOT_DRAG=50,10 pnpm --filter web exec node scripts/object-viewer-shot.mjs http://localhost:<port> <dir> <dir>/viewer
```

Photos déjà présentes (`resources/refine-3d/`, crédits dans `SOURCES-refine.md`, dossier non versionné) :
`sedan`, `hatchback`, `suv`, `jeep`, `estate`, `coupe`, `cabrio`, `sport`, `minibus`, `truck-side`. Ajoute des
photos Wikimedia Commons (licence libre, crédit dans `SOURCES-refine.md`) pour les types manquants : pick-up,
voiture ancienne, taxi-brousse, 4L ou 2CV (courantes à Madagascar).

Range chaque essai dans `resources/refine-3d/c-<nom>/` (ignoré par git) avec `photo.jpg`, les `view-*.png`, la
lecture sauvegardée et une capture côte à côte photo / 3D (`voiture-3d-t76.jpg`).

## 4. Règles non négociables

- **Code voiture séparé du code maison** : tout ce qui est propre à la voiture vit dans
  `server/perception/car/` et `lib/car-*.ts`. Ne modifie ni `server/perception/house/` ni `lib/house-*.ts` ; un
  changement du code commun (`recon/`) est réservé à `vehicle` (garde sur l'archétype).
- **Contrôle maison hors ligne uniquement** : `make house-regress` (≈ 30 s, aucun appel Meta, gratuit) rejoue
  bungalow et école sur leurs dessins et lectures sauvegardés et vérifie les empreintes de `house-mesh.test.ts`.
  À lancer après tout changement du code commun. Ne relance **jamais** Muse ni Spark sur une maison pendant le
  travail voiture.
- Modèles Meta uniquement (Spark, Muse Image). Ne jamais projeter la photo sur le modèle ; les dessins 2D
  validés oui. Code pur sans `Math.random` non seedé.
- Réutilise avant d'écrire (`rg`) : appels, délais et repli des spécialistes, mesure de couleur
  (`sampleColor`, `dominantColor`), échantillons, rôles de pièces existants.
- Toute nouvelle pièce est **optionnelle** dans les schémas. Chaque fonction livrée avec son test Vitest ; doc
  dans le même commit (`docs/contracts.md`, `docs/copilot.md`, entrée dans `PV-vision-quality.md`) ; scénario
  manuel dans `test-scenarios/06-village.md` (suite après V343) ; `HANDOFF.md` à jour. Un commit par tâche,
  push, une PR pour la phase.
- Itère sur des **rejeux** dès qu'une lecture est bonne ; un appel live coûte.

## 5. Démarche

**Étape 0 — Mesurer avant de concevoir (obligatoire).** Lance 3 voitures en live telles quelles (`sedan`,
`suv`, `truck-side`), regarde les 5 dessins et le modèle au viewer, et note dans la tâche ce qui casse : vues
(face au lieu du profil ? proportions ? roues ?), coque (roues fondues dans la caisse ? vitres ?), couleurs
(reflets pris pour la teinte ?). Les décisions des étapes suivantes dépendent de ce constat ; ne construis pas
le spécialiste avant.

**Étape 1 — Vues.** Si le constat le confirme : pour `vehicle`, la vue de référence devient le **profil** (côté
conducteur), puis face, arrière, autre profil, dessus. Vérifie ce que cela change pour `reconstructObject`
(quelle vue fixe la largeur, laquelle la profondeur) avant de toucher au prompt.

**Étape 2 — Plan de voiture.** Schéma `CarPlan` (Zod, `lib/car-plan.ts`), dans le repère de `HousePlan` :
caisse (profil lu sur le dessin de côté : capot, pavillon, coffre, garde au sol), habitacle / vitrage
(pare-brise, lunette, vitres latérales, montants), roues (centre, rayon, largeur, passage de roue), portes
(lignes), phares et feux, pare-chocs, calandre, rétroviseurs, plateau ou benne pour un pick-up. Lecture par un
pilote + spécialistes sur le patron maison (par exemple `body`, `glazing`, `wheels`, `details`, `finishes`),
puis `fitCar` qui **accroche sur les pixels** : roues = cercles sombres mesurés sur le profil, vitrage = zones
sombres, teinte de caisse = couleur dominante hors reflets et hors vitres.

**Étape 3 — Maillage et rendu.** `carMesh` pur : caisse extrudée depuis le profil avec flancs galbés (pas une
boîte), habitacle en retrait, roues cylindriques avec jante, passages de roue creusés, vitres dans leur
emplacement. Un matériau par emplacement (peinture, verre, pneu, jante, chrome, plastique, phares). Même
contrat que `houseSlotLooks` pour le viewer, le village et l'export Blender.

**Étape 4 — Banc et corrections.** Les 10 photos, une à la fois ; corrige chaque défaut constaté dans le fit ou
le maillage, rejoue, garde la capture avant / après.

## 6. Constat de l'étape 0 (PQ-T76, 2026-11-14)

Trois runs live sans aucun changement de code (`make views-3d PHOTO=… LABEL=car|truck`) : `sedan` (7,5 min),
`suv` (2,2 min), `truck-side` (2,8 min), aucun échec réseau. Dossiers `resources/refine-3d/c-*/` (déplacés le 2026-11-14) :
`views-sheet.jpg` (les 5 dessins), `viewer/` (vrai viewer), `voiture-3d-t76.jpg` (photo | viewer | coque).

- **Dessins : bons, l'hypothèse « face au lieu du profil » est fausse.** Les 5 vues sont cohérentes entre
  elles et fidèles à la photo (berline bicolore, SUV noir, pick-up avec cellule), profils aux bonnes
  proportions avec 2 roues lisibles. Seul défaut : la vue de dessus du pick-up est dessinée couchée (longueur
  à l'horizontale) ; `alignTop` la rejette, à juste titre. Ne pas toucher au prompt de face en premier.
- **Proportions : modèle trop court de 25 à 40 %** (cause principale, dans `recon/views.ts`) :
  | voiture                                                                                                        | h/d profil dessiné | w/d face + profil | modèle w/d · h/d |
  | -------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------- | ---------------- |
  | sedan                                                                                                          | 0,35               | 0,43              | 0,55 · 0,46      |
  | suv                                                                                                            | 0,36               | 0,47              | 0,57 · 0,46      |
  | truck                                                                                                          | 0,41               | 0,42              | 0,49 · 0,50      |
  | (1) `GRID_COLS_MAX` 256 sur `GRID_ROWS` 128 plafonne la profondeur à 2 × la hauteur : tout profil plus long    |
  | est tassé à h/d 0,50. (2) Quand la vue de dessus est acceptée, `depthFromPlan` fixe d = w / aspect du plan, et |
  | Muse dessine le plan trop large (0,54 et 0,57, rétroviseurs compris) : il écrase le profil, plus juste ici.    |
  | La face du SUV compte aussi ses rétroviseurs dans la largeur.                                                  |
- **Coque : aucune pièce n'a de rôle** (96 pièces sans `role`), pas de roues : la berline a 2 cylindres de
  1,6 % de largeur collés aux flancs d'un seul essieu, le SUV et le pick-up aucun (roues = blocs sombres
  fondus dans la caisse, passages de roue pleins). Caisse en boîtes empilées, pavillon en gradins, vitres =
  boîtes sombres plaquées. Vue de 3/4, les dessins projetés filent en stries sur les faces obliques.
- **Couleurs** : pas de reflet pris pour la teinte (dessins en lumière plate). Mais le pavillon vert foncé de
  la berline tombe dans la classe « verre » (#72807f), et sur le SUV caisse (#171717) et vitres (#383838) sont
  presque confondues ; matériaux nommés au hasard (enjoliveurs = `rubber`, plaque = `plastic`).
- **Viewer** : de face la berline est reconnaissable grâce aux dessins projetés ; le SUV et le pick-up gardent
  leur silhouette ; aucune ne tient en 3/4 (caisse en boîte, roues absentes).

**Ordre proposé pour la suite** : (a) proportions d'un véhicule lues sur le profil (plafond de grille levé,
plan seulement en contrôle), rejeu hors ligne des 3 voitures ; (b) roues mesurées sur le profil (cercles
sombres, `mask-wheels.ts`) puis `CarPlan` ; (c) séparation vitrage / caisse. L'étape 1 (prompt profil en
premier) n'est plus prioritaire.

**(a) fait (PQ-T76a)** : proportions d'un véhicule lues sur les élévations (`profileProportions`,
`vehicleAspects`), rétroviseurs hors largeur. Rejeux w/d · h/d : berline 0,42 · 0,35, SUV 0,39 · 0,35, pick-up
0,40 · 0,41. Maisons inchangées. Captures `c-*/voiture-3d-t76a.jpg`, `t76a-sheet.jpg`.

**(b) fait (PQ-T76b)** : `CarPlan` (`lib/car-plan.ts`, `recipe.car`) ; roues mesurées sur le profil
(`car/car-wheels.ts`) : arc bas de chaque pneu sur la silhouette, symétrique autour du contact au sol, ombre
portée de Muse retirée (papier assombri, teinté sous les pneus) ; voie lue sur la face. 2 essieux sur les
trois voitures, rayons cohérents (`t76b-wheels.jpg`). Rejeu : `make car-replay OUT=…`.

**(c) fait (PQ-T76c)** : l'équipe voiture (pilote + `body`, `glazing`, `lights`, `finishes`, appel `askCarTool`
séparé de la maison). Essai live sur la berline seule (5 appels Spark) : berline 4 portes bicolore chromée,
11 vitres, 34 détails ; la face est bien placée, le profil décalé de 0,02 à 0,05 (`t76c-reading.jpg`) : le fit
devra accrocher ces lectures sur les pixels. Lecture rangée dans `c-sedan/car-reading.json`, rejouée par
`make car-replay`. Suite : `fitCar` puis `carMesh`.

**(d) fait (PQ-T76d)** : `car/car-fit.ts` ajuste la caisse sur les silhouettes (profil du flanc, passages de
roue au-dessus des roues mesurées ; section de face, rétroviseurs écrêtés ; effilement vu de dessus) et applique
la lecture de l'équipe (vitres dans le repère du modèle, teinte caisse et vitrage). `lib/car-mesh.ts` en tire
une caisse lissée (≈ 6 k triangles, 9 emplacements, roues cylindriques, flanc des jantes = dessin), vue 3D,
village et export Blender. Ombre portée retirée aussi sur la face (voie de la berline 0,098–0,904). Rejeu : caisse
sur les trois ; berline 10 vitres ; SUV et pick-up sans vitres (pas de lecture d'équipe). Capture
`t76d-viewer.jpg`. Reste : lecture d'équipe SUV / pick-up (5 appels Spark chacun), banc de 10 photos.

**(e) fait (PQ-T76e, demande du 2026-11-14)** : sorties voitures déplacées dans `resources/refine-3d/` (`c-*`,
`t76*.jpg` ; `make car-replay` y lit par défaut). Caisse : capot et coffre en plateau plat à la largeur de la
caisse (ils étaient pincés à la largeur de la cabine : bosses), toit à la largeur de la cabine sous la rangée
arrondie du dessin (il ne faisait que 26 % de la largeur : dôme), effilement de la vue de dessus limité aux
extrémités, normales cassées aux arêtes. Génération : une voiture (archétype détecté) est dessinée d'abord
de **profil** (vue 2D à valider « Profil 2D »), puis face, arrière, dessus, **dessous** ; le côté gauche est le
profil en miroir, jamais dessiné ; le dessous habille le plancher (6ᵉ tuile de l'atlas). Essai live sur la
berline (5 dessins, sans équipe, `NO_CAR=1`) : profil redressé depuis une photo de ¾, vues cohérentes, vue de
dessus enfin en long, score 0,851 (`c-sedan-p/views-sheet.jpg`, `c-sedan-p/t76e-viewer.jpg`).

**(g) fait (PQ-T78, banc du 2026-11-14)** : contrôle visuel sur le maillage voiture lui-même
(`car-sheet.png`, huit caméras, écrit par chaque rejeu). Cause du capot du jeep trouvée : une voiture
dessinée « profil d'abord » était **construite à l'envers** (calandre sur le coffre) ; corrigé dans
`recon/route.ts` (le profil, avant à droite, est l'élévation `left` ; son miroir la `right`). Les anciens
dossiers `c-sedan`, `c-suv`, `c-truck-side` (dessins « face d'abord ») ont leur `view-right.png` retourné une
fois (original gardé : `view-right-house.png`) ; `c-suv-p/car-reading.json` a ses côtés échangés (original :
`car-reading-t76.json`). Aussi : pare-chocs lisant leur dessin (plus de stries du dessous), vitres découpées
net le long des polygones lus, pare-brise incliné vitré, montants sans plis, vue de dessus redressée
(`car/car-top.ts`). Appels live : équipe seule sur le jeep (5 appels Spark, 8 vitres) ; cinq voitures
dessinées depuis leur photo, une à la fois (Muse Image ×5 + équipe) :

| voiture (`c-…`)               | score | lecture                | reste faux                                                                                       |
| ----------------------------- | ----- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `truck-p` (pick-up + cellule) | 0,800 | pickup, 13 vitres      | vue de dessus dessinée couchée (redressée) ; filets sombres le long de l'épaule de la benne      |
| `hatchback-p`                 | 0,899 | hatchback, 10 vitres   | rien de notable                                                                                  |
| `minibus-p`                   | 0,739 | minibus, 13 vitres     | bande « face » sur le montant avant droit                                                        |
| `cabrio-p`                    | 0,834 | convertible, 1 vitre   | habitacle ouvert dessiné à plat (pas creusé), cadre de pare-brise plein ; roue arrière sous jupe |
| `beetle-p`                    | 0,809 | lu « coupe », 6 vitres | l'aileron arrière de la photo devient un bloc plein                                              |
| `jeep-p` (équipe seule)       | 0,908 | offroad, 8 vitres      | pare-buffle et treuil pleins sur toute la largeur                                                |

Non relancés (dessins et lectures du 2026-11-14 rejoués) : `suv-p` (8 vitres), `sedan-p` (sans équipe : pas de
vitres), anciens `sedan`, `suv`, `truck-side`. Planche photo / 3D : `resources/refine-3d/t78-bench.jpg`.
Pas encore essayés : `estate`, `coupe`, `sport`, et `bus`, `limo`, `lorry`, `motorhome`, `tractor` de
`sources/refine-3d/`. Limites connues : la caisse est le profil extrudé (un aileron, un pare-buffle ou une
capote ouverte ne sont pas détachés), le sens du profil suit la consigne donnée à Muse (avant à droite) sans
contrôle sur les pixels.

Rejeu gratuit de tout le banc : `make car-replay OUT=r5` (≈ 12 s par voiture).

## 7. Définition de « fini » pour une étape

- Tests Vitest verts (`pnpm --filter web test -- car`, plus les suites maison), typecheck, lint sans erreur.
- Règles de non-régression maison du § 4 vérifiées et citées dans le compte rendu.
- Captures viewer photo / 3D des voitures concernées dans leur dossier, décrites dans la tâche.
- Docs, scénario manuel et `HANDOFF.md` à jour ; commit conventionnel `feat(perception): … (PQ-T7x)`, poussé.
- Compte rendu honnête : ce qui marche, ce qui reste faux sur chaque voiture, ce qui n'a pas été vérifié en
  live.
