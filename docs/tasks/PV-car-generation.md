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
make views-3d PHOTO=resources/refine-3d/sedan.jpg OUT=~/Téléchargements/generated-view/c-sedan LABEL=car
# Rejeu hors ligne des vues déjà dessinées (gratuit, déterministe)
make views-3d FRONT=…/view-front.png RIGHT=…/view-right.png BACK=… LEFT=… TOP=… OUT=dir LABEL=car OFFLINE=1 MATERIALS=metal,glass
# Capture du vrai viewer (serveur de dev lancé : make dev ; port : make port)
SHOT_SCALE=2 SHOT_DRAG=50,10 pnpm --filter web exec node scripts/object-viewer-shot.mjs http://localhost:<port> <dir> <dir>/viewer
```

Photos déjà présentes (`resources/refine-3d/`, crédits dans `SOURCES-refine.md`, dossier non versionné) :
`sedan`, `hatchback`, `suv`, `jeep`, `estate`, `coupe`, `cabrio`, `sport`, `minibus`, `truck-side`. Ajoute des
photos Wikimedia Commons (licence libre, crédit dans `SOURCES-refine.md`) pour les types manquants : pick-up,
voiture ancienne, taxi-brousse, 4L ou 2CV (courantes à Madagascar).

Range chaque essai dans `~/Téléchargements/generated-view/c-<nom>/` avec `photo.jpg`, les `view-*.png`, la
lecture sauvegardée et une capture côte à côte photo / 3D (`voiture-3d-t76.jpg`).

## 4. Règles non négociables

- **Zéro régression sur les maisons** : empreintes `meshHash` de `house-mesh.test.ts` inchangées ; rejeu
  `bungalow/house-reading-single.json` = `house-pq-t72.json` octet pour octet (`cmp`) ; rejeu de l'école : seule
  la ligne `base` diffère. Ne modifie le code maison que pour en extraire une partie commune, tests à l'appui.
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
`suv` (2,2 min), `truck-side` (2,8 min), aucun échec réseau. Dossiers `~/Téléchargements/generated-view/c-*/` :
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

## 7. Définition de « fini » pour une étape

- Tests Vitest verts (`pnpm --filter web test -- car`, plus les suites maison), typecheck, lint sans erreur.
- Règles de non-régression maison du § 4 vérifiées et citées dans le compte rendu.
- Captures viewer photo / 3D des voitures concernées dans leur dossier, décrites dans la tâche.
- Docs, scénario manuel et `HANDOFF.md` à jour ; commit conventionnel `feat(perception): … (PQ-T7x)`, poussé.
- Compte rendu honnête : ce qui marche, ce qui reste faux sur chaque voiture, ce qui n'a pas été vérifié en
  live.
