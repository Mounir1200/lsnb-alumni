# Liens LinkedIn et portfolio

Les deux champs sont indépendants et facultatifs à l’inscription par email, à la complétion du profil Google et dans « Modifier mon profil ». Il est possible de créer un compte sans aucun lien, avec un seul lien ou avec les deux. Vider un champ dans l’éditeur supprime le lien enregistré.

Les liens apparaissent sur la fiche du membre uniquement lorsqu’ils sont renseignés. Ils suivent les règles RLS existantes des profils : lecture par les membres authentifiés autorisés et modification par le propriétaire. La visibilité de l’email de contact reste un réglage distinct ; les formulaires précisent celle des liens.

## Stockage et validation

- `public.profiles.linkedin_url` et `portfolio_url` sont des colonnes `text` acceptant `NULL`, sans valeur obligatoire pour les comptes existants.
- Une valeur vide ou composée d’espaces devient `NULL`. Le frontend utilise une URL canonique (hôte, encodage, chemin).
- Seules les adresses complètes **HTTPS**, sans identifiants et de 2048 caractères maximum, sont acceptées. HTTP est refusé, sans conversion automatique. LinkedIn doit pointer vers un profil `/in/...` sur `linkedin.com` ou l’un de ses sous-domaines, avec le port HTTPS habituel.
- Le formulaire et la base refusent `localhost` et ses sous-domaines, les noms sans suffixe DNS, ainsi que les suffixes locaux `.localdomain`, `.local`, `.internal`, `.lan`, `.home`, `.corp` et `.home.arpa`. Les variantes en majuscules ou avec un point terminal sont contrôlées aussi.
- Les IPv4 privées, de bouclage, de liaison locale, partagées et de multicast/réserve sont refusées : `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/3`. Le même contrôle couvre les IPv6 locales et les IPv4 privées embarquées dans une IPv6 (mapped, translated, NAT64 et 6to4). Les adresses Teredo et le préfixe NAT64 local sont refusés.
- Le navigateur canonise les variantes numériques, hexadécimales, octales ou encodées avant contrôle. La base exige un hôte ASCII/punycode ou une IP canonique ; les variantes brutes qui pourraient contourner son interprétation sont refusées. Les adresses IP publiques restent utilisables pour un portfolio.
- La base vérifie aussi ces contraintes pour les écritures qui ne passent pas par le formulaire. Les liens affichés sont validés avant utilisation et s’ouvrent avec `noopener noreferrer`.
- Le trigger `handle_new_member` enregistre les champs des métadonnées à l’inscription email. La RPC `complete_member_profile` reçoit deux paramètres supplémentaires, `p_linkedin_url` et `p_portfolio_url`, par défaut `NULL`. Ses anciens appels à 12 paramètres continuent à fonctionner.

Ces contrôles portent sur l’adresse fournie. Ils ne résolvent pas le DNS et ne suivent pas les redirections : un domaine public qui résout vers une IP privée n’est donc pas détecté. L’application n’effectue aucune requête serveur vers ces liens. Ils ne constituent pas une garantie sur le contenu du site de destination.

Références pour les plages et la normalisation : [registre IPv4 IANA](https://www.iana.org/assignments/iana-ipv4-special-registry/), [registre IPv6 IANA](https://www.iana.org/assignments/iana-ipv6-special-registry/), [parseur IPv4 WHATWG](https://url.spec.whatwg.org/#ipv4-parser).

## Migration et ordre de déploiement

Migrations, dans l’ordre :

1. [`20261021181216_optional_profile_links.sql`](../supabase/migrations/20261021181216_optional_profile_links.sql) : colonnes facultatives, inscription et complétion de profil.
2. [`20261021182359_public_https_profile_links.sql`](../supabase/migrations/20261021182359_public_https_profile_links.sql) : HTTPS obligatoire, contrôle des hôtes et revalidation des contraintes.

Les deux migrations ont été appliquées le 21 octobre 2026 au projet Supabase Cloud **LSNB Alumni** (`yesumbhssechcrlgpgqj`). Les noms des fichiers reprennent les versions attribuées par Supabase. Vérifications distantes après durcissement : deux colonnes nullable, trois profils existants conservés sans liens, RLS active et deux contraintes validées. Les contrôles HTTPS, localhost, IPv4/IPv6 privées, variantes numériques et IP publiques ont réussi sur la base distante.

Pour un autre environnement, appliquer les migrations précédentes puis ces deux fichiers une seule fois, dans l’ordre. Chacun contient sa transaction. Le durcissement échoue entièrement si un lien existant viole les nouvelles contraintes : vérifier ces liens avant migration ; aucune valeur n’est supprimée ou réécrite automatiquement. Ne pas réexécuter le schéma initial et ne pas réinitialiser la base.

Déployer ensuite le frontend mis à jour pour afficher les règles et erreurs correspondantes. La base impose déjà ces règles aux écritures de tout client. Aucun déploiement du frontend ni aucune migration de VM1 n’a été effectué dans cette intervention.

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('linkedin_url', 'portfolio_url');
-- Deux lignes, text, is_nullable = YES.

select proname, pronargs, pronargdefaults
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'complete_member_profile';
-- Une seule signature, 14 arguments dont 2 avec valeur par défaut.

select public.is_valid_profile_link(null, true) as empty_link_allowed,
       public.is_valid_profile_link('https://www.linkedin.com/in/exemple/', true) as linkedin_allowed,
       public.is_valid_profile_link('http://portfolio.example/', false) as http_allowed,
       public.is_valid_profile_link('https://localhost/', false) as localhost_allowed,
       public.is_valid_profile_link('https://192.168.1.1/', false) as private_ipv4_allowed,
       public.is_valid_profile_link('https://[fd00::1]/', false) as private_ipv6_allowed;
-- true, true, false, false, false, false.
```

## Vérification locale

```bash
npm run typecheck
npm run build
npm run test:api
```

La suite PostgreSQL embarquée PGlite couvre les comptes existants, l’inscription email avec ou sans liens, les anciens et nouveaux appels de complétion Google, l’ajout/remplacement/suppression et l’isolation entre membres. Elle vérifie le rejet des adresses interdites dans les trois parcours d’écriture, ainsi que l’annulation atomique d’une migration incompatible avec des données existantes. Une fixture partagée entre le helper et SQL vérifie les variantes IPv4/IPv6, les noms locaux et les adresses publiques autorisées. Les tests du helper couvrent aussi les URL vides, malformées, les domaines trompeurs et la limite de longueur.

Validation du 21 octobre 2026 : 170 tests réussis, vérifications TypeScript frontend/API et compilation Vite réussies. Le contrôle Supabase Security Advisors ne montre pas de nouvelle alerte liée à cette migration ; les alertes antérieures sont inchangées.
