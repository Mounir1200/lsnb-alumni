# Hub LSNB — références et direction

Consultées le 22 octobre 2026 :

- [Dashboard Sidebar, Arun Dass](https://21st.dev/@arunjdass/components/dashboard-sidebar) : navigation rétractable, cadre d’espace de travail et contrastes discrets. Ici les commandes sont des boutons accessibles et le menu mobile utilise un dialogue natif.
- [Inline Analytics Table, Ruixen UI](https://21st.dev/@ruixen.ui/components/inline-analytics-table) : associer chiffres lisibles et visualisation légère dans un tableau. Ici les barres de proportion montrent la part de comptes actifs d’une promotion, sans inventer de tendance.

Trois pistes comparées : tableau de contrôle dense sombre (plus technique, moins cohérent avec le réseau), atlas éditorial à grandes cartes de promotions (expressif, moins efficace pour la modération), registre clair à navigation verte (retenu, cohérent avec la marque et les tâches répétées).

Système retenu : Bricolage Grotesque et Manrope déjà utilisées par le site, vert du réseau, papier chaud et séparateurs fins. La donnée est l’élément focal ; les détails narratifs restent secondaires. Les écrans n’utilisent aucune dépendance UI supplémentaire et aucune donnée fictive en production.

L’aperçu `?demo=admin` ou `?demo=moderator` est limité à `import.meta.env.DEV`, clairement signalé et interdit toute écriture. Les journaux serveur d’aperçu restent vides. Les données en production proviennent uniquement des RPC protégées ou de l’API authentifiée.

## Contrôle anti-slop et vérifications

- Vue d’ensemble desktop inspectée dans Brave : hiérarchie des indicateurs, graphique, rail et contraste de la navigation.
- Suspension : confirmation native, bouton désactivé sans motif suffisant, motif valide accepté par l’interface et écriture refusée explicitement en aperçu.
- Maintenance datée : une date absente provoque une erreur compréhensible avant confirmation.
- Équipe : recherche, sélection d’un membre et restriction de sa modération à sa propre promotion vérifiées.
- Vue mobile 390 × 844 : ouverture du tiroir, navigation vers les membres, fermeture automatique, fermeture par Échap et retour du focus vérifiés. Le modérateur n’obtient que les entrées autorisées et sa promotion.
- Build indépendant du hub et vérification TypeScript exécutés. Les opérations réelles d’administration restent à valider avec la migration installée et des comptes de test autorisés.

Les cartes décoratives, faux indicateurs de croissance, fausses lignes de logs et animations permanentes ont été écartés. Les barres du graphique reposent sur les relevés reçus ; une valeur nulle n’est pas dessinée comme une activité. Le mouvement est désactivé avec `prefers-reduced-motion`.
