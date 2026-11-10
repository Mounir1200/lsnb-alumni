export type LinkAction = { label: string; to: string };
export type MemberRole = "alumni" | "student";
/** Who reads the page: a visitor is invited to join, a member to use and update their profile. */
export type Audience = "visitor" | MemberRole;
export type ProfileInvitation = { eyebrow: string; title: readonly [string, string]; text: string; action: LinkAction };

export const JOIN_PATH = "/rejoindre";
export const EDIT_PROFILE_PATH = "/espace/modifier";
export const MENTORING_SECTION_ID = "mentorat";

const exploreDirectory: LinkAction = { label: "Explorer l’annuaire", to: "/annuaire" };
const findMentor: LinkAction = { label: "Trouver un mentor", to: "/annuaire?mentor=true" };
const offerMentoring: LinkAction = { label: "Proposer un mentorat", to: `${EDIT_PROFILE_PATH}#${MENTORING_SECTION_ID}` };

const joinNetwork: ProfileInvitation = {
  eyebrow: "Prochaine escale : vous",
  title: ["Ajoutez votre trajectoire", "à la carte."],
  text: "Élève ou alumni, créez un profil clair, partagez votre parcours et choisissez librement si vous souhaitez proposer du mentorat.",
  action: { label: "Créer mon profil", to: JOIN_PATH },
};
const updateProfile: ProfileInvitation = {
  eyebrow: "Prochaine escale : la suite",
  title: ["Votre trajectoire avance ?", "Mettez la carte à jour."],
  text: "Un concours, une nouvelle ville, un premier poste : ajoutez chaque étape à votre parcours pour éclairer ceux qui suivent.",
  action: { label: "Modifier mon profil", to: EDIT_PROFILE_PATH },
};

/**
 * While the session is restored nobody is invited to join: a returning member
 * must not see the sign-up form. A member counts as an alumnus until their
 * profile says they are a pupil.
 */
export function audienceOf({ isLoading, isSignedIn, memberRole }: {
  isLoading: boolean;
  isSignedIn: boolean;
  memberRole: MemberRole | null;
}): Audience {
  if (!isLoading && !isSignedIn) return "visitor";
  return memberRole === "student" ? "student" : "alumni";
}

/** The hero offers one main action and one quieter link. */
export function heroActions(audience: Audience): { primary: LinkAction; secondary: LinkAction } {
  if (audience === "visitor") return { primary: { label: "Créer mon compte", to: JOIN_PATH }, secondary: exploreDirectory };
  return { primary: exploreDirectory, secondary: audience === "alumni" ? offerMentoring : findMentor };
}

/** Only alumni mentor: a pupil is never asked to. */
export function mentoringInvitation(audience: Audience): LinkAction | null {
  if (audience === "visitor") return { label: "Devenir mentor", to: `${JOIN_PATH}?mentorat=true` };
  return audience === "alumni" ? offerMentoring : null;
}

export function profileInvitation(audience: Audience): ProfileInvitation {
  return audience === "visitor" ? joinNetwork : updateProfile;
}
