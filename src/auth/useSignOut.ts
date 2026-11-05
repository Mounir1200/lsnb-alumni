import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearProfileDrafts } from "../lib/profileDraft";
import { supabase } from "../lib/supabase";
import { signOutAndLeave } from "./signOut";

/** Ends the session from anywhere on the site, then returns to the home page. */
export function useSignOut() {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (!supabase || isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOutAndLeave(supabase.auth, clearProfileDrafts, () => navigate("/", { replace: true }));
    } finally {
      setIsSigningOut(false);
    }
  };

  return { signOut, isSigningOut };
}
