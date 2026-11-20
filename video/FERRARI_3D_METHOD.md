# La Ferrari 3D de l'intro — ce qui a été fait, étape par étape

Source : `video/canvas/vr-intro3d.html` (segment `?seg=car`), `video/scripts/intro-photos.py` (la photo, le contour,
les quatre vues), `video/scripts/render-canvas.cjs` (rendu image par image), `video/scripts/build-v9.py` (montage).

## 0. Ce qu'il faut savoir d'abord

**La Ferrari 3D réaliste n'a pas été générée, ni par l'app, ni par un modèle d'IA, ni dans Blender.**
C'est un modèle 3D existant, fait à la main par un artiste : la « Ferrari 458 Italia » de **vicent091036**
(Sketchfab), que three.js redistribue dans ses exemples (`examples/models/gltf/ferrari.glb`, utilisé par l'exemple
officiel `webgl_materials_car.html`). Je l'ai téléchargé, puis mis en scène avec three.js : matériaux, lumière,
ombre, effet de scan et animation.

Ce qui est de nous : l'**habillage** (matériaux, éclairage, shader de balayage, fil de fer, socle hologramme,
mouvement de caméra) et l'**enchaînement** photo → contour → quatre vues → 3D.

Conséquences :

- On ne peut pas refaire « la même chose » pour n'importe quel objet avec cette méthode : il faut qu'un modèle 3D
  de cet objet existe déjà.
- La licence de ce modèle est à vérifier sur sa page Sketchfab avant une diffusion publique, avec le crédit exact.
  Le fichier est local, non commité (`video/images/intro/models/`).
- Le canapé, la maison et le break blanc de la démo ont été faits autrement : modélisés **par code dans Blender**
  (`video/blender/`, résumé en § 7).

## 1. Le contexte dans la vidéo

L'intro (`i2` puis `i3` dans `build-v9.py`) raconte : la photo de rue avec la Ferrari → un laser vise la voiture →
l'IA trace son contour (« car · AI perception ») → ses quatre vues apparaissent en cartes hologramme → la photo est
balayée par une ligne de scan → la voiture 3D monte et tourne sur un socle.

- Partie photo (contour, cartes) : `intro-photos.py`, Python + OpenCV, 38 s à 30 i/s.
- Partie 3D : `vr-intro3d.html?seg=car`, three.js r174, 9 s à 30 i/s = 270 images.

## 2. Première version (refusée : « pas réaliste, pas comme une vraie voiture »)

Une voiture **procédurale**, construite en primitives three.js dans la page :

| Pièce     | Construction                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Caisse    | `THREE.Shape` du profil latéral (8 points, courbes quadratiques) → `ExtrudeGeometry` sur 1,66 m de large, biseau 0,12 / 0,16, 8 segments |
| Vitrage   | Autre `Shape` (pare-brise → lunette) extrudée sur 1,24 m, biseau 0,08                                                                    |
| Toit      | `RoundedBoxGeometry(0.95, 0.05, 1.18)`                                                                                                   |
| Roues     | Pneu `TorusGeometry(0.3, 0.1)`, jante `CylinderGeometry(0.28)`, 5 rayons en boîtes, étrier rouge                                         |
| Détails   | Prises d'air (boîtes arrondies), phares (boîtes émissives), feux arrière (tores rouges), lame avant                                      |
| Matériaux | Peinture `MeshPhysicalMaterial` 0xc40d0b, metalness 0,55, roughness 0,28, clearcoat 1                                                    |

**Pourquoi ça ne ressemblait pas à une vraie voiture.** Une extrusion garde **la même section sur toute la
largeur** : la caisse est une « tranche » épaisse, plate sur les côtés et sur le dessus. Une vraie carrosserie est
courbe dans les trois directions (vue de dessus effilée, flancs bombés, épaules, passages de roue creusés), avec des
lignes de jonction, des optiques encastrées et des jantes détaillées. Quelques primitives ne peuvent pas rendre ça.

## 3. Deuxième version (celle de la vidéo)

### 3.1 Récupérer un modèle réaliste existant

```bash
for f in ferrari.glb ferrari_ao.png; do
  curl -sSL -o $f https://raw.githubusercontent.com/mrdoob/three.js/r174/examples/models/gltf/$f
done
```

- `ferrari.glb` (1,7 Mo) : glTF binaire **compressé Draco**, avec des objets nommés (`body`, `rim_fl`, `rim_fr`,
  `rim_rr`, `rim_rl`, `trim`, `glass`…).
- `ferrari_ao.png` : l'ombre de contact précalculée (ambient occlusion) vue du dessus, à poser sous la voiture.

### 3.2 Charger et habiller

