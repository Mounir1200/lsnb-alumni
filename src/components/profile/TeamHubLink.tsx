import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { hubLinkFor, loadHubAccess, teamHubUrl, type HubAccess } from "../../lib/teamHub";
import { ButtonLink } from "../ui/Button";

const hubUrl = teamHubUrl();

/** Asks the database, once per account, whether the hub opens to it. */
function useHubAccess(userId: string) {
  const [access, setAccess] = useState<HubAccess | null>(null);
  useEffect(() => {
    let active = true;
    void loadHubAccess(supabase).then((isOpen) => {
      if (active) setAccess({ userId, isOpen });
    });
    return () => {
      active = false;
    };
  }, [userId]);
  return access;
}

/**
 * Team members find the hub among the actions of their own profile, and only
 * there. The hub then shows them what their role allows.
 */
export function TeamHubLink({ userId }: { userId: string }) {
  const href = hubLinkFor(userId, useHubAccess(userId), hubUrl);
  if (!href) return null;
  return (
    <ButtonLink to={href} size="lg" variant="ghost">
      <Shield size={18} aria-hidden="true" /> Hub de l’équipe
    </ButtonLink>
  );
}
