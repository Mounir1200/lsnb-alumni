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
        moyen de contact. Vous pouvez aussi ajouter un lien LinkedIn et un lien de portfolio :
        ils sont facultatifs, visibles par les membres connectés sur votre fiche et modifiables
        ou supprimables depuis votre espace membre. Le genre est facultatif et déclaré par la personne pour équilibrer
        les duos Highlight et adapter les pronoms et les accords du portrait. Il n’est jamais
        déduit du nom ou de la photo. Le mentorat est volontaire.
      </p>
      <h2 id="mentorat">Demandes et liens de mentorat</h2>
      <p>
        Un membre peut envoyer une demande à une personne qui propose du mentorat. Cette
        personne choisit de l’accepter ou de la refuser ; l’auteur peut l’annuler tant qu’elle
        est en attente. Le message de la demande et son suivi sont réservés aux deux personnes
        concernées. Ils ne sont pas affichés aux autres membres du réseau.
      </p>
      <p>
        Après acceptation, le lien entre le mentor et la personne accompagnée apparaît sur leurs
        fiches, pour les membres connectés. Chacun peut mettre fin à ce lien depuis son espace
        de relations : il cesse alors d’apparaître sur les fiches. Désactiver votre offre de
        mentorat dans votre profil arrête les nouvelles demandes, mais ne met pas fin à vos
        relations existantes. La visibilité de vos coordonnées reste un réglage distinct.
      </p>
      <h2>Messages privés et rappels</h2>
      <p>
        Après acceptation d’une demande, les deux personnes peuvent poursuivre leur échange
        dans la messagerie. Le texte des messages et leur état de lecture sont réservés aux
        participants. Les autres membres, administrateurs et modérateurs n’y accèdent pas
        depuis le site. Les nouveaux messages de cette messagerie sont chiffrés de bout en bout
        sur l’appareil de l’expéditeur et déchiffrés sur celui du destinataire après déverrouillage.
        La base conserve leur contenu chiffré, les identifiants des participants, les dates et
        l’état de lecture. Les textes de présentation des demandes, accessibles dans Mes
        relations, restent distincts et ne sont pas chiffrés de bout en bout.
      </p>
      <p>
        La première activation exige un code envoyé à l’adresse e-mail du compte, en plus de
        la session connectée. Votre clé de récupération est créée sur votre appareil et ne
        quitte pas celui-ci pour être envoyée au service. Le serveur conserve la clé publique
        et une copie de la clé privée chiffrée avec cette clé de récupération. Vous devez
        conserver la clé de récupération : sa perte rend l’historique chiffré irrécupérable.
        Le site ne propose aucune réinitialisation permettant de lire ces anciens messages.
      </p>
      <p>
        Les clés déverrouillées et les textes ne sont pas enregistrés dans le stockage persistant
        du navigateur par la messagerie. Le rechargement, le changement de compte, le bouton
        Verrouiller, cinq minutes d’inactivité ou une minute dans un onglet masqué verrouillent
        cet espace. Un jeton de session volé seul ne permet pas de déchiffrer les messages.
        Cette protection ne couvre pas un appareil compromis ou du code malveillant exécuté
        dans un navigateur où la messagerie est déjà déverrouillée.
      </p>
      <p>
        Un signal récent d’activité permet d’éviter les rappels e-mail lorsque vous utilisez
        le site. Il ne montre pas votre présence aux autres membres. Si des messages restent non
        lus pendant votre absence, un rappel peut être envoyé à l’adresse de votre compte, sans
        le texte des messages. Brevo, le prestataire d’envoi, reçoit l’adresse e-mail de votre
        compte pour transmettre ce rappel, mais pas le contenu de vos messages. Ces rappels sont
        regroupés et désactivables dans Mes messages.
      </p>
      <h2>Inscription et connexion avec Google</h2>
      <p>
        Si vous choisissez Google, votre adresse e-mail, votre nom et votre photo de compte,
        lorsqu’ils sont disponibles, sont transmis à Supabase pour vous identifier. Votre nom
        et votre photo peuvent servir à préremplir votre profil. Vous complétez et vérifiez
        les informations de votre parcours avant de rejoindre l’annuaire. Cette connexion
        ne demande aucun accès à vos messages Gmail, à Google Drive ou à vos contacts Google.
      </p>
      <h2 id="highlights">Les portraits Highlight</h2>
      <p>
        Chaque semaine, deux profils alumni actifs sont tirés au sort pour être mis à l’honneur.
        Leurs noms, photo, promotion, spécialité, ville, pays et portrait sont publiés sur
        l’accueil. Cette publication est accessible à toute personne, même sans compte.
      </p>
      <p>
        Pour rédiger ces portraits, les informations nécessaires sur le parcours sont envoyées
        à OpenAI, un service d’intelligence artificielle, avec une indication d’accord féminin,
        masculin ou neutre issue de votre choix de genre. Sans précision, le texte utilise votre
        prénom et des formulations neutres. Les données de connexion et les
        coordonnées enregistrées dans les champs de contact ne sont pas transmises. Le texte est fondé sur
        les informations du profil, puis enregistré pour la semaine ; chaque visite ne déclenche
        pas une nouvelle rédaction.
      </p>
      <p>
        Vous pouvez corriger vos informations dans votre espace membre. Un portrait déjà publié
        reflète les informations du profil au moment de sa rédaction. N’ajoutez pas de coordonnées
        privées dans le texte de votre parcours : ce texte peut être transmis à OpenAI et repris
        dans un portrait public.
      </p>
      <h2>Modération et activité du réseau</h2>
      <p>
        Les modérateurs consultent les membres de leur promotion et peuvent suspendre un accès
        en indiquant un motif. Les administrateurs gèrent les accès et peuvent les rétablir.
        Ces décisions sont enregistrées dans un journal réservé à l’équipe habilitée ; les
        modérateurs n’y voient que les actions concernant leur promotion.
      </p>
      <p>
        Pour comprendre l’utilisation du réseau, les visites des membres connectés sont comptées
        par jour et par rubrique. Les statistiques ne collectent ni le texte des recherches,
        ni le contenu des messages, ni les identifiants des profils consultés. Le tableau de bord
        présente des nombres agrégés ; les modérateurs sont limités à leur promotion.
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
