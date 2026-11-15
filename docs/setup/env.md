# Variables d'environnement : local et production (Vercel)

Modèle complet commenté : [`.env.example`](../../.env.example). Validation côté web : `apps/web/src/lib/env.ts`.
Jamais de vraie valeur dans le dépôt : les secrets vont dans `.env` / `apps/web/.env.local` (ignorés par git) ou dans Vercel.

## Où va quoi

| Fichier / lieu                            | Lu par                                            | Création                                     |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `.env` (racine)                           | port (`make dev`), bridge, Stitch (`make claude`) | `cp .env.example .env`                       |
| `apps/web/.env.local`                     | app Next.js (serveur + `NEXT_PUBLIC_*`)           | `make env` (copie de `.env.example`)         |
| `.env.local` (racine)                     | bridge (prioritaire sur `.env`)                   | optionnel                                    |
| Vercel → Settings → Environment Variables | app déployée                                      | tableau de bord Vercel (ou intégration Neon) |

Ordre de priorité : variable du shell > `.env.local` > `.env`. Une variable `NEXT_PUBLIC_*` est figée au build :
relancer `make dev` ou redéployer après un changement.

## Local (développement)

| Variable                                                                                                 | Obligatoire ?          | Valeur conseillée                  | Rôle                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                                                   | non                    | `3000`                             | Port de `make dev`, Playwright, `make shots`.                                                                                                                                                         |
| `LLM_PROVIDER`                                                                                           | non                    | `mock` (hors ligne) ou `meta`      | Fournisseur du copilote. `make dev-mock` force `mock`.                                                                                                                                                |
| `META_API_KEY`                                                                                           | si `LLM_PROVIDER=meta` | clé de dev.meta.ai                 | Vide → repli automatique sur `mock`. **Secret.**                                                                                                                                                      |
| `META_MODEL`                                                                                             | non                    | `muse-spark-1.3`                   | Id standard ; la variante `*-contributor` est choisie via `META_PREFER_CONTRIBUTOR`.                                                                                                                  |
| `META_BASE_URL`                                                                                          | non                    | vide (= `https://api.meta.ai/v1`)  |                                                                                                                                                                                                       |
| `META_VOICE_MODEL`, `META_VISION_MODEL`, `META_SEGMENT_MODEL`, `META_IMAGE_MODEL`                        | non                    | vide (= défauts de `.env.example`) | Modèles de perception (voix, vision, SAM, image).                                                                                                                                                     |
| `META_3D_MODEL`                                                                                          | non                    | `muse-spark-1.3-contributor`       | Défaut de chaque étape 3D qui regarde l'image (kit, pièces, critique, contrôle des vues, questions). Un id contributor refusé (403/404/429) retombe sur l'id standard.                                |
| `META_REFINE_MODEL`                                                                                      | non                    | `muse-spark-1.3-contributor`       | Défaut du modèle qui écrit le code 3D (`META_CODE_MODEL` vide = celui-ci). Contributor Spark, pas Wonder ; modifiable par étape dans l'engrenage de /village.                                         |
| `META_KIT_MODEL`, `META_PARTS_MODEL`, `META_CRITIC_MODEL`, `META_VIEWSCHECK_MODEL`, `META_ASKPART_MODEL` | non                    | vide (= `META_VISION_MODEL`)       | Modèle par étape 3D (PQ-T67) : kit, liste de pièces, critique, contrôle des vues, questions courtes. Vide = défaut. La carte est loguée (`[vision] 3D step models`).                                  |
| `SHAPE_FOUR_FACES`                                                                                       | non                    | `true`                             | Reconstruction par les vues (PQ-T69) : dessine aussi l'arrière et le côté gauche de tout objet quand ils ne sont pas validés ; `false` = avant + côté droit seulement (2 appels Muse Image en moins). |
| `META_SPEND_CAP_USD`                                                                                     | non                    | `15`                               | Dépense Meta estimée autorisée par session de chat. Au-delà → `mock`. `0` = aucun appel payant.                                                                                                       |
| `META_PREFER_CONTRIBUTOR`                                                                                | non                    | `true`                             | Privilégie Spark `*-contributor` (≈ 12× moins cher, mais Meta entraîne ses modèles sur les échanges). Refus → modèle standard. `false` pour de vraies données d'utilisateurs.                         |
| `DATABASE_URL`                                                                                           | non                    | URL Neon (pooled)                  | Historique des sessions du copilote. Vide → pas d'historique. **Secret.**                                                                                                                             |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                                              | non (les 3 ensemble)   | Cloudflare R2                      | Stockage des médias. Vide → R2 désactivé. Guide : [cloudflare-r2.md](cloudflare-r2.md). **Secrets.**                                                                                                  |
| `R2_BUCKET_NAME`                                                                                         | non                    | `mitsinjo-grid-media`              |                                                                                                                                                                                                       |
| `R2_PUBLIC_URL`                                                                                          | non                    | URL r2.dev ou domaine              |                                                                                                                                                                                                       |
| `NEXT_PUBLIC_BRIDGE_URL`                                                                                 | pour la maquette       | `ws://localhost:8787`              | Affiche le panneau « Maquette physique ». Visible dans le navigateur.                                                                                                                                 |
| `BRIDGE_*`, `MQTT_*`, `HW_*`                                                                             | non                    | voir `.env.example`                | Bridge local uniquement (`make bridge`, `make bridge-sim`). Détail : [bridge.md](../bridge.md).                                                                                                       |
| `BRIDGE_TOKEN`                                                                                           | non                    | `openssl rand -hex 24` (≥ 16 car.) | Rend le bridge en lecture seule sans `?bridgeToken=`. **Secret.**                                                                                                                                     |
| `MQTT_USERNAME`, `MQTT_PASSWORD`                                                                         | non (les 2 ensemble)   | identiques dans le firmware        | **Secrets.**                                                                                                                                                                                          |
| `STITCH_API_KEY`                                                                                         | outillage seulement    | clé Stitch                         | MCP Stitch pour Claude Code, pas l'app. **Secret.**                                                                                                                                                   |

