const MEMBER_ERRORS: [RegExp, string][] = [
  [/Remove the staff role/i, "Retirez d’abord le rôle de ce membre dans Équipe & accès."],
  [/Remove the moderator role/i, "Retirez d’abord son rôle de modérateur avant de corriger sa promotion."],
  [/yourself|your own staff/i, "Vous ne pouvez pas modifier vos propres droits ou suspendre votre compte."],
  [/at most 3 super administrators/i, "Le réseau compte déjà trois super administrateurs, le maximum."],
  [/leaves the team by resigning/i, "Un super administrateur ne se retire pas depuis le hub : il quitte l’équipe lui-même, ou par la base de données."],
  [/roles below your own/i, "Vous ne gérez que les rôles en dessous du vôtre."],
  [/work network-wide/i, "Un administrateur couvre tout le réseau : il n’a pas de promotion."],
  [/last super administrator/i, "Le dernier super administrateur ne peut pas quitter l’équipe."],
  [/Moderators must belong/i, "Un modérateur doit appartenir à la promotion qui lui est attribuée."],
  [/active completed profile/i, "Ce rôle nécessite un compte actif avec un profil complet."],
  [/Member not found/i, "Ce membre n’existe plus. Actualisez la liste."],
  [/not awaiting approval/i, "Ce compte n’attend plus de validation. Actualisez la liste."],
  [/only approve their own promotion/i, "Vous ne pouvez valider que les comptes de votre promotion."],
];

/** The team's wording for an error raised by the hub's member and team functions, or null for any other error. */
export function memberErrorMessage(message: string) {
  return MEMBER_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}
