export type MemberSummary = {
  id: string;
  firstName: string;
  lastName: string;
  memberRole: "alumni" | "student";
  graduationYear: number | null;
  specialty: string;
  offersMentoring: boolean;
  initials: string;
  avatarTone: "ochre" | "green" | "blue" | "sand";
  photoUrl?: string;
};

export type MemberRow = {
  id: string; first_name: string; last_name: string; member_role: "alumni" | "student";
  graduation_year: number | null; specialty: string; offers_mentoring: boolean; photo_url: string | null;
};

export const memberColumns = "id, first_name, last_name, member_role, graduation_year, specialty, offers_mentoring, photo_url";

const avatarTones = ["ochre", "green", "blue", "sand"] as const;

export function mapMemberSummary(row: MemberRow | null): MemberSummary | null {
  if (!row) return null;
  const checksum = [...row.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name, memberRole: row.member_role,
    graduationYear: row.graduation_year, specialty: row.specialty, offersMentoring: row.offers_mentoring,
    initials: `${row.first_name[0] ?? ""}${row.last_name[0] ?? ""}`.toUpperCase(),
    avatarTone: avatarTones[checksum % avatarTones.length] ?? "sand", photoUrl: row.photo_url ?? undefined,
  };
}
