import { ArrowRight, ChevronDown, ChevronUp, LoaderCircle, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useWeeklyHighlight } from "../../hooks/useWeeklyHighlight";
import type { HighlightArticle } from "../../lib/highlightRepository";
import { buildHighlightPreviews } from "../../lib/highlightPreview";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { SectionPathBackdrop } from "../visual/SectionPathBackdrop";

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function HighlightPortrait({ article, index, preview }: {
  article: HighlightArticle;
  index: number;
  preview: ReturnType<typeof buildHighlightPreviews>[number];
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const storyId = useId();
  const name = `${article.firstName} ${article.lastName}`.trim();
  const profilePath = `/alumni/${encodeURIComponent(article.profileId)}`;
  const location = [article.city, article.country].filter(Boolean).join(", ");

  return (
    <article className="highlight-portrait" aria-labelledby={`highlight-title-${index}`}>
      <header className="highlight-portrait__identity">
        <Avatar
          initials={`${article.firstName[0] ?? ""}${article.lastName[0] ?? ""}`.toUpperCase()}
          avatarTone={index === 0 ? "green" : "ochre"}
          photoUrl={article.photoUrl ?? undefined}
          label={article.photoUrl ? `Portrait de ${name}` : `Initiales de ${name}`}
          className="highlight-portrait__photo"
        />
        <div>
          <p className="highlight-portrait__promotion">
            Alumni LSNB{article.graduationYear !== null && ` · Promotion ${article.graduationYear}`}
          </p>
          <p className="highlight-portrait__name">{name}</p>
          {article.specialty && <p className="highlight-portrait__specialty">{article.specialty}</p>}
          {location && <p className="highlight-portrait__location">{location}</p>}
        </div>
      </header>

      <h3 id={`highlight-title-${index}`}>{article.title}</h3>
      <div className="highlight-portrait__body">
        <div id={storyId} className="highlight-portrait__text">
          {expanded || !preview.hasMore
            ? article.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)
            : <p>{preview.text}</p>}
        </div>
        {preview.hasMore && (
          <button
            type="button"
            className="text-link text-link--dark highlight-portrait__toggle"
            aria-expanded={expanded}
            aria-controls={storyId}
            aria-label={`${expanded ? "Réduire le portrait" : "Lire le portrait complet"} de ${name}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Réduire le portrait" : "Lire le portrait complet"}
            {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
          </button>
        )}
      </div>
      <footer className="highlight-portrait__footer">
        <p className="highlight-portrait__source">
          {article.generationMethod === "ai"
            ? "Portrait rédigé avec l’aide de l’IA"
            : "Aperçu du profil · rédaction IA indisponible"}
        </p>
        <Link
          to={user ? profilePath : `/connexion?next=${encodeURIComponent(profilePath)}`}
          className="text-link text-link--dark"
          aria-label={`Découvrir le profil de ${name}${user ? "" : " après connexion"}`}
        >
          Découvrir le profil <ArrowRight size={17} aria-hidden="true" />
        </Link>
        {!user && <span>Connexion requise pour le profil complet</span>}
      </footer>
    </article>
  );
}

export function WeeklyHighlights() {
  const { status, highlight, retry } = useWeeklyHighlight();
  const previews = highlight ? buildHighlightPreviews(highlight.articles) : [];

  return (
    <section id="highlights" className="section featured-section highlights-section" aria-labelledby="highlights-title">
      <SectionPathBackdrop variant="profiles" />
      <div className="page-shell">
        <div className="highlights-heading">
          <div>
            <p className="eyebrow eyebrow--dark">Highlight · Les alumni à l’honneur</p>
            <h2 id="highlights-title">Deux parcours.<br />Une semaine à la une.</h2>
          </div>
          <p>
            Chaque lundi, deux alumni du LSNB sont tirés au sort. Leurs parcours prennent
            la parole, à partir des expériences qu’ils ont partagées.
          </p>
        </div>

        <div aria-live="polite" aria-busy={status === "loading"}>
          {status === "loading" && (
            <div className="highlights-state" role="status">
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
              <p>Nous retrouvons les portraits de la semaine…</p>
            </div>
          )}
          {status === "error" && (
            <div className="highlights-state">
              <div>
                <h3>Les portraits n’ont pas pu être chargés.</h3>
                <p>Réessayez pour retrouver le Highlight de cette semaine.</p>
              </div>
              <Button onClick={retry} variant="outline"><RefreshCw size={16} aria-hidden="true" /> Réessayer</Button>
            </div>
          )}
          {status === "empty" && (
            <div className="highlights-state">
              <div>
                <h3>Le prochain duo se prépare.</h3>
                <p>Aucun Highlight n’est encore publié pour cette semaine. Les portraits seront à lire ici.</p>
              </div>
              <Button onClick={retry} variant="outline"><RefreshCw size={16} aria-hidden="true" /> Actualiser</Button>
            </div>
          )}
          {status === "ready" && highlight && (
            <>
              <p className="highlights-edition">
                À la une du <time dateTime={highlight.weekStart}>{dateFormat.format(new Date(`${highlight.weekStart}T00:00:00Z`))}</time>
                {" au "}<time dateTime={highlight.weekEnd}>{dateFormat.format(new Date(`${highlight.weekEnd}T00:00:00Z`))}</time>
              </p>
              <div className="highlights-grid">
                {highlight.articles.map((article, index) => (
                  <HighlightPortrait
                    key={`${highlight.weekStart}-${article.profileId}-${article.title}`}
                    article={article}
                    index={index}
                    preview={previews[index]!}
                  />
                ))}
              </div>
              <p className="highlights-source-note">
                Ces portraits s’appuient sur les informations partagées dans les profils.
              </p>
            </>
          )}
        </div>

        <div className="section-link-row">
          <Link to="/annuaire" className="text-link">
            Parcourir tous les profils <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
