const MEMBER_ERRORS: [RegExp, string][] = [
  [/Remove the staff role/i, "Retirez d’abord le rôle de ce membre dans Équipe & accès."],
  [/Remove the moderator role/i, "Retirez d’abord son rôle de modérateur avant de corriger sa promotion."],
  [/yourself|your own staff/i, "Vous ne pouvez pas modifier vos propres droits ou suspendre votre compte."],
  [/managed in the database/i, "Le rôle d’administrateur se gère directement dans la base de données, pas depuis le hub."],
  [/Moderators must belong/i, "Un modérateur doit appartenir à la promotion qui lui est attribuée."],
  [/active completed profile/i, "Ce rôle nécessite un compte actif avec un profil complet."],
  [/Member not found/i, "Ce membre n’existe plus. Actualisez la liste."],
];

/** The team's wording for an error raised by the hub's member and team functions, or null for any other error. */
export function memberErrorMessage(message: string) {
  return MEMBER_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}
