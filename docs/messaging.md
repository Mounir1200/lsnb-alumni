# Messagerie LSNB Alumni

## Échanges et confidentialité

Une demande acceptée ouvre une conversation dans `/espace/messages`. Seuls ses deux participants peuvent y accéder. Les anciennes demandes et leur texte restent dans le parcours de demandes ; ils ne sont pas copiés dans la messagerie. Les formulaires de premier contact précisent cette différence.

Le membre ne gère aucune clé : il se connecte, ouvre Messages, lit et répond. Sur un nouvel appareil, une connexion habituelle (mot de passe ou Google) suffit.

### Comment les messages sont protégés

- **Chiffrement dans la base.** Chaque message est scellé par la base (pgcrypto, AES-256) avec une clé de 256 bits rangée dans Supabase Vault (`messaging_message_key_v1`), créée par la migration. Le texte scellé reprend l'identifiant de la conversation et de la tentative : un chiffré recopié sur une autre ligne est refusé. La colonne `key_version` prépare un futur changement de clé.
- **Clé d'appareil liée à une connexion.** Juste après la connexion, le navigateur appelle `messaging_register_device()`. La base ne l'accepte que si la session (`auth.sessions`) a moins de dix minutes et n'a pas encore de clé. Elle renvoie une fois 32 octets aléatoires, que le navigateur importe comme clé HMAC non exportable et garde dans IndexedDB. La base n'en conserve qu'une copie scellée.
- **Chaque appel est signé.** Les fonctions de messagerie reçoivent une preuve `{ issued_at, signature }`. La signature HMAC-SHA-256 porte sur la version, l'action, l'identifiant de session, l'heure et les arguments exacts de l'appel (`signedCalls` dans `src/lib/messagingData.ts`). Elle reste valable cinq minutes ; l'écart d'horloge du navigateur est corrigé à l'enregistrement.
- **Ce que permet un jeton copié.** Un jeton d'accès appartient à une session qui a déjà sa clé, ou qui a plus de dix minutes : il ne peut ni lire, ni envoyer, ni enregistrer un nouvel appareil (tests dans `messaging-devices.database.test.ts`).
- **Révocation.** La déconnexion supprime la session, ce qui rend sa clé inutilisable immédiatement, même si le jeton n'a pas encore expiré. Mes messages liste les appareils connectés, permet d'en retirer un et de déconnecter tous les autres.
- **Accès direct fermé.** Les membres ne lisent plus la table des messages. Tout passe par des fonctions contrôlées qui respectent suspension, maintenance, participation à une demande acceptée et limite d'envoi. Un identifiant de tentative empêche les doublons après une perte de réseau. Seuls les messages affichés au destinataire sont marqués lus.
- **Temps réel sans contenu.** Un déclencheur envoie sur le canal privé `messaging:<membre>` l'identifiant de la conversation et du message, jamais le texte ; le navigateur récupère ensuite le message par un appel signé. Une politique sur `realtime.messages` limite chaque membre à son propre canal.

### Limites à connaître

- **Ce n'est pas du chiffrement de bout en bout.** Les personnes qui administrent le projet Supabase (base et Vault) pourraient techniquement déchiffrer les messages. La page Confidentialité le dit explicitement.
- Quiconque obtient les identifiants du compte, ou l'accès à la boîte e-mail pour réinitialiser le mot de passe, peut se connecter et lire les messages, comme sur tout service en ligne.
- Un appareil compromis, ou du code malveillant exécuté sur l'origine du site, peut utiliser la clé d'appareil pendant que la page est ouverte. La clé n'est pas exportable, mais la prévention XSS reste nécessaire.
- Un jeton copié révèle encore des métadonnées : l'arrivée d'un message dans une conversation (canal temps réel) et la liste des demandes.
- Si le navigateur efface ses données de site, ou refuse IndexedDB, la messagerie demande une nouvelle connexion sur cet appareil.
- Une preuve interceptée en même temps que son jeton peut être rejouée pendant sa durée de validité, pour le même appel uniquement.

### Ancien format

Le 24 octobre 2026, la messagerie de bout en bout avec clé `LSNB1` a été retirée : la production ne contenait aucun message, une seule identité de test et un code e-mail en attente, supprimés par la migration `20261024191932_device_bound_messaging`. La migration refuse de s'exécuter s'il existe déjà des messages.

## E-mails et coûts

Brevo envoie les confirmations Supabase par SMTP et les alertes de messages par API transactionnelle. L'expéditeur de démarrage est `LSNB Alumni <mounirdabire47@gmail.com>`. Les modèles reprennent le bleu profond et les teintes banco du site, avec HTML en tableaux, styles intégrés et version texte pour les e-mails API. Le modèle de confirmation versionné est dans `docs/email-templates/confirm-signup.html` ; il utilise le lien personnel `{{ .ConfirmationURL }}` fourni par Supabase.

