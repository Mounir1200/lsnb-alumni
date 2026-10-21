import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { MemberSummary } from "../../lib/mentorshipRepository";
import { Avatar } from "../ui/Avatar";

export function MentorshipPerson({ member }: { member: MemberSummary }) {
  return (
    <Link to={`/alumni/${member.id}`} className="mentorship-person">
      <Avatar initials={member.initials} avatarTone={member.avatarTone} photoUrl={member.photoUrl} label={`Photo de ${member.firstName} ${member.lastName}`} />
      <span className="mentorship-person__info">
        <b>{member.firstName} {member.lastName}</b>
        {member.specialty && <span>{member.specialty}</span>}
        <small>{member.memberRole === "student" ? "Élève" : "Alumni"}{member.graduationYear ? ` · Promotion ${member.graduationYear}` : ""}</small>
      </span>
      <ArrowUpRight size={18} className="mentorship-person__arrow" aria-hidden="true" />
    </Link>
  );
}
