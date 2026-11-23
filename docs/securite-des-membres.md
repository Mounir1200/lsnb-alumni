# Sécurité des membres

Charte de conduite, blocage, signalement et mot de passe oublié. Implémentation du 9 novembre 2026 ; les deux migrations ci-dessous ont été appliquées en production le 10 novembre 2026.

## Pourquoi

Les élèves du lycée, en majorité mineurs, échangent en privé avec des adultes. Avant d’ouvrir le réseau plus largement, chacun doit connaître les règles et pouvoir se protéger : bloquer une personne, la signaler à l’équipe, et retrouver l’accès à son compte sans dépendre de Google.

## Charte de conduite

- Page publique `/charte` (`src/pages/CharterPage.tsx`), liée depuis le pied de page, les fenêtres de blocage et de signalement et la politique de confidentialité.
- À l’inscription par e-mail et à la complétion d’un profil Google, une case obligatoire engage à la respecter (`CharterConsent`). La charte s’ouvre dans un nouvel onglet pour ne pas perdre le formulaire. Cet engagement n’est pas enregistré en base.
- Numéros d’urgence vérifiés pour le Burkina Faso : police secours 17, sapeurs-pompiers 18. Le 116 (enfance en danger, lancé en 2011) n’a pas pu être confirmé comme toujours actif : le vérifier auprès du ministère de l’Action sociale avant de l’ajouter.

## Blocage

Migration : `supabase/migrations/20261110115109_member_blocks.sql`.

- Un membre bloque depuis un profil ou une conversation (`MemberSafety`). Personne n’est prévenu.
- `public.block_member()` est la seule entrée. Elle enregistre le blocage puis met fin aux liens du couple : les demandes en attente du membre bloqué sont refusées (leurs e-mails d’annonce partent alors à la corbeille, la file vérifie l’état de la demande), celles du bloqueur sont retirées, la connexion est supprimée et les mentorats actifs prennent fin, signés par le bloqueur. Relancée, elle ne change rien.
- Le blocage et toute nouvelle demande entre les deux membres prennent le même verrou, propre au couple : une demande envoyée pendant un blocage attend qu’il soit écrit, puis est refusée. La file d’e-mails n’envoie plus rien à propos d’une demande entre deux membres dont l’un a bloqué l’autre (`20261118143817_block_request_lock.sql`). Les tests embarqués n’ont qu’une connexion et ne peuvent pas rejouer cette course.
- Des déclencheurs refusent ensuite, dans les deux sens, toute demande, toute acceptation et tout message entre les deux membres (code d’erreur `LS423`), quel que soit le chemin d’écriture. Refuser une demande reste possible.
- `public.member_blocks` n’est lisible et supprimable que par l’auteur du blocage (RLS). La liste et le déblocage sont dans « Mes relations ». Lever un blocage ne rétablit pas les liens terminés.
- Les fiches restent visibles : seules les prises de contact sont bloquées. Le membre bloqué peut le déduire d’un refus d’envoi.
- Pas de limite de débit : un blocage n’envoie aucun e-mail et ne touche aucun tiers.

## Signalement

Migration : `supabase/migrations/20261110115213_member_reports.sql`.

- Un membre signale depuis un profil, une conversation ou une offre (son auteur), avec un motif parmi six ; une description est obligatoire pour « Autre problème ». Le motif « Comportement inquiétant envers un élève » rappelle de prévenir un adulte de confiance et, en cas d’urgence, la police.
- Les signalements vivent dans `private.member_reports` : les membres les déposent par `public.report_member()` ou `public.messaging_report_conversation()` et ne les relisent jamais. Le membre signalé ne voit ni le signalement ni son auteur.
- Un signalement de conversation copie ses 20 derniers messages, ceux du signaleur compris, scellés avec la clé de la messagerie (`messaging_message_key_v1`). Il est signé avec la clé d’appareil, comme tout appel de messagerie : un jeton d’accès copié seul ne peut pas exposer une conversation. Le nombre de messages vient de `REPORTED_MESSAGE_COUNT`, affiché par la charte et la politique de confidentialité ; un test le compare à la migration, comme la liste des motifs.
- Limites : un signalement ouvert par membre visé, cinq par jour et par signaleur. Les signalements ne sont jamais supprimés par les membres, donc supprimer ne remet pas le compteur à zéro, et un verrou sérialise les appels parallèles d’un même signaleur. Pas de plafond global : il faut un compte actif et complet, et un plafond que de faux comptes rempliraient ferait taire les vrais signalements.
- Conservation : un signalement reste tant que le compte visé existe ; si le signaleur supprime son compte, ses signalements restent, sans son nom.

## Traitement dans le hub

Écran « Signalements » (`src/hub/reports.tsx`), fonctions `public.hub_reports()` et `public.hub_resolve_report()`.

