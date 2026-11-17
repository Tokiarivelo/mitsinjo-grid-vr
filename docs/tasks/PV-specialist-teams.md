# Équipes de spécialistes 3D pour tout objet — brief d'implémentation (contexte neuf)

> Brief autonome. Lis d'abord `CLAUDE.md`, `HANDOFF.md`, puis ce fichier. N'ouvre les autres docs que si
> une étape les nomme (`docs/contracts.md` § ObjectShape, `docs/copilot.md` si un prompt change).
> Branche : depuis `main` à jour, `feat/pq-t83-specialist-teams`. Une tâche = un commit, une PR pour la phase.
> Suivi : la checklist du § 6 (cocher ce qui est implémenté et vérifié).
> Demande utilisateur (2026-11-17) : « généraliser les agents spécialistes à tout genre d'objet, rendre
> certains réutilisables ; sinon créer des spécialistes de rendu 3D par classe d'objet et ajouter les
> agents qui manquent à la génération générale ».

## 1. Objectif

Toute photo d'objet (maison, voiture, plante, mais aussi canapé, chaise, rideau, frigo, clôture, rocher…)
passe par une **équipe de spécialistes** qui lit ses dessins 2D validés et donne un **plan de pièces**, comme
la maison (PQ-T73), la voiture (PQ-T76) et la plante (PQ-T82) le font déjà. Une seule mécanique d'équipe,
des spécialistes partagés, une équipe par classe d'objet. Les chiffres et la géométrie restent calculés par
le code ; le modèle ne fait que lire et nommer.

## 2. Ce qui existe (vérifié le 2026-11-17)

Trois équipes, même schéma recodé trois fois : **pilote** (brief : genre, pièces présentes) → **spécialistes
en parallèle** (chacun son prompt système + schéma JSON, délai, une relance) → **fusion** en une lecture.

| Équipe  | Code                                                             | Spécialistes                              | Requis            | Lecture → géométrie                           |
| ------- | ---------------------------------------------------------------- | ----------------------------------------- | ----------------- | --------------------------------------------- |
| Maison  | `server/perception/house/house-{tools,specialist,fit,prompt}.ts` | massing, openings, structure, finishes    | massing, openings | `readHousePlan` → `house-fit.ts`              |
| Voiture | `server/perception/car/car-{tools,specialist}.ts` + `car-*.ts`   | body, glazing, lights, finishes           | body, glazing     | `readCar` → `car-fit.ts`, `car-views.ts`      |
| Plante  | `server/perception/tree/plant-{tools,specialist}.ts`             | trunk, branches, foliage, flowers, leaves | foliage           | `readPlant` → `plantHints` → `plant-build.ts` |

- Outils communs : `server/perception/team-call.ts` (`callWithDeadline`, `askSpecialists` : parallèle + une
  relance). Rien d'autre n'est partagé : chaque `*-specialist.ts` refait le pilote, la boucle, le log, la fusion.
- Appels Meta : `meta.ts` `askHouseTool` / `askCarTool` / `askPlantTool` (même modèle, étape `parts` de
  `step-models.ts`) ; `client.ts` les expose ; un retour mock compte comme « pas de réponse ».
- Câblage : `object-shape.ts` (~l. 420) passe `askHouseTool`, `readCar`, `readPlant` à `reconstructObject` ;
  `recon/route.ts` choisit par archétype (`vehicle` l. 598, `tree`/`bush` l. 448, `house`/`building` l. 630).
- Archétypes : `lib/object-kit.ts` `KIT_ARCHETYPES` (cabinet, screen, fan, machine, lamp_post, pole, tank,
  panel, house, building, tree, bush, vehicle, person, animal, water, other). **Pas de mobilier ni de textile** :
  un canapé, une chaise, un rideau tombent dans `other` (une boîte) ou un gabarit d'appareil.
- Banc hors ligne : `make tour-mock` (159 objets réels de la visite 360°, contour + specs à la main,
  score IoU / ΔE) ; c'est la **référence de forme** pour les nouvelles classes (`server/perception/tour-mock/`).

