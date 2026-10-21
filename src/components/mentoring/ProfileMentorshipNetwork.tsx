import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import {
  getConnectionErrorMessage,
  loadMentorshipNetwork,
  type MentorshipNetwork,
} from "../../lib/mentorshipRepository";
import { Button } from "../ui/Button";
import { MentorshipPerson } from "./MentorshipPerson";

function NetworkMembers({ network }: { network: MentorshipNetwork }) {
  const id = useId();
  const mentors = network.mentors.flatMap((item) => item.mentor ? [item.mentor] : []);
  const mentees = network.mentees.flatMap((item) => item.mentee ? [item.mentee] : []);
  const [selected, setSelected] = useState<"mentors" | "mentees">(mentees.length ? "mentees" : "mentors");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const groups = [
    { key: "mentors" as const, label: "Mentors", members: mentors, description: "Les personnes qui l’accompagnent.", empty: "Aucun mentor pour le moment.", detail: "Les mentorats acceptés apparaîtront ici." },
    { key: "mentees" as const, label: "Mentorés", members: mentees, description: "Les personnes accompagnées dans leur parcours.", empty: "Aucun mentoré pour le moment.", detail: "Les accompagnements acceptés apparaîtront ici." },
  ];
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = 1 - index;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setSelected(next === 0 ? "mentors" : "mentees");
    tabs.current[next]?.focus();
  };

  return (
    <>
      <div className="profile-network__tabs" role="tablist" aria-label="Relations de mentorat">
        {groups.map((group, index) => (
          <button key={group.key} ref={(element) => { tabs.current[index] = element; }} type="button" role="tab"
            id={`${id}-${group.key}-tab`} aria-controls={`${id}-${group.key}-panel`}
            aria-selected={selected === group.key} tabIndex={selected === group.key ? 0 : -1}
            onClick={() => setSelected(group.key)} onKeyDown={(event) => selectWithKeyboard(event, index)}>
            {group.label}<span>{group.members.length}</span>
          </button>
        ))}
      </div>
      {groups.map((group) => (
        <div key={group.key} id={`${id}-${group.key}-panel`} role="tabpanel"
          aria-labelledby={`${id}-${group.key}-tab`} hidden={selected !== group.key} tabIndex={0}>
          {group.members.length ? (
            <>
              <p className="profile-network__description">{group.description}</p>
              <ul className="profile-network__people">
                {group.members.map((member) => <li key={member.id}><MentorshipPerson member={member} /></li>)}
              </ul>
            </>
          ) : (
            <div className="profile-network__empty"><p>{group.empty}</p><span>{group.detail}</span></div>
          )}
        </div>
      ))}
    </>
  );
}

export function ProfileMentorshipNetwork({ profileId, firstName, isDemo = false }: {
  profileId: string;
  firstName: string;
  isDemo?: boolean;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const [reload, setReload] = useState(0);
  const scope = `${user?.id ?? ""}:${profileId}`;
  const [state, setState] = useState<{ scope: string; data?: MentorshipNetwork; error?: string }>();

  useEffect(() => {
    if (!user || isDemo) return;
    let active = true;
    setState({ scope });
    void loadMentorshipNetwork(profileId)
      .then((data) => { if (active) setState({ scope, data }); })
      .catch((error: unknown) => { if (active) setState({ scope, error: getConnectionErrorMessage(error) }); });
    return () => { active = false; };
  }, [user?.id, profileId, isDemo, reload, scope]);

  const current = state?.scope === scope ? state : undefined;
  return (
    <section className="profile-network" aria-label={`Réseau de mentorat de ${firstName}`}>
      <div className="profile-network__heading">
        <h2>Son réseau de mentorat</h2>
        <span><LockKeyhole size={14} aria-hidden="true" /> Visible par les membres connectés</span>
      </div>
      {isDemo ? (
        <p>Démonstration : aucun lien de mentorat réel n’est associé à ce profil fictif.</p>
      ) : authLoading ? (
        <p className="connections-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Chargement du réseau…</p>
      ) : !user ? (
        <p>Connectez-vous pour consulter les mentors et les personnes accompagnées par {firstName}.</p>
      ) : current?.error ? (
        <div className="form-status form-status--error" role="alert">
          {current.error}
          <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>Réessayer</Button>
        </div>
      ) : !current?.data ? (
        <p className="connections-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Chargement du réseau…</p>
      ) : (
        <NetworkMembers key={scope} network={current.data} />
      )}
    </section>
  );
}