- `GLTFLoader` + `DRACOLoader` (décodeur `examples/jsm/libs/draco/gltf/`).
- On remplace les matériaux par nom, comme l'exemple « car materials » de three.js :

| Objet           | Matériau                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `body`          | `MeshPhysicalMaterial` rouge 0xd0100b, metalness 1,0, roughness 0,45, **clearcoat 1,0**, clearcoatRoughness 0,03 (vernis de peinture auto) |
| `rim_*`, `trim` | `MeshStandardMaterial` 0x3a3d42 (jantes foncées, comme sur la photo), metalness 1,0, roughness 0,35                                        |
| `glass`         | `MeshPhysicalMaterial` 0x15181c, metalness 0,4, roughness 0,02, transparent, opacité 0,55                                                  |
| ombre           | Plan `0,655·4 × 1,3·4` m sous la voiture, texture `ferrari_ao.png`, **MultiplyBlending**                                                   |

Le clearcoat donne la double réflexion d'une vraie peinture : une couche colorée métallique, plus un vernis net
au-dessus.

### 3.3 Lumière et rendu

- **Environnement** : `RoomEnvironment` passé dans `PMREMGenerator` (`scene.environment`). Ce sont les reflets de
  pièce sur la carrosserie et les vitres qui font l'essentiel du réalisme.
- **Lumières** : une directionnelle principale (intensité ≈ 2,4, ombres douces `PCFSoftShadowMap`, carte 2048²,
  rayon 6), une lumière de contre bleutée 0xbfe8ff (1,2), une ambiance 0,25.
- **Tone mapping** `ACESFilmicToneMapping`, puis post-traitement `EffectComposer` : `RenderPass` (scène),
  `RenderPass` (calque photo par-dessus), `UnrealBloomPass` (force 0,3, seuil 0,85), `OutputPass`.
- Sol sombre réfléchissant : `MeshStandardMaterial` 0x0b111c, roughness 0,3, metalness 0,35.

### 3.4 Effets « l'IA la scanne »

**Balayage de la photo.** La photo est un plan plein écran dans une scène calque, avec un shader. Pour un pixel
d'abscisse $u \in [0,1]$ et un avancement $s \in [0,1]$ :

$$e = u - (1{,}15 - 1{,}3\,s)$$

$$\alpha_{\text{photo}} = 1 - \operatorname{smoothstep}(0,\ 0{,}02,\ e), \qquad \ell = e^{-(60\,e)^2}$$

La photo disparaît derrière une ligne cyan $\ell$ (couleur $(0{,}3;\ 0{,}85;\ 0{,}91)$) qui traverse l'image. La
photo garde son cadrage (« cover ») grâce au rapport $r = \dfrac{\text{écran}}{\text{photo}}$.

**Fil de fer.** Un `WireframeGeometry` de la caisse en lignes cyan additives, d'opacité

$$o(t) = 0{,}35 \cdot \sin\big(\pi \cdot \operatorname{seg}(t;\ 0{,}6;\ 4{,}2)\big)$$

donc visible pendant le scan, puis effacé.

**Socle hologramme.** Deux anneaux (`RingGeometry` 2,7–2,8 m et 3,05–3,08 m) en mélange additif, qui s'allument
puis pulsent : $0{,}5 + 0{,}2 \sin(4t)$.

### 3.5 Animation (temps $t$ en secondes)

Fonctions de base :

$$ \operatorname{seg}(t; a; b) = \operatorname{clamp}!\left(\frac{t-a}{b-a}\right), \qquad
\operatorname{eio}(x) = \begin{cases} 4x^3 & x < 0{,}5 \\ 1 - \dfrac{(-2x+2)^3}{2} & \text{sinon} \end{cases}, \qquad
\operatorname{eout}(x) = 1-(1-x)^3$$

| Élément              | Formule                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Balayage photo       | $s = \operatorname{seg}(t;\ 0{,}6;\ 3{,}6)$                                               |
| Montée de la voiture | $y = 0{,}45 \cdot \operatorname{eio}(\operatorname{seg}(t;\ 3{,}8;\ 5{,}6))$ m             |
| Rotation             | $\theta = 1{,}5 + 0{,}32\,(t-4{,}2)^{1{,}6}$ rad après 4,2 s                              |
| Caméra               | $k = \operatorname{eio}(\operatorname{seg}(t;\ 3{,}6;\ 9))$, position $(-3{,}6 \to -5{,}4;\ 1{,}1 \to 1{,}9;\ 5{,}2 \to 6{,}4)$, champ 34° |
| Flash d'entrée       | opacité $1 - \operatorname{seg}(t;\ 0;\ 0{,}5)$                                            |