Un membre de l’équipe agit sur un signalement qui vise quelqu’un en dessous de lui, dans sa portée, jamais sur lui-même ; les super administrateurs traitent aussi ceux qui visent l’un d’eux (`private.report_in_scope`).

| Action | Super administrateur | Administrateur | Modérateur |
| --- | --- | --- | --- |
| Lire le détail (description, auteur, conversation) | Tous, sauf ceux qui le visent | Tous, sauf ceux qui visent un administrateur | Sa promotion, sauf l’équipe |
| Être averti (nom, promotion, motif, état) | — | — | Tous les membres signalés des autres promotions |
| Marquer résolu ou classer sans suite, avec une note | Dans sa portée | Dans sa portée | Dans sa portée, sauf ses propres signalements |
| Retirer l’accès du membre signalé depuis la fiche | Oui | Oui | Membres de sa promotion |

Les badges du menu du hub comptent les signalements ouverts et les comptes à valider de chacun (`hub_context`, relu chaque minute).

Chaque décision est inscrite dans le journal (`report_resolved`, `report_dismissed`) avec la note. Le journal ne montre ces entrées qu’à ceux qui peuvent agir sur le signalement (`private.report_in_scope`), comme l’écran « Signalements » : jamais au membre de l’équipe visé ni à ses pairs (`20261118143706_report_journal_scope.sql`). Un signalement ne se traite qu’une fois. L’aperçu local `?demo=admin` ou `?demo=moderator` montre des signalements fictifs, retirés du build de production.

L’équipe n’est pas prévenue par e-mail d’un nouveau signalement : elle consulte le hub. Une alerte déclenchée à l’arrivée du signalement serait l’évolution suivante, en respectant le quota Brevo partagé.

## Validation des nouveaux comptes

- Un profil qui devient complet (inscription par e-mail ou fin de l’onboarding Google) passe « en attente » : `profiles.approval_pending`, posé par un seul déclencheur. Un compte en attente est inactif, donc absent de l’annuaire, de Highlight, des demandes, des messages et des offres. Deux contraintes interdisent un compte en attente incomplet ou actif.
- Lire les profils et les contacts des autres demande un compte actif (`private.member_active()`). Le compte en attente se connecte, lit et modifie son propre profil et son contact, et voit le reste comme un visiteur. Le site lui explique où il en est (`PendingApproval`).
- Le modérateur de la promotion, ou un administrateur, valide le compte depuis l’écran « À valider » du hub (`hub_approve_member`, inscrit au journal). Refuser, c’est suspendre avec un motif ; rétablir un compte refusé le remet en attente.
- Les comptes créés avant la migration restent validés.
- Un compte n’est proposé à la validation qu’une fois son adresse e-mail confirmée (`private.awaits_approval`) : une inscription non confirmée, faute de frappe ou robot, n’apparaît pas dans « À valider » et ne déclenche aucun e-mail.
- Les modérateurs de la promotion, les administrateurs et les super administrateurs reçoivent alors un e-mail sans nom, qui compte les comptes en attente dans leur portée et mène à « À valider » (`20261111013043_approval_emails.sql`, `api/src/approvals/notifications.ts`). Pour ménager Brevo : au plus un e-mail toutes les 12 heures par membre de l’équipe, et 20 par jour en tout ; l’e-mail est abandonné si plus rien n’attend. Avec les 180 alertes de messages, les 60 e-mails de demandes et les 30 e-mails de compte validé (ci-dessous), il reste 10 e-mails par jour pour ceux de Supabase (confirmation d’inscription, mot de passe oublié) sur les 300 de l’offre gratuite, si tous les plafonds sont atteints (voir [Messagerie](messaging.md)).
- Le membre dont le compte est validé, et ainsi rendu actif, reçoit une seule fois un e-mail sans nom, promotion ni motif, qui l’invite à se connecter (`20261123090001_account_approved_email.sql`, `api/src/approvals/accountApproved.ts`). Les comptes validés avant cette migration ne le reçoivent pas, ni un compte refusé resté suspendu ; une nouvelle validation n’en envoie pas un second. Au plus 30 par jour : les suivants partent le lendemain.

## Suppression de compte