Démarrage minimal : `make install && make env && make dev-mock` (aucune clé nécessaire).

## Production (Vercel)

À saisir dans Vercel → Project → Settings → Environment Variables, environnement **Production**
(et **Preview** si les PR doivent avoir le vrai copilote).

| Variable                                                                                       | À mettre                       | Note                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                                                                                 | `meta`                         | Sans clé valide, l'app retombe sur `mock` : la démo marche quand même.                                                        |
| `META_API_KEY`                                                                                 | clé Meta Model API             | **Secret**, jamais en `NEXT_PUBLIC_`.                                                                                         |
| `META_MODEL`                                                                                   | `muse-spark-1.3`               | Optionnel.                                                                                                                    |
| `META_BASE_URL`                                                                                | vide                           | Optionnel.                                                                                                                    |
| `META_SPEND_CAP_USD`                                                                           | `15` (ou moins)                | Optionnel. Plafond de dépense par session ; les modèles de perception gardent leurs défauts.                                  |
| `DATABASE_URL`                                                                                 | ajoutée par l'intégration Neon | L'intégration Vercel ↔ Neon crée aussi `PG*` et `POSTGRES_*` : l'app ne lit que `DATABASE_URL` (ou `NEON_DATABASE_URL`).      |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | si les médias R2 sont utilisés | **Secrets** (sauf nom du bucket et URL publique).                                                                             |
| `NEXT_PUBLIC_BRIDGE_URL`                                                                       | **ne pas définir**             | Le bridge tourne sur le portable de démo : ouvrir le site avec `?bridge=ws://localhost:8787` ([bridge.md](../bridge.md) § 8). |

Ne **pas** mettre sur Vercel : `PORT` (géré par Vercel), `BRIDGE_*`, `MQTT_*`, `HW_*`, `STITCH_API_KEY`,
`VERCEL_OIDC_TOKEN` (fourni par Vercel / `vercel env pull`).

## CI (GitHub Actions)

Aucun secret : `LLM_PROVIDER=mock` est fixé dans `.github/workflows/ci.yml`.

## Vérifier

- `make env-export` affiche ce que `.env` exporte.
- `npx vercel env ls` (après `make deploy-link`) liste les variables du projet Vercel.
- Après un changement sur Vercel : redéployer (les `NEXT_PUBLIC_*` sont figées au build).