## 3. Architecture cible

```
server/perception/team/
  team.ts           SpecialistTeam<Tool, Brief, Reading> (définition pure) + runTeam() (le seul moteur)
  shared/           spécialistes réutilisables (prompt + schéma + parse), branchés dans plusieurs équipes
    finishes.ts     matériaux, couleurs, état de surface (déjà en maison + voiture : à fusionner)
    openings.ts     ouvertures vitrées / portes (maison openings + voiture glazing + meubles vitrés)
    legs.ts         appuis : pieds, piètement, socle, roulettes (meubles, tables, réservoirs, panneaux)
    profile.ts      silhouette et proportions de face / de côté (corps principal de tout objet)
  teams/            une définition par classe : house, car, plant (portées), + les nouvelles (§5)
  registry.ts       archétype → équipe ; une classe sans équipe garde le chemin actuel
```

**Contrat de `SpecialistTeam`** (à écrire tel quel, sans framework) :

- `id`, `promptVersion`, `tools: readonly Tool[]`, `required: readonly Tool[]`, `timeoutMs`.
- `pilot: { system, schema, question(label, views), parse(text) → Brief | null }`.
- `specs: Record<Tool, { system, schema, question(label, views, brief) }>` ; un outil partagé s'insère par
  `...FINISHES_SPEC` sans copie.
- `answered(tool, text) → boolean`, `merge(answers, brief) → Reading | null`, `summary(reading) → string` (log).
- `runTeam(team, ask, { label, views, images, signal })` → `{ reading, brief }` : le corps commun de
  `readCarParts` / `readPlantParts` / `readHouseParts` (pilote → `askSpecialists` → requis manquants → fusion
  → log). **Ne lève jamais** ; null = pas de lecture, le chemin actuel décide.
- Un seul appel client générique `askTeamTool(team, tool, system, schema, imageUrl, question, refs, signal)`
  dans `meta.ts` / `client.ts` ; les trois `askXTool` deviennent des alias puis disparaissent (T85).

## 4. Règles (non négociables ici)

- **Modèles Meta seulement** (mémoire `meta-models-only`). Aucune image tierce, aucun service externe.
- Le modèle lit des **dessins 2D validés coupés à l'objet**, jamais la photo collée sur un modèle (mémoire
  `3d-photo-use`). Géométrie et nombres = code (`*-fit.ts`, builders), jamais l'IA.
- **Pas de test live maison** (mémoire `no-live-house-checks`) : régression maison hors ligne
  (`make house-regress`) ; tests live éventuels sur le modèle contributeur, jamais Muse Wonder.
- Le portage maison / voiture / plante est **à comportement constant** : mêmes prompts, mêmes versions,
  mêmes lectures sur les fixtures enregistrées. Un prompt qui change incrémente son `promptVersion`.
- Chaque fonction a son test Vitest dans le même commit ; pas de duplication (`docs/conventions.md` § Reuse).
- Doc dans le même commit : `docs/contracts.md` (nouveaux types de lecture, archétypes), `docs/architecture.md`
  (dossier `team/`), `docs/copilot.md` si un prompt change. Archétype nouveau → clés i18n en / fr / mg
  (`make check-i18n`). Scénarios manuels dans `test-scenarios/06-village.md` (suite des V-IDs).

## 5. Classes d'objets et équipes à créer

