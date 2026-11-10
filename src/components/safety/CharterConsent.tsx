import { Link } from "react-router-dom";
import { CHARTER_PATH } from "../../lib/site";

/** Joining means accepting the code of conduct. The charter opens in a new tab so the form keeps what was typed. */
export function CharterConsent({ disabled = false }: { disabled?: boolean }) {
  return (
    <label className="form-consent">
      <input name="charterAccepted" type="checkbox" required disabled={disabled} />
      <span>
        Je m’engage à respecter la{" "}
        <Link to={CHARTER_PATH} target="_blank" rel="noopener">charte de conduite<span className="sr-only"> (nouvel onglet)</span></Link>{" "}
        du réseau&nbsp;: respect, honnêteté, protection des élèves.
      </span>
    </label>
  );
}
