# Offres : stages, bourses et admissions

L’onglet **Offres** (`/offres`) permet aux mentors alumni de partager des stages, des bourses et des inscriptions universitaires. Les membres parcourent les offres et posent leurs questions à la personne qui les a publiées.

La migration [`20261021231304_mentor_offers.sql`](../supabase/migrations/20261021231304_mentor_offers.sql) a été appliquée au projet Supabase Cloud **LSNB Alumni** (`yesumbhssechcrlgpgqj`) le 21 octobre 2026 (UTC) ; le frontend reste à déployer. Dans tout autre environnement, elle doit être appliquée **avant** le frontend : la liste « Mes relations et demandes » lit désormais la référence de l’offre associée à une demande.

## Parcours

- **Publier** (`/offres/publier`) : réservé aux alumni actifs, au profil complet, qui proposent du mentorat. Un alumni sans mentorat activé est invité à l’activer depuis son profil ; un élève peut seulement consulter.
- **Parcourir** : filtres par type (stage, bourse, admission) et recherche sans accents sur l’intitulé, l’organisme, le lieu, la description et le nom de l’auteur. La liste affiche les offres ouvertes ; une offre dont la date limite est passée la quitte automatiquement.
- **Mes offres** : l’auteur retrouve toutes ses offres, y compris clôturées ou masquées, et peut les modifier ou les supprimer depuis leur fiche.
- **Poser une question** : depuis la fiche d’une offre, le membre envoie une demande d’échange (`contact`) à l’auteur, liée à l’offre. Elle apparaît dans **Mes relations et demandes** comme « Question sur une offre », avec un lien vers celle-ci. L’auteur l’accepte ou la refuse comme toute demande d’échange. Aucun email n’est envoyé.

Une seule demande d’échange peut être ouverte (en attente ou acceptée) entre deux membres : une question sur une seconde offre du même auteur est alors couverte par l’échange existant, et la fiche le signale.

## Visibilité et règles appliquées par la base

- Les offres sont lisibles par les membres actifs au profil complet, tant que leur auteur est actif et propose du mentorat. Désactiver le mentorat masque ses offres sans les supprimer ; l’auteur les voit toujours.
- Les visiteurs non connectés voient une invitation à se connecter, jamais d’offres fictives : ce sont de vraies opportunités. Sans Supabase configuré, le mode démonstration affiche des offres fictives, signalées comme telles.
- Seul l’auteur modifie ou supprime son offre. L’identifiant, l’auteur et les dates de création et de modification sont fixés par la base.
- Contraintes : intitulé de 5 à 120 caractères, organisme de 2 à 120, lieu facultatif jusqu’à 120, description de 30 à 3 000, lien HTTPS public facultatif (mêmes règles que le portfolio), date limite facultative qui ne peut pas être déjà passée. Une offre expirée reste modifiable tant que sa date limite n’est pas changée.
- Une question sur une offre doit être une demande d’échange adressée à l’auteur d’une offre que le demandeur peut lire.
- Supprimer une offre conserve les questions reçues et leur message ; elles perdent seulement leur lien vers l’offre. La suppression d’un compte supprime ses offres.

La migration remplace la fonction `private.guard_connection_request()` par une version qui ajoute ces deux comportements, sans changer les règles existantes des demandes et du mentorat.

## Vérifications

```bash
npm run typecheck
npm run build
npm run test:api
```

- `api/src/highlights/offers.database.test.ts` exécute toutes les migrations dans PGlite et vérifie, avec les rôles `anon` et `authenticated` : publication réservée aux mentors, champs fixés par la base, longueurs, liens et dates limites, droits de l’auteur, masquage, questions liées à une offre, suppression d’une offre puis d’un compte.
- `api/src/highlights/offers.repository.test.ts` vérifie la pagination, la normalisation et la validation des offres côté client, ainsi que l’envoi de la référence de l’offre avec une question.

## Déploiement

Avant l’application, la fonction `private.guard_connection_request()` de production était identique à celle du dépôt ; la base ne contenait aucune demande. Après l’application, la vérification distante confirme : version enregistrée dans l’historique Supabase, RLS active avec quatre politiques, aucun droit pour `anon`, écriture des membres limitée aux colonnes de contenu, fonctions de trigger inaccessibles aux clients. Un contrôle exécuté dans une transaction annulée a confirmé le refus de la lecture anonyme, de la publication par un membre non mentor, de l’écriture des champs fixés par la base et d’une question liée à une offre inconnue ; aucune donnée n’a été écrite.

Security Advisors n’a ajouté aucune alerte par rapport à l’état précédent. Performance Advisors signale seulement que les deux nouveaux index (`offers_author_idx`, `connection_requests_offer_idx`) n’ont pas encore servi, ce qui est attendu pour une table vide.