| Classe (archétype)                                  | Exemples (visite 360°)                                         | Spécialistes                                                                  | Requis            | Builder                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `seat` (nouveau)                                    | canapé, fauteuil, chaise, tabouret, pouf, banc                 | profile, **cushions** (assise, dossier, accoudoirs, coussins), legs, finishes | profile           | `sofa` / `chair` / `stool` de `tour-mock/specs-extra.ts`, promus en builders |
| `table` (nouveau)                                   | table, îlot, guéridon, desserte                                | profile (plateau), legs, finishes                                             | profile           | `table`                                                                      |
| `storage` (nouveau, ou `cabinet` élargi)            | placard, armoire, buffet, étagère, comptoir                    | profile, openings (portes, tiroirs, vitrines), **shelves**, finishes          | profile           | `cabinet`, étagères                                                          |
| `bed` (nouveau)                                     | lit                                                            | profile, **bedding** (matelas, couverture, oreillers), legs, finishes         | profile           | `bed`                                                                        |
| `textile` (nouveau)                                 | rideau, voilage, tapis, fond photo                             | **drape** (accroche, plis, nouage), finishes                                  | drape             | pièce `silhouette` (contour) + tringle                                       |
| `fixture` (nouveau)                                 | porte, fenêtre, miroir, tableau, cadre                         | openings (grille de carreaux, arc), finishes                                  | openings          | `glazing`, `door`                                                            |
| `appliance` (= cabinet, screen, fan, machine, tank) | frigo, clim, écran, ventilateur, pompe                         | profile, **controls** (grilles, écrans, boutons), legs, finishes              | profile           | gabarits existants + lecture                                                 |
| `light` (= lamp_post + intérieur)                   | applique, plafonnier, lustre, lampadaire                       | profile, **lamp** (abat-jour, ampoules, bras), finishes                       | lamp              | gabarits lampe                                                               |
| `structure` (nouveau, + pole, panel)                | clôture, portail, garde-corps, pylône, pont, panneaux solaires | **lattice** (montants, lisses, barreaux, treillis, pas), finishes             | lattice           | `railing`, `fence`, pylône                                                   |
| `terrain` (nouveau)                                 | rocher, tronc couché, souche, pneu                             | profile, finishes                                                             | profile           | pièce `silhouette` + section                                                 |
| `house` / `building`                                | maisons                                                        | massing, openings, structure, finishes                                        | massing, openings | existant                                                                     |
| `vehicle`                                           | voitures                                                       | body, glazing→openings, lights, finishes                                      | body, glazing     | existant                                                                     |
| `tree` / `bush`                                     | arbres, haies, plantes en pot                                  | trunk, branches, foliage, flowers, leaves (+ **pot**)                         | foliage           | existant (`plant-pot.ts`)                                                    |

En gras : spécialistes propres à une équipe. Les autres viennent de `team/shared/`. `person`, `animal`,
`water` : hors périmètre (pas de plan de pièces), ils gardent leur chemin.

## 6. Checklist d'implémentation

> Coche `[x]` chaque case dans le commit qui l'implémente (code + test + doc). Une tâche est finie quand toutes
> ses cases le sont ; coche alors sa ligne de titre. Ne coche jamais une case non vérifiée : écris plutôt la
> limite à côté (« — reste : … »). Statut global en tête de `HANDOFF.md`.

### [x] PQ-T83 — Moteur d'équipe générique

- [x] `team/team.ts` : type `SpecialistTeam<Tool, Brief, Reading>` (champs du § 3).
- [x] `runTeam(team, ask, { label, views, images, signal })` → `{ reading, brief }`, ne lève jamais.
- [x] Test : toutes les réponses OK → lecture fusionnée.
- [x] Test : un spécialiste vide → relancé une fois seul, puis fusion.
- [x] Test : spécialiste requis manquant après relance → `reading: null`, brief gardé.
- [x] Test : signal annulé / délai dépassé → null, sans lever.
- [x] `docs/architecture.md` : dossier `server/perception/team/`.

### [x] PQ-T84 — Plante, voiture, maison sur `runTeam` (comportement constant)

