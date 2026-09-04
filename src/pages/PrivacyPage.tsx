export function PrivacyPage() {
  return (
    <article className="legal-page page-shell">
      <p className="eyebrow eyebrow--dark">Confidentialité</p>
      <h1>Les données servent à relier la communauté, pas à l’exposer.</h1>
      <p>
        Ce prototype sépare les informations de profil des coordonnées personnelles. Dans la
        configuration Supabase fournie, seuls les membres authentifiés peuvent parcourir les
        profils et chaque personne garde le contrôle de la visibilité de son contact.
      </p>
      <h2>Données collectées</h2>
      <p>
        Nom, prénom, statut, promotion, parcours, spécialités, expérience, pays, photo et moyen
        de contact. Le mentorat est volontaire et peut être désactivé à tout moment.
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
