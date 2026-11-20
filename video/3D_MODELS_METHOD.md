# Toutes les 3D faites pour la démo — étapes, modèles, réglages

Complète `video/FERRARI_3D_METHOD.md` (la Ferrari de l'intro). Ici : le canapé, le break blanc et la maison
(Blender), leur branchement dans l'app, le casque et le laptop de l'intro (three.js), les modèles de bibliothèque
et le décor du labo.

| 3D                                | Comment                                    | Fichiers                                                         |
| --------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Canapé baroque (hall)             | **Modélisé par code dans Blender**         | `video/blender/sofa.py`                                          |
| Break blanc (rue)                 | **Modélisé par code dans Blender**         | `video/blender/car.py`                                           |
| Maison aux portes bleues          | **Modélisée par code dans Blender**        | `video/blender/house.py`                                         |
| Outils communs Blender            | Matériaux, caméras, rendu, export          | `video/blender/common.py`, `paper.sh`, `build.sh`                |
| Casque et manettes (intro)        | Procédural three.js                        | `video/canvas/vr-intro3d.html?seg=headset`                       |
| Laptop (intro)                    | Procédural three.js                        | `video/canvas/vr-intro3d.html?seg=laptop`                        |
| Ferrari (intro)                   | Modèle d'artiste existant, mis en scène    | voir `FERRARI_3D_METHOD.md`                                      |
| Canapé / voiture « bibliothèque » | Modèles existants sous licence CC BY 4.0   | `apps/web/public/models/library/` (VS-T51)                       |
| Décor du labo VR                  | Procédural three.js, fusionné par matériau | `apps/web/src/features/vision-insert/utils/lab-room.ts` (VS-T50) |

Aucun modèle d'IA (Meta ou autre) n'a produit ces 3D. Ce sont des modèles faits par code, à partir des photos
360° de l'immersion, ou des modèles existants dont l'auteur est crédité.

---

## 1. La chaîne Blender (canapé, break, maison)

### 1.1 Mise en place

- **Blender en Python** : le paquet `bpy` 5.3.0 (Blender sans interface), dans un environnement virtuel
  `video/.venv-blender` (`pip install bpy==5.3.0`, plus la bibliothèque système `libtbb12`).
- **Références** : les photos 360° de l'immersion (Poly Haven, CC0), recadrées autour de chaque objet.
  - le canapé du hall : `studio/hall.jpg`, autour du point (0,385 ; 0,607) de l'image ;
  - la maison : `outdoor/terrace.jpg`, boîte (0,43–0,81 ; 0,27–0,72) ;
  - le break blanc : `outdoor/street.jpg`, boîte (0,505–0,627 ; 0,51–0,61).
- **Commande unique** : `make prepared-models` (ou `ONLY=sofa|car|house`), qui lance `video/blender/build.sh`.

### 1.2 Outils communs (`common.py`)

| Fonction               | Rôle                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mat(...)`             | Matériau Principled BSDF : couleur, rugosité, métal, _sheen_ (velours), _coat_ (vernis), transmission, émission, et une **bosse procédurale** (bruit, échelle, force) |
| `box`, `cyl`, `sphere` | Primitives avec modificateurs **Bevel** (arêtes adoucies) et **Subdivision Surface**                                                                                  |
| `grid_obj(nu, nv, f)`  | Une surface de $(n_u+1)(n_v+1)$ points placés par une fonction $f(u, v)$ : la base des formes courbes                                                                 |
| `tube(points, rayon)`  | Courbe **NURBS d'ordre 3** avec épaisseur (_bevel depth_) et rayon variable par point : moulures, pieds, vignes                                                       |
| `spiral(...)`          | Les points d'une volute qui rétrécit : $r_k = r_0(1 - 0{,}8\,t_k)$, $\theta_k = \theta_0 + 2\pi n\,t_k$                                                               |
| `to_meshes()`          | Convertit les courbes en maillages (sinon leurs boîtes englobantes sont fausses)                                                                                      |
| `lights()`             | Ciel physique (_Sky Texture_, soleil à 38°) très atténué + 3 lumières de surface : principale, débouchage, contre-jour                                                |
| `finish(...)`          | Cadre, rend les vues orthographiques, la vue 3/4, puis exporte le GLB                                                                                                 |

**Rendu.** Cycles sur CPU, 48 échantillons, débruitage OIDN, image 1024², fond transparent, gestion des couleurs
**AgX « Medium High Contrast »**, exposition −0,35.

**Vues 2D.** Caméras **orthographiques** (sans perspective) placées sur l'axe de chaque vue, avec un cadre de
$1{,}18 \times$ la plus grande dimension visible :

| Vue    | Direction de la caméra          |
| ------ | ------------------------------- |
| front  | $(0, -1, 0)$                    |
| right  | $(1, 0, 0)$                     |
| back   | $(0, 1, 0)$                     |
| left   | $(-1, 0, 0)$                    |
| top    | $(0, 0, 1)$                     |
| bottom | $(0, 0, -1)$, voiture seulement |

Le devant de chaque objet regarde $-Y$. Pour la voiture, la vue principale est le **profil** (`right`).

**Fond des dessins.** `paper.sh` pose chaque rendu sur le **bleu pâle** des dessins de l'app (RVB 214, 228, 240),
avec ffmpeg, puis l'image est réduite à 512 px (la taille des dessins de l'app).

**Export 3D.** GLB (glTF binaire), modificateurs appliqués, axe Y vers le haut, objets d'aide (découpes)
exclus. Il est ensuite **allégé** avec `gltf-transform optimize` (simplification `ratio 0,35`, erreur
$8 \times 10^{-4}$) : environ 150 à 215 000 triangles et 3,4 à 4,1 Mo au départ, puis **1,1 à 1,75 Mo**.

### 1.3 Boucle de travail

Pour chaque objet : écrire le script → rendre → poser **côte à côte** les vues et le recadrage de la photo →
comparer → corriger les proportions, couleurs, lumières → recommencer. Le canapé a demandé 5 passes, la voiture
5, la maison 2.

---

## 2. Le canapé baroque (`sofa.py`)

**Référence** : canapé Louis XV capitonné, velours bleu acier, cadre sculpté argenté, accoudoirs roulés.
**Taille** : 2,16 × 0,84 × 1,05 m.

### 2.1 Le dossier capitonné (la pièce maîtresse)

Une surface `grid_obj` de 150 × 70 carreaux, puis épaissie (_Solidify_ 9 cm vers l'arrière).

**Contour du haut** (dossier « camelback » : haut au centre, petites épaules, chute vers les accoudoirs), avec
$u = |x| / 0{,}86$ :

$$z_{\text{haut}}(x) = 0{,}86 + 0{,}11\,e^{-(u/0{,}33)^2} + 0{,}035\,e^{-((u-0{,}78)/0{,}12)^2} - 0{,}12\,\frac{\max(0,\ u-0{,}86)}{0{,}14}$$

**Forme du coussin** : pour $(u, v) \in [0,1]^2$, avec $z_0 = 0{,}50$ :

$$x = -0{,}86 + 1{,}72\,u, \qquad z = z_0 + v\,(z_{\text{haut}}(x) - z_0)$$

$$y = 0{,}20 + 0{,}16\,(z - z_0) - 0{,}05\,\sin(\pi u)^{0{,}6}\sin(\pi v)^{0{,}7}$$

(dossier incliné, et bombé vers l'avant).

**Capitonnage.** Boutons en losange : rangées $v \in \{0{,}30;\ 0{,}55;\ 0{,}80\}$, 7 puis 6 puis 7 boutons
décalés. Chaque bouton $b$ enfonce le tissu d'un creux gaussien :

$$d_{\text{bouton}} = 0{,}05 \exp\!\left(-\frac{(1{,}7\,\Delta u)^2 + \Delta v^2}{2 \cdot 0{,}03^2}\right)$$

Entre deux boutons voisins, un **pli** suit le segment qui les relie, avec $\delta$ la distance au segment :

$$d_{\text{pli}} = 0{,}02 \exp\!\left(-\frac{\delta^2}{2 \cdot 0{,}011^2}\right)$$

Le creux total $y \mathrel{+}= \min\big(\sum d,\ 0{,}055\big)$ est poussé vers l'arrière. Un petit bouton
(sphère aplatie, velours plus foncé) est posé au fond de chaque creux.

### 2.2 Le reste

- **Assise** : bloc à biseau 5 cm + une surface bombée $z = 0{,}47 + 0{,}035\,\sin(\pi u)^{0{,}5}\sin(\pi v)^{0{,}7}$,
  plus un passepoil (tube) devant.
- **Accoudoirs roulés** : cylindre de rayon 9,5 cm écrasé à 1,2, face avant en sphère aplatie (volute de velours),
  liseré argenté en spirale, support en S (tube NURBS à rayon variable).
- **Cadre sculpté argenté** : moulure qui suit le haut du dossier, plus épaisse au centre
  ($r = 1 + 0{,}5\,e^{-(x/0{,}12)^2}$) ; au sommet, un cartouche (deux volutes, une feuille, un bouton).
- **Ceinture avant** serpentine $y = -0{,}44 - 0{,}02\cos(\pi x / 0{,}95)$ et festons
  $z = 0{,}31 - 0{,}05\,e^{-(x/0{,}12)^2} - 0{,}03\,e^{-((|x|-0{,}55)/0{,}08)^2}$, coquille centrale.
- **Pieds cambrés** (cabriole) : 6 tubes à genou bombé et cheville fine, terminés par une boule.
- **Pieds raccourcis** comme sur la photo : après construction, tout ce qui est sous la ceinture est écrasé
  ($z \to 0{,}72\,z$) et le reste abaissé.

### 2.3 Matériaux

| Nom     | Couleur (linéaire)    | Réglages                                                         |
| ------- | --------------------- | ---------------------------------------------------------------- |
| velours | (0,045 ; 0,10 ; 0,16) | rugosité 0,8, **sheen 0,25** teinté bleu, bosse bruit 180 / 0,08 |
| bouton  | (0,06 ; 0,12 ; 0,19)  | sheen 0,6                                                        |
| argent  | (0,80 ; 0,81 ; 0,83)  | métal 0,95, rugosité 0,32, bosse 60 / 0,15 (patine)              |

### 2.4 Corrections au fil des passes

1. Objet minuscule : les boîtes englobantes des courbes étaient fausses → conversion en maillages avant de cadrer.
2. Image délavée : lumières trop fortes → puissances baissées, exposition −0,35.
3. Velours trop pâle, capitonnage invisible → couleur assombrie, creux plus profonds, plis plus marqués.
4. Dossier en triangle → profil « camelback » ci-dessus.
5. Pieds trop longs, accoudoirs maigres → pieds écrasés, accoudoirs rembourrés en velours.

---

## 3. Le break blanc (`car.py`)

**Référence** : break blanc type berline familiale, jantes sombres à branches. **Taille** : 4,72 × 1,84 ×
1,43 m, empattement 2,82 m, roues de rayon 0,345 m. Le nez regarde $-Y$.

### 3.1 La carrosserie par sections (« loft »)

220 sections le long de la voiture, $t = $ distance au nez $/ L$. Chaque grandeur suit des **clés** interpolées
en cosinus :

$$f(t) = f_0 + (f_1 - f_0)\,\frac{1 - \cos(\pi k)}{2}, \qquad k = \frac{t - t_0}{t_1 - t_0}$$

| Courbe               | Clés $(t,\ \text{valeur en m})$                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| bas de caisse        | (0 ; 0,30) (0,04 ; 0,22) (0,12 ; 0,18) (0,88 ; 0,18) (0,96 ; 0,27) (1 ; 0,42)                            |
| ligne de ceinture    | (0 ; 0,66) (0,03 ; 0,77) (0,10 ; 0,855) (0,27 ; 0,925) (0,6 ; 0,95) (0,9 ; 0,98) (1 ; 0,72)              |
| toit                 | … (0,27 ; 0,94) **pare-brise** → (0,47 ; 1,405) (0,56 ; 1,43) (0,88 ; 1,415) (0,955 ; 1,37) (0,99 ; 1,0) |
| demi-largeur         | (0 ; 0,70) (0,04 ; 0,84) (0,12 ; 0,91) (0,88 ; 0,915) (0,97 ; 0,86) (1 ; 0,78)                           |
| demi-largeur du toit | (0 ; 0,40) (0,27 ; 0,80) (0,47 ; 0,66) (0,9 ; 0,64) (1 ; 0,5) : le pavillon rentre (_tumblehome_)        |

**Une section** (côté droit, puis miroir) :

- **bas** : un quart de **superellipse**, du bas au milieu jusqu'à l'épaule, avec $a \in [-\pi/2,\ 0]$ :

$$x = w\,|\cos a|^{2/5}, \qquad z = z_c + h\,\operatorname{sgn}(\sin a)\,|\sin a|^{2/3{,}2}$$

($w$ demi-largeur, $z_c$ et $h$ milieu et demi-hauteur entre le bas et la ceinture) ;

- **haut** : de l'épaule au centre du toit, le vitrage latéral monte en rentrant, puis l'arrondi du pavillon
  $x = r_w \cos(\tfrac{\pi g}{2})^{0{,}35}$. Au-dessus du capot et du coffre, la hauteur du vitrage tombe à zéro :
  la même formule donne un capot plat, sans couture.

Les sections sont reliées en **anneau fermé** (bmesh), les deux bouts fermés, puis _Subdivision Surface_ (1 à
l'écran, 2 au rendu).

**Matériau par face** :

- **verre** : faces de vitrage entre $t = 0{,}29$ et $0{,}965$, plus le pare-brise et la lunette ;
- **noir** : montants B ($0{,}545 < t < 0{,}575$) et C ($0{,}775 < t < 0{,}80$) ;
- **joints de portes** : bandes fines à $t \in \{0{,}305;\ 0{,}555;\ 0{,}79\}$ ;
- **peinture** : tout le reste.

**Passages de roue** : découpe booléenne par des cylindres de rayon $0{,}345 + 0{,}05$, puis doublure noire.

### 3.2 Roues

- **Pneu** : profil arrondi (demi-cercle de 3 cm sur une bande de 24,4 cm) tourné sur 64 segments.
- **Jante** : fût, disque de frein chromé, **10 branches** vrillées (tubes de 5 points, angle $+0{,}12\,f$,
  épaisseur $1{,}4 \to 0{,}9$), moyeu et cache.

### 3.3 Détails

Phares en lame + feux de jour chromés, feux arrière rouges qui contournent l'angle (légère émission),
rétroviseurs (coque peinte + noire), poignées chromées, barres de toit noires, bas de caisse, calandre
_singleframe_ noire à barrettes chromées, anneaux, prises d'air, diffuseur, plaques.

### 3.4 Matériaux

| Nom         | Couleur (linéaire)      | Réglages                      |
| ----------- | ----------------------- | ----------------------------- |
| peinture    | (0,80 ; 0,81 ; 0,82)    | rugosité 0,28, **vernis 1,0** |
| verre       | (0,015 ; 0,018 ; 0,022) | rugosité 0,05, vernis 1,0     |
| noir        | (0,01 ; 0,01 ; 0,012)   | vernis 0,6                    |
| jante       | (0,38 ; 0,39 ; 0,41)    | métal 0,95, rugosité 0,28     |
| chrome      | (0,9 ; 0,9 ; 0,9)       | métal 1,0, rugosité 0,08      |
| feu arrière | (0,35 ; 0 ; 0,01)       | émission rouge 0,4            |

### 3.5 Corrections au fil des passes

1. Haut de caisse non fermé au centre (bande sombre sur le capot) → anneau de section fermé.
2. Déchirure entre capot et pare-brise (deux formules qui changeaient d'un coup) → une seule formule continue.
3. Jantes noires illisibles → jantes gris métal.
4. Nez trop bas, allure de coupé → ceinture et toit relevés à l'avant.
5. Vue de dessous ajoutée (l'app la demande pour un véhicule).

---

## 4. La maison (`house.py`)

**Référence** : maisonnette au crépi ocre, portes-fenêtres doubles bleues, fenêtre à cadre bleu, avant-toit
en tuiles rouges sur charpente blanche, petit pignon d'entrée, vigne vierge, palier en terre cuite.
**Taille** : 6,4 × 4,8 m au sol, murs de 2,75 m.

- **Murs** : un bloc à biseau, sur un soubassement en pierre.
- **Portes-fenêtres** : encadrement blanc, deux vantaux bleus, deux grands carreaux dépolis par vantail avec
  5 petits bois blancs chacun, poignées, palier en terre cuite devant.
- **Fenêtres** : cadre blanc, battant bleu, vitre dépolie, petits bois en croix, appui en pierre. Elles sont
  placées sur les 4 façades.
- **Applique** au-dessus des portes : verre légèrement lumineux, chapeau et bras en fer.
- **Toit à deux pans**, pente 24°, débord 55 cm :

$$\text{montée} = \frac{D}{2}\tan 24°, \qquad z_{\text{faîtage}} = z_{\text{égout}} + \text{montée}$$

Les **tuiles canal** sont une surface de 340 × 60 carreaux, avec $r$ la distance au faîtage :

$$z = z_{\text{faîtage}} - r\tan 24° + 0{,}045\,\left|\sin\frac{\pi x}{0{,}19}\right| + 0{,}018\,\big((r / 0{,}33) \bmod 1\big)$$

Le premier terme donne les ondulations, une tuile tous les 19 cm. Le second donne le ressaut de chaque rang de
tuiles, tous les 33 cm. Viennent ensuite le faîtage, les planches de rive blanches, les **chevrons apparents**
tous les 60 cm et les pignons en crépi.

- **Pignon d'entrée** au-dessus des portes (pente 30°) : chevrons, entrait, poinçon blancs, petit toit en tuiles.
- **Vigne** : 40 tiges en marche aléatoire (graine fixe 7) qui montent par pas de 18–35 cm en s'écartant de ±18 cm,
  et s'affinent en montant, avec des rameaux. Les portes et la fenêtre principale restent dégagées.

| Nom         | Couleur (linéaire)    | Réglages                       |
| ----------- | --------------------- | ------------------------------ |
| crépi       | (0,27 ; 0,22 ; 0,10)  | rugosité 0,92, bosse 14 / 0,35 |
| tuile       | (0,26 ; 0,055 ; 0,02) | rugosité 0,65, bosse 40 / 0,2  |
| bleu        | (0,05 ; 0,13 ; 0,55)  | vernis 0,3                     |
| blanc       | (0,78 ; 0,78 ; 0,76)  | rugosité 0,55                  |
| terre cuite | (0,30 ; 0,08 ; 0,03)  | bosse 20 / 0,1                 |

Correction : la première passe était trop pastel (tuiles saumon, crépi pâle) → couleurs foncées, vigne plus
fine et plus dense.

---

## 5. Le branchement dans l'app (VS-T52)

Sans les modèles Meta, l'app répond avec des **réponses préparées** pour trois objets de la visite :

- **Vues 2D** : `tour-mock/prepared.ts` lit `public/models/prepared/<id>/<vue>.png`. La vue principale est
  `front`, ou `right` pour un véhicule. Pour `hall-sofa`, `street-car-white` et `terrace-house`, ce sont ces
  dessins qui s'affichent dans le studio.
- **3D** : la réponse de forme porte `modelUrl: '/models/prepared/<id>/model.glb'` (`ObjectShape.modelUrl`,
  validé par Zod, jamais rempli par une réponse Meta).
- **Labo VR** : `GltfModel3D` charge le GLB (`useGLTF`), le clone, le met à l'échelle (plus grand côté = taille
  du socle) et le **pose sur le plateau** (base sur l'origine). Le bouton « bibliothèque » est masqué pour un
  modèle préparé.
- **Village** : `PlacedModel.modelUrl` est gardé à l'insertion. En qualité haute, le modèle est dessiné à la
  hauteur qu'aurait la recette, au même endroit et avec la même rotation. En qualité basse, on garde la recette
  légère.
- **Tests** : `tour-prepared.test.ts` (fichiers présents pour chaque vue, réponses servies, URL validée) et
  `placed-models-geometry.test.ts` (branche glTF, qualité basse, clé de cache).

## 6. Le casque et le laptop de l'intro (three.js)

Pas de Blender ici : des primitives three.js dans `vr-intro3d.html`, rendues image par image dans Chromium.

- **Casque type Quest** : visière `RoundedBoxGeometry` blanche (vernis), façade légèrement bombée, 3 capteurs
  en gélule et 2 petits capteurs sphériques, mousse faciale en tissu, 2 lentilles (cercle + anneau), bras
  latéraux, sangle arrière et sangle haute en demi-tores. **Deux manettes à anneau** : tore, poignée en gélule,
  joystick, boutons. Mise en scène : plateau tournant, puis la caméra plonge dans la lentille gauche, flash blanc.
- **Laptop sans logo** : coque alu `MeshPhysicalMaterial` (métal 0,85, vernis 0,3), 84 touches en un seul
  `InstancedMesh`, pavé tactile, charnière, écran avec encoche. L'**écran est une texture canvas** qui affiche
  les vraies captures de l'app (aperçu → village), avec un curseur qui clique. Puis la caméra entre dans l'écran.
- Commun aux deux : `RoomEnvironment` pour les reflets, tone mapping ACES, ombres douces, léger bloom.

## 7. Modèles de bibliothèque (VS-T51)

Deux modèles **existants**, sous licence **CC BY 4.0**, issus des _Khronos glTF Sample Assets_ et crédités dans
l'app :

- « Glam Velvet Sofa » © 2021 Wayfair, LLC ;
- « Car Concept » © 2024 Darmstadt Graphics Group GmbH.

`lib/model-library.ts` associe un nom détecté (EN, FR, MG, ex. « Canapé », « Fiara ») à un modèle. Dans le labo,
un bouton permet de passer au modèle réaliste, avec son auteur et sa licence affichés. Fichiers et crédits :
`apps/web/public/models/library/`.

## 8. Le décor du labo VR (VS-T50)

D'après une photo de maker lab de référence : murs blancs, établi de meubles blancs à plan gris, panneau perforé
avec outils, étagères et boîtes, deux imprimantes 3D à capot orange, deux machines noires, bras d'aspiration,
évier inox, enseigne « Lab », traduite en « Labo » (FR) et « Laboratoara » (MG).

- `lab-room.ts` construit tout en primitives, puis **fusionne par matériau** : 11 matériaux, donc une
  dizaine d'appels de dessin pour toute la pièce sur Quest.
- La pièce fait 8,4 × 8,4 × 3 m. Rien n'est posé à moins de 2,4 m du spectateur, pour laisser la place aux
  panneaux.
- Rendu : matériaux PBR avec une part d'environnement réduite (0,42) pour ne pas délaver, deux lumières de
  scène sur le socle, ombre de contact sous le socle. Tests : `lab-room.test.ts`.

## 9. Ce qui marche, ce qui reste à faire

- **Ce qui fait le réalisme** : des surfaces courbes calculées (sections, déplacements gaussiens, ondulations),
  des arêtes adoucies, des matériaux physiques (velours, vernis, métal, bosses), un éclairage de studio doux, et
  la comparaison systématique avec la photo.
- **Limites** :
  - le break reste moins fin qu'un modèle d'artiste, sans nervures ni optiques détaillées ;
  - les textures procédurales (bosses du crépi, patine) ne passent pas dans le GLB : il faudrait les « cuire » en
    textures ;
  - les outils de pièces du labo (sélection, taille, rayons X) ne s'appliquent pas aux modèles préparés.
