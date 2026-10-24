# E-mails transactionnels LSNB Alumni

L’identité reprend les couleurs du site : bleu `#0c2948`, banco `#c27d38` et papier `#faf8f3`. Les modèles utilisent des tableaux de présentation, des styles intégrés et les polices système. Ils ne chargent ni image, ni police distante, ni pixel. Chaque modèle possède une version texte.

## Confirmation de l’inscription avec Supabase

- Objet : **Confirmez votre inscription à LSNB Alumni**.
- Contenu HTML : `confirm-signup.html`.
- Variable native Supabase : `{{ .ConfirmationURL }}`. Conserver cette variable telle quelle ; ne pas remplacer le lien par l’URL de la page de connexion.
- Le fichier `supabase-confirmation-config.json` contient exactement les champs `mailer_subjects_confirmation` et `mailer_templates_confirmation_content` à appliquer à la configuration Auth du projet.
- Dans Auth, activer la confirmation de l’adresse e-mail (`mailer_autoconfirm: false`) et configurer le SMTP personnalisé. Expéditeur demandé : `LSNB Alumni <mounirdabire47@gmail.com>`. Le compte fournisseur doit autoriser cet expéditeur.
- Vérifier la Site URL et la liste des Redirect URLs autorisées, notamment l’URL HTTPS de production suivie de `/auth/callback`. Le frontend fournit cette destination à `signUp` et au renvoi de confirmation.
- `confirm-signup.txt` est la version texte de référence. Le champ de template Auth Supabase accepte le contenu HTML ; ne pas inventer un champ API pour injecter séparément cette version texte.

Après inscription, le site demande de consulter sa boîte de réception et les indésirables. Le lien de renvoi mène à la page de connexion, qui permet de demander une nouvelle confirmation avec un délai local de 60 secondes et un message neutre sur l’existence du compte. Le fournisseur continue à imposer ses propres limites de débit.

## Notification de nouveau message avec Brevo

L’envoi applicatif construit directement `subject`, `htmlContent` et `textContent` avec `renderMessageNotificationEmail` depuis `api/src/messaging/emailTemplate.ts`. Il n’exige pas de créer un template distant Brevo.

`message-notification.html` et `.txt` sont fournis pour inspection ou configuration manuelle. Leurs variables sont `{{ params.CONVERSATION_URL }}` et `{{ params.SETTINGS_URL }}`. Aucune identité d’expéditeur, aucun texte de conversation et aucun compteur précis n’apparaissent dans le mail.

## Suivi, liens et vérification

Le contenu généré n’intègre aucun suivi. La configuration du fournisseur doit être vérifiée séparément : une option de suivi Brevo peut réécrire les liens ou ajouter un pixel au moment de l’envoi. Supabase recommande de désactiver le suivi des liens pour les e-mails d’authentification. Ne pas annoncer que le suivi fournisseur est désactivé sans l’avoir vérifié dans le compte.

Les contrôles locaux portent sur le rendu de navigateur, les versions texte, l’échappement des URL et l’absence de ressources distantes. Ils ne constituent pas un essai de délivrabilité ni une validation visuelle dans tous les clients e-mail. Aucun e-mail réel n’est nécessaire pour ces contrôles.

Sources : [variables des modèles Supabase](https://supabase.com/docs/guides/auth/auth-email-templates), [configuration SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).
