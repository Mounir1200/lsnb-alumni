import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type Role = "admin" | "moderator";
export type Context = {
  user_id: string;
  role: Role;
  graduation_year: number | null;
  display_name: string;
};
export type Member = {
  id: string;
  first_name: string;
  last_name: string;
  graduation_year: number | null;
  member_role: string;
  is_active: boolean;
  is_suspended: boolean;
  profile_completed: boolean;
  created_at: string;
  city: string | null;
  country: string | null;
  staff_role: Role | null;
};
export type PageData<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};
export type Dashboard = {
  members: number;
  active_members: number;
  suspended_members: number;
  mentors: number;
  offers: number;
  requests: number;
  active_30d: number;
  promotions: { year: number; members: number; active: number }[];
  activity: {
    day: string;
    active_members: number;
    views: number;
    registrations: number;
  }[];
};
export type Audit = {
  id: string;
  created_at: string;
  actor_name: string;
  action: string;
  target_name: string | null;
  graduation_year: number | null;
  reason: string | null;
};
export type Staff = {
  user_id: string;
  role: Role;
  graduation_year: number | null;
  display_name: string;
};
export type SiteStatus = {
  enabled: boolean;
  active: boolean;
  message: string;
  ends_at: string | null;
  started_at: string | null;
  server_time: string;
};
export type Log = {
  id: string;
  time: string;
  level: string;
  event: string;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  request_id?: string;
};
export type LogData = {
  entries: Log[];
  started_at: string;
  retention: string;
  service: string;
};

const preview = new URLSearchParams(window.location.search).get("demo");
export const demoRole: Role | null =
  import.meta.env.DEV && (preview === "admin" || preview === "moderator")
    ? preview
    : null;
const now = new Date();
const sampleMembers: Member[] = import.meta.env.DEV ? [
  ["Aminata", "Ouédraogo", 2018, "Ouagadougou", "Burkina Faso"],
  ["Idrissa", "Koné", 2019, "Lyon", "France"],
  ["Fatoumata", "Traoré", 2020, "Abidjan", "Côte d’Ivoire"],
  ["Moussa", "Sanou", 2018, "Bobo-Dioulasso", "Burkina Faso"],
  ["Aïcha", "Diallo", 2021, "Dakar", "Sénégal"],
  ["Oumar", "Zongo", 2019, "Paris", "France"],
  ["Mariam", "Coulibaly", 2020, "Montréal", "Canada"],
  ["Adama", "Sow", 2018, "Bamako", "Mali"],
].map(([first, last, year, city, country], index) => ({
  id: `sample-${index}`,
  first_name: String(first),
  last_name: String(last),
  graduation_year: Number(year),
  member_role: index % 3 === 0 ? "mentor" : "alumni",
  is_active: index !== 5,
  is_suspended: index === 5,
  profile_completed: true,
  created_at: new Date(now.getTime() - index * 86400000).toISOString(),
  city: String(city),
  country: String(country),
  staff_role: index === 3 ? "moderator" : null,
})) : [];
const sampleActivity = import.meta.env.DEV ? Array.from({ length: 30 }, (_, i) => ({
  day: new Date(now.getTime() - (29 - i) * 86400000).toISOString().slice(0, 10),
  active_members: 1 + ((i * 3) % 7),
  views: 36 + ((i * 23) % 76),
  registrations: i % 4 === 0 ? 1 : 0,
})) : [];

