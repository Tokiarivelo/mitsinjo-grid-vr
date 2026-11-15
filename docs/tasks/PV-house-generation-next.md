# Génération 3D des maisons — limites actuelles et pistes d'amélioration (brief pour Claude Fable)

> Brief autonome. Lis d'abord `CLAUDE.md`, `HANDOFF.md`, puis ce fichier. N'ouvre les autres docs que si
> une tâche ci-dessous les nomme. Branche de départ : `feat/pq-t73-house-parts` (PQ-T67 → PQ-T73, pas
> encore sur `main` : crée ta branche depuis elle, `feat/pq-t74-<slug>`).

## 1. Ce qui existe (état au 2026-11-14)

Chaîne : photo → (Muse Image) 5 dessins 2D validés (face, droite, arrière, gauche, dessus) → reconstruction
par les vues (`server/perception/recon/`) → **lecture de la maison** → `recipe.house` (`HousePlan`) →
maillage pur `houseMesh` → viewer 3D / village / export Blender.

Lecture de la maison (PQ-T73, piloté) :

| Étape                                             | Fichier                                                                      | Rôle                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilote (`housePilot`, effort medium)              | `house/house-tools.ts` (`PILOT_*`, `parseBrief`)                             | type de bâtiment, étages, pièces vues, note par spécialiste                                                                                                      |
| Spécialistes (`houseTool`, effort high, streamés) | `house/house-tools.ts` (`HOUSE_TOOL_SPECS`)                                  | `massing` (volumes, toits, finitions, arcades, fermes), `openings` (têtes), `structure` (piliers, cheminées), `finishes` (matériau, couleur, zone d'échantillon) |
| Orchestration                                     | `house/house-specialist.ts` (`readHouseParts`, `readHousePlan`)              | parallèle, relance unique, délai 12 min/appel, repli sur la lecture unique PQ-T72 si pas de massing ou d'ouvertures                                              |
| Fit (pur)                                         | `house/house-fit.ts` (`fitHouse`, `fitPiers`, `sampleColor`, `housePatches`) | parts d'image → repère modèle, accroche sur les pixels, couleurs et échantillons mesurés                                                                         |
| Plan                                              | `lib/house-plan.ts`                                                          | schéma Zod : volumes, ouvertures, cheminées, piliers, look + finitions                                                                                           |
| Maillage (pur)                                    | `lib/house-mesh.ts`                                                          | murs percés, têtes cintrées, arcades, piliers, fermes, galeries, toits par volume                                                                                |
| Rendu                                             | `features/vision-insert/utils/house-projection.ts` (`houseSlotLooks`)        | un matériau par emplacement (`HOUSE_SLOTS`), échantillons répétés                                                                                                |

Contrats : `docs/contracts.md` (paragraphe `ObjectRecipe.house?` + « PQ-T73 additions »). Détail des appels :
`docs/copilot.md` (« House specialist » et « Part specialists, piloted »).

## 2. Outils de travail (ne pas réinventer)

```bash
# Rejouer une lecture sauvegardée : gratuit, hors ligne, déterministe
make views-3d FRONT=… RIGHT=… BACK=… LEFT=… TOP=… OUT=dir LABEL=house OFFLINE=1 READING=house-reading.json MATERIALS=wood,slate
# Lecture live (coûte 1 + 3–4 appels Spark) ; SINGLE=1 = ancienne lecture unique PQ-T72
make views-3d FRONT=… … OUT=dir LABEL=house          # LABEL doit être "house" (sinon pas d'archétype maison)
make views-3d PHOTO=photo.jpg OUT=dir LABEL=house     # Muse Image dessine les vues (coûteux, réseau instable)
# Capture du vrai viewer (le serveur de dev doit tourner : make dev, port via make port)
SHOT_SCALE=2 SHOT_DRAG=50,10 pnpm --filter web exec node scripts/object-viewer-shot.mjs http://localhost:<port> <dir> <dir>/viewer
```

`SHOT_DRAG` : x puis y ; un y négatif baisse la caméra (attention : sous l'avant-toit d'une varangue, on ne voit
pas le toit). Tests ciblés : `house-mesh.test.ts`, `house-fit.test.ts`, `house-tools.test.ts`,
`house-projection.test.ts`.

**Banc de maisons** (`~/Téléchargements/generated-view/`, chaque dossier a `view-*.png`, `house-reading.json`,
`maison-3d*.jpg`) :

| Dossier                                                                                                 | Type                                            | Lecture sauvegardée                                                     | Remarque                            |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| `lodge-stone-t73` (dessins dans `~/Téléchargements/2D` : face, dtoit = droite, arrière, gauche, dessus) | lodge pierre et bois                            | `house-reading.json` (piloté)                                           | cas du bug d'origine                |
| `bungalow`                                                                                              | bungalow brique                                 | `house-reading-single.json` (PQ-T72), `t73/house-reading.json` (piloté) | **référence anti-régression**       |
| `school`                                                                                                | école en bardage blanc                          | idem                                                                    | **référence anti-régression**       |
| `mg-arcades`                                                                                            | maison malgache à galeries arcadées (2 niveaux) | `house-reading.json`                                                    | pas de vue gauche / dessus (réseau) |
| `mg-varangue`                                                                                           | maison bois à varangue cintrée                  | idem                                                                    |                                     |
| `mg-balcony`                                                                                            | maison 2 niveaux, galerie + bloc blanc          | idem                                                                    | résultat le plus faible             |
| `mg-earth`                                                                                              | maison en terre, chaume                         | idem                                                                    |                                     |

Ajoutées en PQ-T74 (photos `resources/refine-3d/h-*.jpg`, dossiers `h-*` avec `house-reading.json`, `t74/house.json`,
`maison-3d-t74.jpg` ; planche d'ensemble `t74-sheet.jpg`) : `h-thatch` (chaumière), `h-fachwerk` (colombages ; rejouer
`house-reading-figured.json`), `h-stilt` (bois sur rez-de-chaussée enduit), `h-logcabin` (rondins ; rejouer
`house-reading-patched.json`), `h-aframe`.

`bungalow/house-pq-t72.json` et `school/house-pq-t72.json` = plans produits par le code PQ-T72 sur la lecture
unique : un rejeu `READING=house-reading-single.json` doit redonner **exactement** ce fichier.

## 3. Règles non négociables pour ce travail

- **Zéro régression** sur bungalow et école : (1) les empreintes `meshHash` de `house-mesh.test.ts` restent
  identiques (un plan sans les nouvelles pièces se construit octet pour octet comme avant) ; (2) le rejeu de la
  lecture unique redonne `house-pq-t72.json` ; (3) sur le chemin piloté, compare visuellement au viewer
  (`maison-3d.jpg` d'origine). Toute nouvelle pièce est **optionnelle** dans le schéma.
- Modèles Meta uniquement (Spark, Muse Image) ; pas d'IA tierce. Ne jamais projeter la photo sur le modèle
  (les dessins 2D validés oui). Le moteur reste pur, pas de `Math.random` non seedé.
- Un appel live coûte ; itère sur des **rejeux** (`READING=`) dès qu'une lecture est bonne. Le réseau Meta coupe
  sous charge : une maison à la fois.
- Chaque fonction ou hook livré avec son test Vitest ; doc dans le même commit (`docs/contracts.md`,
  `docs/copilot.md`, tâche dans `PV-vision-quality.md`) ; scénario manuel dans `test-scenarios/06-village.md`
  (suite après V334) ; `HANDOFF.md` à jour. Un commit par tâche, push, une PR pour la phase.

## 4. Limites connues (constatées, avec preuve)

### Lecture (prompts / spécialistes)

1. **Variabilité du massing.** Deux lectures pilotées d'un même bungalow : 8 volumes / 21 ouvertures (lecture
   unique) contre 5 volumes / 17 ouvertures (pilote) ; la véranda avant a disparu. Aucun vote ni contrôle.
2. **Le spécialiste structure confond poteaux bois et piliers** (`mg-varangue` : piliers bois lus comme
   maçonnés) et liste des **socles de poteaux** (`mg-arcades` : 23 « piliers » de 3 % de haut, filtrés par
   `PIER_MIN_TOP`).
3. **Finitions mal attribuées.** L'école lue avec son unique bloc en `wall2` (échantillon sur du contreplaqué
   brun) : corrigé par une règle (le plus grand bloc garde les finitions principales), pas par la lecture.
   `stone` est parfois lu sur des socles sombres (`mg-arcades` : pierre `#242424`).
