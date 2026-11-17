# Mitsinjo Grid VR — vidéo de présentation (script de génération complet)

> Vidéo YouTube **anglaise**, **≤ 3:00** (cible 2:55), sous-titres EN (incrustés + piste `.srt`).
> Deux fonctionnalités mises en avant : **A. `/village` en immersion** (analyse → détection → génération 3D →
> labo → insertion dans la simulation) et **B. `/simulation` en immersion** (visiter, naviguer, contrôler les
> flux d'énergie). Tout est filmé dans le navigateur avec l'émulateur Meta (IWER / Immersive Web Emulator),
> sans casque physique.
> Site : <https://mitsinjo-grid-vr.vercel.app/overview>. Plan de la vidéo précédente (non VR) :
> [`VIDEO_PLAN.md`](VIDEO_PLAN.md) — ce fichier-ci la remplace pour la soumission VR.

---

## 1. Fiche technique (qualité YouTube)

| Élément       | Valeur                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Durée         | **2:55** (marge 5 s sous la limite de 3:00)                                                           |
| Résolution    | **2560 × 1440 (1440p)**, 30 fps — YouTube encode alors en VP9/AV1, nettement plus net qu'un 1080p     |
| Captures      | 1920 × 1080 minimum (OBS), upscalées en Lanczos ; idéal : capturer directement en 2560 × 1440         |
| Codec export  | H.264 High, `yuv420p`, CRF 16, preset `slow`, `-movflags +faststart` (≈ 25–35 Mb/s)                   |
| Audio         | AAC 320 kb/s, 48 kHz stéréo ; voix à **−14 LUFS intégré**, crête ≤ −1 dBTP ; musique −22 dB sous voix |
| Sous-titres   | `subtitles/vr-en.srt` incrustés (police de l'app, blanc, contour sombre, bas-centre, 2 lignes max)    |
|               | + même `.srt` téléversé dans YouTube Studio (piste désactivable, traduction auto FR/MG possible)      |
| Fichier final | `video/output/mitsinjo-grid-vr-1440p.mp4`                                                             |
| Miniature     | 1280 × 720, < 2 Mo : voiture en hologramme 3D + titre « Point. Scan. Build. Power. »                  |

Règles du projet tenues à l'écran (`CLAUDE.md`) : le label **SIMULATED DATA** reste visible dans chaque plan
de l'app ; aucun chiffre n'est inventé dans la voix ou les overlays (on montre ce que le moteur affiche) ; le
texte IA reste visuellement distinct des métriques calculées ; seuls des modèles Meta sont nommés pour l'IA.

---

## 2. Vue d'ensemble (storyboard)

| #   | Timecode      | Durée | Séquence                                                              | Source              |
| --- | ------------- | ----- | --------------------------------------------------------------------- | ------------------- |
| 01  | 00:00 – 00:07 | 7 s   | Accroche : casque VR sans marque flottant dans le noir                | Animation (§ 4)     |
| 02  | 00:07 – 00:16 | 9 s   | Travelling avant → on entre dans la lentille du casque                | Animation           |
| 03  | 00:16 – 00:30 | 14 s  | Paysage rural, une voiture ; clic → la voiture devient 3D, tourne     | Animation           |
| 04  | 00:30 – 00:38 | 8 s   | Transition : laptop sans marque s'ouvre, zoom sur l'écran             | Animation → capture |
| 05  | 00:38 – 00:52 | 14 s  | `/village` → « View in VR immersion », marche, scan                   | Capture             |
| 06  | 00:52 – 01:06 | 14 s  | Détections holographiques, visée laser, tir sur un objet              | Capture             |
| 07  | 01:06 – 01:26 | 20 s  | « Extract in 3D » → studio : vues 2D, chat IA, validation             | Capture             |
| 08  | 01:26 – 01:42 | 16 s  | « Validate & build the 3D » → labo 3D (tourner, pièce, taille)        | Capture             |
| 09  | 01:42 – 01:58 | 16 s  | Placement dans le village, câble au feeder, insertion simulation      | Capture             |
| 10  | 01:58 – 02:14 | 16 s  | `/simulation` en VR : marcher, étiquettes, carte, objet inséré        | Capture             |
| 11  | 02:14 – 02:30 | 16 s  | Panneau holographique d'un bâtiment : −0,5 kW, entrer dans la pièce   | Capture             |
| 12  | 02:30 – 02:44 | 14 s  | Table de mixage du dispatcher : batterie, curseurs, clinique protégée | Capture             |
| 13  | 02:44 – 02:55 | 11 s  | Outro : logo, URL, « Built with Meta models », crédits                | Animation           |

Rythme : plans de 1 à 4 s dans les captures, coupe sur le clic ; jamais plus de 5 s sans mouvement.

---

## 3. Voix off + sous-titres (anglais, ≈ 400 mots, ~140 mots/min)

Le texte ci-dessous **est** le fichier `video/subtitles/vr-en.srt` (copier tel quel). Chaque bloc = une
réplique de la voix off. Ton : calme, curieux au début, plus rythmé à partir de 00:38.

```srt
1
00:00:00,400 --> 00:00:03,600
What if everything around you
could become a 3D model?

2
00:00:03,800 --> 00:00:07,000
Not in a studio. Right where you stand.

3
00:00:07,400 --> 00:00:11,600
Put on a headset, and the world
stops being a picture.

4
00:00:11,800 --> 00:00:16,000
It becomes something you can point at,
take, and build with.

5
00:00:16,400 --> 00:00:20,800
See that car? Point at it.

6
00:00:21,000 --> 00:00:25,600
The AI sees it, outlines it,
and rebuilds it in three dimensions.

7
00:00:25,800 --> 00:00:30,000
Now imagine doing that
to power a whole village.

8
00:00:30,400 --> 00:00:34,400
This is Mitsinjo Grid VR:
a solar village twin for off-grid Madagascar,

9
00:00:34,600 --> 00:00:38,000
running in the browser
with Meta's WebXR emulator.

10
00:00:38,400 --> 00:00:42,800
On the Village page,
I enter VR immersion and walk around.

11
00:00:43,000 --> 00:00:47,600
One trigger on the floating button
analyses the current view.

12
00:00:47,800 --> 00:00:52,000
Muse Spark detects every object,
SAM outlines it.

13
00:00:52,400 --> 00:00:56,800
Each detection becomes a hologram.
I aim the laser…

14
00:00:57,000 --> 00:01:01,000
…and shoot the object I want.

15
00:01:01,200 --> 00:01:05,800
The app asks: extract it in 3D?
Yes.

16
00:01:06,200 --> 00:01:11,000
I step into the 3D studio.
Muse Image draws its 2D views:

17
00:01:11,200 --> 00:01:15,400
front, sides, back and top.

18
00:01:15,600 --> 00:01:20,800
If one view is wrong, I just ask the AI chat,
by voice or keyboard, and it redraws it.

19
00:01:21,000 --> 00:01:25,800
I check every view and validate.
Nothing is built until a human says yes.

20
00:01:26,200 --> 00:01:30,800
From the validated views,
the 3D model is built, piece by piece.

21
00:01:31,000 --> 00:01:36,400
In the 3D lab I turn it,
shoot a piece to select it, resize it.

22
00:01:36,600 --> 00:01:41,800
Every edit goes live
to the village and to the page.

23
00:01:42,200 --> 00:01:46,800
Then I aim at the village table
and place it.

24
00:01:47,000 --> 00:01:52,400
A pole and a cable connect it
to its feeder line.

25
00:01:52,600 --> 00:01:57,800
Insert into simulation:
the energy engine recomputes every strategy.

26
00:01:58,200 --> 00:02:02,600
Go to the simulation.
Now I am standing inside the grid.

27
00:02:02,800 --> 00:02:08,000
I walk the village at human scale.
Walls stop me, the ground follows my feet.

28
00:02:08,200 --> 00:02:13,800
Labels, a live map, and every line
carrying the engine's simulated power.

29
00:02:14,200 --> 00:02:19,000
I aim at a building:
a hologram panel shows what the engine serves it.

30
00:02:19,200 --> 00:02:24,000
Minus half a kilowatt.
The whole village sees the change.

31
00:02:24,200 --> 00:02:30,000
I walk in: the lights inside
glow with the power it really gets.

32
00:02:30,400 --> 00:02:35,000
At the dispatcher, a mixing desk.
Start the battery and dispatch.

33
00:02:35,200 --> 00:02:39,800
One fader per sector.
Slide, release, and the energy flows change.

34
00:02:40,000 --> 00:02:44,000
Try to cut the clinic? Refused.
The village constitution protects it.

35
00:02:44,400 --> 00:02:49,400
Mitsinjo Grid VR.
Point at the world. Build it. Power it.

36
00:02:49,600 --> 00:02:55,000
Every number comes from the engine.
Every action stays in human hands.
```

Mots clés à prononcer distinctement : _Mitsinjo_ (« mi-tsinn-dzou »), _Muse Spark_, _Muse Image_, _WebXR_.

Variante voix : la voix de l'auteur est préférée par les règles du hackathon. Sinon, TTS local déjà
outillé : `make video-tts-setup` puis adapter `video/scripts/tts.py` pour lire ce fichier (voix `am_puck`).

---

## 4. Séquences 01–04 : l'animation d'introduction (00:00 – 00:38)

Contrainte : objets **génériques et sans marque** (casque, voiture, laptop). Aucun logo, aucune forme
reconnaissable d'un produit réel. Palette = tokens sombres de l'app (`canvas #080d1a`, cyan énergie, ambre
solaire, violet IA ; cf. `VIDEO_PLAN.md` § 2).

Deux façons de produire, au choix :

- **Option A (recommandée, 100 % maîtrisée) :** une page Three.js dans `video/canvas/vr-intro.html`, rendue
  image par image avec `video/scripts/render-canvas.cjs` (même pipeline que `00-splash.html`). Avantage : on
  réutilise un vrai modèle 3D sorti de l'app (exporté du labo) pour la voiture → la promesse est honnête.
- **Option B (plus rapide) :** générateur vidéo IA (image → vidéo) avec les prompts ci-dessous, puis un
  calque compositing pour l'interface (curseur, contour, hologramme). Vérifier les droits d'usage de l'outil.

### 01 — Le casque (00:00 – 00:07)

- **Plan :** fond noir bleuté, particules de poussière lumineuse. Un casque VR générique (visière lisse, gris
  anthracite, sangle textile, lentilles qui reflètent un léger cyan) tourne lentement à 3/4 face, éclairage
  rasant ambre à gauche, liseré cyan à droite.
- **Caméra :** orbite de 15° en 7 s, focale 85 mm, profondeur de champ faible.
- **Son :** nappe grave, montée très douce de la musique.
- **Prompt (option B) :** _"A sleek unbranded virtual reality headset floating in a dark navy void, slowly
  rotating, soft amber rim light from the left, cyan rim light from the right, floating dust particles,
  cinematic product shot, shallow depth of field, no logos, no text, 4k"_

### 02 — Entrer dans le casque (00:07 – 00:16)

- **Plan :** le casque pivote face caméra ; travelling avant accéléré (ease-in) vers la lentille gauche. La
  lentille remplit l'écran, flash blanc doux de 6 images, puis le paysage apparaît à travers un vignettage
  rond qui s'ouvre (effet « on met le casque »).
- **Son :** whoosh montant (`make video-sfx`, fichier `rise`), puis souffle d'ambiance extérieure (vent, oiseaux).

### 03 — Le paysage et la voiture (00:16 – 00:30)

- **Plan :** paysage rural des hautes terres malgaches au matin : collines vertes, rizières en terrasses,
  piste de latérite rouge, quelques cases, ciel clair. Au centre, une petite voiture **générique** (berline
  compacte sans calandre identifiable, peinture bleu délavé) garée sur la piste.
- **00:17** — un pointeur laser cyan (style manette VR) entre par le bas droit et vise la voiture. Un contour
  holographique cyan se dessine autour de la silhouette (animation de tracé 0,6 s) avec l'étiquette
  _« car · AI perception »_ en violet (style de l'app).
- **00:21** — clic (son « click » + vibration visuelle). Le contour se remplit d'une grille wireframe, la
  photo de la voiture se dissout en particules et un **modèle 3D lowpoly/propre** se matérialise, se
  détache du sol, monte de 30 cm et **tourne sur lui-même** (360° en 4 s) sur un petit socle hologramme.
- **00:26** — la caméra recule ; autour, d'autres objets du paysage (un poteau solaire, une case) reçoivent à
  leur tour un contour cyan furtif → idée « tout peut être modélisé ». Fondu sur la voix « to power a whole
  village ».
- **Prompts (option B) :** image de départ _"Wide shot of Madagascar central highlands at morning, green
  terraced rice fields, red laterite dirt road, small traditional houses, a small generic unbranded compact
  blue car parked on the road, clear sky, photorealistic, 16:9"_ ; vidéo _"Camera slowly pushes in, a thin cyan
  holographic outline traces around the car, then the car turns into a glowing wireframe 3D model that
  lifts off the ground and spins on a hologram pedestal"_.
- **Option A :** exporter un modèle de voiture généré par l'app (labo 3D) en `.glb` et l'utiliser comme
  modèle final : c'est la vraie sortie du pipeline.

### 04 — Le laptop (00:30 – 00:38)

- **Transition :** la voiture qui tourne rapetisse et devient un point lumineux → raccord sur le logo du
  pied de l'écran… d'un **laptop gris aluminium sans marque** (aucun logo sur le capot) posé sur une table en
  bois, lumière chaude de fin de journée.
- **00:31** — l'écran s'ouvre (charnière, 1,5 s), l'écran s'allume sur `/overview` de l'app (capture réelle
  incrustée en _screen replacement_ : 4 coins suivis, ou rendu 3D direct d'une texture vidéo en option A).
- **00:34** — zoom caméra vers l'écran jusqu'à ce que la capture remplisse le cadre (raccord invisible :
  à 00:37 on est en plein écran sur la capture réelle). Pendant le zoom, le curseur clique sur la navigation
  « Village ».
- **Overlay texte (00:33 – 00:38) :** « Mitsinjo Grid VR » + sous-titre « Solar village twin · WebXR ».

---

## 5. Séquences 05–12 : captures réelles dans l'app (00:38 – 02:44)

### 5.1 Préparation (une seule fois)

1. Chrome desktop, fenêtre **2560 × 1440** (ou 1920 × 1080), zoom navigateur 100 %, thème **dark**, langue
   **EN**. Masquer les favoris, mode invité (pas d'extensions parasites).
2. Installer l'extension **Immersive Web Emulator** (Meta) — nécessaire sur le build prod Vercel (l'IWER
   auto ne s'installe qu'en dev, cf. `docs/vr-testing-guide.md` § B). En local, `make dev` suffit (IWER auto).
3. Prendre la version déployée <https://mitsinjo-grid-vr.vercel.app> **ou** `make dev` avec la clé Meta
   (`LLM_PROVIDER=meta`) pour montrer de vrais appels Muse. `make dev-mock` = filet de sécurité hors-ligne
   (réponses scriptées, mêmes écrans).
4. Repartir d'un état propre : vider le `localStorage` du site (modèles placés), recharger `/overview`.
5. OBS : canvas et sortie = taille de la fenêtre, 30 fps, encodeur x264 CRF 14 (ou NVENC CQP 16), format MKV
   (remux MP4 ensuite). Curseur visible. Pas de son système (bips de l'app enregistrés à part si voulu).
6. Émulateur : en Play Mode, déplacement clavier (`W A S D` / `Z Q S D`), regard souris ; maintenir `Shift`
   ou `Alt` pour bouger la manette, clic = gâchette. Réduire/masquer les panneaux DevUI pour les plans
   serrés, ou **recadrer en post** sur la vue « Headset Viewport ».
7. Faire **2 prises complètes** de chaque séquence ; le montage prend la meilleure.

### 5.2 Séquences

**05 — Entrer sur `/village` (00:38 – 00:52)**

- 00:38 — page `/village` (« Find appliances »), label SIMULATED DATA visible. Zoom 160 % sur le bouton
  **« View in VR immersion »**, clic.
- 00:41 — la session immersive démarre (plein écran). Marcher 3 s dans la pièce (`W` + regard souris
  doux, pas de rotation brusque).
- 00:45 — viser le bouton flottant **« Analyse the current view »** (« Aim and trigger to scan »), gâchette.
  L'état passe à **« Scanning objects in real time… »** (radar rotatif + bip).

**06 — Détecter et tirer (00:52 – 01:06)**

- 00:52 — **« {count} objects detected! Aim & shoot »** : les cadres holographiques apparaissent autour des
  objets. Insert (coin, 3 s) : log serveur `[vision]` montrant l'appel au modèle Meta.
- 00:57 — balayer le laser sur 2–3 objets (le nom n'apparaît que sous le laser), puis s'arrêter sur l'objet
  choisi (prendre un objet **électrique** pour la suite : lampe, frigo, ventilateur, TV…).
- 01:00 — tir (gâchette) : impact lumineux + son.

**07 — Extraction et studio 2D (01:06 – 01:26)**

- 01:01 — carte **« Extract « name » in 3D? »** → **« Extract in 3D »**.
- 01:06 — studio : **« 2D views to validate »**, vues dessinées l'une après l'autre (« Drawing… »).
  Glisser gauche/droite pour faire défiler les faces (accélérer x4 en post si l'attente est longue, avec un
  petit badge « ×4 » dans le coin — honnêteté sur le temps réel).
- 01:15 — ouvrir **« AI chat · view »**, **« Dictate »** ou **« Keyboard »**, demande courte
  (ex. _"make the door wooden"_), **« Send »** → « Redrawing… » → nouvelle vue. Le bandeau violet
  « AI EDIT » reste visible (texte IA distinct).
- 01:21 — valider chaque vue (« ✓ Validated ») puis **« Validate & build the 3D »**.

**08 — Le labo 3D (01:26 – 01:42)**

- 01:26 — « Building « name » in 3D » → **« « name » is ready in 3D »** → **« Enter the 3D lab »**.
- 01:31 — **« 3D lab · name »** : glisser pour tourner le modèle ; tirer sur une pièce → « Selected: piece » ;
  **« + Size »**, **« Turn 90° »**. Plan serré sur le badge « Live: the village and the page get every edit ».

**09 — Insertion dans le village (01:42 – 01:58)**

- 01:42 — **« Place « name » in the village »** : viser la table du village, presser. Le modèle se pose, un
  poteau et un câble le relient → « Placed at x, z · feeder: sector ».
- 01:50 — **« Insert into simulation »** (Add to the simulation) → **« In the simulation: strategies
  recomputed »**. Zoom 180 % sur ce message (preuve que le moteur a recalculé).
- 01:55 — **« Go to the simulation »** (ouvre `/simulation?immersion=vr`).

**10 — Visiter `/simulation` (01:58 – 02:14)**

- 01:58 — arrivée au sol, à hauteur humaine, à côté de l'objet inséré. Légendes des manettes visibles
  (« Left controller / Right controller »).
- 02:02 — marcher sur l'allée centrale, longer un mur (on glisse, on ne traverse pas), particules d'énergie
  sur les lignes.
- 02:07 — **A / X** : afficher les étiquettes du village ; ouvrir la mini-carte **« Map » → « Village map »**
  (point « You »). Revenir sur l'objet inséré : son câble s'allume.

**11 — Piloter un bâtiment (02:14 – 02:30)**

- 02:14 — viser l'étiquette d'une maison (secteur « Village Households ») → panneau holographique : kW servis /
  demandés, couverture (valeurs du moteur, ne rien commenter de chiffré dans la voix).
- 02:18 — **« − 0.5 kW »** : la ligne ralentit, les lampes baissent dans le secteur. Insert texte : « Engine
  re-run · sector cap ».
- 02:23 — **« Go to the door » / « Enter »** : intérieur, appareils qui brillent
  selon la couverture ; **« Go outside »** ou **B / Y** pour ressortir.

**12 — Table de mixage du dispatcher (02:30 – 02:44)**

- 02:30 — viser l'abri du dispatcher → **« Dispatcher · mixing desk »**.
- 02:32 — **« Start the battery & dispatch »** → « Dispatching ». Tranche **Battery** (Charge / Reserve).
- 02:35 — maintenir la gâchette sur un curseur de secteur, glisser, relâcher : « Served » et « Limit » se
  mettent à jour, les flux 3D changent.
- 02:40 — tenter **« Cut »** sur la tranche de la clinique (ou **« Cut all »** sur le panneau de la clinique) →
  **« Refused: the clinic is never cut (village constitution) »**. Zoom 180 % sur le refus. Vérifier en
  répétition lequel des deux affiche le refus et filmer celui-là.

---

## 6. Séquence 13 — Outro (02:44 – 02:55)

- Fondu vers `video/canvas/10-outro.html` adapté : logo Mitsinjo Grid, tagline **« Point at the world.
  Build it. Power it. »**, URL `mitsinjo-grid-vr.vercel.app`, « Built with Meta Muse Spark · Muse Image ·
  SAM 3.1 · WebXR (IWER) », crédit musique, « SIMULATED DATA » discret.
- 2 s de carrousel d'écrans (village VR, labo 3D, table de mixage) derrière le texte.
- Fin musique sur 02:55, noir 0,3 s.

---

## 7. Musique et sons

- Musique : piste libre de droits déjà créditée (`video/audio/music/`, cf. `VIDEO_PLAN.md` § 1) ou autre piste
  libre, **crédit dans le README + outro**. Calme 00:00–00:30, montée sur le flash du casque, groove léger de
  00:38 à 02:44, résolution sur l'outro.
- SFX : `make video-sfx` (click, whoosh, rise). Bips du scan / impact du tir de l'app : enregistrer à part si
  besoin, sinon recréer avec les SFX générés.
- Ducking : musique −22 dB sous la voix, −14 dB dans les silences.

---

## 8. Montage et export (commandes)

Arborescence :

```
video/
  captures/vr/05-village-enter.mkv … 12-mixer.mkv
  canvas/vr-intro.html            (option A) ou images/vr-intro/*.mp4 (option B)
  audio/voice/vr-voice.wav
  subtitles/vr-en.srt             (bloc § 3)
  output/
```

1. Remux et normalisation des captures (30 fps constant, 1440p) :

   ```bash
   for f in video/captures/vr/*.mkv; do
     ffmpeg -y -i "$f" -vf "scale=2560:1440:flags=lanczos,fps=30" -c:v libx264 -crf 14 -preset slow \
       -pix_fmt yuv420p -an "${f%.mkv}.mp4"
   done
   ```

2. Montage : DaVinci Resolve (gratuit) ou Kdenlive, timeline 2560 × 1440 30 fps, en suivant § 2 ; zooms
   « macro » 160–180 % sur les boutons (ease-out cubic 300 ms) ; voix calée sur les timecodes du `.srt`.
3. Export master (sans sous-titres) : `video/output/master-1440p.mov` (ProRes 422 ou H.264 CRF 12).
4. Normalisation audio + sous-titres incrustés + export YouTube :

   ```bash
   ffmpeg -y -i video/output/master-1440p.mov \
     -vf "subtitles=video/subtitles/vr-en.srt:force_style='FontName=Inter,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=36'" \
     -af "loudnorm=I=-14:TP=-1:LRA=11" \
     -c:v libx264 -preset slow -crf 16 -profile:v high -pix_fmt yuv420p -r 30 \
     -c:a aac -b:a 320k -ar 48000 -movflags +faststart \
     video/output/mitsinjo-grid-vr-1440p.mp4
   ```

5. Contrôles : `ffprobe` → durée ≤ 180 s, 2560×1440, 30 fps ; regarder en entier sur mobile (sous-titres
   lisibles) ; vérifier SIMULATED DATA visible dans chaque plan d'app.

---

## 8bis. Prompt de génération (si un agent / outil fait le montage)

> Produce a 2:55, 2560×1440, 30 fps English video from `video/VR_VIDEO_SCRIPT.md`. Use segment timecodes of § 2,
> voice-over and captions from the SRT in § 3, intro animation per § 4 (generic unbranded headset, car and
> laptop, app dark palette), real screen captures per § 5 from `video/captures/vr/`, outro per § 6. Burn the
> SRT in, keep a soft subtitle copy, normalise audio to −14 LUFS, export H.264 CRF 16 faststart to
> `video/output/mitsinjo-grid-vr-1440p.mp4`. Never type an energy number by hand; keep the SIMULATED DATA label
> visible in app shots.

---

## 9. Publication YouTube

- **Titre :** _Mitsinjo Grid VR — Point at the world, build it in 3D, power a solar village (WebXR)_
- **Description :** pitch 2 lignes (cf. `docs/vr-hackathon-about-short.md`), lien démo, lien repo, « Filmed
  in the browser with Meta's Immersive Web Emulator (no headset) », modèles Meta utilisés, crédit musique,
  mention « All energy values are simulated ».
- **Chapitres** (dans la description) :

  ```
  0:00 What if everything could be 3D?
  0:38 Village: scan the room in VR
  0:52 Detect & shoot an object
  1:06 3D studio: AI 2D views, human validation
  1:26 3D lab
  1:42 Insert into the village simulation
  1:58 Walk the solar village in VR
  2:14 Control a building's power
  2:30 Dispatcher mixing desk
  2:44 Outro
  ```

- **Sous-titres :** téléverser `video/subtitles/vr-en.srt` (Anglais) dans YouTube Studio → Sous-titres.
- **Paramètres :** visibilité « Non répertoriée » pour le jury si demandé, catégorie Science & Technologie,
  miniature personnalisée, langue de la vidéo = anglais.

---

## 10. Checklist finale

- [ ] Durée ≤ 3:00 (cible 2:55), ouverture sur la question d'accroche
- [ ] Casque, voiture, laptop : aucun logo ni design de marque reconnaissable
- [ ] Les deux fonctionnalités clés montrées en capture réelle (≥ 70 % de la vidéo)
- [ ] Scan → détection → tir → vues 2D → validation humaine → 3D → labo → placement → insertion
- [ ] `/simulation` : marcher, étiquettes, carte, panneau bâtiment, entrer, table de mixage, clinique refusée
- [ ] SIMULATED DATA visible dans chaque plan d'app ; aucun chiffre tapé à la main
- [ ] Sous-titres incrustés + `.srt` téléversé ; voix à −14 LUFS
- [ ] Export 1440p H.264, faststart ; vérifié sur mobile
- [ ] Crédits musique dans la vidéo et le README

---

## 11. Génération automatique (sans casque, sans écran)

Toute la vidéo se régénère depuis le dépôt, dans un conteneur sans GPU :

| Étape       | Commande                | Ce qu'elle fait                                                                                                       |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| App         | `make dev-mock`         | App locale, perception simulée (`LLM_PROVIDER=meta` + clé pour de vrais appels Meta)                                  |
| Tournage    | `make video-capture-vr` | `capture-vr.mjs` : émulateur IWER piloté, captures + marqueurs (`captures/raw/vr-village`, `vr-sim`)                  |
| Intro/outro | `make video-canvas-vr`  | `canvas/vr-intro.html` (Three.js procédural : casque, voiture, laptop sans logo) et `vr-outro.html`, image par image  |
| Voix        | `make video-voice-vr`   | `tts-srt.py` : une réplique Kokoro par sous-titre du § 3                                                              |
| Montage     | `make video-build-vr`   | `build-vr.py` : découpe aux marqueurs, badge « TIME-LAPSE ×N », titres de section, fondus, voix, musique, `vr-en.srt` |

Sortie : `video/output/mitsinjo-grid-vr-1440p.mp4` et `video/output/vr-chapters.json` (chapitres YouTube).
Limites : sans GPU le village se rend à ≈ 1–8 i/s, d'où les accélérés lissés ; les captures en mode `mock`
montrent des réponses IA scriptées (retourner avec une clé Meta avant la soumission).