function demoData(name: string, args: Record<string, unknown>): unknown {
  const members =
    demoRole === "moderator"
      ? sampleMembers.filter((m) => m.graduation_year === 2018)
      : sampleMembers;
  switch (name) {
    case "hub_context":
      return {
        user_id: "preview",
        role: demoRole,
        graduation_year: demoRole === "moderator" ? 2018 : null,
        display_name: "Camille · aperçu",
      };
    case "hub_dashboard":
      return {
        members: members.length,
        active_members: members.filter((m) => m.is_active).length,
        suspended_members: members.filter((m) => !m.is_active).length,
        mentors: 3,
        offers: 12,
        requests: 18,
        active_30d: members.length,
        promotions: [...new Set(members.map((m) => m.graduation_year))].map(
          (year) => ({
            year,
            members: members.filter((m) => m.graduation_year === year).length,
            active: members.filter(
              (m) => m.graduation_year === year && m.is_active,
            ).length,
          }),
        ),
        activity: sampleActivity,
      };
    case "hub_members": {
      const filtered = members.filter(
        (m) =>
          (!args.p_promotion ||
            m.graduation_year === Number(args.p_promotion)) &&
          (!args.p_search ||
            fullName(m)
              .toLowerCase()
              .includes(String(args.p_search).toLowerCase())) &&
          (args.p_status === "all" ||
            (args.p_status === "active") === m.is_active),
      );
      return {
        items: filtered,
        total: filtered.length,
        page: 1,
        page_size: 25,
      };
    }
    case "hub_staff":
      return [
        {
          user_id: "preview",
          role: "admin",
          graduation_year: null,
          display_name: "Camille · aperçu",
        },
        {
          user_id: "sample-3",
          role: "moderator",
          graduation_year: 2018,
          display_name: "Moussa Sanou · exemple",
        },
      ];
    case "hub_audit":
      return {
        items: [
          {
            id: "sample-audit",
            created_at: now.toISOString(),
            actor_name: "Camille · aperçu",
            action: "member_suspended",
            target_name:
              demoRole === "moderator"
                ? "Adama Sow · exemple"
                : "Oumar Zongo · exemple",
            graduation_year: demoRole === "moderator" ? 2018 : 2019,
            reason: "Exemple de décision de modération, sans effet réel.",
          },
        ],
        total: 1,
        page: 1,
        page_size: 25,
      };
    case "public_site_status":
      return {
        enabled: false,
        active: false,
        message: "Nous améliorons votre réseau. Merci de votre patience.",
        ends_at: null,
        started_at: null,
        server_time: new Date().toISOString(),
      };
    default:
      throw new Error(
        "Aperçu uniquement : aucune modification réelle n’a été effectuée.",
      );
  }
}

export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (demoRole) return demoData(name, args) as T;
  if (!supabase)
    throw new Error("La connexion au service n’est pas configurée.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase
      .rpc(name, args)
      .abortSignal(controller.signal);
    if (error) {
      if (controller.signal.aborted)
        throw new Error("Le service met trop de temps à répondre. Réessayez.");
      if (/Remove the staff role/i.test(error.message))
        throw new Error(
          "Retirez d’abord le rôle de ce membre dans Équipe & accès.",
        );
      if (/Remove the moderator role/i.test(error.message))
        throw new Error(
          "Retirez d’abord son rôle de modérateur avant de corriger sa promotion.",
        );
      if (/yourself|your own staff/i.test(error.message))
        throw new Error(
          "Vous ne pouvez pas modifier vos propres droits ou suspendre votre compte.",
        );
      if (/last administrator/i.test(error.message))
        throw new Error("Le dernier administrateur doit conserver son accès.");
      if (/Moderators must belong/i.test(error.message))
        throw new Error(
          "Un modérateur doit appartenir à la promotion qui lui est attribuée.",
        );
      if (/active completed profile/i.test(error.message))
        throw new Error(
          "Ce rôle nécessite un compte actif avec un profil complet.",
        );
      if (/Member not found/i.test(error.message))
        throw new Error("Ce membre n’existe plus. Actualisez la liste.");
      if (
        error.code === "42501" ||
        /forbidden|unauthorized|not authorized|staff_required/i.test(
          error.message,
        )
      )
        throw new Error(
          "Accès refusé. Vos droits ont peut-être changé : reconnectez-vous.",
        );
      throw new Error(error.message || "Le service ne répond pas. Réessayez.");
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function useResource<T>(loader: () => Promise<T>, key: string) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
    at: Date | null;
  }>({ data: null, loading: true, error: "", at: null });
  const [version, setVersion] = useState(0);
  const lastKey = useRef(key);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    const sameQuery = lastKey.current === key;
    lastKey.current = key;
    setState((old) => ({
      ...old,
      data: sameQuery ? old.data : null,
      loading: true,
      error: "",
    }));
    loaderRef
      .current()
      .then((data) => {
        if (alive)
          setState({ data, loading: false, error: "", at: new Date() });
      })
      .catch((error) => {
        if (alive)
          setState({
            data: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Une erreur est survenue.",
            at: null,
          });
      });
    return () => {
      alive = false;
    };
  }, [key, version]);
  return { ...state, refresh };
}

export const fullName = (m: Member) =>
  `${m.first_name} ${m.last_name}`.trim() || "Membre sans nom";
export const number = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
export const date = (s: string | Date, time = false) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(time ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(s));
export const roleName = (role: string | null) =>
  role === "admin"
    ? "Administrateur"
    : role === "moderator"
      ? "Modérateur"
      : role === "mentor"
        ? "Mentor"
        : "Alumni";
