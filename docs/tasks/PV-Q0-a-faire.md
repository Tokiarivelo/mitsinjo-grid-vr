# PV-Q phase Q0 — ce qui reste à faire (guide pas à pas)

Q0 = « Mesurer la vérité d'abord ». Le code de toutes les tâches est fait (PR #9). Il reste quatre cases non
cochées dans `docs/tasks/PV-vision-quality.md`, parce qu'elles ont besoin de **vous** : des photos réelles,
des appels payants à l'API Meta, ou une autre tâche pas encore faite.

| Tâche  | Bloquée par                      | Coût API | Ordre     |
| ------ | -------------------------------- | -------- | --------- |
| PQ-T1  | vos photos                       | oui      | 1         |
| PQ-T4  | appels Muse Wonder               | oui      | 2         |
| PQ-T6  | les résultats de PQ-T1           | non      | 3         |
| PQ-T37 | PQ-T12 (phase Q1) + une tâche UI | non      | plus tard |

---

## 0. Préparer la machine (une fois)

1. Réparer `node_modules` (il est cassé depuis que le disque a été plein) :
   ```bash
   make install
   ```
2. Dans `.env` à la racine (jamais commité) :
   ```bash
   LLM_PROVIDER=meta
   META_API_KEY=…          # votre clé Meta
   META_JUDGE_MODEL=muse-wonder-1.0   # facultatif, c'est la valeur par défaut
   ```
   Avec `LLM_PROVIDER=mock`, `make shape-capture` et `make shape-judge` refusent de tourner.
3. Vérifier : `make check` doit passer.

---

## 1. PQ-T1 — Le jeu de photos réelles

