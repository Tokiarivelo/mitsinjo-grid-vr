# Image → 3D : pipeline universel (spécification complète à implémenter)

> **Statut.** Spécification fusionnée le 2026-11-11. Elle réunit : le pipeline universel (version du jour),
> le plan de fidélité (défauts signalés : saule, voiture sans lunette arrière, toit sans débord, lenteur) et la
> méthode du modeleur (regarder → choisir la représentation → construire du gros au détail → vérifier). Rien de
> nouveau n'est construit par ce fichier.
> « Existe » = dans le code, fichier vérifié présent le 2026-11-11 (`apps/web/src/server/perception/`).
> « À construire » = proposé ici. « À vérifier » = dépend de l'API Meta, non confirmé.
> **Compagnons.** État réel et tâches PQ : `vision-to-3d-methodology.md`. Cartes de prompt :
> `vision-to-3d-muse-skills.md`.
> **Règles qui ne bougent pas.** Modèles Meta uniquement · le LLM n'écrit jamais de sommets ni de valeur d'énergie ; il peut écrire le code de construction, exécuté **uniquement** dans le bac à sable de §8bis ·
> la photo n'est jamais plaquée sur le modèle (petits échantillons répétables de 64 px seulement) · aucune valeur
> d'énergie ne sort d'un modèle.

---

## 1. La méthode du modeleur, analysée

Quand on demande de la 3D à un modèle de langage, la bonne manière de travailler est celle d'un modeleur, en code :

1. **Regarder** et lister ce qu'on voit : proportions, pièces, pièces cachées.
2. **Choisir la représentation** : primitives paramétriques pour un objet technique, générateurs procéduraux
   (système de L, instanciation) pour le vivant, champs de distance (SDF) ou bibliothèque pour les formes lisses.
3. **Écrire le modèle**, du gros volume vers les formes secondaires, puis les détails.
4. **Vérifier** par un rendu comparé à l'image, corriger par petits changements, ne garder que les gains.

Un modèle de langage ne produit pas de maillage directement : des listes de sommets en texte sont imprécises.
Il décrit, le code construit.

### 1.1 Où le pipeline suit déjà la méthode, où il s'en écarte

| Étape du modeleur                    | Pipeline actuel                                                  | Écart                                                                                                        | Traité en |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| 1. Regarder, inventorier             | `evidence` (observe-then-commit) existe                          | L'inventaire n'est pas **fermé** : rien n'oblige à lister la lunette arrière ; le code ne refuse pas l'oubli | E5, §5    |
| 2. Choisir la représentation         | Un seul choix : gabarit de primitives, puis corps révolu/extrudé | Pas de choix entre trois familles ; le vivant et les formes lisses sont forcés dans des boîtes et sphères    | §4, §7    |
| 3. Construire gros → détail          | Gabarit ≤ 12 pièces, puis boucle par étapes                      | Le gabarit est fixe : un détail absent du gabarit n'existe jamais ; pas de générateurs                       | §6, §7    |
| 4. Vérifier, ne garder que les gains | Existe (score, critique, boucle)                                 | Le score ne voit pas les détails absents ni le dessous des franges ; vérification sous un seul angle         | E9, E11   |

### 1.2 « Écrire du code » : décision prise

Le modeleur écrit du three.js ou du Blender. **Décision du 2026-11-11 : la règle « Muse n'écrit jamais de code »
est supprimée.** Muse Wonder écrit le code de construction, exécuté dans un bac à sable (§8bis), puis raffiné par la
boucle écrire → exécuter → rendre → comparer → corriger. C'est ce que font LL3M et 3DCodeBench (méthodologie §12.5).

| Voie                                      | Ce que le modèle produit                                                                         | Rôle                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **A. Gabarit + ShapeScript**              | Gabarit d'archétype réglé par un kit, puis opérations typées                                     | **Brouillon immédiat** et filet de sécurité ; correctifs ciblés de la boucle par étapes (E11)                  |
| **B. Code généré en bac à sable** (§8bis) | Une fonction `build(api, params)` **écrite par Wonder pour chaque objet**, patchée à chaque tour | **Chemin principal pour tous les objets** : le modèle final est le résultat de ce code, jamais un gabarit figé |

Principe (décision du 2026-11-11) : **aucun objet n'est fini par un code fixe.** Un gabarit donne un point de
départ et un brouillon affichable tout de suite ; le code que Wonder écrit **pour cet objet**, d'après sa photo, le
remplace et le raffine. Les constantes du gabarit (débord de toit, nombre de fenêtres, position des ouvertures)
ne sont que des bornes de sécurité : la valeur vient de l'observation de l'objet.

Les deux voies produisent le même format de pièces : assemblages, rendu plat, score et viewer sont communs. Les
générateurs de §7.3 sont la bibliothèque que l'`api` de B expose ; A et B partagent donc le même code de construction.
Ce qui reste interdit : une sortie de modèle qui devient une valeur d'énergie, la photo plaquée sur le modèle, et un
code exécuté ailleurs que dans le bac à sable.

### 1.3 Pourquoi les imperfections reviennent (diagnostic)

Vérifié dans le code le 2026-11-11.

| Symptôme                           | Cause                                                                                                                                                                                                                  | Classe                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Voiture sans lunette arrière       | Le gabarit `vehicle` (`lib/object-kit.ts`) n'a **aucune pièce de couleur vitre** : cabine et prismes de pare-brise ont la couleur du toit, l'accent sert aux roues                                                     | Lacune de gabarit           |
| Toit de maison au ras des murs     | `ROOF_OVERHANG = 0.03` (`object-geometry.ts`), seulement pour les pignons, minuscule, indépendant du type de toit ; le chemin « maison par élévations » calcule un débord (`facade-house.ts:574`), pas le chemin photo | Constante + chemin manquant |
| Saule = dôme sur un bâton          | Gabarit `tree` de 5 solides, puis `withLatheBody` révolue le contour SAM : ni franges qui pendent, ni branches, ni évasement du tronc                                                                                  | Vocabulaire manquant        |
| Détails absents partout            | 12 pièces max sur la photo ; kit = 3 couleurs et 7 comptes ; aucun inventaire des pièces à construire                                                                                                                  | Budget + pas d'inventaire   |
| Le juge dit 93/100 sur du médiocre | Score = silhouette + contours + couleur moyenne (méthodologie §3)                                                                                                                                                      | Règle aveugle               |
| Lent                               | Étapes séquentielles attendues ; la branche `feat/vision-no-timeout` a retiré toute limite de temps : une étape lente n'est plus coupée                                                                                | Forme du pipeline           |

Racine commune : **le modèle part d'un gabarit fixe et n'est corrigé que là où le score voit.** Un détail absent du
gabarit et ignoré du score ne revient jamais. Les remèdes agissent sur les deux moitiés : élargir ce qui peut être
construit, et rendre visible au score ce qui manque.

---

## 2. Principe : l'analyse par synthèse

Aucun modèle de l'API Meta ne transforme une image en maillage (vérifié le 2026-11-01). La seule route est :

