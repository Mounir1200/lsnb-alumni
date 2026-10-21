# Demandes et liens de mentorat

La fonctionnalité est implémentée dans le frontend. Sa migration a été appliquée au projet Supabase Cloud **LSNB Alumni** (`yesumbhssechcrlgpgqj`) le 21 octobre 2026. Le frontend reste à déployer ; aucune VM n’a été modifiée.

## Parcours

Un membre sollicite une personne qui propose du mentorat depuis sa fiche. Il accompagne sa demande d’un message. Le destinataire accepte ou refuse depuis son espace de relations ; l’auteur peut annuler tant que la demande est en attente.

L’écran **Mon espace → Mes relations et demandes** (`/espace/relations`) regroupe les demandes reçues, envoyées et les mentorats actifs. Les demandes de contact existantes y sont aussi traitées, sans créer de lien de mentorat. Aucun email ni message externe n’est envoyé automatiquement et aucune messagerie instantanée n’a été ajoutée.

L’acceptation crée un lien de mentorat actif. Les fiches des deux personnes affichent ce lien aux membres connectés : le mentor figure parmi les mentors de la personne accompagnée, et celle-ci parmi ses juniors. « Junior » décrit la place dans cette relation, pas un nouveau rôle de compte.

Chacun des deux participants peut mettre fin au lien depuis son espace de relations. Le lien n’apparaît alors plus sur les fiches. Une relation active nécessite donc une demande acceptée ; consulter une fiche ou envoyer une demande ne suffit pas.

Désactiver « Je propose du mentorat » dans le profil empêche de nouvelles demandes. Cela ne termine pas les relations actives : leur fin est une action distincte.

Le demandeur doit avoir un profil actif et complété ; le mentor doit aussi être alumni et proposer le mentorat. Un alumni peut lui-même solliciter un mentor. Deux alumni peuvent s’accompagner réciproquement, avec deux demandes et acceptations indépendantes. Le message contient entre 20 et 1 200 caractères après suppression des espaces aux extrémités.

Sur les fiches, les compteurs et listes « Mentors » / « Mentorés » concernent les relations actives entre profils actifs et complétés. Les noms et portraits renvoient aux profils concernés. Les listes sont paginées par identifiant pour éviter une troncature au plafond de réponse Supabase. Elles sont rechargées à l’ouverture ; l’écran de gestion se recharge après une action et propose « Actualiser ». Aucun abonnement Realtime n’est configuré.

Comme aucun email n’annonce une demande, le lien « Mes relations » de la barre de navigation affiche discrètement le nombre de demandes reçues en attente (point sur le bouton du menu en mobile). Ce compteur est recalculé à chaque changement de page et après chaque réponse ou actualisation dans l’écran de gestion ; il disparaît à zéro et ne charge aucun message.

Le réseau apparaît sous l’identité du profil, avant le parcours. Les onglets « Mentors » et « Mentorés » affichent leurs compteurs et se parcourent au clavier (flèches, Début, Fin). L’onglet Mentorés est ouvert lorsqu’il contient des personnes, sinon Mentors. Les fiches présentent le portrait, le nom, la spécialité et la promotion, sur trois, deux ou une colonne selon la largeur disponible. Les compteurs ne s’affichent qu’après chargement réussi. Dans l’espace personnel, les mentorats actifs utilisent des lignes plus légères ; l’action « Terminer le mentorat » reste visible et demande confirmation.

## Confidentialité

Les demandes et leur message sont réservés à l’auteur et au destinataire. Un membre tiers peut voir un lien de mentorat actif sur une fiche, mais pas le message qui l’a précédé ni le suivi des demandes de ces personnes. Les liens de mentorat ne rendent pas les coordonnées privées visibles ; leur réglage reste indépendant.

Les droits sont appliqués dans PostgreSQL, y compris pour un client qui appelle directement Supabase. Masquer un bouton ou un message dans React ne constitue pas un contrôle d’accès. Les accès privilégiés d’administration de la base restent distincts de ceux des membres.

