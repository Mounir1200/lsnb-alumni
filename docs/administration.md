# Le hub LSNB Réseau

Implémentation locale du 22 octobre 2026. La migration et la ressource Render sont préparées ; leur présence dans le dépôt ne signifie pas qu’elles ont été appliquées ou déployées.

## Architecture et disponibilité

Le hub est une application React distincte : `hub/index.html` → `hub/main.ts` → `src/hub/main.tsx`. Le site utilise toujours `index.html` → `src/main.tsx`. Les bundles, origines et déploiements sont séparés. Le hub appelle les fonctions PostgreSQL protégées avec la session Supabase du membre ; il n’a besoin de l’API Fastify que pour les logs opérationnels.

```text
Site public (dist) ── statut public + session membre ── Supabase
       │                                              │
       └── Highlights ── API Fastify ──────────────────┤
                                                      │
Hub (dist-hub) ── RPC avec droits vérifiés en base ─────┘
       └── logs ── API Fastify (session + rôle admin vérifiés)
```

La maintenance ferme le site et ses accès aux données, tout en laissant les fonctions du hub disponibles. Une panne de l’API ne bloque donc pas la réouverture depuis le hub. Une panne de Supabase rend aussi le hub indisponible : ce n’est pas un outil de reprise de la base ou de l’hébergeur.

## Droits et parcours

| Action | Administrateur | Modérateur |
| --- | --- | --- |
| Tableau de bord, liste des membres, journal | Toutes les promotions | Sa promotion uniquement |
| Retirer un membre avec un motif | Oui | Sa promotion uniquement |
| Rétablir un accès | Oui | Non |
| Corriger une promotion avec un motif | Oui | Non |
| Attribuer ou retirer un rôle | Oui | Non |
| Maintenance et logs du serveur | Oui | Non |

« Retirer » signifie suspendre l’accès et masquer le profil, de façon réversible. Ce n’est pas une suppression définitive des données ou du compte Auth. Une suspension bloque immédiatement les opérations sur les données, y compris avec un JWT encore valide. Le navigateur revérifie l’accès au plus toutes les 15 secondes lorsqu’il est visible, et lorsqu’il reprend le focus.

Un modérateur appartient à la promotion qu’il modère. Il ne peut agir sur lui-même, un autre membre de l’équipe ou une autre promotion. Il faut d’abord retirer le rôle d’un membre de l’équipe avant de le suspendre ; l’administrateur ne peut pas retirer son propre rôle. Le dernier administrateur est protégé. Un rôle révoqué cesse immédiatement d’autoriser les fonctions du hub ; l’interface recontrôle aussi le rôle régulièrement.

La promotion d’un profil terminé ne se modifie plus dans l’espace membre : l’admin utilise l’action de correction avec un motif. Le rôle d’un modérateur doit être retiré avant de changer sa promotion. Les profils Google à compléter restent distincts des suspensions ; rétablir un compte incomplet autorise son onboarding sans le publier prématurément dans l’annuaire.

Les motifs font entre 10 et 500 caractères. Le journal conserve l’auteur, le membre visé, la promotion, le motif et l’heure serveur. Aucune interface membre ne peut modifier ou effacer ce journal. Les messages privés des demandes et les emails de contact ne sont pas exposés au hub.

## Maintenance

L’admin choisit un message public et une fermeture jusqu’à une date/heure ou sans date de fin. L’action est confirmée avant enregistrement. La fin prévue est stockée en UTC ; le formulaire indique l’heure locale de l’appareil. Le statut effectif utilise l’horloge PostgreSQL : une maintenance expirée est automatiquement inactive, sans dépendre d’un cron ou de l’ouverture du hub.

Le site vérifie le statut avant de monter ses écrans. Pendant une maintenance, des politiques RLS restrictives bloquent la lecture et l’écriture des tables membres ; les uploads d’avatars, l’onboarding et les nouvelles inscriptions sont également bloqués. L’API Highlights répond `503`. Les RPC d’administration, la lecture du statut et la connexion de comptes existants restent disponibles. Les avatars et fichiers déjà publics ou déjà téléchargés ne peuvent pas être retirés des caches par cette fonctionnalité.

Le compteur se recale sur l’heure serveur, affiche jours/heures/minutes/secondes et ne devient jamais négatif. À zéro, l’interface attend la confirmation du serveur. En cas de panne réseau elle ne présume pas que le site a rouvert. Sans échéance, aucun compte à rebours artificiel n’est affiché.