1. un modèle de vision dit **ce que c'est** et **quelles pièces** il voit ;
2. les pixels disent **combien ça mesure** et **de quelle couleur** ;
3. du code déterministe **construit** un modèle paramétrique (pièces + opérations) ;
4. un rendu comparé à l'image **décide** ce qui est gardé ;
5. un critique propose de petites corrections, gardées seulement si le score monte.

Conséquence à annoncer à l'utilisateur : le résultat est une **reconstruction plausible et propre**, pas un scan.
Un saule généré par paramètres ressemble à un saule, pas à ce saule. Les faces invisibles sont déduites (symétrie,
règles) et marquées `inferred`.

---

## 3. Modèles et rôles

Tous passent par la même clé et la même URL de base (`META_API_KEY`, `server/perception/meta.ts`).

| Rôle                                          | Modèle (défaut)    | Variable             | Point d'accès       | Statut               |
| --------------------------------------------- | ------------------ | -------------------- | ------------------- | -------------------- |
| Voir, classer, inventorier, critiquer         | `muse-spark-1.3`   | `META_VISION_MODEL`  | `/chat/completions` | Existe               |
| Contour et masques de pièces                  | `sam-3.1`          | `META_SEGMENT_MODEL` | `/responses`        | Existe               |
| Vues manquantes (côté, façade propre)         | `muse-image-1.0`   | `META_IMAGE_MODEL`   | `/responses`        | Existe (chemin 2D)   |
| Contrôle final et re-raffinage (fond)         | `muse-wonder-1.0`  | `META_REFINE_MODEL`  | `/chat/completions` | Existe               |
| Juge à grille (hors ligne, 6 critères)        | `muse-wonder-1.0`  | `META_JUDGE_MODEL`   | `/chat/completions` | Existe, non calibré  |
| Écriture et raffinage du code de construction | `muse-wonder-1.0`  | `META_CODE_MODEL`    | `/chat/completions` | À construire (§8bis) |
| Questions courtes oui / non par pièce         | `muse-spark-1.3`   | `META_VISION_MODEL`  | `/chat/completions` | À construire (E9)    |
| Secours du chat (pas utilisé pour la 3D)      | `muse-glimmer-30b` | `GLIMMER_MODEL`      | —                   | Hors pipeline        |

### 3.1 Paramètres d'appel

**Spark / Wonder (vision, `visionJson`)**

| Paramètre             | Valeur                                                                                 | Note                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `model`               | variable du rôle                                                                       | Repli sur `META_VISION_MODEL` si Wonder échoue                                                          |
| `reasoning_effort`    | `high` partout aujourd'hui (`effort.ts`)                                               | Cible : `high` kit / critique / juge, `low` questions oui-non. À vérifier : valeurs acceptées par l'API |
| `messages`            | `system` (carte de compétence) + `user` = texte, image principale, images de référence | Image principale en premier                                                                             |
| `response_format`     | `{ type: 'json_schema', json_schema }` strict                                          | Jamais de texte libre, jamais de géométrie                                                              |
| `temperature`, graine | non envoyés                                                                            | Pas de graine côté API : la stabilité vient du vote (E5) et des mesures                                 |
| Délai                 | aucun par défaut sur la première réponse ; seul le signal de l'appelant annule         | Budgets explicites gardés pour le fond et les évaluations                                               |

**SAM 3.1 (`segmentImage`)** : `input` = un message (`input_text` = **un** mot-concept, `input_image` = image) ;
`metadata` = `{ include_confidence: 'true', mask_encoding: 'one_bit' }` ; sortie = boîtes 2D, confiance, masque
1 bit → contour (`maskToOutline`) ; coût = un appel par (image, concept).

**Muse Image 1.0** : corps `{ model, input }`, `input` = consigne + recadrage de référence ; sortie = dernier
`image_generation_call.result` (base64) → PNG ; toujours 2 candidats, le plus cohérent gardé (E10) ; jamais utilisé
comme texture. À vérifier : taille de sortie, paramètres d'édition avec image de référence.

---

## 4. Aiguillage : type d'image **et** famille de représentation

Première décision, avant toute géométrie (E2). Un appel Spark, schéma strict. Elle répond à deux questions : _quel
type d'image ?_ et _quelle famille de représentation ?_ (étape 2 de la méthode du modeleur).

### 4.1 Les trois familles de représentation

| Famille                       | Pour quoi                                                                            | Comment c'est construit                                                                                      | Statut                                           |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Paramétrique (primitives)** | Objets techniques : appareils, bâtiments, véhicules, mobilier                        | Gabarit par archétype + pièces + assemblages + `loft` / `inset` pour les profils                             | Existe (gabarits) ; `loft`, `inset` à construire |
| **Procédurale (générateurs)** | Le vivant et le répétitif : arbres, buissons, herbe, toit de chaume                  | `sweep`, `branch`, `scatter`, `drape` : le code fait croître, Muse règle les paramètres                      | À construire                                     |
| **Champ de distance (SDF)**   | Formes lisses et organiques sans arêtes : personne, animal, fruit, bouteille, rocher | Union douce de ≤ 12 primitives (sphère, capsule, ellipsoïde, boîte arrondie) puis maillage à résolution fixe | À construire (§8)                                |
| **Bibliothèque**              | Objets très courants dont un gabarit réglé existe                                    | Gabarit paramétrique nommé et testé, choisi par l'archétype ; Muse ne règle que les paramètres               | Existe (17 archétypes), à étendre                |

### 4.2 Routes par type d'image

| Type d'image                          | Détection                             | Route                                                                             |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Photo, un objet net                   | 1 objet dominant                      | Pipeline complet (§6) dans la famille de l'archétype                              |
| Photo, plusieurs objets               | > 1 objet                             | L'opérateur choisit ; un objet par requête (existe)                               |
| Objet caché à ≥ 30 %                  | `hidden ≥ HIDDEN_MIN` (0,3)           | Proposer « dessiner une façade propre » → chemin 2D (existe, PQ-T23)              |
| Dessin, plan, élévation, logo         | aplats, peu de textures               | Chemin 2D : SAM sur le dessin, maison par élévations ou enveloppe                 |
| Bâtiment                              | archétype `house` / `building`        | Arbre de façade : répétitions, ouvertures, toit mesuré, débord                    |
| Organique (arbre, buisson)            | archétype `tree` / `bush`             | Famille procédurale (à construire)                                                |
| Véhicule, objet profilé               | archétype `vehicle`                   | `loft` par stations (à construire) ; gabarit boîte corrigé en attendant           |
| Personne, animal                      | archétype `person` / `animal`         | SDF (à construire) ; mannequin par pièces en attendant ; ressemblance non promise |
| Surface plane (eau, sol)              | archétype `water`                     | Feuille plate (`WATER_SHEET` 0,04)                                                |
| Inconnu ou confiance basse            | archétype `other` ou confiance < 0,82 | Demander à l'opérateur (PQ-T41), sinon pièces libres ≤ 12 solides                 |
| Pas d'objet, image floue ou minuscule | conditions `low`                      | Refuser avec la cause et un conseil de prise de vue                               |

---

## 5. Inventaire fermé par archétype (la liste de pièces obligatoires)