Le lacet de départ **1,5 rad** a été réglé à la main pour que la 3D apparaisse dans **le même trois-quarts avant
que la Ferrari de la photo**. La transition photo → 3D se lit alors comme une seule voiture qui « prend du
volume ». Les jantes ont été assombries (0x3a3d42) pour coller aux jantes noires de la photo.

### 3.6 Rendu de la vidéo

- `render-canvas.cjs` : Chromium sans écran (Playwright, rendu logiciel SwiftShader) ouvre la page. Pour chaque image,
  il appelle `window.__seek(ms)` puis fait une capture. Résultat : 270 PNG dans `video/frames/intro3d-car/`.
- Commande : `make video-canvas-intro3d MODELS=<dossier de ferrari.glb> STREET=<photo de la rue>`.
- `build-v9.py` assemble ensuite tous les plans avec ffmpeg : fondus `xfade` de 0,45 s, sous-titres libass, musique
  et voix, normalisation −14 LUFS.

## 4. La partie photo avant la 3D (`intro-photos.py`)

Le contour « car · AI perception » est **calculé sur ta photo** avec OpenCV. Aucun modèle d'IA n'est appelé ici.

1. **Masque du rouge** en TSV : teinte $H < 10$ ou $H > 170$, saturation $S > 120$, valeur $V > 60$.
2. **Fermeture morphologique** 31×31 pour boucher les reflets, puis plus grand contour (`findContours`).
3. **Pneus ajoutés** à la main (cercles mesurés sur la photo) pour que le contour descende jusqu'à la route, puis
   nouvelle fermeture 61×61.
4. **Simplification** `approxPolyDP` (tolérance 2,5 px), puis **rééchantillonnage** en 600 points à pas constant,
   pour que le tracé avance à vitesse régulière : abscisse curviligne $c_i = \sum_{j<i} \lVert p_{j+1}-p_j\rVert$, puis
   interpolation linéaire.
5. **Arêtes internes** : flou gaussien 5×5 puis `Canny(60, 160)`, gardées dans le contour, pour l'effet « la
   voiture devient ses arêtes ».
6. Ta **planche des quatre vues** (`ferrari-views.png`) est découpée et affichée en cartes hologramme, puis
   « validée ».

## 5. Outils, bibliothèques, modèles

| Catégorie        | Utilisé                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Modèle 3D        | « Ferrari 458 Italia », vicent091036 (Sketchfab), via les exemples three.js r174 (glTF + Draco)  |
| Moteur 3D        | three.js r174 : `GLTFLoader`, `DRACOLoader`, `RoomEnvironment`, `PMREMGenerator`, `MeshPhysicalMaterial`, `EffectComposer`, `UnrealBloomPass`, `OutputPass`, shaders GLSL maison |
| Rendu image      | Chromium sans écran + Playwright (`render-canvas.cjs`), SwiftShader (sans GPU)                   |
| Photo / contour  | Python, OpenCV (TSV, morphologie, contours, Canny, inpainting du logo du MacBook), NumPy, Pillow |
| Montage          | ffmpeg (concat, `framerate`, `xfade`, `drawtext`, libass, `sidechaincompress`, `loudnorm`)       |
| Voix             | Kokoro TTS (ONNX, en local)                                                                     |
| Modèles d'IA     | **Aucun** pour la Ferrari : ni Meta (Muse, SAM), ni générateur image → 3D                        |
| Skills du projet | Aucune skill spécifique. Travail fait directement avec les outils de fichiers et le terminal.    |

## 6. Ce qui fait le réalisme (à retenir)

1. **La géométrie** : un vrai modèle sculpté, avec des surfaces courbes dans les trois directions. C'est le point
   décisif. Matériaux et lumière ne rattrapent pas une forme fausse (cf. version 1).
2. **La peinture auto** : métal + vernis (clearcoat) + reflets d'environnement.
3. **L'ombre de contact** sous la voiture : sans elle, l'objet flotte.
4. **La pose identique à la photo** : même angle de vue, mêmes jantes sombres.
5. **Un éclairage de studio** : lumière principale douce, contre-jour bleuté, tone mapping ACES, léger bloom.

## 7. Pour d'autres objets : la méthode Blender (canapé, maison, break)

Quand aucun modèle n'existe, je les ai **modélisés par code** avec Blender (`bpy` 5.3) dans `video/blender/` :
sections lissées et surfaces de subdivision, biseaux, capitonnage par déplacement gaussien, tuiles ondulées, etc.
Ensuite viennent des vues orthographiques rendues avec Cycles sur le fond bleu pâle des dessins de l'app, puis un
export GLB allégé (`gltf-transform`). Commande : `make prepared-models`. C'est plus proche d'une vraie génération
qu'un téléchargement, mais la ressemblance dépend du temps passé sur chaque objet. Le break, par exemple, reste
moins fin que la Ferrari d'artiste.
$$