- « Supprimer mon compte », en bas de « Modifier mon profil », demande d’abord à la base si le compte peut partir (`account_deletion_status()`). Une connexion de plus de dix minutes propose « Me reconnecter » : le site ferme la session et revient sur cette section après la connexion. Le dernier super administrateur est invité à en nommer un autre. Sinon, le membre tape SUPPRIMER ; le site appelle `delete_my_account()`, puis oublie les brouillons, ouvre `/compte-supprime` et ferme la session locale.
- `delete_my_account()` refuse une session absente, expirée, d’un autre compte ou ouverte depuis plus de dix minutes (`LS428`) et le dernier super administrateur (`LS409`), sous le verrou de l’équipe ; sinon il supprime l’utilisateur `auth.users` de l’appelant ; les cascades emportent le profil, le contact, les relations, les demandes, les messages et appareils, les offres, les blocages, le rôle d’équipe, l’activité et les portraits Highlight. Les signalements faits par le membre restent, sans son nom ; ceux qui le visent disparaissent avec son compte. Le journal de modération garde les noms et les motifs.
- La photo est hors des cascades : la suppression d’un profil, quel que soit le chemin, dépose une tâche dans `private.avatar_removal_queue`, et la tournée de notifications de l’API la retire par l’API Storage avec la clé de service (bail, nouvelles tentatives espacées, abandon après huit essais).
- Un compte suspendu n’atteint pas cette page : il demande sa suppression à l’adresse de contact. L’équipe supprime alors le compte en SQL (`delete from auth.users where id = …`) ; la photo part de la même façon.

## Mot de passe oublié

- La connexion mène à `/mot-de-passe-oublie`, qui envoie un lien avec le client « liens par e-mail » (sans PKCE) : il s’ouvre aussi sur un autre appareil. Le message affiché ne dit pas si un compte existe ; 60 secondes séparent deux demandes, en plus des limites de Supabase.
- Le lien revient sur `/auth/callback?next=/nouveau-mot-de-passe`. Le membre confirme qu’il s’agit de son compte, choisit un mot de passe d’au moins 8 caractères, puis ses autres appareils sont déconnectés (`signOut({ scope: "others" })`), ce qui coupe aussi leur messagerie. Un lien expiré l’indique et propose d’en demander un autre.
- À configurer dans Supabase (Authentication → Emails → Reset Password) : l’objet « Réinitialisez votre mot de passe LSNB Alumni » dans Subject, et tout le contenu de `docs/email-templates/reset-password.html` dans Body. Le fichier JSON voisin sert seulement à l’API de gestion (détails dans `docs/email-templates/README.md`). Les URL de retour sont sur le même domaine que le site, déjà autorisé.

## Mise en production

1. Fait le 10 novembre 2026 : `20261110115109_member_blocks.sql`, puis `20261110115213_member_reports.sql`, appliquées dans cet ordre (les fichiers portent les versions enregistrées par Supabase). Elles ne cassent pas le site déjà en ligne : elles ajoutent des tables, des fonctions et des déclencheurs.
2. Fait le même jour, sur la production : la RLS est active ; aucune table de blocage ou de signalement n’est accessible à `anon` ; `authenticated` ne peut que lire et supprimer ses propres blocages et ne lit aucun signalement ; seules `block_member`, `report_member`, `messaging_report_conversation`, `hub_reports` et `hub_resolve_report` lui sont ouvertes ; les fonctions internes ne le sont pas. Les avertissements de sécurité Supabase ne signalent rien de nouveau hors de ces fonctions ouvertes, de même nature que celles de la messagerie et du hub.
3. Appliquer le modèle d’e-mail de réinitialisation.
4. Déployer le site, puis le hub (publication manuelle sur Render).
5. Fait le 11 novembre 2026 : `20261111005158_member_approval.sql`, `20261111005213_account_deletion.sql` puis `20261111005314_hub_role_levels.sql`, appliquées dans cet ordre (les fichiers portent les versions enregistrées par Supabase). Le compte du propriétaire du réseau a été nommé super administrateur en SQL juste après ; l’autre administrateur reste administrateur. Vérifié en production : aucun compte en attente, les 7 profils actifs le restent, aucun visiteur ne peut appeler `delete_my_account`, et le hub reconnaît le super administrateur. La validation change le site déjà en ligne : déployer le site et le hub sans tarder.

## Vérifications

```bash
npm run typecheck
npm run build
npm run build:hub
npm run test:api
```

Tests ajoutés : `account-deletion.database.test.ts` (connexion récente, dernier super administrateur, file des photos), `avatar-removal.test.ts`, `member-approval.database.test.ts`, `account-deletion.database.test.ts`, `account-deletion.test.ts`, `member-status.test.ts`, `invitations.test.ts`, `hub-member-errors.test.ts`, `member-blocks.database.test.ts`, `member-reports.database.test.ts`, `safety.repository.test.ts`, `safety.test.ts`, `password-recovery.test.ts`, `auth-errors.test.ts`, `hub-report-errors.test.ts`, et des cas dans les tests de messagerie et de relations. Les fenêtres et l’écran du hub ont été contrôlés dans le navigateur en démonstration, à 1024 et 375 px. Le parcours complet avec de vrais comptes (lien de réinitialisation reçu, blocage et signalement entre deux comptes) reste à valider sur l’environnement réel.