C'est le remède le plus rentable au « il manque toujours un détail ». Chaque fiche de compétence
(`server/perception/skills/`, source `vision-to-3d-muse-skills.md`) et le schéma du kit (`SHAPE_JSON_SCHEMA`) gagnent
une liste **`anatomy`** fermée. Pour chaque pièce que l'archétype a toujours, le modèle répond
`present | hidden | absent` et indique où. Le code **refuse** un modèle où une pièce `present` manque et construit
un défaut ; le score compte ce rappel.

| Archétype | Pièces de la liste                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Véhicule  | pare-brise, **lunette arrière**, vitres latérales, roues, passages de roue, phares, feux arrière, rétroviseurs, pare-chocs, calandre, lignes de portes, toit, plaque |
| Maison    | murs, toit, **débord du toit**, faîtage, porte, fenêtres, cheminée, soubassement, gouttière, marches                                                                 |
| Arbre     | tronc, évasement / racines, branches, couronne, **retombant ou non**, densité du feuillage                                                                           |
| Appareil  | porte, poignée, aérations, pieds, afficheur, câble                                                                                                                   |

Fichiers : `skills/archetypes.ts`, `shape.ts`, `lib/object-kit.ts` (`ShapeKitSchema`), `fusion.ts` (anatomie =
preuve), `detail-score.ts` (le rappel compte les pièces d'anatomie, pas seulement les masques SAM).
Réussi quand : la capture réelle de la voiture construit une lunette arrière sans chemin de code qui la traite à part.

---

## 6. Les étapes

Chaque étape : ce qu'elle fait, qui la fait, ses paramètres, ce qui prouve qu'elle a réussi.
Fichiers sous `apps/web/src/server/perception/` sauf mention.

### E0. Réception de l'image — `prepare-image.ts` (existe)

- `sharp` : plus grand côté ≤ **1280 px** (`VISION_MAX_SIDE`), JPEG qualité **85**, orientation EXIF appliquée.
- Sortie : image normalisée + empreinte (SHA-256) pour le cache (E12).

### E1. Qualité de la photo — `photo-conditions.ts` (existe)

- Code pur : netteté (variance : < 0,0008 basse, > 0,005 haute), exposition (écrêtage : 0,08 moyen, 0,25 fort),
  taille en pixels de l'objet, part cachée, classe de vue.
- Sert à : prévenir l'opérateur, baisser la confiance de fusion, être **dit au modèle** dans la question.

### E2. Détection et aiguillage — `detect.ts`, `region.ts` (existe) + type d'image et famille (à construire)

- Spark, effort `high`. Sortie : liste d'objets (étiquette, boîte, archétype pressenti, confiance) + type d'image +
  famille de représentation (§4).
- Un objet par requête de forme.

### E3. Contour par accord SAM — `outline.ts`, `sam-consensus.ts` (existe)

- Jusqu'à **3 formulations** (étiquette, nom normalisé, nom de l'archétype) × **2 images** (photo, recadrage), en parallèle.
- Garder un masque quand deux réponses se recouvrent à IoU ≥ **0,8** (`AGREE_IOU`) ; sinon le plus confiant contenu
  à ≥ 90 % dans la boîte ; sinon « pas de contour » avec la cause. Arrêt dès que deux s'accordent.
- Sans contour : pas d'ajustement, pas de corps mesuré → le modèle est annoncé comme estimé.

### E4. Recadrages — `shape-crop.ts` (existe)

- **Contexte** : boîte × **1,6**, 640–768 px, extérieur blanchi à 40 % → pour reconnaître.
- **Serré** : boîte seule → pour lire les pièces.

### E5. Inventaire puis kit — `shape.ts`, `skills/` (observe-then-commit existe ; `anatomy` à construire)

- Spark, effort `high`, schéma strict, carte de compétence de l'archétype en `system`.
- Le schéma impose l'ordre : **d'abord ce qui est vu, ensuite la décision.**

```ts
evidence: {
  view: 'front' | 'side' | 'three_quarter' | 'back' | 'top';
  visibleParts: { name: string; where: string }[]; // ≤ 12
  hiddenBy: string[];
  unsure: string[];
}
anatomy: { part: string; state: 'present' | 'hidden' | 'absent'; where?: string }[]; // à construire (§5)
kit: { archetype; subtype; proportions; colours (3 rôles); materials; counts; details; eaves? }
```

- `details.eaves` (à construire) : `none | short | deep`, débord du toit, mesuré sur le contour quand c'est possible.
- **Vote** : 2 échantillons du kit quand `unsure` n'est pas vide (`kit-vote.ts`, `SHAPE_KIT_SAMPLES`).
- Interdit dans la réponse : coordonnées, dimensions en mètres, sommets.

### E6. Masques de pièces — `part-masks.ts` (existe)

- Un appel SAM par mot-concept tiré de `evidence.visibleParts` et de `anatomy` (roue, fenêtre, porte, poignée…),
  sur le recadrage serré, en parallèle.
- Sortie : boîte, masque, confiance par pièce → positions mesurées, pas devinées.

### E7. Mesures sur les pixels — code pur (existe)

| Mesure                             | Fichier                                | Détail                                                               |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| Couleur par région                 | `region-colors.ts`, `color-measure.ts` | Médiane sur la part **éclairée**, ombre à part                       |
| Ligne de toit, pignons             | `roofline.ts`                          | Jamais demandée au LLM ; sert aussi au débord                        |
| Répétitions                        | `repetition.ts`                        | Fenêtres, cellules de panneau                                        |
| Lacet (angle de vue)               | `perspective.ts`                       | Lignes de fuite, borné à 60° (`MAX_YAW`)                             |
| Échantillons de matière            | `photo-swatches.ts`                    | ≈ 64 px, répétables                                                  |
| Brillance (à construire)           | `gloss-measure.ts` (absent)            | Statistiques de reflets → rugosité ± 0,2 (PQ-T26)                    |
| Franges du bord bas (à construire) | `outline`                              | Irrégularité du bord inférieur de la couronne → paramètre de `drape` |

### E8. Fusion, ajustement, construction — code pur (existe ; générateurs à construire)

- `fusion.ts` : chaque champ = mesure ou supposition, pondéré par sa confiance (baissée par `unsure` et par E1).
- `silhouette-fit.ts` + `nelder-mead.ts` : proportions ajustées au contour. Budget calcul ≤ **300 ms**.
- Corps tiré du contour : `profile-body.ts` (extrusion) ou `lathe-body.ts` (révolution).
- Pièces depuis les masques : `mask-wheels`, `mask-panels`, `mask-chimney`, `wall-openings`.
- `object-graph.ts` : graphe (fenêtre dans mur, roue sur caisse), contraintes, réparation des pièces en l'air et
  des doublons ; `hidden-sides.ts` : faces cachées par miroir, statut `inferred`.
- **Construction du gros vers le détail** (étape 3 du modeleur) : volume principal → formes secondaires (cabine,
  toit, couronne) → détails (assemblages, générateurs).
- **Vocabulaire** (`lib/object-shape.ts`, `lib/shape-script.ts`) :
  - formes : `box, cylinder, sphere, cone, prism, extrude, lathe, hip, hull` ;
  - opérations ShapeScript : `add, set, remove, attach, cut, repeat (≤ 8), material` ;
  - 15 matières : `stone, brick, plaster, concrete, wood, thatch, tile, slate, metal, glass, plastic, fabric, rubber, foliage, water` ;
  - à construire : générateurs (§7), matière `painted`, types de détail (§7.2).
