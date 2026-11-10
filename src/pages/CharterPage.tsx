import { ArrowDown, BadgeCheck, Ban, HeartHandshake, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { RouteStop } from "../components/visual/RouteStop";
import { REPORTED_MESSAGE_COUNT } from "../lib/safety";
import "../components/safety/Charter.css";

const essentials = [
  { icon: HeartHandshake, title: "Respectez chacun.", text: "Pas d’insulte, de moquerie ni de harcèlement." },
  { icon: BadgeCheck, title: "Soyez vous-même.", text: "Vrai nom, vraie promotion, vrai parcours." },
  { icon: ShieldCheck, title: "Protégez les élèves.", text: "Ici, on parle études, orientation et métiers." },
  { icon: Ban, title: "Jamais d’argent.", text: "Le mentorat est gratuit, sans contrepartie." },
];

export function CharterPage() {
  return (
    <article className="legal-page page-shell charter-page">
      <header className="charter-page__intro">
        <RouteStop>Charte de conduite</RouteStop>
        <h1>Un réseau où chacun échange en confiance.</h1>
        <p>
          LSNB Alumni relie des élèves du lycée, souvent mineurs, à des anciens qui veulent les aider.
          Ce lien ne marche que si chacun peut demander, écrire et répondre sans crainte. En rejoignant
          le réseau, vous vous engagez à respecter ces règles.
        </p>
      </header>

      {/* Beside the rules on wide screens, and kept in view while reading them. */}
      <aside className="charter-aside" aria-label="La charte en bref">
        <ul className="charter-essentials">
          {essentials.map(({ icon: Icon, title, text }) => (
            <li key={title}><Icon aria-hidden="true" /><b>{title}</b><span>{text}</span></li>
          ))}
        </ul>
        <a className="charter-aside__help" href="#que-faire">Un problème&nbsp;? Voir quoi faire <ArrowDown aria-hidden="true" /></a>
      </aside>

      <div className="charter-main">
        <h2>Les règles</h2>
        <ol className="route-steps charter-rules">
          <li><div>
            <h3>Respecter chaque personne.</h3>
            <p>
              Pas d’insultes, de menaces, de moqueries ni de harcèlement. Pas de propos qui rabaissent
              quelqu’un pour son origine, son ethnie, sa religion, son sexe ou un handicap. On a le droit
              de ne pas être d’accord, poliment.
            </p>
          </div></li>
          <li><div>
            <h3>Être honnête sur qui vous êtes.</h3>
            <p>
              Utilisez votre vrai nom, votre vraie promotion et un parcours exact. Ne vous faites jamais
              passer pour une autre personne. Votre compte est personnel&nbsp;: ne le prêtez à personne.
            </p>
          </div></li>
          <li><div>
            <h3>Protéger les élèves.</h3>
            <p>Beaucoup d’élèves du lycée ont moins de 18&nbsp;ans. Les échanges portent sur les études, l’orientation et les métiers.</p>
            <ul>
              <li>Aucun message à caractère sexuel ou amoureux, aucune remarque sur le physique.</li>
              <li>Ne demandez pas de photo personnelle.</li>
              <li>Avec un élève mineur, restez sur la messagerie du site&nbsp;: elle protège les deux personnes et permet de signaler un problème.</li>
              <li>Pas de rencontre seul à seul avec un élève mineur. Pour un échange en personne, choisissez un lieu public et prévenez ses parents.</li>
            </ul>
          </div></li>
          <li><div>
            <h3>Ne jamais demander d’argent.</h3>
            <p>
              Le mentorat est bénévole et gratuit. Ne demandez ni argent, ni cadeau, ni service en échange
              d’un conseil, d’un stage ou d’une bourse. Ne demandez pas non plus de documents personnels
              (passeport, relevé bancaire, mot de passe). Une offre qui fait payer pour obtenir une place
              est une arnaque&nbsp;: signalez-la.
            </p>
          </div></li>
          <li><div>
            <h3>Partager des informations vraies.</h3>
            <p>
              Publiez des offres réelles, avec le lien officiel quand il existe. Ne promettez pas ce que
              vous ne pouvez pas garantir, comme une admission ou une bourse. Si vous n’êtes pas sûr,
              dites-le.
            </p>
          </div></li>
          <li><div>
            <h3>Respecter la vie privée.</h3>
            <p>
              Ne diffusez pas hors du site les messages, les photos ou les coordonnées d’un autre membre
              sans son accord. Pas de capture d’écran publiée pour se moquer ou nuire.
            </p>
          </div></li>
          <li><div>
            <h3>Garder le réseau utile.</h3>
            <p>
              Pas de publicité, de spam, de messages en chaîne ni de propagande politique ou religieuse.
              Quand vous écrivez à quelqu’un, présentez-vous et dites ce que vous cherchez.
            </p>
          </div></li>
        </ol>

        <h2 id="que-faire">Si quelque chose ne va pas</h2>
        <p>Vous n’avez pas à le supporter. Ces gestes sont possibles, seuls ou ensemble.</p>
        <dl className="charter-actions">
          <div>
            <dt>Bloquer</dt>
            <dd>
              Depuis le profil de la personne, choisissez «&nbsp;Bloquer&nbsp;». Elle ne peut plus vous écrire
              ni vous envoyer de demande, et vos liens avec elle prennent fin. Elle n’est pas prévenue.
              Vous pouvez la débloquer à tout moment depuis «&nbsp;Mes relations&nbsp;».
            </dd>
          </div>
          <div>
            <dt>Signaler</dt>
            <dd>
              Depuis son profil ou votre conversation, choisissez «&nbsp;Signaler&nbsp;». L’équipe de
              modération examine chaque signalement. Si vous signalez une conversation, ses
              {` ${REPORTED_MESSAGE_COUNT} `}derniers messages lui sont transmis pour qu’elle puisse juger.
              La personne signalée ne sait pas qui l’a signalée.
            </dd>
          </div>
          <div>
            <dt>En parler</dt>
            <dd>Si vous êtes élève, parlez-en aussi à un adulte de confiance&nbsp;: un parent, un professeur, le proviseur.</dd>
          </div>
          <div>
            <dt>Appeler les secours</dt>
            <dd>
              En cas de danger immédiat, appelez les secours. Au Burkina Faso&nbsp;: police secours 17,
              sapeurs-pompiers 18. Ailleurs, le numéro d’urgence du pays où vous êtes.
            </dd>
          </div>
        </dl>

        <h2>Ce que fait l’équipe de modération</h2>
        <p>
          Les administrateurs du réseau et les modérateurs de chaque promotion lisent les signalements.
          Selon la gravité des faits, ils peuvent suspendre l’accès d’un membre au réseau, et transmettre
          les faits les plus graves, surtout envers un élève, au lycée ou aux autorités. Chaque décision
          est inscrite dans un journal.
        </p>
        <p>Un signalement mensonger, fait pour nuire, est lui aussi contraire à cette charte.</p>

        <p className="charter-page__version">
          Cette charte complète la <Link to="/confidentialite">politique de confidentialité</Link>. Version du 9&nbsp;novembre&nbsp;2026.
        </p>
      </div>
    </article>
  );
}
