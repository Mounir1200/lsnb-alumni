import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toStoryBlocks } from "../../lib/profileStory";
import { cn } from "../../lib/cn";

// Longer stories open on a preview so the rest of the profile stays within reach.
const STORY_PREVIEW_CHARACTERS = 1200;

export function ProfileStory({ firstName, story }: { firstName: string; story: string }) {
  const { lede, paragraphs } = toStoryBlocks(story);
  const isLong = [...story].length > STORY_PREVIEW_CHARACTERS;
  const [isExpanded, setIsExpanded] = useState(false);
  const textId = useId();
  const sectionRef = useRef<HTMLElement>(null);

  const toggle = () => {
    setIsExpanded((value) => !value);
    // Collapsing from far below would otherwise leave the reader past the story.
    if (isExpanded && (sectionRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  };

  return (
    <section ref={sectionRef} className="profile-story" aria-labelledby={`${textId}-title`}>
      <h2 id={`${textId}-title`} className="profile-section-title">Son parcours</h2>
      {!lede && paragraphs.length === 0 ? (
        <p className="profile-story__empty">{firstName} n’a pas encore raconté son parcours.</p>
      ) : (
        <div id={textId} className={cn("profile-story__text", isLong && !isExpanded && "is-collapsed")}>
          {lede && <p className="profile-story__lede">{lede}</p>}
          {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      )}
      {isLong && (
        <button type="button" className="profile-story__toggle" aria-expanded={isExpanded} aria-controls={textId} onClick={toggle}>
          {isExpanded ? "Réduire le parcours" : "Lire tout le parcours"}
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
