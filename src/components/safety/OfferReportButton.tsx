import { Flag } from "lucide-react";
import { useState } from "react";
import type { MemberSummary } from "../../lib/memberSummary";
import { ReportMemberDialog } from "./ReportMemberDialog";
import "./Safety.css";

/** An offer that asks for money or documents is reported through its author, naming the offer. */
export function OfferReportButton({ author, offerTitle }: { author: MemberSummary; offerTitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="offer-report" onClick={() => setOpen(true)}>
        <Flag aria-hidden="true" /> Signaler cette offre
      </button>
      <ReportMemberDialog
        open={open}
        memberId={author.id}
        firstName={author.firstName}
        heading="Signaler cette offre"
        initialDetails={`Offre « ${offerTitle} » : `}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