**But :** au moins 12 vraies photos capturées, pour que le rapport note le pipeline 3D sur du réel et non
seulement sur nos dessins synthétiques (aujourd'hui : moyenne réelle 60 contre 93 en synthétique).

### Déjà capturées

| id             | État                                                  |
| -------------- | ----------------------------------------------------- |
| `lamp`         | ✓ capturée (score 32, 4 bandes vides)                 |
| `refrigerator` | ✓ capturée (score 92)                                 |
| `fan`          | ✓ capturée (score 55, se casse en 2 morceaux à 45°)   |
| `TV`           | ✗ **à refaire** : la capture n'a pas de contour (SAM) |

### À capturer (12)

L'`ID` doit être **exactement** l'un de ceux-ci (c'est le nom du fichier que le rapport cherche) :

| ID             | Photo à prendre                          | Difficulté exigée    |
| -------------- | ---------------------------------------- | -------------------- |
| `car-side`     | une voiture vue de côté                  |                      |
| `car-corner`   | une voiture vue d'un coin avant          |                      |
| `car-hidden`   | une voiture en partie cachée             | **cachée ≥ 30 %**    |
| `motorbike`    | une moto                                 |                      |
| `house-front`  | une façade de maison                     |                      |
| `house-row`    | une rangée de maisons                    |                      |
| `hut`          | une case au toit de chaume               |                      |
| `utility-pole` | un poteau électrique                     | **petit : < 150 px** |
| `pump`         | une pompe à eau ou un groupe électrogène |                      |
| `water-tank`   | un réservoir d'eau                       |                      |
| `solar-panel`  | un panneau solaire                       | **à contre-jour**    |
| `tree`         | un arbre                                 |                      |

Conseils photo : l'objet entier dans l'image (sauf `car-hidden`), JPEG ou PNG, pas de retouche. Pour
`utility-pole`, prenez-le de loin pour qu'il fasse moins de 150 pixels de haut dans l'image.

### La commande

```bash
make shape-capture PHOTO=chemin/vers/photo.jpg ID=car-side
```

Ce que ça fait : appelle Muse Spark (détection, kit, contour SAM, parties), puis écrit dans
`apps/web/src/server/perception/__fixtures__/shape/real/` (dossier gitignoré, vos photos restent locales) :

- `<ID>.capture.json` — tout ce que le modèle a répondu (rejouable hors ligne, sans API ensuite)
- `<ID>.crop.jpg` — le recadrage de l'objet

**Choisir l'objet sur la photo :** la commande prend, dans l'ordre : la détection dont l'id est `LABEL`
(ou l'`ID`), sinon **la plus grande** dont le libellé contient ce mot, sinon le premier mot de l'`ID`
(`car-side` → « car » → « police car »). Elle affiche son choix : `[vision] capture car-side picks det-1
(police car)`. Les photos sont dans `resources/real-photos/` :

```bash
make shape-capture PHOTO=./resources/real-photos/car-side.jpg ID=car-side
make shape-capture PHOTO=./resources/real-photos/car-corner.jpg ID=car-corner LABEL=sedan
```

Si rien ne correspond, la commande s'arrête et **affiche la liste des détections trouvées** : relancez avec
un `LABEL=` pris dans cette liste (un id comme `LABEL=det-1`, ou un morceau de libellé entre guillemets
s'il y a un espace : `LABEL="police car"`).

**Attention :** relancer un `ID` déjà capturé écrase sa capture et recoûte des appels API.

### Refaire `TV`

La capture actuelle n'a pas de contour : supprimez-la, puis recapturez avec une autre photo (télé bien
détachée du mur, écran pas trop sombre) :

```bash
rm apps/web/src/server/perception/__fixtures__/shape/real/TV.*
make shape-capture PHOTO=tele.jpg ID=TV LABEL=tv
```

### Vérifier

```bash
make shape-report
```

Ouvrez `test-results/shape-report/` : le tableau **« Real »** doit avoir **≥ 12 lignes**. Les ids pas encore
capturés apparaissent dans « missing », ceux sans contour dans « not scorable ». Une capture « not scorable »
→ recommencez avec une autre photo.

### Cocher PQ-T1

1. Copier la moyenne et les lignes du tableau « Real » dans le journal de boucle de
   `docs/tasks/PV-shape-realism.md` (une ligne datée : « PQ-T1 baseline réelle … »).
2. Cocher `PQ-T1` dans `docs/tasks/PV-vision-quality.md`.

(Ou dites-moi « photos faites » : je lance le rapport, j'écris le journal et je coche.)

---

## 2. PQ-T4 — Peut-on faire confiance au juge ?

**But :** le juge (Muse Wonder) note chaque modèle 3D de 1 à 5 sur six critères (silhouette, proportions,
parties présentes, parties bien placées, surfaces, ressemblance). Avant que la boucle l'utilise, on vérifie
qu'il voit les fautes : pour chaque capture, on lui montre le modèle **intact** et le même modèle **abîmé**
(ses deux plus grosses parties, hors corps principal, enlevées). S'il note l'abîmé plus bas dans **≥ 90 %**
des paires, il est fiable.

**À faire après PQ-T1** (plus il y a de captures, plus le test a du sens).

### La commande (coûte des appels API)

```bash
make shape-judge
```

Coût : **2 appels Muse Wonder par capture** (intact + abîmé), soit environ 32 appels pour 16 captures. Les
réponses sont gardées dans `real/<id>.judge.json`. Pour réafficher le résultat sans payer :

```bash
make shape-judge REPLAY=1
```

### Lire le résultat

La commande affiche un tableau :

```
| Capture | Intact | Damaged | Lower |
...
Damaged lower in 94 % of 16 pairs → trusted by the loop.
```

- **≥ 90 %** (`trusted by the loop`) → le juge peut servir à la boucle d'amélioration.
- **< 90 %** (`developer note only`) → on le garde comme simple avis pour les développeurs. Ce n'est pas un
  échec de la tâche : il faut juste l'écrire.

### Cocher PQ-T4

1. Coller le tableau dans le journal de boucle de `docs/tasks/PV-shape-realism.md`.
2. Cocher `PQ-T4` dans `docs/tasks/PV-vision-quality.md`, en notant le verdict (fiable ou non).

---

## 3. PQ-T6 — Fixer les seuils d'arrêt (sans API)

**But :** dire à partir de quand un modèle est « assez bon ». Aujourd'hui `STOP` dans
`server/perception/shape-report.ts` ne regarde que IoU ≥ 0,85, contour F1 ≥ 0,6 et ΔE ≤ 8.

**Il faut PQ-T1 d'abord** : les seuils se calculent sur les vraies photos.

Ce qui sera fait (par moi, dès que PQ-T1 est fini) :

1. Seuils pour le **F1 des arêtes intérieures** et le **ΔE par partie**, avec une règle fixe : une valeur que
   **au moins la moitié** des objets réels ratent aujourd'hui. Jamais une valeur choisie pour qu'un objet
   précis passe.
2. `SCORE_WEIGHTS_DETAIL` (silhouette, contour, couleur, parties), utilisé seulement quand la capture a des
   masques de parties. Sans masques, les anciens poids restent : les scores synthétiques ne bougent pas.
3. `STOP` gagne : rappel des parties ≥ 0,8, précision ≥ 0,8, et les deux nouveaux seuils.
4. Méthodologie §9 et le skill `/shape-loop` citent les mêmes seuils que le code.

Vous n'avez rien à lancer : dites « PQ-T6 » une fois PQ-T1 fait.

---

## 4. PQ-T37 — Les parts encore ouvertes (plus tard)

Fait : les parties qui flottent sont recollées à leur parent, les doublons au même endroit fusionnés, les
parties vues par SAM mais non construites listées dans le journal (`[vision] 3D seen, not built …`), et la
colonne « Not built » existe dans le rapport.

Reste, **rien à faire de votre côté pour l'instant** :

- **`evidence.visibleParts`** : la liste des parties vues, que le kit doit renvoyer. Elle arrive avec
  **PQ-T12** (phase Q1). Ensuite, chaque partie listée doit être construite ou signalée.
- **La liste des parties dans le panneau** de l'éditeur 3D, avec « vue, non construite » : c'est une tâche
  UI (passe par `/design-check`, maquette Stitch, i18n EN/FR/MG, thèmes clair/sombre, mobile).
- **Colonne « Not built » remplie** : aujourd'hui elle affiche « — » car les anciennes captures n'ont pas
  de masques de parties. Les nouvelles captures de PQ-T1 les ont : la colonne se remplira toute seule.

PQ-T37 se coche quand la colonne est vide ou expliquée pour chaque objet réel.

**État au 2026-11-10 :** colonne expliquée pour chaque objet réel, liste des pièces dans le panneau livrée
(PR #10). **À refaire plus tard :** dès que PQ-T12 (phase Q1) est fait, brancher `evidence.visibleParts` dans
`notBuilt` / `partCoverage` (chaque partie listée construite ou affichée « non construite »), puis cocher PQ-T37.

---

## Résumé : votre liste

1. `make install`, puis `.env` avec `LLM_PROVIDER=meta` et `META_API_KEY`.
2. 12 photos → `make shape-capture PHOTO=… ID=… [LABEL=…]`, plus refaire `TV`.
3. `make shape-report` → ≥ 12 lignes « Real ».
4. `make shape-judge` (≈ 2 appels par capture).
5. Me dire « fait » : j'écris le journal, je coche PQ-T1 / PQ-T4 et je fais PQ-T6.
