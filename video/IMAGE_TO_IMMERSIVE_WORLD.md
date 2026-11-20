# D'une image capturée à un monde 3D en immersion — méthode

Guide de conception pour un projet qui transforme une capture (photo, photo 360°, vidéo) en un monde 3D
navigable en VR, avec des objets 3D les plus fidèles possible. Il réunit ce qu'on a appris sur Mitsinjo Grid VR
(`3D_MODELS_METHOD.md`, `FERRARI_3D_METHOD.md`, `docs/vision-to-3d-methodology.md`) et les familles de techniques
actuelles.

> **À vérifier avant de choisir.** Les modèles cités évoluent vite. Leurs versions, leurs licences (usage
> commercial ou non) et leurs conditions d'API sont à confirmer au moment de l'intégration.

---

## 0. Ce que « parfait » veut dire ici

Une seule image **ne contient pas** l'objet entier : les faces cachées, la profondeur exacte et les matériaux
sous l'éclairage doivent être **devinés**. Aucune méthode ne donne une 3D parfaite à partir d'une seule photo. Il
faut donc :

1. **Capturer plus** quand c'est possible : plusieurs vues ou une vidéo valent mieux qu'une photo.
2. **Choisir la bonne route par objet** : un modèle existant, de la génération, de la reconstruction ou un
   modèle paramétrique.
3. **Mesurer la fidélité** en comparant le rendu de la 3D à la photo, et boucler jusqu'au seuil.
4. **Laisser l'utilisateur corriger** les étapes intermédiaires (vues 2D, contour, dimensions) avant de
   construire.

L'objectif réaliste : **fidèle à la photo sous l'angle capturé, plausible ailleurs, mesuré, corrigeable**.

---

## 1. Architecture d'ensemble

```
Capture ─► Compréhension de la scène ─► Pour chaque objet : route A/B/C/D ─► Contrôle qualité (boucle)
   │              │                                                                │
   │              └─► Décor : fond 360°, sol, murs, profondeur                     ▼
   └────────────────────────────────────────────────► Assemblage du monde ─► Optimisation Quest ─► Runtime VR
```

| Étape            | Entrée                        | Sortie                                                           |
| ---------------- | ----------------------------- | ---------------------------------------------------------------- |
| Capture          | photo, 360°, vidéo            | images + métadonnées (focale, orientation, GPS si dispo)         |
| Compréhension    | images                        | objets (nom, masque, boîte), profondeur, normales, sol, pièce    |
| Objet → 3D       | recadrage + masque + contexte | maillage + matériaux PBR + échelle                               |
| Décor            | panorama / images             | fond, sol et murs en 3D, trous comblés                           |
| Assemblage       | objets + décor                | scène : position, rotation, échelle, collisions, zones de marche |
| Contrôle qualité | rendu vs photo                | scores, décision garder / refaire / demander à l'utilisateur     |
| Optimisation     | scène                         | glTF compressé, niveaux de détail, textures KTX2                 |
| Runtime          | glTF                          | WebXR (three.js / R3F) ou moteur natif (Unity / Unreal)          |

---

## 2. Capture : ce qui fait la qualité dès le départ

| Capture                          | Ce qu'elle permet                                          | Qualité 3D attendue          |
| -------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| 1 photo                          | génération d'un objet, profondeur estimée                  | plausible                    |
| 1 photo 360° (équirectangulaire) | décor complet autour d'un point, objets vus d'un seul côté | décor bon, objets plausibles |
| 3 à 10 photos autour d'un objet  | reconstruction multi-vues                                  | bonne                        |
| Vidéo (30 s, on tourne autour)   | reconstruction dense, Gaussian Splatting                   | très bonne                   |
| Scan du casque (Quest) + photos  | géométrie de la pièce réelle + textures                    | très bonne pour la pièce     |

Conseils à donner à l'utilisateur dans l'app :

