import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RouteStop } from "../components/visual/RouteStop";
import { REPORTED_MESSAGE_COUNT } from "../lib/safety";
import { CHARTER_PATH } from "../lib/site";

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

export function PrivacyPage() {
  return (
    <article className="legal-page page-shell">
      <RouteStop>Confidentialité</RouteStop>
      <h1>Comprendre comment votre parcours est partagé.</h1>
      <p>
        LSNB Alumni sépare les informations de profil des coordonnées personnelles. Seuls les
        membres connectés consultent les profils complets, et chacun décide de la visibilité de son
        contact. Deux contenus restent visibles sans compte : l’annuaire public et les portraits
        Highlight de l’accueil.
      </p>
      <h2>Annuaire public</h2>
      <p>
        Sans connexion, les visiteurs voient la liste des anciens élèves : nom, photo, promotion,
        spécialité, domaine, ville, pays et disponibilité pour le mentorat. Le parcours, les liens,
        les relations et les coordonnées restent réservés aux membres connectés. Les élèves actuels
        n’apparaissent jamais dans cette liste publique. Chaque ancien élève peut s’en retirer à tout
        moment depuis « Modifier mon profil » ; sa fiche reste alors visible des seuls membres, et il
        n’est plus présenté dans Highlight.
      </p>
      <h2>Connexions et e-mails</h2>
      <p>
        Les connexions entre membres ne sont visibles que par les deux personnes concernées. Quand
        vous recevez une demande de connexion ou de mentorat, ou quand la vôtre est acceptée, un
        e-mail vous prévient aussitôt, sans nom ni message. Brevo, le prestataire d’envoi, reçoit
        l’adresse e-mail de votre compte pour le transmettre. Pour éviter les abus, les demandes d’un
        même membre ne vous valent pas plus d’un e-mail par jour, et un membre ne déclenche pas plus
        de dix e-mails de demande par jour : au-delà, ses demandes restent visibles sur le site, sans
        e-mail. Vous pouvez désactiver ces e-mails dans les réglages de la messagerie.
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
        depuis le site, sauf si l’un des deux participants signale la conversation
        (voir <a href="#signalements">Blocages et signalements</a>). Les messages sont chiffrés dans notre base de données avec une clé
        conservée à part, dans le coffre à secrets de notre hébergeur de base de données
        (Supabase). Ce n’est pas un chiffrement de bout en bout : les personnes qui administrent
        techniquement ce service pourraient y accéder. La base conserve le contenu chiffré, les
        identifiants des participants, les dates et l’état de lecture. Les textes de présentation
        des demandes, accessibles dans Mes relations, restent distincts.
      </p>
      <p>
        Vous n’avez aucune clé ni aucun code à conserver. La messagerie s’ouvre sur les appareils
        où vous vous êtes connecté : à chaque connexion, votre navigateur reçoit automatiquement
        une clé d’appareil que le site peut utiliser mais pas recopier, et chaque lecture ou envoi
        de message doit être signé avec elle. Un jeton de connexion copié seul ne permet donc ni de
        lire vos messages ni d’ajouter un appareil. Se déconnecter, ou retirer un appareil depuis
        Mes messages, lui retire immédiatement l’accès. Cette protection ne couvre pas un appareil
        déjà compromis, ni une personne qui obtiendrait vos identifiants de connexion ou l’accès à
        votre boîte e-mail.
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
        Chaque lundi, deux anciens élèves sont mis à l’honneur sur l’accueil. Leur nom, leur photo,
        leur promotion, leur spécialité, leur ville, leur pays et leur portrait y restent visibles
        par tous, même sans compte, pendant la semaine.
      </p>
      <h3>Qui est tiré au sort</h3>
      <p>
        Le tirage se fait parmi les anciens élèves dont le compte est actif et qui figurent dans
        l’annuaire public ; les élèves actuels n’y participent pas. Il retient d’abord les personnes
        les moins souvent présentées et, quand le genre déclaré le permet, forme un duo femme-homme.
        Un genre non renseigné reste éligible et n’est jamais déduit du nom ni de la photo. Se retirer
        de l’annuaire public, ou voir son accès suspendu, retire aussi de Highlight, y compris un
        portrait déjà publié.
      </p>
      <h3>Ce qui sert à rédiger le portrait</h3>
      <p>Seules ces informations de votre profil sont transmises :</p>
      <ul>
        <li>votre prénom et votre nom ;</li>
        <li>votre promotion, votre spécialité, vos spécialités et votre domaine ;</li>
        <li>votre ville et votre pays ;</li>
        <li>le texte de votre parcours, limité à ses 5 000 premiers caractères ;</li>
        <li>votre offre de mentorat et ses sujets, si vous en proposez ;</li>
        <li>
          l’accord à employer, féminin, masculin ou neutre, tiré du genre que vous avez déclaré ;
          sans précision, le texte reste neutre et utilise votre prénom.
        </li>
      </ul>
      <p>
        Votre photo, votre adresse e-mail, vos coordonnées, vos liens LinkedIn et portfolio, vos
        messages, vos relations et vos données de connexion ne sont jamais transmis.
      </p>
      <h3>Qui rédige</h3>
      <p>
        Le portrait est rédigé par un modèle d’intelligence artificielle d’OpenAI, actuellement
        gpt-6-luna, appelé par l’API d’OpenAI. Chaque profil donne lieu à une seule demande par
        semaine, qui désactive l’enregistrement de la réponse chez OpenAI. Selon les{" "}
        <ExternalLink href="https://developers.openai.com/api/docs/guides/your-data">
          règles d’OpenAI sur les données de son API (en anglais)
        </ExternalLink>
        , les données envoyées ne servent pas à entraîner ses modèles ; OpenAI peut toutefois
        conserver jusqu’à 30 jours des journaux de contrôle des abus, qui peuvent contenir la
        demande et la réponse. Le reste de leur traitement relève de la{" "}
        <ExternalLink href="https://openai.com/policies/privacy-policy/">
          politique de confidentialité d’OpenAI
        </ExternalLink>
        .
      </p>
      <h3>Les vérifications</h3>
      <p>
        Les consignes interdisent d’inventer : chaque passage doit s’appuyer sur les informations
        transmises. Avant publication, le texte est refusé s’il contient une adresse e-mail, un
        lien, un nombre absent du profil ou une recopie du parcours. Dans ce cas, ou si OpenAI ne
        répond pas, un court texte factuel est composé sans intelligence artificielle, à partir des
        mêmes informations ; il peut être remplacé ensuite par un portrait rédigé.
      </p>
      <h3>Conservation et corrections</h3>
      <p>
        Le portrait et une copie des informations retenues sont enregistrés avec l’édition de la
        semaine : une visite ne déclenche jamais de nouvelle rédaction. Les éditions passées restent
        enregistrées pour équilibrer les tirages suivants, mais seule celle de la semaine est
        affichée. Vous pouvez corriger vos informations dans votre espace membre ; un portrait déjà
        publié reflète votre profil au moment de sa rédaction. N’ajoutez pas de coordonnées privées
        dans le texte de votre parcours : il peut être transmis à OpenAI et repris dans un portrait
        public.
      </p>
      <h2>Modération</h2>
      <p>
        L’équipe de modération réunit des administrateurs, qui couvrent tout le réseau, et des
        modérateurs, chacun rattaché à une promotion.
      </p>
      <ul>
        <li>
          Dans l’espace d’administration, un modérateur voit les membres de sa promotion : nom,
          promotion, statut, ville, pays, date d’inscription et état du compte. Il ne voit ni les
          adresses e-mail, ni les coordonnées. Des messages, il ne voit que ceux d’une conversation
          signalée qui concerne un membre de sa promotion.
        </li>
        <li>
          Il peut suspendre l’accès d’un membre de sa promotion en indiquant un motif. Seuls les
          administrateurs peuvent rétablir un accès ou corriger une promotion, eux aussi avec un
          motif.
        </li>
        <li>Personne ne peut se modérer soi-même ni modérer un membre de l’équipe.</li>
        <li>
          Un membre suspendu perd l’accès au réseau : sa fiche disparaît de l’annuaire et de
          Highlight, et il ne reçoit plus d’e-mails de demande.
        </li>
      </ul>
      <p>
        Chaque décision est inscrite dans un journal : son auteur, le membre concerné, la promotion,
        le motif et la date. Ce journal est réservé à l’équipe ; un modérateur n’y voit que les
        décisions concernant sa promotion.
      </p>
      <h2 id="signalements">Blocages et signalements</h2>
      <p>
        Bloquer un membre ne prévient personne. Le blocage est enregistré avec sa date et vous seul
        le voyez, dans «&nbsp;Mes relations&nbsp;», où vous pouvez le lever.
      </p>
      <p>
        Un signalement contient votre nom, celui du membre signalé, le motif, votre description et
        la date. Si vous signalez depuis une conversation, ses {REPORTED_MESSAGE_COUNT} derniers messages, les vôtres compris,
        sont copiés dans le signalement et chiffrés comme les messages. Les signalements sont lus par
        les administrateurs et par les modérateurs de la promotion du membre signalé ; un signalement
        qui vise un membre de l’équipe n’est lu que par les administrateurs. Le membre signalé ne voit
        ni le signalement, ni son auteur.
      </p>
      <p>
        Le traitement d’un signalement (résolu ou classé, avec une note) est inscrit dans le journal de
        modération. Un signalement est conservé tant que le compte du membre signalé existe. Si vous
        supprimez votre compte, vos signalements restent, sans votre nom. Les règles que l’équipe fait
        respecter sont dans la <Link to={CHARTER_PATH}>charte de conduite</Link>.
      </p>
      <h2>Statistiques d’utilisation</h2>
      <p>
        Pour comprendre l’utilisation du réseau, le site compte, pour chaque membre connecté, ses
        visites par jour et par rubrique : accueil, annuaire, profils, offres, Highlight et espace
        membre. Il ne collecte ni le texte des recherches, ni le contenu des messages, ni l’identité
        des profils consultés. Le tableau de bord n’affiche que des totaux ; un modérateur ne voit
        que ceux de sa promotion.
      </p>
    </article>
  );
}
