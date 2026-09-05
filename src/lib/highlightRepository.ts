export type HighlightArticle = {
  profileId: string;
  firstName: string;
  lastName: string;
  graduationYear: number | null;
  specialty: string;
  city: string | null;
  country: string | null;
  photoUrl: string | null;
  title: string;
  paragraphs: string[];
  generationMethod: "ai" | "fallback";
};

export type WeeklyHighlight = {
  weekStart: string;
  weekEnd: string;
  publishedAt: string;
  articles: HighlightArticle[];
};

const DAY = 24 * 60 * 60 * 1000;

// Ouagadougou uses UTC year-round. Avoid the visitor's local Monday boundary.
export function currentHighlightWeek(now = new Date()) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function nextHighlightWeek(weekStart: string) {
  return Date.parse(`${weekStart}T00:00:00Z`) + 7 * DAY;
}

function isArticle(value: unknown): value is HighlightArticle {
  if (!value || typeof value !== "object") return false;
  const article = value as Partial<HighlightArticle>;
  return [article.profileId, article.firstName, article.lastName, article.specialty, article.title]
    .every((item) => typeof item === "string")
    && [article.city, article.country, article.photoUrl]
      .every((item) => item === null || typeof item === "string")
    && (article.graduationYear === null || Number.isInteger(article.graduationYear))
    && Array.isArray(article.paragraphs)
    && article.paragraphs.length > 0
    && article.paragraphs.every((paragraph) => typeof paragraph === "string")
    && (article.generationMethod === "ai" || article.generationMethod === "fallback");
}

export async function loadCurrentHighlight(signal: AbortSignal): Promise<WeeklyHighlight | null> {
  const apiUrl = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!apiUrl) return null;
  const response = await fetch(`${apiUrl}/api/v1/highlights/current`, {
    signal,
    credentials: "omit",
    cache: "no-cache",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Le Highlight n’est pas accessible pour le moment.");

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("highlight" in payload)) {
    throw new Error("La réponse du Highlight est incomplète.");
  }
  if (payload.highlight === null) return null;
  if (typeof payload.highlight !== "object") throw new Error("Le Highlight est illisible.");

  const highlight = payload.highlight as Partial<WeeklyHighlight>;
  if (typeof highlight.weekStart !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(highlight.weekStart)
    || typeof highlight.weekEnd !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(highlight.weekEnd)
    || !Number.isFinite(Date.parse(`${highlight.weekStart}T00:00:00Z`))
    || !Number.isFinite(Date.parse(`${highlight.weekEnd}T00:00:00Z`))
    || typeof highlight.publishedAt !== "string"
    || !Array.isArray(highlight.articles)
    || highlight.articles.length !== 2
    || !highlight.articles.every(isArticle)) {
    throw new Error("La réponse du Highlight est incomplète.");
  }

  // Never keep the previous edition on screen after the next Monday.
  return highlight.weekStart === currentHighlightWeek() ? highlight as WeeklyHighlight : null;
}
