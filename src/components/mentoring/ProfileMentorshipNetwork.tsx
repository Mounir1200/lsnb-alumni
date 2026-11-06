import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import {
  getConnectionErrorMessage,
  loadMemberConnections,
  loadMentorshipNetwork,
} from "../../lib/mentorshipRepository";
import { initialNetworkGroup, networkGroups, type NetworkData, type NetworkGroup } from "../../lib/profileNetwork";
import { nextTabIndex } from "../../lib/tabs";
import { Button } from "../ui/Button";
import { MentorshipPerson } from "./MentorshipPerson";

function NetworkMembers({ groups, initial }: { groups: NetworkGroup[]; initial: string }) {
  const id = useId();
  const [selected, setSelected] = useState(initial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, groups.length);
    if (next === undefined) return;
    event.preventDefault();
    setSelected(groups[next]!.key);
    tabs.current[next]?.focus();
  };

  return (
    <>
      <div className="profile-network__tabs" role="tablist" aria-label="Relations">
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

function ProfileNetworkContent({ data, isOwnProfile }: { data: NetworkData; isOwnProfile: boolean }) {
  const groups = networkGroups(data, isOwnProfile);
  return <NetworkMembers groups={groups} initial={initialNetworkGroup(groups, isOwnProfile)} />;
}

export function ProfileMentorshipNetwork({ profileId, firstName, isDemo = false }: {
  profileId: string;
  firstName: string;
  isDemo?: boolean;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const [reload, setReload] = useState(0);
  const isOwnProfile = !isDemo && user?.id === profileId;
  const scope = `${user?.id ?? ""}:${profileId}`;
  const [state, setState] = useState<{ scope: string; data?: NetworkData; error?: string }>();

  useEffect(() => {
    if (!user || isDemo) return;
    let active = true;
    setState({ scope });
    void Promise.all([loadMentorshipNetwork(profileId), isOwnProfile ? loadMemberConnections(user.id) : undefined])
      .then(([mentorships, connections]) => { if (active) setState({ scope, data: { mentorships, connections } }); })
      .catch((error: unknown) => { if (active) setState({ scope, error: getConnectionErrorMessage(error) }); });
    return () => { active = false; };
  }, [user?.id, profileId, isDemo, isOwnProfile, reload, scope]);

  const current = state?.scope === scope ? state : undefined;
  return (
    <section className="profile-network" aria-label={isOwnProfile ? "Mon réseau" : `Réseau de mentorat de ${firstName}`}>
      <div className="profile-network__heading">
        <h2>{isOwnProfile ? "Mon réseau" : "Son réseau de mentorat"}</h2>
        <span><LockKeyhole size={14} aria-hidden="true" /> {isOwnProfile ? "Mentorats visibles par les membres connectés" : "Visible par les membres connectés"}</span>
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
        <ProfileNetworkContent key={scope} data={current.data} isOwnProfile={isOwnProfile} />
      )}
    </section>
  );
}