`connection_requests` conserve les messages privés et les états `pending`, `accepted`, `declined`. La table distincte `mentorships` ne contient aucun message ni email. Elle est alimentée uniquement par un trigger après acceptation du destinataire ; les clients ne peuvent pas y insérer ou supprimer des lignes. Les participants peuvent seulement demander la fin via `ended_at` ; la base renseigne l’auteur et la date. Une contrainte unique empêche plusieurs mentorats actifs dans le même sens. Une reprise nécessite une nouvelle demande.

Les trois profils existants ont été conservés ; aucune demande ni relation n’existait avant la migration. Pour un autre environnement comportant des demandes de mentorat déjà acceptées, la migration s’arrête : l’ancien schéma permettait de déclarer une acceptation à l’insertion et ne garantit donc pas leur consentement. Ces données doivent être examinées avant migration, sans conversion automatique.

## Vérifications automatisées

Les tests exécutent les migrations avec les rôles `anon` et `authenticated`, puis vérifient les cas suivants :

- Un membre actif crée une demande vers un mentor disponible, sans pouvoir choisir un autre auteur ni se l’envoyer à lui-même.
- Seul le destinataire accepte ou refuse une demande en attente ; seul l’auteur l’annule.
- Une demande déjà traitée ne peut pas être traitée à nouveau ni recréer un lien après sa fin.
- Une demande de contact ne crée pas de lien de mentorat.
- Des doubles clics, demandes concurrentes et appels directs ne créent pas plusieurs liens actifs identiques.
- Un tiers ne lit ni le message ni l’historique d’une demande et ne modifie aucune relation étrangère.
- Les membres connectés peuvent lire les liens actifs exposés sur les fiches ; les visiteurs anonymes n’y ont pas accès.
- Les deux participants peuvent mettre fin à leur relation, sans altérer l’identité du mentor ou du junior.
- Désactiver une offre de mentorat ne supprime pas les relations actives.
- Les erreurs réseau ou de migration manquante sont affichées ; elles ne sont pas présentées comme une liste vide ni comme une action réussie.

## Validation locale

Le projet utilise `node:test` et PGlite pour les tests PostgreSQL, sous `api/src/highlights/`. Les contrôles frontend sont effectués à la racine :

```bash
npm run typecheck
npm run build
npm run test:api
```

Validation du 21 octobre 2026 : **192 tests réussis**, dont 15 scénarios PostgreSQL de mentorat et 7 tests de repository. TypeScript frontend/API et compilation Vite réussis. Les essais d’unicité concurrents utilisent PGlite ; aucune campagne PostgreSQL multisession n’a été réalisée.

Le navigateur a vérifié un parcours avec deux comptes fictifs dans un environnement local isolé : création de demande, attente, visibilité de la demande côté mentor, consentement et acceptation, compteur à 1 sur le profil mentor et liste des mentors du junior, puis fin et retour des compteurs à 0. Les scénarios refus, retrait et tiers sont couverts par les tests DB. Les simulations n’ont créé aucune donnée sur Supabase. L’accès anonyme à l’écran de gestion redirige vers la connexion.

La présentation a été vérifiée dans le navigateur sur ordinateur et à 768, 375 et 320 pixels, avec des profils fictifs et des noms longs. Les contrôles couvrent les onglets au clavier, les liens vers les profils, les deux listes vides, une erreur suivie d’un réessai réussi, l’annulation de la fin avec restauration du focus et la fin d’un mentorat avec mise à jour du compteur. TypeScript et compilation Vite ont été revalidés après la refonte visuelle. Aucune migration supplémentaire n’est nécessaire.

## Déploiement

Migration : [`20261021183651_mentorship_requests_and_network.sql`](../supabase/migrations/20261021183651_mentorship_requests_and_network.sql), version confirmée dans l’historique Supabase Cloud. La vérification distante confirme RLS active, lecture anonyme interdite, insertion directe des relations interdite, modification limitée aux colonnes d’action et fonctions de trigger inaccessibles aux clients. Security Advisors n’a ajouté aucune alerte par rapport à l’état précédent.

Pour les autres environnements, appliquer cette migration après les migrations existantes, puis déployer le frontend qui l’utilise. Ne pas réexécuter le schéma initial ni réinitialiser la base. La migration est transactionnelle.
