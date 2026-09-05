import type { GeneratedArticle, HighlightClaim, HighlightRepairClaim, HighlightRepairStore, PublicHighlight, StoredArticle } from "./types.js";
import { weekEnd } from "./week.js";

export type HighlightStorageConfig = { url: string; secretKey: string };

// Do not include upstream response bodies, URLs or headers in errors: they may contain profile data.
export class HighlightStorageError extends Error {
  constructor(readonly status: number) {
    super(`Highlight storage request failed (${status}).`);
    this.name = "HighlightStorageError";
  }
}

export function createHighlightStore(config: HighlightStorageConfig, fetchImpl: typeof fetch = fetch): HighlightRepairStore {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { apikey: config.secretKey };
    // Legacy service_role JWTs require Authorization; new sb_secret keys are resolved by the gateway.
    if (config.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.secretKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HighlightStorageError(503);
    }
    if (!response.ok) throw new HighlightStorageError(response.status);
    try {
      return await response.json() as T;
    } catch {
      throw new HighlightStorageError(502);
    }
  }

  return {
    async current(weekStart) {
      const params = new URLSearchParams({
        week_start: `eq.${weekStart}`,
        status: "eq.published",
        select: "published_at,highlight_articles(slot,profile_id,source_profile,title,paragraphs,generation_method,profiles!inner(is_active,member_role),highlight_article_repairs(title,paragraphs,generated_at))",
        "highlight_articles.profiles.is_active": "eq.true",
        "highlight_articles.profiles.member_role": "eq.alumni",
        limit: "1",
      });
      const rows = await request<{
        published_at: string;
        highlight_articles: (StoredArticle & {
          profiles: { is_active: boolean; member_role: string };
          highlight_article_repairs?: { title: string | null; paragraphs: string[] | null; generated_at: string | null } | null;
        })[];
      }[]>(`weekly_highlights?${params}`);
      const edition = rows[0];
      if (!edition || !edition.published_at) return null;
      const articles = edition.highlight_articles.filter((article) =>
        article.profiles?.is_active && article.profiles.member_role === "alumni" &&
        article.title && Array.isArray(article.paragraphs) && article.paragraphs.length &&
        (article.generation_method === "ai" || article.generation_method === "fallback"),
      );
      if (articles.length !== 2 || articles[0]!.profile_id === articles[1]!.profile_id) return null;
      return {
        weekStart,
        weekEnd: weekEnd(weekStart),
        publishedAt: edition.published_at,
        articles: articles.sort((a, b) => a.slot - b.slot).map((article) => {
          const profile = article.source_profile;
          const repair = article.highlight_article_repairs;
          const repaired = article.generation_method === "fallback" && repair?.generated_at && repair.title &&
            Array.isArray(repair.paragraphs) && repair.paragraphs.length > 0;
          // Explicit allowlist: no source snapshot, lease, gender, contacts or provider metadata is public.
          return {
            profileId: article.profile_id,
            firstName: profile.first_name,
            lastName: profile.last_name,
            graduationYear: profile.graduation_year,
            specialty: profile.specialty,
            city: profile.city,
            country: profile.country,
            photoUrl: publicPhotoUrl(profile.photo_url),
            title: repaired ? repair.title! : article.title!,
            paragraphs: repaired ? repair.paragraphs! : article.paragraphs!,
            generationMethod: repaired ? "ai" : article.generation_method!,
          };
        }),
      } satisfies PublicHighlight;
    },
    claim: (weekStart) => request<HighlightClaim>("rpc/claim_weekly_highlight", { p_week_start: weekStart }),
    claimAi: (weekStart, slot, leaseToken) => request<boolean>("rpc/claim_ai_highlight", {
      p_week_start: weekStart, p_slot: slot, p_lease_token: leaseToken,
    }),
    save: (weekStart, slot, leaseToken, article: GeneratedArticle) => request<boolean>("rpc/save_highlight_article", {
      p_week_start: weekStart, p_slot: slot, p_lease_token: leaseToken,
      p_title: article.title, p_paragraphs: article.paragraphs,
      p_generation_method: article.generationMethod, p_model: article.model,
    }),
    publish: (weekStart, leaseToken) => request<boolean>("rpc/publish_weekly_highlight", {
      p_week_start: weekStart, p_lease_token: leaseToken,
    }),
    claimRepair: (weekStart, slot, retryFailed = false) => request<HighlightRepairClaim>("rpc/claim_highlight_fallback_repair", {
      p_week_start: weekStart, p_slot: slot,
      ...(retryFailed ? { p_retry_failed: true } : {}),
    }),
    recordRepairFailure: (weekStart, slot, repairToken, failure) => request<boolean>("rpc/record_highlight_repair_failure", {
      p_week_start: weekStart, p_slot: slot, p_repair_token: repairToken,
      p_failure_code: failure.code, p_http_status: failure.httpStatus, p_retry_after_seconds: failure.retryAfterSeconds,
    }),
    saveRepair: (weekStart, slot, repairToken, article) => {
      if (article.generationMethod !== "ai") return Promise.resolve(false);
      return request<boolean>("rpc/save_highlight_fallback_repair", {
        p_week_start: weekStart, p_slot: slot, p_repair_token: repairToken,
        p_title: article.title, p_paragraphs: article.paragraphs, p_model: article.model,
      });
    },
  };
}

function publicPhotoUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
