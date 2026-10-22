import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import {
  CAREER_STEP_LIMITS,
  createCareerStepDraft,
  MAX_CAREER_STEPS,
  type CareerStepDraft,
  type CareerStepKind,
} from "../../lib/careerSteps";
import "./CareerStepsEditor.css";

const groups: Record<CareerStepKind, {
  legend: string;
  hint: string;
  item: string;
  add: string;
  title: string;
  organizationLabel: string;
  organization: string;
}> = {
  education: {
    legend: "Formation",
    hint: "Prépa, licence, master, école… Votre bac au LSNB apparaît déjà sur votre profil.",
    item: "Formation",
    add: "Ajouter une formation",
    title: "Ex. Licence de physique",
    organizationLabel: "Établissement",
    organization: "Ex. École d’ingénieurs",
  },
  work: {
    legend: "Expériences professionnelles",
    hint: "Stages, emplois, alternances… Votre poste actuel devient le rôle affiché sous votre nom.",
    item: "Expérience",
    add: "Ajouter une expérience",
    title: "Ex. Développeur IA",
    organizationLabel: "Organisation",
    organization: "Ex. Entreprise, laboratoire, ONG",
  },
};

// Upcoming steps (an accepted admission) may start next year.
const LATEST_START_OFFSET_YEARS = 1;

type CareerStepsEditorProps = {
  steps: CareerStepDraft[];
  onChange: (steps: CareerStepDraft[]) => void;
  disabled?: boolean;
};

/** Edits the dated studies and jobs shown on a profile, one group per kind. */
export function CareerStepsEditor({ steps, onChange, disabled = false }: CareerStepsEditorProps) {
  const editorId = useId();
  const addButtons = useRef<Partial<Record<CareerStepKind, HTMLButtonElement | null>>>({});
  const stepToFocus = useRef<string | null>(null);
  const { year } = CAREER_STEP_LIMITS;
  const latestStart = new Date().getFullYear() + LATEST_START_OFFSET_YEARS;
  const isFull = steps.length >= MAX_CAREER_STEPS;

  useEffect(() => {
    if (!stepToFocus.current) return;
    document.getElementById(`${editorId}-${stepToFocus.current}-title`)?.focus();
    stepToFocus.current = null;
  }, [steps, editorId]);

  const update = (key: string, changes: Partial<CareerStepDraft>) => {
    onChange(steps.map((step) => (step.key === key ? { ...step, ...changes } : step)));
  };

  const add = (kind: CareerStepKind) => {
    const draft = createCareerStepDraft(kind);
    stepToFocus.current = draft.key;
    onChange([...steps, draft]);
  };

  const remove = (step: CareerStepDraft) => {
    onChange(steps.filter((item) => item.key !== step.key));
    addButtons.current[step.kind]?.focus();
  };

  const renderStep = (step: CareerStepDraft, position: number) => {
    const id = `${editorId}-${step.key}`;
    const copy = groups[step.kind];
    return (
      <li key={step.key}>
        {/* Every card repeats the same labels: the group names its step for screen readers. */}
        <div role="group" aria-labelledby={`${id}-heading`} className="career-step-card">
          <div className="career-step-card__header">
            <b id={`${id}-heading`}>{copy.item} {position}</b>
            <button type="button" className="career-step-card__remove" onClick={() => remove(step)}>
              <Trash2 size={15} aria-hidden="true" /> Retirer<span className="sr-only"> {copy.item.toLowerCase()} {position}</span>
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
  };

  return (
    <div className="career-editor">
      <p className="career-editor__title">Étapes clés du parcours <span>(facultatif)</span></p>
      {(Object.keys(groups) as CareerStepKind[]).map((kind) => {
        const copy = groups[kind];
        const groupSteps = steps.filter((step) => step.kind === kind);
        return (
          <fieldset key={kind} className={`career-editor__group career-editor__group--${kind}`} disabled={disabled}>
            <legend>{copy.legend}</legend>
            <p className="career-editor__hint">{copy.hint}</p>
            {groupSteps.length > 0 && (
              <ol className="career-editor__list">{groupSteps.map((step, index) => renderStep(step, index + 1))}</ol>
            )}
            <button
              ref={(element) => { addButtons.current[kind] = element; }}
              type="button"
              className="button button--outline button--md career-editor__add"
              onClick={() => add(kind)}
              disabled={isFull}
            >
              <Plus size={17} aria-hidden="true" /> {copy.add}
            </button>
          </fieldset>
        );
      })}
      {isFull && <p className="career-editor__hint">Vous avez atteint le maximum de {MAX_CAREER_STEPS} étapes.</p>}
    </div>
  );
}