- Budgets : ≤ **5 000 triangles**, 12 pièces (photo) ou 32 composants ; cible : plafonner par triangles, pas par pièces.

### E9. Score — `flat-render.ts`, `model-score.ts`, `detail-score.ts` (existe)

- Rendu à plat du modèle à la vue de la photo, mêmes assemblages que le visualiseur (`expandAssemblies`) ; un jumeau
  serveur de chaque générateur (§7) pour que le juge voie la même chose.
- Sans masques : `0,40 × IoU silhouette + 0,35 × F1 contours + 0,25 × couleur ΔE`.
- Avec masques : `0,30 silhouette + 0,25 contours + 0,20 couleur + 0,25 pièces` (pièces = moyenne rappel / précision).
- Contrôles sans référence : vues à 0°, 45°, 90° → modèle trop mince (< 0,15 de la face) ou en plusieurs morceaux ;
  8 bandes de hauteur → pire SSIM, bandes vides.
- À construire : **rappel d'anatomie** (§5) ; **vérification multi-angle** contre la vue de côté générée quand elle
  existe ; **question courte par pièce manquante** : recadrage serré de la zone, Spark effort `low`, réponse
  oui / non + où + couleur.

### E10. Vues manquantes — `object-views.ts`, `view-candidates.ts` (existe sur le chemin 2D ; à étendre)

- Muse Image : vue de côté sur fond uni, **2 candidats**, garder le plus cohérent avec la face :
  même hauteur à ± 0,05 (`SIDE_HEIGHT_TOL`), ligne haute plausible (`SIDE_TOP_MIN` 0,3), couleurs proches.
- À étendre : **planche de trois vues** (face, côté, arrière) pour les objets hors maisons ; la vue arrière reste
  un **miroir** quand la génération échoue. La vue de dessus n'est pas demandée (2 sur 3 fausses à l'essai PR-4.1).
- Usage : contours et positions de pièces uniquement, jamais en texture.

### E11. Boucle de correction — `spark-critic.ts`, `shape-stages*.ts`, `photo-stages.ts` (existe)

- **Critique** (Spark) : planche photo | rendu face | rendu ¾ | différence, tuiles **512 px** (`CRITIC_TILE`),
  ≤ **3** tours (`CRITIC_ROUNDS`), déclenché sous **70 / 100** (`CRITIC_SCORE_MAX`). Consigne : préférer « rien à corriger ».
  À étendre : le critique nomme les **pièces d'anatomie absentes ou fausses** (identifiants de la liste §5), le code
  traduit chaque identifiant en correction.
- **Boucle par étapes** (Spark, en fond) : corps → vitrages → roues → détails ; ≤ **3 tours** par étape, ≤ **12 opérations**,
  chaque opération essayée seule, gardée si gain ≥ **0,005**, arrêt après **2** échecs.
- **Gros plan par pièce manquante** (à construire) : recadrage serré de la zone, question courte, en parallèle.
- **Contrôle final** (Wonder, en fond), repli sur Spark.
- Règle unique : **on ne garde que les gains mesurés.** Arrêt sur défaut répété, va-et-vient ou plateau.
- Les barrières dures (contour, pièces en l'air, pièce d'anatomie manquante) ne sont jamais levées par l'avis d'un modèle.
- Pas de critique ni de boucle quand l'objet vient entièrement d'un générateur déterministe : il n'y a rien à régler.

### E12. Livraison et vitesse — `object-shape.ts`, visualiseur R3F

À faire dans cet ordre. **Mesurer d'abord** (la lenteur observée n'est pas encore localisée).

1. **Journal** : durée par étape (détection, recadrage, kit, SAM, masques, ajustement, score, critique, étapes, vues)
   dans les logs et les événements SSE.
2. **Parallèle** : kit (E5), contour (E3), mesures (E7) ne partagent que le recadrage. Cible : temps du premier modèle
   = le plus lent des deux, pas leur somme.
3. **Brouillon puis raffinage** : montrer le modèle dès que kit + contour existent ; critique, boucle et vues en fond,
   remplacement seulement sur gain.
4. **Passer ce qui ne peut pas aider** : pas de critique pour un objet de générateur ; pas de contrôle Wonder si le
   score dépasse déjà les critères d'arrêt.
5. **Cache** : (empreinte image, version de prompt) → kit ; (empreinte recadrage, concept) → réponse SAM.
6. **Effort par appel** (PQ-T17) : `high` pour le kit, `low` pour les questions oui-non.
7. **Aucune limite de temps** : la première réponse et le raffinage en fond attendent Meta sans limite (choix de cette
   branche). Seule la limite de l'hébergeur découpe le travail en tranches reprises par point de reprise ; la boucle
   s'arrête sur plateau, défaut répété ou 3 tours sans gain, jamais sur une horloge.

- Rendu : maillage fusionné par matière, couleur mesurée par sommet, studio softbox, ombre de contact, encre 0,6,
  MSAA 4× (détail : méthodologie §11).

---

## 7. Gabarits corrigés, générateurs et détails

### 7.1 Corrections de gabarit sans appel de modèle (à faire tôt)

- **Vitrage du véhicule.** Ajouter des pièces de couleur vitre : pare-brise, lunette arrière, bandeaux de vitres
  latérales (boîtes ou prismes fins, matière `glass`, légèrement en saillie de la cabine). La couleur des roues passe
  en constante sombre pour que le rôle `accent` signifie « vitre ». Mettre à jour les tests et la voiture dorée.
- **Débord du toit.** Il n'est plus une constante : le code de l'objet (§8bis) le choisit d'après la ligne de toit
  mesurée et le type de toiture vu sur la photo. Dans le gabarit de brouillon, `details.eaves` donne seulement un
  point de départ ; `ROOF_OVERHANG` devient une borne (tuile ≈ 0,04 · chaume ≈ 0,07 · plat ≈ 0,02) qui limite la
  valeur choisie, pas une valeur imposée. Ajouter un **bandeau de rive** (boîte fine sous le bord)
  pour que le débord se lise comme un bord de toit. Reprendre le calcul de `facade-house.ts:574` pour le chemin photo.
- **Toits en croupe** : ni biseau ni débord aujourd'hui (méthodologie §11.2) ; ajouter les deux.
- **Plafond de pièces** : budget en triangles (≤ 5 000) au lieu de 12 pièces ; les petites pièces (poignées, miroirs,
  feux) coûtent peu. Change `contracts.md` et les tests dorés.

### 7.2 Nouveaux types de détail

Ajouter à `DETAIL_KINDS` (`lib/object-shape.ts`) et à `assembly-parts.ts` : `rear_window`, `windscreen`, `mirror`,
`grille`, `door_line`, `fascia`, `ridge_cap`, `gutter`, `reveal` (embrasure), `step`, `handle`, `vent`,
`wheel_arch`, `bumper`. Chaque détail est un assemblage développé **de façon identique** dans le visualiseur et dans le
rendu du juge (`expandAssemblies`).

