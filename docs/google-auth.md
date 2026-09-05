# Activer l’inscription et la connexion Google

Le bouton « Continuer avec Google » utilise Supabase Auth sur les pages de connexion et d’inscription. Un premier passage crée le compte, puis demande de compléter le profil LSNB. Les connexions suivantes retrouvent ce même profil.

Les fichiers du dépôt ne configurent pas les consoles Google et Supabase. Les étapes ci-dessous restent à effectuer par le responsable du projet.

## 1. Appliquer la migration

Dans Supabase, ouvrir **SQL Editor**, créer une requête, copier tout le contenu de [`202609050002_google_auth_onboarding.sql`](../supabase/migrations/202609050002_google_auth_onboarding.sql), puis exécuter **Run**. Les migrations précédentes doivent déjà être appliquées.

Cette migration ajoute `profiles.profile_completed` et les fonctions de création et de finalisation du profil :

- les membres existants conservent leur profil et sont considérés comme ayant terminé l’inscription ;
- un nouveau compte Google reste inactif et absent de l’annuaire et des tirages Highlight tant que son formulaire LSNB n’est pas validé ;
- le nom et la photo disponibles chez Google peuvent être préremplis ; le statut élève/alumni, la promotion et le parcours doivent être renseignés par le membre ;
- la finalisation vérifie les champs requis et l’acceptation des conditions avant d’activer le profil.

Appliquer ce SQL **avant de déployer le nouveau site et d’activer le fournisseur Google**. La compilation du site ne modifie jamais la base.

## 2. Créer le client Google

