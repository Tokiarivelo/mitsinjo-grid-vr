# Tester l'immersion web (VR) — Mitsinjo Grid

Guide complet pour tester le bouton « Voir en VR » de `/simulation` (session WebXR
`immersive-vr` sur la scène village), **avec ou sans casque**. Tâche : `docs/tasks/VR-village-view.md` ·
scénarios manuels : `test-scenarios/02-simulation.md` (S119–S123).
Usage côté immersion (contrôles, navigation, plein écran, bons à savoir) :
`docs/vr-immersion-guide.md`.

## En bref : trois chemins

| #   | Chemin                                      | Quand l'utiliser                             | Installation         |
| --- | ------------------------------------------- | -------------------------------------------- | -------------------- |
| A   | Dev desktop, émulation IWER **automatique** | Développement quotidien, sans casque         | Zéro (inclus)        |
| B   | Extension Immersive Web Emulator            | Build prod sur desktop, sans toucher le code | Extension navigateur |
| C   | Casque réel (Quest Browser)                 | Validation finale immersion + confort        | Casque + HTTPS       |

Règle d'or : WebXR exige un **contexte sécurisé** (HTTPS ou `localhost`). En HTTP
non-localhost, `navigator.xr` n'existe pas et le bouton VR reste masqué — c'est voulu.

## Prérequis

- Node 20+, dépendances installées (`make install`).
- Chemins A/B : Chrome, Edge ou autre navigateur Chromium récent sur desktop.
- Chemin C : casque Quest avec Quest Browser à jour.
- Commandes : `make dev-mock` (dev + LLM mocké, hors-ligne), `make check`
  (typecheck + lint + tests + i18n).

## A. Dev desktop — IWER automatique (recommandé sans casque)

1. `make dev-mock`, ouvrir `/simulation` (vue 3D).
2. Au chargement, l'app installe l'émulateur Meta IWER 2.8.0 (`XRDevice`, preset
   `metaQuest3`) **uniquement si** le XR natif ne supporte pas `immersive-vr`
   (`utils/dev-xr-emulator.ts`, import dynamique, dev-only — jamais en prod).
3. Le bouton **lunettes** apparaît dans la barre HUD à côté du plein écran.
4. Cliquer → la session émulée démarre : le bouton passe à « Quitter la VR »
   (enfoncé cyan), la caméra se place sur le surplomb du village, la boucle passe
   en continu et les post-traitements se coupent (requis pour le stéréo).
5. L'**overlay DevUI** permet de déplacer le casque/contrôleurs émulés, de jouer
   des poses de mains et d'entrer en **Play Mode** (déplacement type FPS
   clavier/souris, pointeur verrouillé).
