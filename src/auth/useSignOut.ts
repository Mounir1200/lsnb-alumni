import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearProfileDrafts } from "../lib/profileDraft";
import { supabase } from "../lib/supabase";
import { signOutAndLeave } from "./signOut";

/** Ends the session from anywhere on the site, then returns to the home page, or tells when it could not. */
export function useSignOut() {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const signOut = async () => {
    if (!supabase || isSigningOut) return;
    setIsSigningOut(true);
    setHasFailed(false);
    try {
      const hasSignedOut = await signOutAndLeave(supabase.auth, clearProfileDrafts, () => navigate("/", { replace: true }));
      setHasFailed(!hasSignedOut);
    } finally {
      setIsSigningOut(false);
    }
  };

  return { signOut, isSigningOut, hasFailed };
}