- **Lumière diffuse**, pas de contre-jour.
- **L'objet entier dans le cadre**, avec de la marge.
- **Pas de flou de mouvement.**
- **Un objet de taille connue** dans le champ (une porte, une feuille A4) pour l'échelle.
- **Mesurer à la capture** (netteté, exposition, part cachée de l'objet) et prévenir tout de suite, comme le fait
  déjà `photo-conditions` dans Mitsinjo.

---

## 3. Compréhension de la scène

| Tâche                          | Famille de modèles (exemples à évaluer)                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Nommer les objets, les compter | VLM (Muse Spark, autres modèles vision-langage)                              |
| Masques précis                 | SAM 3 / SAM 2 (Meta), segmentation par concept texte                         |
| Profondeur                     | Depth Anything V2, Depth Pro, MoGe (profondeur métrique)                     |
| Normales, sol, murs            | estimateurs de normales ; plan du sol par RANSAC sur la profondeur           |
| Plusieurs images               | DUSt3R / MASt3R / VGGT (poses de caméra et nuage de points sans calibration) |

### Formules utiles

**Caméra sténopé** : un pixel $(u, v)$ de profondeur $d$ donne le point 3D

$$X = \frac{(u - c_x)\,d}{f_x}, \qquad Y = \frac{(v - c_y)\,d}{f_y}, \qquad Z = d$$

**Photo 360° équirectangulaire** ($W \times H$) : le pixel $(u, v)$ correspond à la direction

$$\lambda = 2\pi\left(\frac{u}{W} - \frac{1}{2}\right), \qquad \varphi = \pi\left(\frac{1}{2} - \frac{v}{H}\right)$$

$$\vec d = (\cos\varphi \sin\lambda,\ \sin\varphi,\ -\cos\varphi\cos\lambda)$$

C'est ce que fait l'immersion de Mitsinjo pour viser un objet dans la photo 360°.

**Plan du sol** par RANSAC : on cherche $\vec n \cdot \vec p + c = 0$ qui maximise le nombre de points avec
$|\vec n \cdot \vec p + c| < \varepsilon$, puis on cale tous les objets dessus.

**Échelle** : avec un objet de référence de hauteur réelle $H_r$ et de hauteur estimée $h_r$, le facteur est
$s = H_r / h_r$, appliqué à toute la scène. Sinon, on prend des tailles typiques par catégorie (porte 2,0 m,
voiture 1,45 m, canapé 0,85 m), comme `ARCHETYPE_HEIGHT_M` dans Mitsinjo.

---

## 4. Objet → 3D : quatre routes, et comment choisir

```
L'objet est-il connu et standard (produit, véhicule) ?
   └─ oui → A. Bibliothèque (modèle existant), ajusté à la photo
   └─ non → a-t-on plusieurs vues ou une vidéo ?
              └─ oui → C. Reconstruction multi-vues
              └─ non → est-ce une forme régulière (bâtiment, meuble, boîte) ?
                         └─ oui → D. Paramétrique / procédural, mesuré sur la photo
                         └─ non → B. Génération image → 3D, puis contrôle
```

### A. Bibliothèque (le plus réaliste, quand ça existe)

- Rechercher un modèle existant par le nom et par ressemblance d'image (embeddings CLIP / SigLIP entre la photo et
  des rendus des modèles).
- Ajuster : échelle et proportions, couleur des matériaux mesurée sur la photo.
- Sources : votre propre bibliothèque, catalogues sous licence (CC0, CC BY : **créditer**), Objaverse (licences
  variables, à filtrer).
- **Toujours afficher que c'est un modèle de bibliothèque, et son auteur.** C'est ce que fait VS-T51 dans Mitsinjo.
- La Ferrari de l'intro est de ce type.

### B. Génération image → 3D (n'importe quel objet, en quelques secondes)

| Famille                                 | Exemples à évaluer                                                  |
| --------------------------------------- | ------------------------------------------------------------------- |
| Maillage texturé depuis 1 image         | TRELLIS, Hunyuan3D-2, Stable Fast 3D / SPAR3D, TripoSR, InstantMesh |
| Objets en contexte (Meta)               | SAM 3D Objects : reconstruit l'objet masqué dans sa scène           |
| Multi-vues générées puis reconstruction | modèles de diffusion multi-vues, puis reconstruction                |

Bonnes pratiques :

- **Entrée propre** : objet découpé par son masque, centré, fond uni, résolution suffisante (agrandir les petits
  objets).
- **Plusieurs essais** (2 à 4 graines), puis garder celui qui obtient le meilleur score (§ 7).
- **Post-traitement** : remaillage, réduction de polygones, re-texturation par projection de la vraie photo sur la
  face visible.

### C. Reconstruction multi-vues (le plus fidèle pour un objet unique)

- Poses de caméra : COLMAP, ou DUSt3R / MASt3R / VGGT sans calibration.
- **3D Gaussian Splatting** : rendu photoréaliste, très fidèle, mais ce n'est pas un maillage. Il faut le
  convertir, ou utiliser un moteur de rendu de splats.
- **Maillage** : surfaces implicites (méthodes de type NeuS / 2DGS), puis extraction et texture.
- Idéal pour le décor et les objets uniques (sculpture, plante, vieux meuble).

### D. Paramétrique / procédural (ce qu'on a fait dans Blender)

Pour les formes régulières : bâtiments, meubles, véhicules simples, poteaux, clôtures.

1. Un **gabarit par famille** (maison, canapé, voiture…) avec des paramètres : dimensions, pentes, nombre de
   fenêtres, rayons, couleurs.
2. **Mesurer les paramètres sur la photo**, pas les deviner : silhouette, ligne de toit, couleurs par k-means en
   CIELAB, répétitions de fenêtres.
