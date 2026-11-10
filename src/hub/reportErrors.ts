const REPORT_ERRORS: [RegExp, string][] = [
  [/already settled/i, "Ce signalement a déjà été traité. Actualisez la liste."],
  [/outside your scope/i, "Ce signalement ne concerne pas votre promotion."],
  [/filed yourself/i, "Vous êtes l’auteur de ce signalement : un autre membre de l’équipe doit le traiter."],
  [/Report not found/i, "Ce signalement n’existe plus. Actualisez la liste."],
  [/Explain the outcome/i, "Expliquez la décision en 10 à 500 caractères."],
];

/** The team's wording for an error raised by the hub's report functions, or null for any other error. */
export function reportErrorMessage(message: string) {
  return REPORT_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}
