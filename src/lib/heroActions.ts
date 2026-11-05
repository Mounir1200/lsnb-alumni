export type HeroAction = { label: string; to: string };

/**
 * The hero offers one main action and one quieter link. A visitor is invited
 * to join; a member, who already has a profile, is sent to the directory.
 */
export function heroActions({ isVisitor }: { isVisitor: boolean }): { primary: HeroAction; secondary: HeroAction } {
  const directory = { label: "Explorer l’annuaire", to: "/annuaire" };
  return isVisitor
    ? { primary: { label: "Créer mon compte", to: "/rejoindre" }, secondary: directory }
    : { primary: directory, secondary: { label: "Proposer un mentorat", to: "/rejoindre?mentorat=true" } };
}
