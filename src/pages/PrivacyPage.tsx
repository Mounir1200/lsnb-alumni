export function PrivacyPage() {
  return (
    <article className="legal-page page-shell">
      <p className="eyebrow eyebrow--dark">Confidentialité</p>
      <h1>Comprendre comment votre parcours est partagé.</h1>
      <p>
        Ce prototype sépare les informations de profil des coordonnées personnelles. Dans la
        configuration Supabase fournie, seuls les membres authentifiés peuvent parcourir les
        profils complets et chaque personne garde le contrôle de la visibilité de son contact.
        Les portraits Highlight, eux, sont visibles par tous sur l’accueil, sans connexion.
      </p>
      <h2>Données collectées</h2>
      <p>
        Nom, prénom, statut, promotion, parcours, spécialités, expérience, ville, pays, photo et
        moyen de contact. Le genre est facultatif et déclaré par la personne pour équilibrer
        les duos Highlight. Le mentorat est volontaire et peut être désactivé à tout moment.
      </p>
      <h2 id="highlights">Les portraits Highlight</h2>
      <p>
        Chaque semaine, deux profils alumni actifs sont tirés au sort pour être mis à l’honneur.
        Leurs noms, photo, promotion, spécialité, ville, pays et portrait sont publiés sur
        l’accueil. Cette publication est accessible à toute personne, même sans compte.
      </p>
      <p>
        Pour rédiger ces portraits, les informations nécessaires sur le parcours sont envoyées
        à Mistral, un service d’intelligence artificielle. Les données de connexion et les
        coordonnées enregistrées dans les champs de contact ne sont pas transmises. Le texte est fondé sur
        les informations du profil, puis enregistré pour la semaine ; chaque visite ne déclenche
        pas une nouvelle rédaction.
      </p>
      <p>
        Vous pouvez corriger vos informations dans votre espace membre. Un portrait déjà publié
        reflète les informations du profil au moment de sa rédaction. N’ajoutez pas de coordonnées
        privées dans le texte de votre parcours : ce texte peut être transmis à Mistral et repris
        dans un portrait public.
      </p>
      <h2>Mode démonstration</h2>
      <p>
        Tant que Supabase n’est pas configuré, le formulaire ne crée aucun compte distant. Il
        conserve uniquement un aperçu de profil dans le navigateur, sans enregistrer le mot de
        passe.
      </p>
    </article>
  );
}
