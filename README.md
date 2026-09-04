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
- Anime.js pour les entrées et transitions discrètes
- Three.js pour la cartographie de trajectoires du hero
- Render pour l’hébergement statique

## Démarrage local

```bash
npm install
npm run dev
```

Puis ouvrir l’adresse indiquée par Vite.

Le projet fonctionne sans variables d’environnement en mode démonstration : l’inscription conserve un aperçu local du profil et ne stocke jamais le mot de passe.

## Connecter Supabase

1. Créer un projet Supabase.
2. Exécuter [`supabase/migrations/202609040001_initial_schema.sql`](supabase/migrations/202609040001_initial_schema.sql) dans l’éditeur SQL.
3. Copier `.env.example` vers `.env.local`.
4. Ajouter l’URL du projet et la clé publique anonyme.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Les coordonnées sont séparées des profils. Les règles RLS autorisent leur lecture uniquement à leur propriétaire ou lorsqu’il a choisi de les rendre visibles aux membres authentifiés.

## Vérifications

```bash
npm run typecheck
npm run build
```

## Déploiement Render

Le fichier [`render.yaml`](render.yaml) configure un site statique, publie `dist` et réécrit les routes vers `index.html` pour React Router. Ajouter les deux variables Supabase dans l’interface Render avant le déploiement réel.

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