### 7.3 Générateurs (la part « sculpture ») : Muse envoie des paramètres, le code construit

Nouvelles opérations ShapeScript, validées par Zod, bornées, à graine fixe : même entrée, même maillage.

| Op        | Construit                                                                | Paramètres que Muse remplit                                                                 | Corrige                                              |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `sweep`   | Tube le long d'une polyligne / spline, rayon qui s'amincit               | points (≤ 8), r0, r1, côtés                                                                 | troncs, branches, tuyaux, câbles, poignées, antennes |
| `branch`  | Ramification récursive (système de L)                                    | niveaux ≤ 3, nombre, angle, retombée, décroissance, graine                                  | arbres, buissons                                     |
| `scatter` | Cartes de feuilles / tuiles / bardeaux en `InstancedMesh` dans un volume | volume (pièce ou enveloppe du contour), nombre ≤ 400, taille, orientation, couleurs, graine | feuillage, chaume, herbe                             |
| `drape`   | Brins qui pendent depuis des points des branches                         | nombre, longueur, ondulation, épaisseur                                                     | saule, lianes, rideaux                               |
| `inset`   | Creux ou relief rectangulaire sur une face                               | face, u, v, largeur, hauteur, profondeur                                                    | embrasures, panneaux de porte, calandre, aérations   |
| `loft`    | Sections successives le long d'un axe (ellipse → rectangle arrondi)      | 3–6 stations avec largeur, hauteur, rayon d'angle                                           | carrosseries, bateaux, bouteilles, fuselages         |
| `bevel`   | Arrondi des arêtes par pièce                                             | rayon                                                                                       | tout (reflets doux)                                  |
| `mirror`  | Duplique selon un axe, statut `inferred`                                 | axe                                                                                         | faces arrière et lointaines, pièces symétriques      |

Budget : une instance coûte 2 triangles ; `scatter` ≤ 800 triangles, donc les 5 000 sont tenus. Géométrie dans
`features/vision-insert/utils/generators.ts` (nouveau, pur, testé) ; jumeau serveur pour le rendu plat.

**Famille `plant` (arbre, buisson, palmier, conifère, saule).**

- Fiche : ce que chaque sorte a, proportions usuelles, pièges (la couronne du saule est creuse en bas, le tronc se voit
  jusque dans la couronne).
- Couronne = le contour SAM sert de **volume pour `scatter`**, plus de surface révolue. Franges du bord bas par `drape`,
  pilotées par l'irrégularité mesurée du bord inférieur du contour.
- Tronc = `sweep` avec évasement, largeur mesurée sur le masque à 3 hauteurs, inclinaison tirée du décalage du centroïde.
- Branches = `branch` ; niveaux et retombée choisis par Muse d'après `evidence`, angles bornés par le code.

**Véhicule par `loft`.** Caisse = `loft` par 4–5 stations lues sur le contour de côté ; habitacle = second `loft` en
verre ; passages de roue creusés par `inset` ; roues, rétroviseurs, feux en assemblages. Remplace la boîte + prismes,
raison pour laquelle une voiture se lit comme une dalle.

**Maison.** Débord + bandeau (§7.1), faîtage, embrasures par `inset`, marche, gouttière, soubassement tiré du mot SAM
« stone foundation ».

---

### 7.4 Maisons : toutes les maisons passent par le chemin « dessin 2D » (défaut signalé le 2026-11-11)

**Symptôme.** Une maison issue d'une photo sort avec un pignon sans fenêtre, les mêmes mur de briques et toit d'ardoise
répétés, des ouvertures qui ne suivent pas le plan. Le chemin 2D (élévations mesurées par SAM) donne un bon résultat.

**Cause, vérifiée dans le code.** Sans dessin 2D validé, la maison vient du gabarit du kit : `measuredHouse` /
`steppedHouse` puis `facade()` (`lib/object-kit.ts`). Cette fonction :

- place portes et fenêtres **sur la seule face avant** (`z = 0,505`) : face arrière, pignons et côtés restent nus ;
- ne dépend que de **trois nombres** (`windows`, `doors`, `units`) répartis à égale distance (`spread`) : deux
  maisons au même comptage sont identiques, quelle que soit la photo ;
- ne lit aucune position réelle d'ouverture ; matière et couleur viennent d'un seul rôle par surface.
  Le chemin 2D (`facade-house.ts`) mesure à l'inverse chaque ouverture, ses vitrages, le soubassement, la cheminée, et
  pose des fenêtres latérales (`sideWindows`) depuis une élévation de côté.

**Remède, par ordre de valeur.**

1. **Route par défaut.** Pour `house` et `building`, fabriquer le dessin 2D quand il n'existe pas : Muse Image trace la
   façade propre (action existante « dessiner une façade propre », PQ-T23) et une vue de côté (2 candidats, le plus
   cohérent gardé, E10), puis le chemin d'élévations s'applique. Le gabarit ne sert plus que de repli si le dessin
   échoue. Coût : 2 à 4 images à 0,01 $ plus les appels SAM sur chaque dessin.
2. **Gabarit de repli complet.** Même en repli, ouvertures sur **les quatre faces** : face arrière par miroir de la
   face avant (statut `inferred`), pignons et côtés par une règle dérivée de la profondeur (une à deux fenêtres par
   étage, placées sur la ligne des fenêtres de la face avant), jamais de mur plein de plus de 3 m sans raison
   (porte, mur aveugle indiqué par l'inventaire §5). Une face « absente » doit venir de `anatomy`, pas d'un oubli.
3. **Mesures réelles dans le repli.** Positions et tailles des ouvertures lues sur les masques SAM de la photo
   (`part-masks`, `wall-openings`) au lieu de `spread`, y compris les faces vues de biais.
4. **Variété par mesure, pas par hasard.** Matière, teinte et motif de chaque mur lus sur les régions de la photo
   (E7, `region-colors`, échantillons `photo-swatches`), un jeu par face ; décalage de motif à graine propre à
   l'objet (PQ-T35) pour que deux maisons ne montrent pas la même brique. `RECIPE_MATERIALS` n'a pas `plaster` teinté
   par face : à ajouter via les régions.
5. **Toit soudé aux murs** (défaut signalé le 2026-11-11 : « le toit est scindé des murs »). Dans `measuredHouse`
   le toit est un prisme posé sur une boîte de mur : deux pièces, deux matières, chacune biseautée
   (`EDGE_BEVEL`) et cernée par l'encre, donc une rainure visible à la jonction ; le prisme court sur toute la
   profondeur, si bien que le **triangle du pignon prend la couleur et la matière du toit** au lieu de celle du
   mur ; sans débord le toit est au ras des murs. À faire :
   - **triangle de pignon en matière de mur** : le mur monte jusqu'au faîtage (extrusion pentagonale de la face
     pignon) et le toit n'est que les deux pans, avec débord (§7.1) ;
   - **jonction sans rainure** : pas de biseau ni d'encre sur l'arête mur / toit, le pan descend de la hauteur du
     bandeau de rive sur le haut du mur (léger recouvrement, pas de jour) ;
   - **toit d'une seule pièce** quand le plan 2D donne un toit continu (pans et faîtage dans le même composant) ;
   - contrôle : rendu du modèle de profil à 90° et 45° ; une bande verticale unie entre mur et toit, ou une
     arête mur / toit visible sur plus de la moitié de sa longueur, compte comme jonction ouverte (étend
     `bandDifference`, PQ-T36).
