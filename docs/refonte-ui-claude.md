# Refonte UI/UX — branche `refonte-ui-claude`

Direction donnée : garder l'identité actuelle, qui plaît, et la pousser plus loin pour que le site soit plus beau, plus agréable à parcourir et qu'il crée une vraie expérience. Pas d'ASCII Art dans cette version (c'est la piste de Codex).

## Thèse visuelle

Chaque parcours part de Sya : le site trace des trajectoires, de Bobo-Dioulasso vers le monde, et chaque page est une étape de ce chemin.

## Signature

Deux éléments déjà présents, qui deviennent le fil conducteur de tout le site au lieu de s'arrêter au hero :

1. **La trajectoire** : un tracé ocre fin, avec des escales, qui relie les sections et les informations (étapes, recherche, parcours d'un membre).
2. **L'arche** : la découpe arrondie en haut des portraits, reprise comme silhouette des visuels et des cadres.

Ce qui ne change pas : bleu nuit `#0c2948` / `#071d33`, ocre banco `#c27d38` / `#e7b77d`, vert manguier `#2e5a36`, ivoire `#fffdf8` et papier `#faf8f3` ; Bricolage Grotesque pour la voix, Manrope pour la lecture ; le hero « Partir loin. Rester reliés. » et son champ de trajectoires.

## Diagnostic (par priorité)

Haute :
- Textes trop petits : libellés en capitales à 11,5 px, boutons à 13 px, descriptions sous 14 px.
- Navigation de l'en-tête en boîtes encadrées : lourde, et « Se connecter » disparaît sous 1 080 px.

Moyenne :
- Duo automatique bouton plein + bouton contour sur chaque section.
- Le même petit libellé en capitales ouvre chaque section.
- Titres qui cassent sur un mot isolé (« pas seulement un / nom. »).
- La trajectoire, signature du hero, disparaît ensuite ; les sections s'enchaînent par des aplats francs.

Basse :
- 89 tailles de police différentes, arrondis disparates : pas d'échelle commune.
- La photo du lycée est liée directement depuis L'Obs Paalga (780 × 470 px) : elle s'affiche, mais dépend de ce site. À remplacer par les photos officielles du lycée.

## Système

- **Typographie** : échelle unique (display, titre, sous-titre, corps, petit, libellé). Corps 16 px minimum ; libellés 13 px, réservés aux vrais libellés.
- **Espacement** : multiples de 8 px pour le rythme entre blocs.
- **Boutons** : hauteur 44 / 48 / 56 px, texte 15 px ; une action principale par section ; l'action secondaire devient un lien fléché.
- **Navigation** : liens texte, indicateur ocre sous la page active, connexion toujours visible.
- **Mouvement** : 150 à 300 ms, tracés qui se dessinent une fois, `prefers-reduced-motion` respecté, contenu toujours visible sans animation.

## Étapes

1. Fondations (échelle, boutons, en-tête, pied de page).
2. Accueil : hero, recherche, sections reliées par la trajectoire, final « votre trajectoire ».
3. Annuaire : en-tête, filtres, cartes.
4. Profil.
5. Mentorat, offres, Highlights.
6. Espace membre, relations, messages.
7. Contrôle : responsive, accessibilité, check-list des lois UX et anti-slop.

## Accueil (fait)

- Chaque section s'ouvre sur une escale : un point ocre, son libellé, et le tracé pointillé qui descend du bord de la section. Le tracé se dessine à l'arrivée de la section quand le navigateur le permet, sinon il est simplement là.
- Hero : une seule action principale, l'autre devient un lien fléché.
- Libellés, étapes et légendes à 13-14 px, contrastes AA (ocre foncé `--banco-deep` pour les petits textes sur fond clair).
- Final « Prochaine escale : vous » : la section monte sur la précédente, coins arrondis comme les arches.
- Pied de page : liens lisibles, le point de départ (coordonnées du lycée, comme le hero) ; le crédit photo passe en bas.
