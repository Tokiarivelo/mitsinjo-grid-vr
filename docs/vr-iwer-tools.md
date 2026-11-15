# Outils IWER (émulateur Meta Quest) — piloter mains et manettes

Référence pour tester l'immersion `/village` sans casque : les outils du **MCP IWER**
(`@iwer/extension-bridge` 2.8.0, serveur `iwer` dans `.mcp.json`, port 8723) et leur équivalent scripté
`window.__IWER_DEVICE__.remote.dispatch(méthode, params)` (dev uniquement). Un outil `xr_<nom>` = la
méthode `<nom>` de `dispatch`, mêmes paramètres. Commandes de l'app : [`vr-immersion-guide.md` § 6](vr-immersion-guide.md).

## 1. Lancer

```bash
make dev-mock                               # app sans LLM payant (port de .env)
make vr-iwer-tools URL=http://localhost:3017 # exerce les outils IWER + toutes les commandes de l'app
make vr-probe URL=http://localhost:3017      # parcours complet /village (scan, contours, marche, extraction)
```

Captures : `test-results/vr-iwer-tools/ctl-*.png`. Les deux scripts n'appellent pas le vrai serveur Meta.

## 2. Les outils (MCP `xr_*` = `dispatch`)

| Outil                   | Rôle                                                                             | Paramètres principaux                                                |
| :---------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| `xr_get_session_status` | État : appareil, session offerte / active, mode, features. **À appeler d'abord** | —                                                                    |
| `xr_accept_session`     | Entrer en XR (= clic « Enter XR »)                                               | —                                                                    |
| `xr_end_session`        | Quitter la session                                                               | —                                                                    |
| `xr_get_device_state`   | Instantané : casque, mode d'entrée, manettes, mains, FOV                         | —                                                                    |
| `xr_set_device_state`   | Applique un état partiel ; sans `state` = remise à zéro                          | `state`                                                              |
| `xr_get_transform`      | Position + quaternion + euler d'un appareil                                      | `device`                                                             |
| `xr_set_transform`      | Place un appareil                                                                | `device`, `position {x,y,z}`, `orientation`                          |
| `xr_look_at`            | Oriente un appareil vers un point (option : distance)                            | `device`, `target {x,y,z}`, `moveToDistance?`                        |
| `xr_animate_to`         | Déplacement animé                                                                | `device`, `position`, `orientation?`, `duration`                     |
| `xr_set_input_mode`     | Bascule manettes ↔ mains                                                         | `mode: 'controller' \| 'hand'`                                       |
| `xr_set_connected`      | Connecte / déconnecte une manette, une main ou le regard                         | `device`, `connected`                                                |
| `xr_get_gamepad_state`  | Boutons et axes d'une manette                                                    | `device`                                                             |
| `xr_set_gamepad_state`  | Presse des boutons / pousse le stick (par index IWER, § 3)                       | `device`, `buttons [{index,value,touched?}]`, `axes [{index,value}]` |
| `xr_get_select_value`   | Valeur de sélection 0..1 (gâchette ou pincement)                                 | `device`                                                             |
| `xr_set_select_value`   | Règle la sélection (rampe possible). Main : sélect à 0,9, relâche à 0,7          | `device`, `value`, `duration?`                                       |
| `xr_select`             | Clic complet : selectstart → select → selectend                                  | `device`, `duration?` (0,15 s)                                       |
| `xr_set_hand_pose`      | Pose de main (`point`, `thumbs-up`, …)                                           | `device`, `poseId`                                                   |
| `xr_get_hand_state`     | Pose, pincement, positions poignet / index / pouce, directions                   | `device`, `joints?: 'all'`                                           |
| `xr_microgesture`       | Geste de pouce                                                                   | `device`, `gesture` (§ 4)                                            |
| `xr_run_sequence`       | Enchaîne des étapes (poses, déplacements, pincements) dans le temps              | `steps`                                                              |
| `xr_cancel_sequence`    | Arrête la séquence en cours                                                      | —                                                                    |
| `xr_list_targets`       | Liste les cibles / onglets que le pont voit                                      | —                                                                    |
| `xr_get_world_state`    | Environnement synthétique (SEM) : plans, maillages, objets                       | — (module SEM requis)                                                |
| `xr_get_objects`        | Plans / maillages SEM avec leur étiquette (mur, sol, table)                      | —                                                                    |
| `browser_screenshot`    | Capture de la page                                                               | —                                                                    |