6. **Contrôle.** Le score ajoute **toutes les faces** : une face sans ouverture alors que `anatomy` en annonce (ou que
   la face opposée en a) compte comme pièce manquante ; la planche tournante (§9.1) la rend visible.
   Réussi quand : trois maisons différentes donnent trois modèles différents, et aucune des quatre faces n'est nue sans
   raison.

## 8. Représentation par champ de distance (SDF) — à construire

Réponse à l'étape 2 du modeleur pour les formes lisses (personne, animal, fruit, bouteille, rocher) que ni boîtes ni
tours de révolution ne rendent.

- **Principe.** Le modèle liste ≤ 12 primitives lisses (sphère, capsule, ellipsoïde, boîte arrondie) avec leur
  position, leur taille relative et un rayon de fusion `k`. Le code calcule l'union douce de leurs champs de distance
  et en extrait un maillage (marching cubes) à **résolution fixe**.
- **Pourquoi c'est compatible.** Les paramètres sont des nombres bornés dans un schéma Zod : ce n'est pas du code.
  La fusion douce donne des jonctions organiques (cou, cuisse) qu'aucune union de solides n'offre.
- **Calage.** Positions et tailles ajustées au contour par `nelder-mead` comme le reste ; couleur par région depuis
  `region-colors` ; la photo n'est pas plaquée.
- **Budget (à mesurer).** Une grille de 32³ donne plus de triangles que l'ordre de grandeur des 5 000 : prévoir
  24³ ou une décimation, puis mesurer. Calcul ≤ 300 ms à vérifier.
- **Limite.** Ressemblance de personne ou d'animal non promise ; l'objet est annoncé comme une reconstruction
  simplifiée.

---

## 8bis. Code écrit par Muse Wonder dans un bac à sable (voie B) — décidé, à construire

La boucle d'un modeleur appliquée au modèle : **écrire le code → l'exécuter → rendre → comparer à la photo →
corriger le code → ne garder que les gains.**

**Modèle.** `muse-wonder-1.0` (variable `META_CODE_MODEL`, défaut = `META_REFINE_MODEL`), effort `high`. Spark reste
pour l'inventaire et les questions courtes. Repli sur Spark si Wonder échoue. « Wonder full » : si l'API expose une
variante plus grosse, elle se règle par cette seule variable ; **à vérifier** sur la liste de modèles de l'API.

**Contrat.** Wonder écrit le corps d'une fonction `build(api, params)` en JavaScript. `api` n'expose que :
`box, cylinder, sphere, lathe, extrude, hull`, les générateurs de §7.3 (`sweep, branch, scatter, drape, loft, inset,
mirror, bevel`), `sdf` (§8), `material`, `rng` (graine fixe). Elle renvoie un graphe de pièces au format du
ShapeScript compilé.

**Bac à sable.**

- Interpréteur isolé : **QuickJS compilé en WebAssembly** (`quickjs-emscripten`). Pur WASM, sans module natif : le
  même paquet tourne sur **Vercel** (fonction Node, sans binaire à compiler) et sur **OVHcloud** (VPS ou conteneur).
  Jamais `eval`, jamais le module `vm` de Node, jamais un worker avec accès réseau.
- Aucun accès : réseau, fichiers, `process`, horloge, import ; `Math.random` remplacé par `rng` à graine fixe.
- Limites dures, comptées sur l'exécution du code généré (pas sur l'attente de Meta) : mémoire, instructions
  (interruption par compteur), ≤ 5 000 triangles, ≤ 800 instances, ≤ 64 appels d'API. Dépassement = essai raté,
  l'ancien modèle reste.
- Sortie validée par le schéma Zod des pièces avant d'atteindre le viewer ou le rendu plat.
- Une exécution par requête, dans un module serveur (`server-only`) ; le code de l'utilisateur final n'entre jamais.

**Hébergement et tours : ce qui existe déjà est réutilisé.** Le pipeline sait déjà couper une boucle de fond en
tranches et la reprendre : `stage-slices.ts` (`runStagesSlice`), `stage-checkpoint.ts` (point de reprise validé par
Zod, ≤ 4 Mo, posté en retour par le navigateur) et `shape-jobs.ts` (flux SSE rejouable). La voie B s'y branche comme
une étape de plus, sans nouvelle infrastructure.

| Question ouverte               | Réponse retenue                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taille du paquet WASM          | `quickjs-emscripten` 0.32.0 pèse 2,4 Mo décompressé, toutes variantes comprises (mesuré sur le registre npm le 2026-11-11). On n'embarque qu'**une** variante (`release-sync`, moins d'un Mo) : très loin de la limite de fonction. À confirmer au build (`outputFileTracingIncludes` pour le fichier `.wasm`). |
| Durée d'un tour                | Un tour = un appel Wonder (secondes à minutes, c'est le poste dominant) + exécution du code (ms) + rendu plat et score (≈ 100 ms). Le bac à sable n'ajoute rien de mesurable : le coût est celui de Meta.                                                                                                       |
| Stockage de l'état entre tours | **Aucun nouveau stockage : pas de Neon, pas de migration.** L'état vit dans le point de reprise porté par le navigateur, comme les étapes actuelles (champ `code` ≤ 64 Ko, `round`, meilleur score, graine). Le serveur reste sans mémoire.                                                                     |
| Limite de temps                | **Aucune limite dans le code.** Seule la limite de l'hébergeur (`maxDuration` 300 s sur Vercel) découpe le travail, jamais un budget de pipeline.                                                                                                                                                               |

**Enchaînement.**

- **Vercel** : `runStagesSlice` lance autant de tours que la requête en permet (pas « un tour par invocation »). Un
  tour démarre s'il reste `STAGE_ROUND_RESERVE_MS` ; la tranche s'arrête `STAGE_SLICE_MARGIN_MS` avant la coupure et
  émet `shape_stages_checkpoint` ; le navigateur reposte, la requête suivante reprend au même tour.
- **OVHcloud** : processus long, `limitMs = Infinity` : la boucle tourne d'un trait, sans point de reprise. Même code.
- **Reprise sans stagnation** : `STAGE_MAX_STALLS` tranches sans tour terminé arrêtent la boucle (anti-boucle morte,
  pas une limite de temps).
- Le point de reprise est validé comme toute entrée du navigateur (taille, schéma). Un `code` falsifié ne peut rien
  de plus que le bac à sable le permet : mêmes limites mémoire, instructions et appels d'API.
- **Optimisations du bac à sable** : module WASM instancié **une fois par processus** et gardé en cache ; un contexte
  QuickJS neuf par exécution (isolation) ; `setMemoryLimit`, `setMaxStackSize` et un gestionnaire d'interruption par
  compteur d'instructions (limite sur le code généré, pas sur l'attente de Meta) ; la fonction `api` est construite
  une fois et réutilisée ; le patch remplace des blocs au lieu de renvoyer le fichier entier (moins de jetons, donc
  des tours plus courts).