Les alertes sont différées d'au moins cinq minutes, annulées après lecture et suspendues pendant une activité récente sur le site. Elles sont limitées à une par membre et par heure et peuvent être désactivées depuis la messagerie. Elles ne révèlent ni l'auteur ni le contenu du message.

Les fonctions réservent au plus 180 alertes par jour UTC. Le quota Brevo Free de 300 envois/jour est partagé avec les e-mails Auth : la marge restante n'est pas un quota réservé. Aucun service payant supplémentaire n'est créé : Vault, pgcrypto et les canaux privés Realtime font partie de l'offre gratuite de Supabase. Sources : [limites Brevo Free](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [runners standards gratuits pour les dépôts publics](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Le workflow GitHub appelle l'API Render toutes les cinq minutes. L'appel utilise un jeton HMAC dérivé de la clé Brevo, comparé en temps constant. Cet endpoint ne permet de choisir ni destinataire ni contenu et ne renvoie que des compteurs. La clé Supabase serveur reste uniquement sur Render. Les notifications utilisent des réservations et l'idempotence Brevo ; les reprises sont bornées à moins de 30 minutes.

Le planificateur GitHub peut retarder ou omettre une exécution ; les workflows publics peuvent être désactivés après 60 jours d'inactivité. Le service Render gratuit peut démarrer à froid. La lecture et l'envoi de messages ne passent pas par l'API Render et ne subissent donc pas ce démarrage. Voir les [limites des workflows planifiés](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Configuration

1. Appliquer dans l'ordre les migrations `20261023221107_private_messaging`, `20261023221132_end_to_end_messaging`, `20261023221136_messaging_identity_verification`, puis `20261024191932_device_bound_messaging`. Vérifier ensuite la présence du secret `messaging_message_key_v1` dans Vault, les droits des fonctions et la politique `realtime.messages`.
2. Déployer le site juste après la dernière migration : l'ancien site appelle des fonctions qui n'existent plus.
3. Render API : conserver `SUPABASE_URL`, `SUPABASE_SECRET_KEY` et `FRONTEND_ORIGINS`. Pour les alertes, ajouter `BREVO_API_KEY`, `MESSAGING_FROM_EMAIL`, `MESSAGING_SITE_URL=https://lsnb-alumni-web.onrender.com`, `MESSAGING_EMAIL_ENABLED=true`. Ne jamais utiliser de préfixe `VITE_` pour un secret.
4. GitHub Actions : secret `BREVO_API_KEY` seulement ; variables `MESSAGING_API_URL=https://lsnb-alumni-api.onrender.com` et `MESSAGING_EMAIL_ENABLED=true`. Le workflow refuse de tourner si le dépôt devient privé.
5. Supabase Auth : SMTP Brevo (`smtp-relay.brevo.com`, port 587), identifiant du compte et clé SMTP dédiée dans le champ mot de passe. Activer la confirmation d'e-mail, conserver le changement sécurisé d'e-mail et configurer les URL de redirection du site. Appliquer le sujet et le contenu de `supabase-confirmation-config.json`. Éviter la réécriture des liens d'authentification par le fournisseur.
6. Fusionner le workflow dans `main`, puis lancer un `workflow_dispatch` pour vérifier les compteurs. Les tests automatisés utilisent une base isolée et un transport simulé ; ils n'envoient pas de vrais e-mails.

## Exploitation et validation

Les logs n'exposent ni clés, ni adresses, ni textes privés. Une erreur d'e-mail ne supprime pas les messages du site. En cas d'envoi incertain, vérifier les journaux du fournisseur avant de relancer manuellement. Pour suspendre les alertes, passer `MESSAGING_EMAIL_ENABLED=false` sur Render et GitHub. Ne jamais supprimer ni régénérer le secret Vault : les messages existants deviendraient illisibles. Un changement de clé passe par une nouvelle version (`messaging_message_key_v2`) et une migration.

Renouveler les accès Brevo avant leur expiration et actualiser les deux coffres pour la clé API. Les clés créées ont une échéance d'un an et peuvent expirer après 90 jours d'inactivité selon la politique Brevo.

Validation : `npm run typecheck`, `npm run build`, `npm run build:hub`, `npm run typecheck:api`, `npm run test:api`, `npm run build:api`. Les tests couvrent notamment l'isolation des participants, l'absence de texte en clair dans la base, le refus d'un jeton sans clé d'appareil, la fenêtre de dix minutes, les preuves expirées ou détournées, la révocation, l'intégrité des chiffrés, l'idempotence et les autorisations du planificateur.
