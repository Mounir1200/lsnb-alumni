# LSNB Réseau

Prototype du réseau des élèves et alumni du Lycée Scientifique National de Bobo-Dioulasso.

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

## Connecter Supabase

1. Créer un projet Supabase.
2. Exécuter [`supabase/migrations/202609040001_initial_schema.sql`](supabase/migrations/202609040001_initial_schema.sql) dans l’éditeur SQL.
3. Copier `.env.example` vers `.env.local`.
4. Ajouter l’URL du projet et la clé publique anonyme.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:4000
```

Pour l’API, copier `api/.env.example` vers `api/.env`. La clé `SUPABASE_SECRET_KEY` est strictement réservée au backend : elle ne doit jamais utiliser le préfixe `VITE_` ni être incluse dans le navigateur.

Les coordonnées sont séparées des profils. Les règles RLS autorisent leur lecture uniquement à leur propriétaire ou lorsqu’il a choisi de les rendre visibles aux membres authentifiés.

## Vérifications

```bash
npm run typecheck
npm run build
npm run typecheck:api
npm run test:api
npm run build:api
```

## Déploiement Render

Le fichier [`render.yaml`](render.yaml) crée deux services depuis le même dépôt :

- `lsnb-alumni-web`, un site statique qui publie `dist` et réécrit les routes vers `index.html` ;
- `lsnb-alumni-api`, un service web Node.js construit depuis `api/`, avec `/health` comme contrôle de disponibilité.

Les deux builds utilisent une version Node.js épinglée afin d’éviter qu’un changement automatique de runtime ne casse un futur déploiement.

Créer un **Blueprint** Render à partir du dépôt. Lors de la première synchronisation, renseigner :

- pour le frontend : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` et `VITE_API_URL` ;
- pour l’API : `FRONTEND_ORIGINS`, `SUPABASE_URL` et `SUPABASE_SECRET_KEY`.

`FRONTEND_ORIGINS` accepte plusieurs origines séparées par des virgules. En production, utiliser l’URL exacte du frontend Render.

Les futures fonctionnalités serveur suivront le flux `frontend → API → Supabase`. L’alumni de la semaine sera sélectionné une fois puis conservé pour toute la semaine, et les résumés IA seront générés hors du chargement des pages puis mis en cache en base.

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