3. **Construire** avec des sections (_loft_), des surfaces paramétriques et des modificateurs (biseau,
   subdivision, épaisseur).
4. **Ajuster** les paramètres en minimisant l'écart à la photo (Nelder–Mead, comme `silhouette-fit` dans
   Mitsinjo).

Formules déjà utilisées :

$$\text{Section en superellipse :}\quad x = w\,|\cos a|^{2/n_1}, \qquad z = z_c + h\,\operatorname{sgn}(\sin a)\,|\sin a|^{2/n_2}$$

$$\text{Clés le long de l'objet :}\quad f(t) = f_0 + (f_1 - f_0)\,\frac{1 - \cos(\pi k)}{2}$$

$$\text{Creux (capitonnage, bosses) :}\quad d(\vec p) = A \exp\!\left(-\frac{\lVert \vec p - \vec p_0\rVert^2}{2\sigma^2}\right)$$

$$\text{Tuiles ondulées :}\quad z = z_0 - r\tan\alpha + a\left|\sin\frac{\pi x}{p}\right| + b\,\big((r/q) \bmod 1\big)$$

Un **LLM peut écrire ce code** (Muse Wonder ou un autre modèle de code) à partir des vues 2D, avec des _skill cards_
par famille. On garde une version seulement si son score progresse.

### La voie « vues 2D d'abord » (recommandée avec un humain dans la boucle)

1. Le modèle d'image dessine **les vues orthographiques** de l'objet (face, côtés, dos, dessus) à partir de la
   photo, sur un fond uni.
2. **L'utilisateur valide ou corrige** chaque vue (chat, voix).
3. La 3D est **calculée** à partir des silhouettes et des couleurs des vues : enveloppe visuelle (_visual hull_),
   puis l'une des routes B, C ou D.

Prompt type pour les vues (adapté de Mitsinjo) :

```text
Draw the {view} orthographic elevation of the very same {label} as the reference image: same proportions,
same materials and colours, same details. Straight-on, no perspective, the whole object centred on a plain
flat pale blue background (one uniform colour, no gradient, no ground, no shadow). No text, no dimension lines.
Complete the parts hidden in the photo consistently with the visible ones.
```

**Enveloppe visuelle** depuis deux vues orthogonales : un point $(x, y, z)$ appartient à l'objet s'il est dans
la silhouette de face en $(x, z)$ **et** dans celle de côté en $(y, z)$. On a le volume brut, puis on l'affine.

---

## 5. Le décor (le monde autour des objets)

| Capture        | Méthode                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Photo 360°     | Sphère texturée (rapide, sans parallaxe), ou maillage déformé par la profondeur estimée (parallaxe à courte distance) |
| Vidéo / photos | 3D Gaussian Splatting de la scène (le plus réaliste)                                                                  |
| 1 photo        | profondeur → maillage, puis complétion de ce qui n'est pas visible (génération de monde)                              |
| Monde généré   | génération de mondes navigables (de type World Labs Marble) à partir d'une image ou d'un texte, à évaluer             |

Points clés :

- **Retirer les objets du décor** quand ils sont remplacés par leur 3D, puis **combler** le trou (inpainting
  image ou 3D).
- **Sol et zones de marche** : grille de navigation calculée sur le sol détecté, obstacles = objets. C'est
  l'équivalent de `blocked(x, z)` dans Mitsinjo.
- **Lumière cohérente** : estimer une carte d'environnement (HDR) depuis le panorama, et éclairer les objets 3D
  avec elle pour qu'ils ne paraissent pas collés.

---

## 6. Matériaux réalistes

1. **Retirer l'éclairage de la photo** (_delighting_) avant d'en faire une texture, sinon les ombres et les
   reflets sont figés dedans.
2. **Estimer les matériaux PBR** (couleur de base, rugosité, métal, normales) par famille : velours (sheen),
   peinture auto (vernis), métal, crépi (bosses), verre (transmission).
3. **Cuire** les détails procéduraux en textures (couleur, normales, occlusion ambiante) pour qu'ils passent
   dans le glTF. Dans Blender : _Bake_ Cycles.
4. **Ombre de contact** sous chaque objet, cuite ou temps réel. C'est ce qui l'ancre au sol, comme l'ombre de
   la Ferrari.

---

## 7. Le contrôle qualité : rendre, comparer, boucler

Pour chaque objet, on **rend la 3D sous l'angle de la photo** (même caméra), puis on compare :

| Mesure                   | Formule                                                                                                    | Seuil indicatif |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------- |
| Silhouette (IoU)         | $\displaystyle \text{IoU} = \frac{\lvert M_{3D} \cap M_{photo}\rvert}{\lvert M_{3D} \cup M_{photo}\rvert}$ | ≥ 0,85          |
| Contours (F1 des arêtes) | $\displaystyle F_1 = \frac{2PR}{P + R}$ (arêtes Canny, tolérance 2 px)                                     | ≥ 0,80          |
| Couleur (CIEDE2000)      | $\Delta E_{00}$ moyen par zone                                                                             | ≤ 8             |
| Ressemblance perçue      | LPIPS (plus bas = mieux), similarité CLIP / DINO                                                           | à calibrer      |
| Faces cachées            | un juge VLM note la plausibilité du rendu 3/4 et du dos (1–5)                                              | ≥ 4             |

Score combiné (celui de Mitsinjo) :

$$S = 0{,}40\ \text{IoU} + 0{,}35\ F_1 + 0{,}25\,\Big(1 - \min\big(1,\ \Delta E_{00} / 25\big)\Big)$$

Règles de la boucle :

- Si $S$ est sous le seuil : changer de graine, de route, ou corriger les paramètres. On garde une modification
  **seulement si $S$ monte**.
- **Pas plus de 3 tours.** Au-delà, demander à l'utilisateur une vue de plus ou une validation.
- **Garder la trace** de chaque essai (entrée, version des prompts, score) pour comparer les versions du
  pipeline sur un jeu de test fixe. C'est le rôle de `make shape-report` dans Mitsinjo.

---

## 8. Optimisation pour la VR (Meta Quest)

| Budget (Quest 3, WebXR) | Valeur indicative                                 |
| ----------------------- | ------------------------------------------------- |
| Images par seconde      | 72 minimum, 90 visé                               |
| Appels de dessin        | < 150 à 200 pour toute la scène                   |
| Triangles visibles      | 300 k à 800 k selon les matériaux                 |
| Objet seul              | 10 k à 60 k triangles, plus des niveaux de détail |
| Textures                | 1024² à 2048² en **KTX2 / Basis**                 |

Chaîne recommandée (gltf-transform) :

```bash
npx @gltf-transform/cli optimize in.glb out.glb \
  --simplify-ratio 0.35 --simplify-error 0.001 \
  --texture-compress ktx2 --compress meshopt
```

- **Niveaux de détail** (LOD) : 3 niveaux par objet, choisis selon la distance.
- **Fusionner** les objets statiques par matériau, et **instancier** les répétés (arbres, poteaux).
- **Ombres cuites** pour le décor, une seule lumière dynamique.
- **Chargement progressif** : le décor d'abord, puis les objets proches, puis les lointains.

---

## 9. Infrastructure

- **Serveur GPU** pour la génération et la reconstruction (de quelques secondes à quelques minutes par objet).
  File de tâches, avec progression envoyée au casque (SSE / WebSocket).
- **Cache par empreinte** : même image recadrée et même version de prompt donnent le même résultat, sans
  recalcul.
- **Formats** : glTF 2.0 / GLB pour tout. Splats en `.ply` / `.spz` si utilisés.
- **Stockage** : objet (bucket) + base de métadonnées : objet, route, score, licence, auteur.
- **Mode hors ligne** pour les démos et les tests : réponses enregistrées, déterministes.
- **Coûts** : mesurer le coût par objet (appels de modèles, GPU) et le plafonner.

---

## 10. Plan de construction conseillé

| Étape | Livrable                                                                               | Critère de fin                          |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| 1     | Capture 360° + décor en sphère + visée d'objets + masques SAM                          | on vise un objet, il est détouré        |
| 2     | Route B (image → 3D) pour un objet, placé au sol, à l'échelle                          | IoU ≥ 0,8 sur 10 objets de test         |
| 3     | Boucle qualité (§ 7) + jeu de test fixe de 30 objets                                   | score moyen mesuré à chaque version     |
| 4     | Vues 2D validées par l'utilisateur + enveloppe visuelle                                | les faces cachées notées ≥ 4 / 5        |
| 5     | Bibliothèque (route A) + gabarits paramétriques (route D) pour les familles fréquentes | bâtiments et meubles au-dessus du seuil |
| 6     | Décor en profondeur ou en splats, trous comblés, lumière estimée                       | pas de « décor plat » à moins de 3 m    |
| 7     | Multi-vues / vidéo (route C)                                                           | objets uniques fidèles                  |
| 8     | Optimisation Quest, niveaux de détail, chargement progressif                           | 72 i/s stables sur Quest 3              |

---

## 11. Limites, droits et éthique

- **Faces cachées** : toujours inventées à partir d'une seule image. Le dire à l'utilisateur et lui permettre
  de corriger.
- **Droits** : les images capturées peuvent contenir des personnes, des marques, des œuvres. Prévoir le
  floutage des visages et des plaques, et vérifier la licence de chaque modèle 3D réutilisé.
- **Transparence** : indiquer dans l'interface la route de chaque objet (généré, reconstruit, bibliothèque) et
  son score.
- **Personnes** : la reconstruction 3D de personnes réelles demande leur consentement.
