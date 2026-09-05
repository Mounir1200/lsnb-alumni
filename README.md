# LSNB Réseau

Prototype du réseau des élèves et alumni du Lycée Scientifique National de Bobo-Dioulasso.

## Guide pour l'équipe de développement

- [Guide de reprise : existant, démarrage, configuration et reste à faire](docs/guide-developpement.md)
- [Version PDF à partager](output/pdf/lsnb-reseau-guide-developpement.pdf)
- [Dépôt GitHub](https://github.com/Mounir1200/lsnb-alumni)
- [Site sur Render](https://lsnb-alumni-web.onrender.com/)

Le produit met l’accent sur trois usages :

- découvrir des parcours par spécialité, domaine ou pays ;
- demander un échange à un alumni volontaire ;
- créer un profil avec parcours, expériences, contact et photo.

Les profils visibles dans la démo sont fictifs et explicitement présentés comme tels.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Supabase (authentification, base, stockage des photos)
- API Node.js + Fastify pour les règles métier et traitements serveur
- Anime.js pour les entrées et transitions discrètes
- Three.js pour la cartographie de trajectoires du hero
- Render pour le site statique et l’API

## Démarrage local

```bash
npm install
npm run dev
```

Puis ouvrir l’adresse indiquée par Vite.

L’API se lance dans un deuxième terminal :

```bash
cd api
npm install
npm run dev
```

Elle répond sur `http://localhost:4000`, avec un contrôle de santé disponible sur `/health`.

Le projet fonctionne sans variables d’environnement en mode démonstration : l’inscription conserve un aperçu local du profil et ne stocke jamais le mot de passe.

## Configuration locale de Supabase

**Supabase et Render sont déjà configurés. Le responsable du projet en conserve l'administration** : clés, droits d'accès, migrations appliquées à la base, fournisseurs de connexion comme Google et déploiements.

Pour tester avec de vraies données, utiliser l'environnement d'essai et les valeurs fournis par le responsable du projet. Copier `.env.example` vers `.env.local`, puis renseigner l'URL Supabase et la clé publique reçues :

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:4000
```

Redémarrer le serveur local après une modification de ces valeurs. Sans environnement d'essai fourni, le mode démonstration reste disponible.

Pour personnaliser l’API en local, copier `api/.env.example` vers `api/.env`. `VITE_API_URL`, `SUPABASE_URL` et `SUPABASE_SECRET_KEY` sont utilisés pour la rubrique Highlight. Le job hebdomadaire utilise aussi `MISTRAL_API_KEY`. Ces deux clés sont strictement réservées au backend : elles ne doivent jamais utiliser le préfixe `VITE_` ni être incluses dans le navigateur. Ne pas ajouter les fichiers contenant de vraies valeurs à GitHub.

Les développeurs préparent les modifications du code et les fichiers de migration SQL dans une branche, puis les proposent dans une pull request pour relecture. Le responsable coordonne leur application à Supabase. Le [schéma initial](supabase/migrations/202609040001_initial_schema.sql) sert de référence pour comprendre la base existante.

Les coordonnées sont séparées des profils. Les règles RLS autorisent leur lecture uniquement à leur propriétaire ou lorsqu’il a choisi de les rendre visibles aux membres authentifiés.

Le [guide de reprise](docs/guide-developpement.md) explique où sont stockés les données des membres et les fichiers photo, ainsi que leurs règles de visibilité.

### Redirections d’authentification

Les adresses de retour après connexion ou confirmation d'e-mail sont gérées par le responsable dans Supabase. Pour les tests locaux, lui communiquer l'adresse affichée par Vite afin qu'il puisse confirmer qu'elle est autorisée pour l'environnement d'essai.

Après confirmation de son e-mail, le membre revient sur `/auth/callback`, la session est enregistrée dans le navigateur puis il est dirigé vers `/espace`.
La photo choisie à l’inscription est conservée localement pendant sept jours et envoyée après confirmation lorsque le lien est ouvert dans le même navigateur.

## Vérifications

```bash
npm run typecheck
npm run build
npm run typecheck:api
npm run test:api
npm run build:api
```

## Déploiement Render

Le fichier [`render.yaml`](render.yaml) décrit trois services depuis le même dépôt :

- `lsnb-alumni-web`, un site statique qui publie `dist` et réécrit les routes vers `index.html` ;
- `lsnb-alumni-api`, un service web Node.js construit depuis `api/`, avec `/health` comme contrôle de disponibilité.
- `lsnb-alumni-highlights`, un job du lundi à 00 h UTC avec reprise à 00 h 20, qui sauvegarde deux portraits pour la semaine. Son activation implique le tarif des jobs planifiés Render.

Les builds utilisent une version Node.js épinglée afin d’éviter qu’un changement automatique de runtime ne casse un futur déploiement.

Les services et leurs variables sont administrés par le responsable du projet. L'équipe prépare et vérifie les modifications en local, puis ouvre une pull request en précisant les changements de configuration ou de base éventuellement nécessaires.

La mise en production est coordonnée par le responsable. La configuration prévoit un déploiement automatique lorsqu'un commit est envoyé sur GitHub dans la branche suivie par Render : l'intégration d'une pull request peut donc déclencher une publication. Le responsable coordonne cet envoi avec les éventuelles migrations et mises à jour des variables.

Les Highlights suivent le flux `frontend → API → Supabase` pour la lecture publique. Le job choisit deux alumni actifs au hasard avec rotation, privilégie un duo homme–femme et accepte les autres duos lorsque nécessaire. Mistral Small rédige les portraits à partir des profils ; la sélection et les textes sont conservés en base. Aucun appel IA n’a lieu au chargement des pages et Redis n’est pas nécessaire. La [documentation Highlights](docs/highlights.md) détaille la migration, les réglages, les reprises, les coûts et les limites des contrôles de fidélité.

L’inscription et la connexion Google sont implémentées via Supabase Auth, avec complétion du profil au premier accès. Le [guide d’activation Google](docs/google-auth.md) détaille la nouvelle migration et les réglages Google/Supabase. Les liens LinkedIn et portfolio restent à développer.

## Direction visuelle

La direction retenue est **Réseau de trajectoires** : un système éditorial et humain, structuré par une cartographie scientifique centrée sur Bobo-Dioulasso. La palette vient de Sya : indigo, banco, vert manguier et blanc calcaire.

Deux autres pistes ont été écartées :

- **Campus éditorial**, plus documentaire mais moins utile pour matérialiser la diaspora ;
- **Laboratoire nocturne**, plus spectaculaire mais trop froid pour le mentorat.

Le symbole graphique est une double arche inspirée du portail du lycée et de l’architecture locale. Il s’agit d’une identité de prototype, pas du logo officiel du LSNB.

## Crédits visuels

- Photo du lycée : L’Obs Paalga, utilisée à distance et créditée dans l’interface.
- Grande Mosquée de Bobo-Dioulasso : Semiliki, Wikimedia Commons, CC BY-SA.
- Scène de mentorat : visuel original généré pour ce prototype.
