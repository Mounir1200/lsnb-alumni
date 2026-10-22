import { BriefcaseBusiness, GraduationCap, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import {
  CAREER_STEP_LIMITS,
  createCareerStepDraft,
  MAX_CAREER_STEPS,
  type CareerStepDraft,
  type CareerStepKind,
} from "../../lib/careerSteps";
import "./CareerStepsEditor.css";

const kindOptions = [
  { kind: "education", label: "Formation", Icon: GraduationCap },
  { kind: "work", label: "Expérience", Icon: BriefcaseBusiness },
] as const;

const fieldCopy: Record<CareerStepKind, { title: string; organizationLabel: string; organization: string }> = {
  education: { title: "Ex. Licence de physique", organizationLabel: "Établissement", organization: "Ex. École d’ingénieurs" },
  work: { title: "Ex. Développeur IA", organizationLabel: "Organisation", organization: "Ex. Entreprise, laboratoire, ONG" },
};

// Upcoming steps (an accepted admission) may start next year.
const LATEST_START_OFFSET_YEARS = 1;

type CareerStepsEditorProps = {
  steps: CareerStepDraft[];
  onChange: (steps: CareerStepDraft[]) => void;
  disabled?: boolean;
};

/** Edits the dated steps that build the "Repères" timeline of a profile. */
export function CareerStepsEditor({ steps, onChange, disabled = false }: CareerStepsEditorProps) {
  const listId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const stepToFocus = useRef<string | null>(null);
  const { year } = CAREER_STEP_LIMITS;
  const latestStart = new Date().getFullYear() + LATEST_START_OFFSET_YEARS;

  useEffect(() => {
    if (!stepToFocus.current) return;
    document.getElementById(`${listId}-${stepToFocus.current}-title`)?.focus();
    stepToFocus.current = null;
  }, [steps, listId]);

  const update = (key: string, changes: Partial<CareerStepDraft>) => {
    onChange(steps.map((step) => (step.key === key ? { ...step, ...changes } : step)));
  };

  const add = () => {
    const draft = createCareerStepDraft();
    stepToFocus.current = draft.key;
    onChange([...steps, draft]);
  };

  const remove = (key: string) => {
    onChange(steps.filter((step) => step.key !== key));
    addButton.current?.focus();
  };

  return (
    <fieldset className="career-editor" disabled={disabled}>
      <legend>Étapes clés du parcours <span>(facultatif)</span></legend>
      <p className="career-editor__hint">
        Formations, expériences, échanges… Elles forment les repères de votre profil, de la plus ancienne
        à la plus récente. Votre bac au LSNB y figure déjà.
      </p>

      {steps.length > 0 && (
        <ol className="career-editor__list">
          {steps.map((step, index) => {
            const id = `${listId}-${step.key}`;
            const position = index + 1;
            const copy = fieldCopy[step.kind];
            return (
              <li key={step.key}>
                {/* Every card repeats the same labels: the group names its step for screen readers. */}
                <div role="group" aria-labelledby={`${id}-heading`} className={`career-step-card career-step-card--${step.kind}`}>
                  <div className="career-step-card__header">
                    <b id={`${id}-heading`}>Étape {position}</b>
                    <div className="career-step-card__kinds" role="radiogroup" aria-label={`Type de l’étape ${position}`}>
                      {kindOptions.map(({ kind, label, Icon }) => (
                        <label key={kind} className={step.kind === kind ? "is-selected" : undefined}>
                          <input
                            type="radio"
                            name={`${id}-kind`}
                            value={kind}
                            checked={step.kind === kind}
                            onChange={() => update(step.key, { kind })}
                          />
                          <Icon size={15} aria-hidden="true" /> {label}
                        </label>
                      ))}
                    </div>
                    <button type="button" className="career-step-card__remove" onClick={() => remove(step.key)}>
                      <Trash2 size={15} aria-hidden="true" /> Retirer<span className="sr-only"> l’étape {position}</span>
                    </button>
                  </div>
  
                  <label className="field-group">
                    <span>Intitulé</span>
                    <input
                      id={`${id}-title`}
                      value={step.title}
                      onChange={(event) => update(step.key, { title: event.target.value })}
                      minLength={CAREER_STEP_LIMITS.title.min}
                      maxLength={CAREER_STEP_LIMITS.title.max}
                      placeholder={copy.title}
                      required
                    />
                  </label>
  
                  <div className="form-row">
                    <label className="field-group">
                      <span>{copy.organizationLabel}</span>
                      <input
                        value={step.organization}
                        onChange={(event) => update(step.key, { organization: event.target.value })}
                        maxLength={CAREER_STEP_LIMITS.organization.max}
                        placeholder={copy.organization}
                      />
                    </label>
                    <label className="field-group">
                      <span>Lieu</span>
                      <input
                        value={step.location}
                        onChange={(event) => update(step.key, { location: event.target.value })}
                        maxLength={CAREER_STEP_LIMITS.location.max}
                        placeholder="Ex. Angers, France"
                      />
                    </label>
                  </div>
  
                  <div className="form-row">
                    <label className="field-group">
                      <span>Année de début</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={step.startYear}
                        onChange={(event) => update(step.key, { startYear: event.target.value })}
                        min={year.min}
                        max={latestStart}
                        placeholder="2020"
                        required
                      />
                    </label>
                    <label className="field-group">
                      <span>Année de fin</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={step.endYear}
                        onChange={(event) => update(step.key, { endYear: event.target.value })}
                        min={Number(step.startYear) || year.min}
                        max={year.max}
                        placeholder="En cours"
                        aria-describedby={`${id}-end-help`}
                      />
                      <small id={`${id}-end-help`}>Laissez vide si c’est votre situation actuelle.</small>
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {steps.length < MAX_CAREER_STEPS ? (
        <button ref={addButton} type="button" className="button button--outline button--md career-editor__add" onClick={add}>
          <Plus size={17} aria-hidden="true" /> {steps.length ? "Ajouter une étape" : "Ajouter une première étape"}
        </button>
      ) : (
        <p className="career-editor__hint">Vous avez atteint le maximum de {MAX_CAREER_STEPS} étapes.</p>
      )}
    </fieldset>
  );
}
