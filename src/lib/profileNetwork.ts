import type { MemberConnection, MemberSummary, MentorshipNetwork } from "./mentorshipData";

export type NetworkGroup = { key: string; label: string; members: MemberSummary[]; description: string; empty: string; detail: string };

/** A member's connections are private: only their own profile lists them. */
export type NetworkData = { mentorships: MentorshipNetwork; connections?: MemberConnection[] };

const present = <T>(items: (T | null | undefined)[]) => items.flatMap((item) => (item ? [item] : []));

/**
 * The tabs of a profile's network. On their own profile a member sees the
 * people they are connected with first, then the people they mentor and their
 * mentors; on another profile, only the public mentorships.
 */
export function networkGroups({ mentorships, connections = [] }: NetworkData, isOwnProfile: boolean): NetworkGroup[] {
  const mentors = present(mentorships.mentors.map((item) => item.mentor));
  const mentees = present(mentorships.mentees.map((item) => item.mentee));
  if (!isOwnProfile) {
    return [
      { key: "mentors", label: "Mentors", members: mentors, description: "Les personnes qui l’accompagnent.", empty: "Aucun mentor pour le moment.", detail: "Les mentorats acceptés apparaîtront ici." },
      { key: "mentees", label: "Mentorés", members: mentees, description: "Les personnes accompagnées dans leur parcours.", empty: "Aucun mentoré pour le moment.", detail: "Les accompagnements acceptés apparaîtront ici." },
    ];
  }
  return [
    { key: "connections", label: "Membres du réseau", members: present(connections.map((item) => item.peer)), description: "Les membres avec qui vous êtes en relation. Vous seul voyez cette liste.", empty: "Aucune relation pour le moment.", detail: "Les demandes de connexion acceptées apparaîtront ici." },
    { key: "mentees", label: "Mentorés", members: mentees, description: "Les personnes que vous accompagnez.", empty: "Aucun mentoré pour le moment.", detail: "Les accompagnements acceptés apparaîtront ici." },
    { key: "mentors", label: "Mentors", members: mentors, description: "Les personnes qui vous accompagnent.", empty: "Aucun mentor pour le moment.", detail: "Les mentorats acceptés apparaîtront ici." },
  ];
}

/** The tab a profile opens on: one's own first non-empty list; on another profile, its mentees when it has some. */
export function initialNetworkGroup(groups: NetworkGroup[], isOwnProfile: boolean): string {
  if (isOwnProfile) {
    const firstWithMembers = groups.find((group) => group.members.length > 0);
    return firstWithMembers ? firstWithMembers.key : groups[0]!.key;
  }
  return groups.some((group) => group.key === "mentees" && group.members.length > 0) ? "mentees" : "mentors";
}