4. **Pas de contrôle croisé** entre spécialistes : une ouverture peut tomber hors de tout volume ; un pilier
   hors de la varangue qu'il porte ; les hauteurs (eave des volumes, top des piliers) ne sont pas réconciliées.
5. **Balcon sans `floor`** : réparé au fit (posé sur la varangue de même emprise) ; le prompt ne l'exige pas.
6. **Coût / latence** : 1 + 3–4 appels high (≈ 4–8 min), délai 12 min par appel ; un appel bloqué a tenu
   18 min avant l'ajout du délai.

### Géométrie (`house-mesh.ts`)

7. **Lucarnes** = blocs à pignon posés sur le toit (pas de découpe du versant, pas de joue).
8. **Avant-toits retroussés / coyaux, toits à deux pentes différentes, toits en L continus** : un toit par
   volume rectangulaire ; les intersections de toits se chevauchent (pas de noue calculée).
9. **Galerie haute** couverte par une « jupe » plate (`roofedOver` faux) au lieu du prolongement du grand toit.
10. **Arcades** : arc elliptique / segment / console uniquement ; pas d'arc en anse de panier, pas d'imposte,
    pas de clé ; l'épaisseur des écoinçons = profondeur d'un poteau.
11. **Pignon vitré** coupé à la rive (rectangle) ; pas de fenêtre trapézoïdale.
12. **Chaume** rendu comme des planches (`mg-earth`) : pas de matériau `thatch` épais (bord arrondi, épaisseur).
13. **Garde-corps** : une seule forme (lisses + balustres) ; pas de garde-corps plein ni ferronnerie.
14. Plans rectangulaires seulement (pas de pan coupé, pas de tour ronde, pas de plan en biais).

