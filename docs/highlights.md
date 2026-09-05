# Highlights hebdomadaires

La rubrique publique de l’accueil présente deux alumni actifs et distincts. Une édition couvre le lundi à 00 h jusqu’au dimanche à 23 h 59, heure du Burkina Faso (`Africa/Ouagadougou`, UTC toute l’année). Le duo, les données utilisées et les deux textes sont enregistrés dans Supabase. Aucun appel à Mistral n’est déclenché par une visite.

## Sélection et rotation

Le programme tire au sort parmi les alumni qui ont le moins souvent figuré dans une édition publiée. À égalité de participation, il privilégie un duo homme–femme lorsque les deux genres sont disponibles. Si un genre a épuisé son tour, un duo homme–homme ou femme–femme est possible. Un profil dont le genre n’est pas renseigné reste éligible : le programme ne le déduit jamais du prénom, de la photo ou du texte. Le genre est facultatif à l’inscription et modifiable dans le profil.

Si un seul membre reste au niveau de participation le plus bas, le second est choisi au niveau suivant, sans doublon. Cela permet une rotation avec un nombre impair de membres. Les élèves et les comptes inactifs sont exclus. Avec moins de deux alumni actifs, aucun article n’est généré et la rubrique affiche son état d’attente. Un nouveau lancement est alors possible si la base s’enrichit.

Une édition existante ne change jamais de duo. Si un compte sélectionné est supprimé, désactivé ou devient élève, l’API masque l’édition et ne génère aucun remplaçant cette semaine. Les liens vers les profils complets conservent leur accès réservé aux membres.

## Textes et fidélité aux profils

