import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearProfileDrafts } from "../lib/profileDraft";
import { supabase } from "../lib/supabase";

/** Ends the session from anywhere on the site, then returns to the home page. */
export function useSignOut() {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (!supabase || isSigningOut) return;
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      // Profile drafts may hold personal details: none stays on a shared device.
      clearProfileDrafts();
      navigate("/", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  return { signOut, isSigningOut };
}