### Couleur / matière

15. Un seul échantillon par finition pour toute la maison ; pas de variation (bas de mur sali, enduit qui change
    d'un étage à l'autre).
16. `timber` retombe sur la couleur `trim` tant qu'aucune finition bois n'est lue ; les garde-corps prennent
    `trim` (rouge sur `mg-varangue` alors qu'ils sont en bois clair).
17. **Petite régression connue du chemin piloté** : la couleur `base` (soubassement, terrasse) n'est jamais
    mesurée, seulement reçue. La lecture unique de l'école donnait un soubassement rouge (`maison-3d.jpg`) ; le
    spécialiste `finishes` l'a omis → gris par défaut (`school/t73/maison-3d-t73.jpg`). À corriger en premier (piste D).

### Vues d'entrée

18. Muse Image peut ne pas dessiner une vue (réseau) : `mg-arcades` sans vue gauche ni dessus → profondeur et
    toits moins sûrs. Des vues qui se contredisent (face vs dessus) déplacent des blocs (`house-detached`).

### Traité en PQ-T74 (2026-11-14)

Limites 12 (chaume : bord épais + motif de brins), 17 (soubassement mesuré), une partie de 15 (rez-de-chaussée d'un autre
revêtement : `HouseVolume.lower`), 4 en partie (bande d'emprise absorbée par le bloc, pente d'annexe bornée) et 18 en
partie (repli complété par les spécialistes qui ont répondu). Nouveau : murs à motif (`figured`, colombages), échantillon
oblique écarté, cheminées en maçonnerie, modèle conservé au-delà de 96 pièces.

PQ-T75 : pignon déduit des fenêtres dessinées au-dessus de l'égout (`gableEnds`, colombages) ; revêtement bas aussi
derrière une varangue et dans un renfoncement (pilotis).

Restent ouverts : vues Muse incohérentes entre elles (cabane : pignon dessiné sur les quatre faces ; chaumière : ailes
arrière inventées sur la vue de dessus) — il faudrait un contrôle des vues avant la lecture et un redessin ; porte élargie
par l'accroche sur des plaques voisines (cabane) — borner `snapOpening` change les fenêtres du bungalow de référence,
à reprendre avec une nouvelle référence validée ; demi-croupes et lucarnes « sourcil » du chaume.

## 5. Pistes d'amélioration, par priorité

Chaque piste : critère d'acceptation mesurable + test + rejeu sur le banc. Ne passe à la suivante qu'une fois
bungalow et école vérifiés.

**P1 — Fiabilité de la lecture (le plus rentable)**

- **A. Critique / réconciliation** : un appel `review` (ou une passe pure) après la fusion : chaque ouverture dans
  un volume, chaque pilier sous un volume ouvert, `eave` cohérents entre volumes voisins, nombre d'ouvertures
  par face comparé à une détection pure sur les pixels (`snapOpening` existe). Accepté si, sur 3 rejeux live du
  bungalow, le nombre d'ouvertures varie de ≤ 2 et la véranda est toujours présente.
- **B. Vote massing** : 2 massings en parallèle (seeds / températures différentes si l'API le permet), garder les
  volumes présents dans les deux (IoU de plan ≥ 0.5) ou le plus proche de la silhouette (`outlineHeights`).
- **C. Prompts** : exiger `floor` pour un balcon ; exemples courts « poteau bois ≠ pilier maçonné ≠ socle » ;
  demander pour chaque pilier la vue où il est le mieux vu. Versionner `HOUSE_TOOLS_PROMPT_VERSION` et mesurer
  avant / après sur les 7 maisons (garde la mesure dans la tâche).
- **D. Couleurs** : rejeter un échantillon dont la couleur s'écarte trop de la couleur dominante de sa zone
  (`dominantColor`) ; mesurer `base` (soubassement) et `timber` au lieu de les recevoir.

**P2 — Géométrie**

- **E. Toits** : noues / arêtiers entre volumes qui se croisent (intersection de plans), prolongement d'un grand
  toit sur une galerie (`roofedOver`), coyau (eave relevé) comme option de toit.
- **F. Lucarnes** : volume `dormer` qui découpe le versant porteur (joues + petit toit), au lieu d'un bloc posé.
- **G. Pignon vitré / fenêtres sous rampant** : ouverture trapézoïdale suivant `topLine`.
- **H. Matériaux** : `thatch` épais (rive arrondie, épaisseur), garde-corps plein / ferronnerie
  (`rail: 'balusters' | 'solid' | 'iron'`), soubassement de couleur propre.

**P3 — Coût et robustesse**

- **I.** Mesurer le coût réel par maison (usage loggé par `visionJson`) et la latence par spécialiste ; essayer
  `openings` et `finishes` en effort `medium` (mesure avant / après, cf. `effort.ts`).
- **J.** Si une vue manque, redemander son dessin une fois avant de reconstruire.

## 6. Définition de « fini » pour une piste

- Tests Vitest verts (`pnpm --filter web test -- house`), typecheck, lint sans erreur.
- Empreintes `meshHash` inchangées ; rejeu `READING=house-reading-single.json` de bungalow et école =
  `house-pq-t72.json` (`cmp`).
- Captures viewer avant / après de la ou des maisons concernées, posées dans leur dossier
  (`maison-3d-<tâche>.jpg`) et décrites dans la tâche.
- Docs + scénario manuel + `HANDOFF.md` mis à jour ; commit conventionnel `feat(perception): … (PQ-T7x)`.