`device` : `headset`, `controller-left`, `controller-right`, `hand-left`, `hand-right` (et `gaze`).
Positions relatives à l'origine XR (sol, m).

## 3. Index des boutons : IWER → `xr-standard` (ce que lit l'app)

| IWER (`set_gamepad_state`) | Bouton                  | `gamepad.buttons[i]` dans l'app | Effet dans `/village`                             |
| :------------------------- | :---------------------- | :------------------------------ | :------------------------------------------------ |
| `0`                        | Gâchette                | 0                               | Valider ce qui est visé                           |
| `1`                        | Grip                    | 1                               | Attraper / tourner un modèle                      |
| `2`                        | Clic du stick           | 3                               | Afficher / masquer les légendes                   |
| `3`                        | A (droite) / X (gauche) | 4                               | Analyser la vue                                   |
| `4`                        | B (droite) / Y (gauche) | 5                               | Retour (annuler, quitter le labo, menu)           |
| `5`                        | Repose-pouce            | 6                               | —                                                 |
| axes `0` / `1`             | Stick x / y             | `axes[2]` / `axes[3]`           | Gauche : marcher · Droite : pivot 30° / pas 0,8 m |

Stick : y négatif = pousser vers l'avant. Un pivot / pas part au-delà de 0,7, se réarme sous 0,3.

## 4. Mains : poses et microgestes

- **Viser** : `xr_set_transform` + `xr_look_at` sur `hand-right` (le rayon système part du poignet).
- **Pincer** : `xr_select` (clic) ou `xr_set_select_value` 1 → 0 (tenir, glisser le carrousel).
- **Microgestes** (`xr_microgesture`) → boutons de la main dans l'app :

| `gesture`        | `buttons[i]` | Effet dans `/village`   |
| :--------------- | :----------- | :---------------------- |
| `swipe-left`     | 5            | Pivoter de 30° à gauche |
| `swipe-right`    | 6            | Pivoter de 30° à droite |
| `swipe-forward`  | 7            | Un pas en avant (0,8 m) |
| `swipe-backward` | 8            | Un pas en arrière       |
| `tap`            | 9            | Analyser la vue         |

## 5. Exemples

```js
const rc = (m, p = {}) => window.__IWER_DEVICE__.remote.dispatch(m, p);
await rc('set_input_mode', { mode: 'controller' });
// Viser le frigo puis tirer
await rc('look_at', { device: 'controller-right', target: { x: 1.2, y: 1.1, z: -2 } });
await rc('select', { device: 'controller-right' });
// A = analyser (IWER 3), puis relâcher
await rc('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 3, value: 1 }] });
await rc('set_gamepad_state', { device: 'controller-right', buttons: [{ index: 3, value: 0 }] });
// Pivoter à droite : stick droit poussé puis relâché
await rc('set_gamepad_state', { device: 'controller-right', axes: [{ index: 0, value: 0.9 }] });
await rc('set_gamepad_state', { device: 'controller-right', axes: [{ index: 0, value: 0 }] });
// Mains : geste de pouce
await rc('set_input_mode', { mode: 'hand' });
await rc('microgesture', { device: 'hand-right', gesture: 'swipe-right' });
```

Avec le MCP : même chose via `xr_look_at`, `xr_select`, `xr_set_gamepad_state`, `xr_microgesture`.
Hooks de lecture (dev) : `window.__VR_CONTROLS__` (`help`, `sources()`, `yaw()`, `shown(nom)`) et
`window.__VR_TOUR__` (lieu, cibles, survol).

## 6. Quand le MCP IWER ne répond pas

- `EADDRINUSE 127.0.0.1:8723` / « Connection closed » : un autre pont `iwer-bridge` (autre session, Antigravity)
  tient le port. `make iwer-bridge-stop` arrête celui d'Antigravity (`ALL=1` = tous, demander avant s'il n'est
  pas à vous) ou lancer avec `IWER_MCP_PORT=<autre>`, puis `/mcp` pour reconnecter.
- L'extension navigateur doit être ouverte sur l'onglet de l'app (`xr_list_targets`).
- Repli toujours disponible : `make vr-iwer-tools` / `make vr-probe` (même API via `remote.dispatch`) ou le
  DevUI dans la page.