6. Quitter via le bouton (ou l'overlay) : retour 2D, caméra restaurée sur le
   préréglage, console sans erreur.

Limites connues : les labels drei `<Html>` ne s'affichent pas dans le casque
(miroir desktop OK) ; pas encore d'interactions contrôleur (lot suivant).

## B. Extension Immersive Web Emulator

Même émulation, sans toucher au code — utile pour un **build prod** sur desktop
(IWER n'y est pas actif) :

- Chrome : `chrome.google.com/webstore/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik`
- Edge : `microsoftedge.microsoft.com/addons/detail/immersive-web-emulator/hhlkbhldhffpeibcfggfndbkfohndamj`

Ouvrir la page servie (ex. `make build` + `make start`), activer l'extension,
cliquer « Voir en VR ». En dev, IWER auto-installé suffit (l'extension est
redondante mais compatible).

## C. Casque réel — Quest Browser

1. Servir l'app en HTTPS accessible du casque (WebXR refuse le HTTP) :
   - **IP LAN** : `https://<ip-du-pc>:<port>` (accepter l'avertissement certificat) ;
   - ou **ADB + port-forward** : casque en USB (mode développeur), puis dans
     `chrome://inspect/#devices` → Port forwarding → `https://localhost:<port>`.
2. Ouvrir l'URL dans Quest Browser → le bouton apparaît (XR natif détecté).
3. Entrer en VR : vue surplombante du village. Sortir via le bouton ou le
   **geste système** du casque (l'UI se resynchronise via l'événement `end`).
4. Confort/perf : Quest Browser tourne à 72 Hz par défaut ; viser < 100–120 draw
   calls (contrôle : `?perf=1`), textures < 256 Mo. Valider les shaders sur casque :
   un rendu desktop OK ne prouve pas le rendu Adreno.

## Scénarios manuels (à cocher)

| ID   | Vérification                                                      |
| ---- | ----------------------------------------------------------------- |
| S119 | Dev desktop : bouton visible (IWER auto), console sans erreur     |
| S120 | Entrée/sortie émulée, caméra restaurée, pas d'erreur              |
| S121 | Build prod sans casque : pas de bouton, pas d'erreur (idem HTTP)  |
| S122 | Casque HTTPS : session immersive, sortie geste → bouton de retour |
| S123 | Build prod + extension navigateur : session émulée OK             |

## Tests automatiques (déjà verts)

22 tests VR (7 fichiers), `make check` vert (2135/2135 au total) :

- `utils/__tests__/xr-session.test.ts` — détection null-safe, `requestSession`
  (`immersive-vr` + `local-floor`), rejets gérés.
- `hooks/__tests__/use-webxr.test.tsx` — cycle enter/exit/erreur, resync `end`.
- `utils/__tests__/dev-xr-emulator.test.ts` — **vrais packages IWER** : runtime
  installé, `immersive-vr` détecté, overlay dégradé proprement sans WebGL.
- `__tests__/camera-controller-xr.test.tsx` — snap `XR_VIEWPOINT`, orbit off,
  restauration préréglage/focus.
- `__tests__/village-canvas-xr.test.tsx` — `frameloop`, `rendererRef`, postfx OFF en XR.
- `simulation/__tests__/viewport-vr.test.tsx` — bouton masqué/visible selon support.
- `simulation/__tests__/viewport-vr-session.test.tsx` — **passe unique** : bouton →
  enter → snap → sortie geste → retour caméra multi-trames → re-enter → exit.

Lancer : `pnpm --filter web test xr-session use-webxr camera-controller-xr
  village-canvas-xr viewport-vr dev-xr-emulator`.

## Dépannage

| Symptôme                                 | Cause probable                                           | Correctif                                                |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Pas de bouton (dev)                      | Page HTTP non-localhost, ou vue 2D (WebGL off)           | Servir en HTTPS/`localhost` ; vérifier WebGL             |
| Pas de bouton (prod desktop)             | Normal sans casque ni extension                          | Installer l'extension (chemin B)                         |
| Session refusée / erreur en infobulle    | Refus runtime, double `enter`                            | Lire le message (title), réessayer, recharger si HMR     |
| Écran noir en session                    | (Ne devrait plus arriver : postfx coupés en XR)          | Recharger, signaler avec la console                      |
| Overlay DevUI absent (dev)               | WebGL indisponible → runtime seul + avertissement `[vr]` | Normal en headless ; la session reste testable via l'API |
| `Multiple instances of Three.js` (tests) | Double chargement CJS/ESM via `postprocessing`           | Bruit connu, ignoré (voir tâche VR)                      |
| Saccades sur casque                      | Trop de draw calls / textures                            | Passer Qualité basse, `?perf=1`, viser < 120 calls       |

## Non applicable à ce projet (vérifié, doc Meta)

- `metavr ssim` (SpatialSim) : **2D Android uniquement** — pas de page web.
- `metavr xrsim` (XR Simulator) : apps OpenXR natives (Unity/Unreal/Natif) —
  pas de navigateur, rien à y attacher pour un projet web.

## Références

- [WebXR Workflow](https://developers.meta.com/vr/documentation/web/webxr-workflow) (émulateur)
- [WebXR first steps](https://developers.meta.com/vr/documentation/web/webxr-first-steps) (IWER + DevUI)
- [Immersive Web SDK — Overview](https://developers.meta.com/vr/documentation/iwsdk/guides/overview.md)
- [SpatialSim — Overview](https://developers.meta.com/vr/documentation/android-apps/spatial-sim-overview) (scope 2D Android)
- [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) (runtime + DevUI)