Ouvrir [Google Auth Platform](https://console.cloud.google.com/auth/overview), sélectionner ou créer le projet Google du réseau, puis renseigner **Branding** : nom de l’application, contact de support et coordonnées du responsable. L’URL du site est `https://lsnb-alumni-web.onrender.com`.

Dans **Audience**, choisir **External** pour accueillir les membres avec leurs comptes Google personnels. Le mode **Internal** réserve l’accès à l’organisation Google Workspace concernée. Pour ce projet, seuls les droits d’identité de base sont utilisés ; Google prévoit une exception aux restrictions habituelles des utilisateurs de test pour « Sign in with Google ». [Règles officielles sur l’audience](https://support.google.com/cloud/answer/15549945?hl=en).

Dans **Data Access**, conserver uniquement :

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

Ces droits permettent l’identification et le préremplissage du profil. [Configuration Google recommandée par Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

Dans **Clients → Create client**, choisir **Web application**, puis un nom tel que `LSNB Réseau Web`. [Création des identifiants OAuth Google](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

| Champ Google | Valeur |
|---|---|
| Authorized JavaScript origins | `https://lsnb-alumni-web.onrender.com` |
| Authorized redirect URIs | Copier **Callback URL (for OAuth)** dans **Supabase → Authentication → Sign In / Providers → Google** |

L’URI à copier a cette forme :

```text
https://<reference-du-projet>.supabase.co/auth/v1/callback
```

Google renvoie d’abord vers **Supabase**. Le retour vers le site `/auth/callback` est configuré à l’étape suivante. Copier l’URI exacte depuis Supabase, sans la reconstituer depuis une capture. [Instructions Supabase pour les origines et le callback](https://supabase.com/docs/guides/auth/social-login/auth-google#project-setup).

Créer le client, puis conserver le **Client ID** et le **Client Secret** pour l’étape 4.

## 3. Autoriser le retour vers le site

Dans **Supabase → Authentication → URL Configuration** :

**Site URL** :

```text
https://lsnb-alumni-web.onrender.com
```

**Redirect URLs**, ajouter ces deux entrées :

```text
https://lsnb-alumni-web.onrender.com/auth/callback
https://lsnb-alumni-web.onrender.com/auth/callback\?next=**
```

La première autorise le callback sans paramètre. La seconde garde ce chemin précis et accepte le paramètre `next`, utilisé pour retrouver la page demandée avant connexion. Copier également le caractère `\` : il rend le `?` littéral dans la syntaxe des motifs Supabase. Le `**` porte uniquement sur la valeur du paramètre. Le site valide ensuite que la destination reste interne. Cette configuration applique les règles de correspondance publiées par Supabase. [URLs de redirection et syntaxe des motifs](https://supabase.com/docs/guides/auth/redirect-urls).

### Tests locaux

Si Vite utilise `http://localhost:5173`, ajouter cette origine au client Google et ces entrées aux **Redirect URLs** Supabase :

```text
http://localhost:5173/auth/callback
http://localhost:5173/auth/callback\?next=**
```

Adapter le port à celui affiché par Vite. Ajouter séparément `http://127.0.0.1:5173` et ses callbacks si cette adresse est utilisée. Les origines et ports doivent correspondre au navigateur.

Avec le projet Supabase hébergé utilisé par ce dépôt, l’URI de retour **Google → Supabase** reste celle du projet hébergé, même lorsque le site tourne en local. Le callback `http://127.0.0.1:54321/auth/v1/callback` concerne seulement une installation locale de Supabase. [Développement local avec Google](https://supabase.com/docs/guides/auth/social-login/auth-google#project-setup).

## 4. Déployer et activer Google

Envoyer le code sur la branche suivie par Render, puis attendre le déploiement réussi de `lsnb-alumni-web`.

Dans la fenêtre Google de Supabase :

| Champ | Réglage |
|---|---|
| Client IDs | Le **Client ID** du client Web créé à l’étape 2 |
| Client Secret (for OAuth) | Son **Client Secret** |
| Skip nonce checks | Désactivé |
| Allow users without an email | Désactivé |
| Enable Sign in with Google | Activé |

Enregistrer. Le site utilise les variables Supabase publiques déjà configurées. **Aucune nouvelle variable Google n’est nécessaire dans Render** : les identifiants Google sont renseignés dans Supabase, et le secret ne doit jamais entrer dans un fichier `VITE_*`, le code ou GitHub.

## 5. Vérifier les parcours

1. **Premier compte Google** : depuis `/rejoindre` ou `/connexion`, continuer avec Google. Au retour, compléter le formulaire LSNB. Avant validation, le nouveau profil reste invisible dans l’annuaire et non éligible aux Highlights. Après validation, vérifier son nom, sa photo, son statut et ses informations.
2. **Compte déjà créé** : se déconnecter et recommencer. Le profil enregistré doit être retrouvé sans repasser par le formulaire initial.
3. **Même e-mail qu’un compte avec mot de passe** : utiliser un compte de test dont l’e-mail est déjà confirmé. Supabase associe automatiquement les identités portant la même adresse vérifiée ; vérifier que l’identifiant du membre et son profil restent les mêmes. L’association manuelle entre adresses différentes n’est pas proposée. [Association des identités Supabase](https://supabase.com/docs/guides/auth/auth-identity-linking).
4. **Retour à la page demandée** : ouvrir `/connexion?next=%2Fannuaire`, puis se connecter ; après une éventuelle finalisation du profil, retrouver `/annuaire`.
5. **Annulation** : refuser l’autorisation Google lorsqu’elle est proposée. Le site doit afficher l’échec et permettre de réessayer.
6. **Inscription par e-mail** : vérifier qu’elle reste disponible, ainsi que le lien de confirmation reçu par e-mail et la connexion avec mot de passe.

La validation réelle du parcours Google nécessite les identifiants et les réglages des consoles. Les tests locaux du code ne remplacent pas ce contrôle après activation.

## Si la connexion échoue

| Symptôme | Vérification |
|---|---|
| `redirect_uri_mismatch` chez Google | Comparer l’URI du client Google à **Callback URL (for OAuth)** dans Supabase ; protocole, chemin et slash final doivent correspondre. [Règle Google](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri) |
| Retour à l’accueil ou vers localhost | Vérifier **Site URL**, les deux **Redirect URLs** et le domaine réellement ouvert. |
| Fournisseur non activé | Vérifier le commutateur Google, les identifiants et leur enregistrement dans Supabase. |
| Erreur de base à la création du compte | Vérifier l’application réussie de la migration et consulter les journaux Supabase Auth. |
| Profil introuvable ou finalisation impossible | Vérifier que le site et la migration Google correspondent à la même version du dépôt et au même projet Supabase. |
| Google refuse un compte d’établissement | Vérifier l’audience et les restrictions de l’administrateur Google Workspace. [Erreurs d’autorisation Google](https://developers.google.com/identity/protocols/oauth2/web-server#errors) |
