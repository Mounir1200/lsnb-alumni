export type SourceProfile = {
  id: string;
  first_name: string;
  last_name: string;
  graduation_year: number | null;
  specialty: string;
  specialties: string[];
  domain: string | null;
  city: string | null;
  country: string | null;
  experience: string;
  photo_url: string | null;
  offers_mentoring: boolean;
  mentoring_topics: string[];
};

export type GeneratedArticle = {
  title: string;
  paragraphs: string[];
  generationMethod: "ai" | "fallback";
  model: string | null;
};

export type StoredArticle = {
  slot: number;
  profile_id: string;
  source_profile: SourceProfile;
  title: string | null;
  paragraphs: string[] | null;
  generation_method: "ai" | "fallback" | null;
  ai_attempted_at: string | null;
  generated_at: string | null;
};

export type HighlightClaim = {
  outcome: "claimed" | "published" | "busy" | "empty";
  lease_token?: string;
  articles?: StoredArticle[];
};

export type PublicHighlight = {
  weekStart: string;
  weekEnd: string;
  publishedAt: string;
  articles: {
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
  }[];
};

export interface HighlightStore {
  current(weekStart: string): Promise<PublicHighlight | null>;
  claim(weekStart: string): Promise<HighlightClaim>;
  claimAi(weekStart: string, slot: number, leaseToken: string): Promise<boolean>;
  save(weekStart: string, slot: number, leaseToken: string, article: GeneratedArticle): Promise<boolean>;
  publish(weekStart: string, leaseToken: string): Promise<boolean>;
}
