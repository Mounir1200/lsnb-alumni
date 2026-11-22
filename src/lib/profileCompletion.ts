import { toCareerStepRows, type CareerStep } from "./careerSteps";

type CompletionChoices = { memberRole: "alumni" | "student"; careerSteps: CareerStep[]; listedPublicly: boolean };

/**
 * What completing a profile saves on the member's own row once the completion
 * RPC has run, since the RPC takes neither: the career steps, and the choice
 * to appear in the public directory, which only an alumnus can make.
 */
export function completionExtras({ memberRole, careerSteps, listedPublicly }: CompletionChoices) {
  return {
    ...(careerSteps.length > 0 ? { career_steps: toCareerStepRows(careerSteps) } : {}),
    ...(memberRole === "alumni" && listedPublicly ? { listed_publicly: true as const } : {}),
  };
}