Le job appelle `mistral-small-latest` une fois pour chaque profil, avec un maximum de 3 500 tokens de sortie (article et citations internes compris) et un délai de 45 secondes. `MISTRAL_MODEL` permet de fixer une version différente. Pour `mistral-small-latest` et `mistral-small-2603`, le raisonnement est désactivé avec `reasoning_effort: "none"`. Le lecteur accepte aussi les réponses en blocs texte et ignore les blocs de raisonnement. Voir le [format des réponses Mistral](https://docs.mistral.ai/studio/conversations/reasoning).

Les seuls champs transmis sont le nom, la promotion, les domaines/spécialités, la localisation, le parcours (jusqu’à 5 000 caractères) et le mentorat déclaré, avec des longueurs limitées. Les coordonnées de la table de contacts, le genre, l’identifiant, la photo et les données d’authentification ne sont pas transmis. Les champs libres restent les déclarations du membre et peuvent contenir les informations qu’il y a lui-même saisies.

Le modèle rédige un titre personnalisé, une accroche concrète et un récit à la troisième personne reliant formation, expériences et projets. Pour un profil détaillé, le prompt vise 180 à 260 mots en trois ou quatre paragraphes, avec un plafond de 2 800 caractères. Un profil peu renseigné donne un article plus court, sans remplissage ni faits ajoutés. Un [exemple éditorial fondé sur le profil fourni](highlight-exemple.md) illustre le style attendu ; il n’a pas été publié ni produit par un appel à Mistral.

Le système impose un JSON structuré et exige des citations des champs utilisés pour le **titre comme pour les paragraphes**. Les citations doivent correspondre au texte source ; seules les différences d’espaces, d’apostrophes/guillemets typographiques et de normalisation Unicode sont tolérées. Il rejette notamment les références inexistantes, les nouveaux chiffres détectables, les coordonnées dans le texte IA, les réponses trop longues, les balises et les réponses tronquées. Les longs passages recopiés du parcours (24 mots consécutifs) et les phrases conservées à la première personne sont également refusés. Les instructions contenues dans les profils sont traitées comme des données non fiables. La sortie est affichée comme du texte, jamais comme du HTML.

Ces vérifications ne prouvent pas que chaque reformulation est sémantiquement fidèle : un modèle peut encore mal interpréter une information pourtant citée. Une vérification humaine reste nécessaire pour une garantie éditoriale stricte. Les sources originales sont conservées dans un instantané privé pour permettre la comparaison. Les textes IA sont identifiés dans la rubrique.

En cas d’échec, un aperçu de secours est composé automatiquement à partir des champs renseignés et d’un extrait du parcours limité à 360 caractères. Il est enregistré avec `generation_method = 'fallback'` et affiché avec la mention « Aperçu du profil · rédaction IA indisponible ». Le cron ordinaire ne relance pas Mistral pour cette édition. Une commande de réparation explicite est disponible ci-dessous ; il ne faut jamais supprimer les éditions ni effacer les marqueurs de tentative pour régénérer.

## Persistance, coûts et reprises

PostgreSQL suffit : il sert de stockage durable et évite de régénérer les articles. Redis n’est pas nécessaire pour deux portraits hebdomadaires.

- `weekly_highlights` : une ligne unique par lundi, état de publication et verrou temporaire.
- `highlight_articles` : deux positions uniques, références aux membres, instantanés et articles immuables, indicateur de tentative Mistral.
- `highlight_article_repairs` : une première tentative manuelle par article de secours, au maximum deux reprises explicites après échec ou expiration, l’historique des essais et l’éventuel nouveau texte IA. Le texte original reste conservé.
- Les fonctions SQL réservent une édition dans une transaction avec un verrou consultatif et un verrou de ligne. Le bail expire après 15 minutes.
- Le marqueur `ai_attempted_at` est écrit **avant** l’appel externe. Après un arrêt entre cet appel et sa sauvegarde, la reprise utilise le texte factuel de secours. Elle n’émet pas un nouvel appel potentiellement facturé.
- Un article déjà enregistré est conservé. Les deux articles doivent être enregistrés avant publication.
- Les tables et les fonctions de génération sont inaccessibles aux visiteurs et aux membres ordinaires. Seul le backend possède la clé privilégiée.

Le cron émet au maximum deux requêtes Mistral par édition, soit généralement 8 à 10 par mois. Chaque lancement manuel de réparation autorise au plus une requête par article de secours. Avec les deux reprises explicites possibles, le plafond de réparation est de trois requêtes par article et par semaine, donc six pour le duo. Ces reprises ne sont jamais déclenchées par le cron ordinaire. Les lectures publiques utilisent une projection explicite des champs et `Cache-Control: no-store`, afin qu’un profil retiré ne reste pas affiché dans un cache intermédiaire. Ce choix n’occasionne aucun nouvel appel IA.

Le Blueprint Render prépare un job séparé, indépendant de la veille de l’API gratuite, le lundi à 00 h puis à 00 h 20. Le second passage reprend uniquement une éventuelle interruption ; une édition publiée ne fait aucun travail supplémentaire. Si les deux passages échouent à accéder à la base, il faut relancer le job manuellement. Les logs indiquent `published`, `busy`, `empty` et le nombre de textes de secours. Chaque secours est accompagné d’un diagnostic local et, pour une erreur HTTP, du statut, sans clé, réponse brute du fournisseur ou contenu des profils.

## Remplacer les textes de secours de la semaine courante

1. Appliquer [la migration de réparation](../supabase/migrations/202609050003_highlight_fallback_repair.sql), puis [la migration de reprise après échec](../supabase/migrations/202609050004_highlight_repair_retries.sql) dans Supabase **avant de déployer cette version de l’API**. Si la migration 003 est déjà appliquée, exécuter uniquement la nouvelle 004. Elles conservent les articles, leurs instantanés et les tentatives existantes.
2. Déployer le code sur l’API, le frontend et le job Render. Vérifier que `MISTRAL_API_KEY` et `MISTRAL_MODEL` sont correctement configurés sur le job.
3. Lancer explicitement, depuis `api/` après compilation :

   ```sh
   npm run highlights:repair
   ```

   Sur le cron Render existant, remplacer temporairement **Command** par `npm run highlights:repair`, déclencher un lancement manuel, puis rétablir `npm run highlights:generate`. Conserver le même dossier racine et la même commande de build. La réparation ne fait pas partie de la planification normale.
4. Un résultat tel que `{"outcome":"repaired","attempted":2,"repaired":2,"failures":0}` confirme que les deux nouveaux articles sont sauvegardés. Actualiser l’accueil pour les lire.

La commande conserve le duo, les données du profil capturées lors du tirage et la semaine de publication. Seuls les articles `fallback` de la semaine courante, appartenant à un duo encore éligible, peuvent être réparés. Le texte déjà affiché reste visible jusqu’à la sauvegarde réussie du nouveau texte. Un article IA existant ne change pas. Aucune route publique ne permet cette opération.

La tentative est enregistrée **avant** l’appel Mistral. Elle reste consommée en cas d’échec, de dépassement de délai ou d’arrêt du processus : relancer `highlights:repair` ne refacture pas cet article. En cas de `failures > 0`, la commande termine avec un code d’échec pour que Render le signale, et le secours reste affiché. Un refus HTTP 429 est enregistré, puis le job s’arrête avant de réserver le profil suivant. L’en-tête `Retry-After`, lorsqu’il est présent, est pris en compte dans le délai de reprise, avec un plafond de 24 heures. Il n’existe pas de boucle de régénération automatique.

### Reprendre les essais déjà échoués

Après avoir résolu la cause fournisseur et appliqué la migration 004 :

```sh
npm run highlights:repair:retry
```

Sur Render, utiliser temporairement cette commande pour un lancement manuel, puis rétablir `npm run highlights:generate`. Ce mode autorise explicitement de nouvelles requêtes facturables : au maximum deux reprises par article, en plus de la première tentative de réparation. Un article déjà réparé n’est jamais réécrit.

Un échec enregistré impose au moins 60 secondes d’attente, ou le délai fournisseur s’il est supérieur. Une ancienne tentative dont l’issue n’a pas été enregistrée, comme les refus 429 de l’ancienne version ou une sauvegarde interrompue, doit attendre l’expiration de son bail de 15 minutes. Aucun jeton actif n’est réutilisé. L’ancien essai est archivé avant la nouvelle réservation, les anciens jetons ne peuvent plus enregistrer d’article, et l’historique comme le plafond de reprises sont contrôlés par PostgreSQL.

Les logs `highlight_repair_skipped` indiquent `cooldown` si le délai n’est pas écoulé, `attempted` si une tentative est encore active, si l’article est déjà réparé ou si son plafond est atteint, et `unavailable` si l’édition ou le profil n’est plus éligible.

### Incident Mistral gratuit constaté le 5 septembre 2026

La page d’état officielle indiquait un incident **« Free Tier Temporarily Disabled »**, commencé le 4 septembre et encore en cours lors de la vérification du 5 septembre. Mistral avait temporairement désactivé les complétions de l’API gratuite en raison de la charge et d’abus possibles. Cet incident est cohérent avec les refus 429 observés sur l’offre Experiment, malgré des plafonds affichés et aucune consommation enregistrée. [Incident officiel](https://status.mistral.ai/incident/44cb5e11-4736-4e6b-9198-97121820e15e)

Consulter l’état actuel avant de relancer. Les options sont d’attendre le rétablissement de l’offre gratuite ou de choisir le paiement à l’usage. Changer de clé ou d’alias de modèle ne résout pas une suspension globale du niveau gratuit. Hors incident, vérifier **API → Limits** et **API → Usage** dans l’organisation à laquelle appartient la clé : les plafonds sont partagés par organisation. [Limites Mistral](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)

### Comprendre les diagnostics

| Diagnostic dans les logs | Signification et vérification |
|---|---|
| `code: provider`, `reason: http_error`, `status: 401` ou `403` | Mistral refuse l’accès : vérifier la clé et ses autorisations sur le job. |
| `status: 429` | Mistral refuse temporairement la requête : vérifier d’abord la [page d’état](https://status.mistral.ai/), puis les quotas et limites de l’organisation. Un 429 seul ne prouve pas un quota épuisé. |
| `status: 400` ou `404` | Vérifier le modèle choisi et la configuration de la requête. |
| `code: timeout` | Aucun article reçu dans les 45 secondes. |
| `reason: truncated` | Mistral a atteint la limite de sortie avant de terminer. |
| `reason: invalid_evidence` ou `unsupported_number` | Les citations ou nombres ne correspondent pas aux sources transmises. |
| `reason: copied_profile` | Le modèle a recopié un long passage du profil ou gardé une phrase à la première personne. |
| `reason: invalid_json`, `response_shape`, `no_final_text`, `article_shape`, `article_length`, `unsafe_text` ou `response_size` | La réponse ne respecte pas le format ou les limites attendues. |
| `code: previous_attempt_interrupted` | Une tentative antérieure avait été enregistrée, sans article sauvegardé ; la reprise a conservé la limite de coût. |

Les anciens logs ne permettent pas de retrouver a posteriori la cause de leur fallback : le code précédent l’absorbait sans la journaliser.

Render facture ses jobs planifiés avec un minimum annoncé de **1 USD par mois par job**, en plus de l’usage Mistral. Le fichier est préparé dans le dépôt ; aucun service payant n’est créé par les tests locaux. Voir la [documentation Render sur les jobs planifiés](https://render.com/docs/cronjobs).

## Activation

1. Appliquer les migrations du dépôt dans l’ordre dans l’environnement Supabase visé, jusqu’à [la migration de reprise 004](../supabase/migrations/202609050004_highlight_repair_retries.sql). Elles conservent les profils existants ; le genre existant reste non renseigné jusqu’à sa déclaration par le membre.
2. Configurer `SUPABASE_URL` et `SUPABASE_SECRET_KEY` sur l’API. Utiliser une clé serveur `sb_secret_…` ou une ancienne clé `service_role`, jamais une clé publique.
3. Configurer ces mêmes variables ainsi que `MISTRAL_API_KEY` sur le job Render `lsnb-alumni-highlights`. Le modèle par défaut est déjà défini dans le Blueprint.
4. Configurer `VITE_API_URL` sur le site statique avec l’URL de l’API, et autoriser l’origine du site dans `FRONTEND_ORIGINS` sur l’API. Reconstruire le frontend après modification de ses variables.
5. Déployer l’API et le frontend, puis activer le job décrit dans `render.yaml`. On peut déclencher une première exécution manuelle depuis Render en cours de semaine ; les suivantes réutilisent cette édition jusqu’au lundi suivant.
6. Vérifier `GET /api/v1/highlights/current` sans authentification, puis la rubrique sur l’accueil. Avec moins de deux alumni actifs, `highlight` vaut `null`.

`MISTRAL_API_KEY` n’est nécessaire que sur le job. Aucune clé serveur ne doit porter le préfixe `VITE_` ni être ajoutée au dépôt. Les fichiers `.env` locaux sont ignorés par Git.

Pour une exécution locale avec des variables de l’environnement de test, depuis `api/` :

```sh
npm run build
npm run highlights:generate
```

Cette commande génère et publie **l’édition de la semaine courante** dans la base configurée, et peut consommer jusqu’à deux appels Mistral. Pour tester uniquement le code sans services externes :

```sh
npm run typecheck
npm test
```

Les tests incluent un PostgreSQL embarqué PGlite : les tests de réparation exécutent les cinq migrations dans une base éphémère, y compris un passage de 003 à 004 avec des tentatives préexistantes. Ils couvrent les réponses Mistral simulées, les cas de reprise/concurrence, les permissions et les articles réparés. Ils ne lisent pas la base configurée et n’appellent pas Mistral. L’émulation PostgreSQL vérifie les fonctions et permissions ; elle ne remplace pas un essai de concurrence entre plusieurs connexions ni un test du proxy REST Supabase en environnement d’essai.

Références d’intégration : [sorties structurées Mistral](https://docs.mistral.ai/studio/conversations/structured-output/custom) et [clés API Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## Vérifications de cette implémentation

Les commandes de validation sont `npm --prefix api test`, les vérifications TypeScript et les builds frontend/API. Sur ce poste Windows, le lanceur npm présent dans le profil utilisateur est défectueux ; les vérifications ont utilisé le npm fourni avec Node.js et Vite avec `--configLoader native` pour éviter la résolution de chemins hors sandbox. Le code et les commandes de déploiement ne nécessitent pas ces adaptations.

La rubrique a été testée dans un vrai navigateur à largeur ordinateur et téléphone (390 px), avec deux portraits de test exclusivement locaux : alignement des colonnes, lisibilité, mentions IA/secours, lien de connexion vers le profil demandé, état vide, panne et récupération par le bouton de réessai. Le sélecteur de genre a aussi été actionné sans soumettre d’inscription. Aucun compte, article réel, appel Mistral ou service Render n’a été créé par ces vérifications.