- [x] `PLANT_TEAM` dans `tree/plant-tools.ts` ; `readPlantParts` = `runTeam(PLANT_TEAM, …)`.
- [x] `CAR_TEAM` dans `car/car-tools.ts` ; `readCarParts` = `runTeam(CAR_TEAM, …)`.
- [x] `HOUSE_TEAM` dans `house/house-tools.ts` ; `readHouseParts` = `runTeam(HOUSE_TEAM, …)`.
- [x] Tests existants plante / voiture / maison verts **sans changer leurs attentes**.
- [x] Prompts et `*_PROMPT_VERSION` inchangés (diff vide sur les prompts).
- [x] `make house-regress` identique avant / après (sortie jointe au commit).
- [x] Boucles pilote → spécialistes → fusion supprimées des trois `*-specialist.ts` (zéro duplication).

### [x] PQ-T85 — Un seul appel Meta d'équipe

- [x] `askTeamTool(team, tool, system, schema, imageUrl, question, refs, signal)` dans `meta.ts` (étape `parts`).
- [x] Même méthode dans `client.ts` et `mock.ts` (mock → pas de réponse).
- [x] `askHouseTool` / `askCarTool` / `askPlantTool` retirés, appelants migrés.
- [x] `object-shape.ts` : une fabrique `readWith(team)` au lieu de trois branches.
- [x] Tests client / meta mis à jour ; `docs/copilot.md` (appels de l'étape `parts`).

### [x] PQ-T86 — Spécialistes partagés

- [x] `team/shared/finishes.ts` : schéma commun maison + voiture, extensions par équipe.
- [x] `team/shared/openings.ts` : openings maison ∪ glazing voiture (grilles, arcs, portes).
- [x] `team/shared/legs.ts` : pieds, piètement, socle, roulettes.
- [x] `team/shared/profile.ts` : silhouette et proportions face / côté du corps principal.
- [x] Maison et voiture branchées sur `finishes` et `openings` partagés (promptVersion + 1).
- [x] Fixtures maison / voiture rejouées ; écarts listés dans `docs/copilot.md`.
- [x] Un test par spécialiste partagé (schéma, `answered`, parse).

### [x] PQ-T87 — Registre et nouveaux archétypes

- [x] `team/registry.ts` : `teamFor(archetype)` (null = chemin actuel) + test.
- [x] `recon/route.ts` : plus de `archetype === 'vehicle' | 'tree' | 'house'`, passage par `teamFor`.
- [x] `KIT_ARCHETYPES` + `seat`, `table`, `storage`, `bed`, `textile`, `fixture`, `structure`, `terrain`.
- [x] Détection par libellé en / fr / mg pour chacun (canapé, chaise, armoire, rideau, clôture, rocher…) + tests.
- [x] `familyOf` → `parametric` pour les nouveaux ; libellés i18n en / fr / mg (`make check-i18n`).
- [x] `docs/contracts.md` : liste des archétypes et types de lecture.

### PQ-T88 — Builders de mobilier (réutilisés par la visite)

- [x] `server/perception/furniture/` : `sofa`, `chair`, `stool`, `bed`, `table`, `cabinet` (lecture → recette).
- [x] Même dossier : `glazing`, `door`, `curtain`, `railing`, `fence`.
- [x] Un test par builder (recette valide `ObjectRecipeSchema`, pièces nommées attendues).
- [x] `tour-mock/specs-extra.ts` réimporte ces builders (aucune copie) ; `make tour-mock` sans régression de score. — vérifié par empreinte : les 157 objets de la visite compilent en recettes identiques avant / après (même entrée → mêmes scores) ; `make tour-mock` complet non relancé.
- [ ] Pièce `silhouette` disponible au chemin réel (contour SAM, jamais les pixels) pour `textile` et `terrain`. — reste : `curtain` porte déjà `silhouette` (bande + section) dans le modèle de pièces partagé, mais le chemin réel ne passe pas encore le contour SAM au builder ; à brancher avec `TEXTILE_TEAM` / `TERRAIN_TEAM` (PQ-T90).

### PQ-T89 — Équipes assise, table, rangement, lit

- [ ] `SEAT_TEAM` (profile, cushions, legs, finishes) + fixtures rejouées + test.
- [ ] `TABLE_TEAM` (profile, legs, finishes) + fixtures + test.
- [ ] `STORAGE_TEAM` (profile, openings, shelves, finishes) + fixtures + test.
- [ ] `BED_TEAM` (profile, bedding, legs, finishes) + fixtures + test.
- [ ] Branchées dans `registry.ts` ; objets de la visite de ces classes à IoU ≥ 0,85 (ou limite écrite).
- [ ] Scénarios manuels `test-scenarios/06-village.md` (canapé, chaise, armoire, lit).

### PQ-T90 — Équipes textile, menuiserie, structure, terrain, appareil, luminaire

- [ ] `TEXTILE_TEAM` (drape, finishes) + fixtures + test.
- [ ] `FIXTURE_TEAM` (openings, finishes) + fixtures + test.
- [ ] `STRUCTURE_TEAM` (lattice, finishes) + fixtures + test.
- [ ] `TERRAIN_TEAM` (profile, finishes) + fixtures + test.
- [ ] `APPLIANCE_TEAM` (profile, controls, legs, finishes) pour cabinet / screen / fan / machine / tank + test.
- [ ] `LIGHT_TEAM` (profile, lamp, finishes) pour lamp_post et luminaires intérieurs + test.
- [ ] Branchées dans `registry.ts` ; scénarios manuels (rideau, porte, clôture, rocher, frigo, applique).

### PQ-T91 — Banc, dataset et doc

- [ ] Cas d'éval par classe ; `make gen-evals` ; si la sortie change : `make hf-dataset && make hf-publish`.
- [ ] `README.md` (fonctions / limites : classes couvertes par une équipe).
- [ ] `docs/tasks/README.md` : statut de cette phase mis à jour.
- [ ] `HANDOFF.md` réécrit (fichiers touchés, décisions).

### Fin de phase

- [ ] Sur `/village`, une photo de canapé, de chaise, de rideau, de clôture et de rocher donne un modèle à
      pièces nommées (« Pièces vues sur la photo » : assise, dossier, pieds…) au lieu d'une boîte.
- [ ] Maison, voiture et plante inchangées (régressions hors ligne vertes, `make check` vert).
- [ ] Une PR pour la phase, CI vert, fusionnée dans `main`.

## 7. Méthode par équipe nouvelle (recette à suivre)

1. Choisir 3–5 objets de la visite de la classe (`tour-data.ts`) : ce sont les fixtures et la cible de forme.
2. Écrire le schéma JSON de chaque spécialiste propre : **noms fermés** (listes `as const`), parts du dessin en
   fractions 0–1, jamais de mètres ni de couleurs inventées (les couleurs sont mesurées sur la photo).
3. `merge` → `Reading` Zod-validée ; `toHints` / `fit` → paramètres du builder. Tests : lecture jouée →
   recette valide (`ObjectRecipeSchema`), pièces attendues présentes.
4. Brancher dans `registry.ts` ; vérifier le mode mock (`make dev-mock` : objet de la visite → modèle de la
   visite, objet hors visite → gabarit) et le mode Meta sur le modèle contributeur.
5. Concepts de pièces nouveaux → clés `model3dPart` en / fr / mg (déjà présentes : seat, backrest, cushion,
   mattress, curtain, pot, shelf, rail, mirror, flower).

## 8. Pièges connus

- `cyl` couché : la taille est la **boîte monde** → `[longueur, d, d]` avec `axis: 'x'`.
- Mobilier ajouré (chaises, tabourets, étagères métal, garde-corps) : le contour plein compte le fond vu à
  travers, l'IoU sous-estime ; juger aussi les vues 3/4 et face des planches `test-results/tour-mock/`.
- Rendu `renderFlat` des hulls : fines rayures blanches aux sommets de section (à corriger avant de juger ΔE).
- Couronnes en silhouette = coussins : ne pas remplacer `reconstructTree` sauf lecture cassée (IoU < 0,45).
- Temps : chaque spécialiste coûte un appel ; garder ≤ 5 spécialistes par équipe et les `ALWAYS` minimaux.