Référence : [Counter Loader de Md afsar mahmud sur 21st.dev](https://21st.dev/@mdafsarx/components/counter-loader). Le code source y était verrouillé lors de la consultation. `CounterLoader.tsx` est une implémentation originale du principe visuel à segments, contrôlée par la vraie échéance, sans recopier le code ni installer `styled-components`. Les autres [références du hub](../src/hub/REFERENCES.md) sont documentées séparément.

## Statistiques et logs

- Le dashboard utilise les vrais profils, offres et demandes, regroupés par promotion, et 30 jours d’activité. Aucune métrique fictive n’apparaît en production.
- L’activité commence lors du déploiement de ce code : les périodes antérieures affichent zéro visite enregistrée, pas une estimation. Les inscriptions historiques viennent des dates réelles des profils.
- Une visite authentifiée enregistre uniquement l’identifiant du membre, la journée UTC et une rubrique parmi accueil, annuaire, profil, offres, highlights et espace membre. Une même rubrique est comptée au plus une fois par minute et par membre. Les textes de recherche, identifiants de profils consultés, messages et IP ne sont pas enregistrés par cette mesure. Ce sont des visites observées et agrégées, pas une mesure exhaustive de fréquentation anonyme.
- `GET /api/v1/admin/logs` vérifie le token auprès de Supabase Auth, puis relit le rôle en base à chaque requête. Les 500 derniers événements du **processus API** sont disponibles avec niveau, date, route générique, code HTTP et durée. Les tokens, corps, paramètres d’URL, emails et traces d’erreur ne sont jamais inclus.
- Les logs sont réinitialisés au redémarrage du processus ; ils n’incluent ni les logs de build Render, ni ceux de PostgreSQL ou du job Highlights séparé. Le journal de modération, lui, est persistant en base. Pour une conservation centralisée des logs d’infrastructure, un collecteur ou une intégration hébergeur reste nécessaire.

## Installation et activation

1. Relire puis appliquer `supabase/migrations/20261022212154_administration_hub.sql` sur un environnement d’essai, puis sur le projet cible. Ne jamais déployer le nouveau site ou l’API avant cette migration : le contrôle de disponibilité refuse l’accès s’il ne peut pas vérifier le statut.
2. Choisir un compte existant, actif et au profil complété comme premier administrateur. Un opérateur de confiance effectue l’attribution ci-dessous ; il n’existe aucune route publique d’auto-attribution. Remplacer explicitement le UUID, vérifier la ligne retournée et ne jamais se baser sur des métadonnées modifiables par l’utilisateur.

```sql
insert into private.hub_staff (user_id, role, graduation_year)
select id, 'admin', null
from public.profiles
where id = 'REMPLACER_PAR_LE_UUID_DU_COMPTE'::uuid
  and is_active and profile_completed
returning user_id, role;
```

3. Créer la ressource statique **lsnb-alumni-hub** prévue dans `render.yaml` : commande `npm ci --include=dev && npm run build:hub`, dossier `dist-hub`, réécriture vers `/index.html`. Son déploiement automatique est désactivé pour permettre une publication indépendante du site.
4. Configurer ses variables publiques `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SITE_URL`. Aucun secret backend dans le hub.
5. Ajouter l’origine exacte du hub à `FRONTEND_ORIGINS` de l’API. Ajouter l’URL du hub aux redirections Supabase autorisées pour Google et conserver celles du site. Configurer `VITE_HUB_URL` sur le site pour le lien d’accès à l’équipe.
6. Déployer API, hub et site après vérification de la migration. Tester sur l’environnement d’essai un admin, un modo et deux membres de promotions différentes ; tester aussi une maintenance courte et sa réouverture. Aucun compte réel n’est modéré par les tests locaux.

## Développement et validation

```sh
npm run dev          # site, habituellement 5173
npm run dev:hub      # hub, 5174
npm run dev:api      # API, 4000
npm run build
npm run build:hub
npm run build:api
npm run test:api
```

Les caches Vite du hub et du site sont séparés pour pouvoir les lancer simultanément. En développement seulement, `?demo=admin` et `?demo=moderator` donnent un aperçu clairement marqué avec des exemples et aucune écriture ; ces chemins de démonstration sont éliminés à la compilation de production. Sur le site, `?maintenance-preview=timed` ou `indefinite` sert à vérifier la mise en page sans activer une vraie maintenance.

Les tests PostgreSQL embarqués exécutent la chaîne de migrations et vérifient les accès anonymes, l’isolation par promotion, la révocation des rôles, la suspension/restauration, la protection des champs, les contraintes du journal, le blocage de maintenance, son expiration, l’inscription et l’onboarding Google. Les tests API couvrent les autorisations, les erreurs, les filtres et l’absence de secrets dans les logs. Les helpers de compteur et les catégories d’activité ont aussi des tests.

## Contrôle anti-slop

Le hub reprend les polices et le vert du réseau, avec une grille centrée sur les données et des séparateurs fins. Les statistiques ont un tableau équivalent, les actions sensibles un dialogue de confirmation et les états vide/erreur une reprise. Les animations respectent `prefers-reduced-motion`. Les vues admin, modérateur et maintenance sont contrôlées en navigateur, y compris dans un viewport de 390 px ; aucune validation avec de vrais comptes distants n’est revendiquée.
