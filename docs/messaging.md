# Messagerie LSNB Alumni

## Échanges et confidentialité

Une demande acceptée ouvre une conversation dans `/espace/messages`. Seuls ses deux participants peuvent y accéder. Les anciennes demandes et leur texte restent dans le parcours de demandes ; ils ne sont pas copiés dans la messagerie chiffrée. Les formulaires de premier contact précisent cette différence.

Chaque membre active sa messagerie avec un code reçu sur son adresse confirmée (10 minutes, cinq essais, renvoi limité), puis conserve une clé personnelle aléatoire de 256 bits. Le serveur déduit le destinataire du compte authentifié, jamais du formulaire. L'enregistrement de l'identité est immuable ; une session seule ne peut pas remplacer la clé d'un membre. Activer les confirmations d'inscription et le changement sécurisé d'adresse e-mail dans Supabase Auth.

Le navigateur génère une paire ECDH P-256. Chaque message utilise HKDF-SHA-256 avec un sel aléatoire et AES-256-GCM avec un IV aléatoire. Les données authentifiées lient le message à sa conversation, aux deux participants et à l'identifiant de tentative. La clé privée est chiffrée par la clé personnelle avant son stockage ; une fois déverrouillée, elle reste en mémoire sous forme de CryptoKey non exportable. Ni la clé personnelle ni les messages en clair ne sont conservés dans le stockage du navigateur.

La base reçoit uniquement les enveloppes chiffrées des nouveaux échanges. Les politiques RLS, les fonctions contrôlées et les restrictions Realtime limitent l'accès aux participants autorisés et respectent suspension, maintenance et confidentialité. La base refuse les messages en clair. Un identifiant de tentative empêche les doublons après perte de réseau. Seuls les messages effectivement déchiffrés et affichés au destinataire sont marqués lus.

La messagerie se verrouille au changement de compte, à la sortie de page, après cinq minutes d'inactivité ou une minute d'onglet masqué. Un verrouillage explicite efface aussi le brouillon. Les réponses réseau tardives sont ignorées après verrouillage. Les alertes sur le site et compteurs ne contiennent pas le texte privé.

### Limites à connaître

- Une session dérobée seule ne suffit pas à lire les échanges chiffrés d'une identité déjà activée. Elle peut encore révéler des métadonnées et perturber des opérations autorisées au compte.
- Un navigateur compromis alors que la messagerie est déverrouillée peut lire ce qui est affiché. Le code malveillant exécuté sur l'origine du site reste une menace ; le chiffrement ne remplace pas la prévention XSS.
- Ce protocole ne fournit pas de confidentialité persistante des anciens messages après compromission des clés privées (pas de forward secrecy), ni de vérification hors bande des clés publiques.
- La perte de la clé personnelle rend l'historique irrécupérable. Aucun contournement ni réinitialisation silencieuse n'est proposé.
- Les demandes initiales antérieures au chiffrement restent en clair dans leur parcours historique. Les e-mails ne contiennent jamais le texte des conversations.

## E-mails et coûts

Brevo envoie les confirmations Supabase par SMTP, les codes d'activation et les alertes de messages par API transactionnelle. L'expéditeur de démarrage est `LSNB Alumni <mounirdabire47@gmail.com>`. Les modèles reprennent le bleu profond et les teintes banco du site, avec HTML en tableaux, styles intégrés et version texte pour les e-mails API. Le modèle de confirmation versionné est dans `docs/email-templates/confirm-signup.html` ; il utilise le lien personnel `{{ .ConfirmationURL }}` fourni par Supabase.

Les alertes sont différées d'au moins cinq minutes, annulées après lecture et suspendues pendant une activité récente sur le site. Elles sont limitées à une par membre et par heure et peuvent être désactivées depuis la messagerie. Elles ne révèlent ni l'auteur ni le contenu du message.

Les fonctions réservent au plus 180 alertes et 60 codes d'activation par jour UTC. Le quota Brevo Free de 300 envois/jour est partagé avec les e-mails Auth : la marge restante n'est pas un quota réservé. Aucun service payant supplémentaire n'est créé. Sources : [limites Brevo Free](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [runners standards gratuits pour les dépôts publics](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Le workflow GitHub appelle l'API Render toutes les cinq minutes. L'appel utilise un jeton HMAC dérivé de la clé Brevo, comparé en temps constant. Cet endpoint ne permet de choisir ni destinataire ni contenu et ne renvoie que des compteurs. La clé Supabase serveur reste uniquement sur Render. Les notifications utilisent des réservations et l'idempotence Brevo ; les reprises sont bornées à moins de 30 minutes.

Le planificateur GitHub peut retarder ou omettre une exécution ; les workflows publics peuvent être désactivés après 60 jours d'inactivité. Le service Render gratuit peut démarrer à froid. Les notifications sur le site fonctionnent indépendamment de ces délais. Voir les [limites des workflows planifiés](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Configuration

1. Appliquer dans l'ordre les migrations `20261023221107_private_messaging`, `20261023221132_end_to_end_messaging`, `20261023221136_messaging_identity_verification`. Vérifier RLS, droits des fonctions et publication Realtime.
2. Render API : conserver `SUPABASE_URL`, `SUPABASE_SECRET_KEY` et `FRONTEND_ORIGINS`. Ajouter `BREVO_API_KEY`, `MESSAGING_FROM_EMAIL`, `MESSAGING_SITE_URL=https://lsnb-alumni-web.onrender.com`, `MESSAGING_EMAIL_ENABLED=true`. Ne jamais utiliser de préfixe `VITE_` pour un secret.
3. GitHub Actions : secret `BREVO_API_KEY` seulement ; variables `MESSAGING_API_URL=https://lsnb-alumni-api.onrender.com` et `MESSAGING_EMAIL_ENABLED=true`. Le workflow refuse de tourner si le dépôt devient privé.
4. Frontend : `VITE_API_URL=https://lsnb-alumni-api.onrender.com` avec les paramètres Supabase publics existants.
5. Supabase Auth : SMTP Brevo (`smtp-relay.brevo.com`, port 587), identifiant du compte et clé SMTP dédiée dans le champ mot de passe. Activer la confirmation d'e-mail, conserver le changement sécurisé d'e-mail et configurer les URL de redirection du site. Appliquer le sujet et le contenu de `supabase-confirmation-config.json`. Éviter la réécriture des liens d'authentification par le fournisseur.
6. Fusionner le workflow dans `main`, puis lancer un `workflow_dispatch` pour vérifier les compteurs. Les tests automatisés utilisent une base isolée et un transport simulé ; ils n'envoient pas de vrais e-mails.

## Exploitation et validation

Les logs n'exposent ni clés, ni codes, ni adresses, ni textes privés. Une erreur d'e-mail ne supprime pas les messages du site. En cas d'envoi incertain, vérifier les journaux du fournisseur avant de relancer manuellement. Pour suspendre les alertes, passer `MESSAGING_EMAIL_ENABLED=false` sur Render et GitHub. Conserver les données lors d'un retour arrière du frontend.

Renouveler les accès Brevo avant leur expiration et actualiser les deux coffres pour la clé API. Les clés créées ont une échéance d'un an et peuvent expirer après 90 jours d'inactivité selon la politique Brevo.

Validation : `npm run typecheck`, `npm run build`, `npm run build:hub`, `npm run typecheck:api`, `npm run test:api`, `npm run build:api`. Les tests couvrent notamment l'isolation des participants, le rejet du clair, le vol de session seul, les limites du code e-mail, les verrouillages, les réponses tardives, l'idempotence et les autorisations du planificateur.