- **À mesurer au build** : démarrage à froid avec le WASM, mémoire de la fonction, taille du point de reprise avec le
  code. Ces trois mesures n'ont pas été faites : seules les 2,4 Mo du paquet le sont.

**Modeleur d'abord (PQ-T58).** Sur la maison avec dessin 2D, la voie B passe **avant** les étapes Spark : Wonder reçoit la
planche dessin | modèle | différence, le cadre mesuré en unités d'objet (`elevationFrameText` : chaque ouverture en
`at/size`, chaque contour de toit en anneau `extrude` prêt à coller) et le prompt v3 (regarder → volumes → formes
secondaires → détails → vérifier). Arrêt dès que le score d'élévation atteint 0,90 (`CODE_GOAL_ELEVATION`) ou après
3 tours sans gain. Si le code gagne, les étapes Spark ne tournent pas (elles retoucheraient des pièces de gabarit et leur
fond écraserait le modèle du code) ; elles restent le repli. Le prompt v3 est le défaut des deux chemins.

**Étalon sur les pixels du dessin (PQ-T59).** Le score d'élévation suppose une seule ligne d'égout et un rectangle de mur :
une maison à plusieurs volumes bien construite y perdait contre le gabarit. La voie B se note donc sur le dessin lui-même
(`drawing-score.ts`) : `0,5 × IoU (zone dessinée vs silhouette du modèle) + 0,2 × couleur + 0,3 × ouvertures mesurées`.
La planche envoyée à Wonder montre dessin | modèle | différence (rouge = dessiné non construit, bleu = construit non
dessiné), et la question porte la **ligne de toit mesurée** en 24 stations (`skylineText`) : où commence chaque volume, sa
hauteur, le sens de chaque pente. Sans image du dessin, repli sur le score d'élévation.

**Chemin photo (PQ-T57).** La voie B tourne aussi pour tout objet de la photo (hors `water`), après le gabarit ajusté et
la boucle d'étapes : Wonder reçoit la planche photo | rendu courant, le score détaillé, les pièces vues et l'anatomie
`present`, avec le prompt v2 (familles). Même étalon que le brouillon (silhouette, contours, couleur, masques, anatomie),
≤ 3 tours (`PHOTO_CODE_ROUNDS`), gain ≥ 0,005 ou le brouillon reste ; lacet, teintes de mur et statuts restent ceux du
brouillon. Le tour est inline (pas encore en fond) : il allonge la première réponse d'environ 70 s par tour.

