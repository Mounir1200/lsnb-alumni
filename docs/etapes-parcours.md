# Étapes du parcours

Les membres décrivent leur trajectoire en deux parties complémentaires :

- **« Votre parcours en quelques phrases »** (`experience`) : le récit libre, affiché dans « Son parcours » ;
- **« Étapes clés du parcours »** (`career_steps`) : jusqu’à 12 étapes datées, affichées dans « Repères » après le bac au LSNB.

Les étapes se saisissent à l’inscription par e-mail, à la complétion d’un compte Google et dans **Modifier mon profil**. Chaque étape indique son type (formation ou expérience), un intitulé, l’établissement ou l’organisation, le lieu, l’année de début et, si elle est terminée, l’année de fin. Une année de fin vide signifie « en cours ».

Les repères sont classés par année. Une expérience en cours devient le rôle affiché sous le nom du membre et dans l’annuaire ; sans expérience en cours, la spécialité reste utilisée et « Aujourd’hui » reprend le rôle et le lieu du profil.

## Base de données

Migration : [`20261022092007_profile_career_steps.sql`](../supabase/migrations/20261022092007_profile_career_steps.sql), appliquée au projet Supabase Cloud **LSNB Alumni** (`yesumbhssechcrlgpgqj`) le 22 octobre 2026. Dans tout autre environnement, l’appliquer **avant** de déployer le frontend, qui lit désormais la colonne `career_steps`.

- `profiles.career_steps` est un tableau JSON, vide par défaut, soumis aux mêmes règles RLS et droits que le reste du profil.
- La contrainte `profiles_career_steps_check` (fonction `is_valid_career_steps`) refuse tout ce qui sort du format : clés inconnues, type autre que `education` ou `work`, intitulé de 2 à 120 caractères non rogné, établissement ou lieu de plus de 120 caractères, années hors de 1950 à 2100 ou non entières, fin antérieure au début, plus de 12 étapes.
- Inscription par e-mail : sans session avant confirmation, les étapes voyagent dans les métadonnées d’inscription. Le trigger `on_auth_user_created_career_steps` les copie sur le profil juste après sa création ; des étapes invalides sont ignorées sans bloquer l’inscription.
- Complétion Google : la fonction `complete_member_profile` n’est pas modifiée ; les étapes sont enregistrées juste après sur la ligne du membre. En cas d’échec, renvoyer le formulaire relance cet enregistrement sans réécrire le profil déjà complété.

## Vérifications

```bash
npm run typecheck
npm run build
npm run test:api
```

Après application en production : version enregistrée dans l’historique Supabase, les trois profils existants démarrent avec une liste vide, contrainte validée, triggers `on_auth_user_created` puis `on_auth_user_created_career_steps` sur `auth.users`, fonction de validation refusée au rôle `anon` et fonction de copie inaccessible aux membres. La validation a accepté un parcours valide et refusé un type inconnu, une fin antérieure au début, une année en texte et une clé supplémentaire. Security et Performance Advisors n’ont signalé aucun nouvel avertissement.

`api/src/highlights/career-steps.database.test.ts` exécute les migrations dans PGlite : enregistrement par le membre, refus des formats invalides, copie à l’inscription par e-mail, comptes Google et absence de droits pour un autre membre. `api/src/highlights/career-steps.test.ts` vérifie la validation, le tri, la conversion et le choix du rôle actuel côté client.