**Débogage du code généré (PQ-T56).** Chaque objet passé par la voie B écrit un dossier
`debug/shape-code/<date>-<objet>/` (ignoré par git ; `SHAPE_CODE_DUMP_DIR`, `off` pour couper) : `draft.blender.py`
(gabarit A), puis par tour `round-N.build.js` (le `build()` écrit par Wonder), `round-N.blender.py` (le modèle qu'il
construit, maillage identique au viewer, rejouable dans Blender), `round-N.question.txt`, `round-N.json` (score, gardé,
raison du rejet, durées, coût), `final.*` si un tour gagne, `summary.json`. `make code-dump` affiche le dernier,
`make blender-render F=…` le rend sans interface. Les logs `[vision] 3D route B …` et `3D code round …` disent
pourquoi un tour est écarté (aucun code, échec d'exécution, pas de gain avec les deux scores). Le writer reçoit aussi
les boîtes mesurées de l'élévation 2D (toit, égout, chaque ouverture) : il place les ouvertures dessus, pas à égale distance.

**Boucle de raffinage.**

1. Wonder reçoit la photo, le rendu courant (face et ¾), le score détaillé, l'anatomie manquante (§5) et le code
   courant.
2. Il renvoie un **patch** (remplacement de fonctions ou de blocs), pas le fichier entier : moins de jetons, moins de
   régressions.
3. Le serveur exécute dans le bac à sable, rend à plat (E9), score.
4. Gain ≥ 0,005 : on garde ; sinon retour arrière. Arrêt : 3 tours sans gain, plateau, ou critères de §9 atteints.
5. Le code final est stocké avec la capture (version de prompt, graine) : **rejouable sans appeler Meta**, donc
   testable en offline comme les captures actuelles.

**Position dans le pipeline (tous les objets).**

1. **Brouillon** : le gabarit réglé par le kit (voie A) s'affiche dès que kit et contour existent.
2. **Code propre à l'objet** : Wonder écrit `build()` à partir de la photo, de `evidence`, de `anatomy` (§5) et des
   mesures (E3, E6, E7), puis le raffine par patchs. Il décide lui-même ce qu'un gabarit figeait : débord et pente
   du toit, nombre et position des fenêtres sur **chaque face**, forme du houppier, calandre, rétroviseurs.
3. **Remplacement sur gain** : le modèle du code remplace le brouillon dès qu'il score mieux ; sinon le brouillon
   reste. Le code ne retarde jamais l'affichage.
4. **Le gabarit n'est plus que** un point de départ passé à Wonder (« voici une base, refais-la pour cet objet »),
   la bibliothèque de l'`api` (primitives, générateurs) et le repli si le code échoue.

**Observer, pas deviner.** Chaque valeur que le code choisit doit s'appuyer sur une observation : le prompt oblige
Wonder à citer la mesure ou la zone de la photo qui la justifie (`// débord: ligne de toit mesurée 6 % plus large
que le mur`), et le score vérifie le résultat. Sans observation possible (face cachée), la valeur est imaginée
**d'après le modèle de l'objet** (un chaume déborde plus qu'une tuile, une maison à colombages moins) et marquée
`inferred`.

**À mesurer (`make eval-shape`, coûte des appels).**

- Taux de code valide (s'exécute, respecte les limites, passe Zod) avec Wonder.
- Gain de score face à la voie A sur le saule, la voiture et la maison, à coût égal.
- Durée d'un tour sur Vercel et sur OVHcloud.

**Garde-fous qui restent.** Aucune valeur d'énergie ne sort d'un modèle ; la photo n'est pas plaquée ; modèles Meta
seulement ; une barrière dure (contour, pièce d'anatomie manquante) n'est jamais levée par l'avis d'un modèle.

---

## 9. Critères d'arrêt

Un modèle est bon quand, sur de **vraies photos** :

| Mesure                        | Seuil                                                     |
| ----------------------------- | --------------------------------------------------------- |
| IoU silhouette                | ≥ 0,85                                                    |
| F1 contours extérieurs        | ≥ 0,6                                                     |
| Couleur ΔE                    | ≤ 8                                                       |
| Rappel / précision des pièces | ≥ 0,8 chacun (avec masques)                               |
| F1 contours intérieurs        | ≥ 0,12                                                    |
| ΔE par pièce                  | ≤ 7                                                       |
| Anatomie (à construire)       | toute pièce `present` est construite                      |
| Vues 45° / 90°                | ni mince ni détaché                                       |
| Juge Wonder                   | ≥ 4 / 5 en moyenne, aucun critère < 3 (après calibration) |
| Triangles                     | ≤ 5 000                                                   |

Fin de boucle : tous atteints, ou 3 tours sans gain sur le même objet (rapporté avec la planche et la cause).

### 9.1 Rendre les imperfections visibles

- **Rappel d'anatomie** dans `detail-score.ts` : un modèle sans lunette arrière score plus bas sur une capture réelle.
- **Jeu réel** (PQ-T1) : ≥ 12 photos dont saule, voiture de trois quarts, maison à toit en croupe, rangée de maisons.
  Chaque défaut signalé devient une capture + une ligne de fiche.
- **Planche tournante** dans `make shape-report` : modèle à 0° / 90° / 180° / 270° à côté de la photo.
- **Calibration du juge** (PQ-T4, jamais lancée) : c'est le seul correcteur de « ça ressemble ».
- **Évaluation par version de prompt** (PQ-T5) : un changement de fiche se mesure, il ne se ressent pas.

---

## 10. Rendu qui se lit comme du détail

Déjà prévu (méthodologie §11.3, R1–R9) : occlusion ambiante et une ombre douce (PQ-T33), émissif des lampes et écrans
(PQ-T34), répétition des textures (PQ-T35), mêmes matières en VR et dans le village (PQ-T32), plages PBR (PQ-T39 :
ajouter `painted`, métal = 0 ou 1). Peu coûteux et visible : **matière verre avec un léger reflet** pour les vitres
une fois §7.1 faite.

---

## 11. Coût par objet (tarif standard de la page Model API enregistrée)

| Modèle     | Prix                                    | Appels typiques par objet                                                             |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Spark 1.3  | 1,25 $ / M jetons entrée, 4,25 $ sortie | 1 détection, 1–2 kits, 0–3 critiques, ≤ 12 tours d'étapes, quelques gros plans courts |
| Wonder 1.0 | 4,00 $ entrée, 20,00 $ sortie           | 1 contrôle final ; juge hors ligne                                                    |
| SAM 3.1    | 2,50 $ / 1 000 images                   | ≤ 6 contour + 1 par concept de pièce                                                  |
| Muse Image | 0,01 $ / image                          | 0 ou 2 (vue de côté), jusqu'à 6 pour la planche de trois vues                         |

La dépense est dominée par les tours Spark et Wonder : multiplier les appels SAM et les questions courtes coûte peu.

---

## 12. Ordre d'implémentation

Une tâche = un commit, avec son test Vitest, sa mise à jour de `contracts.md` et son scénario manuel.
Les identifiants PQ continuent après PQ-T41 dans `docs/tasks/PV-vision-quality.md`.

- [ ] **1. Durées par étape** dans les logs et le SSE (E12). Sans elles, tout le reste se devine.
- [ ] **2. Gabarits** : vitrages du véhicule, débord + bandeau, biseau des toits à croupe (§7.1) ; **maisons sur les quatre faces** (§7.4, remède 2).
- [ ] **2bis. Maisons par le chemin 2D par défaut** (§7.4, remèdes 1, 3, 4).
- [ ] **2ter. Bac à sable de code, chemin principal pour tous les objets** (§8bis) : `api` de construction (primitives actuelles d'abord, générateurs ensuite) + QuickJS WASM + limites + `build()` écrit par Wonder pour chaque objet, brouillon de gabarit remplacé sur gain, boucle de patchs, code stocké avec la capture. Commence par la maison (§7.4) : débord, ouvertures des quatre faces et jonction toit / mur sortent du code, pas du gabarit.
- [ ] **3. `anatomy`** dans le schéma du kit, les cartes et le score (§5, E5, E9).
- [ ] **4. Type d'image, famille de représentation et aiguillage** (§4), dont le refus motivé et la question à
      l'opérateur sous 0,82.
- [ ] **5. Nouveaux types de détail** + assemblages, identiques dans le visualiseur et le rendu du juge (§7.2).
- [ ] **6. Parallélisme, brouillon / raffinage, cache** (E12).
- [ ] **7. Générateurs organiques** `sweep, branch, scatter, drape` + famille `plant` (§7.3).
- [ ] **8. `loft`** pour les véhicules, **`inset`** pour les embrasures (§7.3).
- [ ] **9. Question courte par pièce**, critique sur l'anatomie, planche de trois vues (E9–E11).
- [ ] **10. SDF** pour les formes lisses (§8), après mesure du budget de triangles.
- [ ] **11. Jeu réel ≥ 12 photos**, calibration du juge, planche tournante (§9.1).
- [ ] **13. Évaluation chiffrée** de B contre le brouillon A (saule, voiture, maison, un appareil) et durée d'un tour sur Vercel et OVHcloud.

Vérification à chaque pas : `make test-shape` · `make shape-report` (table « Real ») · `make eval-shape MODEL=…`
(coûte des appels) · `make shape-shots` + `/designer-3d` · `make check`.

---

## 13. Risques et limites qui restent

- Les générateurs donnent un saule **plausible**, pas une copie de ce saule : la fidélité à la feuille près demande un
  vrai générateur de maillage, que l'API Meta ne propose pas.
- Plus de pièces = plus de triangles et de coût de rendu : le budget en triangles, pas un nombre de pièces, est le plafond.
- Un critique peut casser un modèle qui marche : tout changement reste soumis à « ne garder que les gains ».
- Chaque nouvelle opération demande ses tests, son jumeau de rendu plat et la mise à jour des docs dans le même commit.
- Les faces non visibles restent déduites, jamais mesurées.

---

## 14. Décisions ouvertes (à trancher par l'utilisateur)

1. **Modèles Meta à poids ouverts, hors API.** Meta a publié des modèles qui reconstruisent de la 3D depuis une image
   (SAM 3D Objects) ou estiment profondeur et caméras (VGGT), et DINO pour comparer rendu et photo. Ils ne sont pas sur
   l'API Meta : il faudrait un serveur GPU et un exécutable de modèle dans le projet. Ils respectent « modèles Meta
   uniquement » dans l'esprit, pas dans la lettre. **Non vérifié ici** (licence, taille, qualité sur nos photos) : à
   contrôler avant toute tâche. Ce serait la seule voie vers un vrai maillage plutôt qu'une reconstruction paramétrique.
2. **`reasoning_effort`** : valeurs réellement acceptées par l'API, à mesurer avant de baisser un appel (PQ-T17).
3. **Plafond de pièces** : passer de 12 pièces à un budget de triangles change `contracts.md` et les tests dorés.
4. ~~Budgets du fond~~ : décidé le 2026-11-11, **aucune limite de temps** (voir E12, point 7).
5. **Blender sans interface** comme outil hors ligne (rendus de référence, validation de maillage) : ajoute un
   exécutable au dépôt pour un gain réservé aux évaluations ; non recommandé avant les étapes 1 à 8.
6. **Modèle de code** : `muse-wonder-1.0` retenu. Liste `/models` relevée le 2026-11-13 : `muse-ember-1.0, muse-wonder-1.0, sam-3.1, muse-spark-1.1/1.2/1.3 (+contributor), muse-voice-transcribe-1.0, muse-image-1.0` : **aucune variante « full » de Wonder n'existe**. `META_CODE_MODEL` la prendra le jour où elle paraît.
7. ~~Enchaînement des tours sur Vercel~~ : décidé, point de reprise porté par le navigateur (§8bis), pas de Neon.
